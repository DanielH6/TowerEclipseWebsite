import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createAchievementListRouter, createAchievementListService } from "./achievement-list.mjs";
import { createMemoryDb } from "./testing/careers-memory-db.mjs";
import { config } from "./config.mjs";

const admin = { id: "uploader", role: "dev", displayName: "List Admin" };
const entry = (id = "summit") => ({ id, name: id, verifier: "Verifier", difficulty: 8, requirements: "", videoUrl: "https://youtu.be/abcdefghijk" });
const uploadInput = { entryId: "summit", fileName: "thumbnail.png", contentType: "image/png", size: 68 };
function fixture() {
  const memory = createMemoryDb(); const objects = new Map(); let enabled = true;
  const storage = {
    policy: () => ({ enabled, maxFileSizeBytes: 10 * 1024 * 1024, allowedExtensions: ["png", "jpg", "jpeg"] }),
    normalize: input => ({ originalName: input.fileName, objectName: "thumbnail.png", contentType: input.contentType, size: input.size }),
    upload: (key, type) => ({ url: `https://uploads.example/${key}`, headers: { "Content-Type": type }, expiresIn: 300 }),
    download: key => `https://downloads.example/${key}?signed=fixture`,
    head: async key => objects.get(key) ?? null,
    remove: async key => objects.delete(key),
  };
  const service = createAchievementListService(memory.db, { thumbnailStorage: storage });
  const storeUpload = ticket => {
    const key = memory.documents.get(`achievementListThumbnails/${ticket.uploadId}`).objectKey;
    objects.set(key, { size: uploadInput.size, contentType: uploadInput.contentType }); return key;
  };
  return { ...memory, service, objects, storeUpload, disable: () => { enabled = false; } };
}

