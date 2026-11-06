import test from "node:test";
import assert from "node:assert/strict";
import { createReadCache } from "./read-cache.mjs";
import { createDurableReadCache } from "./durable-read-cache.mjs";
import { createNewsReadModel, publicNewsFields } from "./news-read-model.mjs";
import { createTournamentReadModel } from "./tournament-read-model.mjs";
import { createAchievementListService } from "./achievement-list.mjs";
import { createListThumbnailService } from "./achievement-list-thumbnails.mjs";
import { createWorkflowMemoryDb } from "./testing/workflow-memory-db.mjs";

const memoryCache = () => { const value = createReadCache({ name: "test-public", maxBytes: 8 * 1024 * 1024 }); return { get: value.get, invalidate: value.clear }; };
const storage = () => { const values = new Map(); return { values, read: key => structuredClone(values.get(key) ?? null), write: (key, value) => values.set(key, structuredClone(value)) }; };
const post = index => ({ status: "published", title: `Post ${index}`, version: `v${index}`, contentType: "game_update", isMinor: false,
  publishedOn: new Date(Date.UTC(2020, 0, index + 1)).toISOString().slice(0, 10), updatedAt: "2026-11-07T00:00:00Z", author: { displayName: "Author", discordId: "private-author-id", token: "private-token" },
  internalNotes: "private-note", sections: [], linkedReports: [{ id: "report1", summary: "Approved public fix", privateDescription: "private-report-body" }] });

test("durable public caches share fills, survive process cache replacement, and never resurrect an invalidated generation", async () => {
  const disk = storage(), first = createDurableReadCache({ name: "isolated", storage: disk }), second = createDurableReadCache({ name: "isolated", storage: disk });
  let calls = 0, release, started;
  const wait = new Promise(resolve => { release = resolve; }), ready = new Promise(resolve => { started = resolve; });
  const loading = first.get("key", async () => { calls++; if (calls === 1) { started(); await wait; return "old"; } return "fresh"; });
  await ready; second.invalidate(); const marker = disk.read("isolated-generation").generation; release();
  assert.equal(await loading, "fresh"); assert.equal(disk.read("isolated-generation").generation, marker);
  assert.equal(await second.get("key", () => { throw Error("Durable artifact was not reused"); }), "fresh");
  second.invalidate(); let fills = 0;
  assert.deepEqual(await Promise.all([second.get("shared", async () => { fills++; return { safe: true }; }), second.get("shared", async () => { fills++; return {}; })]), [{ safe: true }, { safe: true }]);
  assert.equal(fills, 1);
});

test("news archive cursor/search covers more than 100 posts with no repeated database scan per page and explicit public fields", async () => {
  const seed = Object.fromEntries(Array.from({ length: 437 }, (_, index) => [`updates/p${String(index).padStart(4, "0")}`, post(index)]));
  seed["updates/private"] = { ...post(1000), status: "draft" };
  const f = createWorkflowMemoryDb(seed), service = createNewsReadModel({ db: f.db, cache: memoryCache(), hydrateSummary: doc => publicNewsFields(doc.data(), doc.id, { summary: true }), hydrateDetail: doc => publicNewsFields(doc.data(), doc.id) });
  const first = await service.list(); assert.equal(first.updates.length, 12); assert.equal(first.publishedTotal, 437); assert.equal(first.updates[0].title, "Post 436");
  assert.equal(f.calls.filter(call => call.path === "updates").length, 3);
  const ids = new Set(); let page = first;
  while (true) { for (const item of page.updates) { assert.ok(!ids.has(item.id)); ids.add(item.id); } if (!page.nextCursor) break; page = await service.list({ cursor: page.nextCursor }); }
  assert.equal(ids.size, 437); assert.equal(f.calls.filter(call => call.path === "updates").length, 3);
  assert.equal((await service.list({ search: "Post 3" })).total, 111);
  assert.equal((await service.list({ search: "v0" })).updates[0].id, "p0000", "old archive matches remain searchable");
  const serialized = JSON.stringify(await service.detail("p0000"));
  for (const value of ["private-author-id", "private-token", "private-note", "private-report-body"]) assert.equal(serialized.includes(value), false);
  assert.match(serialized, /Approved public fix/);
  f.documents.set("updates/new", post(1001)); service.invalidate();
  await assert.rejects(service.list({ cursor: first.nextCursor }), { status: 409 });
  assert.equal((await service.list()).publishedTotal, 438);
  await assert.rejects(service.detail("../private"), { status: 400 });
});

