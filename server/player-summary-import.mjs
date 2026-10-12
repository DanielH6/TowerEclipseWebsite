import { createHash } from "node:crypto";
import { GAME_DATA_STORES } from "./game-data-config.mjs";
import { decodeSavedProfile, foldIdentity, projectPlayerSummary, validatePlayerId } from "./game-data-domain.mjs";

export const SUMMARY_IMPORT_OWNER = "404731089";
export const SUMMARY_IMPORT_MODES = Object.freeze(["main", "battlefront"]);
const summaryFields = ["schemaVersion", "mode", "userId", "identity", "stats", "firstJoinedDate", "lastJoinedDate", "source", "missingFields"];
const digest = text => createHash("sha256").update(text).digest("hex");
const hashPattern = /^[a-f0-9]{64}$/;
const failure = code => Object.assign(new Error("The targeted summary import could not complete."), { code });
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const timestamp = value => typeof value === "string" && value.length <= 64 && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(value) && Number.isFinite(Date.parse(value));

export function validateSummaryImportTarget(userId) {
  validatePlayerId(userId);
  if (userId !== SUMMARY_IMPORT_OWNER) throw failure("IMPORT_TARGET_NOT_ALLOWED");
  return userId;
}

export function summaryImportPath(mode, userId) {
  validateSummaryImportTarget(userId);
  if (!SUMMARY_IMPORT_MODES.includes(mode)) throw failure("INVALID_IMPORT_MODE");
  return `tePlayerSummaries/${mode}:${userId}`;
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (object(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function summaryDigest(summary, revisionHash, { ignoreIdentity = false } = {}) {
  const stable = { ...summary, source: { ...summary.source } };
  delete stable.source.checkedAt;
  if (ignoreIdentity) delete stable.identity;
  return digest(stableJson({ summary: stable, revisionHash }));
}

export function createSummaryImportCandidate(mode, userId, entry, now, resolvedIdentity = null) {
  validatePlayerId(userId);
  if (!SUMMARY_IMPORT_MODES.includes(mode)) throw failure("INVALID_IMPORT_MODE");
  if (entry.revision !== undefined && entry.revision !== null
    && (typeof entry.revision !== "string" || !entry.revision.length || entry.revision.length > 256 || /[\u0000-\u001f\u007f]/.test(entry.revision))) throw failure("INVALID_SOURCE_METADATA");
  if (entry.updatedAt !== undefined && entry.updatedAt !== null && !timestamp(entry.updatedAt)) throw failure("INVALID_SOURCE_METADATA");
  const { summary } = decodeSavedProfile(mode, userId, { ...entry, checkedAt: new Date(now()).toISOString() });
  if (Object.values(summary.stats).every(value => value === null)) return null;
  if (resolvedIdentity) summary.identity = { username: resolvedIdentity.username, displayName: resolvedIdentity.displayName,
    usernameFolded: foldIdentity(resolvedIdentity.username), displayNameFolded: foldIdentity(resolvedIdentity.displayName), source: "roblox_users_api" };
  const revisionHash = typeof entry.revision === "string" ? digest(entry.revision) : null;
  const payload = { ...summary, indexedAt: new Date(now()).toISOString(),
    importState: { schemaVersion: 1, revisionHash, projectionHash: summaryDigest(summary, revisionHash),
      ...(resolvedIdentity ? { identityCheckedAt: resolvedIdentity.checkedAt } : {}) } };
  if (Buffer.byteLength(JSON.stringify(payload)) > 32768) throw failure("SUMMARY_TOO_LARGE");
  return payload;
}

function exactKeys(value, template) {
  return object(value) && Object.keys(value).length === Object.keys(template).length
    && Object.keys(template).every(key => Object.hasOwn(value, key));
}

// A second allowlist at the write boundary prevents callers from passing an
// envelope or arbitrary fields even if they bypass the import orchestrator.
export function validateSummaryImportCandidate(mode, userId, value, { allowOtherUsers = false, allowResolvedIdentity = false } = {}) {
  if (allowOtherUsers) { validatePlayerId(userId); if (!SUMMARY_IMPORT_MODES.includes(mode)) throw failure("INVALID_IMPORT_MODE"); }
  else summaryImportPath(mode, userId);
  const template = projectPlayerSummary(mode, userId, {});
  const boundedText = item => item === null || (typeof item === "string" && item.length <= 64 && !/[\u0000-\u001f\u007f]/.test(item));
  const date = item => item === null || (typeof item === "string" && /^\d{4}-\d\d-\d\d$/.test(item)
    && Number.isFinite(Date.parse(item)) && new Date(item).toISOString().slice(0, 10) === item);
  const iso = item => timestamp(item) && new Date(item).toISOString() === item;
  if (!exactKeys(value, { ...template, indexedAt: null, importState: null }) || value.schemaVersion !== 1 || value.mode !== mode || value.userId !== userId
    || !exactKeys(value.identity, template.identity) || !["saved_fields", ...(allowResolvedIdentity ? ["roblox_users_api"] : [])].includes(value.identity.source)
    || !boundedText(value.identity.username) || !boundedText(value.identity.displayName)
    || value.identity.usernameFolded !== foldIdentity(value.identity.username) || value.identity.displayNameFolded !== foldIdentity(value.identity.displayName)
    || !exactKeys(value.stats, template.stats) || !Object.values(value.stats).every(item => item === null || (typeof item === "number" && Number.isFinite(item) && item >= 0 && item <= Number.MAX_SAFE_INTEGER))
    || Object.values(value.stats).every(item => item === null)
    || !date(value.firstJoinedDate) || !date(value.lastJoinedDate)
    || !exactKeys(value.source, template.source) || value.source.storeName !== GAME_DATA_STORES[mode].name || value.source.scope !== "global" || value.source.key !== userId
    || !boundedText(value.source.revision) || (value.source.updatedAt !== null && !iso(value.source.updatedAt)) || !iso(value.source.checkedAt) || !iso(value.indexedAt)
    || !Array.isArray(value.missingFields) || stableJson(value.missingFields) !== stableJson(Object.keys(value.stats).filter(key => value.stats[key] === null))
    || !exactKeys(value.importState, { schemaVersion: null, revisionHash: null, projectionHash: null,
      ...(value.identity.source === "roblox_users_api" ? { identityCheckedAt: null } : {}) }) || value.importState.schemaVersion !== 1
    || (value.identity.source === "roblox_users_api" && !iso(value.importState.identityCheckedAt))
    || (value.importState.revisionHash !== null && (typeof value.importState.revisionHash !== "string" || !hashPattern.test(value.importState.revisionHash)))
    || typeof value.importState.projectionHash !== "string" || !hashPattern.test(value.importState.projectionHash)
    || Buffer.byteLength(JSON.stringify(value)) > 32768) throw failure("INVALID_IMPORT_SUMMARY");
  const summary = Object.fromEntries(summaryFields.map(field => [field, value[field]]));
  if (summaryDigest(summary, value.importState.revisionHash) !== value.importState.projectionHash) throw failure("INVALID_IMPORT_SUMMARY");
}

export function compareSummaryImportSnapshot(candidate, existing, { allowResolvedIdentity = false } = {}) {
  if (!object(existing) || typeof existing.exists !== "boolean") return { reason: "invalid_index_response" };
  if (!existing.exists) return { action: "create" };
  const value = existing.value;
  if (!object(value) || value.schemaVersion !== 1 || value.mode !== candidate.mode || value.userId !== candidate.userId) return { reason: "invalid_existing_summary" };
  if (value.identity?.verified === true || !["saved_fields", ...(allowResolvedIdentity ? ["roblox_users_api"] : [])].includes(value.identity?.source)) return { reason: "protected_identity_source" };
  if (value.importState?.schemaVersion !== 1 || !hashPattern.test(value.importState.projectionHash ?? "")
    || (value.importState.revisionHash !== null && !hashPattern.test(value.importState.revisionHash ?? ""))) return { reason: "unmanaged_existing_summary" };
  const template = projectPlayerSummary(candidate.mode, candidate.userId, {});
  if (!summaryFields.every(field => Object.hasOwn(value, field)) || !exactKeys(value.identity, template.identity)
    || !exactKeys(value.stats, template.stats) || !exactKeys(value.source, template.source)
    || value.source.storeName !== GAME_DATA_STORES[candidate.mode].name || value.source.scope !== "global" || value.source.key !== candidate.userId
    || Buffer.byteLength(JSON.stringify(value)) > 32768) return { reason: "conflicting_index_edits" };
  const current = Object.fromEntries(summaryFields.map(field => [field, value[field]]));
  if (summaryDigest(current, value.importState.revisionHash) !== value.importState.projectionHash) return { reason: "conflicting_index_edits" };
  if (candidate.importState.projectionHash === value.importState.projectionHash) return { action: "unchanged" };
  const nextSummary = Object.fromEntries(summaryFields.map(field => [field, candidate[field]]));
  const sameProfile = summaryDigest(current, value.importState.revisionHash, { ignoreIdentity: true })
    === summaryDigest(nextSummary, candidate.importState.revisionHash, { ignoreIdentity: true });
  if (sameProfile && allowResolvedIdentity && candidate.identity.source === "roblox_users_api"
    && (value.identity.source === "saved_fields" || (timestamp(value.importState.identityCheckedAt)
      && Date.parse(candidate.importState.identityCheckedAt) > Date.parse(value.importState.identityCheckedAt)))) {
    return timestamp(existing.updateTime) ? { action: "update" } : { reason: "missing_write_precondition" };
  }
  const previousTime = value.source.updatedAt, nextTime = candidate.source.updatedAt;
  const previousRevision = value.importState.revisionHash, nextRevision = candidate.importState.revisionHash;
  if (previousRevision !== null && previousRevision === nextRevision) return { reason: "conflicting_snapshot" };
  if (!timestamp(previousTime) || !timestamp(nextTime) || (previousRevision !== null && nextRevision === null)) return { reason: "freshness_unverifiable" };
  if (Date.parse(nextTime) < Date.parse(previousTime)) return { reason: "stale_snapshot" };
  if (Date.parse(nextTime) === Date.parse(previousTime)) return { reason: "conflicting_snapshot" };
  if (!timestamp(existing.updateTime)) return { reason: "missing_write_precondition" };
  return { action: "update" };
}

export async function boundedOperation(operation, timeoutMs, parentSignal) {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  parentSignal?.addEventListener("abort", cancel, { once: true });
  if (parentSignal?.aborted) cancel();
  let rejectAbort;
  const aborted = new Promise((_, reject) => { rejectAbort = () => reject(failure("IMPORT_TIMEOUT_OR_CANCELLED")); });
  controller.signal.addEventListener("abort", rejectAbort, { once: true });
  const timer = setTimeout(cancel, timeoutMs);
  try {
    if (controller.signal.aborted) throw failure("IMPORT_TIMEOUT_OR_CANCELLED");
    return await Promise.race([Promise.resolve().then(() => {
      if (controller.signal.aborted) throw failure("IMPORT_TIMEOUT_OR_CANCELLED");
      return operation(controller.signal);
    }), aborted]);
  } finally {
    clearTimeout(timer); controller.signal.removeEventListener("abort", rejectAbort);
    parentSignal?.removeEventListener("abort", cancel);
  }
}

export async function importOwnerSummaries({ userId, reader, store, apply = false, now = Date.now, timeoutMs = 10000, signal }) {
  validateSummaryImportTarget(userId);
  if (typeof apply !== "boolean" || reader?.synthetic === true || typeof reader?.read !== "function" || typeof store?.read !== "function"
    || (apply && typeof store?.upsert !== "function") || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10000) throw failure("INVALID_IMPORT_CONFIGURATION");
  const results = [];
  for (const mode of SUMMARY_IMPORT_MODES) {
    if (signal?.aborted) { results.push({ mode, status: "skipped", reason: "cancelled" }); continue; }
    let phase = "profile";
    try {
      const entry = await boundedOperation(requestSignal => reader.read(mode, userId, { signal: requestSignal }), timeoutMs, signal);
      if (entry === null) { results.push({ mode, status: "skipped", reason: "missing_profile" }); continue; }
      const candidate = createSummaryImportCandidate(mode, userId, entry, now);
      if (!candidate) { results.push({ mode, status: "skipped", reason: "empty_profile" }); continue; }
      phase = "index";
      const existing = await boundedOperation(requestSignal => store.read(mode, userId, { signal: requestSignal }), timeoutMs, signal);
      const decision = compareSummaryImportSnapshot(candidate, existing);
      if (decision.reason) { results.push({ mode, status: "skipped", reason: decision.reason }); continue; }
      if (decision.action === "unchanged") { results.push({ mode, status: "unchanged" }); continue; }
      if (!apply) { results.push({ mode, status: `would_${decision.action}`, usernamePresent: candidate.identity.username !== null,
        saveTimestampKnown: candidate.source.updatedAt !== null, revisionKnown: candidate.importState.revisionHash !== null }); continue; }
      phase = "write";
      await boundedOperation(requestSignal => store.upsert(mode, userId, candidate, existing, { signal: requestSignal }), timeoutMs, signal);
      results.push({ mode, status: decision.action === "create" ? "created" : "updated" });
    } catch (error) {
      const conflict = phase === "write" && (["FAILED_PRECONDITION", "ABORTED", "ALREADY_EXISTS"].includes(error?.code) || error?.status === 409);
      const uncertain = phase === "write" && !conflict && ![400, 401, 403, 404].includes(error?.status);
      results.push({ mode, status: uncertain ? "write_uncertain" : "skipped", reason: conflict ? "concurrent_index_change" : uncertain ? "verify_with_dry_run"
        : phase === "profile" ? "profile_unavailable" : phase === "index" ? "index_unavailable" : "write_unavailable" });
      if (uncertain) {
        for (const remaining of SUMMARY_IMPORT_MODES.slice(results.length)) results.push({ mode: remaining, status: "skipped", reason: "prior_write_uncertain" });
        break;
      }
    }
  }
  const successful = new Set(["would_create", "would_update", "created", "updated", "unchanged"]);
  return { ok: results.every(result => successful.has(result.status)), userId, writeMode: apply ? "apply" : "dry_run", coverage: "unknown", scope: "single_owner", results };
}
