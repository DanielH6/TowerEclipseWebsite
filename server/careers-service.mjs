import { createHash, randomUUID } from "node:crypto";
import { APPLICATION_STATUSES, fail, identifier, normalizeForm, reviewInput, validateAnswers } from "./careers-domain.mjs";
import { createCareerImageService } from "./careers-images.mjs";
import { normalizeAiReview, aiFingerprint } from "./careers-ai-domain.mjs";
import { createCareerAiProvider, readCareerAiConfiguration } from "./careers-ai-provider.mjs";
import { createCareerAiService } from "./careers-ai-service.mjs";

const PAGE_SIZE = 20;
const SUMMARY = ["formId", "versionId", "title", "category", "applicantId", "applicant", "status", "createdAt", "updatedAt", "revision", "submissionRevision", "resubmittedAt", "feedback"];
const FORM_SUMMARY = ["title", "category", "description", "commitment", "formatting", "closesAt", "state", "publishedVersion", "revision", "createdAt", "updatedAt"];
const QA_CATEGORIES = ["Quality assurance", "Quality Assurance", "quality assurance", "QUALITY ASSURANCE"];
const isQaApplication = category => typeof category === "string" && category.trim().toLowerCase() === "quality assurance";
const pick = (data, keys) => Object.fromEntries(keys.filter(key => data[key] !== undefined).map(key => [key, data[key]]));
const snapshotData = snapshot => snapshot.exists ? { ...snapshot.data(), id: snapshot.id ?? snapshot.ref.path.split("/").at(-1) } : fail("This item could not be found.", 404);
const appId = (formId, userId) => createHash("sha256").update(`${formId}:${userId}`).digest("hex").slice(0, 40);
function expectRevision(data, revision) { if (!Number.isInteger(revision) || data.revision !== revision) fail("Someone changed this item. Reload before saving; your changes have not been applied.", 409); }
function checkOpen(form, now) {
  if (form.state !== "open" || !form.publishedVersion || (form.closesAt && Date.parse(form.closesAt) <= now)) fail("This opening is closed to new applications.", 409);
}
const acceptsResubmissions = (form, status, now) => status !== "withdrawn" && form?.state === "open" && Boolean(form.publishedVersion) && (!form.closesAt || Date.parse(form.closesAt) > now);

