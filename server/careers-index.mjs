import { createReadCache } from "./read-cache.mjs";
import { fail, identifier } from "./careers-domain.mjs";

const QA_CATEGORIES = ["Quality assurance", "Quality Assurance", "quality assurance", "QUALITY ASSURANCE"];
const qa = category => typeof category === "string" && category.trim().toLowerCase() === "quality assurance";
const COUNT_FIELDS = ["formId", "title", "category", "applicantId", "status", "createdAt", "revision"];
const SEARCH_FIELDS = [...COUNT_FIELDS, "applicant", "versionId", "submissionRevision", "updatedAt"];
const project = (item, fields) => Object.fromEntries(["id", ...fields].filter(key => item[key] !== undefined).map(key => [key, item[key]]));

// Private, permission-qualified compact corpora. No answers, draft answers,
// feedback, grades or private review notes are retained here.
export function createCareersApplicationIndex(db, { now = Date.now } = {}) {
  const ttlMs = 15 * 60_000;
  const counts = createReadCache({ name: "careers-count-corpus", maxEntries: 24, maxBytes: 16 * 1024 * 1024, ttlMs, now });
  const search = createReadCache({ name: "careers-search-corpus", maxEntries: 12, maxBytes: 16 * 1024 * 1024, ttlMs, now });
  const tracked = new Map(), journal = new Map(), refreshes = new Map();
  let sequence = 0, journalFloor = 0;
  const keyFor = (role, formId, searchable) => JSON.stringify([role, formId, searchable]);
  const matches = (item, role, formId) => (role !== "leadqa" || qa(item.category)) && (!formId || item.formId === formId);
  function register(role, formId, searchable) {
    if (!["dev", "leadqa"].includes(role)) fail("You do not have permission to view applications.", 403);
    if (formId) identifier(formId);
    const key = keyFor(role, formId, searchable), cache = searchable ? search : counts;
    tracked.delete(key); tracked.set(key, { role, formId, searchable, cache });
    while (tracked.size > 128) { const oldest = tracked.keys().next().value; tracked.get(oldest).cache.invalidate(oldest); tracked.delete(oldest); }
    return { key, cache };
  }
  async function load(role, formId, searchable) {
    const fields = searchable ? SEARCH_FIELDS : COUNT_FIELDS, maximum = searchable ? 5000 : 50_000;
    for (let attempt = 0; attempt < 3; attempt++) {
      const started = sequence, asOf = new Date(now()).toISOString();
      let query = db.collection("careerApplications");
      if (role === "leadqa") query = query.where("category", "in", QA_CATEGORIES);
      if (formId) query = query.where("formId", "==", formId);
      const base = query.orderBy("createdAt", "desc").orderBy("__name__", "desc").select(...fields), rows = new Map();
      let cursor;
      while (true) {
        const batch = await (cursor ? base.startAfter(...cursor) : base).limit(500).get();
        for (const doc of batch.docs) rows.set(doc.id, { ...doc.data(), id: doc.id });
        if (rows.size > maximum) fail(`This view supports up to ${maximum.toLocaleString()} applications. Choose a narrower opening.`);
        if (batch.docs.length < 500) break;
        const last = batch.docs.at(-1); cursor = [last.data().createdAt, last.ref.path];
      }
      if (started < journalFloor) continue;
      // A local mutation may commit while a multi-page fill is in progress.
      // Replay its latest committed projection rather than resurrecting stale rows.
      for (const { at, after } of journal.values()) if (at > started) {
        if (matches(after, role, formId)) rows.set(after.id, project(after, fields)); else rows.delete(after.id);
      }
      const result = { rows: [...rows.values()], asOf, expiresAt: now() + ttlMs, revision: sequence };
      if (Buffer.byteLength(JSON.stringify(result)) > 16 * 1024 * 1024) fail("This application view is too large to cache safely. Choose a narrower opening.");
      return result;
    }
    fail("Applications changed rapidly. Please refresh this view.", 409);
  }
  return {
    async rows(user, { formId = "", searchable = false, refresh = "" } = {}) {
      const { key, cache } = register(user?.role, formId, searchable);
      if (refresh && refresh !== "0") {
        if (typeof refresh !== "string" || refresh.length > 80) fail("Choose a valid refresh token.");
        const refreshKey = `${user.id}:${key}`;
        if (refreshes.get(refreshKey) !== refresh) {
          refreshes.delete(refreshKey); refreshes.set(refreshKey, refresh); cache.invalidate(key);
          while (refreshes.size > 256) refreshes.delete(refreshes.keys().next().value);
        }
      }
      return cache.get(key, () => load(user.role, formId, searchable));
    },
    peek(role, formId = "", searchable = false) { return (searchable ? search : counts).peek(keyFor(role, formId, searchable)); },
    changed(before, after) {
      if (!after?.id) return;
      const existing = journal.get(after.id);
      if (existing && existing.after.revision > after.revision) return;
      journal.delete(after.id); journal.set(after.id, { at: ++sequence, after: project(after, SEARCH_FIELDS) });
      while (journal.size > 2048) { const oldest = journal.keys().next().value; journalFloor = Math.max(journalFloor, journal.get(oldest).at); journal.delete(oldest); }
      for (const [key, { role, formId, searchable, cache }] of tracked) {
        if (!matches(after, role, formId) && (!before || !matches(before, role, formId))) continue;
        const saved = cache.peek(key);
        if (!saved) { cache.invalidate(key); continue; }
        const rows = new Map(saved.rows.map(item => [item.id, item]));
        if ((rows.get(after.id)?.revision ?? 0) > after.revision) continue;
        if (matches(after, role, formId)) rows.set(after.id, project(after, searchable ? SEARCH_FIELDS : COUNT_FIELDS)); else rows.delete(after.id);
        cache.set(key, { ...saved, rows: [...rows.values()], revision: sequence }, { ttlMs: Math.max(1, saved.expiresAt - now()) });
      }
    },
  };
}
