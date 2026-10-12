import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { requireAuth, requireRole, requireCsrf } from "./auth-context.mjs";
import { createConfiguredPlayerImport } from "./player-import-runtime.mjs";
import { createPlayerImportRouter } from "./player-import-routes.mjs";
import { GAME_DATA_LIMITS, gameDataEnabled, readGameDataConfiguration } from "./game-data-config.mjs";
import { decodeSavedProfile, projectPlayerSummary, redactGameData, validatePlayerId } from "./game-data-domain.mjs";
import { createConfiguredProfileReader } from "./game-data-runtime.mjs";
import { createGameDataService, parsePlayerQuery } from "./game-data-service.mjs";
import { createGameDataRouter } from "./game-data-routes.mjs";
import { createFirestoreSummaryIndex, createSavedEntryReader, createUnavailableProfileReader } from "./game-data-readers.mjs";
import { createGameDataFixtures, FIXTURE_PLAYER_ID } from "./testing/game-data-fixtures.mjs";

const signingKey = "synthetic-test-cursor-signing-only";
const makeService = options => createGameDataService({ ...createGameDataFixtures(), cursorSecret: signingKey, ...options });

test("strict IDs, modes, sorts, query combinations and request limits", () => {
  for (const value of ["0", "01", "-1", "1.2", "1e3", "../123", "9007199254740992", "1".repeat(17), 123]) assert.throws(() => validatePlayerId(value));
  assert.equal(validatePlayerId(FIXTURE_PLAYER_ID), FIXTURE_PLAYER_ID);
  for (const query of [{ mode: "unknown" }, { limit: "101" }, { limit: "0" }, { search: "x".repeat(65) }, { sort: "constructor" }, { arbitraryStore: "private" }, { mode: ["main"] }, { search: "preview", sort: "level" }, { minLevel: "10", sort: "username" }, { mode: "battlefront", sort: "rankedISR" }]) assert.throws(() => parsePlayerQuery(query));
});

test("summary preserves unknown versus zero, canonical fields, currencies and date precision", () => {
  const main = projectPlayerSummary("main", "123", { Level: 0, Games_Played: 0, Ranked: { Games_Played: 8, GamesPlayed: 99 }, First_Joined: "31/02/26", Last_Joined: "10/10/26" });
  assert.equal(main.stats.level, 0); assert.equal(main.stats.credits, null); assert.equal(main.stats.rankedGamesPlayed, 8);
  assert.equal(main.firstJoinedDate, null); assert.equal(main.lastJoinedDate, "2026-10-10");
  assert.equal(projectPlayerSummary("battlefront", "123", { Credits: 99 }).stats.tokens, null);
  assert.equal(projectPlayerSummary("main", "123", { EnemyData: { Kills: { A: 2, B: "invalid" } } }).stats.personalEnemyKillsTotal, null);
  assert.equal(projectPlayerSummary("main", "123", {}, { updatedAt: { private: "value" } }).source.updatedAt, null);
});

test("non-fixture detail fails closed for unknown nested fields while documented statistics survive", async () => {
  const marker = "sensitive-value-in-an-innocent-field";
  const entry = { synthetic: true, envelope: {
    Data: { Name: "Example", Level: 8, Games_Played: 12, Credits: 34, Tokens: 56,
      Account: { GamesPlayed: 7, Description: marker }, Ranked: { CurrentISR: 1024, Notes: marker },
      EnemyData: { Kills: { Grunt: 2, Boss: 3 } },
      Loadouts: [{ Caption: marker, Nested: { Unexpected: marker, AccessKeyId: marker } }],
      UnexpectedFeature: { VisibleLabel: marker, PrivateNotes: marker },
    }, MetaData: { ActiveSession: [marker], Description: marker }, GlobalUpdates: [marker],
  } };
  for (const mode of ["main", "battlefront"]) {
    const decoded = decodeSavedProfile(mode, "123", entry);
    assert.equal(decoded.detail, null); assert.equal(decoded.detailStatus, "withheld_pending_schema");
    assert.ok(!JSON.stringify(decoded).includes(marker));
  }
  const response = await makeService({ reader: { read: async () => entry } }).profile("123");
  assert.equal(response.synthetic, false, "an entry cannot opt into fixture serialization");
  assert.equal(response.main.detail, null); assert.equal(response.battlefront.detail, null);
  assert.equal(response.main.summary.stats.level, 8); assert.equal(response.main.summary.stats.credits, 34);
  assert.equal(response.main.summary.stats.rankedISR, 1024); assert.equal(response.main.summary.stats.personalEnemyKillsTotal, 5);
  assert.equal(response.battlefront.summary.stats.tokens, 56); assert.equal(response.battlefront.summary.stats.gamesPlayed, 7);
  assert.ok(!JSON.stringify(response).includes(marker));
});