test("thumbnail uploads remain private until list publication and publish with an audit entry", async () => {
  const f = fixture(); const ticket = await f.service.thumbnails.begin(uploadInput, admin);
  assert.equal(f.service.thumbnails.policy().maxFileSizeBytes, 5 * 1024 * 1024);
  assert.equal(ticket.objectKey, undefined);
  await assert.rejects(f.service.thumbnails.complete(ticket.uploadId, admin), { status: 409 });
  f.storeUpload(ticket); await f.service.thumbnails.complete(ticket.uploadId, admin);
  await assert.rejects(f.service.thumbnails.image(ticket.uploadId), { status: 404 });
  await assert.rejects(f.service.thumbnails.image(ticket.uploadId, { id: "someone-else", role: "dev" }), { status: 404 });
  await assert.rejects(f.service.thumbnails.image(ticket.uploadId, { ...admin, role: "member" }), { status: 404 });
  assert.match(await f.service.thumbnails.image(ticket.uploadId, admin), /^https:\/\/downloads\.example\//);
  const saved = await f.service.save({ revision: 0, entries: [{ ...entry(), thumbnailId: ticket.uploadId }] }, admin);
  assert.equal(saved.entries[0].thumbnailId, ticket.uploadId);
  assert.equal(f.documents.get(`achievementListThumbnails/${ticket.uploadId}`).published, true);
  assert.match(await f.service.thumbnails.image(ticket.uploadId), /^https:\/\/downloads\.example\//);
  assert.ok(!JSON.stringify(saved).includes("objectKey"));
  assert.equal((await f.service.history()).publications[0].changes[0].fields.find(field => field.field === "thumbnailId").after, ticket.uploadId);
  await f.service.save({ revision: 1, entries: [{ ...saved.entries[0], name: "Updated by another admin" }] }, { id: "other", role: "dev" });
  await f.service.save({ revision: 2, entries: [{ ...saved.entries[0], thumbnailId: "" }] }, admin);
  assert.equal((await f.service.read()).entries[0].thumbnailId, "");
  assert.equal((await f.service.read()).entries[0].videoUrl, "https://www.youtube.com/watch?v=abcdefghijk");
  assert.match(await f.service.thumbnails.image(ticket.uploadId), /^https:/, "historical published images remain accessible from the change log");
  await assert.rejects(f.service.thumbnails.cancel(ticket.uploadId, admin), { status: 409 });
});

test("thumbnail publication rejects missing, pending, foreign-entry and another admin's draft assets", async () => {
  const f = fixture(); const ticket = await f.service.thumbnails.begin(uploadInput, admin);
  const save = (id, asset = ticket.uploadId, actor = admin) => f.service.save({ revision: 0, entries: [{ ...entry(id), thumbnailId: asset }] }, actor);
  await assert.rejects(save("summit", "does-not-exist"), { status: 409 });
  await assert.rejects(save("summit"), { status: 409 });
  f.storeUpload(ticket); await f.service.thumbnails.complete(ticket.uploadId, admin);
  await assert.rejects(save("different-entry"), { status: 409 });
  await assert.rejects(save("summit", ticket.uploadId, { id: "other" }), { status: 403 });
  assert.equal((await f.service.read()).revision, 0); assert.equal((await f.service.history()).publications.length, 0);
  assert.equal(f.documents.get(`achievementListThumbnails/${ticket.uploadId}`).published, false);
});

test("upload verification enforces owner, metadata, expiry, storage availability and cancellation", async () => {
  const f = fixture();
  await assert.rejects(f.service.thumbnails.begin({ ...uploadInput, size: 6 * 1024 * 1024 }, admin), { status: 413 });
  await assert.rejects(f.service.thumbnails.begin({ ...uploadInput, entryId: "../elsewhere" }, admin), { status: 400 });
  const ticket = await f.service.thumbnails.begin(uploadInput, admin); const key = f.storeUpload(ticket);
  await assert.rejects(f.service.thumbnails.complete(ticket.uploadId, { id: "other" }), { status: 403 });
  await assert.rejects(f.service.thumbnails.cancel(ticket.uploadId, { id: "other" }), { status: 403 });
  f.objects.set(key, { size: 67, contentType: "image/png" });
  await assert.rejects(f.service.thumbnails.complete(ticket.uploadId, admin), { status: 400 });
  f.objects.set(key, { size: 68, contentType: "text/html" });
  await assert.rejects(f.service.thumbnails.complete(ticket.uploadId, admin), { status: 400 });
  f.storeUpload(ticket); f.documents.get(`achievementListThumbnails/${ticket.uploadId}`).uploadExpiresAt = "2020-01-01T00:00:00Z";
  await assert.rejects(f.service.thumbnails.complete(ticket.uploadId, admin), { status: 410 });
  await f.service.thumbnails.cancel(ticket.uploadId, admin); assert.equal(f.objects.has(key), false);
  await assert.rejects(f.service.thumbnails.complete(ticket.uploadId, admin), { status: 404 });
  f.disable(); await assert.rejects(f.service.thumbnails.begin(uploadInput, admin), { status: 503 });
});

test("upload endpoints enforce real admin, origin and CSRF guards; public downloads require publication", async t => {
  const f = fixture(); const app = express(); app.use(express.json());
  const optional = (req, _res, next) => { const role = req.get("X-Test-Role"); if (role) { req.authUser = { ...admin, role }; req.authSession = { role, csrfToken: "fixture-csrf" }; } next(); };
  const auth = (req, res, next) => optional(req, res, () => req.authUser ? next() : res.status(401).json({ error: "Sign in" }));
  app.use("/api/list", createAchievementListRouter({ service: f.service, auth, optional }));
  app.use((error, _req, res, _next) => res.status(error.status || 500).json({ error: error.message }));
  const server = await new Promise(resolve => { const instance = app.listen(0, "127.0.0.1", () => resolve(instance)); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api/list`;
  const trusted = { "X-Test-Role": "dev", "X-CSRF-Token": "fixture-csrf", Origin: config.appOrigin, "Content-Type": "application/json" };
  const request = (path, method = "GET", headers = {}, body) => fetch(base + path, { method, headers, redirect: "manual", ...(body ? { body: JSON.stringify(body) } : {}) });
  for (const [path, method] of [["/thumbnail-config", "GET"], ["/thumbnails", "POST"], ["/thumbnails/fixture/complete", "POST"], ["/thumbnails/fixture", "DELETE"]]) {
    assert.equal((await request(path, method)).status, 401);
    for (const role of ["member", "qa", "leadqa"]) assert.equal((await request(path, method, { ...trusted, "X-Test-Role": role })).status, 403);
    if (method !== "GET") {
      assert.equal((await request(path, method, { "X-Test-Role": "dev" })).status, 403);
      assert.equal((await request(path, method, { ...trusted, Origin: "https://untrusted.example" })).status, 403);
    }
  }
  const response = await request("/thumbnails", "POST", trusted, uploadInput); assert.equal(response.status, 201); const ticket = await response.json();
  f.storeUpload(ticket); assert.equal((await request(`/thumbnails/${ticket.uploadId}/complete`, "POST", trusted)).status, 200);
  assert.equal((await request(`/thumbnails/${ticket.uploadId}/image`)).status, 404);
  const preview = await request(`/thumbnails/${ticket.uploadId}/image`, "GET", trusted); assert.equal(preview.status, 302); assert.match(preview.headers.get("cache-control"), /no-store/);
  assert.equal((await request("/", "PUT", trusted, { revision: 0, entries: [{ ...entry(), thumbnailId: ticket.uploadId }] })).status, 200);
  const image = await request(`/thumbnails/${ticket.uploadId}/image`); assert.equal(image.status, 302); assert.match(image.headers.get("location"), /^https:\/\/downloads\.example\//);
});
