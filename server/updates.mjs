import { randomUUID } from "node:crypto";
import express from "express";
import { FieldValue, Timestamp, db } from "./firebase.mjs";
import {
  actorSnapshot,
  requireAuth,
  requireCsrf,
  requireExactRole,
} from "./auth-context.mjs";
import {
  createAttachmentDownloadUrl,
  createAttachmentUploadUrl,
  deleteAttachmentObject,
  headAttachmentObject,
  normalizeAttachmentInput,
  updateImageStoragePolicy,
} from "./r2.mjs";
import {
  assertPublishableNewsContent,
  dateOnlyFromValue,
  MAX_IMAGES_PER_UPDATE,
  normalizeEntryImages,
  normalizeMinorFlag,
  normalizeNewsContentType,
  normalizePublishedOn,
  sanitizeUpdateRichText as sanitizeRichText,
  storedEntryImages,
  updateRichTextPlainLength as richTextPlainLength,
} from "./update-content.mjs";

const publicUpdateCacheTtlMs = Math.max(
  5_000,
  Number(process.env.FIRESTORE_PUBLIC_UPDATE_CACHE_TTL_SECONDS ?? 60) * 1000,
);
let publicUpdateListCache = null;
let publicUpdateListCacheExpiresAt = 0;
const publicUpdateDetailCache = new Map();

function invalidatePublicUpdateCache(updateId = null) {
  publicUpdateListCache = null;
  publicUpdateListCacheExpiresAt = 0;
  if (updateId) publicUpdateDetailCache.delete(updateId);
  else publicUpdateDetailCache.clear();
}

const SECTION_DEFINITIONS = Object.freeze([
  { kind: "new_features", title: "New Features" },
  { kind: "balancing", title: "Balancing Changes" },
  { kind: "bug_fixes", title: "Bug Fixes" },
  { kind: "small_changes", title: "Small Changes" },
]);
const SECTION_KINDS = new Set(SECTION_DEFINITIONS.map((section) => section.kind));
const IMAGE_LAYOUTS = new Set(["none", "left", "right", "gallery"]);
const BUG_FIX_LEVELS = new Set(["major", "minor"]);
const UPDATE_STATUSES = new Set(["draft", "published"]);
const CONTENT_TYPES = new Set(["game_update", "developer_blog"]);
const ID_PATTERN = /^[a-zA-Z0-9_-]{1,80}$/;

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function cleanText(value, field, { min = 0, max = 5000 } = {}) {
  if (typeof value !== "string") {
    throw httpError(400, `${field} must be a string.`);
  }
  const result = value.trim();
  if (result.length < min || result.length > max) {
    throw httpError(400, `${field} must contain between ${min} and ${max} characters.`);
  }
  return result;
}

function cleanId(value, field) {
  if (typeof value !== "string" || !ID_PATTERN.test(value)) {
    throw httpError(400, `${field} must be a valid identifier.`);
  }
  return value;
}

function serialize(value) {
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (Array.isArray(value)) return value.map(serialize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [key, serialize(nested)]),
    );
  }
  return value;
}

function serializeDocument(document) {
  return { id: document.id, ...serialize(document.data()) };
}

function defaultSections() {
  return SECTION_DEFINITIONS.map((definition) => ({
    id: definition.kind,
    kind: definition.kind,
    title: definition.title,
    introHtml: "",
    items: [],
  }));
}

