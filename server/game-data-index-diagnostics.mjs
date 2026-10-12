import { GAME_DATA_SORTS } from "./game-data-config.mjs";

const rpcCodes = ["OK", "CANCELLED", "UNKNOWN", "INVALID_ARGUMENT", "DEADLINE_EXCEEDED", "NOT_FOUND", "ALREADY_EXISTS", "PERMISSION_DENIED", "RESOURCE_EXHAUSTED", "FAILED_PRECONDITION", "ABORTED", "OUT_OF_RANGE", "UNIMPLEMENTED", "INTERNAL", "UNAVAILABLE", "DATA_LOSS", "UNAUTHENTICATED"];

export function classifyPlayerIndexFailure(failure, phase) {
  if (phase === "records") return { kind: "invalid_index_record", rpcCode: null, httpStatus: null };
  const rpcCode = typeof failure?.code === "string" && rpcCodes.includes(failure.code) ? failure.code
    : Number.isInteger(failure?.code) && failure.code >= 0 && failure.code < rpcCodes.length ? rpcCodes[failure.code] : null;
  const httpStatus = Number.isInteger(failure?.status) && failure.status >= 100 && failure.status <= 599 ? failure.status : null;
  // Inspect known phrases only to select a fixed label. Never return, attach or
  // print the message, cause, stack, details, URLs or the original error object.
  const message = typeof failure?.message === "string" ? failure.message.slice(0, 2048).toLowerCase() : "";
  let kind = "adapter_or_provider_failure";
  if (/^could not obtain google access token \(/.test(message) || rpcCode === "UNAUTHENTICATED" || httpStatus === 401) kind = "authentication";
  else if (rpcCode === "UNIMPLEMENTED" || /cloud firestore api.*(?:disabled|has not been used)|not supported.*(?:database|datastore) mode|datastore mode.*not supported/.test(message)) kind = "provider_configuration";
  else if (rpcCode === "PERMISSION_DENIED" || httpStatus === 403) kind = "permission_denied";
  else if (rpcCode === "NOT_FOUND" || httpStatus === 404) kind = "database_or_project_not_found";
  else if (rpcCode === "FAILED_PRECONDITION") kind = /query requires an index|requires a composite index/.test(message) ? "missing_index" : "query_precondition";
  else if (rpcCode === "INVALID_ARGUMENT" || httpStatus === 400) kind = /readtime|read_time|read time/.test(message) ? "snapshot_time_invalid" : "query_argument_invalid";
  else if (rpcCode === "RESOURCE_EXHAUSTED" || httpStatus === 429) kind = "provider_rate_limit";
  else if (rpcCode === "DEADLINE_EXCEEDED") kind = "provider_timeout";
  else if (["UNAVAILABLE", "INTERNAL", "DATA_LOSS"].includes(rpcCode) || httpStatus >= 500) kind = "provider_unavailable";
  return { kind, rpcCode, httpStatus };
}

export function createPlayerIndexReporter({ log = event => console.warn(`[player-data-index] ${JSON.stringify(event)}`), now = Date.now } = {}) {
  const reported = new Map();
  return (failure, phase, filters, page) => {
    try {
      const event = {
        event: "player_summary_index_failure", phase: phase === "records" ? "records" : "query",
        ...classifyPlayerIndexFailure(failure, phase),
        mode: ["main", "battlefront"].includes(filters?.mode) ? filters.mode : "unknown",
        sort: Object.hasOwn(GAME_DATA_SORTS, filters?.sort ?? "") ? filters.sort : "unknown",
        order: ["asc", "desc"].includes(filters?.order) ? filters.order : "unknown",
        hasSearch: typeof filters?.search === "string" && filters.search.length > 0,
        hasMinLevel: Number.isFinite(filters?.minLevel), hasCursor: Array.isArray(page?.after),
      };
      const key = JSON.stringify([event.kind, event.mode, event.sort, event.order]);
      const time = now(), previous = reported.get(key);
      if (previous !== undefined && time >= previous && time - previous < 60000) return;
      // Bounded diagnostic state and at most one line per shape/kind per minute.
      if (!reported.has(key) && reported.size >= 128) reported.delete(reported.keys().next().value);
      reported.set(key, time);
      log(event);
    } catch {
      // Diagnostics must never alter the sanitized API failure or leak a logger
      // exception. This also handles unusual errors with throwing properties.
    }
  };
}
