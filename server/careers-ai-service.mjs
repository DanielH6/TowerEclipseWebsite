import { randomUUID } from "node:crypto";
import { fail, identifier, normalizeForm } from "./careers-domain.mjs";
import { AI_MODEL, AI_PROMPT_VERSION, assessmentInput, aiFingerprint, normalizeAiReview, normalizeAssessment, rankAssessments } from "./careers-ai-domain.mjs";
import { createReadCache } from "./read-cache.mjs";

const MAX_APPLICANTS = 5000, LEASE_MS = 120_000;
const activeStates = ["queued", "running"];
const requireAdmin = user => { if (user?.role !== "dev") fail("Only administrators can request or configure AI reviews.", 403); };
const summary = (id, data) => data ? { id, state: data.state, total: data.members.length, processed: data.processed, createdAt: data.createdAt,
  completedAt: data.completedAt ?? null, error: data.error ?? "", requestedBy: data.requestedBy, criteriaRevision: data.criteriaRevision, model: data.model, usage: data.usage } : null;

// Completed scores and published versions never change. Mutable form pointers have
// a short bound and are invalidated by local writes; authority checks bypass them.
function memo({ name, maximum = 200, ttl = 30_000, now }) {
  const cache = createReadCache({ name, maxEntries: maximum, maxBytes: 8 * 1024 * 1024, ttlMs: ttl, now });
  return { ...cache, async set(key, value) { cache.invalidate(key); await cache.get(key, async () => value); } };
}

