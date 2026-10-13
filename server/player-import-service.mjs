import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { gameDataError, validatePlayerId } from "./game-data-domain.mjs";
import { boundedOperation, compareSummaryImportSnapshot, createSummaryImportCandidate, validateSummaryImportCandidate } from "./player-summary-import.mjs";
import { projectImportRunStatus } from "./player-import-run-status.mjs";
import { validateDailyImportState, projectDailyImportState } from "./player-import-schedule.mjs";

export const PLAYER_IMPORT_LIMITS = Object.freeze({ pageSize: 5, requestMs: 18000, operationMs: 8000, leaseMs: 45000, previewMs: 300000, tokenBytes: 65536 });
const modes = ["main", "battlefront"];
const fail = (code, message, status = 409) => gameDataError(status, code, message);
const hash = text => createHash("sha256").update(text).digest("hex");
const conflict = error => ["FAILED_PRECONDITION", "ABORTED", "ALREADY_EXISTS"].includes(error?.code) || error?.status === 409;
const initialMode = () => ({ cursor: "", pending: [], nextCursor: "", recentCursors: [], pageLoaded: false, done: false, pages: 0, observed: 0, rejectedKeys: 0,
  attempts: 0, created: 0, updated: 0, unchanged: 0, skipped: 0, failures: 0 });
const actions = new Set(["create", "update", "unchanged", "skip", "retry", "created", "updated"]);
const reasons = new Set(["profile_unavailable", "index_unavailable", "not_read_in_budget", "concurrent_index_change", "write_unavailable", "write_uncertain",
  "missing_profile", "empty_profile", "invalid_index_response", "invalid_existing_summary", "protected_identity_source", "unmanaged_existing_summary",
  "conflicting_index_edits", "conflicting_snapshot", "freshness_unverifiable", "stale_snapshot", "missing_write_precondition"]);
const validId = id => { try { validatePlayerId(id); return true; } catch { return false; } };
const publicResults = rows => (Array.isArray(rows) ? rows : []).slice(0, PLAYER_IMPORT_LIMITS.pageSize)
  .filter(row => validId(row?.userId) && actions.has(row?.action)).map(({ userId, action, reason, identitySource }) => ({ userId, action,
    ...(reasons.has(reason) ? { reason } : {}), ...(["saved_fields", "roblox_users_api"].includes(identitySource) ? { identitySource } : {}) }));
const terminalSkip = reason => !["profile_unavailable", "index_unavailable", "not_read_in_budget", "concurrent_index_change", "write_unavailable", "write_uncertain"].includes(reason);

export const createImportModeState = initialMode;

export function decodePlayerImportJob(snapshot, targetFingerprint) {
    if (!snapshot.exists) return { schemaVersion: 1, targetFingerprint, id: randomUUID(), modes: Object.fromEntries(modes.map(mode => [mode, initialMode()])),
      lease: null, paused: false, lastBatch: [], updatedAt: null };
    if (snapshot.value?.schemaVersion !== 1 || snapshot.value.targetFingerprint !== targetFingerprint
      || Buffer.byteLength(JSON.stringify(snapshot.value)) > 65536
      || !modes.every(mode => {
        const state = snapshot.value.modes?.[mode];
        return state && Array.isArray(state.pending) && state.pending.length <= PLAYER_IMPORT_LIMITS.pageSize && state.pending.every(validId)
          && Array.isArray(state.recentCursors) && state.recentCursors.length <= 32 && state.recentCursors.every(item => typeof item === "string" && /^[a-f0-9]{64}$/.test(item))
          && [state.cursor, state.nextCursor].every(item => typeof item === "string" && item.length <= 4096 && !/[\u0000-\u001f\u007f]/.test(item))
          && typeof state.done === "boolean" && typeof state.pageLoaded === "boolean"
          && ["pages", "observed", "rejectedKeys", "attempts", "created", "updated", "unchanged", "skipped", "failures"].every(key => Number.isSafeInteger(state[key]) && state[key] >= 0);
      })) throw fail("IMPORT_TARGET_CHANGED", "The checkpoint belongs to a different source configuration or needs review before resuming.");
    validateDailyImportState(snapshot.value.daily);
    return structuredClone(snapshot.value);
}

