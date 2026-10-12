import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRobloxProfileReader } from "./roblox-profile-reader.mjs";
import { createGameDataService } from "./game-data-service.mjs";
import { GAME_DATA_LIMITS } from "./game-data-config.mjs";

const config = () => ({ universeId: "123456", apiKey: "synthetic-transport-key-only",
  stores: { main: { dataStoreId: "configured-main-resource", scopeId: "configured-scope" },
    battlefront: { dataStoreId: "configured-battlefront-resource", scopeId: "global" } } });
const pathOf = url => new URL(url).pathname.slice("/cloud/v2/".length).split("/").map(decodeURIComponent).join("/");
const entry = (path, extra = {}) => ({ path, id: path.split("/").at(-1), state: "ACTIVE", revisionId: "opaque-revision",
  revisionCreateTime: "2026-10-10T09:30:00Z", createTime: "2025-01-01T00:00:00Z",
  value: { Data: { Level: 8, Games_Played: 10 }, MetaData: { ActiveSession: ["synthetic-private-session"] } },
  users: ["users/987"], attributes: { Notes: "synthetic-private-attribute" }, etag: "private-etag", ...extra });
const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", ...headers } });
function fakeClock() {
  let clock = Date.parse("2026-10-11T00:00:00Z"); const delays = [];
  return { now: () => clock, wait: async (ms, signal) => { assert.equal(signal.aborted, false); delays.push(ms); clock += ms; }, random: () => 0, delays };
}

test("Open Cloud reader requires explicit injected configuration, is inert and exposes only read", async () => {
  let calls = 0;
  const request = async url => { calls++; return json(entry(pathOf(url))); };
  for (const invalid of [undefined, {}, { ...config(), universeId: 123 }, { ...config(), apiKey: "" },
    { ...config(), stores: { main: { name: "PlayerData V24", scopeId: "global" } } },
    { ...config(), stores: { ...config().stores, main: { dataStoreId: "../resource", scopeId: "global" } } },
    { ...config(), timeoutMs: 10001 }, { ...config(), requestsPerMinute: 0 }]) {
    assert.throws(() => createRobloxProfileReader({ fetch: request, config: invalid }), { code: "READER_NOT_CONFIGURED" });
  }
  assert.throws(() => createRobloxProfileReader({ config: config() }), { code: "READER_NOT_CONFIGURED" });
  const reader = createRobloxProfileReader({ fetch: request, config: config(), ...fakeClock() });
  assert.deepEqual(Object.keys(reader), ["read"]); assert.equal(calls, 0);
  await assert.rejects(reader.read("main", "../123"), { code: "INVALID_PLAYER_ID" });
  await assert.rejects(reader.read("other", "123"), { code: "INVALID_MODE" });
  assert.equal(calls, 0);
});

test("mock HTTP requests use exact configured resources, GET only and official revision metadata", async () => {
  const calls = [], options = config(); options.stores.main.dataStoreId = "explicit resource ID";
  const reader = createRobloxProfileReader({ config: options, ...fakeClock(), fetch: async (url, init) => {
    calls.push({ url, init }); return json(entry(pathOf(url)));
  } });
  options.stores.main.dataStoreId = "changed-after-construction";
  const main = await reader.read("main", "123"), battlefront = await reader.read("battlefront", "123");
  assert.equal(calls[0].url, "https://apis.roblox.com/cloud/v2/universes/123456/data-stores/explicit%20resource%20ID/scopes/configured-scope/entries/123");
  assert.match(calls[1].url, /data-stores\/configured-battlefront-resource\/scopes\/global\/entries\/123$/);
  for (const { init } of calls) {
    assert.equal(init.method, "GET"); assert.equal(init.body, undefined); assert.equal(init.redirect, "error");
    assert.equal(init.credentials, "omit"); assert.equal(init.headers["x-api-key"], "synthetic-transport-key-only");
    assert.ok(init.signal instanceof AbortSignal);
  }
  assert.equal(main.revision, "opaque-revision"); assert.equal(main.updatedAt, "2026-10-10T09:30:00.000Z");
  assert.equal(battlefront.envelope.Data.Level, 8);
  assert.deepEqual(Object.keys(main).sort(), ["envelope", "revision", "updatedAt"]);
  assert.ok(!JSON.stringify(main).includes("synthetic-private-attribute"));
});

