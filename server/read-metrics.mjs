import { AsyncLocalStorage } from "node:async_hooks";

const context = new AsyncLocalStorage();
const scopes = new Map();
const caches = new Map();
const MAX_SCOPES = 250;
const startedAt = new Date().toISOString();
const empty = () => ({ requests: 0, lookups: 0, queries: 0, aggregations: 0, documents: 0, missingDocuments: 0, emptyQueries: 0, estimatedReadFloor: 0, retries: 0, cacheHits: 0, cacheMisses: 0, cacheShared: 0, cacheInvalidations: 0, durationMs: 0 });
function target() {
  const scope = context.getStore()?.label() ?? "background/unattributed";
  if (!scopes.has(scope)) {
    if (scopes.size >= MAX_SCOPES) return scopes.get("other") ?? (scopes.set("other", empty()), scopes.get("other"));
    scopes.set(scope, empty());
  }
  return scopes.get(scope);
}
export function recordReadMetric(values) {
  const metrics = target();
  for (const key of Object.keys(empty())) if (Number.isFinite(values[key]) && values[key] >= 0) metrics[key] += values[key];
}
export function recordCacheMetric(name, event) {
  const key = { hit: "cacheHits", miss: "cacheMisses", shared: "cacheShared", invalidate: "cacheInvalidations" }[event];
  if (key) {
    recordReadMetric({ [key]: 1 });
    const label = typeof name === "string" && /^[a-zA-Z0-9:_-]{1,80}$/.test(name) ? name : "other";
    if (!caches.has(label) && caches.size < MAX_SCOPES) caches.set(label, { cacheHits: 0, cacheMisses: 0, cacheShared: 0, cacheInvalidations: 0 });
    if (caches.has(label)) caches.get(label)[key]++;
  }
}
export function withReadMetrics(scope, operation) {
  // Labels are static feature names supplied by code, never document IDs or query input.
  return context.run({ label: () => scope }, operation);
}
export function readMetricsMiddleware(req, res, next) {
  const start = performance.now();
  let resolved;
  const label = () => {
    if (typeof req.route?.path === "string" && req.baseUrl) resolved = `${req.method} ${req.baseUrl}${req.route.path}`;
    return resolved ?? `${req.method} ${typeof req.route?.path === "string" ? req.route.path : "/unmatched"}`;
  };
  context.run({ label }, () => {
    res.once("finish", () => context.run({ label }, () => recordReadMetric({ requests: 1, durationMs: performance.now() - start })));
    next();
  });
}
export function readMetricsSnapshot() {
  const totals = empty();
  const entries = [...scopes].map(([scope, metrics]) => {
    for (const key of Object.keys(totals)) totals[key] += metrics[key];
    return { scope, ...metrics };
  }).sort((a, b) => b.estimatedReadFloor - a.estimatedReadFloor);
  return { startedAt, measuredAt: new Date().toISOString(), processId: process.pid, totals, scopes: entries, caches: [...caches].map(([name, metrics]) => ({ name, ...metrics })),
    note: "Process-local operation estimates, not a Firestore bill. Aggregation/index-entry charges and infrastructure traffic require Cloud Monitoring reconciliation. No request bodies or document contents are recorded." };
}
export function startReadMetricsReporting({ intervalMs = 15 * 60_000, log = value => console.info(JSON.stringify(value)), warnAt = 40_000 } = {}) {
  let previous = 0;
  const timer = setInterval(() => {
    const snapshot = readMetricsSnapshot();
    const floor = snapshot.totals.estimatedReadFloor;
    log({ type: "firestore-read-usage", startedAt, processId: process.pid, intervalReadFloor: floor - previous, processReadFloor: floor,
      budgetReviewSuggested: floor >= warnAt, scopes: snapshot.scopes.slice(0, 20), note: snapshot.note });
    previous = floor;
  }, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
