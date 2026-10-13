import { randomUUID, createHash } from "node:crypto";
import { boundedOperation, createSummaryImportCandidate, compareSummaryImportSnapshot, validateSummaryImportCandidate } from "./player-summary-import.mjs";
import { createImportModeState, decodePlayerImportJob, PLAYER_IMPORT_LIMITS } from "./player-import-service.mjs";
import { planDailyImport, reserveDailyImport, finishDailyImport } from "./player-import-schedule.mjs";

const modes = ["main", "battlefront"];
const digest = value => createHash("sha256").update(value).digest("hex");
const stop = reason => Object.assign(new Error("The approved import stopped."), { code: "IMPORT_RUN_STOPPED", reason });
const casConflict = error => ["FAILED_PRECONDITION", "ABORTED", "ALREADY_EXISTS"].includes(error?.code) || error?.status === 409;
const dateKey = (value, timeZone) => {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(value));
  return ["year", "month", "day"].map(key => parts.find(part => part.type === key).value).join("-");
};
const safeFailure = (entry, fingerprint) => entry?.schemaVersion === 1 && entry.targetFingerprint === fingerprint
  && modes.includes(entry.mode) && typeof entry.userId === "string" && /^[1-9]\d{0,15}$/.test(entry.userId)
  && BigInt(entry.userId) <= BigInt(Number.MAX_SAFE_INTEGER) && ["pending", "resolved"].includes(entry.status)
  && Number.isSafeInteger(entry.attempts) && entry.attempts >= 1;

