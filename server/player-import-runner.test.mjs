import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createPlayerImportFixtures } from "./testing/player-import-fixtures.mjs";
import { createPlayerImportStore, PLAYER_IMPORT_JOB_PATH } from "./player-import-store.mjs";
import { createImportRunBudget, PROPOSED_IMPORT_BUDGET } from "./player-import-budget.mjs";
import { runPlayerImportSweep } from "./player-import-runner.mjs";
import { runPlayerImportCommand, parsePlayerImportRunArguments } from "../scripts/run-player-import.mjs";

function fixture(count = 7) {
  let clock = Date.parse("2026-10-12T03:00:00Z");
  const now = () => clock, f = createPlayerImportFixtures({ count, now });
  function resources(budget, overrides = {}) {
    return { ...f.dependencies, store: createPlayerImportStore(f.db, { budget }),
      reader: { read: (...args) => { budget.attempt(); return f.reader.read(...args); } },
      lister: { list: (...args) => { budget.attempt(); return f.lister.list(...args); } },
      identities: { resolve: (...args) => { budget.attempt(); return f.identities.resolve(...args); } }, ...overrides };
  }
  return { ...f, now, resources, advance: ms => { clock += ms; },
    async run(options = {}, caps = {}) {
      const budget = createImportRunBudget({ ...PROPOSED_IMPORT_BUDGET, ...caps }, { now, signal: options.signal });
      try { return await runPlayerImportSweep({ ...resources(budget, options.resources), budget, now, ...options }); }
      finally { budget.dispose(); }
    } };
}
const summaries = f => [...f.records].filter(([path]) => path.startsWith("tePlayerSummaries/"));
const pendingFailures = f => [...f.records].filter(([path, record]) => path.startsWith("tePlayerImportFailures/") && record.value.status === "pending");
function within(result) { for (const key of ["profiles", "reads", "writes", "attempts"]) assert.ok(result.usage[key] <= result.limits[key], `${key} exceeded`); assert.ok(result.usage.elapsedSeconds <= result.limits.seconds); }

test("full fixed-scope dry-run traverses both modes with zero summary, failure or checkpoint writes", async () => {
  const f = fixture(); const result = await f.run();
  assert.equal(result.status, "scan_complete"); assert.equal(result.writeMode, "dry_run"); assert.equal(result.coverage, "unknown");
  assert.equal(result.results.wouldCreate, 14); assert.equal(result.results.created, 0);
  assert.equal(f.records.size, 0); assert.equal(f.writes.length, 0); assert.equal(result.usage.writes, 0); within(result);
  assert.ok(!JSON.stringify(result).includes("synthetic-private")); assert.ok(!JSON.stringify(result).includes(f.ids.main[0]));
});

test("approved apply scans both modes without per-page confirmations and updates visible durable run status", async () => {
  const f = fixture(); const result = await f.run({ apply: true, intent: "daily" });
  assert.equal(result.status, "scan_complete"); assert.equal(result.checkpointConfirmed, true); assert.equal(summaries(f).length, 14); assert.equal(result.results.created, 14);
  const status = await f.service.status(); assert.equal(status.progress.run.status, "scan_complete");
  assert.equal(status.progress.run.results.created, 14); assert.equal(status.progress.busy, false); assert.equal(status.coverage, "unknown"); within(result);
});

test("profile budget pauses in a persisted page; a later process resumes without re-listing that page", async () => {
  const f = fixture(8); const first = await f.run({ apply: true, intent: "daily" }, { profiles: 2, retryProfiles: 0 });
  assert.equal(first.status, "paused_budget"); assert.equal(summaries(f).length, 2); assert.equal(f.scans.length, 1);
  const sweepId = first.sweepId; f.advance(86400000);
  const next = await f.run({ apply: true, intent: "daily" });
  assert.equal(next.action, "resume"); assert.equal(next.sweepId, sweepId); assert.equal(next.status, "scan_complete"); assert.equal(summaries(f).length, 16);
  assert.equal(f.scans.filter(scan => scan.mode === "main" && scan.cursor === "").length, 1); within(first); within(next);
});

test("same-day daily calls do not repeat a completed scan; next local day starts one new sweep", async () => {
  const f = fixture(2); const first = await f.run({ apply: true, intent: "daily" }); const scans = f.scans.length;
  const same = await f.run({ apply: true, intent: "daily" }); assert.equal(same.action, "resume"); assert.equal(f.scans.length, scans);
  f.advance(86400000); const next = await f.run({ apply: true, intent: "daily" });
  assert.equal(next.action, "new_sweep"); assert.notEqual(next.sweepId, first.sweepId); assert.equal(next.results.unchanged, 4); assert.equal(summaries(f).length, 4);
  const total = f.scans.length; await f.run({ apply: true, intent: "resume" }); assert.equal(f.scans.length, total);
});