test("labelled synthetic fixtures retain expanded demo detail", async () => {
  const response = await makeService().profile(FIXTURE_PLAYER_ID);
  assert.equal(response.synthetic, true); assert.equal(response.main.detailStatus, "synthetic_redacted");
  assert.ok(response.main.detail.Loadouts); assert.equal(response.main.detail.Rejoin, undefined);
});

test("redaction removes sensitive nested fields and unrelated identities, retaining progression", () => {
  const result = redactGameData({ Tokens: 4, Rejoin: "private", Nested: { api_key: "private", Valid: 5, Session: {} }, MatchHistory: [{ Players: ["private"], Outcome: "Victory" }], Receipts: [], PendingGift: {} });
  const encoded = JSON.stringify(result.data);
  assert.ok(!encoded.includes("private")); assert.ok(!encoded.includes("api_key"));
  assert.equal(result.data.Tokens, 4); assert.equal(result.data.Nested.Valid, 5); assert.equal(result.data.MatchHistory[0].Outcome, "Victory");
  assert.throws(() => redactGameData({ tree: { nested: { deep: {} } } }, { ...GAME_DATA_LIMITS, maxDepth: 1 }));
  assert.throws(() => decodeSavedProfile("main", "123", { envelope: { Data: [] } }));
  const invalidCurrency = redactGameData({ Tokens: "private", InternalNotes: "private", Email: "private", Progress: 10 });
  assert.ok(!JSON.stringify(invalidCurrency.data).includes("private"));
  assert.equal(invalidCurrency.data.Progress, 10);
  const nested = redactGameData({ Loadouts: [{ Nested: { "aPi-kEy": "sensitive-fixture", PRIVATE_message: "sensitive-fixture", Auth: { Value: "sensitive-fixture" }, AccessKeyId: "sensitive-fixture", IP: "sensitive-fixture", Valid: "Scout" } }] });
  assert.ok(!JSON.stringify(nested.data).includes("sensitive-fixture"));
  assert.equal(nested.data.Loadouts[0].Nested.Valid, "Scout");
});

test("complete cursor pagination over 1,120 tied summaries with binding, tamper and expiry protection", async () => {
  let clock = Date.now();
  const service = makeService({ now: () => clock });
  const seen = new Set(); let cursor = ""; let firstCursor;
  do {
    const page = await service.list({ mode: "main", limit: "25", ...(cursor ? { cursor } : {}) }, "admin-a");
    assert.ok(page.items.length <= 25);
    for (const row of page.items) { assert.ok(!seen.has(row.userId)); seen.add(row.userId); }
    cursor = page.nextCursor; firstCursor ??= cursor;
  } while (cursor);
  assert.equal(seen.size, 1120);
  await assert.rejects(service.list({ cursor: firstCursor }, "admin-b"), { code: "INVALID_QUERY" });
  await assert.rejects(service.list({ cursor: firstCursor, mode: "battlefront" }, "admin-a"), { code: "INVALID_QUERY" });
  await assert.rejects(service.list({ cursor: `${firstCursor}x` }, "admin-a"), { code: "INVALID_QUERY" });
  clock += GAME_DATA_LIMITS.cursorTtlMs + 1;
  await assert.rejects(service.list({ cursor: firstCursor }, "admin-a"), { code: "CURSOR_EXPIRED" });
});

