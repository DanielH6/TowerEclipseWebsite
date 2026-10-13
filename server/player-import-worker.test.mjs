import test from "node:test";
import assert from "node:assert/strict";
import { setImmediate as yieldTurn } from "node:timers/promises";
import { createPlayerImportFixtures } from "./testing/player-import-fixtures.mjs";
import { createPlayerImportStore, PLAYER_IMPORT_JOB_PATH } from "./player-import-store.mjs";
import { createPlayerImportWorker, dailyPlayerImportEnabled } from "./player-import-worker.mjs";
import { dailyImportWindow, planDailyImport, DAILY_IMPORT_CHUNK } from "./player-import-schedule.mjs";
import { PROPOSED_IMPORT_BUDGET } from "./player-import-budget.mjs";

function harness(count = 3) {
  let clock = Date.parse("2026-10-12T03:00:00.000Z");
  const now = () => clock;
  const fixture = createPlayerImportFixtures({ count, now });
  const scheduled = [], reports = [];
  let loads = 0;
  function worker(options = {}) {
    return createPlayerImportWorker({ enabled: true, store: fixture.store, now,
      schedule: (callback, delay) => { const timer = { callback, delay }; scheduled.push(timer); return timer; },
      unschedule: timer => { timer.cancelled = true; }, report: result => reports.push(result),
      loadResources: ({ budget }) => {
        loads++;
        return { ...fixture.dependencies, store: createPlayerImportStore(fixture.db, { budget }) };
      }, ...options });
  }
  return { ...fixture, now, worker, scheduled, reports, loads: () => loads, advance: ms => { clock += ms; } };
}
async function until(predicate) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (predicate()) return;
    await yieldTurn();
  }
  assert.fail("Worker did not reach the expected deterministic state.");
}

function assertDailyCaps(job) {
  for (const key of Object.keys(PROPOSED_IMPORT_BUDGET)) assert.ok(job.daily.used[key] <= PROPOSED_IMPORT_BUDGET[key], key);
}

test("daily flag is disabled by default and disabled worker reads/writes/loads nothing", async () => {
  assert.equal(dailyPlayerImportEnabled({}), false);
  assert.equal(dailyPlayerImportEnabled({ TE_DATA_IMPORT_DAILY_ENABLED: "false" }), false);
  assert.equal(dailyPlayerImportEnabled({ TE_DATA_IMPORT_DAILY_ENABLED: "true" }), true);
  assert.throws(() => dailyPlayerImportEnabled({ TE_DATA_IMPORT_DAILY_ENABLED: "yes" }));
  const f = harness();
  const worker = f.worker({ enabled: false });
  worker.start();
  await worker.stop();
  assert.equal(f.loads(), 0);
  assert.equal(f.reads.length, 0);
  assert.equal(f.writes.length, 0);
  assert.equal(f.scheduled.length, 0);
});

test("startup catchup is durable; two instances share the manual lease and do not rescan the completed day", async () => {
  const f = harness();
  let manualBusy = false;
  f.hooks.afterSet = async (path, value) => {
    if (path === PLAYER_IMPORT_JOB_PATH && value.lease && !manualBusy) {
      manualBusy = true;
      await assert.rejects(f.service.preview({}, "fixture-operator"), { code: "IMPORT_BUSY" });
    }
  };
  const first = f.worker(), second = f.worker();
  first.start(); second.start();
  await until(() => f.scheduled.length >= 2);
  assert.ok(f.reports.some(result => result.status === "scan_complete"));
  assert.equal(f.writes.filter(write => write.path.startsWith("tePlayerSummaries/")).length, 6);
  const job = f.records.get(PLAYER_IMPORT_JOB_PATH).value;
  assertDailyCaps(job);
  assert.equal(job.daily.invocations, 1);
  assert.equal(job.daily.dueAt, "2026-10-12T16:00:00.000Z");
  const writes = f.writes.length;
  await first.stop(); await second.stop();
  const restarted = f.worker(); restarted.start();
  await until(() => f.scheduled.length >= 3);
  assert.equal(f.writes.length, writes);
  await restarted.stop();
});

