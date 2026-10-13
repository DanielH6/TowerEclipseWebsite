import test from "node:test";
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { PLAYER_IMPORT_JOB_PATH } from "./player-import-store.mjs";
import { DAILY_IMPORT_CHUNK } from "./player-import-schedule.mjs";

const script = fileURLToPath(new URL("./testing/player-import-process.mjs", import.meta.url));
const start = Date.parse("2026-10-12T03:00:00.000Z");

function launch(file, boundary, phase, now, daily = false) {
  const child = fork(script, [file, boundary, phase, String(now), String(daily)], {
    env: { PATH: process.env.PATH }, stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  let output = "", result;
  child.stdout.on("data", data => { output += data; });
  child.stderr.on("data", data => { output += data; });
  const reached = new Promise(resolve => child.on("message", message => {
    if (message.boundary) resolve(message);
    if (message.result) result = message.result;
  }));
  const exited = new Promise((resolve, reject) => child.once("exit", (code, signal) => {
    if (code && !signal) reject(new Error(`Fixture process exited ${code}: ${output}`));
    else resolve({ code, signal, result });
  }));
  return { child, reached, exited };
}
const records = async file => new Map(JSON.parse(await readFile(file, "utf8")));

for (const signal of ["SIGTERM", "SIGKILL"]) {
  for (const boundary of ["page", "summary", "retry", "checkpoint", "finalization"]) {
    for (const phase of ["before", "after"]) {
      test(`${signal} ${phase} ${boundary} restarts without lost IDs or duplicate summary writes`, { timeout: 10000 }, async () => {
        const directory = await mkdtemp(path.join(os.tmpdir(), "te-import-process-"));
        const file = path.join(directory, "records.json");
        let child;
        try {
          const first = launch(file, boundary, phase, start);
          child = first.child;
          assert.deepEqual(await first.reached, { boundary, phase });
          child.kill(signal);
          const stopped = await first.exited;
          assert.equal(stopped.signal, signal === "SIGKILL" ? signal : null);
          const resumed = launch(file, "none", "after", start + 60001);
          child = resumed.child;
          assert.equal((await resumed.exited).result.status, "scan_complete");
          const saved = await records(file);
          for (const mode of ["main", "battlefront"]) {
            for (const id of ["910000001", "910000002", "910000003"]) {
              assert.ok(saved.has(`tePlayerSummaries/${mode}:${id}`), `${mode}:${id} was lost`);
            }
          }
          assert.equal(saved.get(PLAYER_IMPORT_JOB_PATH).value.lease, null);
          assert.ok(Object.values(saved.get(PLAYER_IMPORT_JOB_PATH).value.modes).every(mode => mode.done && !mode.pending.length));
          const writes = (await readFile(`${file}.writes`, "utf8")).trim().split("\n").map(JSON.parse);
          const summaries = writes.filter(write => write.path.startsWith("tePlayerSummaries/"));
          assert.equal(summaries.length, 6);
          assert.equal(new Set(summaries.map(write => write.path)).size, 6);
        } finally {
          if (child?.exitCode === null && child?.signalCode === null) child.kill("SIGKILL");
          await rm(directory, { recursive: true, force: true });
        }
      });
    }
  }
}

test("SIGKILL after daily reservation forfeits a bounded chunk; same day resumes the pending page", { timeout: 10000 }, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "te-import-daily-kill-"));
  const file = path.join(directory, "records.json");
  let child;
  try {
    const first = launch(file, "page", "after", start, true);
    child = first.child;
    await first.reached;
    child.kill("SIGKILL");
    await first.exited;
    const checkpoint = (await records(file)).get(PLAYER_IMPORT_JOB_PATH).value;
    assert.deepEqual(checkpoint.daily.used, DAILY_IMPORT_CHUNK);
    const sameDay = launch(file, "none", "after", start + 60001, true);
    child = sameDay.child;
    assert.equal((await sameDay.exited).result.status, "scan_complete");
    const recovered = (await records(file)).get(PLAYER_IMPORT_JOB_PATH).value;
    assert.deepEqual(recovered.daily.uncertainUsed, DAILY_IMPORT_CHUNK);
    const nextDay = launch(file, "none", "after", start + 86400000, true);
    child = nextDay.child;
    assert.equal((await nextDay.exited).result.status, "scan_complete");
    assert.equal([...await records(file)].filter(([key]) => key.startsWith("tePlayerSummaries/")).length, 6);
  } finally {
    if (child?.exitCode === null && child?.signalCode === null) child.kill("SIGKILL");
    await rm(directory, { recursive: true, force: true });
  }
});

test("killed old process cannot erase a newer owner's pause and progress on restart", { timeout: 10000 }, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "te-import-newer-"));
  const file = path.join(directory, "records.json");
  let child;
  try {
    const first = launch(file, "checkpoint", "after", start);
    child = first.child;
    await first.reached;
    child.kill("SIGKILL");
    await first.exited;
    const saved = await records(file);
    const record = saved.get(PLAYER_IMPORT_JOB_PATH);
    record.value.paused = true;
    record.value.lease = null;
    record.value.modes.main.pending = ["910000003"];
    record.value.modes.main.attempts = 2;
    record.updateTime = "2026-10-12T03:00:00.999999Z";
    await writeFile(file, JSON.stringify([...saved]));
    const newer = await readFile(file, "utf8");
    const restarted = launch(file, "none", "after", start + 60001);
    child = restarted.child;
    assert.equal((await restarted.exited).result.status, "operator_paused");
    assert.equal(await readFile(file, "utf8"), newer);
  } finally {
    if (child?.exitCode === null && child?.signalCode === null) child.kill("SIGKILL");
    await rm(directory, { recursive: true, force: true });
  }
});
