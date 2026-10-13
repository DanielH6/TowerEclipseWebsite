import { readFileSync, writeFileSync, renameSync } from "node:fs";
import { createPlayerImportFixtures } from "./player-import-fixtures.mjs";
import { createPlayerImportStore, PLAYER_IMPORT_JOB_PATH } from "../player-import-store.mjs";
import { createPlayerImportService } from "../player-import-service.mjs";
export { Timestamp } from "../firestore-timestamp.mjs";

const file = process.env.TE_FIXTURE_RECORDS;
const fixture = createPlayerImportFixtures({ count: 3 });
let priorReads = [], priorWrites = [];
try {
  const saved = JSON.parse(readFileSync(file, "utf8"));
  for (const [key, value] of saved.records) fixture.records.set(key, value);
  priorReads = saved.reads;
  priorWrites = saved.writes;
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
function persist() {
  writeFileSync(`${file}.next`, JSON.stringify({ records: [...fixture.records],
    reads: [...priorReads, ...fixture.reads], writes: [...priorWrites, ...fixture.writes] }));
  renameSync(`${file}.next`, file);
}
fixture.hooks.afterSet = async (name, value) => {
  persist();
  if (name === PLAYER_IMPORT_JOB_PATH && value.run?.status === "scan_complete") {
    process.send?.({ event: "scan_complete" });
  }
};
const base = fixture.db;
export const db = {
  doc(name) {
    const reference = base.doc(name);
    return {
      ...reference,
      async get(options) {
        const value = await reference.get(options);
        persist();
        return value;
      },
    };
  },
  collection(name) {
    const query = base.collection(name);
    query.doc = id => db.doc(`${name}/${id}`);
    for (const method of ["select", "startAfter", "atReadTime"]) query[method] = () => query;
    return query;
  },
};
export class FieldValue {
  static serverTimestamp() { return new Date(Date.now()).toISOString(); }
  static increment(value) { return value; }
}
export const firestoreMaintenance = {};

export function createConfiguredPlayerImport({ secret, environment = process.env }) {
  return createPlayerImportService({ ...fixture.dependencies, secret,
    enabled: environment.TE_DATA_IMPORT_ENABLED === "true" });
}
export function createPlayerImportDependencies({ budget }) {
  return { ...fixture.dependencies, store: createPlayerImportStore(db, { budget }),
    reader: { async read(mode, id, { signal }) {
      process.send?.({ event: "profile_read" });
      if (process.env.TE_FIXTURE_HOLD_READ === "true") {
        await new Promise(resolve => {
          if (signal.aborted) resolve();
          else signal.addEventListener("abort", resolve, { once: true });
        });
        signal.throwIfAborted();
      }
      return fixture.reader.read(mode, id, { signal });
    } } };
}
