const maximum = { profiles: 10000, reads: 200000, writes: 50000, attempts: 300000, seconds: 3600, retryProfiles: 1000 };
const minimum = { profiles: 1, reads: 20, writes: 4, attempts: 30, seconds: 30, retryProfiles: 0 };
export const PROPOSED_IMPORT_BUDGET = Object.freeze({ profiles: 1000, reads: 10000, writes: 4000, attempts: 20000, seconds: 1800, retryProfiles: 50 });
const failure = reason => Object.assign(new Error("The bounded import stopped."), { code: "IMPORT_RUN_STOPPED", reason });

export function validateImportBudget(value) {
  if (!value || Object.keys(value).some(key => !(key in maximum))) throw failure("invalid_budget");
  for (const key of Object.keys(maximum)) if (!Number.isSafeInteger(value[key]) || value[key] < minimum[key] || value[key] > maximum[key]) throw failure("invalid_budget");
  if (value.retryProfiles > value.profiles) throw failure("invalid_budget");
  return { ...value };
}

export function createImportRunBudget(limits, { now = Date.now, signal } = {}) {
  limits = validateImportBudget(limits);
  const startedAt = now(), deadline = startedAt + limits.seconds * 1000;
  const controller = new AbortController(), usage = { profiles: 0, reads: 0, writes: 0, attempts: 0 };
  let closing = false, stopReason = null;
  const abort = () => { stopReason ??= "cancelled"; controller.abort(); };
  signal?.addEventListener("abort", abort, { once: true }); if (signal?.aborted) abort();
  const timer = setTimeout(() => { stopReason ??= "time_budget"; controller.abort(); }, limits.seconds * 1000);
  const reserve = { profiles: 0, reads: 2, writes: 1, attempts: 4 };
  function ensureRoom(cost = {}) {
    if (!closing && (stopReason || controller.signal.aborted)) throw failure(stopReason ?? "cancelled");
    if (now() >= deadline || (!closing && deadline - now() <= 8500)) throw failure("time_budget");
    for (const [key, amount] of Object.entries(cost)) {
      if (usage[key] + amount > limits[key] - (closing ? 0 : reserve[key])) throw failure(`${key}_budget`);
    }
  }
  function consume(key, amount = 1) {
    try { ensureRoom({ [key]: amount }); usage[key] += amount; }
    catch (error) { stopReason ??= error.reason ?? "budget"; controller.abort(); throw error; }
  }
  return {
    limits, signal: controller.signal, startedAt, deadline, ensureRoom,
    profile: () => consume("profiles"), read: (amount = 1) => consume("reads", amount), write: () => consume("writes"), attempt: () => consume("attempts"),
    snapshot: () => ({ ...usage, elapsedSeconds: Math.max(0, Math.ceil((now() - startedAt) / 1000)) }),
    reason: () => stopReason,
    async close(operation) {
      closing = true;
      try { return await operation(); } finally { closing = false; }
    },
    dispose() { clearTimeout(timer); signal?.removeEventListener("abort", abort); },
  };
}