test("Sydney 03:00 uses calendar days across DST and does not run the next day's sweep early", () => {
  const before = dailyImportWindow(Date.parse("2026-10-03T15:59:59.000Z"));
  const after = dailyImportWindow(Date.parse("2026-10-03T16:00:00.000Z"));
  assert.equal(before.day, "2026-10-03");
  assert.equal(before.next, Date.parse("2026-10-03T16:00:00.000Z"));
  assert.equal(after.day, "2026-10-04");
  assert.equal(before.next - before.start, 23 * 3600000);
  const fall = dailyImportWindow(Date.parse("2026-04-04T16:30:00.000Z"));
  assert.equal(fall.next - fall.start, 25 * 3600000);
});

test("retry backoff and allowance persist across worker restarts within the same daily caps", async () => {
  const f = harness(2);
  f.failures.profiles.add(`main:${f.ids.main[0]}`);
  const first = f.worker(); first.start();
  await until(() => f.scheduled.length === 1);
  await first.stop();
  const before = f.records.get(PLAYER_IMPORT_JOB_PATH).value;
  assert.equal(before.run.status, "scan_complete_with_retries");
  assert.equal(before.daily.dueAt, new Date(f.now() + 60000).toISOString());
  const profiles = f.profileReads.length;
  const early = f.worker(); early.start();
  await until(() => f.scheduled.length === 2);
  assert.equal(f.profileReads.length, profiles);
  await early.stop();
  f.failures.profiles.clear(); f.advance(60001);
  const retry = f.worker(); retry.start();
  await until(() => f.scheduled.length === 3);
  await retry.stop();
  const after = f.records.get(PLAYER_IMPORT_JOB_PATH).value;
  assert.equal(after.run.results.retried, 1);
  assert.equal(after.run.status, "scan_complete");
  assert.equal(after.daily.invocations, 2);
  assertDailyCaps(after);
  assert.equal(f.scans.length, 2, "retry must not relist completed modes");
});

test("operator pause survives startup and source/configuration failures are redacted with backoff", async () => {
  const f = harness();
  const first = f.worker(); first.start();
  await until(() => f.scheduled.length === 1);
  await first.stop();
  await f.service.cancel();
  const writes = f.writes.length;
  const paused = f.worker(); paused.start();
  await until(() => f.scheduled.length === 2);
  assert.equal(f.writes.length, writes);
  await paused.stop();
  const callbacks = [], reports = [];
  const failed = f.worker({ store: { readJob: async () => { throw new Error("synthetic-private-secret"); } },
    schedule: (callback, delay) => { callbacks.push({ callback, delay }); return {}; }, report: result => reports.push(result) });
  failed.start(); await until(() => callbacks.length === 1);
  callbacks[0].callback(); await until(() => callbacks.length === 2);
  assert.equal(callbacks[1].delay, 120000);
  assert.ok(!JSON.stringify(reports).includes("synthetic-private"));
  await failed.stop();
});

test("safe shutdown aborts an active read, leaves durable IDs and clears the worker timer", async () => {
  const f = harness();
  let reading = false;
  const worker = f.worker({ loadResources: ({ budget }) => ({ ...f.dependencies,
    store: createPlayerImportStore(f.db, { budget }), reader: { read: async (_mode, _id, { signal }) => {
      reading = true;
      await new Promise(resolve => signal.addEventListener("abort", resolve, { once: true }));
      signal.throwIfAborted();
    } } }) });
  worker.start(); await until(() => reading);
  await worker.stop();
  assert.equal(f.scheduled.length, 0);
  const saved = f.records.get(PLAYER_IMPORT_JOB_PATH).value;
  assert.equal(saved.run.status, "cancelled");
  assert.equal(saved.lease, null);
  assert.equal(saved.modes.main.pending.length, 3);
  assertDailyCaps(saved);
  f.advance(60001);
  const resumed = f.worker(); resumed.start();
  await until(() => f.scheduled.length === 1);
  await resumed.stop();
  assert.equal(f.records.get(PLAYER_IMPORT_JOB_PATH).value.run.status, "scan_complete");
});

