import test from "node:test";
import assert from "node:assert/strict";
import { createReadCache } from "./read-cache.mjs";
import { withReadMetrics, recordReadMetric, readMetricsSnapshot } from "./read-metrics.mjs";

test("shared cache fills, bounded bytes, expiry and invalidation prevent stale repopulation", async () => {
  let time = 0, release, calls = 0;
  const cache = createReadCache({ now: () => time, ttlMs: 10, maxEntries: 2, maxBytes: 100 });
  const loader = () => { calls++; return new Promise(resolve => { release = resolve; }); };
  const a = cache.get("private:a", loader), b = cache.get("private:a", loader);
  await Promise.resolve(); assert.equal(calls, 1); release({ value: "saved" });
  assert.deepEqual(await a, await b);
  await cache.get("private:a", () => { throw Error("cache miss"); });
  time = 11; const stale = cache.get("private:a", loader); await Promise.resolve(); cache.invalidate("private:a"); release({ value: "stale" }); await stale;
  assert.equal((await cache.get("private:a", () => ({ value: "fresh" }))).value, "fresh");
  await cache.get("huge", () => "x".repeat(101)); assert.ok(cache.stats().bytes <= 100);
  await assert.rejects(cache.get("failure", () => { throw Error("failure"); }));
  assert.equal(await cache.get("failure", () => "recovered"), "recovered");
});
test("read metrics aggregate safe static feature labels without data bodies", async () => {
  await withReadMetrics("test:feature", async () => recordReadMetric({ queries: 1, documents: 50, estimatedReadFloor: 50, secret: 123 }));
  const metrics = readMetricsSnapshot().scopes.find(item => item.scope === "test:feature");
  assert.equal(metrics.queries, 1); assert.equal(metrics.documents, 50); assert.equal(metrics.secret, undefined);
});
test("updating one cache key does not discard an unrelated fill and cleared fills cannot resurrect", async () => {
  const cache = createReadCache(); let release;
  const pending = cache.get("other", () => new Promise(resolve => { release = resolve; }));
  await Promise.resolve(); cache.set("mine", "updated"); release("retained"); await pending;
  assert.equal(cache.peek("other"), "retained");
  const abandoned = cache.get("old", () => new Promise(resolve => { release = resolve; }));
  await Promise.resolve(); cache.clear(); release("obsolete"); await abandoned;
  assert.equal(cache.peek("old"), undefined);
});