test("mock transport plus real service never discloses arbitrary live-shaped Data", async () => {
  const marker = "private-text-under-an-unknown-label";
  const reader = createRobloxProfileReader({ config: config(), ...fakeClock(), fetch: async url => json(entry(pathOf(url), {
    value: { Data: { Level: 9, Credits: 17, Tokens: 28, Account: { GamesPlayed: 4, Label: marker },
      Loadouts: [{ Name: marker, Child: { Unexpected: marker, credential: marker } }] }, MetaData: { ActiveSession: [marker] } },
  })) });
  const service = createGameDataService({ reader, summaryIndex: { list: async () => ({ items: [] }) }, cursorSecret: "synthetic-cursor-test-key" });
  const result = await service.profile("123");
  assert.equal(result.synthetic, false); assert.equal(result.main.detail, null); assert.equal(result.battlefront.detail, null);
  assert.equal(result.main.summary.stats.level, 9); assert.equal(result.main.summary.stats.credits, 17);
  assert.equal(result.battlefront.summary.stats.tokens, 28); assert.equal(result.battlefront.summary.stats.gamesPlayed, 4);
  assert.ok(!JSON.stringify(result).includes(marker));
});

test("missing/deleted/wrong-resource/state and response metadata fail conservatively", async () => {
  const mutations = [body => ({ ...body, path: body.path.replace("123456", "999") }), body => ({ ...body, id: "124" }),
    body => ({ ...body, state: "BOGUS" }), body => ({ ...body, value: { Data: [] } }),
    body => ({ ...body, revisionId: 123 }), body => ({ ...body, revisionCreateTime: "not-a-time" })];
  for (const mutate of mutations) {
    const reader = createRobloxProfileReader({ config: config(), ...fakeClock(), fetch: async url => json(mutate(entry(pathOf(url)))) });
    await assert.rejects(reader.read("main", "123"), { code: "INVALID_PROFILE" });
  }
  const deleted = createRobloxProfileReader({ config: config(), fetch: async url => json({ path: pathOf(url), state: "DELETED" }) });
  assert.equal(await deleted.read("main", "123"), null);
  const absent = createRobloxProfileReader({ config: config(), fetch: async () => json({ code: "NOT_FOUND", message: "upstream-private-error" }, 404) });
  await assert.rejects(absent.read("main", "123"), error => error.code === "READ_UNAVAILABLE" && !error.message.includes("upstream-private"));
});

test("documented path/state/optional-metadata variants preserve request identity and unknown freshness", async () => {
  for (const variant of ["unscoped", "qualified", "encoded-qualified", "omitted", "unspecified"]) {
    const options = config(); options.stores.main.scopeId = "global";
    const reader = createRobloxProfileReader({ config: options, ...fakeClock(), fetch: async url => {
      const body = entry(pathOf(url)); delete body.revisionId; delete body.revisionCreateTime;
      if (variant === "unscoped") body.path = body.path.replace("/scopes/global", "");
      if (variant === "qualified") { body.path = body.path.replace("/scopes/global/entries/", "/entries/global/"); body.id = "global/123"; }
      if (variant === "encoded-qualified") { body.path = body.path.replace("/scopes/global/entries/123", "/entries/global%2F123"); body.id = "global/123"; }
      if (variant === "omitted") { delete body.path; delete body.id; delete body.state; }
      if (variant === "unspecified") body.state = "STATE_UNSPECIFIED";
      return json(body);
    } });
    const result = await reader.read("main", "123"); assert.equal(result.revision, null); assert.equal(result.updatedAt, null); assert.equal(result.envelope.Data.Level, 8);
  }
  const wrongScope = createRobloxProfileReader({ config: config(), fetch: async url => json(entry(pathOf(url).replace("/scopes/configured-scope", ""))) });
  await assert.rejects(wrongScope.read("main", "123"), { code: "INVALID_PROFILE" });
});