test("exhausted or unconfirmed daily allocations wait for the next Sydney window", () => {
  const now = Date.parse("2026-10-12T03:00:00.000Z");
  const daily = { schemaVersion: 1, day: "2026-10-12", invocations: 1, used: { ...PROPOSED_IMPORT_BUDGET },
    dueAt: new Date(now).toISOString(), lastStartedAt: new Date(now).toISOString(), lastFinishedAt: null };
  const plan = planDailyImport({ daily }, now + 60001);
  assert.equal(plan.limits, null);
  assert.equal(plan.eligibleAt, Date.parse("2026-10-12T16:00:00.000Z"));
  assert.throws(() => planDailyImport({ daily: { ...daily, used: { ...daily.used, writes: 4001 } } }, now));
});

test("bounded chunks keep the combined Main/Battlefront daily cap and resume remaining IDs next day", async () => {
  const f = harness(600);
  const worker = f.worker();
  worker.start();
  await until(() => f.scheduled.length === 1);
  let callback = 0;
  while (planDailyImport(f.records.get(PLAYER_IMPORT_JOB_PATH).value, f.now()).limits) {
    const timer = f.scheduled[callback++];
    f.advance(timer.delay);
    timer.callback();
    await until(() => f.scheduled.length === callback + 1);
    assertDailyCaps(f.records.get(PLAYER_IMPORT_JOB_PATH).value);
    assert.ok(callback <= 50, "chunking failed to reach the daily cap");
  }
  const saved = f.records.get(PLAYER_IMPORT_JOB_PATH).value;
  assert.equal(saved.run.status, "paused_budget");
  assert.equal(saved.daily.used.profiles, 1000);
  assert.equal(f.profileReads.length, 1000);
  assert.ok(saved.daily.invocations > 5, "successful chunks must not hit the former five-run cutoff");
  await worker.stop();
  const writes = f.writes.length;
  const restarted = f.worker(); restarted.start();
  await until(() => f.scheduled.length === callback + 2);
  assert.equal(f.writes.length, writes);
  await restarted.stop();
  f.advance(86400000);
  const nextDay = f.worker(); nextDay.start();
  let nextCallback = callback + 2;
  await until(() => f.scheduled.length === nextCallback + 1);
  while (f.records.get(PLAYER_IMPORT_JOB_PATH).value.run.status !== "scan_complete") {
    const timer = f.scheduled[nextCallback++];
    f.advance(timer.delay);
    timer.callback();
    await until(() => f.scheduled.length === nextCallback + 1);
  }
  await nextDay.stop();
  assert.equal(f.writes.filter(write => write.path.startsWith("tePlayerSummaries/")).length, 1200);
  assertDailyCaps(f.records.get(PLAYER_IMPORT_JOB_PATH).value);
});

test("finishing across Sydney 03:00 schedules the same eligibility as a fresh startup", async () => {
  let clock = Date.parse("2026-10-12T15:59:59.000Z");
  const now = () => clock;
  const f = createPlayerImportFixtures({ count: 1, now });
  let advance = true;
  const scheduled = [];
  function worker() {
    return createPlayerImportWorker({ enabled: true, store: f.store, now,
      schedule: (callback, delay) => { scheduled.push({ callback, delay }); return {}; }, unschedule: () => {},
      loadResources: ({ budget }) => ({ ...f.dependencies, store: createPlayerImportStore(f.db, { budget }),
        reader: { read: (...args) => {
          if (advance) { clock += 2000; advance = false; }
          return f.reader.read(...args);
        } } }) });
  }
  const uninterrupted = worker();
  uninterrupted.start();
  await until(() => scheduled.length === 1);
  const saved = structuredClone([...f.records]);
  const restartPlan = planDailyImport(f.records.get(PLAYER_IMPORT_JOB_PATH).value, now());
  assert.equal(scheduled[0].delay, Math.max(1000, restartPlan.eligibleAt - now()));
  assert.equal(scheduled[0].delay, 1000);
  clock += scheduled[0].delay;
  scheduled[0].callback();
  await until(() => scheduled.length === 2);
  const completed = f.records.get(PLAYER_IMPORT_JOB_PATH).value;
  assert.equal(completed.daily.day, "2026-10-13");
  assert.equal(completed.sweep.day, "2026-10-13");
  await uninterrupted.stop();
  f.records.clear();
  for (const [key, value] of saved) f.records.set(key, value);
  const restarted = worker();
  restarted.start();
  await until(() => scheduled.length === 3);
  assert.deepEqual(f.records.get(PLAYER_IMPORT_JOB_PATH).value.daily.used, completed.daily.used);
  assert.deepEqual(f.records.get(PLAYER_IMPORT_JOB_PATH).value.modes, completed.modes);
  await restarted.stop();
});

