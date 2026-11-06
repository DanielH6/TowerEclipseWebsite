import { recordCacheMetric } from "./read-metrics.mjs";

// Bounded process-local cache with shared fills and generation-safe invalidation.
// Callers use identity/role/version-qualified keys for private or mutable data.
export function createReadCache({ name = "read-cache", maxEntries = 100, maxBytes = 16 * 1024 * 1024, ttlMs = 60_000, now = Date.now, onEvent = recordCacheMetric, maxPending = 100 } = {}) {
  const entries = new Map(), pending = new Map();
  let bytes = 0, generation = 0;
  const event = type => onEvent?.(name, type);
  function remove(key) { const old = entries.get(key); if (old) { bytes -= old.bytes; entries.delete(key); } }
  function store(key, value, lifetime) {
    const size = Buffer.byteLength(JSON.stringify(value) ?? "null");
    remove(key);
    if (size > maxBytes || maxEntries < 1) return;
    while (entries.size >= maxEntries || bytes + size > maxBytes) remove(entries.keys().next().value);
    entries.set(key, { value, bytes: size, expires: now() + lifetime }); bytes += size;
  }
  return {
    async get(key, load, options = {}) {
      const saved = entries.get(key);
      if (saved && saved.expires > now()) { entries.delete(key); entries.set(key, saved); event("hit"); return saved.value; }
      remove(key);
      if (pending.has(key)) { event("shared"); return pending.get(key); }
      if (pending.size >= maxPending) throw Object.assign(new Error("Too many cache refreshes are in progress. Please try again shortly."), { status: 503 });
      event("miss");
      const epoch = generation;
      const work = Promise.resolve().then(load).then(value => {
        if (epoch === generation && pending.get(key) === work) store(key, value, options.ttlMs ?? ttlMs);
        return value;
      }).finally(() => { if (pending.get(key) === work) pending.delete(key); });
      pending.set(key, work);
      return work;
    },
    peek(key) { const saved = entries.get(key); if (!saved || saved.expires <= now()) { remove(key); return undefined; } return saved.value; },
    set(key, value, options = {}) { pending.delete(key); store(key, value, options.ttlMs ?? ttlMs); },
    invalidate(key) { remove(key); pending.delete(key); event("invalidate"); },
    clear() { generation++; entries.clear(); pending.clear(); bytes = 0; event("invalidate"); },
    stats() { return { entries: entries.size, bytes, pending: pending.size, maxBytes, maxEntries }; },
  };
}
