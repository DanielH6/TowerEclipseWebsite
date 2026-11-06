import { createReadCache } from "./read-cache.mjs";
import { createDurableReadCache } from "./durable-read-cache.mjs";

const valid = value => typeof value === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(value);
export function createTournamentReadModel({ db, presentSummary, presentDetail, cache, ttlMs = 90_000, now = Date.now } = {}) {
  cache ??= createDurableReadCache({ name: "public-tournaments-v3", ttlMs, now, maxEntries: 150, maxBytes: 8 * 1024 * 1024 });
  const resolutions = createReadCache({ name: "tournament-slugs", ttlMs: 15 * 60_000, maxEntries: 300, now });
  async function find(identifier) {
    if (!valid(identifier)) throw Object.assign(new Error("Invalid tournament identifier."), { status: 400 });
    const saved = resolutions.peek(identifier);
    if (saved) return db.doc(`tournaments/${saved}`).get();
    const direct = await db.doc(`tournaments/${identifier}`).get();
    if (direct.exists) { resolutions.set(identifier, direct.id); return direct; }
    const page = await db.collection("tournaments").where("slug", "==", identifier).limit(1).get();
    const doc = page.docs[0] ?? null; if (doc) resolutions.set(identifier, doc.id);
    return doc;
  }
  return {
    invalidate() { resolutions.clear(); cache.invalidate(); }, find,
    async list() {
      return cache.get("list", async () => {
        const items = [], base = db.collection("tournaments").where("published", "==", true).where("status", "in", ["draft", "scheduled", "live", "completed"]).orderBy("__name__", "asc"); let cursor;
        while (true) { const page = await (cursor ? base.startAfter(cursor) : base).limit(200).get(); items.push(...page.docs.map(doc => ({ id: doc.id, ...doc.data() }))); if (page.docs.length < 200) break; cursor = page.docs.at(-1).ref.path; }
        const ranks = { live: 0, scheduled: 1, draft: 2, completed: 3 };
        items.sort((a, b) => Number(Boolean(b.featured)) - Number(Boolean(a.featured)) || (ranks[a.status] ?? 9) - (ranks[b.status] ?? 9) || Date.parse(b.startsAt) - Date.parse(a.startsAt));
        return items.map(presentSummary);
      });
    },
    async detail(identifier) {
      if (!valid(identifier)) throw Object.assign(new Error("Invalid tournament identifier."), { status: 400 });
      return cache.get(`detail:${identifier}`, async () => { const doc = await find(identifier); if (!doc?.exists) return null; const value = { id: doc.id, ...doc.data() }; return value.published && value.status !== "archived" ? presentDetail(value) : null; });
    },
  };
}
