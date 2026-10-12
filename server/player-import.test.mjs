import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createPlayerImportService } from "./player-import-service.mjs";
import { PLAYER_IMPORT_JOB_PATH } from "./player-import-store.mjs";
import { createPlayerImportFixtures } from "./testing/player-import-fixtures.mjs";
import { createConfiguredPlayerImport } from "./player-import-runtime.mjs";
import { createRobloxEntryLister } from "./roblox-entry-list.mjs";
import { createRobloxUserIdentities } from "./roblox-user-identities.mjs";
import { compareSummaryImportSnapshot, createSummaryImportCandidate } from "./player-summary-import.mjs";
import { createFirestoreSummaryIndex } from "./game-data-readers.mjs";
import { parsePlayerQuery } from "./game-data-service.mjs";

const actor = "signed-developer", confirmation = "IMPORT SUMMARIES";
const apply = (service, preview) => service.apply({ token: preview.token, confirmation }, actor);
const summaries = f => [...f.records].filter(([path]) => path.startsWith("tePlayerSummaries/"));
const json = value => new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
const profile = level => ({ envelope: { Data: { Level: level } }, revision: "opaque-version", updatedAt: "2026-10-12T01:00:00.000Z" });

test("status and preview write nothing, show exact scope/budgets and never serialize raw profiles", async () => {
  const f = createPlayerImportFixtures();
  assert.equal((await f.service.status()).coverage, "unknown");
  const p = await f.service.preview({ mode: "main" }, actor);
  assert.equal(p.rows.length, 5); assert.equal(p.target.collection, "tePlayerSummaries");
  assert.equal(p.budget.maxApplySummaryWrites, 5); assert.equal(p.budget.previewCheckpointWrites, 0); assert.equal(p.budget.previewSummaryWrites, 0);
  assert.equal(f.records.size, 0); assert.equal(f.writes.length, 0); assert.equal(f.scans.length, 1);
  const token = Buffer.from(p.token.split(".")[0], "base64url").toString();
  assert.ok(!token.includes("synthetic-private")); assert.ok(!token.includes("ActiveSession"));
  assert.ok(!JSON.stringify(p).includes("synthetic-private"));
});

test("signed preview is mandatory, actor/configuration bound, expiring and not client-targetable", async () => {
  let clock = Date.parse("2026-10-12T03:00:00Z"); const f = createPlayerImportFixtures({ now: () => clock });
  const p = await f.service.preview({}, actor);
  await assert.rejects(f.service.apply({ token: p.token }, actor), { code: "IMPORT_CONFIRMATION_REQUIRED" });
  await assert.rejects(f.service.apply({ token: p.token, confirmation }, "different-operator"), { code: "INVALID_IMPORT_PREVIEW" });
  await assert.rejects(apply(f.service, { token: p.token.replace(/^./, "X") }), { code: "INVALID_IMPORT_PREVIEW" });
  const other = createPlayerImportService({ ...f.dependencies, targetFingerprint: "changed-source" });
  await assert.rejects(apply(other, p), { code: "INVALID_IMPORT_PREVIEW" });
  clock += 300001; await assert.rejects(apply(f.service, p), { code: "INVALID_IMPORT_PREVIEW" });
  assert.equal(f.writes.length, 0);
});

test("multipage traversal resumes across process instances, preserves both modes and keeps coverage unknown", async () => {
  const f = createPlayerImportFixtures({ count: 12 });
  await apply(f.service, await f.service.preview({ mode: "main" }, actor));
  const resumed = createPlayerImportService(f.dependencies);
  await apply(resumed, await resumed.preview({ mode: "battlefront" }, actor));
  await apply(resumed, await resumed.preview({ mode: "main" }, actor));
  await apply(resumed, await resumed.preview({ mode: "main" }, actor));
  const status = await resumed.status(); assert.equal(status.progress.modes.main.done, true);
  assert.equal(status.progress.modes.main.created, 12); assert.equal(status.progress.modes.battlefront.created, 5);
  assert.equal(status.progress.modes.battlefront.done, false); assert.equal(status.coverage, "unknown");
  assert.deepEqual(f.scans.filter(scan => scan.mode === "main").map(scan => scan.cursor), ["", "5", "10"]);
  assert.equal(summaries(f).length, 17);
  assert.ok(!JSON.stringify(f.records.get(PLAYER_IMPORT_JOB_PATH).value).includes("candidate"));
});