test("new refuses unfinished sweeps and operator pause survives scheduled invocations until explicitly resumed", async () => {
  const f = fixture(4); await f.run({ apply: true }, { profiles: 1, retryProfiles: 0 });
  const before = f.writes.length;
  assert.equal((await f.run({ apply: true, intent: "new" })).reason, "unfinished_sweep"); assert.equal(f.writes.length, before);
  await f.service.cancel(); const pausedWrites = f.writes.length;
  assert.equal((await f.run({ apply: true, intent: "daily" })).status, "operator_paused"); assert.equal(f.writes.length, pausedWrites);
  assert.equal((await f.run({ apply: true, intent: "daily", resumePaused: true })).status, "scan_complete");
});

test("persistent failed rows enter a bounded retry ledger, scanning proceeds and later retry resolution is idempotent", async () => {
  const f = fixture(7), id = f.ids.main[0]; f.failures.profiles.add(`main:${id}`);
  const first = await f.run({ apply: true }); assert.equal(first.status, "scan_complete_with_retries"); assert.equal(summaries(f).length, 13);
  assert.equal(pendingFailures(f).length, 1); assert.equal(f.records.get(PLAYER_IMPORT_JOB_PATH).value.modes.main.done, true);
  const scans = f.scans.length; f.failures.profiles.clear(); f.advance(60001);
  const retry = await f.run({ apply: true, intent: "resume" }); assert.equal(retry.results.retried, 1); assert.equal(retry.results.created, 1);
  assert.equal(f.scans.length, scans); assert.equal(pendingFailures(f).length, 0); assert.equal(summaries(f).length, 14);
  assert.equal((await f.run({ apply: true })).results.retried, 0);
});

test("no-progress retries and source-wide failures are circuit-broken while independent mode scanning continues", async () => {
  const f = fixture(8); for (const id of f.ids.main) f.failures.profiles.add(`main:${id}`);
  const first = await f.run({ apply: true }); assert.equal(first.status, "partial_errors"); assert.equal(first.results.deferred, 3);
  assert.equal(summaries(f).length, 8); assert.equal(f.records.get(PLAYER_IMPORT_JOB_PATH).value.modes.battlefront.done, true);
  f.advance(60001); const next = await f.run({ apply: true }); assert.ok(next.results.retried <= 3); assert.ok(next.usage.profiles <= 3);
  assert.equal(next.status, "partial_errors"); within(next);
});

test("concurrent runners have one lease winner and manual UI cannot preview while that invocation owns it", async () => {
  const f = fixture(3); let checked = false;
  f.hooks.afterSet = async (path, value) => {
    if (path === PLAYER_IMPORT_JOB_PATH && value.lease?.kind === "runner" && !checked) {
      checked = true; await assert.rejects(f.service.preview({}, "signed-dev"), { code: "IMPORT_BUSY" });
    }
  };
  const results = await Promise.all([f.run({ apply: true }), f.run({ apply: true })]);
  assert.equal(results.filter(value => value.status === "busy").length, 1); assert.equal(summaries(f).length, 6);
  assert.equal(f.writes.filter(write => write.path.startsWith("tePlayerSummaries/")).length, 6);
});

test("manual stop fences the runner and retains pending rows; subsequent daily runs respect that stop", async () => {
  const f = fixture(5); let once = false;
  f.hooks.afterSet = async path => { if (!once && path.startsWith("tePlayerSummaries/")) { once = true; await f.service.cancel(); } };
  const result = await f.run({ apply: true }); assert.equal(result.status, "lease_lost"); assert.equal(summaries(f).length, 1);
  assert.equal(f.records.get(PLAYER_IMPORT_JOB_PATH).value.paused, true);
  f.hooks.afterSet = null; assert.equal((await f.run({ apply: true, intent: "daily" })).status, "operator_paused");
  await f.run({ apply: true, resumePaused: true }); assert.equal(summaries(f).length, 10);
});

