import { createHash, randomUUID } from "node:crypto";
import { APPLICATION_STATUSES, fail, identifier, normalizeForm, reviewInput, validateAnswers } from "./careers-domain.mjs";
import { createCareerImageService } from "./careers-images.mjs";
import { normalizeAiReview, aiFingerprint } from "./careers-ai-domain.mjs";
import { createCareerAiProvider, readCareerAiConfiguration } from "./careers-ai-provider.mjs";
import { createCareerAiService } from "./careers-ai-service.mjs";
import { createReadCache } from "./read-cache.mjs";
import { createCareersApplicationIndex } from "./careers-index.mjs";

const PAGE_SIZE = 20;
const SUMMARY = ["formId", "versionId", "title", "category", "applicantId", "applicant", "status", "createdAt", "updatedAt", "revision", "submissionRevision", "resubmittedAt", "feedback"];
const FORM_SUMMARY = ["title", "category", "description", "commitment", "formatting", "closesAt", "state", "publishedVersion", "revision", "createdAt", "updatedAt"];
const QA_CATEGORIES = ["Quality assurance", "Quality Assurance", "quality assurance", "QUALITY ASSURANCE"];
const isQaApplication = category => typeof category === "string" && category.trim().toLowerCase() === "quality assurance";
const pick = (data, keys) => Object.fromEntries(keys.filter(key => data[key] !== undefined).map(key => [key, data[key]]));
const snapshotData = snapshot => snapshot.exists ? { ...snapshot.data(), id: snapshot.id ?? snapshot.ref.path.split("/").at(-1) } : fail("This item could not be found.", 404);
const appId = (formId, userId) => createHash("sha256").update(`${formId}:${userId}`).digest("hex").slice(0, 40);
function expectRevision(data, revision) { if (!Number.isInteger(revision) || data.revision !== revision) fail("Someone changed this item. Reload before saving; your changes have not been applied.", 409); }
function expectDraftRevision(data, revision) {
  if (data ? !Number.isInteger(revision) || data.revision !== revision : revision !== null) fail("Your saved draft changed in another tab. Reload before saving; your answers have not been changed.", 409);
}
function checkOpen(form, now) {
  if (form.state !== "open" || !form.publishedVersion || (form.closesAt && Date.parse(form.closesAt) <= now)) fail("This opening is closed to new applications.", 409);
}
const acceptsResubmissions = (form, status, now) => status !== "withdrawn" && form?.state === "open" && Boolean(form.publishedVersion) && (!form.closesAt || Date.parse(form.closesAt) > now);