test("duplicates and a new refresh sweep are idempotent; used previews cannot replay writes", async () => {
  const f = createPlayerImportFixtures({ count: 5 }); f.ids.main[1] = f.ids.main[0];
  const p = await f.service.preview({}, actor); await apply(f.service, p);
  await assert.rejects(apply(f.service, p), { code: "IMPORT_PREVIEW_CHANGED" });
  assert.equal(summaries(f).length, 4);
  const summaryWrites = f.writes.filter(write => write.path.startsWith("tePlayerSummaries/"));
  assert.equal(summaryWrites.length, 4);
  const next = await f.service.preview({ restart: true }, actor); assert.ok(next.rows.every(row => row.action === "unchanged"));
  await apply(f.service, next);
  assert.equal(f.writes.filter(write => write.path.startsWith("tePlayerSummaries/")).length, 4);
});

test("transient row and mode failures stay pending without blocking the other mode or deleting good summaries", async () => {
  const f = createPlayerImportFixtures({ count: 5 }); const id = f.ids.main[0];
  f.failures.profiles.add(`main:${id}`);
  const p = await f.service.preview({}, actor); assert.equal(p.rows[0].reason, "profile_unavailable");
  await apply(f.service, p);
  let s = await f.service.status(); assert.equal(s.progress.modes.main.pending, 1); assert.equal(s.progress.modes.main.failures, 1);
  f.failures.list.add("main"); await apply(f.service, await f.service.preview({ mode: "battlefront" }, actor));
  f.failures.profiles.clear();
  const retry = await f.service.preview({}, actor); assert.deepEqual(retry.rows.map(row => row.userId), [id]);
  await apply(f.service, retry); s = await f.service.status(); assert.equal(s.progress.modes.main.done, true); assert.equal(summaries(f).length, 10);
  f.failures.list.clear();
  f.failures.profiles.add(`main:${id}`);
  await apply(f.service, await f.service.preview({ restart: true }, actor)); assert.equal(summaries(f).length, 10);
});

test("concurrent invocations have one winner and cancelled leases cannot advance old checkpoints", async () => {
  const f = createPlayerImportFixtures({ count: 5 }); const p = await f.service.preview({}, actor);
  const both = await Promise.allSettled([apply(f.service, p), apply(createPlayerImportService(f.dependencies), p)]);
  assert.equal(both.filter(item => item.status === "fulfilled").length, 1); assert.equal(summaries(f).length, 5);
  assert.equal(f.writes.filter(write => write.path.startsWith("tePlayerSummaries/")).length, 5);
  const second = createPlayerImportFixtures({ count: 5 }); let stopped = false;
  second.hooks.afterSet = async path => { if (!stopped && path.startsWith("tePlayerSummaries/")) { stopped = true; await second.service.cancel(); } };
  await assert.rejects(apply(second.service, await second.service.preview({}, actor)));
  assert.equal(summaries(second).length, 1); const status = await second.service.status();
  assert.equal(status.progress.paused, true); assert.equal(status.progress.busy, false); assert.equal(status.progress.modes.main.pending, 5);
  second.hooks.afterSet = null; await apply(second.service, await second.service.preview({}, actor)); assert.equal(summaries(second).length, 5);
});