function normalizeItem(rawItem, sectionKind, index) {
  if (!rawItem || typeof rawItem !== "object") {
    throw httpError(400, `sections.${sectionKind}.items.${index} must be an object.`);
  }
  const id = cleanId(rawItem.id || randomUUID(), `sections.${sectionKind}.items.${index}.id`);
  const title = cleanText(rawItem.title ?? "", `sections.${sectionKind}.items.${index}.title`, {
    min: 1,
    max: 180,
  });
  const bodyHtml = sanitizeRichText(
    rawItem.bodyHtml ?? "",
    `sections.${sectionKind}.items.${index}.bodyHtml`,
  );
  if (richTextPlainLength(bodyHtml) < 1) {
    throw httpError(400, `${title} needs a description.`);
  }

  const images = normalizeEntryImages(
    rawItem,
    `sections.${sectionKind}.items.${index}`,
    title,
  );
  const imageLayout = images.length > 0
    ? (IMAGE_LAYOUTS.has(rawItem.imageLayout) && rawItem.imageLayout !== "none"
      ? rawItem.imageLayout
      : (images.length > 1 ? "gallery" : "right"))
    : "none";
  const bugFixLevel = sectionKind === "bug_fixes"
    ? (BUG_FIX_LEVELS.has(rawItem.bugFixLevel) ? rawItem.bugFixLevel : "minor")
    : null;

  return {
    id,
    title,
    bodyHtml,
    images,
    imageLayout,
    bugFixLevel,
  };
}

function normalizeSections(rawSections) {
  if (!Array.isArray(rawSections)) {
    throw httpError(400, "sections must be an array.");
  }
  if (rawSections.length > SECTION_DEFINITIONS.length) {
    throw httpError(400, "Too many update sections were supplied.");
  }

  const supplied = new Map();
  for (const rawSection of rawSections) {
    if (!rawSection || typeof rawSection !== "object" || !SECTION_KINDS.has(rawSection.kind)) {
      throw httpError(400, "An update section has an unsupported kind.");
    }
    if (supplied.has(rawSection.kind)) {
      throw httpError(400, `The ${rawSection.kind} section was supplied more than once.`);
    }
    supplied.set(rawSection.kind, rawSection);
  }

  let totalItems = 0;
  const sections = SECTION_DEFINITIONS.map((definition) => {
    const rawSection = supplied.get(definition.kind) ?? {};
    const rawItems = rawSection.items ?? [];
    if (!Array.isArray(rawItems)) {
      throw httpError(400, `${definition.kind}.items must be an array.`);
    }
    totalItems += rawItems.length;
    if (totalItems > 500) {
      throw httpError(400, "An update can contain at most 120 entries.");
    }

    return {
      id: definition.kind,
      kind: definition.kind,
      title: definition.title,
      introHtml: sanitizeRichText(
        rawSection.introHtml ?? "",
        `${definition.kind}.introHtml`,
        { max: 20000 },
      ),
      items: rawItems.map((item, index) => normalizeItem(item, definition.kind, index)),
    };
  });

  return sections;
}

function collectImageIds(update) {
  const ids = new Set();
  if (update.coverImageId) ids.add(update.coverImageId);
  for (const section of update.sections ?? []) {
    for (const item of section.items ?? []) {
      if (Array.isArray(item.images)) {
        item.images.forEach((image) => {
          if (image?.imageId) ids.add(image.imageId);
        });
      } else if (item.imageId) {
        ids.add(item.imageId);
      }
    }
  }
  return ids;
}

async function readyImages(reference, imageIds = null) {
  let documents;
  if (imageIds && imageIds.size > 0) {
    const snapshots = await db.getAll(
      ...[...imageIds].map((imageId) => reference.collection("images").doc(imageId)),
    );
    documents = snapshots.filter((snapshot) => snapshot.exists);
  } else if (imageIds && imageIds.size === 0) {
    documents = [];
  } else {
    const snapshot = await reference.collection("images").limit(200).get();
    documents = snapshot.docs;
  }

  return new Map(
    documents
      .filter((document) => document.data().status === "ready")
      .map((document) => [document.id, document]),
  );
}

function serializeImageDocument(document) {
  const value = serializeDocument(document);
  const { objectKey, ...publicValue } = value;
  const policy = updateImageStoragePolicy();
  return {
    ...publicValue,
    downloadUrl: policy.enabled && value.status === "ready"
      ? createAttachmentDownloadUrl(objectKey)
      : null,
  };
}