test("prefix and minimum-level filters stay bounded and mode-specific", async () => {
  const service = makeService();
  const names = await service.list({ search: "PREVIEW_00", limit: "100" }, "admin");
  assert.equal(names.items.length, 99); assert.equal(names.nextCursor, null);
  assert.ok(names.items.every(row => row.identity.username.startsWith("Preview_00")));
  const levels = await service.list({ minLevel: "119", mode: "battlefront" }, "admin");
  assert.ok(levels.items.every(row => row.mode === "battlefront" && row.stats.level >= 119));
});

test("mode failures, missing profiles, single-flight cache, stale fallback and retention", async () => {
  let clock = Date.now(); let reads = 0; let fail = false;
  const reader = { async read(mode) { reads++; if (fail) throw new Error("private upstream detail"); if (mode === "battlefront") return null; return { envelope: { Data: { Level: 8 } }, revision: "opaque", updatedAt: "2025-01-01T00:00:00Z" }; } };
  const service = makeService({ reader, now: () => clock });
  const [first, other] = await Promise.all([service.profile("123"), service.profile("123")]);
  assert.equal(reads, 2); assert.equal(first.main.status, "ready"); assert.equal(other.battlefront.status, "missing");
  assert.equal(first.main.freshness.status, "saved_snapshot", "old offline saves are not themselves an outage");
  assert.equal(first.main.summary.source.checkedAt, new Date(clock).toISOString());
  clock += GAME_DATA_LIMITS.detailTtlMs + 1; fail = true;
  const stale = await service.profile("123"); assert.equal(stale.main.freshness.status, "stale"); assert.equal(stale.battlefront.status, "unavailable");
  assert.ok(!JSON.stringify(stale).includes("private upstream"));
  clock += GAME_DATA_LIMITS.staleRetentionMs; assert.equal((await service.profile("123")).main.status, "unavailable");
});

test("unconfigured, oversized and timed-out readers fail safely", async () => {
  await assert.rejects(makeService({ enabled: false }).profile("123"), { code: "VIEWER_DISABLED" });
  const huge = makeService({ limits: { ...GAME_DATA_LIMITS, maxProfileBytes: 20 } });
  assert.equal((await huge.profile(FIXTURE_PLAYER_ID)).main.code, "INVALID_PROFILE");
  const timeout = makeService({ reader: { read: () => new Promise(() => {}) }, limits: { ...GAME_DATA_LIMITS, readTimeoutMs: 5 } });
  assert.equal((await timeout.profile("123")).main.status, "unavailable");
});

test("read-only transport validates identity and exposes no write methods", async () => {
  const calls = []; const reader = createSavedEntryReader(async input => { calls.push(input); return null; });
  await reader.read("main", "123", { signal: new AbortController().signal });
  assert.equal(calls[0].mode, "main"); assert.deepEqual(Object.keys(reader), ["read"]);
  assert.throws(() => reader.read("main", "../123", {})); assert.throws(() => reader.read("other", "123", {}));
});

test("cache entry/byte budgets and concurrent reader requests remain bounded", async () => {
  let reads = 0;
  const reader = { async read() { reads++; return { envelope: { Data: { Level: 1 } } }; } };
  const smallCache = makeService({ reader, limits: { ...GAME_DATA_LIMITS, maxCacheEntries: 2 } });
  await smallCache.profile("123"); await smallCache.profile("124"); await smallCache.profile("123");
  assert.equal(reads, 6, "older mode entries were evicted");
  reads = 0;
  const noRoom = makeService({ reader, limits: { ...GAME_DATA_LIMITS, maxCacheBytes: 1 } });
  await noRoom.profile("123"); await noRoom.profile("123"); assert.equal(reads, 4);
  const releases = [];
  const busy = makeService({ reader: { read: () => new Promise(resolve => releases.push(resolve)) }, limits: { ...GAME_DATA_LIMITS, maxConcurrentReads: 2 } });
  const first = busy.profile("123");
  const denied = await busy.profile("124");
  assert.equal(denied.main.code, "READ_LIMIT"); assert.equal(releases.length, 2);
  releases.forEach(resolve => resolve(null)); await first;
});

