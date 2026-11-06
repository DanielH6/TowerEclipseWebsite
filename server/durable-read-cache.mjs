import { randomUUID } from "node:crypto";
import { createReadCache } from "./read-cache.mjs";
import { readLocalJsonCache, writeLocalJsonCache } from "./local-cache.mjs";

// Shared-volume generation markers propagate invalidation across Node workers.
// Other hosts without that volume revalidate at the bounded TTL. Disk failures
// affect acceleration only; they never authorize or publish a private response.
export function createDurableReadCache({ name, ttlMs = 300_000, maxEntries = 100, maxBytes = 8 * 1024 * 1024, now = Date.now, storage = { read: readLocalJsonCache, write: writeLocalJsonCache } } = {}) {
  const memory = createReadCache({ name, ttlMs, maxEntries, maxBytes, now });
  let local = { generation: "initial", entries: {} }, localGeneration = "initial";
  const state = () => {
    // Only invalidation writes the separate marker. A late stale fill can
    // replace an entries artifact but can never resurrect an old generation.
    const marker = storage.read(`${name}-generation`);
    if (typeof marker?.generation === "string") localGeneration = marker.generation;
    const disk = storage.read(name);
    if (disk?.generation === localGeneration && disk.entries && typeof disk.entries === "object") local = disk;
    else if (local.generation !== localGeneration) local = { generation: localGeneration, entries: {} };
    return local;
  };
  return {
    async get(key, loader, options = {}) {
      for (let attempt = 0; attempt < 3; attempt++) {
        const before = state(), generation = before.generation;
        const value = await memory.get(`${generation}:${key}`, async () => {
          const saved = state().entries[key];
          if (saved && saved.expires > now()) return saved.value;
          const loaded = await loader();
          const current = state();
          if (current.generation === generation) {
            const entries = Object.fromEntries(Object.entries(current.entries).filter(([, entry]) => entry.expires > now()));
            entries[key] = { value: loaded, expires: now() + (options.ttlMs ?? ttlMs) };
            while (Object.keys(entries).length > maxEntries || Buffer.byteLength(JSON.stringify(entries)) > maxBytes) {
              const oldest = Object.keys(entries)[0]; if (!oldest) break; delete entries[oldest];
            }
            local = { generation, entries }; storage.write(name, local);
          }
          return loaded;
        }, options);
        if (state().generation === generation) return value;
      }
      throw Object.assign(new Error("Published content changed during loading. Please try again."), { status: 409 });
    },
    invalidate() { memory.clear(); localGeneration = randomUUID(); storage.write(`${name}-generation`, { generation: localGeneration }); local = { generation: localGeneration, entries: {} }; storage.write(name, local); },
    stats: memory.stats,
  };
}