async function hydrateUpdate(document, { includeDraft = false } = {}) {
  const value = serializeDocument(document);
  if (!includeDraft && value.status !== "published") return null;
  const images = await readyImages(document.ref, collectImageIds(value));
  let figureNumber = 0;

  const hydrateImage = (imageId) => {
    if (!imageId) return null;
    const image = images.get(imageId);
    return image ? serializeImageDocument(image) : null;
  };

  const sections = (value.sections ?? defaultSections()).map((section) => ({
    ...section,
    items: (section.items ?? []).map((item) => {
      const storedImages = storedEntryImages(item);
      const images = storedImages.flatMap((storedImage) => {
        const image = hydrateImage(storedImage?.imageId);
        if (!image) return [];
        figureNumber += 1;
        return [{
          imageId: storedImage.imageId,
          caption: typeof storedImage.caption === "string" ? storedImage.caption : "",
          image,
          figureNumber,
        }];
      });
      return {
        id: item.id,
        title: item.title,
        bodyHtml: item.bodyHtml,
        imageLayout: images.length > 0
          ? (IMAGE_LAYOUTS.has(item.imageLayout) && item.imageLayout !== "none"
            ? item.imageLayout
            : (images.length > 1 ? "gallery" : "right"))
          : "none",
        bugFixLevel: item.bugFixLevel ?? null,
        images,
      };
    }),
  }));

  return {
    ...value,
    contentType: CONTENT_TYPES.has(value.contentType) ? value.contentType : "game_update",
    isMinor: value.contentType !== "developer_blog" && value.isMinor === true,
    blogHtml: typeof value.blogHtml === "string" ? value.blogHtml : "",
    publishedOn: dateOnlyFromValue(value.publishedOn) ?? dateOnlyFromValue(value.publishedAt),
    coverImage: value.contentType === "developer_blog" ? null : hydrateImage(value.coverImageId),
    sections,
    imagePolicy: updateImageStoragePolicy(),
  };
}

async function hydrateUpdateSummary(document, { includeDraft = false } = {}) {
  const value = serializeDocument(document);
  if (!includeDraft && value.status !== "published") return null;

  let coverImage = null;
  if (value.coverImageId) {
    const snapshot = await document.ref.collection("images").doc(value.coverImageId).get();
    if (snapshot.exists && snapshot.data().status === "ready") {
      coverImage = serializeImageDocument(snapshot);
    }
  }

  return {
    ...value,
    coverImage,
    imagePolicy: updateImageStoragePolicy(),
  };
}

async function validateReferencedImages(reference, update) {
  const ids = collectImageIds(update);
  if (ids.size === 0) return;
  const images = await readyImages(reference, ids);
  for (const id of ids) {
    if (!images.has(id)) {
      throw httpError(400, `Image ${id} is missing or has not finished uploading.`);
    }
  }
}

async function cleanupUnreferencedImages(reference, update) {
  const referenced = collectImageIds(update);
  const snapshot = await reference.collection("images").limit(MAX_IMAGES_PER_UPDATE + 100).get();
  for (const document of snapshot.docs) {
    if (referenced.has(document.id)) continue;
    const image = document.data();
    try {
      await deleteAttachmentObject(image.objectKey, { ignoreMissing: true });
    } catch (error) {
      console.warn(`Could not remove unused update image ${image.objectKey}:`, error);
      continue;
    }
    await document.ref.delete();
  }
}

async function removeUpdateAndImages(reference) {
  const snapshot = await reference.collection("images").limit(MAX_IMAGES_PER_UPDATE + 100).get();
  for (const document of snapshot.docs) {
    const image = document.data();
    try {
      await deleteAttachmentObject(image.objectKey, { ignoreMissing: true });
    } catch (error) {
      console.warn(`Could not remove R2 update image ${image.objectKey}:`, error);
    }
  }
  for (let index = 0; index < snapshot.docs.length; index += 450) {
    const batch = db.batch();
    snapshot.docs.slice(index, index + 450).forEach((document) => batch.delete(document.ref));
    await batch.commit();
  }
  await reference.delete();
}