test("crash after an acknowledged summary write replays safely once the lease expires", async () => {
  const f = fixture(3); let summaryWritten = false;
  f.hooks.afterSet = path => { if (path.startsWith("tePlayerSummaries/")) summaryWritten = true; };
  f.hooks.beforeSet = path => { if (path === PLAYER_IMPORT_JOB_PATH && summaryWritten) throw new Error("synthetic-private-checkpoint-failure"); };
  const first = await f.run({ apply: true }); assert.equal(first.status, "partial_errors"); assert.equal(summaries(f).length, 1);
  assert.equal((await f.service.status()).progress.busy, true); f.advance(45001);
  f.hooks.beforeSet = null; f.hooks.afterSet = null; const resumed = await f.run({ apply: true }); assert.equal(resumed.status, "scan_complete");
  assert.equal(summaries(f).length, 6); assert.equal(f.writes.filter(write => write.path.startsWith("tePlayerSummaries/")).length, 6);
});

test("uncertain commits stop additional summary writes and are verified on resume", async () => {
  const f = fixture(3); let once = false;
  f.hooks.afterSet = path => { if (!once && path.startsWith("tePlayerSummaries/")) { once = true; throw new Error("synthetic-private-transport-reset"); } };
  const first = await f.run({ apply: true }); assert.equal(first.reason, "summary_write_uncertain"); assert.equal(summaries(f).length, 1);
  assert.equal((await f.run({ apply: true })).status, "busy");
  f.advance(45001);
  f.hooks.afterSet = null; await f.run({ apply: true }); assert.equal(summaries(f).length, 6);
});

test("read, write, HTTP-attempt and time budgets stop before exceeding limits and retain resumable checkpoints", async () => {
  for (const caps of [{ reads: 25 }, { writes: 5 }, { attempts: 35 }]) {
    const f = fixture(5); const result = await f.run({ apply: true }, caps); assert.equal(result.status, "paused_budget"); within(result);
    assert.equal((await f.run({ apply: true })).status, "scan_complete");
  }
  const f = fixture(5), original = f.reader.read;
  const slow = { read: async (...args) => { f.advance(22000); return original(...args); } };
  const result = await f.run({ apply: true, resources: { reader: slow } }, { seconds: 30 }); assert.equal(result.status, "paused_budget"); within(result);
  assert.equal((await f.run({ apply: true })).status, "scan_complete");
});

test("duplicate source keys and tombstones never duplicate writes or delete existing summaries", async () => {
  const f = fixture(6); f.ids.main.push(f.ids.main[0]); await f.run({ apply: true });
  assert.equal(summaries(f).length, 12); assert.equal(f.writes.filter(write => write.path.startsWith("tePlayerSummaries/")).length, 12);
  const source = f.reader.read, id = f.ids.main[0];
  const reader = { read: (mode, value, options) => mode === "main" && value === id ? null : source(mode, value, options) };
  const before = f.records.get(`tePlayerSummaries/main:${id}`);
  await f.run({ apply: true, intent: "new", resources: { reader } }); assert.deepEqual(f.records.get(`tePlayerSummaries/main:${id}`), before);
});

test("new sweeps preserve stale-safe summaries, including records with unknown freshness", async () => {
  const f = fixture(1); await f.run({ apply: true }); const before = structuredClone(summaries(f));
  const reader = { read: async () => ({ envelope: { Data: { Level: 99 } }, revision: "different", updatedAt: "2026-10-12T00:00:00Z" }) };
  const result = await f.run({ apply: true, intent: "new", resources: { reader } }); assert.equal(result.results.skipped, 2); assert.deepEqual(summaries(f), before);
});

test("CLI rejects invalid scope/duplicate flags/unbounded apply before loading dependencies; help is inert", async () => {
  let loads = 0;
  for (const argv of [[], ["--scope", "main"], ["--scope", "main,battlefront", "--apply"], ["--scope", "main,battlefront", "--max-profiles", "Infinity"],
    ["--scope", "main,battlefront", "--universe", "999"], ["--scope", "main,battlefront", "--scope", "main,battlefront"]]) {
    const result = await runPlayerImportCommand({ argv, loadResources: () => { loads++; throw new Error("must not load"); } }); assert.equal(result.code, "INVALID_IMPORT_RUN_ARGUMENTS");
  }
  assert.equal(loads, 0); assert.equal((await runPlayerImportCommand({ argv: ["--help"], loadResources: () => { loads++; } })).ok, true); assert.equal(loads, 0);
  assert.throws(() => parsePlayerImportRunArguments(["--scope", "main,battlefront", "--max-seconds", "0"]));
  const source = await readFile(new URL("../scripts/run-player-import.mjs", import.meta.url), "utf8"); assert.ok(!source.includes("setInterval")); assert.ok(!source.includes('import "dotenv/config"'));
});

