import { summaryImportPath, validateSummaryImportCandidate } from "./player-summary-import.mjs";

export function createFirestoreSummaryImportStore(db, { writeEnabled = false } = {}) {
  return {
    async read(mode, userId, { signal } = {}) {
      const snapshot = await db.doc(summaryImportPath(mode, userId)).get({ signal });
      return { exists: snapshot.exists, value: snapshot.exists ? snapshot.data() : null, updateTime: snapshot.updateTime?.toISOString() ?? null };
    },
    async upsert(mode, userId, candidate, previous, { signal } = {}) {
      if (writeEnabled !== true) throw Object.assign(new Error("Explicit importer write mode is required."), { code: "IMPORT_APPLY_REQUIRED" });
      validateSummaryImportCandidate(mode, userId, candidate);
      if (typeof previous?.exists !== "boolean" || (previous.exists && typeof previous.updateTime !== "string")) throw new Error("Invalid summary precondition.");
      const precondition = previous.exists ? { updateTime: previous.updateTime } : { exists: false };
      signal?.throwIfAborted();
      // Merge only canonical summary fields; preserve unrelated root fields.
      // The atomic precondition protects any edits after our document read.
      await db.doc(summaryImportPath(mode, userId)).set(candidate, { merge: true, precondition, signal });
    },
  };
}