function normalizeUpdateInput(body, current) {
  const contentType = normalizeNewsContentType(body.contentType ?? current.contentType ?? "game_update");
  const isMinor = normalizeMinorFlag(body.isMinor ?? current.isMinor ?? false, contentType);
  const title = cleanText(body.title ?? current.title ?? "", "title", { min: 1, max: 180 });
  const version = contentType === "game_update"
    ? cleanText(body.version ?? current.version ?? "", "version", { min: 0, max: 80 })
    : "";
  const developerCommentHtml = contentType === "game_update"
    ? sanitizeRichText(
      body.developerCommentHtml ?? current.developerCommentHtml ?? "",
      "developerCommentHtml",
    )
    : "";
  const blogHtml = contentType === "developer_blog"
    ? sanitizeRichText(body.blogHtml ?? current.blogHtml ?? "", "blogHtml", { max: 120000 })
    : "";
  const status = body.status ?? current.status ?? "draft";
  if (!UPDATE_STATUSES.has(status)) {
    throw httpError(400, "status must be draft or published.");
  }
  const coverImageId = contentType === "developer_blog" || body.coverImageId == null || body.coverImageId === ""
    ? null
    : cleanId(body.coverImageId, "coverImageId");
  const sections = contentType === "game_update"
    ? normalizeSections(body.sections ?? current.sections ?? defaultSections())
    : defaultSections();
  const suppliedPublishedOn = Object.prototype.hasOwnProperty.call(body, "publishedOn")
    ? body.publishedOn
    : (current.publishedOn ?? dateOnlyFromValue(current.publishedAt));
  let publishedOn = normalizePublishedOn(suppliedPublishedOn);
  publishedOn ??= dateOnlyFromValue(current.publishedAt);

  if (status === "published") {
    publishedOn ??= new Date().toISOString().slice(0, 10);
    assertPublishableNewsContent({
      contentType,
      version,
      blogHtml,
      itemCount: sections.reduce((total, section) => total + section.items.length, 0),
    });
  }

  return {
    contentType,
    isMinor,
    title,
    version,
    developerCommentHtml,
    blogHtml,
    coverImageId,
    sections,
    status,
    publishedOn,
  };
}

function archiveTime(update) {
  const value = update.publishedOn
    ? `${update.publishedOn}T00:00:00.000Z`
    : (update.publishedAt ?? update.updatedAt);
  return new Date(value).getTime();
}

async function listPublishedUpdates(_request, response, next) {
  try {
    const now = Date.now();
    if (publicUpdateListCache && now < publicUpdateListCacheExpiresAt) {
      response.json({ updates: publicUpdateListCache });
      return;
    }

    const snapshot = await db.collection("updates").where("status", "==", "published").limit(100).get();
    const updates = (await Promise.all(snapshot.docs.map((document) => hydrateUpdateSummary(document))))
      .filter(Boolean)
      .sort((left, right) => new Date(right.publishedAt ?? right.updatedAt).getTime() - new Date(left.publishedAt ?? left.updatedAt).getTime());
    publicUpdateListCache = updates;
    publicUpdateListCacheExpiresAt = Date.now() + publicUpdateCacheTtlMs;
    response.json({ updates });
  } catch (error) {
    next(error);
  }
}

async function getPublishedUpdate(request, response, next) {
  try {
    const cached = publicUpdateDetailCache.get(request.params.updateId);
    if (cached && Date.now() < cached.expiresAt) {
      response.json({ update: cached.update });
      return;
    }

    const reference = db.doc(`updates/${request.params.updateId}`);
    const snapshot = await reference.get();
    if (!snapshot.exists || snapshot.data().status !== "published") {
      throw httpError(404, "Update not found.");
    }
    const update = await hydrateUpdate(snapshot);
    publicUpdateDetailCache.set(request.params.updateId, {
      update,
      expiresAt: Date.now() + publicUpdateCacheTtlMs,
    });
    response.json({ update });
  } catch (error) {
    next(error);
  }
}