export function createCareersService(db, { now = Date.now, imageStorage, aiProvider = createCareerAiProvider(readCareerAiConfiguration()) } = {}) {
  let publicCache = new Map();
  const statsCache = new Map();
  const images = createCareerImageService(db, imageStorage);
  const ai = createCareerAiService(db, { provider: aiProvider, images, now });
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
    checkOpen(form, now());
    const version = snapshotData(await ref("careerFormVersions", form.publishedVersion).get());
    const existing = await ref("careerApplications", appId(id, user.id)).get();
    return { form: { ...version, id, versionId: form.publishedVersion }, identity, existingApplicationId: existing.exists ? existing.id : null };
  }
  async function application(id, user, admin = false) {
    if (admin && !["dev", "leadqa"].includes(user?.role)) fail("You do not have permission to view this application.", 403);
    const data = snapshotData(await ref("careerApplications", id).get());
    if (admin && user.role === "leadqa" && !isQaApplication(data.category)) fail("This application could not be found.", 404);
    if (!admin && data.applicantId !== user.id) fail("This application could not be found.", 404);
    const form = snapshotData(await ref("careerFormVersions", data.versionId).get());
    const opening = (await ref("careerForms", data.formId).get()).data();
    const visible = { ...pick(data, [...SUMMARY, "id", "answers", "history", "feedbackFormatting"]), ...(admin ? pick(data, ["internalNotes", "reviewer", "notesFormatting"]) : {}) };
    return { application: admin ? (await ai.decorate([visible]))[0] : visible, form, canResubmit: !admin && acceptsResubmissions(opening, data.status, now()), closesAt: opening?.closesAt ?? null };
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
      const cached = publicCache.get(key);
      if (cached && cached.until > now()) return { ...cached.data, items: cached.data.items.filter(item => !item.closesAt || Date.parse(item.closesAt) > now()) };
      const data = await page(db.collection("careerForms").where("state", "==", "open").where("openUntil", ">", stamp()), "careerForms", options, [...FORM_SUMMARY, "openUntil"], "openUntil", "asc", "public-forms");
      if (publicCache.size >= 100) publicCache.clear();
      publicCache.set(key, { until: now() + 60_000, data });
      return data;
    },
    async createForm() {
      const id = randomUUID();
      const draft = { title: "Untitled opening", category: "Community", description: "", commitment: "", confirmation: "Thank you for applying. Follow your application on your profile.", closesAt: null, questions: [] };
      const form = { ...pick(draft, FORM_SUMMARY), draft, state: "draft", publishedVersion: null, revision: 1, createdAt: stamp(), updatedAt: stamp() };
      await ref("careerForms", id).set(form);
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
          for (const image of publicationImages) tx.update(image, { published: true });
        }
        tx.update(target, changes);
        return { ...old, ...changes };
      });
      publicCache = new Map();
      return result;
    },
    formForApplicant,
    async submit(id, user, input) {
      if (input?.consent !== true) fail("Confirm that you have read the application privacy notice.");
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
        const createdAt = stamp();
        tx.set(target, { formId: id, versionId: form.publishedVersion, title: version.title, category: version.category,
          applicantId: user.id, applicant: identity, answers, status: "submitted", createdAt, updatedAt: createdAt, revision: 1, submissionRevision: 1,
          feedback: "", internalNotes: "", reviewer: null, consentAt: createdAt, privacyNoticeVersion: "careers-2026-11-04",
          history: [{ status: "submitted", at: createdAt, feedback: "Application received." }] });
        return { id: target.path.split("/").at(-1), alreadySubmitted: false };
      });
      statsCache.clear();
      return result;
    },
    async resubmit(id, user, input) {
      if (!user?.id) fail("Sign in with Discord to edit your application.", 401);
      if (input?.consent !== true) fail("Confirm that you have read the application privacy notice.");
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
        const updatedAt = stamp();
        tx.update(target, { answers, status: "submitted", updatedAt, resubmittedAt: updatedAt, revision: data.revision + 1,
          submissionRevision: (data.submissionRevision ?? 1) + 1, feedback: "", feedbackFormatting: {}, reviewer: null,
          consentAt: updatedAt, privacyNoticeVersion: "careers-2026-11-04",
          history: [...(data.history ?? []), { status: "submitted", at: updatedAt, feedback: "Application edited and resubmitted." }].slice(-50) });
        tx.update(openingRef, { applicationEditRevision: (opening.applicationEditRevision ?? 0) + 1 });
        return { id, revision: data.revision + 1 };
      });
      statsCache.clear();
      return result;
    },
    async listApplications(user, options = {}, admin = false) {
      const query = applicationQuery(user, options, admin);
      const sort = options.sort ?? "newest", search = String(options.search ?? "").trim().toLowerCase();
      if (admin && (!["newest", "oldest", "ai_rank", "quality"].includes(sort) || search.length > 100)) fail("Choose a supported sort and a search of up to 100 characters.");
      if (admin && (sort !== "newest" || search)) {
        if (!options.formId) fail("Choose one application form before searching or sorting its applications.");
        let all = [], cursor;
        const base = query.orderBy("createdAt", "desc").orderBy("__name__", "desc").select(...SUMMARY);
        while (true) {
          const result = await (cursor ? base.startAfter(...cursor) : base).limit(500).get();
          all.push(...result.docs.map(snapshotData));
          if (all.length > 5000) fail("Search and ranked sorting support up to 5,000 applications per opening.");
          if (result.docs.length < 500) break;
          const last = result.docs.at(-1); cursor = [last.data().createdAt, last.ref.path];
        }
        if (!all.length) return { items: [], nextCursor: null };
        const index = ["ai_rank", "quality"].includes(sort) ? await ai.scoreIndex(options.formId) : { runId: null, scores: new Map() };
        const scope = JSON.stringify([user.role, options.formId, options.status ?? "", sort, search, index.runId]);
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
        const items = all.slice(offset, offset + PAGE_SIZE);
        return { items: await ai.decorate(items), nextCursor: offset + PAGE_SIZE < all.length ? Buffer.from(JSON.stringify({ scope, id: items.at(-1).id })).toString("base64url") : null };
      }
      const scope = JSON.stringify([admin ? user.role : user.id, options.formId ?? "", options.status ?? ""]);
      const result = await page(query, "careerApplications", options, SUMMARY, "createdAt", "desc", scope);
      return admin ? { ...result, items: await ai.decorate(result.items) } : result;
    },
    async reviewForms(user) {
      if (!["dev", "leadqa"].includes(user?.role)) fail("You do not have permission to view application forms.", 403);
      const stats = await this.applicationStats(user);
      if (user.role === "leadqa") return { items: stats.openings.map(item => ({ ...item, category: "Quality assurance", state: "received", createdAt: null })) };
      const items = [], counts = new Map(stats.openings.map(item => [item.id, item.applications]));
      let cursor;
      const base = db.collection("careerForms").orderBy("createdAt", "desc").orderBy("__name__", "desc").select("title", "category", "state", "createdAt", "closesAt");
      while (true) {
        const result = await (cursor ? base.startAfter(...cursor) : base).limit(500).get();
        items.push(...result.docs.map(doc => ({ ...snapshotData(doc), applications: counts.get(doc.id) ?? 0 })));
        if (items.length > 5000) fail("The form selector supports up to 5,000 recruitment rounds.");
        if (result.docs.length < 500) break;
        const last = result.docs.at(-1); cursor = [last.data().createdAt, last.ref.path];
      }
      return { items };
    },
    async applicationStats(user, options = {}) {
      const base = applicationQuery(user, options, true).orderBy("createdAt", "desc").orderBy("__name__", "desc").select("applicantId", "category", "formId", "title", "createdAt");
      const key = JSON.stringify([user.role, options.formId ?? "", options.status ?? ""]);
      const cached = statsCache.get(key);
      if (cached?.until > now()) return cached.data;
      const applicants = new Set(), categories = new Map(), openings = new Map();
      let applications = 0, cursor;
      // Read small projections in bounded batches, using existing list indexes.
      // No answer, identity snapshot, feedback or private note is fetched for counts.
      while (true) {
        const batch = await (cursor ? base.startAfter(...cursor) : base).limit(500).get();
        for (const snapshot of batch.docs) {
          const data = snapshot.data(), category = isQaApplication(data.category) ? "Quality assurance" : data.category;
          applications++; applicants.add(data.applicantId);
          for (const [map, id, label] of [[categories, category, { category }], [openings, data.formId, { id: data.formId, title: data.title }]]) {
            if (!map.has(id)) map.set(id, { ...label, applications: 0, people: new Set() });
            const group = map.get(id); group.applications++; group.people.add(data.applicantId);
          }
        }
        if (batch.docs.length < 500) break;
        const last = batch.docs.at(-1); cursor = [last.data().createdAt, `careerApplications/${last.id}`];
      }
      const groups = map => [...map.values()].map(({ people, ...group }) => ({ ...group, applicants: people.size })).sort((a, b) => b.applications - a.applications || String(a.category ?? a.title).localeCompare(String(b.category ?? b.title)));
      const data = { applicants: applicants.size, applications, categories: groups(categories), openings: groups(openings) };
      if (statsCache.size >= 100) statsCache.clear();
      statsCache.set(key, { until: now() + 60_000, data });
      return data;
    },
    application,
    async review(id, user, input, withdraw = false) {
      if (!withdraw && user?.role !== "dev") fail("You do not have permission to change applications.", 403);
      const changes = withdraw ? { status: "withdrawn" } : reviewInput(input);
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
        return { id, revision: data.revision + 1 };
      });
      statsCache.clear();
      return result;
    },
  };
}