test("bounded stream parsing rejects oversized, malformed, non-JSON, deep and wide responses", async () => {
  let cancelled = 0;
  const overBudget = new Response(new ReadableStream({ start(controller) {
    controller.enqueue(new Uint8Array(GAME_DATA_LIMITS.maxProfileBytes + 65537));
  }, cancel() { cancelled++; } }), { headers: { "content-type": "application/json" } });
  const responses = [overBudget, json({}, 200, { "content-length": String(GAME_DATA_LIMITS.maxProfileBytes + 65537) }),
    new Response("{malformed", { headers: { "content-type": "application/json" } }), new Response("private response text"),
    new Response(new Uint8Array([0xff]), { headers: { "content-type": "application/json" } })];
  for (const response of responses) {
    const reader = createRobloxProfileReader({ config: config(), fetch: async () => response });
    await assert.rejects(reader.read("main", "123"), { code: "INVALID_PROFILE" });
  }
  assert.equal(cancelled, 1);
  for (const kind of ["deep", "wide", "envelopeBytes"]) {
    let data = {};
    if (kind === "deep") { let cursor = data; for (let index = 0; index < 25; index++) cursor = cursor.Child = {}; }
    if (kind === "wide") data.List = Array(100001).fill(0);
    if (kind === "envelopeBytes") data.Label = "x".repeat(GAME_DATA_LIMITS.maxProfileBytes);
    const reader = createRobloxProfileReader({ config: config(), fetch: async url => json(entry(pathOf(url), { value: { Data: data } })) });
    await assert.rejects(reader.read("main", "123"), { code: "INVALID_PROFILE" });
  }
});

test("rate pacing, Retry-After seconds/date and transient backoff remain bounded", async () => {
  for (const retryAfter of ["2", "Sun, 11 Oct 2026 00:00:02 GMT"]) {
    const clock = fakeClock(), starts = []; let count = 0;
    const reader = createRobloxProfileReader({ config: config(), ...clock, fetch: async url => {
      starts.push(clock.now()); return ++count === 1 ? json({}, 429, { "Retry-After": retryAfter }) : json(entry(pathOf(url)));
    } });
    await reader.read("main", "123"); await reader.read("battlefront", "123");
    assert.equal(count, 3); assert.ok(starts[1] - starts[0] >= 2000); assert.ok(starts[2] - starts[1] >= 1000);
  }
  const clock = fakeClock(); let calls = 0;
  const reader = createRobloxProfileReader({ config: config(), ...clock, fetch: async url => ++calls < 3 ? json({}, 503) : json(entry(pathOf(url))) });
  assert.equal((await reader.read("main", "123")).envelope.Data.Level, 8); assert.equal(calls, 3);
  assert.ok(clock.delays.includes(250) && clock.delays.includes(500));
});

test("HTTP access errors, retry exhaustion and long cooldown never leak raw error bodies", async () => {
  for (const status of [401, 403, 404, 500, 502, 503, 504, 429]) {
    let calls = 0;
    const reader = createRobloxProfileReader({ config: config(), ...fakeClock(), fetch: async () => {
      calls++; return json({ message: "synthetic-secret-upstream", requestHeaders: { "x-api-key": "synthetic-transport-key-only" } }, status);
    } });
    await assert.rejects(reader.read("main", "123"), error => {
      assert.equal(error.status, 503); assert.ok(!JSON.stringify(error).includes("synthetic-secret"));
      assert.ok(!error.message.includes("synthetic-transport-key")); return true;
    });
    assert.equal(calls, [401, 403, 404].includes(status) ? 1 : 3);
  }
  let calls = 0; const clock = fakeClock();
  const reader = createRobloxProfileReader({ config: config(), ...clock, fetch: async () => { calls++; return json({}, 429, { "Retry-After": "120" }); } });
  await assert.rejects(reader.read("main", "123"), { code: "READ_RATE_LIMITED" });
  await assert.rejects(reader.read("main", "124"), { code: "READ_RATE_LIMITED" });
  assert.equal(calls, 1, "shared cooldown is respected without early retry or long waits");
});