test("checkpoint failure after a successful write safely replays the pending row after lease expiry", async () => {
  let clock = Date.parse("2026-10-12T03:00:00Z"); const f = createPlayerImportFixtures({ count: 5, now: () => clock }); let failCheckpoint = false;
  f.hooks.afterSet = path => { if (path.startsWith("tePlayerSummaries/")) failCheckpoint = true; };
  f.hooks.beforeSet = path => { if (path === PLAYER_IMPORT_JOB_PATH && failCheckpoint) throw new Error("synthetic-private-checkpoint-outage"); };
  await assert.rejects(apply(f.service, await f.service.preview({}, actor)), { code: "IMPORT_INTERRUPTED" });
  assert.equal(summaries(f).length, 1); assert.equal((await f.service.status()).progress.busy, true);
  clock += 45001; f.hooks.beforeSet = null; f.hooks.afterSet = null;
  const retry = await f.service.preview({}, actor); assert.equal(retry.rows[0].action, "unchanged");
  await apply(f.service, retry); assert.equal(summaries(f).length, 5);
  assert.equal(f.writes.filter(write => write.path.startsWith("tePlayerSummaries/")).length, 5);
});

test("uncertain summary commits stop the batch and retain the row for verification instead of deleting data", async () => {
  const f = createPlayerImportFixtures({ count: 5 }); let failed = false;
  f.hooks.afterSet = path => { if (!failed && path.startsWith("tePlayerSummaries/")) { failed = true; throw new Error("synthetic-private-transport-reset"); } };
  const result = await apply(f.service, await f.service.preview({}, actor)); assert.equal(result.uncertain, true);
  assert.equal(summaries(f).length, 1); assert.equal(result.progress.modes.main.pending, 5); assert.equal(result.progress.lastBatch[0].reason, "write_uncertain");
  f.hooks.afterSet = null; await apply(f.service, await f.service.preview({}, actor)); assert.equal(summaries(f).length, 5);
});

test("name failures preserve existing API identities; name refresh does not require a newer game save", async () => {
  let clock = Date.parse("2026-10-12T03:00:00Z"); const f = createPlayerImportFixtures({ count: 1, now: () => clock });
  await apply(f.service, await f.service.preview({}, actor)); const path = `tePlayerSummaries/main:${f.ids.main[0]}`;
  const saved = structuredClone(f.records.get(path)); f.failures.names = true; clock += 60000;
  const p = await f.service.preview({ restart: true }, actor); assert.equal(p.identityStatus, "unavailable_saved_names_preserved"); assert.equal(p.rows[0].action, "unchanged");
  await apply(f.service, p); assert.deepEqual(f.records.get(path), saved);
  const previous = createSummaryImportCandidate("main", "123", profile(5), () => clock);
  const updated = createSummaryImportCandidate("main", "123", profile(5), () => clock, { username: "CurrentName", displayName: "Current Display", checkedAt: new Date(clock).toISOString() });
  assert.equal(compareSummaryImportSnapshot(updated, { exists: true, value: previous, updateTime: "2026-10-12T03:00:00.123456Z" }, { allowResolvedIdentity: true }).action, "update");
  const older = createSummaryImportCandidate("main", "123", { ...profile(2), revision: "different", updatedAt: "2026-10-12T00:00:00Z" }, () => clock);
  assert.equal(compareSummaryImportSnapshot(older, { exists: true, value: updated, updateTime: "2026-10-12T03:00:00Z" }, { allowResolvedIdentity: true }).reason, "stale_snapshot");
});

test("disabled runtime is inert and creates no request/Firestore dependencies or scheduling", async () => {
  const config = { enabled: false };
  const disabled = createConfiguredPlayerImport({ configuration: config, secret: "synthetic-cookie-signing-only", db: new Proxy({}, { get() { throw new Error("No DB inspection"); } }),
    environment: {}, fetch: () => { throw new Error("No request"); } });
  assert.equal((await disabled.status()).enabled, false); await assert.rejects(disabled.preview({}, actor), { code: "IMPORT_DISABLED" });
  assert.throws(() => createConfiguredPlayerImport({ configuration: config, secret: "synthetic-cookie-signing-only", environment: { TE_DATA_IMPORT_ENABLED: "TRUE" } }));
  const source = await readFile(new URL("./player-import-runtime.mjs", import.meta.url), "utf8"); assert.ok(!source.includes("setInterval"));
});

