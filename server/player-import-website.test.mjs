import test from "node:test";
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { createServer } from "node:net";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { PLAYER_IMPORT_JOB_PATH } from "./player-import-store.mjs";
import { DAILY_IMPORT_CHUNK, planDailyImport } from "./player-import-schedule.mjs";

const index = fileURLToPath(new URL("./index.mjs", import.meta.url));
const bootstrap = fileURLToPath(new URL("./testing/register-player-import-website-fixtures.mjs", import.meta.url));
const start = Date.parse("2026-10-12T03:00:00.000Z");
async function freePort() {
  const server = createServer();
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
function launch(directory, port, { enabled = false, hold = false, now = start } = {}) {
  const child = fork(index, [], {
    cwd: directory,
    execArgv: ["--import", bootstrap],
    env: {
      PATH: process.env.PATH, NODE_ENV: "test", PORT: String(port), APP_ORIGIN: `http://127.0.0.1:${port}`,
      DISCORD_REDIRECT_URI: `http://127.0.0.1:${port}/api/auth/discord/callback`,
      DISCORD_CLIENT_ID: "100000000000000001", DISCORD_CLIENT_SECRET: "synthetic-discord-client-secret-only",
      DISCORD_GUILD_ID: "100000000000000002", DISCORD_ROLE_LEADQA_ID: "100000000000000005",
      DISCORD_ROLE_QA_ID: "100000000000000006", DISCORD_ROLE_DEV_ID: "100000000000000007",
      COOKIE_SECRET: "synthetic-cookie-secret-for-website-integration-only",
      FIREBASE_PROJECT_ID: "synthetic-website-fixture", ROBLOX_UNIVERSE_ID: "123456",
      ROBLOX_DATASTORE_READ_API_KEY: "synthetic-read-key-only", ROBLOX_MAIN_DATASTORE_ID: "main-fixture",
      ROBLOX_BATTLEFRONT_DATASTORE_ID: "bf-fixture", TE_DATA_VIEWER_ENABLED: "true", TE_DATA_IMPORT_ENABLED: "true",
      ...(enabled ? { TE_DATA_IMPORT_DAILY_ENABLED: "true" } : {}),
      TE_FIXTURE_NOW: String(now), TE_FIXTURE_RECORDS: path.join(directory, "records.json"),
      TE_FIXTURE_HOLD_READ: String(hold),
    },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  let output = "", resolveReady;
  const listeners = new Map(), events = new Set();
  const ready = new Promise(resolve => { resolveReady = resolve; });
  child.stdout.on("data", data => {
    output += data;
    if (output.includes("authentication API listening")) resolveReady();
  });
  child.stderr.on("data", data => { output += data; });
  child.on("message", message => {
    events.add(message.event);
    listeners.get(message.event)?.();
  });
  const exited = new Promise((resolve, reject) => child.once("exit", (code, signal) => {
    if (code && !signal) reject(new Error(`Website fixture exited ${code}: ${output}`));
    else resolve({ code, signal });
  }));
  function event(name) {
    if (events.has(name)) return Promise.resolve();
    return Promise.race([new Promise(resolve => listeners.set(name, resolve)),
      exited.then(() => { throw new Error(`Website exited before ${name}: ${output}`); })]);
  }
  return { child, ready: Promise.race([ready, exited.then(() => { throw new Error(output); })]), exited, event };
}
const state = async directory => JSON.parse(await readFile(path.join(directory, "records.json"), "utf8"));

test("actual index.mjs starts with the worker disabled and shuts down without importer work", { timeout: 10000 }, async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "te-website-disabled-"));
  const port = await freePort();
  const website = launch(directory, port);
  t.after(async () => {
    if (website.child.exitCode === null && website.child.signalCode === null) website.child.kill("SIGKILL");
    await rm(directory, { recursive: true, force: true });
  });
  await website.ready;
  assert.equal((await fetch(`http://127.0.0.1:${port}/api/health`)).status, 200);
  website.child.kill("SIGTERM");
  assert.deepEqual(await website.exited, { code: 0, signal: null });
  const saved = await state(directory);
  assert.equal(saved.reads.filter(name => name === PLAYER_IMPORT_JOB_PATH).length, 0);
  assert.equal(saved.writes.length, 0);
});

for (const signal of ["SIGTERM", "SIGKILL"]) {
  test(`actual index.mjs ${signal} preserves worker progress and recovers on website restart`, { timeout: 10000 }, async t => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "te-website-recovery-"));
    let child;
    t.after(async () => {
      if (child?.exitCode === null && child?.signalCode === null) child.kill("SIGKILL");
      await rm(directory, { recursive: true, force: true });
    });
    const firstPort = await freePort();
    const first = launch(directory, firstPort, { enabled: true, hold: true });
    child = first.child;
    await first.ready;
    await first.event("profile_read");
    assert.equal((await fetch(`http://127.0.0.1:${firstPort}/api/health`)).status, 200);
    child.kill(signal);
    assert.equal((await first.exited).signal, signal === "SIGKILL" ? signal : null);
    const stopped = new Map((await state(directory)).records).get(PLAYER_IMPORT_JOB_PATH).value;
    assert.equal(stopped.modes.main.pending.length, 3);
    if (signal === "SIGTERM") {
      assert.equal(stopped.run.status, "cancelled");
      assert.equal(stopped.lease, null);
    } else {
      assert.deepEqual(stopped.daily.used, DAILY_IMPORT_CHUNK);
    }
    const secondPort = await freePort();
    const second = launch(directory, secondPort, { enabled: true, now: start + 60001 });
    child = second.child;
    await second.ready;
    await second.event("scan_complete");
    child.kill("SIGTERM");
    assert.deepEqual(await second.exited, { code: 0, signal: null });
    const saved = await state(directory);
    const summaries = saved.writes.filter(write => write.path.startsWith("tePlayerSummaries/"));
    assert.equal(summaries.length, 6);
    assert.equal(new Set(summaries.map(write => write.path)).size, 6);
  });
}


test("actual website survives repeated SIGKILLs with bounded forfeitures and same-day recovery", { timeout: 15000 }, async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "te-website-repeated-kill-"));
  let child, now = start;
  t.after(async () => {
    if (child?.exitCode === null && child?.signalCode === null) child.kill("SIGKILL");
    await rm(directory, { recursive: true, force: true });
  });
  for (let attempt = 0; attempt < 3; attempt++) {
    const website = launch(directory, await freePort(), { enabled: true, hold: true, now });
    child = website.child;
    await website.ready;
    await website.event("profile_read");
    child.kill("SIGKILL");
    await website.exited;
    const job = new Map((await state(directory)).records).get(PLAYER_IMPORT_JOB_PATH).value;
    for (const key of Object.keys(DAILY_IMPORT_CHUNK)) {
      assert.equal(job.daily.used[key], DAILY_IMPORT_CHUNK[key] * (attempt + 1));
    }
    now = planDailyImport(job, now).eligibleAt + 1;
  }
  const resumed = launch(directory, await freePort(), { enabled: true, now });
  child = resumed.child;
  await resumed.ready;
  await resumed.event("scan_complete");
  child.kill("SIGTERM");
  assert.deepEqual(await resumed.exited, { code: 0, signal: null });
  const saved = await state(directory);
  const job = new Map(saved.records).get(PLAYER_IMPORT_JOB_PATH).value;
  assert.equal(job.daily.used.profiles, 81);
  assert.equal(job.daily.uncertainUsed.profiles, 75);
  assert.equal(saved.writes.filter(write => write.path.startsWith("tePlayerSummaries/")).length, 6);
});
