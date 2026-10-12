import { GAME_DATA_SORTS } from "./game-data-config.mjs";
import { gameDataError, validatePlayerId } from "./game-data-domain.mjs";

export function createUnavailableProfileReader() {
  return { read: async () => { throw gameDataError(503, "READER_NOT_CONNECTED", "The read-only profile connection has not been verified."); } };
}

// The transport is deliberately injected: live Open Cloud response/resource mapping
// must be verified before wiring it. This boundary has no save/update/delete methods.
export function createSavedEntryReader(readSavedEntry) {
  if (typeof readSavedEntry !== "function") throw new Error("A read-only saved-entry transport is required.");
  return { read: (mode, userId, options) => {
    validatePlayerId(userId);
    if (!["main", "battlefront"].includes(mode)) throw gameDataError(400, "INVALID_MODE", "Invalid profile mode.");
    return readSavedEntry({ mode, userId, signal: options.signal });
  } };
}

function safeIndexedSummary(value, mode) {
  validatePlayerId(value.userId);
  if (value.mode !== mode || value.schemaVersion !== 1) throw new Error("Unsupported summary index schema");
  const numeric = key => typeof value.stats?.[key] === "number" && Number.isFinite(value.stats[key]) && value.stats[key] >= 0 ? value.stats[key] : null;
  const bounded = item => typeof item === "string" ? item.slice(0, 64) : null;
  return {
    schemaVersion: 1, mode, userId: value.userId,
    identity: { username: bounded(value.identity?.username), displayName: bounded(value.identity?.displayName), usernameFolded: bounded(value.identity?.usernameFolded), displayNameFolded: bounded(value.identity?.displayNameFolded), source: "saved_fields" },
    stats: { level: numeric("level"), gamesPlayed: numeric("gamesPlayed"), rankedISR: mode === "main" ? numeric("rankedISR") : null },
    lastJoinedDate: /^\d{4}-\d{2}-\d{2}$/.test(value.lastJoinedDate ?? "") ? value.lastJoinedDate : null,
    source: { updatedAt: bounded(value.source?.updatedAt), checkedAt: bounded(value.source?.checkedAt) },
  };
}

export function createFirestoreSummaryIndex(db) {
  return { async list(filters, page) {
    try {
      const field = GAME_DATA_SORTS[filters.sort];
      let query = db.collection("tePlayerSummaries").where("mode", "==", filters.mode);
      if (filters.search) query = query.where(field, ">=", filters.search).where(field, "<", `${filters.search}\uf8ff`);
      if (filters.minLevel !== null) query = query.where("stats.level", ">=", filters.minLevel);
      query = query.orderBy(field, filters.order).orderBy("__name__", filters.order)
        .select("schemaVersion", "mode", "userId", "identity", "stats.level", "stats.gamesPlayed", "stats.rankedISR", "lastJoinedDate", "source.updatedAt", "source.checkedAt")
        .limit(filters.limit + 1).atReadTime(page.snapshotAt);
      if (page.after) query = query.startAfter(...page.after.map((value, index) => index === 1 ? `tePlayerSummaries/${value}` : value));
      const result = await query.get();
      return { items: result.docs.map(document => safeIndexedSummary(document.data(), filters.mode)), coverage: { status: "unknown", indexedRecords: null, description: "Index completeness has not been verified. Exact UserId lookup reads the saved record separately." } };
    } catch {
      throw gameDataError(503, "INDEX_UNAVAILABLE", "The player index is unavailable. You can still try an exact UserId lookup.");
    }
  } };
}
