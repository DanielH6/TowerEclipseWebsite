import express from "express";
import { FieldValue, db } from "./firebase.mjs";
import { deleteLocalJsonCache, readLocalJsonCache, writeLocalJsonCache } from "./local-cache.mjs";
import { actorSnapshot, requireAuth, requireCsrf, requireExactRole } from "./auth-context.mjs";

export const DICTIONARY_NAMES = Object.freeze([
  "statuses",
  "versions",
  "priorities",
  "categories",
  "types",
  "devices",
]);

const dictionarySet = new Set(DICTIONARY_NAMES);
const PROTECTED_ENTRIES = new Set([
  "statuses/pending-approval",
  "statuses/approved",
  "statuses/rejected",
]);

const DEFAULTS = Object.freeze({
  statuses: [
    { id: "pending-approval", code: "pending_approval", label: "Pending approval", color: "#d9a441", sortOrder: 10, initial: true, terminal: false },
    { id: "approved", code: "approved", label: "Approved", color: "#3b82f6", sortOrder: 20, initial: false, terminal: false },
    { id: "in-progress", code: "in_progress", label: "In progress", color: "#8b5cf6", sortOrder: 30, initial: false, terminal: false },
    { id: "ready-for-qa", code: "ready_for_qa", label: "Ready for QA", color: "#06b6d4", sortOrder: 40, initial: false, terminal: false },
    { id: "resolved", code: "resolved", label: "Resolved", color: "#22c55e", sortOrder: 50, initial: false, terminal: false },
    { id: "rejected", code: "rejected", label: "Rejected", color: "#ef4444", sortOrder: 60, initial: false, terminal: true },
    { id: "closed", code: "closed", label: "Closed", color: "#6b7280", sortOrder: 70, initial: false, terminal: true },
  ],
  versions: [
    { id: "unspecified", code: "unspecified", label: "Unspecified", color: null, sortOrder: 10 },
  ],
  priorities: [
    { id: "low", code: "low", label: "Low", color: "#64748b", sortOrder: 10 },
    { id: "medium", code: "medium", label: "Medium", color: "#eab308", sortOrder: 20 },
    { id: "high", code: "high", label: "High", color: "#f97316", sortOrder: 30 },
    { id: "critical", code: "critical", label: "Critical", color: "#ef4444", sortOrder: 40 },
  ],
  categories: [
    { id: "general", code: "general", label: "General", color: null, sortOrder: 10 },
  ],
  types: [
    { id: "bug", code: "bug", label: "Bug", color: null, sortOrder: 10 },
  ],
  devices: [
    { id: "pc", code: "pc", label: "PC", color: null, sortOrder: 10 },
    { id: "mobile", code: "mobile", label: "Mobile", color: null, sortOrder: 20 },
    { id: "console", code: "console", label: "Console", color: null, sortOrder: 30 },
  ],
});

const DICTIONARY_CACHE_FILE = "dictionaries";
let dictionaryCache = readLocalJsonCache(DICTIONARY_CACHE_FILE);
let dictionaryCachePromise = null;

function validCachedCatalog(value) {
  return value
    && typeof value === "object"
    && DICTIONARY_NAMES.every((dictionary) => Array.isArray(value[dictionary]));
}

if (!validCachedCatalog(dictionaryCache)) {
  dictionaryCache = null;
}

function persistDictionaryCache() {
  if (dictionaryCache) {
    writeLocalJsonCache(DICTIONARY_CACHE_FILE, dictionaryCache);
  }
}

export function invalidateDictionaryCache({ dropDisk = true } = {}) {
  dictionaryCache = null;
  if (dropDisk) deleteLocalJsonCache(DICTIONARY_CACHE_FILE);
}

function upsertDictionaryCacheEntry(dictionary, entry) {
  if (!dictionaryCache) {
    const restored = readLocalJsonCache(DICTIONARY_CACHE_FILE);
    if (validCachedCatalog(restored)) dictionaryCache = restored;
  }

  if (!dictionaryCache) return;

  const entries = dictionaryCache[dictionary] ?? [];
  const nextEntries = entries.filter((candidate) => candidate.id !== entry.id);
  nextEntries.push(entry);
  nextEntries.sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label));
  dictionaryCache = {
    ...dictionaryCache,
    [dictionary]: nextEntries,
  };
  persistDictionaryCache();
}

async function loadDictionaryCache({ force = false } = {}) {
  if (!force && dictionaryCache) return dictionaryCache;
  if (!force && dictionaryCachePromise) return dictionaryCachePromise;

  if (!force) {
    const restored = readLocalJsonCache(DICTIONARY_CACHE_FILE);
    if (validCachedCatalog(restored)) {
      dictionaryCache = restored;
      return dictionaryCache;
    }
  }

  dictionaryCachePromise = Promise.all(
    DICTIONARY_NAMES.map(async (dictionary) => {
      const snapshot = await db.collection(`dictionaries/${dictionary}/items`).get();
      const entries = snapshot.docs
        .map(publicEntry)
        .sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label));
      return [dictionary, entries];
    }),
  )
    .then((pairs) => {
      dictionaryCache = Object.fromEntries(pairs);
      persistDictionaryCache();
      console.log("Dictionary cache loaded from Firestore and saved locally.");
      return dictionaryCache;
    })
    .finally(() => {
      dictionaryCachePromise = null;
    });

  return dictionaryCachePromise;
}