async function listAdminUpdates(_request, response, next) {
  try {
    const snapshot = await db.collection("updates").limit(200).get();
    const updates = (await Promise.all(snapshot.docs.map((document) => hydrateUpdateSummary(document, { includeDraft: true }))))
      .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime());
    response.json({ updates });
  } catch (error) {
    next(error);
  }
}

async function createUpdate(request, response, next) {
  try {
    const contentType = normalizeNewsContentType(request.body?.contentType ?? "game_update");
    const reference = db.collection("updates").doc();
    const actor = actorSnapshot(request.authSession);
    await reference.set({
      contentType,
      isMinor: false,
      title: contentType === "developer_blog" ? "Untitled Developer Blog" : "Untitled Update",
      version: "",
      developerCommentHtml: "",
      blogHtml: "",
      coverImageId: null,
      status: "draft",
      sections: defaultSections(),
      author: actor,
      lastEditedBy: actor,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      publishedAt: null,
      publishedOn: null,
    });
    invalidatePublicUpdateCache(reference.id);
    response.status(201).json({
      update: await hydrateUpdate(await reference.get(), { includeDraft: true }),
    });
  } catch (error) {
    next(error);
  }
}

async function getAdminUpdate(request, response, next) {
  try {
    const reference = db.doc(`updates/${request.params.updateId}`);
    const snapshot = await reference.get();
    if (!snapshot.exists) throw httpError(404, "Update not found.");
    response.json({ update: await hydrateUpdate(snapshot, { includeDraft: true }) });
  } catch (error) {
    next(error);
  }
}

async function saveUpdate(request, response, next) {
  try {
    const reference = db.doc(`updates/${request.params.updateId}`);
    const snapshot = await reference.get();
    if (!snapshot.exists) throw httpError(404, "Update not found.");
    const current = snapshot.data();
    const normalized = normalizeUpdateInput(request.body ?? {}, current);
    await validateReferencedImages(reference, normalized);

    const publishingNow = normalized.status === "published" && current.status !== "published" && !current.publishedAt;
    await reference.update({
      ...normalized,
      lastEditedBy: actorSnapshot(request.authSession),
      updatedAt: FieldValue.serverTimestamp(),
      ...(publishingNow ? { publishedAt: FieldValue.serverTimestamp() } : {}),
    });
    await cleanupUnreferencedImages(reference, normalized);
    invalidatePublicUpdateCache(reference.id);
    response.json({
      update: await hydrateUpdate(await reference.get(), { includeDraft: true }),
    });
  } catch (error) {
    next(error);
  }
}

async function deleteUpdate(request, response, next) {
  try {
    const reference = db.doc(`updates/${request.params.updateId}`);
    const snapshot = await reference.get();
    if (!snapshot.exists) throw httpError(404, "Update not found.");
    await removeUpdateAndImages(reference);
    invalidatePublicUpdateCache(reference.id);
    response.sendStatus(204);
  } catch (error) {
    next(error);
  }
}

async function beginImageUpload(request, response, next) {
  try {
    const policy = updateImageStoragePolicy();
    if (!policy.enabled) throw httpError(503, "R2 image storage is not configured.");

    const updateReference = db.doc(`updates/${request.params.updateId}`);
    const updateSnapshot = await updateReference.get();
    if (!updateSnapshot.exists) throw httpError(404, "Update not found.");
    if (updateSnapshot.data().contentType === "developer_blog") {
      throw httpError(400, "Developer blogs do not support image uploads.");
    }

    const imagesSnapshot = await updateReference.collection("images").limit(policy.maxImagesPerUpdate + 1).get();
    if (imagesSnapshot.size >= policy.maxImagesPerUpdate) {
      throw httpError(409, `An update can contain at most ${policy.maxImagesPerUpdate} uploaded images.`);
    }

    const normalized = normalizeAttachmentInput(request.body ?? {});
    const imageReference = updateReference.collection("images").doc();
    const objectKey = ["updates", updateReference.id, imageReference.id, normalized.objectName].join("/");
    const upload = createAttachmentUploadUrl(objectKey, normalized.contentType);

    await imageReference.set({
      objectKey,
      originalName: normalized.originalName,
      contentType: normalized.contentType,
      declaredSize: normalized.size,
      size: normalized.size,
      status: "pending",
      uploader: actorSnapshot(request.authSession),
      createdAt: FieldValue.serverTimestamp(),
      uploadedAt: null,
      uploadExpiresAt: new Timestamp(new Date(Date.now() + (upload.expiresIn + 300) * 1000)),
      etag: null,
    });

    response.status(201).json({
      imageId: imageReference.id,
      uploadUrl: upload.url,
      uploadHeaders: upload.headers,
      expiresIn: upload.expiresIn,
    });
  } catch (error) {
    next(error);
  }
}

