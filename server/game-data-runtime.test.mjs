import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readGameDataConfiguration, readRobloxDataStoreConfig, gameDataEnabled } from "./game-data-config.mjs";
import { createConfiguredProfileReader } from "./game-data-runtime.mjs";
import { createGameDataService } from "./game-data-service.mjs";
import { runPlayerDataCheck } from "../scripts/player-data-check.mjs";

const secret = "synthetic-dedicated-secret-never-log";
const environment = () => ({ TE_DATA_VIEWER_ENABLED: "true", ROBLOX_UNIVERSE_ID: "123456", ROBLOX_DATASTORE_READ_API_KEY: secret,
  ROBLOX_MAIN_DATASTORE_ID: "configured-main", ROBLOX_BATTLEFRONT_DATASTORE_ID: "configured-battlefront", ROBLOX_OPEN_CLOUD_API_KEY: "synthetic-analytics-only" });
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
const clock = () => { let value = Date.now(); return { now: () => value, wait: async ms => { value += ms; }, random: () => 0 }; };
const profile = url => ({ path: new URL(url).pathname.slice("/cloud/v2/".length), state: "ACTIVE", value: { Data: { Level: 5, Credits: 10, Tokens: 20, Unknown: { Note: secret } } } });

test("disabled configuration never inspects secrets/IDs and constructs no request dependency", async () => {
  const disabled = new Proxy({}, { get(_target, key) { if (key === "TE_DATA_VIEWER_ENABLED") return undefined; throw new Error("Disabled startup inspected private configuration"); } });
  assert.deepEqual(readGameDataConfiguration(disabled), { enabled: false, readerConfig: null });
  const reader = createConfiguredProfileReader(readGameDataConfiguration(disabled), { fetch: () => { throw new Error("No calls"); } });
  await assert.rejects(reader.read("main", "123"), { code: "READER_NOT_CONNECTED" });
  assert.equal(gameDataEnabled({ TE_DATA_VIEWER_ENABLED: "false" }), false);
  assert.throws(() => gameDataEnabled({ TE_DATA_VIEWER_ENABLED: "TRUE" }), { code: "INVALID_PLAYER_DATA_CONFIG" });
});

test("enabled config requires every explicit value, isolates analytics and reports only variable names", () => {
  const valid = environment();
  for (const variable of ["ROBLOX_UNIVERSE_ID", "ROBLOX_DATASTORE_READ_API_KEY", "ROBLOX_MAIN_DATASTORE_ID", "ROBLOX_BATTLEFRONT_DATASTORE_ID"]) {
    const missing = { ...valid }; delete missing[variable];
    assert.throws(() => readGameDataConfiguration(missing), error => error.code === "INVALID_PLAYER_DATA_CONFIG" && error.variable === variable);
  }
  for (const [variable, value] of [["ROBLOX_UNIVERSE_ID", "not-an-id-private-value"], ["ROBLOX_DATASTORE_READ_API_KEY", "REPLACE_private_secret"],
    ["ROBLOX_DATASTORE_READ_API_KEY", "short"], ["ROBLOX_DATASTORE_READ_API_KEY", `${secret}\n`], ["ROBLOX_DATASTORE_READ_API_KEY", "x".repeat(8193)],
    ["ROBLOX_MAIN_DATASTORE_ID", "../private-value"], ["ROBLOX_MAIN_DATASTORE_ID", "malformed\ud800"], ["ROBLOX_BATTLEFRONT_DATASTORE_ID", valid.ROBLOX_MAIN_DATASTORE_ID]]) {
    assert.throws(() => readGameDataConfiguration({ ...valid, [variable]: value }), error => {
      assert.ok(!error.message.includes(value)); assert.ok(!JSON.stringify(error).includes(secret)); return error.variable === variable;
    });
  }
  const config = readGameDataConfiguration(valid);
  assert.equal(config.readerConfig.apiKey, secret); assert.equal(config.readerConfig.stores.main.scopeId, "global");
  assert.ok(!JSON.stringify(config).includes("synthetic-analytics-only"));
});

test("enabled exact lookup uses dedicated GET reads with no index access and withholds detail", async () => {
  const calls = []; let indexCalls = 0;
  const reader = createConfiguredProfileReader(readGameDataConfiguration(environment()), { ...clock(), fetch: async (url, options) => {
    calls.push({ url, options }); return json(profile(url));
  } });
  const service = createGameDataService({ reader, summaryIndex: { list() { indexCalls++; throw new Error("Index unavailable"); } }, cursorSecret: "synthetic-cursor-key-only" });
  const result = await service.profile("123");
  assert.equal(result.main.status, "ready"); assert.equal(result.battlefront.status, "ready"); assert.equal(indexCalls, 0);
  assert.equal(result.main.detail, null); assert.equal(result.main.summary.stats.level, 5); assert.equal(result.battlefront.summary.stats.tokens, 20);
  assert.equal(result.main.summary.source.updatedAt, null); assert.ok(!JSON.stringify(result).includes(secret));
  assert.ok(calls.every(call => call.options.method === "GET" && call.options.headers["x-api-key"] === secret));
  await assert.rejects(service.list({}, "admin")); assert.equal(indexCalls, 1);
  assert.equal((await service.profile("123")).main.status, "ready"); assert.equal(calls.length, 2, "exact lookup retains its separate cache");
});