test("index timeouts retain slots until the underlying operation settles", async () => {
  let calls = 0; let release;
  const service = makeService({ summaryIndex: { list() { calls++; return new Promise(resolve => { release = resolve; }); } }, limits: { ...GAME_DATA_LIMITS, maxConcurrentIndexReads: 1, indexReadTimeoutMs: 5 } });
  await assert.rejects(service.list({}, "admin"), { code: "INDEX_UNAVAILABLE" });
  await assert.rejects(service.list({}, "admin"), { code: "INDEX_UNAVAILABLE" });
  assert.equal(calls, 1);
  release({ items: [], coverage: {} });
  await new Promise(resolve => setImmediate(resolve));
});

test("timed-out profile reads abort, retain slots, ignore late results and do not cache them", async () => {
  const outstanding = [];
  const service = makeService({ reader: { read: (_mode, _id, { signal }) => new Promise(resolve => outstanding.push({ resolve, signal })) }, limits: { ...GAME_DATA_LIMITS, maxConcurrentReads: 2, readTimeoutMs: 5 } });
  const timeout = await service.profile("123");
  assert.equal(timeout.main.status, "unavailable");
  assert.ok(outstanding.every(read => read.signal.aborted));
  assert.equal((await service.profile("124")).main.code, "READ_LIMIT");
  outstanding.splice(0).forEach(read => read.resolve({ envelope: { Data: { Level: 999 } } }));
  await new Promise(resolve => setImmediate(resolve));
  const next = service.profile("123");
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(outstanding.length, 2, "late results did not populate the cache");
  outstanding.forEach(read => read.resolve({ envelope: { Data: { Level: 2 } } }));
  assert.equal((await next).main.summary.stats.level, 2);
});

