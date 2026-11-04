import { randomUUID } from "node:crypto";

// A durable queue with a transaction lease, owned by the website lifecycle.
// Merely viewing a review/status endpoint never starts a paid API request.
export function createCareerAiWorker({ service, ready = async () => true, report = () => {}, intervalMs = 15000 } = {}) {
  const owner = randomUUID(), controller = new AbortController();
  let started = false, stopped = false, timer = null, active = null;
  function arm(delay) {
    if (stopped || !started || !service.configuration().configured) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; void tick(); }, delay);
    timer.unref?.();
  }
  async function tick() {
    if (stopped || active || !service.configuration().configured) return;
    active = (async () => {
      if (!await ready() || stopped) return false;
      return service.workNext({ owner, signal: controller.signal });
    })();
    let more = false;
    try { more = await active; } catch { report("AI review worker unavailable; saved jobs remain in the queue."); }
    finally { active = null; arm(more ? 100 : intervalMs); }
  }
  service.setNotifier(() => { if (started) { if (timer) clearTimeout(timer); timer = null; void tick(); } });
  return {
    start() { if (started || stopped) return; started = true; void tick(); },
    async stop() { stopped = true; if (timer) clearTimeout(timer); controller.abort(); await active?.catch(() => {}); },
  };
}
