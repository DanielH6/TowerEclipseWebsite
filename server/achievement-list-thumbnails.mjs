import { randomUUID } from "node:crypto";
import { attachmentStoragePolicy, normalizeAttachmentInput, createAttachmentUploadUrl, createAttachmentDownloadUrl, headAttachmentObject, deleteAttachmentObject } from "./r2.mjs";

const defaultStorage = { policy: attachmentStoragePolicy, normalize: normalizeAttachmentInput, upload: createAttachmentUploadUrl, download: createAttachmentDownloadUrl, head: headAttachmentObject, remove: deleteAttachmentObject };
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const validId = value => typeof value === "string" && /^[\w-]{1,64}$/.test(value);

export function createListThumbnailService(db, storage = defaultStorage) {
  const reference = id => {
    if (!validId(id)) fail(400, "Invalid thumbnail ID.");
    return db.doc(`achievementListThumbnails/${id}`);
  };
  const policy = () => ({ ...storage.policy(), maxFilesPerReport: 1, maxFileSizeBytes: Math.min(storage.policy().maxFileSizeBytes, 5 * 1024 * 1024) });
  const requireOwner = (asset, actor) => {
    if (!asset || asset.state === "cancelled") fail(404, "Thumbnail upload not found.");
    if (asset.ownerId !== actor?.id) fail(403, "Only the uploading admin can manage this draft thumbnail.");
  };
  return {
    policy,
    async begin(input, actor) {
      if (!policy().enabled) fail(503, "Thumbnail uploads are unavailable because image storage is not configured.");
      if (!validId(input?.entryId)) fail(400, "A valid achievement ID is required.");
      const normalized = storage.normalize(input);
      if (normalized.size > policy().maxFileSizeBytes) fail(413, "The thumbnail exceeds the allowed file size.");
      const id = randomUUID();
      const objectKey = `achievement-list-thumbnails/${input.entryId}/${id}/${normalized.objectName}`;
      const upload = storage.upload(objectKey, normalized.contentType);
      await reference(id).set({ entryId: input.entryId, ownerId: actor.id, objectKey, originalName: normalized.originalName, contentType: normalized.contentType, declaredSize: normalized.size, state: "pending", published: false, createdAt: new Date().toISOString(), uploadExpiresAt: new Date(Date.now() + (upload.expiresIn + 300) * 1000).toISOString() });
      return { uploadId: id, uploadUrl: upload.url, uploadHeaders: upload.headers };
    },
    async complete(id, actor) {
      const ref = reference(id);
      const asset = (await ref.get()).data(); requireOwner(asset, actor);
      if (asset.state === "ready") return { thumbnailId: id };
      if (Date.parse(asset.uploadExpiresAt) <= Date.now()) fail(410, "The thumbnail upload expired. Select the image again.");
      const object = await storage.head(asset.objectKey);
      if (!object) fail(409, "The image has not finished uploading. Try again.");
      if (object.size !== asset.declaredSize || object.contentType !== asset.contentType) fail(400, "The uploaded thumbnail does not match the selected image.");
      await db.runTransaction(async transaction => {
        const latest = (await transaction.get(ref)).data(); requireOwner(latest, actor);
        if (latest.state === "ready") return;
        if (Date.parse(latest.uploadExpiresAt) <= Date.now()) fail(410, "The thumbnail upload expired. Select the image again.");
        transaction.update(ref, { state: "ready", uploadedAt: new Date().toISOString() });
      });
      return { thumbnailId: id };
    },
    async cancel(id, actor) {
      const ref = reference(id);
      const key = await db.runTransaction(async transaction => {
        const asset = (await transaction.get(ref)).data();
        if (!asset) return null;
        if (asset.ownerId !== actor?.id) fail(403, "Only the uploading admin can cancel this upload.");
        if (asset.published) fail(409, "Published thumbnails are retained for the change log. Remove the override in the list editor instead.");
        transaction.update(ref, { state: "cancelled" });
        return asset.objectKey;
      });
      if (key) await storage.remove(key, { ignoreMissing: true });
    },
    async image(id, actor) {
      const asset = (await reference(id).get()).data();
      if (!asset || asset.state !== "ready" || (!asset.published && (actor?.role !== "dev" || asset.ownerId !== actor.id))) fail(404, "Thumbnail not found.");
      return storage.download(asset.objectKey);
    },
    async preparePublication(transaction, entries, actor) {
      const newlyPublished = [];
      for (const entry of entries) {
        if (!entry.thumbnailId) continue;
        const ref = reference(entry.thumbnailId);
        const asset = (await transaction.get(ref)).data();
        if (!asset || asset.state !== "ready" || asset.entryId !== entry.id) fail(409, `The thumbnail for ${entry.name} is not ready. Upload it again or remove the override.`);
        if (!asset.published) {
          requireOwner(asset, actor);
          newlyPublished.push(ref);
        }
      }
      // The caller writes these only after every transaction read has completed.
      return newlyPublished;
    },
  };
}
