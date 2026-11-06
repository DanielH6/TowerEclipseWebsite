import { createHash } from "node:crypto";
import { createDurableReadCache } from "./durable-read-cache.mjs";

const bad = message => Object.assign(new Error(message), { status: 400 });
const idPattern = /^[A-Za-z0-9_-]{1,80}$/;
const stamp = value => value?.toDate ? value.toDate().toISOString() : value instanceof Date ? value.toISOString() : value ?? null;
const archiveTime = value => Date.parse(value.publishedOn ? `${value.publishedOn}T00:00:00.000Z` : stamp(value.publishedAt) ?? stamp(value.updatedAt)) || 0;

export function publicNewsFields(value, id, { summary = false } = {}) {
  const sections = (value.sections ?? []).map(section => ({ id: section.id, kind: section.kind, title: section.title, introHtml: summary ? (section.introHtml ? "present" : "") : section.introHtml ?? "",
    items: (section.items ?? []).map(item => summary ? { id: item.id, title: "", bodyHtml: "", imageLayout: "none", bugFixLevel: item.bugFixLevel ?? null, images: [] } : { id: item.id, title: item.title, bodyHtml: item.bodyHtml ?? "", imageLayout: item.imageLayout ?? "none", bugFixLevel: item.bugFixLevel ?? null,
      images: (Array.isArray(item.images) ? item.images : item.imageId ? [{ imageId: item.imageId, caption: item.caption ?? "" }] : []).map(image => ({ imageId: image.imageId, caption: image.caption ?? "" })), ...(item.imageId ? { imageId: item.imageId } : {}) }) }));
  return { id, contentType: value.contentType === "developer_blog" ? "developer_blog" : "game_update", isMinor: value.contentType !== "developer_blog" && value.isMinor === true,
    title: value.title ?? "", version: value.version ?? "", status: "published", publishedOn: value.publishedOn ?? null, publishedAt: stamp(value.publishedAt), updatedAt: stamp(value.updatedAt), createdAt: stamp(value.createdAt),
    author: { displayName: value.author?.displayName ?? "Tower Eclipse" },
    developerCommentHtml: summary ? "" : value.developerCommentHtml ?? "", blogHtml: summary ? "" : value.blogHtml ?? "", coverImageId: value.coverImageId ?? null, sections,
    linkedReports: summary ? [] : (value.linkedReports ?? []).map(link => ({ id: link.id, displayId: link.displayId, summary: link.summary })),
  };
}

export function createNewsReadModel({ db, hydrateSummary, hydrateDetail, cache, now = Date.now, detailTtlMs = 60_000 } = {}) {
  cache ??= createDurableReadCache({ name: "public-news-v3", ttlMs: 300_000, maxBytes: 16 * 1024 * 1024, maxEntries: 150, now });
  async function manifest() {
    return cache.get("archive", async () => {
      const items = [], base = db.collection("updates").where("status", "==", "published").orderBy("__name__", "asc"); let cursor;
      while (true) {
        const page = await (cursor ? base.startAfter(cursor) : base).limit(200).get();
        for (const document of page.docs) items.push(await hydrateSummary(document));
        if (page.docs.length < 200) break; cursor = page.docs.at(-1).ref.path;
      }
      items.sort((a, b) => archiveTime(b) - archiveTime(a) || b.id.localeCompare(a.id));
      return { revision: createHash("sha256").update(JSON.stringify(items)).digest("hex").slice(0, 24), items };
    });
  }
  return {
    invalidate() { cache.invalidate(); },
    async list(options = {}) {
      const search = String(options.search ?? "").trim().toLowerCase();
      if (search.length > 100) throw bad("Search updates using at most 100 characters.");
      const all = await manifest(), matches = all.items.filter(item => !search || [item.title, item.version, item.author.displayName].some(value => value.toLowerCase().includes(search)));
      let offset = 0;
      if (options.cursor) {
        try { if (typeof options.cursor !== "string" || options.cursor.length > 700) throw Error(); const parsed = JSON.parse(Buffer.from(options.cursor, "base64url").toString()); if (parsed.revision !== all.revision || parsed.search !== search || !idPattern.test(parsed.id)) throw Error(); offset = matches.findIndex(item => item.id === parsed.id) + 1; if (!offset) throw Error(); }
        catch { throw Object.assign(new Error("The news archive changed. Return to the first page."), { status: 409 }); }
      }
      const items = matches.slice(offset, offset + 12);
      return { updates: items, nextCursor: offset + 12 < matches.length ? Buffer.from(JSON.stringify({ revision: all.revision, search, id: items.at(-1).id })).toString("base64url") : null,
        total: matches.length, publishedTotal: all.items.length, currentVersion: all.items.find(item => item.contentType === "game_update" && item.version)?.version ?? "—", latestFullUpdateId: all.items.find(item => item.contentType === "game_update" && !item.isMinor)?.id ?? null, revision: all.revision };
    },
    async detail(id) {
      if (!idPattern.test(id)) throw bad("Invalid update identifier.");
      const value = await cache.get(`detail:${id}`, async () => { const doc = await db.doc(`updates/${id}`).get(); return doc.exists && doc.data().status === "published" ? hydrateDetail(doc) : null; }, { ttlMs: detailTtlMs });
      if (!value) throw Object.assign(new Error("Update not found."), { status: 404 });
      return value;
    },
  };
}