test("CLI defaults to dry-run, uses authoritative parsed flags and masks setup/provider errors", async () => {
  const f = fixture(2);
  const result = await runPlayerImportCommand({ argv: ["--scope", "main,battlefront"], now: f.now,
    loadResources: ({ budget }) => ({ ...f.resources(budget), apply: true }) });
  assert.equal(result.writeMode, "dry_run"); assert.equal(f.writes.length, 0);
  const failed = await runPlayerImportCommand({ argv: ["--scope", "main,battlefront"], loadResources: () => { throw new Error("synthetic-private-path-or-key"); } });
  assert.ok(!JSON.stringify(failed).includes("synthetic-private"));
});

test("failure-ledger outage never advances the failed source key or exposes provider details", async () => {
  const f = fixture(3), id = f.ids.main[0];
  f.failures.profiles.add(`main:${id}`);
  f.hooks.beforeSet = path => { if (path.startsWith("tePlayerImportFailures/")) throw new Error("synthetic-private-ledger-outage"); };
  const first = await f.run({ apply: true });
  assert.equal(first.reason, "failure_ledger_unavailable");
  assert.equal(f.records.get(PLAYER_IMPORT_JOB_PATH).value.modes.main.pending[0], id);
  assert.equal(summaries(f).length, 0); assert.ok(!JSON.stringify(first).includes("synthetic-private"));
  f.hooks.beforeSet = null; f.failures.profiles.clear();
  f.advance(45001);
  assert.equal((await f.run({ apply: true })).status, "scan_complete"); assert.equal(summaries(f).length, 6);
});

test("interrupted reads leave a resumable checkpoint and never write a summary after cancellation", async () => {
  const f = fixture(2), controller = new AbortController();
  const reader = { read: async () => { controller.abort(); throw new Error("synthetic cancellation"); } };
  const interrupted = await f.run({ apply: true, signal: controller.signal, resources: { reader } });
  assert.equal(interrupted.status, "cancelled"); assert.equal(summaries(f).length, 0);
  const saved = f.records.get(PLAYER_IMPORT_JOB_PATH).value;
  assert.equal(saved.modes.main.pending.length, 2); assert.equal(saved.lease, null); assert.equal(saved.run.status, "cancelled");
  assert.equal((await f.run({ apply: true })).status, "scan_complete"); assert.equal(summaries(f).length, 4);
});

test("retry allowance bounds existing failures; dry-run cannot alter their durable metadata", async () => {
  const f = fixture(8);
  for (const id of f.ids.main.filter((_, index) => index % 2 === 0)) f.failures.profiles.add(`main:${id}`);
  await f.run({ apply: true }); f.advance(60001); f.failures.profiles.clear();
  const before = structuredClone([...f.records]), writes = f.writes.length;
  const dry = await f.run({}, { retryProfiles: 2 });
  assert.equal(dry.results.retried, 2); assert.equal(dry.results.wouldCreate, 2);
  assert.equal(f.writes.length, writes); assert.deepEqual([...f.records], before);
  const applied = await f.run({ apply: true }, { retryProfiles: 2 });
  assert.equal(applied.results.retried, 2); assert.equal(pendingFailures(f).length, 2);
  assert.equal(applied.status, "scan_complete_with_retries"); within(applied);
});

test("completed traversal does not claim a confirmed durable finish when its final checkpoint fails", async () => {
  const f = fixture(1);
  f.hooks.beforeSet = (path, value) => { if (path === PLAYER_IMPORT_JOB_PATH && value.run?.status === "scan_complete") throw new Error("synthetic final checkpoint outage"); };
  const result = await f.run({ apply: true });
  assert.equal(result.traversalEnded, true); assert.equal(summaries(f).length, 2);
  assert.equal(result.checkpointConfirmed, false); assert.equal(result.ok, false);
  f.advance(45001); assert.equal((await f.service.status()).progress.run.status, "interrupted");
  f.hooks.beforeSet = null; const resumed = await f.run({ apply: true });
  assert.equal(resumed.checkpointConfirmed, true); assert.equal(resumed.ok, true);
  assert.equal(f.writes.filter(write => write.path.startsWith("tePlayerSummaries/")).length, 2);
});


