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
const IMAGE_LAYOUTS = new Set(["none", "left", "right"]);
const BUG_FIX_LEVELS = new Set(["major", "minor"]);
const UPDATE_STATUSES = new Set(["draft", "published"]);
const ID_PATTERN = /^[a-zA-Z0-9_-]{1,80}$/;
const ALLOWED_TAGS = new Set([
  "p",
  "br",
  "strong",
  "em",
  "u",
  "ul",
  "ol",
  "li",
  "h3",
  "h4",
  "blockquote",
  "a",
]);
const TAG_ALIASES = new Map([
  ["b", "strong"],
  ["i", "em"],
  ["div", "p"],
]);
const VOID_TAGS = new Set(["br"]);

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

function decodeHtmlEntities(value) {
  return value
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&nbsp;/gi, "\u00a0")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&");
}

function escapeHtml(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeHref(rawHref) {
  if (!rawHref) return null;
  const decoded = decodeHtmlEntities(rawHref.trim());
  try {
    const url = new URL(decoded, "https://towereclipse.invalid");
    if (!["http:", "https:", "mailto:"].includes(url.protocol)) return null;
    if (url.origin === "https://towereclipse.invalid") return null;
    return decoded;
  } catch {
    return null;
  }
}

function sanitizeRichText(value, field, { max = 50000 } = {}) {
  if (typeof value !== "string") {
    throw httpError(400, `${field} must be rich-text HTML.`);
  }
  if (value.length > max) {
    throw httpError(400, `${field} is too long.`);
  }

  const withoutDangerousBlocks = value.replace(
    /<(script|style|iframe|object|embed|svg|math)[^>]*>[\s\S]*?<\/\1\s*>/gi,
    "",
  );
  const tokens = withoutDangerousBlocks.match(/<[^>]*>|[^<]+/g) ?? [];
  const output = [];

  for (const token of tokens) {
    if (!token.startsWith("<")) {
      output.push(escapeHtml(decodeHtmlEntities(token)));
      continue;
    }

    const match = token.match(/^<\s*(\/?)\s*([a-zA-Z0-9]+)([^>]*)>/);
    if (!match) continue;
    const closing = match[1] === "/";
    const originalTag = match[2].toLowerCase();
    const tag = TAG_ALIASES.get(originalTag) ?? originalTag;
    if (!ALLOWED_TAGS.has(tag)) continue;

    if (closing) {
      if (!VOID_TAGS.has(tag)) output.push(`</${tag}>`);
      continue;
    }

    if (tag === "a") {
      const hrefMatch = match[3].match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
      const href = safeHref(hrefMatch?.[1] ?? hrefMatch?.[2] ?? hrefMatch?.[3] ?? "");
      if (href) {
        output.push(`<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">`);
      } else {
        output.push("<a>");
      }
      continue;
    }

    output.push(VOID_TAGS.has(tag) ? `<${tag}>` : `<${tag}>`);
  }

  return output.join("").trim();
}

function richTextPlainLength(html) {
  return decodeHtmlEntities(html.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim().length;
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

  const imageId = rawItem.imageId == null || rawItem.imageId === ""
    ? null
    : cleanId(rawItem.imageId, `sections.${sectionKind}.items.${index}.imageId`);
  const imageLayout = imageId
    ? (IMAGE_LAYOUTS.has(rawItem.imageLayout) ? rawItem.imageLayout : "right")
    : "none";
  const caption = cleanText(
    rawItem.caption ?? "",
    `sections.${sectionKind}.items.${index}.caption`,
    { min: 0, max: 300 },
  );
  const bugFixLevel = sectionKind === "bug_fixes"
    ? (BUG_FIX_LEVELS.has(rawItem.bugFixLevel) ? rawItem.bugFixLevel : "minor")
    : null;

  return {
    id,
    title,
    bodyHtml,
    imageId,
    imageLayout,
    caption,
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
    if (totalItems > 120) {
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
      if (item.imageId) ids.add(item.imageId);
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
      const image = hydrateImage(item.imageId);
      if (image) figureNumber += 1;
      return {
        ...item,
        image,
        figureNumber: image ? figureNumber : null,
      };
    }),
  }));

  return {
    ...value,
    coverImage: hydrateImage(value.coverImageId),
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
  const snapshot = await reference.collection("images").limit(200).get();
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
  const snapshot = await reference.collection("images").limit(200).get();
  for (const document of snapshot.docs) {
    const image = document.data();
    try {
      await deleteAttachmentObject(image.objectKey, { ignoreMissing: true });
    } catch (error) {
      console.warn(`Could not remove R2 update image ${image.objectKey}:`, error);
    }
  }
  const batch = db.batch();
  snapshot.docs.forEach((document) => batch.delete(document.ref));
  batch.delete(reference);
  await batch.commit();
}

function normalizeUpdateInput(body, current) {
  const title = cleanText(body.title ?? current.title ?? "", "title", { min: 1, max: 180 });
  const version = cleanText(body.version ?? current.version ?? "", "version", { min: 0, max: 80 });
  const developerCommentHtml = sanitizeRichText(
    body.developerCommentHtml ?? current.developerCommentHtml ?? "",
    "developerCommentHtml",
  );
  const status = body.status ?? current.status ?? "draft";
  if (!UPDATE_STATUSES.has(status)) {
    throw httpError(400, "status must be draft or published.");
  }
  const coverImageId = body.coverImageId == null || body.coverImageId === ""
    ? null
    : cleanId(body.coverImageId, "coverImageId");
  const sections = normalizeSections(body.sections ?? current.sections ?? defaultSections());

  if (status === "published") {
    if (!version) throw httpError(400, "A published update needs a version.");
    const itemCount = sections.reduce((total, section) => total + section.items.length, 0);
    if (itemCount === 0) throw httpError(400, "A published update needs at least one entry.");
  }

  return {
    title,
    version,
    developerCommentHtml,
    coverImageId,
    sections,
    status,
  };
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
    const reference = db.collection("updates").doc();
    const actor = actorSnapshot(request.authSession);
    await reference.set({
      title: "Untitled Update",
      version: "",
      developerCommentHtml: "",
      coverImageId: null,
      status: "draft",
      sections: defaultSections(),
      author: actor,
      lastEditedBy: actor,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      publishedAt: null,
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

    const publishingNow = normalized.status === "published" && current.status !== "published";
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

    const imagesSnapshot = await updateReference.collection("images").limit(200).get();
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
  return router;
}
