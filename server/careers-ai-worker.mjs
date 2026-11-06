import { randomUUID } from "node:crypto";
import { withReadMetrics } from "./read-metrics.mjs";

// A durable queue with a transaction lease, owned by the website lifecycle.
// Merely viewing a review/status endpoint never starts a paid API request.
export function createCareerAiWorker({ service, ready = async () => true, report = () => {}, intervalMs = 15000, maxIdleMs = 5 * 60_000, schedule = setTimeout, unschedule = clearTimeout } = {}) {
  const owner = randomUUID(), controller = new AbortController();
  let started = false, stopped = false, timer = null, active = null, idleDelay = intervalMs, notified = false;
  function arm(delay) {
    if (stopped || !started || !service.configuration().configured) return;
    if (timer !== null) unschedule(timer);
    timer = schedule(() => { timer = null; void tick(); }, delay);
    timer.unref?.();
  }
  async function tick() {
    if (stopped || active || !service.configuration().configured) return;
    active = withReadMetrics("careers-ai-worker", async () => {
      if (!await ready() || stopped) return false;
      return service.workNext({ owner, signal: controller.signal });
    });
    let more = false;
    try { more = await active; } catch { report("AI review worker unavailable; saved jobs remain in the queue."); }
    finally {
      active = null;
      const delay = more || notified ? 100 : idleDelay;
      idleDelay = more || notified ? intervalMs : Math.min(maxIdleMs, Math.max(intervalMs, idleDelay * 2));
      notified = false;
      arm(delay);
    }
  }
  service.setNotifier(() => {
    idleDelay = intervalMs;
    if (started && !stopped) {
      if (timer !== null) unschedule(timer);
      timer = null;
      if (active) notified = true; else void tick();
    }
  });
  return {
    start() { if (started || stopped) return; started = true; void tick(); },
    async stop() { stopped = true; if (timer !== null) unschedule(timer); controller.abort(); await active?.catch(() => {}); },
  };
}
