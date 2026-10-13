import { boundedOperation } from "./player-summary-import.mjs";
import { createImportRunBudget } from "./player-import-budget.mjs";
import { planDailyImport } from "./player-import-schedule.mjs";
import { runPlayerImportSweep } from "./player-import-runner.mjs";

export function dailyPlayerImportEnabled(environment = process.env) {
  const flag = environment.TE_DATA_IMPORT_DAILY_ENABLED;
  if (![undefined, "", "false", "true"].includes(flag)) {
    throw new Error("TE_DATA_IMPORT_DAILY_ENABLED must be true or false.");
  }
  return flag === "true";
}

// Website lifecycle owns this timer. All instances and the manual importer use
// the same CAS lease; the durable due date survives timer/process restarts.
export function createPlayerImportWorker({ enabled = false, store, loadResources,
  ready = async () => true, now = Date.now, schedule = setTimeout, unschedule = clearTimeout,
  report = () => {} } = {}) {
  const controller = new AbortController();
  let started = false, stopped = false, timer = null, active = null, failures = 0;

  function arm(delay) {
    if (stopped) return;
    timer = schedule(() => { timer = null; void tick(); }, Math.max(1000, Math.min(delay, 86400000)));
    timer?.unref?.();
  }

  async function work() {
    if (!await ready() || stopped) return 60000;
    const snapshot = await boundedOperation(signal => store.readJob(signal), 8000, controller.signal);
    const plan = planDailyImport(snapshot.value, now());
    if (plan.paused) return plan.window.next - now();
    if (plan.eligibleAt > now() || !plan.limits) return Math.max(1000, plan.eligibleAt - now());
    const budget = createImportRunBudget(plan.limits, { now, signal: controller.signal });
    try {
      // Include the scheduling probe in every acquired chunk. Two attempts
      // conservatively include a possible access-token request before GET.
      budget.read();
      budget.attempt();
      budget.attempt();
      const resources = await loadResources({ budget });
      if (stopped) return 60000;
      const result = await runPlayerImportSweep({ ...resources, budget, now, apply: true,
        intent: "daily", timeZone: "Australia/Sydney", daily: true, resumePaused: false });
      report({ status: result.status, checkpointConfirmed: result.checkpointConfirmed });
      if (stopped) return 60000;
      // The runner plans its verified final checkpoint with the startup
      // planner. An uncertain response needs a fresh read, within the already
      // reserved cleanup room and deadline; its allocation stays fully spent.
      if (result.nextRunAt) return Date.parse(result.nextRunAt) - now();
      const remaining = Math.min(8000, budget.deadline - now());
      if (remaining <= 0) return 60000;
      const latest = await boundedOperation(signal => store.readJob(signal), remaining, controller.signal);
      const next = planDailyImport(latest.value, now());
      const delay = next.paused ? next.window.next - now() : next.eligibleAt - now();
      if (result.status === "partial_errors" && !result.checkpointConfirmed) {
        // A failed acquisition may have left no durable reservation. Avoid a
        // one-second retry loop while retaining any durable recovery delay.
        throw Object.assign(new Error("Import completion was not acknowledged."), { retryAfterMs: Math.max(0, delay) });
      }
      return delay;
    } finally {
      budget.dispose();
    }
  }

  async function tick() {
    if (!enabled || stopped || active) return;
    active = work();
    let delay = 60000;
    try {
      delay = await active;
      failures = 0;
    } catch (error) {
      failures++;
      delay = Math.max(error?.retryAfterMs ?? 0, Math.min(3600000, 60000 * 2 ** Math.min(failures - 1, 6)));
      report({ status: "worker_unavailable" });
    } finally {
      active = null;
      arm(delay);
    }
  }

  return {
    start() {
      if (!enabled || started || stopped) return;
      started = true;
      void tick(); // Startup catches up the most recent due Sydney day.
    },
    async stop() {
      stopped = true;
      if (timer !== null) unschedule(timer);
      timer = null;
      controller.abort();
      await active?.catch(() => {});
    },
  };
}
