import test from "node:test";
import assert from "node:assert/strict";
import { createCareersService } from "./careers-service.mjs";
import { createMemoryDb } from "./testing/careers-memory-db.mjs";

const admin = { id: "admin", role: "dev" };
const draft = { title: "Opening", category: "Community", description: "Apply", commitment: "", confirmation: "Thanks", closesAt: null, questions: [{ id: "question", type: "paragraph", label: "Describe this image", help: "", required: true }] };

test("question images reuse storage, validate uploads, and survive replacement in preserved versions", async () => {
  const memory = createMemoryDb(), objects = new Map();
  const service = createCareersService(memory.db, { imageStorage: {
    policy: () => ({ enabled: true, maxFileSizeBytes: 10_000_000, allowedExtensions: ["png", "jpg", "jpeg"] }),
    normalize: input => ({ objectName: input.fileName, contentType: input.contentType, size: input.size }),
    upload: key => ({ url: `https://storage.example/${key}`, headers: {}, expiresIn: 300 }),
    head: async key => objects.get(key), download: key => `https://storage.example/${key}`,
  } });
  const form = await service.createForm();
  const input = { fileName: "question.png", contentType: "image/png", size: 100 };
  await assert.rejects(service.images.begin(form.id, input, { id: "lead", role: "leadqa" }), { status: 403 });
  await assert.rejects(service.images.begin(form.id, { ...input, size: 6 * 1024 * 1024 }, admin));
  const upload = await service.images.begin(form.id, input, admin);
  const asset = memory.documents.get(`careerQuestionImages/${upload.uploadId}`);
  await assert.rejects(service.images.complete(form.id, upload.uploadId, { ...admin, id: "other" }), { status: 403 });
  await assert.rejects(service.images.complete(form.id, upload.uploadId, admin), { status: 409 });
  objects.set(asset.objectKey, { contentType: "image/jpeg", size: 100 });
  await assert.rejects(service.images.complete(form.id, upload.uploadId, admin), { status: 409 });
  objects.set(asset.objectKey, { contentType: "image/png", size: 100 });
  await service.images.complete(form.id, upload.uploadId, admin);
  await assert.rejects(service.images.image(upload.uploadId, { role: "member" }), { status: 404 });
  assert.match(await service.images.image(upload.uploadId, admin), /career-question-images/);
  const withImage = { ...draft, questions: [{ ...draft.questions[0], image: { id: upload.uploadId, alt: "A sample image" } }] };
  const saved = await service.saveForm(form.id, { action: "save", revision: 1, draft: withImage });
  assert.equal(memory.documents.get(`careerQuestionImages/${upload.uploadId}`).published, false);
  const published = await service.saveForm(form.id, { action: "publish", revision: saved.revision, draft: withImage });
  assert.match(await service.images.image(upload.uploadId, { role: "member" }), /career-question-images/);
  await service.saveForm(form.id, { action: "publish", revision: published.revision, draft });
  assert.equal(memory.documents.get(`careerFormVersions/${published.publishedVersion}`).questions[0].image.id, upload.uploadId);
  assert.match(await service.images.image(upload.uploadId, { role: "member" }), /career-question-images/);
  const other = await service.createForm();
  await assert.rejects(service.saveForm(other.id, { action: "publish", revision: 1, draft: withImage }), { status: 409 });
  await assert.rejects(service.saveForm(other.id, { action: "publish", revision: 1, draft: { ...withImage, questions: [{ ...withImage.questions[0], image: { id: upload.uploadId, alt: "" } }] } }), /Image description/);
});
test("published image metadata is cached but signed URLs are refreshed and private uploads remain protected", async () => {
  const memory = createMemoryDb({ "careerQuestionImages/published": { objectKey: "published-key", state: "ready", published: true }, "careerQuestionImages/private": { objectKey: "private-key", state: "ready", published: false } });
  let reads = 0, signatures = 0;
  const originalDoc = memory.db.doc;
  memory.db.doc = path => { const reference = originalDoc(path); return { ...reference, get: async () => { reads++; return reference.get(); } }; };
  const service = createCareersService(memory.db, { imageStorage: { policy: () => ({ enabled: true, maxFileSizeBytes: 5_000_000 }), download: key => `https://storage.example/${key}?signature=${++signatures}` } });
  const [a, b] = await Promise.all([service.images.image("published", { role: "member" }), service.images.image("published", admin)]);
  assert.notEqual(a, b); assert.equal(reads, 1);
  await service.images.image("published", { role: "member" }); assert.equal(reads, 1);
  assert.match(await service.images.image("private", admin), /private-key/);
  await assert.rejects(service.images.image("private", { role: "member" }), { status: 404 });
  assert.equal(reads, 3, "private metadata is not retained from an admin authorization");
});
