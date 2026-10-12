import test from "node:test";
import assert from "node:assert/strict";
import { importOwnerSummaries, SUMMARY_IMPORT_OWNER as owner, summaryImportPath, validateSummaryImportCandidate } from "./player-summary-import.mjs";
import { createFirestoreSummaryImportStore } from "./player-summary-import-store.mjs";
import { createFirestoreSummaryIndex } from "./game-data-readers.mjs";
import { parsePlayerQuery } from "./game-data-service.mjs";
import { runOwnerImportCommand } from "../scripts/import-player-summaries.mjs";

const modes = ["main", "battlefront"];
const entry = (extra = {}) => ({ envelope: { Data: { Level: 0, Credits: 0, Tokens: 0, Games_Played: 4, Account: { GamesPlayed: 3 } } },
  revision: "opaque-z", updatedAt: "2026-10-12T01:00:00.000Z", ...extra });
const now = () => Date.parse("2026-10-12T03:00:00Z");
const status = result => result.results.map(item => item.status);

function fixture(profiles = { main: entry(), battlefront: entry() }) {
  const records = new Map(), reads = [], writes = [], profileReads = [], queries = [];
  let serial = 0, beforeSet = null;
  const db = {
    doc(path) { return {
      async get({ signal } = {}) {
        signal?.throwIfAborted(); reads.push(path);
        const record = records.get(path);
        return { exists: !!record, data: () => structuredClone(record?.value), updateTime: record ? { toISOString: () => record.updateTime } : undefined };
      },
      async set(value, options) {
        options.signal?.throwIfAborted();
        if (beforeSet) { const hook = beforeSet; beforeSet = null; hook(path); }
        const record = records.get(path), condition = options.precondition;
        if ((condition.exists === false && record) || (condition.updateTime !== undefined && condition.updateTime !== record?.updateTime)) {
          throw Object.assign(new Error("private-concurrency-error"), { code: "FAILED_PRECONDITION", status: 400 });
        }
        writes.push({ path, value: structuredClone(value), precondition: condition });
        records.set(path, { value: { ...(options.merge ? record?.value : {}), ...structuredClone(value) }, updateTime: `2026-10-12T03:00:00.${String(++serial).padStart(6, "0")}Z` });
      },
    }; },
    collection(name) {
      const filters = [], order = [];
      const query = { where(...args) { filters.push(args); return query; }, orderBy(...args) { order.push(args); return query; },
        select() { return query; }, limit() { return query; }, atReadTime() { return query; }, startAfter() { return query; },
        async get() {
          queries.push({ name, filters, order });
          assert.equal(name, "tePlayerSummaries");
          const mode = filters.find(item => item[0] === "mode")[2];
          return { docs: [...records.values()].filter(record => record.value.mode === mode).map(record => ({ data: () => structuredClone(record.value) })) };
        },
      }; return query;
    },
  };
  const store = createFirestoreSummaryImportStore(db, { writeEnabled: true });
  const reader = { async read(mode, id, { signal }) {
    assert.equal(id, owner); signal.throwIfAborted(); profileReads.push([mode, id]);
    if (profiles[mode] instanceof Error) throw profiles[mode];
    return structuredClone(profiles[mode]);
  } };
  return { records, reads, writes, profileReads, queries, db, store, reader, profiles,
    run: (options = {}) => importOwnerSummaries({ userId: owner, reader, store, now, ...options }),
    race: hook => { beforeSet = hook; } };
}

test("default dry-run reads exactly the two owner profiles and makes zero writes", async () => {
  const f = fixture(), result = await f.run();
  assert.deepEqual(status(result), ["would_create", "would_create"]); assert.equal(result.writeMode, "dry_run");
  assert.equal(result.coverage, "unknown"); assert.equal(result.scope, "single_owner");
  assert.deepEqual(f.profileReads, modes.map(mode => [mode, owner]));
  assert.deepEqual(f.reads, modes.map(mode => `tePlayerSummaries/${mode}:${owner}`));
  assert.equal(f.writes.length, 0); assert.equal(f.records.size, 0);
});