test("scoped lister uses bounded GET pages, validates resource keys and preserves empty page cursors", async () => {
  const config = { universeId: "123456", apiKey: "synthetic-list-key", stores: { main: { dataStoreId: "fixed-main", scopeId: "global" }, battlefront: { dataStoreId: "fixed-bf", scopeId: "global" } } };
  let body = { dataStoreEntries: [{ id: "123", path: "universes/123456/data-stores/fixed-main/scopes/global/entries/123" }, { id: "123" }, { id: "private-non-player-key" }], nextPageToken: "opaque+cursor=" };
  const requests = []; let clock = 0;
  const lister = createRobloxEntryLister({ config, now: () => clock, wait: async ms => { clock += ms; }, random: () => 0, fetch: async (url, options) => { requests.push({ url, options }); return json(body); } });
  const first = await lister.list("main", { limit: 5 }); assert.deepEqual(first.ids, ["123"]); assert.equal(first.rejectedKeys, 1);
  assert.equal(requests[0].options.method, "GET"); assert.equal(new URL(requests[0].url).searchParams.get("maxPageSize"), "5");
  body = { nextPageToken: "next" }; await lister.list("main", { cursor: first.nextCursor });
  assert.equal(new URL(requests.at(-1).url).searchParams.get("pageToken"), "opaque+cursor=");
  for (const invalid of [{ dataStoreEntries: [{ id: "123", path: "universes/999/data-stores/fixed-main/entries/123" }] },
    { dataStoreEntries: Array(6).fill({ id: "123" }) }, { dataStoreEntries: null }, { nextPageToken: null }, { nextPageToken: "same" }, []]) {
    body = invalid; await assert.rejects(lister.list("main", { cursor: "same" }), { code: "LIST_UNAVAILABLE" });
  }
});

test("public name lookup uses no credentials, maps exact identities and fails safely on 429/wrong/oversized bodies", async () => {
  const calls = []; let response = json({ data: [{ id: 123, name: "CurrentName", displayName: "Current Display", description: "synthetic-private-unknown" }] });
  const resolver = createRobloxUserIdentities({ fetch: async (url, options) => { calls.push({ url, options }); return response; } });
  const result = await resolver.resolve(["123"]); assert.equal(result[123].username, "CurrentName"); assert.ok(!JSON.stringify(result).includes("synthetic-private"));
  assert.equal(calls[0].url, "https://users.roblox.com/v1/users"); assert.equal(calls[0].options.credentials, "omit"); assert.equal(calls[0].options.redirect, "error");
  assert.deepEqual(JSON.parse(calls[0].options.body), { userIds: [123], excludeBannedUsers: false }); assert.equal(calls[0].options.headers.authorization, undefined);
  response = json({ data: [{ id: 124, name: "Wrong", displayName: "Wrong" }] }); await assert.rejects(resolver.resolve(["123"]), { code: "IDENTITIES_UNAVAILABLE" });
  response = json({ data: [], marker: "x".repeat(32769) }); await assert.rejects(resolver.resolve(["123"]), { code: "IDENTITIES_UNAVAILABLE" });
  response = new Response("synthetic-private-rate-body", { status: 429, headers: { "retry-after": "60" } });
  await assert.rejects(resolver.resolve(["123"]), { code: "IDENTITIES_UNAVAILABLE" }); const before = calls.length;
  await assert.rejects(resolver.resolve(["123"]), { code: "IDENTITIES_UNAVAILABLE" }); assert.equal(calls.length, before);
});

test("local index artifact contains all 12 player query shapes and preserves existing collections", async () => {
  const value = JSON.parse(await readFile(new URL("../firestore.indexes.json", import.meta.url), "utf8"));
  const player = value.indexes.filter(index => index.collectionGroup === "tePlayerSummaries"); assert.equal(player.length, 12);
  for (const field of ["stats.level", "stats.gamesPlayed", "stats.rankedISR", "lastJoinedDate", "identity.usernameFolded", "identity.displayNameFolded"]) {
    for (const direction of ["ASCENDING", "DESCENDING"]) assert.ok(player.some(index => index.queryScope === "COLLECTION"
      && JSON.stringify(index.fields) === JSON.stringify([{ fieldPath: "mode", order: "ASCENDING" }, { fieldPath: field, order: direction }, { fieldPath: "__name__", order: direction }])));
  }
  assert.ok(value.indexes.some(index => index.collectionGroup === "bugReports")); assert.ok(value.indexes.some(index => index.collectionGroup === "careerApplications"));
});