async function completeImageUpload(request, response, next) {
  try {
    const updateReference = db.doc(`updates/${request.params.updateId}`);
    const imageReference = updateReference.collection("images").doc(request.params.imageId);
    const [updateSnapshot, imageSnapshot] = await Promise.all([
      updateReference.get(),
      imageReference.get(),
    ]);
    if (!updateSnapshot.exists) throw httpError(404, "Update not found.");
    if (!imageSnapshot.exists) throw httpError(404, "Image upload not found.");

    const image = imageSnapshot.data();
    if (image.status === "ready") {
      response.json({ image: serializeImageDocument(imageSnapshot) });
      return;
    }
    const object = await headAttachmentObject(image.objectKey);
    if (!object) throw httpError(409, "R2 has not received this image yet.");
    if (object.size !== image.declaredSize) {
      await deleteAttachmentObject(image.objectKey, { ignoreMissing: true });
      await imageReference.delete();
      throw httpError(400, "The uploaded image size does not match the selected file.");
    }
    if (object.contentType && object.contentType !== image.contentType) {
      await deleteAttachmentObject(image.objectKey, { ignoreMissing: true });
      await imageReference.delete();
      throw httpError(400, "The uploaded image type does not match the selected file.");
    }

    await imageReference.update({
      status: "ready",
      size: object.size,
      contentType: object.contentType ?? image.contentType,
      etag: object.etag,
      uploadedAt: FieldValue.serverTimestamp(),
      uploadExpiresAt: null,
    });
    invalidatePublicUpdateCache(updateReference.id);
    response.status(201).json({
      image: serializeImageDocument(await imageReference.get()),
    });
  } catch (error) {
    next(error);
  }
}

async function cancelPendingImageUpload(request, response, next) {
  try {
    const updateReference = db.doc(`updates/${request.params.updateId}`);
    const imageReference = updateReference.collection("images").doc(request.params.imageId);
    const [updateSnapshot, imageSnapshot] = await Promise.all([
      updateReference.get(),
      imageReference.get(),
    ]);
    if (!updateSnapshot.exists) throw httpError(404, "Update not found.");
    if (!imageSnapshot.exists || imageSnapshot.data().status !== "pending") {
      response.sendStatus(204);
      return;
    }

    const image = imageSnapshot.data();
    await deleteAttachmentObject(image.objectKey, { ignoreMissing: true }).catch(() => false);
    await imageReference.delete();
    response.sendStatus(204);
  } catch (error) {
    next(error);
  }
}

export function createPublicUpdateRouter() {
  const router = express.Router();
  router.get("/", listPublishedUpdates);
  router.get("/:updateId", getPublishedUpdate);
  return router;
}

export function createAdminUpdateRouter() {
  const router = express.Router();
  router.use(requireAuth, requireExactRole("dev"));
  router.get("/", listAdminUpdates);
  router.post("/", requireCsrf, createUpdate);
  router.get("/:updateId", getAdminUpdate);
  router.put("/:updateId", requireCsrf, saveUpdate);
  router.delete("/:updateId", requireCsrf, deleteUpdate);
  router.post("/:updateId/images", requireCsrf, beginImageUpload);
  router.post("/:updateId/images/:imageId/complete", requireCsrf, completeImageUpload);
  router.delete("/:updateId/images/pending/:imageId", requireCsrf, cancelPendingImageUpload);
  return router;
}