export function createCareersService(db, { now = Date.now, imageStorage, aiProvider = createCareerAiProvider(readCareerAiConfiguration()) } = {}) {
  const publicCache = createReadCache({ name: "careers-public-forms", maxEntries: 100, ttlMs: 60_000, now });
  const versionCache = createReadCache({ name: "careers-form-versions", maxEntries: 200, maxBytes: 16 * 1024 * 1024, ttlMs: 60 * 60_000, now });
  const readVersion = id => versionCache.get(identifier(id), async () => snapshotData(await db.doc(`careerFormVersions/${id}`).get()));
  const applicationIndex = createCareersApplicationIndex(db, { now });
  const selectorCache = createReadCache({ name: "careers-review-forms", maxEntries: 1, maxBytes: 4 * 1024 * 1024, ttlMs: 15 * 60_000, now });
  const images = createCareerImageService(db, imageStorage);
  const ai = createCareerAiService(db, { provider: aiProvider, images, now, readVersion });
  const ref = (collection, id) => db.doc(`${collection}/${identifier(id)}`);
  const stamp = () => new Date(now()).toISOString();
  async function page(query, collection, options, fields, order = "createdAt", direction = "desc", scope = "") {
    query = query.orderBy(order, direction).orderBy("__name__", direction).select(...fields);
    if (options.cursor) {
      try {
        if (typeof options.cursor !== "string" || options.cursor.length > 600) throw new Error();
        const cursor = JSON.parse(Buffer.from(options.cursor, "base64url").toString());
        if (cursor.scope !== scope || typeof cursor.value !== "string" || !Number.isFinite(Date.parse(cursor.value))) throw new Error();
        query = query.startAfter(cursor.value, `${collection}/${identifier(cursor.id)}`);
      } catch { fail("Invalid page cursor."); }
    }
    const result = await query.limit(PAGE_SIZE + 1).get();
    const items = result.docs.slice(0, PAGE_SIZE).map(snapshotData);
    const last = items.at(-1);
    return { items, nextCursor: result.docs.length > PAGE_SIZE ? Buffer.from(JSON.stringify({ scope, value: last[order], id: last.id })).toString("base64url") : null };
  }
  async function linkedIdentity(user, transaction) {
    if (!user?.id) fail("Sign in with Discord to apply.", 401);
    const read = reference => transaction ? transaction.get(reference) : reference.get();
    const profile = (await read(ref("websiteAccounts", user.id))).data();
    if (!profile?.roblox?.verifiedAt || !profile.roblox.userId) fail("Link your Roblox account on your profile before applying.", 403);
    const claim = (await read(ref("websiteRobloxLinks", profile.roblox.userId))).data();
    if (claim?.discordId !== user.id) fail("Please reconnect your Roblox account before applying.", 403);
    return { discordId: user.id, username: user.username, displayName: user.displayName, roblox: { userId: profile.roblox.userId, username: profile.roblox.username } };
  }
  async function formForApplicant(id, user) {
    const identity = await linkedIdentity(user);
    const form = snapshotData(await ref("careerForms", id).get());
    if (!form.publishedVersion) checkOpen(form, now());
    const acceptingApplications = acceptsResubmissions(form, "submitted", now());
    const existing = await ref("careerApplications", appId(id, user.id)).get();
    const draft = await applicantDraft(id, user.id, form.publishedVersion);
    if (!acceptingApplications && !existing.exists && !draft) checkOpen(form, now());
    const version = await readVersion(form.publishedVersion);
    return { form: { ...version, id, versionId: form.publishedVersion }, identity, existingApplicationId: existing.exists ? existing.id : null, draft, acceptingApplications };
  }
  async function applicantDraft(formId, userId, displayedVersion) {
    const data = (await ref("careerApplicationDrafts", appId(formId, userId)).get()).data();
    if (!data) return null;
    const draft = pick(data, ["versionId", "answers", "revision", "updatedAt", "applicationRevision"]);
    if (data.versionId !== displayedVersion) {
      const original = await readVersion(data.versionId);
      if (original?.formId === formId) draft.form = original;
    }
    return draft;
  }
  async function draftToRemove(tx, formId, userId, input, versionId, answers) {
    const target = ref("careerApplicationDrafts", appId(formId, userId));
    const data = (await tx.get(target)).data();
    if (input.draftRevision !== undefined) {
      // A known revision lets the applicant explicitly replace an obsolete form draft too.
      expectDraftRevision(data, input.draftRevision);
      return data ? target : null;
    }
    // Older clients must never delete a newer or unseen set of draft answers.
    return data?.versionId === versionId && JSON.stringify(data.answers) === JSON.stringify(answers) ? target : null;
  }
  async function application(id, user, admin = false) {
    if (admin && !["dev", "leadqa"].includes(user?.role)) fail("You do not have permission to view this application.", 403);
    const data = snapshotData(await ref("careerApplications", id).get());
    if (admin && user.role === "leadqa" && !isQaApplication(data.category)) fail("This application could not be found.", 404);
    if (!admin && data.applicantId !== user.id) fail("This application could not be found.", 404);
    const form = await readVersion(data.versionId);
    const opening = (await ref("careerForms", data.formId).get()).data();
    const visible = { ...pick(data, [...SUMMARY, "id", "answers", "history", "feedbackFormatting"]), ...(admin ? pick(data, ["internalNotes", "reviewer", "notesFormatting"]) : {}) };
    return { application: admin ? (await ai.decorate([visible], { full: true }))[0] : visible, form, canResubmit: !admin && acceptsResubmissions(opening, data.status, now()), closesAt: opening?.closesAt ?? null,
      ...(!admin ? { draft: await applicantDraft(data.formId, user.id, data.versionId) } : {}) };
  }
  function applicationQuery(user, options, admin) {
    if (admin && !["dev", "leadqa"].includes(user?.role)) fail("You do not have permission to view applications.", 403);
    let query = db.collection("careerApplications");
    if (!admin) query = query.where("applicantId", "==", user.id);
    if (admin && user.role === "leadqa") query = query.where("category", "in", QA_CATEGORIES);
    if (options.formId) query = query.where("formId", "==", identifier(options.formId));
    if (options.status) {
      if (!APPLICATION_STATUSES.includes(options.status)) fail("Unknown application status.");
      query = query.where("status", "==", options.status);
    }
    return query;
  }
  return {
    images, ai,
    async listForms(options = {}, admin = false) {
      if (admin) return page(db.collection("careerForms"), "careerForms", options, FORM_SUMMARY, "createdAt", "desc", "admin-forms");
      const key = String(options.cursor ?? "");
      const data = await publicCache.get(key, () => page(db.collection("careerForms").where("state", "==", "open").where("openUntil", ">", stamp()), "careerForms", options, [...FORM_SUMMARY, "openUntil"], "openUntil", "asc", "public-forms"));
      return { ...data, items: data.items.filter(item => !item.closesAt || Date.parse(item.closesAt) > now()) };
    },
    async createForm() {
      const id = randomUUID();
      const draft = { title: "Untitled opening", category: "Community", description: "", commitment: "", confirmation: "Thank you for applying. Follow your application on your profile.", closesAt: null, questions: [] };
      const form = { ...pick(draft, FORM_SUMMARY), draft, state: "draft", publishedVersion: null, revision: 1, createdAt: stamp(), updatedAt: stamp(), applicationCount: 0, qaApplicationCount: 0, reviewCategories: [] };
      await ref("careerForms", id).set(form);
      selectorCache.clear();
      return { ...form, id };
    },
    async adminForm(id) { return snapshotData(await ref("careerForms", id).get()); },
    async saveForm(id, input) {
      const action = input?.action;
      if (!["save", "publish", "close"].includes(action)) fail("Choose a form action.");
      const draft = action === "close" ? null : normalizeForm(input.draft, action === "publish");
      const aiReview = action !== "close" && input.aiReview !== undefined ? normalizeAiReview(input.aiReview) : null;
      if (action === "publish" && draft.closesAt && Date.parse(draft.closesAt) <= now()) fail("The closing date must be in the future.");
      const result = await db.runTransaction(async tx => {
        const target = ref("careerForms", id);
        const old = snapshotData(await tx.get(target));
        expectRevision(old, input.revision);
        const publicationImages = draft ? await images.prepare(tx, id, draft.questions) : [];
        const revision = old.revision + 1;
        const changes = { revision, updatedAt: stamp() };
        if (aiReview) {
          changes.aiReview = aiReview;
          changes.aiRevision = (old.aiRevision ?? 0) + (aiFingerprint(normalizeAiReview(old.aiReview)) === aiFingerprint(aiReview) ? 0 : 1);
        }
        if (draft) changes.draft = draft;
        if (action === "close") changes.state = "closed";
        if (action === "save" && !old.publishedVersion) Object.assign(changes, pick(draft, FORM_SUMMARY));
        if (action === "publish") {
          const versionId = `${id}_${revision}`;
          tx.set(ref("careerFormVersions", versionId), { ...draft, formId: id, publishedAt: stamp() });
          Object.assign(changes, pick(draft, FORM_SUMMARY), { state: "open", openUntil: draft.closesAt ?? "9999-12-31T23:59:59.999Z", publishedVersion: versionId });
          changes.reviewCategories = [...new Set([...(old.reviewCategories ?? (old.publishedVersion ? [old.category] : [])), draft.category])];
          if (isQaApplication(draft.category)) changes.qaReviewTitle = draft.title;
          else if (!old.qaReviewTitle && isQaApplication(old.category)) changes.qaReviewTitle = old.title;
          for (const image of publicationImages) tx.update(image, { published: true });
        }
        tx.update(target, changes);
        return { ...old, ...changes };
      });
      publicCache.clear();
      selectorCache.clear();
      ai.invalidateForm(id);
      return result;
    },
    formForApplicant,
    async saveApplicationDraft(id, user, input) {
      if (!user?.id) fail("Sign in with Discord to save your application draft.", 401);
      const versionId = identifier(input?.versionId);
      return db.runTransaction(async tx => {
        const opening = snapshotData(await tx.get(ref("careerForms", id)));
        const application = (await tx.get(ref("careerApplications", appId(id, user.id)))).data();
        const target = ref("careerApplicationDrafts", appId(id, user.id));
        const previous = (await tx.get(target)).data();
        expectDraftRevision(previous, input.revision);
        if (application) {
          if (!acceptsResubmissions(opening, application.status, now())) fail("This application cannot be edited while it is withdrawn or the opening is closed.", 409);
          expectRevision(application, input.applicationRevision);
          if (versionId !== application.versionId) fail("Reload your application before saving its draft.", 409);
        } else {
          await linkedIdentity(user, tx);
          checkOpen(opening, now());
          if (versionId !== opening.publishedVersion) fail("This form was updated. Reload before saving your draft; your previously saved answers are still available.", 409);
          if (input.applicationRevision != null) fail("Reload this opening before saving your draft.", 409);
        }
        const version = snapshotData(await tx.get(ref("careerFormVersions", versionId)));
        if (version.formId !== id) fail("This form version could not be found.", 404);
        const answers = validateAnswers(version, input.answers, { partial: true });
        const applicationRevision = application?.revision ?? null;
        if (previous?.versionId === versionId && previous.applicationRevision === applicationRevision && JSON.stringify(previous.answers) === JSON.stringify(answers)) return pick(previous, ["versionId", "answers", "revision", "updatedAt", "applicationRevision"]);
        const draft = { versionId, answers, applicationRevision, revision: (previous?.revision ?? 0) + 1, updatedAt: stamp() };
        tx.set(target, { ...draft, formId: id, applicantId: user.id });
        return draft;
      });
    },
    async submit(id, user, input) {
      if (input?.consent !== true) fail("Confirm that you have read the application privacy notice.");
      let createdApplication;
      const result = await db.runTransaction(async tx => {
        const identity = await linkedIdentity(user, tx);
        const target = ref("careerApplications", appId(id, user.id));
        const existing = await tx.get(target);
        if (existing.exists) return { id: target.path.split("/").at(-1), alreadySubmitted: true };
        const form = snapshotData(await tx.get(ref("careerForms", id)));
        checkOpen(form, now());
        if (input.versionId !== form.publishedVersion) fail("This form was updated. Reload and review the new questions before submitting.", 409);
        const version = snapshotData(await tx.get(ref("careerFormVersions", form.publishedVersion)));
        const answers = validateAnswers(version, input.answers);
        const savedDraft = await draftToRemove(tx, id, user.id, input, form.publishedVersion, answers);
        const createdAt = stamp();
        const data = { formId: id, versionId: form.publishedVersion, title: version.title, category: version.category,
          applicantId: user.id, applicant: identity, answers, status: "submitted", createdAt, updatedAt: createdAt, revision: 1, submissionRevision: 1,
          feedback: "", internalNotes: "", reviewer: null, consentAt: createdAt, privacyNoticeVersion: "careers-2026-11-04",
          history: [{ status: "submitted", at: createdAt, feedback: "Application received." }] };
        tx.set(target, data);
        const counts = {};
        if (Number.isInteger(form.applicationCount)) counts.applicationCount = form.applicationCount + 1;
        if (isQaApplication(version.category) && Number.isInteger(form.qaApplicationCount)) counts.qaApplicationCount = form.qaApplicationCount + 1;
        if (Object.keys(counts).length) tx.update(ref("careerForms", id), counts);
        if (savedDraft) tx.delete(savedDraft);
        createdApplication = { ...data, id: target.id };
        return { id: target.path.split("/").at(-1), alreadySubmitted: false };
      });
      if (createdApplication) { applicationIndex.changed(null, createdApplication); selectorCache.clear(); ai.invalidateForm(id); }
      return result;
    },
    async resubmit(id, user, input) {
      if (!user?.id) fail("Sign in with Discord to edit your application.", 401);
      if (input?.consent !== true) fail("Confirm that you have read the application privacy notice.");
      let changedApplication;
      const result = await db.runTransaction(async tx => {
        const target = ref("careerApplications", id);
        const data = snapshotData(await tx.get(target));
        if (data.applicantId !== user.id) fail("This application could not be found.", 404);
        expectRevision(data, input.revision);
        const openingRef = ref("careerForms", data.formId);
        const opening = (await tx.get(openingRef)).data();
        if (!acceptsResubmissions(opening, data.status, now())) fail(data.status === "withdrawn" ? "An administrator must restore this withdrawn application before you can edit it." : "This opening is closed to edits and resubmissions.", 409);
        const version = snapshotData(await tx.get(ref("careerFormVersions", data.versionId)));
        const answers = validateAnswers(version, input.answers);
        const savedDraft = await draftToRemove(tx, data.formId, user.id, input, data.versionId, answers);
        const updatedAt = stamp();
        const changes = { answers, status: "submitted", updatedAt, resubmittedAt: updatedAt, revision: data.revision + 1,
          submissionRevision: (data.submissionRevision ?? 1) + 1, feedback: "", feedbackFormatting: {}, reviewer: null,
          consentAt: updatedAt, privacyNoticeVersion: "careers-2026-11-04",
          history: [...(data.history ?? []), { status: "submitted", at: updatedAt, feedback: "Application edited and resubmitted." }].slice(-50) };
        tx.update(target, changes);
        tx.update(openingRef, { applicationEditRevision: (opening.applicationEditRevision ?? 0) + 1 });
        if (savedDraft) tx.delete(savedDraft);
        changedApplication = { before: data, after: { ...data, ...changes, id } };
        return { id, revision: data.revision + 1 };
      });
      applicationIndex.changed(changedApplication.before, changedApplication.after);
      ai.invalidateForm(changedApplication.after.formId);
      return result;
    },
    async listApplications(user, options = {}, admin = false) {
      const query = applicationQuery(user, options, admin);
      const sort = options.sort ?? "newest", search = String(options.search ?? "").trim().toLowerCase();
      if (admin && (!["newest", "oldest", "ai_rank", "quality"].includes(sort) || search.length > 100)) fail("Choose a supported sort and a search of up to 100 characters.");
      if (admin && (["ai_rank", "quality"].includes(sort) || search)) {
        if (!options.formId) fail("Choose one application form before searching or sorting its applications.");
        const corpus = await applicationIndex.rows(user, { formId: options.formId, searchable: true, refresh: options.refresh });
        let all = corpus.rows.filter(item => !options.status || item.status === options.status);
        if (!all.length) return { items: [], nextCursor: null };
        const index = ["ai_rank", "quality"].includes(sort) ? await ai.scoreIndex(options.formId) : { runId: null, scores: new Map() };
        const scope = JSON.stringify([user.role, options.formId, options.status ?? "", sort, search, index.runId, corpus.asOf, corpus.revision]);
        if (search) all = all.filter(item => [item.applicant?.username, item.applicant?.displayName, item.applicant?.roblox?.username].some(value => String(value ?? "").toLowerCase().includes(search)));
        all.sort((a, b) => {
          if (["ai_rank", "quality"].includes(sort)) {
            const key = sort === "quality" ? "qualityScore" : "relativeScore";
            const score = item => {
              const saved = index.scores.get(item.id);
              return item.status === "withdrawn" || (saved?.submissionRevision ?? 1) !== (item.submissionRevision ?? 1) ? -1 : saved?.[key] ?? -1;
            };
            if (score(a) !== score(b)) return score(b) - score(a);
          }
          return (a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)) * (sort === "oldest" ? 1 : -1);
        });
        let offset = 0;
        if (options.cursor) {
          try {
            if (typeof options.cursor !== "string" || options.cursor.length > 1000) throw new Error();
            const parsed = JSON.parse(Buffer.from(options.cursor, "base64url").toString());
            const position = all.findIndex(item => item.id === parsed.id);
            if (parsed.scope !== scope || position < 0) throw new Error();
            offset = position + 1;
          } catch { fail("The results changed. Return to the first page before continuing.", 409); }
        }
        const selected = all.slice(offset, offset + PAGE_SIZE);
        // Return fresh authorized rows, not cached private response objects. A
        // cached search/rank page reads at most the twenty selected documents.
        const snapshots = await Promise.all(selected.map(item => ref("careerApplications", item.id).get()));
        const items = snapshots.filter(doc => doc.exists).map(snapshotData).filter(item => item.formId === options.formId && (user.role !== "leadqa" || isQaApplication(item.category)) && (!options.status || item.status === options.status)).map(item => pick(item, ["id", ...SUMMARY]));
        return { items: await ai.decorate(items), nextCursor: offset + PAGE_SIZE < all.length ? Buffer.from(JSON.stringify({ scope, id: selected.at(-1).id })).toString("base64url") : null, asOf: corpus.asOf, maxAgeSeconds: 900 };
      }
      const scope = JSON.stringify([admin ? user.role : user.id, options.formId ?? "", options.status ?? "", sort]);
      const result = await page(query, "careerApplications", options, SUMMARY, "createdAt", admin && sort === "oldest" ? "asc" : "desc", scope);
      return admin ? { ...result, items: await ai.decorate(result.items) } : result;
    },
    async reviewForms(user, options = {}) {
      if (!["dev", "leadqa"].includes(user?.role)) fail("You do not have permission to view application forms.", 403);
      if (options.refresh) selectorCache.clear();
      const forms = await selectorCache.get("forms", async () => {
        const items = [];
        let cursor;
        const base = db.collection("careerForms").orderBy("createdAt", "desc").orderBy("__name__", "desc").select("title", "category", "state", "createdAt", "closesAt", "applicationCount", "qaApplicationCount", "reviewCategories", "qaReviewTitle");
        while (true) {
          const result = await (cursor ? base.startAfter(...cursor) : base).limit(500).get();
          items.push(...result.docs.map(snapshotData));
          if (items.length > 5000) fail("The form selector supports up to 5,000 recruitment rounds.");
          if (result.docs.length < 500) break;
          const last = result.docs.at(-1); cursor = [last.data().createdAt, last.ref.path];
        }
        return { items, asOf: stamp() };
      });
      let corpus = applicationIndex.peek(user.role);
      // Older forms predate historical-category metadata. Reconcile that legacy
      // QA-only pool once per cache lifetime so an old QA round never disappears
      // merely because its current published category changed.
      if (user.role === "leadqa" && forms.items.some(item => !Array.isArray(item.reviewCategories))) corpus = await applicationIndex.rows(user, { refresh: options.refresh });
      const counts = new Map(), titles = new Map();
      for (const item of corpus?.rows ?? []) { counts.set(item.formId, (counts.get(item.formId) ?? 0) + 1); if (!titles.has(item.formId)) titles.set(item.formId, item.title); }
      const items = forms.items.filter(item => user.role === "dev" || isQaApplication(item.category) || item.reviewCategories?.some(isQaApplication) || counts.has(item.id)).map(item => ({
        ...pick(item, ["id", "title", "category", "state", "createdAt", "closesAt"]),
        ...(user.role === "leadqa" ? { title: titles.get(item.id) ?? item.qaReviewTitle ?? item.title, category: "Quality assurance" } : {}),
        applications: counts.get(item.id) ?? (Number.isInteger(user.role === "leadqa" ? item.qaApplicationCount : item.applicationCount) ? (user.role === "leadqa" ? item.qaApplicationCount : item.applicationCount) : null),
      }));
      // A legacy application's original form may no longer have a form document.
      if (user.role === "leadqa" && corpus) for (const [id, applications] of counts) if (!items.some(item => item.id === id)) items.push({ id, title: titles.get(id), category: "Quality assurance", state: "received", createdAt: null, applications });
      return { items, asOf: forms.asOf, maxAgeSeconds: 900 };
    },
    async applicationStats(user, options = {}) {
      applicationQuery(user, options, true); // Validate scope before touching a cache.
      const corpus = await applicationIndex.rows(user, { formId: options.formId ?? "", refresh: options.refresh });
      const applicants = new Set(), categories = new Map(), openings = new Map();
      let applications = 0;
      for (const data of corpus.rows) {
        if (options.status && data.status !== options.status) continue;
        const category = isQaApplication(data.category) ? "Quality assurance" : data.category;
        applications++; applicants.add(data.applicantId);
        for (const [map, id, label] of [[categories, category, { category }], [openings, data.formId, { id: data.formId, title: data.title }]]) {
          if (!map.has(id)) map.set(id, { ...label, applications: 0, people: new Set() });
          const group = map.get(id); group.applications++; group.people.add(data.applicantId);
        }
      }
      const groups = map => [...map.values()].map(({ people, ...group }) => ({ ...group, applicants: people.size })).sort((a, b) => b.applications - a.applications || String(a.category ?? a.title).localeCompare(String(b.category ?? b.title)));
      return { applicants: applicants.size, applications, categories: groups(categories), openings: groups(openings), asOf: corpus.asOf, maxAgeSeconds: 900 };
    },
    application,
    async review(id, user, input, withdraw = false) {
      if (!withdraw && user?.role !== "dev") fail("You do not have permission to change applications.", 403);
      const changes = withdraw ? { status: "withdrawn" } : reviewInput(input);
      let changedApplication;
      const result = await db.runTransaction(async tx => {
        const target = ref("careerApplications", id);
        const data = snapshotData(await tx.get(target));
        if (withdraw && data.applicantId !== user.id) fail("This application could not be found.", 404);
        expectRevision(data, input.revision);
        if (withdraw && ["withdrawn", "accepted", "rejected"].includes(data.status)) fail("This application cannot be changed in its current status.", 409);
        const updatedAt = stamp();
        const history = [...(data.history ?? [])];
        if (data.status !== changes.status || (!withdraw && (data.feedback !== changes.feedback || JSON.stringify(data.feedbackFormatting ?? {}) !== JSON.stringify(changes.feedbackFormatting)))) history.push({ status: changes.status, at: updatedAt, feedback: withdraw ? "Withdrawn by applicant." : changes.feedback, ...(!withdraw ? { feedbackFormatting: changes.feedbackFormatting } : {}) });
        tx.update(target, { ...changes, updatedAt, revision: data.revision + 1, history: history.slice(-50), ...(!withdraw ? { reviewer: { id: user.id, displayName: user.displayName } } : {}) });
        if (data.status !== changes.status) changedApplication = { before: data, after: { ...data, ...changes, updatedAt, revision: data.revision + 1, id } };
        return { id, revision: data.revision + 1 };
      });
      if (changedApplication) applicationIndex.changed(changedApplication.before, changedApplication.after);
      return result;
    },
  };
}