test("disabled production mount starts without new reads or credentials, both routes remain dev protected", async t => {
  const source = await readFile(new URL("./index.mjs", import.meta.url), "utf8");
  const start = source.indexOf("const playerDataConfiguration = readGameDataConfiguration();");
  const end = source.indexOf('app.use("/api/dictionaries"', start);
  assert.ok(start >= 0 && end > start);
  const app = express(); let databaseCalls = 0;
  const db = { collection() { databaseCalls++; throw new Error("No live database in startup test"); } };
  const auth = (req, res, next) => {
    const role = req.get("X-Test-Role");
    if (!role) return res.status(401).json({ error: "Authentication required." });
    req.authSession = { role }; req.authUser = { id: `startup-${role}` }; next();
  };
  assert.equal(gameDataEnabled({}), false);
  assert.equal(gameDataEnabled({ TE_DATA_VIEWER_ENABLED: "false" }), false);
  assert.equal(gameDataEnabled({ TE_DATA_VIEWER_ENABLED: "true" }), true);
  // Execute only the actual feature mount, not the production bootstrap whose
  // pre-existing Firebase/auth startup requires real credential configuration.
  vm.runInNewContext(source.slice(start, end), { app, db, config: { cookieSecret: signingKey, appOrigin: "http://127.0.0.1:4317" }, process: { env: {} },
    createConfiguredPlayerImport, createPlayerImportRouter, requireCsrf, createGameDataService, createUnavailableProfileReader, createFirestoreSummaryIndex, createGameDataRouter, createConfiguredProfileReader,
    readGameDataConfiguration: () => readGameDataConfiguration({}), requireAuth: auth, requireRole });
  assert.equal(databaseCalls, 0);
  const server = await new Promise(resolve => { const value = app.listen(0, "127.0.0.1", () => resolve(value)); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api/admin/game-data/players`;
  for (const suffix of ["", "/123"]) {
    assert.equal((await fetch(base + suffix)).status, 401);
    assert.equal((await fetch(base + suffix, { headers: { "X-Test-Role": "member" } })).status, 403);
    const disabled = await fetch(base + suffix, { headers: { "X-Test-Role": "dev" } });
    assert.equal(disabled.status, 503); assert.equal((await disabled.json()).code, "VIEWER_DISABLED");
  }
  assert.equal(databaseCalls, 0);
});

test("enabled production mount keeps dev guards and exact reads independent of index outages", async t => {
  const source = await readFile(new URL("./index.mjs", import.meta.url), "utf8");
  const start = source.indexOf("const playerDataConfiguration = readGameDataConfiguration();");
  const end = source.indexOf('app.use("/api/dictionaries"', start);
  const app = express(); let profileCalls = 0, indexCalls = 0, clock = Date.now();
  const environment = { TE_DATA_VIEWER_ENABLED: "true", ROBLOX_UNIVERSE_ID: "123456", ROBLOX_DATASTORE_READ_API_KEY: "synthetic-dedicated-key-only",
    ROBLOX_MAIN_DATASTORE_ID: "main-resource", ROBLOX_BATTLEFRONT_DATASTORE_ID: "battlefront-resource" };
  const db = { collection() { indexCalls++; throw new Error("synthetic index outage"); } };
  const auth = (req, res, next) => {
    const role = req.get("X-Test-Role"); if (!role) return res.status(401).json({ error: "Authentication required." });
    req.authSession = { role }; req.authUser = { id: `enabled-${role}` }; next();
  };
  const configuredReader = configuration => createConfiguredProfileReader(configuration, {
    now: () => clock, wait: async ms => { clock += ms; }, random: () => 0,
    fetch: async (url, options) => {
      profileCalls++; assert.equal(options.headers["x-api-key"], environment.ROBLOX_DATASTORE_READ_API_KEY);
      return new Response(JSON.stringify({ path: new URL(url).pathname.slice("/cloud/v2/".length), value: { Data: { Level: 8, Unexpected: { Label: "synthetic-private-value" } } } }), { headers: { "content-type": "application/json" } });
    },
  });
  vm.runInNewContext(source.slice(start, end), { app, db, config: { cookieSecret: signingKey, appOrigin: "http://127.0.0.1:4317" }, process: { env: {} },
    createConfiguredPlayerImport, createPlayerImportRouter, requireCsrf, createGameDataService, createConfiguredProfileReader: configuredReader,
    createFirestoreSummaryIndex, createGameDataRouter, readGameDataConfiguration: () => readGameDataConfiguration(environment), requireAuth: auth, requireRole });
  assert.equal(profileCalls, 0); assert.equal(indexCalls, 0, "startup performs no reads even when fully configured");
  const server = await new Promise(resolve => { const value = app.listen(0, "127.0.0.1", () => resolve(value)); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api/admin/game-data/players`;
  for (const suffix of ["", "/123"]) {
    assert.equal((await fetch(base + suffix)).status, 401);
    for (const role of ["member", "qa", "leadqa"]) assert.equal((await fetch(base + suffix, { headers: { "X-Test-Role": role } })).status, 403);
  }
  assert.equal(profileCalls, 0); assert.equal(indexCalls, 0);
  const options = { headers: { "X-Test-Role": "dev" } };
  assert.equal((await fetch(`${base}/invalid`, options)).status, 400); assert.equal(profileCalls, 0);
  assert.equal((await fetch(base, options)).status, 503); assert.equal(indexCalls, 1);
  const result = await (await fetch(`${base}/123`, options)).json();
  assert.equal(result.main.status, "ready"); assert.equal(result.battlefront.status, "ready");
  assert.equal(result.main.summary.source.updatedAt, null); assert.equal(result.main.detail, null);
  assert.ok(!JSON.stringify(result).includes("synthetic-private-value")); assert.equal(profileCalls, 2); assert.equal(indexCalls, 1);
});

test("aborted HTTP clients do not cause response writes after close or affect later requests", async t => {
  let resolveFirst; let calls = 0;
  let started;
  const began = new Promise(resolve => { started = resolve; });
  const app = express();
  const auth = (req, _res, next) => { req.authUser = { id: "abort-test" }; next(); };
  app.use("/data", createGameDataRouter({ service: { profile: async () => {
    calls++;
    if (calls > 1) return { userId: "124" };
    started(); return new Promise(resolve => { resolveFirst = resolve; });
  } }, requireAuth: auth, requireAdmin: (_req, _res, next) => next() }));
  const server = await new Promise(resolve => { const value = app.listen(0, "127.0.0.1", () => resolve(value)); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/data/players`;
  const controller = new AbortController();
  const aborted = fetch(`${base}/123`, { signal: controller.signal });
  const rejection = assert.rejects(aborted, error => error.name === "AbortError");
  await began; controller.abort(); await rejection;
  resolveFirst({ userId: "123" });
  const later = await fetch(`${base}/124`); assert.equal(later.status, 200);
  assert.equal((await later.json()).userId, "124");
});

test("actual production authentication ignores the synthetic preview cookie on both routes", async t => {
  const app = express(); let calls = 0;
  app.use("/data", createGameDataRouter({ service: { list: async () => { calls++; return {}; }, profile: async () => { calls++; return {}; } }, requireAuth, requireAdmin: requireRole("dev") }));
  const server = await new Promise(resolve => { const value = app.listen(0, "127.0.0.1", () => resolve(value)); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/data/players`;
  for (const suffix of ["", "/123"]) {
    assert.equal((await fetch(base + suffix, { headers: { Cookie: "player_preview_role=dev", "X-Test-Role": "dev" } })).status, 401);
  }
  assert.equal(calls, 0);
});

test("Firestore list uses bounded projection, stable snapshot, cursor and only reads", async () => {
  const calls = [];
  const query = {};
  for (const method of ["where", "orderBy", "select", "limit", "atReadTime", "startAfter"]) query[method] = (...args) => { calls.push([method, ...args]); return query; };
  query.get = async () => ({ docs: [] });
  const index = createFirestoreSummaryIndex({ collection: name => { calls.push(["collection", name]); return query; } });
  await index.list(parsePlayerQuery({ minLevel: "20" }), { snapshotAt: "2026-10-11T00:00:00Z", after: [20, "main:123"] });
  assert.ok(calls.some(call => call[0] === "limit" && call[1] === 26));
  assert.ok(calls.some(call => call[0] === "atReadTime")); assert.ok(calls.some(call => call[0] === "startAfter" && call[2] === "tePlayerSummaries/main:123"));
  assert.ok(!calls.some(call => ["set", "update", "delete"].includes(call[0])));
});

test("real server role guard rejects anonymous/member/QA/leadQA; dev allowed; errors/rate limits safe", async t => {
  const app = express(); let calls = 0;
  const auth = (req, res, next) => { const role = req.get("X-Test-Role"); if (!role) return res.status(401).json({ error: "Authentication required." }); req.authSession = { role }; req.authUser = { id: `fixture-${role}` }; next(); };
  app.use("/data", createGameDataRouter({ service: { list: async () => { calls++; return {}; }, profile: async id => { validatePlayerId(id); calls++; return {}; } }, requireAuth: auth, requireAdmin: requireRole("dev"), requestsPerMinute: 4 }));
  const server = await new Promise(resolve => { const value = app.listen(0, "127.0.0.1", () => resolve(value)); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/data/players`;
  for (const path of ["", "/123"]) {
    assert.equal((await fetch(base + path)).status, 401);
    for (const role of ["member", "qa", "leadqa"]) assert.equal((await fetch(base + path, { headers: { "X-Test-Role": role } })).status, 403);
  }
  assert.equal(calls, 0);
  const options = { headers: { "X-Test-Role": "dev" } };
  assert.equal((await fetch(base, options)).status, 200);
  assert.equal((await fetch(`${base}/123`, options)).headers.get("cache-control"), "no-store");
  assert.equal((await fetch(`${base}/0`, options)).status, 400);
  assert.equal((await fetch(base, options)).status, 200);
  assert.equal((await fetch(base, options)).status, 429);
  assert.throws(() => createGameDataRouter({ service: {} }));
});

test("production mounting has established auth and no synthetic fixture import", async () => {
  const source = await readFile(new URL("./index.mjs", import.meta.url), "utf8");
  assert.match(source, /requireAdmin: requireRole\("dev"\)/);
  assert.ok(!source.includes("game-data-fixtures") && !source.includes("player-preview"));
  assert.ok(source.includes("createConfiguredProfileReader(playerDataConfiguration)"), "configured reader is wired through the disabled gate");
});
