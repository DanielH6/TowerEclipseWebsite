import { PROPOSED_IMPORT_BUDGET, validateImportBudget } from "./player-import-budget.mjs";

export const DAILY_IMPORT_TIME_ZONE = "Australia/Sydney";
export const DAILY_IMPORT_HOUR = 3;
export const DAILY_IMPORT_CHUNK = Object.freeze({
  profiles: 25,
  reads: 300,
  writes: 100,
  attempts: 600,
  seconds: 60,
  retryProfiles: 2,
});
const keys = Object.keys(PROPOSED_IMPORT_BUDGET);
const emptyUsage = () => Object.fromEntries(keys.map(key => [key, 0]));
const copyUsage = value => Object.fromEntries(keys.map(key => [key, value[key]]));
const iso = value => new Date(value).toISOString();
const validTimestamp = value => typeof value === "string" && Number.isFinite(Date.parse(value))
  && iso(Date.parse(value)) === value;
const validUsage = value => value && keys.every(key => Number.isSafeInteger(value[key])
  && value[key] >= 0 && value[key] <= PROPOSED_IMPORT_BUDGET[key]);

function localParts(value) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: DAILY_IMPORT_TIME_ZONE,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(value));
  return Object.fromEntries(parts.filter(part => part.type !== "literal")
    .map(part => [part.type, Number(part.value)]));
}

function localThreeAm(date) {
  const wanted = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), DAILY_IMPORT_HOUR);
  let instant = wanted;
  for (let iteration = 0; iteration < 4; iteration++) {
    const parts = localParts(instant);
    const represented = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    instant += wanted - represented;
  }
  return instant;
}

// Calendar days, rather than 24-hour intervals, preserve 03:00 through DST.
export function dailyImportWindow(now) {
  const parts = localParts(now);
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  if (localThreeAm(date) > now) date.setUTCDate(date.getUTCDate() - 1);
  const start = localThreeAm(date), day = date.toISOString().slice(0, 10);
  date.setUTCDate(date.getUTCDate() + 1);
  return { day, start, next: localThreeAm(date) };
}

export function validateDailyImportState(value) {
  if (value === undefined) return;
  let validReservation = true;
  if (value?.reservation) {
    try {
      validateImportBudget(value.reservation.limits);
      validReservation = typeof value.reservation.invocationId === "string"
        && /^[a-f0-9-]{36}$/.test(value.reservation.invocationId)
        && keys.every(key => value.reservation.limits[key] <= value.used?.[key]);
    } catch {
      validReservation = false;
    }
  }
  if (!value || value.schemaVersion !== 1 || !/^\d{4}-\d{2}-\d{2}$/.test(value.day)
    || !Number.isSafeInteger(value.invocations) || value.invocations < 0
    || !validUsage(value.used) || !validTimestamp(value.dueAt)
    || ![value.lastStartedAt, value.lastFinishedAt].every(date => date === null || validTimestamp(date))
    || !validReservation
    || (value.uncertainUsed !== undefined && (!validUsage(value.uncertainUsed)
      || keys.some(key => value.uncertainUsed[key] + (value.reservation?.limits[key] ?? 0) > value.used[key])))
    || (value.failureStreak !== undefined && (!Number.isSafeInteger(value.failureStreak) || value.failureStreak < 0))) {
    throw new Error("Invalid daily importer state.");
  }
}