for (const takeover of [false, true]) {
  test(`SET/GET ${takeover ? "takeover" : "cancel"} keeps newer progress and forbids stale cleanup`, async () => {
    const f = fixture(3);
    let interrupted = false, newer, writesAtLoss;
    f.hooks.afterSet = async (path, value) => {
      if (interrupted || path !== PLAYER_IMPORT_JOB_PATH || !value.modes.main.pageLoaded) return;
      interrupted = true;
      if (takeover) {
        const snapshot = await f.store.readJob();
        const changed = structuredClone(snapshot.value);
        changed.lease = { id: "newer-owner", kind: "runner", until: f.now() + 45000 };
        changed.modes.main.pending = changed.modes.main.pending.slice(1);
        changed.modes.main.attempts++;
        await f.store.writeJob(changed, snapshot);
      } else {
        await f.service.cancel();
      }
      newer = structuredClone(f.records.get(PLAYER_IMPORT_JOB_PATH));
      writesAtLoss = f.writes.length;
    };
    const result = await f.run({ apply: true });
    assert.equal(result.status, "lease_lost");
    assert.equal(result.checkpointConfirmed, false);
    assert.deepEqual(f.records.get(PLAYER_IMPORT_JOB_PATH), newer);
    assert.equal(f.writes.length, writesAtLoss, "no checkpoint, release or finalization after ownership loss");
    assert.equal(summaries(f).length, 0);
  });
}

for (const boundary of ["acquisition", "finalization"]) {
  test(`cancellation between ${boundary} SET/GET preserves the operator pause`, async () => {
    const f = fixture(1);
    let interrupted = false, newer, writesAtLoss;
    f.hooks.afterSet = async (path, value) => {
      if (interrupted || path !== PLAYER_IMPORT_JOB_PATH) return;
      const matches = boundary === "acquisition" ? value.lease && !value.modes.main.pageLoaded : value.lease === null;
      if (!matches) return;
      interrupted = true;
      await f.service.cancel();
      newer = structuredClone(f.records.get(PLAYER_IMPORT_JOB_PATH));
      writesAtLoss = f.writes.length;
    };
    const result = await f.run({ apply: true });
    assert.equal(result.status, "lease_lost");
    assert.equal(result.checkpointConfirmed, false);
    assert.deepEqual(f.records.get(PLAYER_IMPORT_JOB_PATH), newer);
    assert.equal(f.writes.length, writesAtLoss);
  });
}

test("uncertain checkpoint commit leaves the lease and page intact without any cleanup write", async () => {
  const f = fixture(3);
  let writesAtFailure;
  f.hooks.afterSet = (path, value) => {
    if (path === PLAYER_IMPORT_JOB_PATH && value.modes.main.pageLoaded) {
      writesAtFailure = f.writes.length;
      throw new Error("synthetic acknowledgement lost");
    }
  };
  const result = await f.run({ apply: true });
  assert.equal(result.checkpointConfirmed, false);
  assert.equal(f.writes.length, writesAtFailure);
  assert.equal(summaries(f).length, 0);
  const saved = f.records.get(PLAYER_IMPORT_JOB_PATH).value;
  assert.equal(saved.modes.main.pending.length, 3);
  assert.ok(saved.lease);
  f.hooks.afterSet = null;
  f.advance(45001);
  assert.equal((await f.run({ apply: true })).status, "scan_complete");
});

test("a submitted summary may finish after cancellation, but no old checkpoint or release follows it", async () => {
  const f = fixture(3), controller = new AbortController();
  let started, release;
  const writing = new Promise(resolve => { started = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  f.hooks.beforeSet = async path => {
    if (path.startsWith("tePlayerSummaries/")) {
      started();
      await gate; // Model a transport that ignores cancellation after submission.
    }
  };
  const running = f.run({ apply: true, signal: controller.signal });
  await writing;
  controller.abort();
  const result = await running;
  assert.equal(result.status, "cancelled");
  assert.equal(result.checkpointConfirmed, false);
  await f.service.cancel();
  const newer = structuredClone(f.records.get(PLAYER_IMPORT_JOB_PATH));
  const checkpointWrites = f.writes.filter(write => write.path === PLAYER_IMPORT_JOB_PATH).length;
  release();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(summaries(f).length, 1);
  assert.deepEqual(f.records.get(PLAYER_IMPORT_JOB_PATH), newer);
  assert.equal(f.writes.filter(write => write.path === PLAYER_IMPORT_JOB_PATH).length, checkpointWrites);
  f.hooks.beforeSet = null;
  assert.equal((await f.run({ apply: true, resumePaused: true })).status, "scan_complete");
  assert.equal(f.writes.filter(write => write.path.startsWith("tePlayerSummaries/")).length, 6);
});