export function createPlayerImportService({ store, lister, reader, identities, secret, target, targetFingerprint, enabled = false, now = Date.now }) {
  if (typeof secret !== "string" || secret.length < 16) throw new Error("An importer signing secret is required.");
  const sign = text => createHmac("sha256", secret).update(`player-import-v1:${text}`).digest("base64url");
  const available = () => { if (!enabled) throw fail("IMPORT_DISABLED", "Player imports are disabled on this server.", 503); };
  const io = (operation, signal) => boundedOperation(operation, PLAYER_IMPORT_LIMITS.operationMs, signal);
  const job = snapshot => decodePlayerImportJob(snapshot, targetFingerprint);
  const busy = value => value.lease && value.lease.until > now();
  const view = value => ({ id: value.id, paused: value.paused, busy: !!busy(value), leaseExpiresAt: busy(value) ? new Date(value.lease.until).toISOString() : null,
    updatedAt: value.updatedAt, modes: Object.fromEntries(modes.map(mode => { const state = value.modes[mode]; return [mode, {
      done: state.done, pending: state.pending.length, pages: state.pages, observed: state.observed, rejectedKeys: state.rejectedKeys,
      attempts: state.attempts, created: state.created, updated: state.updated, unchanged: state.unchanged, skipped: state.skipped, failures: state.failures,
    }]; })), lastBatch: publicResults(value.lastBatch), run: projectImportRunStatus(value, now()), daily: projectDailyImportState(value, now()) });
  function open(token, actor) {
    if (typeof token !== "string" || token.length > PLAYER_IMPORT_LIMITS.tokenBytes) throw fail("INVALID_IMPORT_PREVIEW", "Create a new preview before applying.");
    const [text, signature, extra] = token.split(".");
    if (!text || !signature || extra || signature.length !== 43) throw fail("INVALID_IMPORT_PREVIEW", "Create a new preview before applying.");
    const received = Buffer.from(signature), expected = Buffer.from(sign(text));
    if (received.length !== expected.length || !timingSafeEqual(received, expected)) throw fail("INVALID_IMPORT_PREVIEW", "Create a new preview before applying.");
    let plan; try { plan = JSON.parse(Buffer.from(text, "base64url").toString("utf8")); } catch { throw fail("INVALID_IMPORT_PREVIEW", "Create a new preview before applying."); }
    if (plan.actor !== actor || plan.targetFingerprint !== targetFingerprint || plan.expiresAt <= now() || !modes.includes(plan.mode)
      || !Array.isArray(plan.rows) || plan.rows.length > PLAYER_IMPORT_LIMITS.pageSize) throw fail("INVALID_IMPORT_PREVIEW", "This preview is expired or belongs to a different operator. Create another.");
    return plan;
  }
  async function runWithinBudget(action, signal) {
    return boundedOperation(action, PLAYER_IMPORT_LIMITS.requestMs, signal);
  }
  return {
    async status(signal) {
      if (!enabled) return { enabled: false, target: null, coverage: "unknown", limits: PLAYER_IMPORT_LIMITS, progress: null };
      const current = job(await io(s => store.readJob(s), signal));
      return { enabled: true, target, coverage: "unknown", limits: PLAYER_IMPORT_LIMITS, progress: view(current),
        strategy: "Reviewed batches, the private CLI and the opt-in website daily worker share durable progress and one importer lease." };
    },
    async preview({ mode = "main", restart = false } = {}, actor, signal) {
      available();
      if (!modes.includes(mode) || typeof restart !== "boolean") throw fail("INVALID_IMPORT_REQUEST", "Choose Main or Battlefront.", 400);
      return runWithinBudget(async budgetSignal => {
        const previous = await io(s => store.readJob(s), budgetSignal), current = job(previous);
        if (busy(current)) throw fail("IMPORT_BUSY", "A batch is running. Refresh status or stop it before previewing another.");
        const state = restart ? initialMode() : structuredClone(current.modes[mode]);
        if (state.done) throw fail("IMPORT_MODE_COMPLETE", "This mode traversal ended. Select a new sweep to refresh it.");
        if (!state.pageLoaded) {
          if (state.recentCursors.includes(hash(state.cursor))) throw fail("IMPORT_CURSOR_LOOP", "Source pagination repeated an earlier page. Start a new sweep.", 503);
          let page;
          try { page = await io(s => lister.list(mode, { cursor: state.cursor, limit: PLAYER_IMPORT_LIMITS.pageSize, signal: s }), budgetSignal); }
          catch { throw fail("IMPORT_LIST_UNAVAILABLE", "Could not list profiles. Check objects:list permission, source availability, or start a new sweep if a cursor expired.", 503); }
          if (page.nextCursor && page.nextCursor === state.cursor) throw fail("IMPORT_CURSOR_LOOP", "Source pagination did not advance. Start a new sweep.", 503);
          state.pending = page.ids; state.nextCursor = page.nextCursor; state.pageLoaded = true;
          state.recentCursors = [...state.recentCursors, hash(state.cursor)].slice(-32);
          state.pages++; state.observed += page.observedKeys; state.rejectedKeys += page.rejectedKeys;
        }
        let names = {}, identityStatus = "not_needed";
        if (state.pending.length) {
          try { names = await io(s => identities.resolve(state.pending, { signal: s }), budgetSignal); identityStatus = "resolved_or_missing"; }
          catch { identityStatus = "unavailable_saved_names_preserved"; }
        }
        const rows = [];
        for (const userId of state.pending) {
          if (budgetSignal.aborted) { rows.push({ userId, action: "retry", reason: "not_read_in_budget" }); continue; }
          let entry, existing;
          try { entry = await io(s => reader.read(mode, userId, { signal: s }), budgetSignal); }
          catch { rows.push({ userId, action: "retry", reason: "profile_unavailable" }); continue; }
          if (entry === null) { rows.push({ userId, action: "skip", reason: "missing_profile" }); continue; }
          try { existing = await io(s => store.readSummary(mode, userId, s), budgetSignal); }
          catch { rows.push({ userId, action: "retry", reason: "index_unavailable" }); continue; }
          let resolved = names[userId];
          if (!resolved && existing.value?.identity?.source === "roblox_users_api") {
            resolved = { username: existing.value.identity.username, displayName: existing.value.identity.displayName,
              checkedAt: existing.value.importState?.identityCheckedAt };
          }
          let candidate;
          try {
            candidate = createSummaryImportCandidate(mode, userId, entry, now, resolved);
            if (candidate) validateSummaryImportCandidate(mode, userId, candidate, { allowOtherUsers: true, allowResolvedIdentity: true });
          } catch { rows.push({ userId, action: "retry", reason: "profile_unavailable" }); continue; }
          if (!candidate) { rows.push({ userId, action: "skip", reason: "empty_profile" }); continue; }
          const decision = compareSummaryImportSnapshot(candidate, existing, { allowResolvedIdentity: true });
          rows.push({ userId, action: decision.reason ? "skip" : decision.action, ...(decision.reason ? { reason: decision.reason } : {}),
            identitySource: candidate.identity.source, ...(decision.reason ? {} : { candidate }) });
        }
        const writable = rows.filter(row => ["create", "update"].includes(row.action)).length;
        const plan = { version: 1, actor, targetFingerprint, mode, restart, expectedVersion: previous.updateTime, id: current.id,
          state, rows, expiresAt: now() + PLAYER_IMPORT_LIMITS.previewMs };
        const text = Buffer.from(JSON.stringify(plan)).toString("base64url"), token = `${text}.${sign(text)}`;
        if (token.length > PLAYER_IMPORT_LIMITS.tokenBytes) throw fail("IMPORT_PREVIEW_TOO_LARGE", "The preview exceeded its safe size limit.", 503);
        return { token, mode, restart, target, rows: publicResults(rows), identityStatus, coverage: "unknown",
          expiresAt: new Date(plan.expiresAt).toISOString(), budget: {
            previewSummaryWrites: 0, previewCheckpointWrites: 0, maxSourceHttpAttempts: 3 * (1 + state.pending.length), maxIdentityRequests: state.pending.length ? 1 : 0,
            maxPreviewSummaryReads: state.pending.length, maxPreviewCheckpointReads: 1,
            maxApplySummaryReads: state.pending.length, maxApplySummaryWrites: writable, maxApplyCheckpointReads: rows.length * 3 + 3,
            maxApplyCheckpointWrites: rows.length + 2, requestSeconds: PLAYER_IMPORT_LIMITS.requestMs / 1000,
          } };
      }, signal);
    },
    async apply({ token, confirmation }, actor, signal) {
      available();
      if (confirmation !== "IMPORT SUMMARIES") throw fail("IMPORT_CONFIRMATION_REQUIRED", "Confirm the reviewed batch before applying.", 400);
      const plan = open(token, actor);
      return runWithinBudget(async budgetSignal => {
        let previous = await io(s => store.readJob(s), budgetSignal), current = job(previous);
        if (previous.updateTime !== plan.expectedVersion) throw fail("IMPORT_PREVIEW_CHANGED", "Progress changed after preview. Refresh and preview again.");
        if (busy(current)) throw fail("IMPORT_BUSY", "Another batch holds the importer lease.");
        if (previous.exists && current.id !== plan.id) throw fail("IMPORT_PREVIEW_CHANGED", "Create another preview.");
        const leaseId = randomUUID();
        current.id = plan.id; current.lease = { id: leaseId, until: now() + PLAYER_IMPORT_LIMITS.leaseMs }; current.paused = false;
        current.modes[plan.mode] = plan.state; current.lastBatch = [];
        const persist = async () => {
          current.updatedAt = new Date(now()).toISOString();
          const saved = await io(s => store.writeJob(current, previous, s), budgetSignal);
          if (saved.value?.lease?.id !== leaseId) throw fail("IMPORT_LEASE_LOST", "Batch stopped. Refresh progress before continuing.");
          previous = saved;
        };
        const guard = async () => {
          const latest = await io(s => store.readJob(s), budgetSignal);
          if (latest.updateTime !== previous.updateTime || latest.value?.lease?.id !== leaseId || latest.value.lease.until <= now()) {
            throw fail("IMPORT_LEASE_LOST", "Batch stopped. Refresh progress before continuing.");
          }
        };
        try { await persist(); }
        catch (error) { if (conflict(error)) throw fail("IMPORT_BUSY", "Another operator started first. Refresh status."); throw error; }
        const state = current.modes[plan.mode]; let uncertain = false;
        try {
          for (const row of plan.rows) {
            if (budgetSignal.aborted) break;
            // Check the durable lease and operator cancellation before each row.
            await guard();
            const result = { userId: row.userId, action: row.action, ...(row.reason ? { reason: row.reason } : {}) };
            if (row.candidate && ["create", "update", "unchanged"].includes(row.action)) {
              const existing = await io(s => store.readSummary(plan.mode, row.userId, s), budgetSignal);
              const decision = compareSummaryImportSnapshot(row.candidate, existing, { allowResolvedIdentity: true });
              if (decision.reason) { result.action = "skip"; result.reason = decision.reason; }
              else if (decision.action === "unchanged") result.action = "unchanged";
              else if (!["create", "update"].includes(row.action)) { result.action = "retry"; result.reason = "concurrent_index_change"; }
              else {
                // This guard observes cancellation, but a submitted write can
                // still finish after it. Summary CAS protects that document;
                // it is not an atomic transaction with the importer lease.
                await guard();
                try {
                  await io(s => store.writeSummary(plan.mode, row.userId, row.candidate, existing, s), budgetSignal);
                  result.action = decision.action === "create" ? "created" : "updated";
                } catch (error) {
                  result.action = "retry"; result.reason = conflict(error) ? "concurrent_index_change" : [400, 401, 403, 404].includes(error?.status) ? "write_unavailable" : "write_uncertain";
                  uncertain = result.reason === "write_uncertain";
                }
              }
            }
            if (uncertain) throw fail("IMPORT_INTERRUPTED", "Summary write acknowledgement was uncertain. Wait for the lease to expire before resuming.", 503);
            state.attempts++;
            const terminal = ["created", "updated", "unchanged"].includes(result.action) || (result.action === "skip" && terminalSkip(result.reason));
            if (terminal) { state.pending = state.pending.filter(id => id !== row.userId); if (result.action === "skip") state.skipped++; else state[result.action]++; }
            else state.failures++;
            current.lastBatch.push(result);
            // A crash after a summary write but before this checkpoint replays
            // that row. Summary fingerprints/CAS make the replay idempotent.
            await persist();
          }
          if (!state.pending.length) { state.cursor = state.nextCursor; state.pageLoaded = false; state.done = !state.nextCursor; }
          current.lease = null;
          current.updatedAt = new Date(now()).toISOString();
          previous = await io(s => store.writeJob(current, previous, s), budgetSignal);
          return { progress: view(previous.value), coverage: "unknown", uncertain };
        } catch (error) {
          // No blind cleanup write after a timeout/lost lease. Expiry permits a
          // safe retry; any uncertain row remains in the persisted pending page.
          if (error.code === "IMPORT_LEASE_LOST") throw error;
          throw fail("IMPORT_INTERRUPTED", "Batch interrupted. Refresh status; wait for any lease to expire, then preview remaining records.", 503);
        }
      }, signal);
    },
    async cancel(signal) {
      available();
      const previous = await io(s => store.readJob(s), signal);
      if (!previous.exists) return { stopped: true };
      const current = job(previous); current.lease = null; current.paused = true; current.updatedAt = new Date(now()).toISOString();
      try { await io(s => store.writeJob(current, previous, s), signal); }
      catch { throw fail("IMPORT_CANCEL_CHANGED", "Progress changed while stopping. Refresh status and try again."); }
      return { stopped: true, message: "Stop requested. A submitted summary write may finish; remaining checkpoints are preserved." };
    },
  };
}