test("diagnostic argument/confirmation/viewer gates never load secrets or make requests", async () => {
  let calls = 0;
  const input = { environment: new Proxy({}, { get() { throw new Error("private-value"); } }), fetch: async () => { calls++; } };
  for (const argv of [[], ["smoke"], ["discover"], ["discover", "--key", secret], ["smoke", "--user-id", "123"]]) {
    const result = await runPlayerDataCheck({ ...input, argv }); assert.equal(result.ok, false); assert.ok(!JSON.stringify(result).includes(secret));
  }
  const enabled = await runPlayerDataCheck({ ...input, environment: environment(), argv: ["discover", "--confirm-read-only"] });
  assert.equal(enabled.code, "VIEWER_MUST_BE_DISABLED"); assert.equal(calls, 0);
  assert.equal((await runPlayerDataCheck({ ...input, argv: ["--help"] })).ok, true);
});

test("discovery makes two bounded metadata requests and filters arbitrary fields/stores/tokens", async () => {
  const calls = [], env = { ...environment(), TE_DATA_VIEWER_ENABLED: "false" };
  delete env.ROBLOX_MAIN_DATASTORE_ID; delete env.ROBLOX_BATTLEFRONT_DATASTORE_ID;
  const result = await runPlayerDataCheck({ argv: ["discover", "--confirm-read-only"], environment: env, ...clock(), fetch: async (url, options) => {
    calls.push({ url, options });
    const name = new URL(url).searchParams.get("filter").includes("V24") ? "PlayerData V24" : "PlayerData V1_battlefront";
    return json({ dataStores: [{ id: name, path: `universes/123456/data-stores/${name}`, Extra: secret }, { id: secret }], Unexpected: secret });
  } });
  assert.equal(result.ok, true); assert.equal(calls.length, 2); assert.ok(!JSON.stringify(result).includes(secret));
  assert.ok(calls.every(call => new URL(call.url).searchParams.get("maxPageSize") === "25" && call.options.method === "GET"));
  assert.deepEqual(result.stores.map(store => store.resourceId), ["PlayerData V24", "PlayerData V1_battlefront"]);
  assert.equal(result.universeOwnershipVerified, false);
});

test("discovery stops at one page per name and treats missing mapping/malformed paths conservatively", async () => {
  for (const response of [{ nextPageToken: secret }, { dataStores: [] }, { dataStores: [{ id: "PlayerData V24", path: "universes/999/data-stores/PlayerData V24" }] }, { dataStores: Array(26).fill({}) }]) {
    let calls = 0;
    const result = await runPlayerDataCheck({ argv: ["discover", "--confirm-read-only"], environment: { ...environment(), TE_DATA_VIEWER_ENABLED: "false" }, ...clock(), fetch: async () => { calls++; return json(response); } });
    assert.equal(result.ok, false); assert.ok(calls <= 2); assert.ok(!JSON.stringify(result).includes(secret));
  }
});

test("smoke reads one supplied owner in two modes and emits only safe metadata", async () => {
  const calls = [];
  const result = await runPlayerDataCheck({ argv: ["smoke", "--user-id", "123", "--confirm-read-only"], environment: { ...environment(), TE_DATA_VIEWER_ENABLED: "false" }, ...clock(),
    fetch: async (url, options) => { calls.push({ url, options }); return json(profile(url)); } });
  assert.equal(result.ok, true); assert.equal(calls.length, 2);
  assert.ok(calls.every(call => new URL(call.url).pathname.endsWith("/entries/123")));
  assert.ok(result.modes.every(mode => mode.profileEnvelopeValid && mode.saveTimestamp === null && !mode.revisionPresent && mode.expandedDetailReturned === false));
  for (const value of [secret, "Unknown", "Credits", "Level", "x-api-key", "synthetic-analytics-only"]) assert.ok(!JSON.stringify(result).includes(value));
});

test("smoke distinguishes explicit deletion from 404/access failures and masks upstream errors", async () => {
  for (const status of [401, 403, 404]) {
    const result = await runPlayerDataCheck({ argv: ["smoke", "--user-id", "123", "--confirm-read-only"], environment: { ...environment(), TE_DATA_VIEWER_ENABLED: "false" }, ...clock(), fetch: async () => json({ message: secret }, status) });
    assert.equal(result.ok, false); assert.ok(result.modes.every(mode => mode.status === "unavailable")); assert.ok(!JSON.stringify(result).includes(secret));
  }
  const deleted = await runPlayerDataCheck({ argv: ["smoke", "--user-id", "123", "--confirm-read-only"], environment: { ...environment(), TE_DATA_VIEWER_ENABLED: "false" }, ...clock(), fetch: async url => json({ path: profile(url).path, state: "DELETED" }) });
  assert.equal(deleted.ok, false); assert.ok(deleted.modes.every(mode => mode.status === "missing"));
});

