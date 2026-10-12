import { createPlayerImportStore } from "../player-import-store.mjs";
import { createPlayerImportService } from "../player-import-service.mjs";

// Isolated in-memory test/preview infrastructure. Never imported by production.
export function createPlayerImportFixtures({ count = 12, now = Date.now } = {}) {
  const records = new Map(), writes = [], reads = [], scans = [], profileReads = [], lookups = [];
  const ids = Object.fromEntries(["main", "battlefront"].map(mode => [mode, Array.from({ length: count }, (_, index) => String(910000001 + index))]));
  const failures = { profiles: new Set(), names: false, list: new Set() }, hooks = {};
  let serial = 0;
  const db = { doc(path) { return {
    async get({ signal, budget } = {}) {
      budget?.read(); budget?.attempt();
      signal?.throwIfAborted(); reads.push(path);
      const record = records.get(path);
      return { exists: !!record, data: () => structuredClone(record?.value), updateTime: record ? { toISOString: () => record.updateTime } : undefined };
    },
    async set(value, options) {
      options.budget?.write(); options.budget?.attempt();
      options.signal?.throwIfAborted();
      await hooks.beforeSet?.(path, value);
      const existing = records.get(path), condition = options.precondition;
      if ((condition.exists === false && existing) || (condition.updateTime !== undefined && condition.updateTime !== existing?.updateTime)) {
        throw Object.assign(new Error("Synthetic CAS conflict."), { code: "FAILED_PRECONDITION", status: 400 });
      }
      writes.push({ path, value: structuredClone(value) });
      records.set(path, { value: { ...(options.merge ? existing?.value : {}), ...structuredClone(value) }, updateTime: `2026-10-12T03:00:00.${String(++serial).padStart(6, "0")}Z` });
      await hooks.afterSet?.(path, value);
    },
  }; },
    collection(name) {
      const filters = [], ordering = []; let limit = 5;
      const query = { where(...args) { filters.push(args); return query; }, orderBy(...args) { ordering.push(args); return query; }, limit(value) { limit = value; return query; },
        async get({ signal, budget } = {}) {
          signal?.throwIfAborted(); budget?.read(limit); budget?.attempt(); reads.push(`${name}:query`);
          const values = [...records].filter(([path, record]) => path.startsWith(`${name}/`) && filters.every(([field, op, expected]) => {
            const value = record.value[field]; if (typeof value !== "string") return false;
            return op === ">=" ? value >= expected : op === "<=" ? value <= expected : value === expected;
          })).sort(([pathA, a], [pathB, b]) => a.value.nextAttemptAt.localeCompare(b.value.nextAttemptAt) || pathA.localeCompare(pathB)).slice(0, limit);
          return { docs: values.map(([path, record]) => ({ ref: { path }, exists: true, data: () => structuredClone(record.value), updateTime: { toISOString: () => record.updateTime } })) };
        } };
      return query;
    },
  };
  const reader = { async read(mode, id, { signal }) {
    signal.throwIfAborted(); profileReads.push({ mode, id });
    if (failures.profiles.has(`${mode}:${id}`)) throw new Error("synthetic-private-source-failure");
    return { envelope: { Data: { Level: Number(id) % 100, Games_Played: 0, Account: { GamesPlayed: 0 },
      Credits: 0, Tokens: 0, Name: `Saved_${id}`, DisplayName: `Saved ${id}`, Unknown: "synthetic-private-profile-field" },
      MetaData: { ActiveSession: ["synthetic-private-session"] } }, revision: `opaque-${id}`, updatedAt: "2026-10-12T01:00:00.000Z" };
  } };
  const lister = { async list(mode, { cursor, limit, signal }) {
    signal.throwIfAborted(); scans.push({ mode, cursor, limit }); if (failures.list.has(mode)) throw new Error("synthetic-private-list-failure");
    const offset = Number(cursor || 0), page = ids[mode].slice(offset, offset + limit);
    return { ids: [...new Set(page)], nextCursor: offset + limit < ids[mode].length ? String(offset + limit) : "", observedKeys: page.length, rejectedKeys: 0 };
  } };
  const identities = { async resolve(requested, { signal }) {
    signal.throwIfAborted(); lookups.push(requested); if (failures.names) throw new Error("synthetic-private-name-failure");
    return Object.fromEntries(requested.map(id => [id, { username: `Preview_${id}`, displayName: `Preview Player ${id}`, checkedAt: new Date(now()).toISOString() }]));
  } };
  const store = createPlayerImportStore(db);
  const dependencies = { store, reader, lister, identities, now, enabled: true, secret: "synthetic-batch-preview-signing-only",
    targetFingerprint: "synthetic-fixed-target", target: { experience: "Synthetic Tower Eclipse", universeId: "123456", projectId: "synthetic-offline-project",
      collection: "tePlayerSummaries", stores: { main: "PlayerData V24", battlefront: "PlayerData V1_battlefront" }, scope: "global" } };
  return { records, writes, reads, scans, profileReads, lookups, failures, hooks, ids, db, store, dependencies, reader, identities, lister,
    service: createPlayerImportService(dependencies) };
}