test("public news DTO retains legacy image references without exposing uploader or private fields", () => {
  const safe = publicNewsFields({ ...post(1), sections: [{ id: "features", kind: "new_features", title: "Features", introHtml: "", items: [{ id: "old", title: "Old entry", bodyHtml: "Text", imageId: "image1", caption: "Legacy caption", private: "no" }] }] }, "post1");
  assert.deepEqual(safe.sections[0].items[0].images, [{ imageId: "image1", caption: "Legacy caption" }]);
  assert.equal(JSON.stringify(safe).includes('"private"'), false);
});

test("tournament list queries public eligibility, preserves all entries, caches misses, and invalidates previews separately", async () => {
  const f = createWorkflowMemoryDb({ "tournaments/open": { published: true, status: "scheduled", slug: "cup", startsAt: "2026-11-08" }, "tournaments/private": { published: false, status: "draft", slug: "private-cup" }, "tournaments/old": { published: true, status: "archived", slug: "old-cup" } });
  const service = createTournamentReadModel({ db: f.db, cache: memoryCache(), presentSummary: value => ({ id: value.id }), presentDetail: value => ({ id: value.id, slug: value.slug }) });
  assert.deepEqual(await service.list(), [{ id: "open" }]);
  const before = f.calls.length; await service.list(); assert.equal(f.calls.length, before);
  assert.equal((await service.detail("cup")).id, "open");
  assert.equal(await service.detail("private-cup"), null);
  const after = f.calls.length; assert.equal(await service.detail("private-cup"), null); assert.equal(f.calls.length, after);
  const preview = await service.find("private-cup"); assert.equal(preview.data().published, false, "authorized preview resolution does not populate public detail cache");
  assert.equal(await service.detail("private-cup"), null);
  f.documents.get("tournaments/open").published = false; service.invalidate(); assert.deepEqual(await service.list(), []);
  const reads = f.calls.length; await assert.rejects(service.detail("../private"), { status: 400 }); assert.equal(f.calls.length, reads);
});

test("achievement publication caches list/history and clears old revisions while published thumbnail reads are shared safely", async () => {
  const f = createWorkflowMemoryDb(), service = createAchievementListService(f.db);
  await service.read(); const before = f.calls.length; await service.read(); assert.equal(f.calls.length, before);
  const entry = { id: "one", name: "Achievement", difficulty: 5, verifier: "Verifier", videoUrl: "https://youtu.be/abcdefghijk", requirements: "Solo" };
  await service.save({ revision: 0, entries: [entry] }, { id: "admin", displayName: "Admin" });
  assert.equal((await service.read()).revision, 1); await service.history(); const historyReads = f.calls.length; await service.history(); assert.equal(f.calls.length, historyReads);
  f.documents.set("achievementListThumbnails/image1", { state: "ready", published: true, objectKey: "public/image" });
  f.documents.set("achievementListThumbnails/draft1", { state: "ready", published: false, objectKey: "private/image", ownerId: "owner" });
  const thumbnails = createListThumbnailService(f.db, { download: key => `fixture:${key}` });
  assert.equal(await thumbnails.image("image1"), "fixture:public/image"); const imageReads = f.calls.length; await thumbnails.image("image1"); assert.equal(f.calls.length, imageReads);
  await assert.rejects(thumbnails.image("draft1", { id: "other", role: "dev" }), { status: 404 });
  assert.equal(await thumbnails.image("draft1", { id: "owner", role: "dev" }), "fixture:private/image");
  await assert.rejects(thumbnails.image("draft1"), { status: 404 }, "a draft owner read cannot publish or share the draft");
});