test("smoke rejects malformed config/owner IDs with no request and safe names only", async () => {
  let calls = 0;
  for (const userId of ["../123", "0", "01", secret]) {
    const result = await runPlayerDataCheck({ argv: ["smoke", "--user-id", userId, "--confirm-read-only"], environment: { ...environment(), TE_DATA_VIEWER_ENABLED: "false" }, fetch: async () => { calls++; } });
    assert.equal(result.code, "INVALID_PLAYER_ID"); assert.ok(!JSON.stringify(result).includes(secret));
  }
  const result = await runPlayerDataCheck({ argv: ["smoke", "--user-id", "123", "--confirm-read-only"], environment: { TE_DATA_VIEWER_ENABLED: "false", ROBLOX_UNIVERSE_ID: "123456" }, fetch: async () => { calls++; } });
  assert.equal(result.code, "INVALID_PLAYER_DATA_CONFIG"); assert.equal(result.variable, "ROBLOX_DATASTORE_READ_API_KEY"); assert.equal(calls, 0);
  assert.equal(readRobloxDataStoreConfig({ ...environment(), ROBLOX_MAIN_DATASTORE_ID: undefined }, { includeStores: false }).apiKey, secret);
});

test("diagnostic cancellation stops a pending request and does not start another mode", async () => {
  const controller = new AbortController(); let calls = 0;
  const pending = runPlayerDataCheck({ argv: ["smoke", "--user-id", "123", "--confirm-read-only"], environment: { ...environment(), TE_DATA_VIEWER_ENABLED: "false" }, signal: controller.signal,
    fetch: async () => { calls++; return new Promise(() => {}); } });
  await new Promise(resolve => setImmediate(resolve)); controller.abort();
  const result = await pending; assert.equal(result.ok, false); assert.equal(result.modes[0].code, "READ_ABORTED"); assert.equal(calls, 1);
  assert.ok(!JSON.stringify(result).includes(secret));
});

test("diagnostic response bytes and transient retries remain bounded without printing bodies", async () => {
  const input = { environment: { ...environment(), TE_DATA_VIEWER_ENABLED: "false" }, ...clock() };
  const oversized = await runPlayerDataCheck({ ...input, argv: ["discover", "--confirm-read-only"], fetch: async () => json({ dataStores: [], Unknown: secret.repeat(3000) }) });
  assert.equal(oversized.code, "INVALID_PROFILE"); assert.ok(!JSON.stringify(oversized).includes(secret));
  let calls = 0;
  const outage = await runPlayerDataCheck({ ...input, argv: ["smoke", "--user-id", "123", "--confirm-read-only"], fetch: async () => { calls++; return json({ message: secret }, 503); } });
  assert.equal(calls, 6); assert.equal(outage.ok, false); assert.ok(!JSON.stringify(outage).includes(secret));
});

test("runnable CLI loads a synthetic private env file without argv/output disclosure or networking", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "te-host-check-fixture-"));
  try {
    const envFile = path.join(directory, "fixture.env"), guardFile = path.join(directory, "network-guard.mjs");
    const marker = "synthetic private marker with spaces";
    writeFileSync(envFile, `TE_DATA_VIEWER_ENABLED=false\nROBLOX_UNIVERSE_ID=123456\nROBLOX_DATASTORE_READ_API_KEY="${marker}"\n`, { mode: 0o600 });
    writeFileSync(guardFile, 'globalThis.fetch = () => { throw new Error("Network is forbidden in this fixture"); };\n');
    const script = fileURLToPath(new URL("../scripts/player-data-check.mjs", import.meta.url));
    const args = [`--env-file=${envFile}`, `--import=${guardFile}`, script, "smoke", "--user-id", "123", "--confirm-read-only"];
    const environment = { PATH: process.env.PATH, NODE_ENV: "test", DOTENV_CONFIG_PATH: "/dev/null" };
    const invalid = spawnSync(process.execPath, args, { env: environment, encoding: "utf8", timeout: 5000 });
    assert.equal(invalid.status, 1); assert.equal(invalid.stderr, "");
    assert.equal(JSON.parse(invalid.stdout).variable, "ROBLOX_DATASTORE_READ_API_KEY");
    assert.ok(!invalid.stdout.includes(marker)); assert.ok(!args.some(argument => argument.includes(marker)));
    const overridden = spawnSync(process.execPath, args, { env: { ...environment, TE_DATA_VIEWER_ENABLED: "true" }, encoding: "utf8", timeout: 5000 });
    assert.equal(overridden.status, 1); assert.equal(JSON.parse(overridden.stdout).code, "VIEWER_MUST_BE_DISABLED");
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
