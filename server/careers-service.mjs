import { createHash, randomUUID } from "node:crypto";
import { APPLICATION_STATUSES, fail, identifier, normalizeForm, reviewInput, validateAnswers } from "./careers-domain.mjs";

const PAGE_SIZE = 20;
const SUMMARY = ["formId", "versionId", "title", "category", "applicantId", "applicant", "status", "createdAt", "updatedAt", "revision", "feedback"];
const FORM_SUMMARY = ["title", "category", "description", "commitment", "closesAt", "state", "publishedVersion", "revision", "createdAt", "updatedAt"];
const pick = (data, keys) => Object.fromEntries(keys.filter(key => data[key] !== undefined).map(key => [key, data[key]]));
const snapshotData = snapshot => snapshot.exists ? { ...snapshot.data(), id: snapshot.id ?? snapshot.ref.path.split("/").at(-1) } : fail("This item could not be found.", 404);
const appId = (formId, userId) => createHash("sha256").update(`${formId}:${userId}`).digest("hex").slice(0, 40);
function expectRevision(data, revision) { if (!Number.isInteger(revision) || data.revision !== revision) fail("Someone changed this item. Reload before saving; your changes have not been applied.", 409); }
function checkOpen(form, now) {
  if (form.state !== "open" || !form.publishedVersion || (form.closesAt && Date.parse(form.closesAt) <= now)) fail("This opening is closed to new applications.", 409);
}

export function createCareersService(db, { now = Date.now } = {}) {
  let publicCache = new Map();
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
    const data = snapshotData(await ref("careerApplications", id).get());
    if (!admin && data.applicantId !== user.id) fail("This application could not be found.", 404);
    const form = snapshotData(await ref("careerFormVersions", data.versionId).get());
    return { application: { ...pick(data, [...SUMMARY, "id", "answers", "history"]), ...(admin ? pick(data, ["internalNotes", "reviewer"]) : {}) }, form };
  }
  return {
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
      if (action === "publish" && draft.closesAt && Date.parse(draft.closesAt) <= now()) fail("The closing date must be in the future.");
      const result = await db.runTransaction(async tx => {
        const target = ref("careerForms", id);
        const old = snapshotData(await tx.get(target));
        expectRevision(old, input.revision);
        const revision = old.revision + 1;
        const changes = { revision, updatedAt: stamp() };
        if (draft) changes.draft = draft;
        if (action === "close") changes.state = "closed";
        if (action === "save" && !old.publishedVersion) Object.assign(changes, pick(draft, FORM_SUMMARY));
        if (action === "publish") {
          const versionId = `${id}_${revision}`;
          tx.set(ref("careerFormVersions", versionId), { ...draft, formId: id, publishedAt: stamp() });
          Object.assign(changes, pick(draft, FORM_SUMMARY), { state: "open", openUntil: draft.closesAt ?? "9999-12-31T23:59:59.999Z", publishedVersion: versionId });
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
      return db.runTransaction(async tx => {
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
          applicantId: user.id, applicant: identity, answers, status: "submitted", createdAt, updatedAt: createdAt, revision: 1,
          feedback: "", internalNotes: "", reviewer: null, consentAt: createdAt, privacyNoticeVersion: "careers-2026-09-14",
          history: [{ status: "submitted", at: createdAt, feedback: "Application received." }] });
        return { id: target.path.split("/").at(-1), alreadySubmitted: false };
      });
    },
    async listApplications(user, options = {}, admin = false) {
      let query = db.collection("careerApplications");
      if (!admin) query = query.where("applicantId", "==", user.id);
      if (options.formId) query = query.where("formId", "==", identifier(options.formId));
      if (options.status) {
        if (!APPLICATION_STATUSES.includes(options.status)) fail("Unknown application status.");
        query = query.where("status", "==", options.status);
      }
      const scope = JSON.stringify([admin ? "admin" : user.id, options.formId ?? "", options.status ?? ""]);
      return page(query, "careerApplications", options, SUMMARY, "createdAt", "desc", scope);
    },
    application,
    async review(id, user, input, withdraw = false) {
      const changes = withdraw ? { status: "withdrawn" } : reviewInput(input);
      return db.runTransaction(async tx => {
        const target = ref("careerApplications", id);
        const data = snapshotData(await tx.get(target));
        if (withdraw && data.applicantId !== user.id) fail("This application could not be found.", 404);
        expectRevision(data, input.revision);
        if (data.status === "withdrawn" || (withdraw && ["accepted", "rejected"].includes(data.status))) fail("This application cannot be changed in its current status.", 409);
        const updatedAt = stamp();
        const history = [...(data.history ?? [])];
        if (data.status !== changes.status || (!withdraw && data.feedback !== changes.feedback)) history.push({ status: changes.status, at: updatedAt, feedback: withdraw ? "Withdrawn by applicant." : changes.feedback });
        tx.update(target, { ...changes, updatedAt, revision: data.revision + 1, history: history.slice(-50), ...(!withdraw ? { reviewer: { id: user.id, displayName: user.displayName } } : {}) });
        return { id, revision: data.revision + 1 };
      });
    },
  };
}