export async function refreshDictionaryCacheFromFirestore() {
  invalidateDictionaryCache();
  return loadDictionaryCache({ force: true });
}

export async function getDictionaryCatalog({ activeOnly = true } = {}) {
  const catalog = await loadDictionaryCache();
  if (!activeOnly) return catalog;

  return Object.fromEntries(
    DICTIONARY_NAMES.map((dictionary) => [
      dictionary,
      catalog[dictionary].filter((entry) => entry.active),
    ]),
  );
}

function assertDictionaryName(name) {
  if (!dictionarySet.has(name)) {
    const error = new Error("Unknown dictionary.");
    error.status = 404;
    throw error;
  }
}

function cleanText(value, field, { min = 1, max = 120 } = {}) {
  if (typeof value !== "string") {
    const error = new Error(`${field} must be a string.`);
    error.status = 400;
    throw error;
  }

  const cleaned = value.trim();
  if (cleaned.length < min || cleaned.length > max) {
    const error = new Error(`${field} must contain between ${min} and ${max} characters.`);
    error.status = 400;
    throw error;
  }
  return cleaned;
}

function cleanCode(value) {
  const code = cleanText(value, "code", { min: 1, max: 60 }).toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(code)) {
    const error = new Error("code may contain lowercase letters, numbers, underscores, and hyphens only.");
    error.status = 400;
    throw error;
  }
  return code;
}

function cleanColor(value) {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || !/^#[0-9a-fA-F]{6}$/.test(value)) {
    const error = new Error("color must be a six-digit hex color such as #ff0000.");
    error.status = 400;
    throw error;
  }
  return value.toLowerCase();
}

function cleanSortOrder(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 100000) {
    const error = new Error("sortOrder must be an integer between 0 and 100000.");
    error.status = 400;
    throw error;
  }
  return parsed;
}

function normalizeEntry(input, dictionary, partial = false) {
  const result = {};

  if (!partial || input.code !== undefined) result.code = cleanCode(input.code);
  if (!partial || input.label !== undefined) result.label = cleanText(input.label, "label", { min: 1, max: 100 });
  if (!partial || input.description !== undefined) {
    result.description = typeof input.description === "string" ? input.description.trim().slice(0, 500) : "";
  }
  if (!partial || input.color !== undefined) result.color = cleanColor(input.color);
  if (!partial || input.sortOrder !== undefined) result.sortOrder = cleanSortOrder(input.sortOrder ?? 0);
  if (!partial || input.active !== undefined) result.active = input.active !== false;

  if (dictionary === "statuses") {
    if (!partial || input.initial !== undefined) result.initial = input.initial === true;
    if (!partial || input.terminal !== undefined) result.terminal = input.terminal === true;
  }

  return result;
}


async function ensureUniqueCode(dictionary, code, ignoredEntryId = null) {
  const catalog = await getDictionaryCatalog({ activeOnly: false });
  const duplicate = catalog[dictionary].find(
    (entry) => entry.code === code && entry.id !== ignoredEntryId,
  );
  if (duplicate) {
    const error = new Error(`An entry with code "${code}" already exists.`);
    error.status = 409;
    throw error;
  }
}

function publicEntry(document) {
  const data = document.data();
  return {
    id: document.id,
    code: data.code,
    label: data.label,
    description: data.description ?? "",
    color: data.color ?? null,
    sortOrder: data.sortOrder ?? 0,
    active: data.active !== false,
    ...(data.initial !== undefined ? { initial: data.initial === true } : {}),
    ...(data.terminal !== undefined ? { terminal: data.terminal === true } : {}),
  };
}

export async function ensureDefaultDictionaries() {
  const defaults = [];

  for (const dictionary of DICTIONARY_NAMES) {
    for (const item of DEFAULTS[dictionary]) {
      defaults.push({
        dictionary,
        item,
        reference: db.doc(`dictionaries/${dictionary}/items/${item.id}`),
      });
    }
  }

  // Fetch all default entries in one Firestore round trip instead of making
  // one sequential request per document on every server restart.
  const snapshots = await db.getAll(
    ...defaults.map(({ reference }) => reference),
  );

  const batch = db.batch();
  const now = FieldValue.serverTimestamp();
  let writes = 0;

  snapshots.forEach((snapshot, index) => {
    if (snapshot.exists) return;

    const { dictionary, item, reference } = defaults[index];
    batch.set(reference, {
      code: item.code,
      label: item.label,
      description: "",
      color: item.color,
      sortOrder: item.sortOrder,
      active: true,
      ...(dictionary === "statuses"
        ? { initial: item.initial, terminal: item.terminal }
        : {}),
      createdAt: now,
      updatedAt: now,
      createdBy: {
        discordId: "system",
        username: "system",
        displayName: "System",
        role: "dev",
        avatarUrl: null,
      },
      updatedBy: {
        discordId: "system",
        username: "system",
        displayName: "System",
        role: "dev",
        avatarUrl: null,
      },
    });
    writes += 1;
  });

  if (writes > 0) {
    await batch.commit();
    await refreshDictionaryCacheFromFirestore();
  }

  return { created: writes };
}

