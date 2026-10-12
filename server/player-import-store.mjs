import { validateSummaryImportCandidate } from "./player-summary-import.mjs";
import { validatePlayerId } from "./game-data-domain.mjs";

export const PLAYER_IMPORT_JOB_PATH = "tePlayerImportJobs/current";
export const PLAYER_IMPORT_FAILURE_COLLECTION = "tePlayerImportFailures";
const snapshotValue = snapshot => ({ exists: snapshot.exists, value: snapshot.exists ? snapshot.data() : null, updateTime: snapshot.updateTime?.toISOString() ?? null });
const condition = previous => previous.exists ? { updateTime: previous.updateTime } : { exists: false };
const summaryPath = (mode, id) => {
  validatePlayerId(id);
  if (!["main", "battlefront"].includes(mode)) throw new Error("Invalid summary mode.");
  return `tePlayerSummaries/${mode}:${id}`;
};

export function createPlayerImportStore(db, { budget } = {}) {
  return {
    async readJob(signal) { return snapshotValue(await db.doc(PLAYER_IMPORT_JOB_PATH).get({ signal, budget })); },
    async writeJob(value, previous, signal) {
      // CAS is applied to the whole checkpoint: a lost lease cannot advance it.
      budget?.ensureRoom({ writes: 1, reads: 1, attempts: 3 });
      await db.doc(PLAYER_IMPORT_JOB_PATH).set(value, { precondition: condition(previous), signal, budget });
      return snapshotValue(await db.doc(PLAYER_IMPORT_JOB_PATH).get({ signal, budget }));
    },
    async readSummary(mode, id, signal) { return snapshotValue(await db.doc(summaryPath(mode, id)).get({ signal, budget })); },
    async writeSummary(mode, id, candidate, previous, signal) {
      validateSummaryImportCandidate(mode, id, candidate, { allowOtherUsers: true, allowResolvedIdentity: true });
      await db.doc(summaryPath(mode, id)).set(candidate, { merge: true, precondition: condition(previous), signal, budget });
    },
    async readFailure(mode, id, signal) { summaryPath(mode, id); return snapshotValue(await db.doc(`${PLAYER_IMPORT_FAILURE_COLLECTION}/${mode}:${id}`).get({ signal, budget })); },
    async writeFailure(value, previous, signal) {
      summaryPath(value.mode, value.userId);
      const fields = ["schemaVersion", "mode", "userId", "status", "reason", "attempts", "firstFailedAt", "lastAttemptAt", "nextAttemptAt", "resolvedAt", "targetFingerprint"];
      if (value.schemaVersion !== 1 || Object.keys(value).length !== fields.length || fields.some(field => !Object.hasOwn(value, field))
        || !["pending", "resolved"].includes(value.status) || !Number.isSafeInteger(value.attempts) || value.attempts < 1
        || !/^[a-z_]{1,64}$/.test(value.reason) || typeof value.targetFingerprint !== "string" || value.targetFingerprint.length > 128
        || ["firstFailedAt", "lastAttemptAt", "nextAttemptAt", "resolvedAt"].some(field => value[field] !== null && (typeof value[field] !== "string"
          || !Number.isFinite(Date.parse(value[field])) || new Date(value[field]).toISOString() !== value[field]))) throw new Error("Invalid import retry metadata.");
      await db.doc(`${PLAYER_IMPORT_FAILURE_COLLECTION}/${value.mode}:${value.userId}`).set(value, { precondition: condition(previous), signal, budget });
    },
    async listFailures({ cutoff = null, limit = 5, signal } = {}) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 5) throw new Error("Invalid retry page size.");
      let query = db.collection(PLAYER_IMPORT_FAILURE_COLLECTION).where("nextAttemptAt", ">=", "1970-01-01T00:00:00.000Z");
      if (cutoff) query = query.where("nextAttemptAt", "<=", cutoff);
      const snapshot = await query.orderBy("nextAttemptAt", "asc").orderBy("__name__", "asc").limit(limit).get({ signal, budget });
      return snapshot.docs.map(document => ({ path: document.ref.path, ...snapshotValue(document) }));
    },
  };
}