// Private process entry point used by the bounded CLI and opt-in website worker.
export async function runPlayerImportSweep({ store, reader, lister, identities, target, targetFingerprint, budget,
  apply = false, intent = "resume", timeZone = "Australia/Sydney", resumePaused = false, daily = false, now = Date.now }) {
  if (typeof apply !== "boolean" || !["resume", "daily", "new"].includes(intent) || typeof timeZone !== "string" || timeZone.length > 64) throw stop("invalid_run");
  if (daily && (!apply || intent !== "daily" || timeZone !== "Australia/Sydney" || resumePaused)) throw stop("invalid_run");
  let today = dateKey(now(), timeZone);
  const invocationId = randomUUID();
  const results = { created: 0, updated: 0, unchanged: 0, skipped: 0, deferred: 0, retried: 0, listFailures: 0, duplicates: 0, wouldCreate: 0, wouldUpdate: 0 };
  const seen = new Map(), blocked = new Set(), consecutive = { main: 0, battlefront: 0 };
  let previous, current, checkpointConfirmed = apply ? false : null, acquired = false, newSweep = false, pendingRetries = null, reason = null, status = "partial_errors";
  let ownershipLost = false, writeUncertain = false;
  let nextRunAt = null;
  const io = operation => boundedOperation(operation, 8000, budget.signal);
  const iso = () => new Date(now()).toISOString();
  const summary = () => ({ ok: ["scan_complete", "scan_complete_with_retries", "scan_complete_retry_status_unknown", "paused_budget", "nothing_due", "waiting_retry"].includes(status) && (!apply || checkpointConfirmed),
    status, ...(reason ? { reason } : {}), writeMode: apply ? "apply" : "dry_run", scope: "main,battlefront", target,
    intent, checkpointConfirmed, action: newSweep ? "new_sweep" : "resume", sweepId: current?.sweep?.id ?? null, sweepDay: current?.sweep?.day ?? null,
    traversalEnded: current ? modes.every(mode => current.modes[mode].done) : false, pendingRetries, coverage: "unknown",
    ...(nextRunAt ? { nextRunAt } : {}),
    usage: budget.snapshot(), limits: budget.limits, results });
  async function persist() {
    if (!apply) return;
    if (ownershipLost) throw stop("lease_lost");
    if (writeUncertain) throw stop("checkpoint_write_uncertain");
    current.lease.until = now() + PLAYER_IMPORT_LIMITS.leaseMs;
    current.updatedAt = iso(); current.run.usage = budget.snapshot(); current.run.results = { ...results };
    let saved;
    try {
      saved = await io(signal => store.writeJob(current, previous, signal));
    } catch (error) {
      if (error?.code === "IMPORT_LEASE_LOST" || (acquired && casConflict(error))) {
        ownershipLost = true;
        throw stop("lease_lost");
      }
      if (!casConflict(error)) writeUncertain = true;
      throw error;
    }
    if (!saved.updateTime || saved.value?.lease?.id !== invocationId || saved.value?.run?.id !== invocationId) {
      ownershipLost = true;
      throw stop("lease_lost");
    }
    // Only an acknowledgement positively owned by this invocation becomes a
    // precondition. Never adopt a revision read from a cancellation/takeover.
    previous = saved;
  }
  async function guard() {
    if (!apply) { budget.ensureRoom(); return; }
    if (ownershipLost) throw stop("lease_lost");
    if (writeUncertain) throw stop("checkpoint_write_uncertain");
    const latest = await io(signal => store.readJob(signal));
    if (latest.updateTime !== previous.updateTime || latest.value?.lease?.id !== invocationId || latest.value.lease.until <= now()) {
      ownershipLost = true;
      throw stop("lease_lost");
    }
  }
  function checkStop(error) {
    if (budget.reason() || budget.signal.aborted) throw stop(budget.reason() ?? "cancelled");
    if (error?.code === "IMPORT_RUN_STOPPED") throw error;
  }
  async function namesFor(ids) {
    if (!ids.length) return {};
    try { budget.read(); return await io(signal => identities.resolve(ids, { signal })); }
    catch (error) { checkStop(error); return {}; }
  }
  async function failureSnapshot(mode, id) {
    const snapshot = await io(signal => store.readFailure(mode, id, signal));
    if (snapshot.exists && !safeFailure(snapshot.value, targetFingerprint)) throw stop("failure_ledger_invalid");
    return snapshot;
  }
  async function defer(mode, id, cause, snapshot) {
    results.deferred++;
    if (!apply) return;
    snapshot ??= await failureSnapshot(mode, id);
    const attempts = Math.min(1000000, (snapshot.exists ? snapshot.value.attempts : 0) + 1);
    const delay = Math.min(86400000, 60000 * 2 ** Math.min(11, attempts - 1));
    await guard();
    const metadata = { schemaVersion: 1, mode, userId: id, status: "pending", reason: cause, attempts,
      firstFailedAt: snapshot.value?.firstFailedAt ?? iso(), lastAttemptAt: iso(), nextAttemptAt: new Date(now() + delay).toISOString(), resolvedAt: null, targetFingerprint };
    try { await io(signal => store.writeFailure(metadata, snapshot, signal)); }
    catch (error) { writeUncertain = true; checkStop(error); throw stop("failure_ledger_unavailable"); }
  }
  async function resolveFailure(snapshot, cause) {
    if (!apply || !snapshot.exists || snapshot.value.status !== "pending") return;
    await guard();
    try { await io(signal => store.writeFailure({ ...snapshot.value, status: "resolved", reason: cause,
      lastAttemptAt: iso(), nextAttemptAt: null, resolvedAt: iso() }, snapshot, signal)); }
    catch (error) { writeUncertain = true; checkStop(error); throw stop("failure_resolution_uncertain"); }
  }
  async function processProfile(mode, id, names, retry = false) {
    const key = `${mode}:${id}`;
    if (seen.has(key)) { results.duplicates++; const prior = seen.get(key); return { ...prior, action: ["created", "updated"].includes(prior.action) ? "unchanged" : prior.action, duplicate: true }; }
    budget.ensureRoom({ profiles: 1, reads: 8, writes: apply ? 3 : 0, attempts: 16 });
    await guard(); budget.profile(); budget.read(); if (retry) results.retried++;
    let entry, failed;
    try { entry = await io(signal => reader.read(mode, id, { signal })); }
    catch (error) {
      checkStop(error); await defer(mode, id, "profile_unavailable");
      failed = true; entry = undefined;
    }
    let action = "retry", cause = "profile_unavailable";
    if (!failed) {
      const failure = await failureSnapshot(mode, id);
      if (entry === null) { action = "skip"; cause = "missing_profile"; await resolveFailure(failure, cause); }
      else {
        let existing;
        try { existing = await io(signal => store.readSummary(mode, id, signal)); }
        catch (error) { checkStop(error); await defer(mode, id, "index_unavailable", failure); failed = true; cause = "index_unavailable"; }
        if (!failed) {
          let identity = names[id];
          if (!identity && existing.value?.identity?.source === "roblox_users_api") identity = { username: existing.value.identity.username,
            displayName: existing.value.identity.displayName, checkedAt: existing.value.importState?.identityCheckedAt };
          let candidate;
          try {
            candidate = createSummaryImportCandidate(mode, id, entry, now, identity);
            if (candidate) validateSummaryImportCandidate(mode, id, candidate, { allowOtherUsers: true, allowResolvedIdentity: true });
          } catch (error) { checkStop(error); await defer(mode, id, "profile_unavailable", failure); failed = true; }
          if (!failed) {
            const decision = candidate ? compareSummaryImportSnapshot(candidate, existing, { allowResolvedIdentity: true }) : { reason: "empty_profile" };
            if (decision.reason) { action = "skip"; cause = decision.reason; await resolveFailure(failure, cause); }
            else if (decision.action === "unchanged") { action = "unchanged"; cause = "snapshot_unchanged"; await resolveFailure(failure, cause); }
            else if (!apply) { action = `would_${decision.action}`; cause = null; }
            else {
              await guard();
              try { await io(signal => store.writeSummary(mode, id, candidate, existing, signal)); }
              catch (error) {
                if (casConflict(error) || [400, 401, 403, 404].includes(error?.status)) {
                  checkStop(error);
                  cause = casConflict(error) ? "concurrent_index_change" : "write_unavailable";
                  await defer(mode, id, cause, failure); failed = true;
                } else {
                  writeUncertain = true;
                  checkStop(error);
                  throw stop("summary_write_uncertain");
                }
              }
              if (!failed) { action = decision.action === "create" ? "created" : "updated"; cause = null; await resolveFailure(failure, "snapshot_imported"); }
            }
          }
        }
      }
    }
    if (failed) consecutive[mode]++; else consecutive[mode] = 0;
    if (consecutive[mode] >= 3) blocked.add(mode);
    if (action === "created") results.created++; else if (action === "updated") results.updated++;
    else if (action === "would_create") results.wouldCreate++; else if (action === "would_update") results.wouldUpdate++;
    else if (action === "unchanged") results.unchanged++; else if (action === "skip") results.skipped++;
    const result = { userId: id, action: action.startsWith("would_") ? action.slice(6) : action, ...(cause ? { reason: cause } : {}) };
    seen.set(key, result); return result;
  }
  function recordModeResult(mode, row) {
    if (row.duplicate) return;
    const state = current.modes[mode]; state.attempts++;
    if (["created", "updated", "unchanged"].includes(row.action)) state[row.action]++;
    else if (["create", "update"].includes(row.action) && !apply) { /* Dry-run intentions are not completed writes or failures. */ }
    else if (row.action === "skip") state.skipped++; else state.failures++;
  }
  async function retryDue() {
    const cutoff = new Date(budget.startedAt).toISOString(); let attempted = 0;
    while (attempted < budget.limits.retryProfiles) {
      budget.ensureRoom({ reads: 5, attempts: 2 });
      let page;
      try { page = await io(signal => store.listFailures({ cutoff, limit: Math.min(5, budget.limits.retryProfiles - attempted), signal })); }
      catch (error) { checkStop(error); results.listFailures++; break; }
      if (!page.length) break;
      const eligible = page.filter(item => safeFailure(item.value, targetFingerprint)
        && item.path === `tePlayerImportFailures/${item.value.mode}:${item.value.userId}` && !seen.has(`${item.value.mode}:${item.value.userId}`) && !blocked.has(item.value.mode));
      if (!eligible.length) { results.listFailures++; break; }
      const names = await namesFor(eligible.map(item => item.value.userId).filter((id, index, values) => values.indexOf(id) === index));
      for (const item of eligible) {
        if (blocked.has(item.value.mode)) continue;
        const row = await processProfile(item.value.mode, item.value.userId, names, true); attempted++;
        recordModeResult(item.value.mode, row);
        current.lastBatch = [row]; await persist();
      }
    }
  }
  async function scan() {
    while (true) {
      const order = current.sweep.nextMode === "battlefront" ? ["battlefront", "main"] : modes;
      const mode = order.find(item => !current.modes[item].done && !blocked.has(item));
      if (!mode) break;
      budget.ensureRoom({ profiles: 1 });
      const state = current.modes[mode];
      if (!state.pageLoaded) {
        budget.ensureRoom({ reads: 3, writes: apply ? 1 : 0, attempts: 6 }); await guard();
        if (state.recentCursors.includes(digest(state.cursor))) { blocked.add(mode); results.listFailures++; continue; }
        let page;
        try { budget.read(); page = await io(signal => lister.list(mode, { cursor: state.cursor, limit: 5, signal })); }
        catch (error) { checkStop(error); blocked.add(mode); results.listFailures++; continue; }
        if (page.nextCursor && (page.nextCursor === state.cursor || state.recentCursors.includes(digest(page.nextCursor)))) { blocked.add(mode); results.listFailures++; continue; }
        state.pending = page.ids; state.nextCursor = page.nextCursor; state.pageLoaded = true;
        state.recentCursors = [...state.recentCursors, digest(state.cursor)].slice(-32); state.pages++; state.observed += page.observedKeys; state.rejectedKeys += page.rejectedKeys;
        await persist();
      }
      const names = await namesFor(state.pending);
      current.lastBatch = [];
      for (const id of [...state.pending]) {
        if (blocked.has(mode)) break;
        const row = await processProfile(mode, id, names); current.lastBatch.push(row);
        // A failed read advances only after durable retry metadata was confirmed.
        state.pending = state.pending.filter(value => value !== id); recordModeResult(mode, row);
        await persist();
      }
      if (!state.pending.length) { state.cursor = state.nextCursor; state.pageLoaded = false; state.done = !state.nextCursor; current.sweep.nextMode = mode === "main" ? "battlefront" : "main"; await persist(); }
    }
  }
  try {
    previous = await io(signal => store.readJob(signal)); current = decodePlayerImportJob(previous, targetFingerprint);
    if (current.lease?.until > now()) throw stop("busy");
    if (current.paused && !resumePaused) throw stop("operator_paused");
    if (daily) {
      const plan = planDailyImport(current, now());
      if (!plan.limits || plan.eligibleAt > now()) throw stop("nothing_due");
      today = plan.window.day;
      current.daily = reserveDailyImport(plan, budget.limits, invocationId, now());
    }
    const ended = modes.every(mode => current.modes[mode].done);
    if (intent === "new" && previous.exists && !ended) throw stop("unfinished_sweep");
    if (current.sweep?.timeZone && current.sweep.timeZone !== timeZone) throw stop("sweep_timezone_changed");
    newSweep = !previous.exists || (ended && (intent === "new" || (intent === "daily" && current.sweep?.day !== today)));
    if (newSweep) { current.id = randomUUID(); current.modes = Object.fromEntries(modes.map(mode => [mode, createImportModeState()])); }
    if (newSweep || !current.sweep) current.sweep = { id: current.id, day: today, timeZone, startedAt: iso(), nextMode: "main" };
    current.paused = false;
    if (apply) {
      current.lease = { id: invocationId, until: now() + PLAYER_IMPORT_LIMITS.leaseMs, kind: "runner" };
      current.run = { schemaVersion: 1, id: invocationId, source: daily ? "website_worker" : "private_cli", intent, status: "running", startedAt: iso(), finishedAt: null,
        limits: budget.limits, usage: budget.snapshot(), results: { ...results }, pendingRetries: null };
      try { await persist(); acquired = true; }
      catch (error) { if (casConflict(error)) throw stop("busy"); throw error; }
    }
    await retryDue(); await scan();
    status = modes.every(mode => current.modes[mode].done) ? "scan_complete_retry_status_unknown" : "partial_errors";
  } catch (error) {
    reason = ownershipLost ? "lease_lost" : budget.reason() ?? (error.code === "IMPORT_RUN_STOPPED" ? error.reason : "provider_unavailable");
    status = reason.endsWith("_budget") ? "paused_budget" : ["cancelled", "lease_lost", "busy", "operator_paused", "nothing_due"].includes(reason) ? reason : "partial_errors";
  } finally {
    if (current && ((!apply && !["busy", "operator_paused", "partial_errors"].includes(status))
      || (acquired && !ownershipLost && !writeUncertain))) {
      try {
        await budget.close(async () => {
          const remaining = Math.min(8000, budget.deadline - now());
          if (remaining <= 0) throw stop("time_budget");
          const failures = await boundedOperation(signal => store.listFailures({ limit: 1, signal }), remaining);
          pendingRetries = failures.length > 0;
          if (status === "scan_complete_retry_status_unknown") status = pendingRetries ? "scan_complete_with_retries" : "scan_complete";
          if (apply) {
            current.lease = null; current.run.status = status; current.run.finishedAt = iso(); current.run.pendingRetries = pendingRetries;
            current.run.usage = budget.snapshot(); current.run.results = { ...results }; current.updatedAt = iso();
            if (daily) {
              current.daily = finishDailyImport(current.daily, { usage: budget.snapshot(), retried: results.retried,
                status, pendingRetryAt: failures[0]?.value?.nextAttemptAt, now: now() });
            }
            const saved = await boundedOperation(signal => store.writeJob(current, previous, signal), Math.min(8000, budget.deadline - now()));
            checkpointConfirmed = saved.value?.run?.id === invocationId && saved.value.run.status === status && saved.value.lease === null;
            if (daily && checkpointConfirmed) nextRunAt = new Date(planDailyImport(saved.value, now()).eligibleAt).toISOString();
          }
        });
      } catch (error) {
        // Finalization also uses the last owned CAS revision. An uncertain
        // response is never retried or promoted to a newer writer's revision.
        if (casConflict(error) || error?.code === "IMPORT_LEASE_LOST") {
          ownershipLost = true;
          status = "lease_lost";
          reason = "lease_lost";
        }
      }
    }
  }
  return summary();
}