test("CLI rejects missing, different, multiple and malformed targets before loading resources", async () => {
  let loads = 0;
  for (const argv of [[], ["--user-id", "123"], ["--user-id", owner, "--user-id", "123"], ["--user-id", "123", "--user-id", owner],
    ["--user-id", `${owner},123`], ["--user-id", owner, "--all"], ["--user-id", owner, "123"], ["--user-id", owner, "--apply=false"],
    ["--user-id", owner, "--apply", "--apply"]]) {
    const result = await runOwnerImportCommand({ argv, loadResources: () => { loads++; throw new Error("must not load"); } });
    assert.equal(result.ok, false);
  }
  assert.equal(loads, 0);
  assert.throws(() => summaryImportPath("main", "123")); assert.throws(() => summaryImportPath("survival", owner));
  assert.throws(() => summaryImportPath("main", Number(owner)));
  assert.equal((await runOwnerImportCommand({ argv: ["--help"], loadResources: () => { loads++; } })).ok, true);
  assert.equal(loads, 0);
});

test("CLI requires explicit apply, hides setup errors and cannot be steered by resource flags", async () => {
  for (const apply of [false, true]) {
    const f = fixture(); let loadedApply;
    const result = await runOwnerImportCommand({ argv: ["--user-id", owner, ...(apply ? ["--apply"] : [])], loadResources: async options => {
      loadedApply = options.apply; return { reader: f.reader, store: f.store, now, userId: "123", apply: !apply };
    } });
    assert.equal(loadedApply, apply); assert.equal(result.writeMode, apply ? "apply" : "dry_run"); assert.equal(f.writes.length, apply ? 2 : 0);
  }
  const result = await runOwnerImportCommand({ argv: ["--user-id", owner], loadResources: () => { throw new Error("private-provider-and-credential-path"); } });
  assert.deepEqual(result, { ok: false, code: "IMPORT_SETUP_UNAVAILABLE" });
});

test("apply writes only allowlisted compact summaries, preserves zero/null and withholds envelopes", async () => {
  const marker = "private-unknown-field-marker";
  const f = fixture({ main: entry({ envelope: { Data: { Level: 0, Credits: 0, Unknown: { Label: marker }, Loadouts: [{ Label: marker }],
    EnemyData: { Kills: { EnemyA: 2, EnemyB: 3 } } }, MetaData: { ActiveSession: [marker] }, GlobalUpdates: [marker] } }), battlefront: entry() });
  assert.deepEqual(status(await f.run({ apply: true })), ["created", "created"]);
  assert.deepEqual(f.writes.map(write => write.path), modes.map(mode => `tePlayerSummaries/${mode}:${owner}`));
  for (const write of f.writes) {
    validateSummaryImportCandidate(write.value.mode, owner, write.value);
    assert.equal(write.value.identity.source, "saved_fields"); assert.equal(write.value.identity.username, null);
    assert.equal(write.value.identity.usernameFolded, ""); assert.equal(write.value.stats.level, 0);
    assert.equal(write.value.stats.experience, null); assert.ok(write.value.missingFields.includes("experience"));
    assert.deepEqual(write.precondition, { exists: false }); assert.ok(Buffer.byteLength(JSON.stringify(write.value)) < 32768);
  }
  assert.equal(f.writes[0].value.stats.personalEnemyKillsTotal, 5); assert.equal(f.writes[1].value.stats.tokens, 0);
  assert.ok(!JSON.stringify(f.writes).includes(marker)); assert.ok(!JSON.stringify(f.writes).includes("ActiveSession"));
});

test("repeat import is idempotent even with a later check clock", async () => {
  const f = fixture(); await f.run({ apply: true }); const saved = structuredClone([...f.records]);
  assert.deepEqual(status(await f.run({ apply: true, now: () => now() + 60000 })), ["unchanged", "unchanged"]);
  assert.equal(f.writes.length, 2); assert.deepEqual([...f.records], saved);
});

test("newer saves update with atomic document version checks; opaque revisions are never ordered", async () => {
  const f = fixture(); await f.run({ apply: true });
  const previous = f.records.get(summaryImportPath("main", owner)).updateTime;
  f.profiles.main = entry({ revision: "opaque-a", updatedAt: "2026-10-12T02:00:00Z", envelope: { Data: { Level: 10 } } });
  assert.deepEqual(status(await f.run()), ["would_update", "unchanged"]); assert.equal(f.writes.length, 2);
  assert.deepEqual(status(await f.run({ apply: true })), ["updated", "unchanged"]);
  assert.deepEqual(f.writes.at(-1).precondition, { updateTime: previous }); assert.equal(f.writes.at(-1).value.stats.level, 10);
});