export function planDailyImport(job, now) {
  validateDailyImportState(job?.daily);
  const window = dailyImportWindow(now);
  const state = job?.daily?.day === window.day ? structuredClone(job.daily) : {
    schemaVersion: 1,
    day: window.day,
    invocations: 0,
    used: emptyUsage(),
    uncertainUsed: emptyUsage(),
    failureStreak: 0,
    dueAt: iso(window.start),
    lastStartedAt: null,
    lastFinishedAt: null,
  };
  state.uncertainUsed ??= emptyUsage();
  state.failureStreak ??= 0;
  const remaining = Object.fromEntries(keys.map(key => [key, PROPOSED_IMPORT_BUDGET[key] - state.used[key]]));
  let limits = Object.fromEntries(keys.map(key => [key, Math.min(DAILY_IMPORT_CHUNK[key], remaining[key])]));
  limits.retryProfiles = Math.min(limits.retryProfiles, limits.profiles);
  try { validateImportBudget(limits); } catch { limits = null; }
  let eligibleAt = limits ? Date.parse(state.dueAt) : window.next;
  if (limits && state.reservation) {
    const recoveryDelay = Math.min(3600000, 60000 * 2 ** Math.min(state.failureStreak, 6));
    eligibleAt = Math.max(eligibleAt, Date.parse(state.lastStartedAt) + recoveryDelay);
  }
  if (job?.lease?.until > now) eligibleAt = Math.max(eligibleAt, job.lease.until);
  return { state, remaining, limits, eligibleAt, window, paused: job?.paused === true };
}

export function reserveDailyImport(plan, limits, invocationId, now) {
  if (!plan.limits || plan.eligibleAt > now || keys.some(key => limits[key] > plan.limits[key])) {
    throw new Error("Daily importer is not due or its chunk budget is exhausted.");
  }
  const state = structuredClone(plan.state);
  if (state.reservation) {
    // The previous owner did not acknowledge completion. Its entire chunk
    // remains charged; only the record of that uncertainty changes here.
    for (const key of keys) state.uncertainUsed[key] += state.reservation.limits[key];
    state.failureStreak++;
  }
  state.invocations++;
  state.lastStartedAt = iso(now);
  state.reservation = { invocationId, limits: { ...limits } };
  for (const key of keys) state.used[key] += limits[key];
  return state;
}

export function finishDailyImport(state, { usage, retried, status, pendingRetryAt, now }) {
  const window = dailyImportWindow(now), limits = state.reservation.limits;
  const spent = { ...usage, seconds: usage.elapsedSeconds + 8, retryProfiles: retried };
  // All work must be acknowledged and no mutation in flight before reclaiming
  // unused allocation. Include the final CAS/GET and its bounded time/attempts.
  spent.reads++;
  spent.writes++;
  spent.attempts += 3;
  for (const key of keys) state.used[key] -= Math.max(0, limits[key] - Math.min(limits[key], spent[key]));
  delete state.reservation;
  state.lastFinishedAt = iso(now);
  const failed = ["partial_errors", "cancelled"].includes(status);
  state.failureStreak = failed ? state.failureStreak + 1 : 0;
  const backoff = Math.min(3600000, 60000 * 2 ** Math.min(Math.max(0, state.failureStreak - 1), 6));
  let due = status === "paused_budget" ? now : window.next;
  if (failed) due = Math.min(window.next, now + backoff);
  if (pendingRetryAt && status !== "paused_budget") {
    due = Math.min(due, Math.max(now + backoff, Date.parse(pendingRetryAt)));
  }
  state.dueAt = iso(due);
  return state;
}

export function projectDailyImportState(job, now) {
  if (!job.daily) return null;
  const plan = planDailyImport(job, now);
  const daily = job.daily;
  const reservation = daily.reservation;
  const active = reservation && job.lease?.id === reservation.invocationId && job.lease.until > now;
  const uncertain = copyUsage(daily.uncertainUsed ?? emptyUsage());
  if (reservation && !active) {
    for (const key of keys) uncertain[key] += reservation.limits[key];
  }
  return {
    day: daily.day,
    timeZone: DAILY_IMPORT_TIME_ZONE,
    state: job.paused ? "operator_paused" : !plan.limits ? "daily_budget_exhausted"
      : reservation ? active ? "chunk_reserved" : "unconfirmed_chunk" : "waiting",
    nextEligibleAt: job.paused ? null : iso(Math.max(now, plan.eligibleAt)),
    charged: copyUsage(daily.used),
    uncertainCharged: uncertain,
    reserved: reservation ? { ...reservation.limits } : emptyUsage(),
    remaining: { ...plan.remaining },
    limits: { ...PROPOSED_IMPORT_BUDGET },
    chunkLimits: { ...DAILY_IMPORT_CHUNK },
  };
}