export function createCareerAiService(db, { provider, images, now = Date.now, readVersion } = {}) {
  const formRef = id => db.doc(`careerForms/${identifier(id)}`);
  const runRef = id => db.doc(`careerAiRuns/${identifier(id)}`);
  const scoreRef = (runId, id) => db.doc(`careerAiRuns/${identifier(runId)}/careerAiScores/${identifier(id)}`);
  const stamp = () => new Date(now()).toISOString();
  const forms = memo({ name: "careers-ai-forms", now, maximum: 200, ttl: 15_000 }), versions = memo({ name: "careers-ai-versions", now, maximum: 200, ttl: 60 * 60_000 });
  const indexes = memo({ name: "careers-ai-rankings", now, maximum: 12, ttl: 10 * 60_000 }), details = memo({ name: "careers-ai-details", now, maximum: 200, ttl: 10 * 60_000 }), jobs = memo({ name: "careers-ai-jobs", now, maximum: 200, ttl: 10 * 60_000 });
  const badges = memo({ name: "careers-ai-badges", now, maximum: 4000, ttl: 10 * 60_000 });
  const claimedRuns = new Map();
  let notify = () => {};
  async function freshForm(id) {
    const snapshot = await formRef(id).get();
    if (!snapshot.exists) fail("Opening not found.", 404);
    return snapshot.data();
  }
  const readForm = id => forms.get(identifier(id), () => freshForm(id));
  const version = id => readVersion ? readVersion(id) : versions.get(identifier(id), async () => (await db.doc(`careerFormVersions/${identifier(id)}`).get()).data());
  async function readJob(id) {
    // Only terminal summaries are retained; progress/cancellation stays live.
    return jobs.get(identifier(id), async () => {
      const data = (await runRef(id).get()).data();
      if (data && activeStates.includes(data.state)) queueMicrotask(() => jobs.invalidate(id));
      return data;
    });
  }
  async function completedIndex(completed) {
    const entries = await indexes.get(completed.id, async () => {
      const scores = new Map();
      let cursor;
      while (true) {
        let query = db.collection(`careerAiRuns/${completed.id}/careerAiScores`).orderBy("__name__", "asc").select("qualityScore", "relativeScore", "rank", "poolSize", "submissionRevision").limit(500);
        if (cursor) query = query.startAfter(cursor);
        const result = await query.get();
        for (const doc of result.docs) scores.set(doc.id, doc.data());
        if (scores.size > MAX_APPLICANTS) fail("This ranking exceeds the supported application limit.");
        if (result.docs.length < 500) break;
        cursor = result.docs.at(-1).ref.path;
      }
      return [...scores];
    });
    return new Map(entries);
  }
  async function rowBadge(completed, id) {
    const cachedIndex = indexes.peek(completed.id);
    if (cachedIndex) return new Map(cachedIndex).get(id);
    const key = `${completed.id}/${id}`;
    return badges.get(key, async () => {
      const result = details.peek(key) ?? (await scoreRef(completed.id, id).get()).data();
      if (!result) return null;
      return Object.fromEntries(["qualityScore", "relativeScore", "rank", "poolSize", "submissionRevision"].filter(field => result[field] !== undefined).map(field => [field, result[field]]));
    });
  }
  async function scan(query, fields, maximum = MAX_APPLICANTS) {
    const base = query.orderBy("createdAt", "desc").orderBy("__name__", "desc").select(...fields), items = [];
    let cursor;
    while (true) {
      const result = await (cursor ? base.startAfter(...cursor) : base).limit(500).get();
      items.push(...result.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      if (items.length > maximum) fail(`This review supports up to ${maximum.toLocaleString()} applications per opening.`);
      if (result.docs.length < 500) return items;
      const last = result.docs.at(-1); cursor = [last.data().createdAt, last.ref.path];
    }
  }
  async function checkOwner(tx, reference, owner) {
    const run = (await tx.get(reference)).data();
    if (!run || run.state !== "running" || run.owner !== owner || run.leaseUntil <= now()) throw Object.assign(new Error("AI review lease changed."), { code: "AI_LEASE_LOST" });
    const form = (await tx.get(formRef(run.formId))).data();
    if (!form || (form.applicationEditRevision ?? 0) !== (run.applicationEditRevision ?? 0)) fail("An application was resubmitted during this review. No new ranking was applied. Start a fresh review to use the current answers.", 409);
    return run;
  }
  return {
    configuration() { return { configured: provider.enabled, model: AI_MODEL, maxApplicants: MAX_APPLICANTS }; },
    invalidateForm(id) { forms.invalidate(identifier(id)); },
    setNotifier(callback) { notify = callback; },
    async draftCriteria(user, input, { signal } = {}) {
      requireAdmin(user);
      const settings = normalizeAiReview(input?.settings);
      if (!settings.brief) fail("Describe what makes a good application before drafting a scoring guide.");
      const form = normalizeForm(input.form);
      const generated = await provider.draftCriteria({ brief: settings.brief, examples: settings.examples, opening: { title: form.title, description: form.description, category: form.category }, questions: form.questions.map(q => ({ question: q.label, help: q.help, type: q.type })) }, { signal });
      if (!Array.isArray(generated.value?.criteria)) fail("Luna did not return a scoring guide. Try again.");
      return normalizeAiReview({ ...settings, criteria: generated.value.criteria.map(c => ({ ...c, id: randomUUID() })) }, true);
    },
    async start(formId, user, input) {
      requireAdmin(user);
      if (!provider.enabled) fail("Luna is not connected. Configure the server's OPENAI_API_KEY first.", 503);
      const form = await freshForm(formId), settings = normalizeAiReview(form.aiReview, true);
      if (input?.revision !== (form.aiRevision ?? 0)) fail("The scoring guide changed. Reload before starting a review.", 409);
      const createdAt = stamp();
      const candidates = await scan(db.collection("careerApplications").where("formId", "==", formId).where("createdAt", "<=", createdAt), ["versionId", "status", "createdAt"]);
      const members = candidates.filter(item => item.status !== "withdrawn").map(item => item.id);
      if (!members.length) fail("This opening has no non-withdrawn applications to review.");
      const id = randomUUID();
      await db.runTransaction(async tx => {
        const latest = (await tx.get(formRef(formId))).data();
        const previous = latest?.aiActiveRunId ? (await tx.get(runRef(latest.aiActiveRunId))).data() : null;
        if (!latest || (latest.aiRevision ?? 0) !== (form.aiRevision ?? 0)) fail("The scoring guide changed. Reload before starting a review.", 409);
        if ((latest.applicationEditRevision ?? 0) !== (form.applicationEditRevision ?? 0)) fail("Applications changed. Reload before starting a review.", 409);
        if (previous && activeStates.includes(previous.state)) fail("A review is already queued or running for this opening.", 409);
        tx.set(runRef(id), { formId, settings, members, processed: 0, state: "queued", createdAt, criteriaRevision: form.aiRevision ?? 0, applicationEditRevision: form.applicationEditRevision ?? 0,
          model: AI_MODEL, promptVersion: AI_PROMPT_VERSION, requestedBy: { id: user.id, displayName: user.displayName ?? user.username ?? "Administrator" },
          owner: null, leaseUntil: 0, activeItem: null, previousCompletedRun: latest.aiCompletedRun ?? null, usage: { inputTokens: 0, outputTokens: 0 } });
        tx.update(formRef(formId), { aiActiveRunId: id, aiRunIds: [id, ...(latest.aiRunIds ?? (latest.aiActiveRunId ? [latest.aiActiveRunId] : []))].slice(0, 10) });
      });
      forms.invalidate(formId);
      notify();
      return { id, state: "queued", total: members.length };
    },
    async overview(formId, user, { history = false } = {}) {
      requireAdmin(user);
      const form = await readForm(formId);
      const historyIds = form.aiRunIds ?? (form.aiActiveRunId ? [form.aiActiveRunId] : []);
      const selected = historyIds.slice(0, history ? 10 : 1);
      const runs = await Promise.all(selected.map(async id => summary(id, await readJob(id))));
      return { ...this.configuration(), criteriaRevision: form.aiRevision ?? 0, hasCriteria: Boolean(form.aiReview?.brief && form.aiReview?.criteria.length),
        runs: runs.filter(Boolean), hasHistory: historyIds.length > 1, completedRun: form.aiCompletedRun ?? null };
    },
    async runStatus(formId, runId, user) {
      requireAdmin(user);
      const run = await readJob(runId);
      if (!run || run.formId !== identifier(formId)) fail("Review run not found.", 404);
      return { run: summary(runId, run), completedRun: run.state === "completed" ? { id: runId, total: run.members.length, completedAt: run.completedAt, criteriaRevision: run.criteriaRevision } : run.previousCompletedRun ?? null };
    },
    async cancel(formId, runId, user) {
      requireAdmin(user);
      await db.runTransaction(async tx => {
        const reference = runRef(runId), run = (await tx.get(reference)).data();
        if (!run || run.formId !== identifier(formId)) fail("Review run not found.", 404);
        if (!activeStates.includes(run.state)) fail("This review has already finished.", 409);
        tx.update(reference, { state: "cancelled", activeItem: null, leaseUntil: 0, completedAt: stamp(), error: "Cancelled by an administrator. An in-flight request may still be billed." });
      });
      jobs.invalidate(runId);
      forms.invalidate(formId);
      return { cancelled: true };
    },
    async decorate(items, { full = false } = {}) {
      const openingForms = new Map();
      await Promise.all([...new Set(items.map(item => item.formId))].map(async id => openingForms.set(id, await readForm(id))));
      return Promise.all(items.map(async item => {
        const form = openingForms.get(item.formId), completed = form.aiCompletedRun;
        if (!completed || item.status === "withdrawn") return { ...item, aiReview: null };
        const result = full ? await details.get(`${completed.id}/${item.id}`, async () => (await scoreRef(completed.id, item.id).get()).data()) : await rowBadge(completed, item.id);
        const current = result && (result.submissionRevision ?? 1) === (item.submissionRevision ?? 1);
        return { ...item, aiReview: current ? { ...result, runId: completed.id, reviewedAt: completed.completedAt, criteriaChanged: completed.criteriaRevision !== (form.aiRevision ?? 0) } : null };
      }));
    },
    async scoreIndex(formId) {
      const form = await readForm(formId);
      return { runId: form.aiCompletedRun?.id ?? null, scores: form.aiCompletedRun ? await completedIndex(form.aiCompletedRun) : new Map() };
    },
    async workNext({ owner, signal } = {}) {
      if (!provider.enabled || signal?.aborted) return false;
      let candidate = claimedRuns.has(owner) ? { id: claimedRuns.get(owner) } : null;
      if (!candidate) {
        const available = await db.collection("careerAiRuns").where("state", "in", activeStates).limit(100).get();
        candidate = available.docs.filter(doc => { const run = doc.data(); return run.state === "queued" || run.owner === owner || run.leaseUntil <= now(); })
          .sort((a, b) => a.data().createdAt.localeCompare(b.data().createdAt))[0];
      }
      if (!candidate) return false;
      const reference = runRef(candidate.id);
      const claimed = await db.runTransaction(async tx => {
        const run = (await tx.get(reference)).data();
        if (!run || !activeStates.includes(run.state) || (run.state === "running" && run.owner !== owner && run.leaseUntil > now())) return null;
        if (run.activeItem) {
          // A crash after sending a request can leave its billing outcome unknown.
          // Do not silently issue the same paid request a second time.
          tx.update(reference, { state: "failed", activeItem: null, completedAt: stamp(), error: "The previous request was interrupted. No new ranking was applied. Start a fresh review when ready." });
          return null;
        }
        tx.update(reference, { state: "running", owner, leaseUntil: now() + LEASE_MS });
        return run;
      });
      if (!claimed) { claimedRuns.delete(owner); return true; }
      claimedRuns.set(owner, candidate.id);
      try {
        const applicationId = claimed.members[claimed.processed];
        if (applicationId) {
          if (signal?.aborted) return false;
          const application = (await db.doc(`careerApplications/${applicationId}`).get()).data();
          if (!application || application.status === "withdrawn" || application.formId !== claimed.formId) throw new Error("The applicant pool changed during the review. Start a fresh review to use the current applications.");
          const form = await version(application.versionId);
          if (!form || form.formId !== claimed.formId) throw new Error("The original form version could not be loaded. No new ranking was applied.");
          const input = assessmentInput(form, application, claimed.settings), imageInputs = [];
          for (const q of form.questions) if (q.image) imageInputs.push({ questionId: q.id, url: await images.image(q.image.id, { role: "dev" }) });
          await db.runTransaction(async tx => { await checkOwner(tx, reference, owner); tx.update(reference, { activeItem: applicationId, leaseUntil: now() + LEASE_MS }); });
          const response = await provider.assess(input, { images: imageInputs, signal });
          const assessment = normalizeAssessment(response.value, claimed.settings, form, application);
          await db.runTransaction(async tx => {
            const run = await checkOwner(tx, reference, owner);
            tx.set(scoreRef(candidate.id, applicationId), { ...assessment, inputFingerprint: aiFingerprint(input), criteriaRevision: run.criteriaRevision, submissionRevision: application.submissionRevision ?? 1 });
            tx.update(reference, { processed: run.processed + 1, activeItem: null, leaseUntil: now() + LEASE_MS,
              usage: { inputTokens: run.usage.inputTokens + (response.usage?.inputTokens ?? 0), outputTokens: run.usage.outputTokens + (response.usage?.outputTokens ?? 0) } });
          });
          jobs.invalidate(candidate.id);
          return true;
        }
        const results = [];
        let resultCursor;
        while (true) {
          let query = db.collection(`careerAiRuns/${candidate.id}/careerAiScores`).orderBy("__name__", "asc").limit(500);
          if (resultCursor) query = query.startAfter(resultCursor);
          const batch = await query.get();
          results.push(...batch.docs.map(doc => ({ ...doc.data(), id: doc.id })));
          await db.runTransaction(async tx => { await checkOwner(tx, reference, owner); tx.update(reference, { leaseUntil: now() + LEASE_MS }); });
          if (batch.docs.length < 500) break;
          resultCursor = batch.docs.at(-1).ref.path;
        }
        const savedIds = new Set(results.map(item => item.id));
        if (results.length !== claimed.members.length || claimed.members.some(id => !savedIds.has(id))) throw new Error("A saved assessment is missing. No new ranking was applied.");
        const ranked = rankAssessments(results);
        for (let offset = 0; offset < ranked.length; offset += 100) {
          await db.runTransaction(async tx => {
            await checkOwner(tx, reference, owner);
            for (const result of ranked.slice(offset, offset + 100)) { const { id, ...data } = result; tx.set(scoreRef(candidate.id, id), data); }
            tx.update(reference, { leaseUntil: now() + LEASE_MS });
          });
        }
        await db.runTransaction(async tx => {
          const run = await checkOwner(tx, reference, owner), current = (await tx.get(formRef(run.formId))).data();
          if (!current || current.aiActiveRunId !== candidate.id) throw new Error("This review was superseded. No new ranking was applied.");
          const completedAt = stamp();
          tx.update(reference, { state: "completed", completedAt, leaseUntil: 0 });
          tx.update(formRef(run.formId), { aiCompletedRun: { id: candidate.id, criteriaRevision: run.criteriaRevision, completedAt, total: run.members.length } });
        });
        await indexes.set(candidate.id, ranked.map(({ id, qualityScore, relativeScore, rank, poolSize, submissionRevision }) => [id, { qualityScore, relativeScore, rank, poolSize, submissionRevision }]));
        forms.invalidate(claimed.formId);
        jobs.invalidate(candidate.id);
        claimedRuns.delete(owner);
        return true;
      } catch (error) {
        claimedRuns.delete(owner);
        jobs.invalidate(candidate.id);
        if (error.code === "AI_LEASE_LOST") return true;
        await db.runTransaction(async tx => {
          const run = (await tx.get(reference)).data();
          if (!run || run.owner !== owner || run.state !== "running") return;
          const safe = error.status && error.status < 600 ? error.message : "The AI review could not finish. No new ranking was applied. Try a fresh run.";
          tx.update(reference, { state: "failed", activeItem: null, leaseUntil: 0, completedAt: stamp(), error: safe });
        });
        return true;
      }
    },
  };
}
