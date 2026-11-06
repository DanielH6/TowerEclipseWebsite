import { randomUUID } from "node:crypto";
import { identifier, fail } from "./careers-domain.mjs";
import { attachmentStoragePolicy, normalizeAttachmentInput, createAttachmentUploadUrl, createAttachmentDownloadUrl, headAttachmentObject } from "./r2.mjs";

const defaultStorage = { policy: attachmentStoragePolicy, normalize: normalizeAttachmentInput, upload: createAttachmentUploadUrl, download: createAttachmentDownloadUrl, head: headAttachmentObject };
export function createCareerImageService(db, storage = defaultStorage) {
  const published = new Map(), pending = new Map();
  async function metadata(id) {
    const key = identifier(id), saved = published.get(key);
    if (saved?.until > Date.now()) return saved.asset;
    if (pending.has(key)) return pending.get(key);
    const work = reference(key).get().then(snapshot => {
      const asset = snapshot.data();
      // Pending/private uploads are never retained as public metadata.
      if (asset?.published && asset.state === "ready") {
        published.delete(key); published.set(key, { asset, until: Date.now() + 60 * 60_000 });
        while (published.size > 250) published.delete(published.keys().next().value);
      }
      return asset;
    });
    pending.set(key, work);
    try { return await work; } finally { if (pending.get(key) === work) pending.delete(key); }
  }
  const reference = id => db.doc(`careerQuestionImages/${identifier(id)}`);
  const policy = () => ({ ...storage.policy(), maxFilesPerReport: 1, maxFileSizeBytes: Math.min(storage.policy().maxFileSizeBytes, 5 * 1024 * 1024) });
  function requireAdmin(actor) { if (actor?.role !== "dev") fail("Only developers can upload question images.", 403); }
  return {
    policy,
    async begin(formId, input, actor) {
      requireAdmin(actor);
      if (!(await db.doc(`careerForms/${identifier(formId)}`).get()).exists) fail("Opening not found.", 404);
      if (!policy().enabled) fail("Question image uploads are unavailable until image storage is configured.", 503);
      const file = storage.normalize(input);
      if (file.size > policy().maxFileSizeBytes) fail("Choose an image smaller than 5 MB.", 413);
      const id = randomUUID(), objectKey = `career-question-images/${formId}/${id}/${file.objectName}`;
      const upload = storage.upload(objectKey, file.contentType);
      await reference(id).set({ formId, ownerId: actor.id, objectKey, contentType: file.contentType, size: file.size, state: "pending", published: false, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + (upload.expiresIn + 300) * 1000).toISOString() });
      return { uploadId: id, uploadUrl: upload.url, uploadHeaders: upload.headers };
    },
    async complete(formId, id, actor) {
      requireAdmin(actor);
      const target = reference(id), asset = (await target.get()).data();
      if (!asset || asset.formId !== identifier(formId)) fail("Question image not found.", 404);
      if (asset.ownerId !== actor.id) fail("Only the uploading admin can complete this upload.", 403);
      if (asset.state === "ready") return { imageId: id };
      if (Date.parse(asset.expiresAt) <= Date.now()) fail("The image upload expired. Select the image again.", 410);
      const object = await storage.head(asset.objectKey);
      if (!object || object.size !== asset.size || object.contentType !== asset.contentType) fail("The uploaded image does not match the selected file. Try again.", 409);
      await db.runTransaction(async tx => {
        const current = (await tx.get(target)).data();
        if (!current || current.state !== "pending" || Date.parse(current.expiresAt) <= Date.now()) fail("The image upload expired or changed. Try again.", 409);
        tx.update(target, { state: "ready" });
      });
      return { imageId: id };
    },
    async image(id, actor) {
      const asset = await metadata(id);
      if (!asset || asset.state !== "ready" || (!asset.published && actor?.role !== "dev")) fail("Question image not found.", 404);
      return storage.download(asset.objectKey);
    },
    async prepare(tx, formId, questions) {
      const images = [];
      for (const id of new Set(questions.flatMap(q => q.image ? [q.image.id] : []))) {
        const target = reference(id), asset = (await tx.get(target)).data();
        if (!asset || asset.formId !== formId || asset.state !== "ready") fail("A question image is not ready or belongs to another opening. Upload it again or remove it.", 409);
        if (!asset.published) images.push(target);
      }
      return images;
    },
  };
}