test("older, equal-time, same-revision and unverifiable replacements preserve good records", async () => {
  for (const [extra, reason] of [
    [{ revision: "new-id", updatedAt: "2026-10-12T00:00:00Z" }, "stale_snapshot"],
    [{ revision: "new-id", updatedAt: "2026-10-12T01:00:00Z" }, "conflicting_snapshot"],
    [{ revision: "opaque-z", updatedAt: "2026-10-12T02:00:00Z" }, "conflicting_snapshot"],
    [{ revision: null, updatedAt: "2026-10-12T02:00:00Z" }, "freshness_unverifiable"],
    [{ revision: "new-id", updatedAt: null }, "freshness_unverifiable"],
  ]) {
    const f = fixture(); await f.run({ apply: true }); const saved = structuredClone([...f.records]);
    f.profiles.main = entry({ ...extra, envelope: { Data: { Level: 11 } } });
    assert.equal((await f.run({ apply: true })).results[0].reason, reason);
    assert.equal(f.writes.length, 2); assert.deepEqual([...f.records], saved);
  }
});

test("unknown save metadata is recorded as unknown and never justifies a replacement", async () => {
  const f = fixture({ main: entry({ revision: null, updatedAt: null }), battlefront: entry() });
  await f.run({ apply: true }); const path = summaryImportPath("main", owner);
  assert.equal(f.records.get(path).value.source.updatedAt, null); assert.equal(f.records.get(path).value.importState.revisionHash, null);
  f.profiles.main = entry({ envelope: { Data: { Level: 20 } } });
  assert.equal((await f.run({ apply: true })).results[0].reason, "freshness_unverifiable"); assert.equal(f.writes.length, 2);
});

test("unmanaged, verified, modified and wrongly identified documents are protected", async () => {
  for (const [mutate, reason] of [
    [value => { delete value.importState; }, "unmanaged_existing_summary"],
    [value => { value.identity.verified = true; }, "protected_identity_source"],
    [value => { value.stats.level = 22; }, "conflicting_index_edits"],
    [value => { value.identity.email = "private-marker"; }, "conflicting_index_edits"],
    [value => { value.userId = "123"; }, "invalid_existing_summary"],
  ]) {
    const f = fixture(); await f.run({ apply: true }); mutate(f.records.get(summaryImportPath("main", owner)).value);
    const saved = structuredClone([...f.records]);
    assert.equal((await f.run({ apply: true })).results[0].reason, reason); assert.deepEqual([...f.records], saved); assert.equal(f.writes.length, 2);
  }
});

test("unrelated existing root fields survive a valid newer summary merge", async () => {
  const f = fixture(); await f.run({ apply: true }); const path = summaryImportPath("main", owner);
  f.records.get(path).value.reviewFlag = "preserved";
  f.profiles.main = entry({ revision: "next", updatedAt: "2026-10-12T02:00:00Z" });
  assert.equal((await f.run({ apply: true })).results[0].status, "updated"); assert.equal(f.records.get(path).value.reviewFlag, "preserved");
  assert.equal(f.writes.at(-1).value.reviewFlag, undefined);
});

test("one-mode failure, missing or empty profile cannot replace good data and leaves the other mode usable", async () => {
  for (const [profile, reason] of [[new Error("private-provider-error"), "profile_unavailable"], [null, "missing_profile"],
    [entry({ envelope: { Data: {} } }), "empty_profile"], [entry({ envelope: { Data: [] } }), "profile_unavailable"]]) {
    const f = fixture(); await f.run({ apply: true }); const saved = structuredClone(f.records.get(summaryImportPath("main", owner)));
    f.profiles.main = profile; f.profiles.battlefront = entry({ revision: "next", updatedAt: "2026-10-12T02:00:00Z" });
    const result = await f.run({ apply: true });
    assert.equal(result.results[0].reason, reason); assert.equal(result.results[1].status, "updated"); assert.equal(result.coverage, "unknown");
    assert.deepEqual(f.records.get(summaryImportPath("main", owner)), saved); assert.ok(!JSON.stringify(result).includes("private-provider"));
  }
});

test("CAS detects concurrent creates/updates instead of overwriting another writer", async () => {
  for (const exists of [false, true]) {
    const f = fixture(); if (exists) await f.run({ apply: true });
    f.profiles.main = entry({ revision: "next", updatedAt: "2026-10-12T02:00:00Z" });
    f.race(path => f.records.set(path, { value: { concurrent: "must survive" }, updateTime: "2026-10-12T04:00:00.123456Z" }));
    const result = await f.run({ apply: true }); assert.equal(result.results[0].reason, "concurrent_index_change");
    assert.deepEqual(f.records.get(summaryImportPath("main", owner)).value, { concurrent: "must survive" });
  }
});