export async function getDictionaryEntry(dictionary, entryId, { activeOnly = true } = {}) {
  assertDictionaryName(dictionary);
  const catalog = await getDictionaryCatalog({ activeOnly: false });
  const entry = catalog[dictionary].find((candidate) => candidate.id === entryId);

  if (!entry || (activeOnly && entry.active === false)) {
    const error = new Error(`Dictionary entry not found: ${dictionary}/${entryId}`);
    error.status = 400;
    throw error;
  }

  return entry;
}

export function dictionarySnapshot(entry) {
  return {
    id: entry.id,
    code: entry.code,
    label: entry.label,
    color: entry.color ?? null,
    ...(entry.initial !== undefined ? { initial: entry.initial === true } : {}),
    ...(entry.terminal !== undefined ? { terminal: entry.terminal === true } : {}),
  };
}

export function createDictionaryRouter() {
  const router = express.Router();

  router.get("/", async (_request, response, next) => {
    try {
      response.json({
        dictionaries: await getDictionaryCatalog({ activeOnly: true }),
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

export function createAdminDictionaryRouter() {
  const router = express.Router();

  router.use(requireAuth, requireExactRole("dev"));

  router.get("/:dictionary", async (request, response, next) => {
    try {
      assertDictionaryName(request.params.dictionary);
      const catalog = await getDictionaryCatalog({ activeOnly: false });
      response.json({ entries: catalog[request.params.dictionary] });
    } catch (error) {
      next(error);
    }
  });

  router.post("/:dictionary", requireCsrf, async (request, response, next) => {
    try {
      const dictionary = request.params.dictionary;
      assertDictionaryName(dictionary);
      const data = normalizeEntry(request.body ?? {}, dictionary);
      await ensureUniqueCode(dictionary, data.code);
      const actor = actorSnapshot(request.authSession);
      const reference = db.collection(`dictionaries/${dictionary}/items`).doc();

      await reference.set({
        ...data,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        createdBy: actor,
        updatedBy: actor,
      });

      const created = { id: reference.id, ...data };
      upsertDictionaryCacheEntry(dictionary, created);
      response.status(201).json({ entry: created });
    } catch (error) {
      next(error);
    }
  });

  router.patch("/:dictionary/:entryId", requireCsrf, async (request, response, next) => {
    try {
      const dictionary = request.params.dictionary;
      assertDictionaryName(dictionary);
      const reference = db.doc(`dictionaries/${dictionary}/items/${request.params.entryId}`);
      let existing;
      try {
        existing = await getDictionaryEntry(dictionary, request.params.entryId, { activeOnly: false });
      } catch (error) {
        if (error?.status === 400) {
          response.status(404).json({ error: "Dictionary entry not found." });
          return;
        }
        throw error;
      }

      const changes = normalizeEntry(request.body ?? {}, dictionary, true);
      if (changes.code !== undefined) {
        await ensureUniqueCode(dictionary, changes.code, request.params.entryId);
      }
      if (Object.keys(changes).length === 0) {
        response.status(400).json({ error: "No valid fields were supplied." });
        return;
      }

      await reference.update({
        ...changes,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: actorSnapshot(request.authSession),
      });

      const updated = { ...existing, ...changes, id: request.params.entryId };
      upsertDictionaryCacheEntry(dictionary, updated);
      response.json({ entry: updated });
    } catch (error) {
      next(error);
    }
  });

  router.delete("/:dictionary/:entryId", requireCsrf, async (request, response, next) => {
    try {
      const dictionary = request.params.dictionary;
      assertDictionaryName(dictionary);
      if (PROTECTED_ENTRIES.has(`${dictionary}/${request.params.entryId}`)) {
        response.status(409).json({ error: "This system dictionary entry cannot be archived." });
        return;
      }
      const reference = db.doc(`dictionaries/${dictionary}/items/${request.params.entryId}`);
      let existing;
      try {
        existing = await getDictionaryEntry(dictionary, request.params.entryId, { activeOnly: false });
      } catch (error) {
        if (error?.status === 400) {
          response.status(404).json({ error: "Dictionary entry not found." });
          return;
        }
        throw error;
      }

      await reference.update({
        active: false,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: actorSnapshot(request.authSession),
      });
      upsertDictionaryCacheEntry(dictionary, { ...existing, active: false });
      response.sendStatus(204);
    } catch (error) {
      next(error);
    }
  });

  return router;
}