test("abort before request, during fetch/body/backoff, and own deadline cancel promptly", async () => {
  const already = new AbortController(); already.abort(); let calls = 0;
  const reader = createRobloxProfileReader({ config: config(), fetch: async () => { calls++; return json({}); } });
  await assert.rejects(reader.read("main", "123", { signal: already.signal }), { code: "READ_ABORTED" }); assert.equal(calls, 0);
  for (const stage of ["fetch", "body", "backoff"]) {
    const caller = new AbortController(); let cancelled = false;
    const transport = createRobloxProfileReader({ config: config(), fetch: async (_url, init) => {
      assert.equal(init.signal.aborted, false);
      if (stage === "fetch") return new Promise(() => {});
      if (stage === "body") return new Response(new ReadableStream({ cancel() { cancelled = true; } }), { headers: { "content-type": "application/json" } });
      return json({}, 429, { "Retry-After": "2" });
    } });
    const pending = transport.read("main", "123", { signal: caller.signal });
    await new Promise(resolve => setTimeout(resolve, 5)); caller.abort();
    await assert.rejects(pending, { code: "READ_ABORTED" });
    if (stage === "body") assert.equal(cancelled, true);
  }
  let signal;
  const deadline = createRobloxProfileReader({ config: { ...config(), timeoutMs: 5 }, fetch: async (_url, init) => { signal = init.signal; return new Promise(() => {}); } });
  await assert.rejects(deadline.read("main", "123"), { code: "READ_ABORTED" }); assert.equal(signal.aborted, true);
});

test("ignored fetch cancellation retains bounded underlying slots and network errors have limited retries", async () => {
  const clock = fakeClock(), releases = [], caller = new AbortController();
  const reader = createRobloxProfileReader({ config: { ...config(), requestsPerMinute: 300 }, ...clock,
    fetch: url => new Promise(resolve => releases.push(() => resolve(json(entry(pathOf(url)))))) });
  const pending = Array.from({ length: 8 }, (_, index) => reader.read("main", String(123 + index), { signal: caller.signal }).catch(error => error));
  await new Promise(resolve => setImmediate(resolve)); assert.equal(releases.length, 8); caller.abort();
  for (const result of await Promise.all(pending)) assert.equal(result.code, "READ_ABORTED");
  await assert.rejects(reader.read("main", "999"), { code: "READ_LIMIT" }); assert.equal(releases.length, 8);
  releases.forEach(release => release()); await new Promise(resolve => setImmediate(resolve));
  let calls = 0;
  const offline = createRobloxProfileReader({ config: config(), ...fakeClock(), fetch: async () => { calls++; throw new Error("private-network-detail"); } });
  await assert.rejects(offline.read("main", "123"), error => error.code === "READ_UNAVAILABLE" && !error.message.includes("private-network"));
  assert.equal(calls, 3);
});

test("concurrency also bounds responses that returned headers but are still streaming", async () => {
  const clock = fakeClock(), caller = new AbortController(); let calls = 0, cancelled = 0;
  const reader = createRobloxProfileReader({ config: { ...config(), requestsPerMinute: 300 }, ...clock,
    fetch: async () => { calls++; return new Response(new ReadableStream({ cancel() { cancelled++; } }), { headers: { "content-type": "application/json" } }); } });
  const pending = Array.from({ length: 8 }, (_, index) => reader.read("main", String(123 + index), { signal: caller.signal }).catch(error => error));
  await new Promise(resolve => setImmediate(resolve)); assert.equal(calls, 8);
  await assert.rejects(reader.read("main", "999"), { code: "READ_LIMIT" }); assert.equal(calls, 8);
  caller.abort();
  for (const result of await Promise.all(pending)) assert.equal(result.code, "READ_ABORTED");
  assert.equal(cancelled, 8);
});

test("production selects the configured reader through its default-off gate", async () => {
  const source = await readFile(new URL("./index.mjs", import.meta.url), "utf8");
  assert.ok(source.includes("reader: createConfiguredProfileReader(playerDataConfiguration)"));
  assert.ok(source.includes("enabled: playerDataConfiguration.enabled"));
});
