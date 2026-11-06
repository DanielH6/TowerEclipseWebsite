import test from "node:test";
import assert from "node:assert/strict";
import { createCareerAiWorker } from "./careers-ai-worker.mjs";

const flush = () => new Promise(resolve => setImmediate(resolve));
function fixture(workNext = async () => false, configured = true) {
  let notify;
  const schedules = [], pending = new Map();
  let id = 0, calls = 0;
  const worker = createCareerAiWorker({ service: { configuration: () => ({ configured }), setNotifier: callback => { notify = callback; }, workNext: async options => { calls++; return workNext(options); } },
    intervalMs: 10, maxIdleMs: 80, schedule: (callback, delay) => { const key = ++id; pending.set(key, callback); schedules.push(delay); return key; }, unschedule: key => pending.delete(key) });
  return { worker, schedules, calls: () => calls, notify: () => notify(), runTimer: async () => { const [key, callback] = pending.entries().next().value; pending.delete(key); callback(); await flush(); }, pending };
}
test("worker recovers at startup, backs off empty durable discovery and wakes immediately on notification", async () => {
  const f = fixture();
  f.worker.start(); await flush();
  assert.equal(f.calls(), 1, "startup always probes the durable queue");
  for (let i = 0; i < 5; i++) await f.runTimer();
  assert.deepEqual(f.schedules, [10, 20, 40, 80, 80, 80]);
  f.notify(); await flush();
  assert.equal(f.calls(), 7);
  assert.equal(f.schedules.at(-1), 10, "local new jobs reset idle backoff");
  await f.worker.stop(); assert.equal(f.pending.size, 0);
});
test("notification arriving during an idle query is retained and active work returns to short scheduling", async () => {
  let release;
  const delayed = new Promise(resolve => { release = resolve; });
  const f = fixture(async () => { await delayed; return false; });
  f.worker.start(); await flush(); f.notify(); release(); await flush();
  assert.equal(f.calls(), 1);
  assert.equal(f.schedules[0], 100, "a notification during an in-flight tick is not lost");
  await f.worker.stop();
  const active = fixture(async () => true);
  active.worker.start(); await flush(); assert.equal(active.schedules[0], 100); await active.worker.stop();
});
test("unconfigured workers never query or schedule", async () => {
  const f = fixture(async () => false, false);
  f.worker.start(); f.notify(); await flush();
  assert.equal(f.calls(), 0); assert.deepEqual(f.schedules, []); await f.worker.stop();
});