test("missing Firestore version fails closed before replacing an existing summary", async () => {
  const f = fixture(); await f.run({ apply: true }); const path = summaryImportPath("main", owner);
  f.records.get(path).updateTime = undefined; f.profiles.main = entry({ revision: "next", updatedAt: "2026-10-12T02:00:00Z" });
  assert.equal((await f.run({ apply: true })).results[0].reason, "missing_write_precondition"); assert.equal(f.writes.length, 2);
});

test("write adapter is inert by default and rejects arbitrary root/nested payloads", async () => {
  const f = fixture(); await f.run({ apply: true }); const candidate = f.writes[0].value;
  const disabled = createFirestoreSummaryImportStore(f.db);
  await assert.rejects(disabled.upsert("main", owner, candidate, { exists: false }), { code: "IMPORT_APPLY_REQUIRED" });
  for (const mutate of [value => { value.Data = { secret: "private" }; }, value => { value.identity.private = "private"; },
    value => { value.stats.unknown = 1; }, value => { value.source.session = "private"; }, value => { value.importState.secret = "private"; },
    value => { value.missingFields.push("private"); }, value => { value.stats.level = 123; }, value => { value.identity.source = "verified"; }]) {
    const bad = structuredClone(candidate); mutate(bad);
    await assert.rejects(f.store.upsert("main", owner, bad, { exists: false }), { code: "INVALID_IMPORT_SUMMARY" });
  }
  assert.equal(f.writes.length, 2);
});

test("imported documents work with the default list query even when names and level are missing", async () => {
  const f = fixture({ main: entry({ envelope: { Data: { Credits: 0 } } }), battlefront: entry({ envelope: { Data: { Tokens: 0 } } }) });
  await f.run({ apply: true });
  const index = createFirestoreSummaryIndex(f.db, { log: () => {} });
  for (const mode of modes) {
    const result = await index.list(parsePlayerQuery({ mode }), { snapshotAt: new Date(now()).toISOString(), after: null });
    assert.equal(result.items.length, 1); assert.equal(result.items[0].userId, owner);
    assert.equal(result.items[0].identity.username, null); assert.equal(result.items[0].stats.level, null); assert.equal(result.coverage.status, "unknown");
    assert.deepEqual(f.queries.at(-1).order, [["stats.level", "desc"], ["__name__", "desc"]]);
  }
});

test("timed-out reads cannot trigger late writes even if the read ignores abort", async () => {
  const f = fixture(); const pending = [];
  const reader = { read: () => new Promise(resolve => pending.push(resolve)) };
  const result = await f.run({ apply: true, reader, timeoutMs: 5 });
  assert.deepEqual(status(result), ["skipped", "skipped"]); assert.equal(f.writes.length, 0);
  for (const resolve of pending) resolve(entry()); await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.writes.length, 0); assert.equal(f.reads.length, 0);
});

test("timed-out commits are explicitly uncertain and stop subsequent writes", async () => {
  const f = fixture(); let resolveCommit, calls = 0;
  const store = { read: f.store.read, upsert: () => { calls++; return new Promise(resolve => { resolveCommit = resolve; }); } };
  const result = await f.run({ apply: true, store, timeoutMs: 5 });
  assert.equal(result.ok, false); assert.deepEqual(status(result), ["write_uncertain", "skipped"]);
  assert.equal(result.results[0].reason, "verify_with_dry_run"); assert.equal(result.results[1].reason, "prior_write_uncertain");
  assert.equal(calls, 1); assert.equal(f.profileReads.length, 1); resolveCommit();
});

test("known write rejection stays safe while cancellation and synthetic readers cannot write", async () => {
  const f = fixture(); const store = { read: f.store.read, upsert: () => { throw Object.assign(new Error("private-api-body"), { status: 403 }); } };
  const rejected = await f.run({ apply: true, store }); assert.deepEqual(status(rejected), ["skipped", "skipped"]);
  assert.ok(rejected.results.every(item => item.reason === "write_unavailable")); assert.ok(!JSON.stringify(rejected).includes("private-api-body"));
  const controller = new AbortController(); controller.abort();
  assert.ok((await f.run({ apply: true, signal: controller.signal })).results.every(item => item.reason === "cancelled"));
  await assert.rejects(f.run({ reader: { ...f.reader, synthetic: true } }), { code: "INVALID_IMPORT_CONFIGURATION" });
  assert.equal(f.writes.length, 0);
});
