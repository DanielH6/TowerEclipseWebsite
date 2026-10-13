const statuses = new Set(["running", "scan_complete", "scan_complete_with_retries", "scan_complete_retry_status_unknown", "paused_budget", "partial_errors",
  "cancelled", "operator_paused", "busy", "waiting_retry", "nothing_due", "interrupted", "lease_lost"]);
const identifier = value => typeof value === "string" && /^[a-f0-9-]{36}$/.test(value) ? value : null;
const timestamp = value => typeof value === "string" && value.length <= 32 && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
const numbers = (value, keys) => Object.fromEntries(keys.map(key => [key, Number.isSafeInteger(value?.[key]) && value[key] >= 0 ? value[key] : null]));

export function projectImportRunStatus(job, now) {
  const run = job.run;
  if (!run || run.schemaVersion !== 1 || !identifier(run.id)) return null;
  let status = statuses.has(run.status) ? run.status : "interrupted";
  if (status === "running" && (job.lease?.id !== run.id || job.lease.until <= now)) status = job.paused ? "operator_paused" : "interrupted";
  return { id: run.id, source: run.source === "website_worker" ? "website_worker" : "private_cli", status, writeMode: "apply", startedAt: timestamp(run.startedAt), finishedAt: timestamp(run.finishedAt),
    sweepId: identifier(job.sweep?.id), sweepDay: typeof job.sweep?.day === "string" && /^\d{4}-\d\d-\d\d$/.test(job.sweep.day) ? job.sweep.day : null,
    intent: ["resume", "daily", "new"].includes(run.intent) ? run.intent : null,
    pendingRetries: typeof run.pendingRetries === "boolean" ? run.pendingRetries : null,
    usage: numbers(run.usage, ["profiles", "reads", "writes", "attempts", "elapsedSeconds"]),
    results: numbers(run.results, ["created", "updated", "unchanged", "skipped", "deferred", "retried", "listFailures"]),
    limits: numbers(run.limits, ["profiles", "reads", "writes", "attempts", "seconds", "retryProfiles"]),
  };
}