test("cancellation writes no preview data and ignored identity cancellation retains its underlying request slot", async () => {
  const f = createPlayerImportFixtures(), cancelled = new AbortController(); cancelled.abort();
  await assert.rejects(f.service.preview({}, actor, cancelled.signal)); assert.equal(f.writes.length, 0); assert.equal(f.scans.length, 0);
  let release, calls = 0;
  const resolver = createRobloxUserIdentities({ fetch: () => { calls++; return new Promise(resolve => { release = resolve; }); } });
  const controller = new AbortController(), first = resolver.resolve(["123"], { signal: controller.signal });
  await new Promise(resolve => setImmediate(resolve)); controller.abort(); await assert.rejects(first);
  await assert.rejects(resolver.resolve(["123"])); assert.equal(calls, 1);
  release(json({ data: [{ id: 123, name: "Safe", displayName: "Safe" }] })); await new Promise(resolve => setImmediate(resolve));
});

test("source cursor loops never advance a checkpoint or claim complete traversal", async () => {
  const f = createPlayerImportFixtures({ count: 0 });
  const lister = { list: async (_mode, { cursor }) => ({ ids: [], nextCursor: cursor === "" ? "A" : cursor === "A" ? "B" : "A", observedKeys: 0, rejectedKeys: 0 }) };
  const service = createPlayerImportService({ ...f.dependencies, lister });
  await apply(service, await service.preview({}, actor)); await apply(service, await service.preview({}, actor)); await apply(service, await service.preview({}, actor));
  const before = f.writes.length; await assert.rejects(service.preview({}, actor), { code: "IMPORT_CURSOR_LOOP" }); assert.equal(f.writes.length, before);
  assert.equal((await service.status()).progress.modes.main.done, false);
});

test("resolved identity survives the actual list projection and powers prefix ordering with provenance", async () => {
  const f = createPlayerImportFixtures({ count: 1 }); await apply(f.service, await f.service.preview({}, actor));
  const value = summaries(f)[0][1].value, selected = [], order = [];
  const query = { where() { return query; }, orderBy(...args) { order.push(args); return query; }, select(...args) { selected.push(...args); return query; },
    limit() { return query; }, atReadTime() { return query; }, get: async () => ({ docs: [{ data: () => value }] }) };
  const index = createFirestoreSummaryIndex({ collection: () => query }, { log: () => {} });
  const result = await index.list(parsePlayerQuery({ search: "preview_" }), { snapshotAt: new Date().toISOString(), after: null });
  assert.equal(result.items[0].identity.source, "roblox_users_api"); assert.ok(result.items[0].identity.username.startsWith("Preview_"));
  assert.equal(result.items[0].identity.checkedAt, value.importState.identityCheckedAt); assert.ok(selected.includes("importState.identityCheckedAt"));
  assert.deepEqual(order, [["identity.usernameFolded", "asc"], ["__name__", "asc"]]); assert.equal(result.coverage.status, "unknown");
});

test("status allowlists persisted diagnostics and rejects malformed progress instead of returning arbitrary fields", async () => {
  const f = createPlayerImportFixtures({ count: 1 }); await apply(f.service, await f.service.preview({}, actor));
  const value = f.records.get(PLAYER_IMPORT_JOB_PATH).value;
  value.lastBatch = [{ userId: "123", action: "retry", reason: "synthetic-private-provider-text", extra: "synthetic-private-field" }];
  value.extra = { secret: "synthetic-private-root" };
  const result = await f.service.status(); assert.ok(!JSON.stringify(result).includes("synthetic-private"));
  value.modes.main.created = { private: "synthetic-private-counter" };
  await assert.rejects(f.service.status(), { code: "IMPORT_TARGET_CHANGED" });
});