test("repeated uncertain acquisition acknowledgements charge only chunks and allow same-day progress", async () => {
  const f = harness(1);
  for (let interruption = 0; interruption < 3; interruption++) {
    let injected = false;
    f.hooks.afterSet = (path, value) => {
      if (!injected && path === PLAYER_IMPORT_JOB_PATH && value.lease) {
        injected = true;
        throw new Error("Synthetic acquisition acknowledgement lost");
      }
    };
    const worker = f.worker();
    worker.start();
    await until(() => f.scheduled.length === interruption + 1);
    await worker.stop();
    const saved = f.records.get(PLAYER_IMPORT_JOB_PATH).value;
    assert.equal(f.profileReads.length, 0);
    for (const key of Object.keys(DAILY_IMPORT_CHUNK)) {
      assert.equal(saved.daily.used[key], DAILY_IMPORT_CHUNK[key] * (interruption + 1));
    }
    const visible = (await f.service.status()).progress;
    assert.equal(visible.run.usage.profiles, 0);
    assert.equal(visible.daily.reserved.profiles, 25);
    assert.ok(visible.daily.charged.profiles > 0);
    const plan = planDailyImport(saved, f.now());
    f.advance(plan.eligibleAt - f.now() + 1);
    assert.equal((await f.service.status()).progress.daily.state, "unconfirmed_chunk");
  }
  f.hooks.afterSet = null;
  const healthy = f.worker(); healthy.start();
  await until(() => f.scheduled.length === 4);
  await healthy.stop();
  const saved = f.records.get(PLAYER_IMPORT_JOB_PATH).value;
  assert.equal(saved.run.status, "scan_complete");
  assert.equal(saved.daily.used.profiles, 77);
  assert.equal(saved.daily.uncertainUsed.profiles, 75);
  assert.equal(f.profileReads.length, 2);
  assertDailyCaps(saved);
});

test("durable status shows daily lockout and uncertainty even when last-run profile usage is zero", async () => {
  const f = harness(1);
  let failed = false;
  f.hooks.afterSet = (path, value) => {
    if (!failed && path === PLAYER_IMPORT_JOB_PATH && value.lease) {
      failed = true;
      throw new Error("Synthetic acknowledgement lost");
    }
  };
  const worker = f.worker(); worker.start();
  await until(() => f.scheduled.length === 1);
  await worker.stop();
  f.hooks.afterSet = null;
  f.advance(60001);
  const snapshot = await f.store.readJob();
  const value = structuredClone(snapshot.value);
  value.daily.used.seconds = 1800;
  value.daily.uncertainUsed.seconds = 1740;
  await f.store.writeJob(value, snapshot);
  const visible = (await f.service.status()).progress;
  assert.equal(visible.run.usage.profiles, 0);
  assert.equal(visible.daily.state, "daily_budget_exhausted");
  assert.equal(visible.daily.uncertainCharged.seconds, 1800);
  assert.equal(visible.daily.nextEligibleAt, "2026-10-12T16:00:00.000Z");
  assert.equal(visible.daily.timeZone, "Australia/Sydney");
});

test("uncommitted acquisition failures use backoff rather than repeating due probes every second", async () => {
  const f = harness(1);
  f.hooks.beforeSet = path => {
    if (path === PLAYER_IMPORT_JOB_PATH) throw new Error("Synthetic checkpoint store unavailable");
  };
  const worker = f.worker(); worker.start();
  await until(() => f.scheduled.length === 1);
  assert.equal(f.scheduled[0].delay, 60000);
  f.advance(f.scheduled[0].delay);
  f.scheduled[0].callback();
  await until(() => f.scheduled.length === 2);
  assert.equal(f.scheduled[1].delay, 120000);
  assert.equal(f.profileReads.length, 0);
  assert.equal(f.writes.length, 0);
  await worker.stop();
});
