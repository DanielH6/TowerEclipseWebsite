import test from "node:test";
import assert from "node:assert/strict";
import { createCareersService } from "./careers-service.mjs";
import { createCareerAiProvider } from "./careers-ai-provider.mjs";
import { assessmentInput, normalizeAiReview, rankAssessments, normalizeAssessment } from "./careers-ai-domain.mjs";
import { createMemoryDb } from "./testing/careers-memory-db.mjs";

const admin = { id: "admin", role: "dev", displayName: "Reviewer" };
const settings = { brief: "Reward clear practical reasoning over length.", criteria: [{ id: "reasoning", name: "Reasoning", description: "Assess useful, justified reproduction steps.", weight: 2, low: "Vague", middle: "Usable with gaps", high: "Clear and specific" }, { id: "clarity", name: "Clarity", description: "Assess how actionable the explanation is.", weight: 1, low: "", middle: "", high: "" }], examples: [] };
const draft = { title: "Tester round", category: "Quality assurance", description: "Help test", commitment: "Volunteer", confirmation: "Thanks", closesAt: null, questions: [{ id: "answer", type: "paragraph", label: "How would you reproduce this?", help: "Explain your approach", required: true }] };
async function fixture({ provider: supplied } = {}) {
  const memory = createMemoryDb(), calls = [];
  let time = Date.parse("2026-11-04T00:00:00Z");
  const provider = supplied ?? { enabled: true, draftCriteria: async () => ({ value: { criteria: settings.criteria } }), assess: async input => {
    calls.push(input);
    const score = Number(input.questions[0].answerExcerpts[0].text.match(/\d/)[0]);
    return { value: { summary: "Assessment based on the submitted example.", observations: "", grades: settings.criteria.map(c => ({ criterionId: c.id, score, explanation: "The answer supplies the stated level of detail.", evidence: [input.questions[0].answerExcerpts[0].id] })) }, usage: { inputTokens: 100, outputTokens: 40 } };
  } };
  const service = createCareersService(memory.db, { aiProvider: provider, now: () => time });
  const form = await service.createForm();
  const published = await service.saveForm(form.id, { action: "publish", revision: 1, draft, aiReview: settings });
  const add = (id, score, extra = {}) => memory.documents.set(`careerApplications/${id}`, { formId: form.id, versionId: published.publishedVersion, title: draft.title, category: draft.category, applicantId: id,
    applicant: { discordId: `secret-${id}`, username: id, displayName: `Applicant ${id}`, roblox: { userId: "123", username: `Roblox${id}` } },
    answers: { answer: `I explain ${score} practical steps.` }, status: "submitted", revision: 1, createdAt: new Date(time).toISOString(), updatedAt: new Date(time).toISOString(), feedback: "Previous reviewer feedback", internalNotes: "Private reviewer note", history: [], ...extra });
  return { ...memory, service, form: published, add, calls, advance: ms => { time += ms; } };
}
async function finish(service, max = 100) { for (let n = 0; n < max; n++) if (!await service.ai.workNext({ owner: "worker", signal: new AbortController().signal })) return; throw new Error("Worker did not finish"); }

test("normal curve centres on five, stays bounded, preserves ties and does not invent grades", () => {
  for (const scores of [[], [2], [2, 2], [0, 1, 1, 1, 4], Array.from({ length: 1000 }, (_, i) => i / 100)]) {
    const result = rankAssessments(scores.map((qualityScore, i) => ({ id: String(i), qualityScore })));
    if (!result.length) continue;
    assert.ok(Math.abs(result.reduce((sum, r) => sum + r.relativeScore, 0) / result.length - 5) < 1e-8);
    assert.ok(result.every(r => r.relativeScore >= 0 && r.relativeScore <= 10));
    for (const a of result) for (const b of result.slice(0, 5)) if (a.qualityScore === b.qualityScore) assert.equal(a.relativeScore, b.relativeScore);
  }
});
test("criteria are bounded, weighted server-side, and unknown evidence references are rejected", () => {
  assert.throws(() => normalizeAiReview({ ...settings, criteria: [{ ...settings.criteria[0], weight: 100 }] }));
  assert.throws(() => normalizeAiReview({ ...settings, criteria: [settings.criteria[0], settings.criteria[0]] }));
  assert.throws(() => normalizeAiReview({ brief: "", criteria: [], examples: [] }, true));
  const grades = settings.criteria.map((c, i) => ({ criterionId: c.id, score: i === 0 ? 4 : 1, explanation: "Explanation", evidence: ["a1"] }));
  const result = normalizeAssessment({ grades, summary: "Summary", observations: "" }, settings, draft, { answers: { answer: "practical approach" } });
  assert.equal(result.qualityScore, 6);
  assert.deepEqual(result.grades[0].evidence, [{ questionId: "answer", question: draft.questions[0].label, quote: "practical approach" }]);
  for (const invalid of ["a999", "answer", "invented quotation", { questionId: "answer", quote: "practical approach" }]) {
    grades[0].evidence = [invalid];
    assert.throws(() => normalizeAssessment({ grades, summary: "Summary" }, settings, draft, { answers: { answer: "practical approach" } }), /unknown answer reference/);
  }
});
test("evidence uses the original answer text across punctuation, multiline, lists, scales and missing answers", () => {
  const questions = [
    { id: "uuid-written", type: "paragraph", label: "Written question" },
    { id: "uuid-choice", type: "choice", label: "Pick one", options: ["Tester", "Builder"] },
    { id: "uuid-checks", type: "checkboxes", label: "Pick several", options: ["Logs", "Video", "Other"] },
    { id: "uuid-ranking", type: "ranking", label: "Preferences", options: ["UI", "Maps"] },
    { id: "uuid-scale", type: "scale", label: "Rate this", min: 0, max: 10 },
    { id: "uuid-missing", type: "short", label: "Unanswered optional question" },
  ];
  const form = { ...draft, questions }, application = { answers: {
    "uuid-written": "I’d check ‘logs’—first.\r\nThen\t reproduce  it. Café 👩🏽‍💻",
    "uuid-choice": "Tester", "uuid-checks": ["Video", "Logs"], "uuid-ranking": ["Maps", "UI"], "uuid-scale": 0,
  } };
  const input = assessmentInput(form, application, settings);
  assert.deepEqual(input.questions.map(q => q.answerExcerpts.map(e => e.text)), [
    [application.answers["uuid-written"]], ["Tester"], ["Video", "Logs"], ["Maps", "UI"], ["0"], [],
  ]);
  const ids = input.questions.flatMap(q => q.answerExcerpts.map(e => e.id));
  assert.equal(new Set(ids).size, ids.length);
  for (const q of input.questions) for (const excerpt of q.answerExcerpts) {
    const grades = settings.criteria.map(c => ({ criterionId: c.id, score: 3, explanation: "Explanation", evidence: [excerpt.id] }));
    const result = normalizeAssessment({ grades, summary: "Summary" }, settings, form, application);
    assert.deepEqual(result.grades[0].evidence, [{ questionId: q.id, question: q.question, quote: excerpt.text }]);
  }
  const grades = settings.criteria.map(c => ({ criterionId: c.id, score: 0, explanation: "Missing relevant evidence.", evidence: [] }));
  assert.deepEqual(normalizeAssessment({ grades, summary: "Summary" }, settings, form, application).grades[0].evidence, []);
});
test("long answer passages stay bounded and retain all original non-whitespace including Unicode and code", () => {
  const answer = `${"First I'd reproduce the issue.\nThen check ‘logs’ and record steps. ".repeat(30)}${"x".repeat(299)}👩${"y".repeat(900)}`;
  const input = assessmentInput(draft, { answers: { answer } }, settings), excerpts = input.questions[0].answerExcerpts;
  assert.ok(excerpts.length > 10);
  assert.equal(excerpts.map(e => e.text).join("").replace(/\s/g, ""), answer.replace(/\s/g, ""));
  for (const excerpt of excerpts) {
    assert.ok(excerpt.text.length > 0 && excerpt.text.length <= 300);
    assert.ok(answer.includes(excerpt.text));
    assert.equal(excerpt.text.isWellFormed(), true);
  }
});
test("review criteria stay private when drafts are saved, forms published and applications read", async () => {
  const f = await fixture(); f.add("person", 3);
  assert.equal((await f.service.listForms()).items[0].aiReview, undefined);
  assert.equal(f.documents.get(`careerFormVersions/${f.form.publishedVersion}`).aiReview, undefined);
  assert.equal((await f.service.application("person", { id: "person" })).application.aiReview, undefined);
  assert.deepEqual((await f.service.adminForm(f.form.id)).aiReview, settings);
  const saved = await f.service.saveForm(f.form.id, { action: "save", revision: f.form.revision, draft, aiReview: { ...settings, brief: "Updated guidance" } });
  assert.equal(saved.aiRevision, f.form.aiRevision + 1);
  assert.equal(saved.publishedVersion, f.form.publishedVersion, "private criteria do not require public republishing");
});
test("a run evaluates only its frozen form pool and applies all scores atomically", async () => {
  const f = await fixture(); f.add("weak", 1); f.add("strong", 5); f.add("withdrawn", 4, { status: "withdrawn" }); f.add("other", 5, { formId: "different-form" });
  const run = await f.service.ai.start(f.form.id, admin, { revision: f.form.aiRevision });
  await assert.rejects(f.service.ai.start(f.form.id, admin, { revision: f.form.aiRevision }), { status: 409 });
  assert.equal(run.total, 2);
  await f.service.ai.workNext({ owner: "worker" });
  assert.equal((await f.service.application("weak", admin, true)).application.aiReview, null, "partial results are not exposed");
  f.advance(1); f.add("late", 3);
  await finish(f.service);
  assert.equal(f.calls.length, 2);
  assert.ok(f.calls.every(call => !JSON.stringify(call).includes("Private reviewer") && !JSON.stringify(call).includes("Previous reviewer") && !JSON.stringify(call).includes("secret-") && !Object.hasOwn(call, "applicant")));
  const strong = (await f.service.application("strong", admin, true)).application.aiReview;
  assert.equal(strong.rank, 1); assert.equal(strong.qualityScore, 10); assert.equal(strong.poolSize, 2);
  assert.equal((await f.service.application("late", admin, true)).application.aiReview, null);
  assert.equal((await f.service.application("strong", { id: "strong" })).application.aiReview, undefined);
  assert.equal((await f.service.ai.overview(f.form.id, admin)).runs[0].state, "completed");
});
test("run requests are admin-only and stale guide revisions cannot start paid work", async () => {
  const f = await fixture(); f.add("one", 3);
  for (const role of ["member", "qa", "pentester", "leadqa"]) {
    await assert.rejects(f.service.ai.start(f.form.id, { id: role, role }, { revision: f.form.aiRevision }), { status: 403 });
    await assert.rejects(f.service.ai.draftCriteria({ id: role, role }, { form: draft, settings }), { status: 403 });
  }
  await assert.rejects(f.service.ai.start(f.form.id, admin, { revision: 999 }), { status: 409 });
  assert.equal(f.calls.length, 0);
});
test("failed or cancelled runs keep the last completed ranking and never make status decisions", async () => {
  const f = await fixture(); f.add("one", 3); await f.service.ai.start(f.form.id, admin, { revision: f.form.aiRevision }); await finish(f.service);
  const original = (await f.service.application("one", admin, true)).application.aiReview.runId;
  f.advance(1);
  const cancelled = await f.service.ai.start(f.form.id, admin, { revision: f.form.aiRevision });
  await f.service.ai.cancel(f.form.id, cancelled.id, admin); await finish(f.service);
  assert.equal(f.calls.length, 1);
  f.advance(1); f.add("one", 3, { status: "withdrawn" }); f.add("two", 4);
  await f.service.ai.start(f.form.id, admin, { revision: f.form.aiRevision });
  f.documents.get("careerApplications/two").status = "withdrawn";
  await finish(f.service);
  assert.equal(f.documents.get(`careerForms/${f.form.id}`).aiCompletedRun.id, original);
  assert.equal(f.documents.get("careerApplications/two").status, "withdrawn");
});
test("a lost request is marked interrupted without reissuing a potentially billed call", async () => {
  const f = await fixture(); f.add("one", 3);
  const run = await f.service.ai.start(f.form.id, admin, { revision: f.form.aiRevision });
  Object.assign(f.documents.get(`careerAiRuns/${run.id}`), { state: "running", owner: "old-process", activeItem: "one", leaseUntil: 0 });
  await finish(f.service);
  assert.equal(f.calls.length, 0);
  assert.equal(f.documents.get(`careerAiRuns/${run.id}`).state, "failed");
});
test("ranked sorting covers all pages and search/status filters do not recurve the pool", async () => {
  const f = await fixture();
  for (let i = 0; i < 47; i++) f.add(`person${String(i).padStart(2, "0")}`, i % 6);
  await f.service.ai.start(f.form.id, admin, { revision: f.form.aiRevision }); await finish(f.service);
  const first = await f.service.listApplications(admin, { formId: f.form.id, sort: "ai_rank" }, true);
  const second = await f.service.listApplications(admin, { formId: f.form.id, sort: "ai_rank", cursor: first.nextCursor }, true);
  const third = await f.service.listApplications(admin, { formId: f.form.id, sort: "ai_rank", cursor: second.nextCursor }, true);
  assert.deepEqual([first.items.length, second.items.length, third.items.length], [20, 20, 7]);
  const all = [...first.items, ...second.items, ...third.items];
  assert.equal(new Set(all.map(item => item.id)).size, 47);
  assert.ok(all.every((item, i) => i === 0 || item.aiReview.relativeScore <= all[i - 1].aiReview.relativeScore));
  const filtered = await f.service.listApplications(admin, { formId: f.form.id, search: "ROBLOXperson05" }, true);
  assert.equal(filtered.items.length, 1); assert.equal(filtered.items[0].aiReview.poolSize, 47);
  await assert.rejects(f.service.listApplications(admin, { formId: f.form.id, sort: "quality", cursor: first.nextCursor }, true), { status: 409 });
});
test("resubmission hides previous assessments and ranking until a fresh review uses the edited answers", async () => {
  const f = await fixture(); f.add("strong", 5); f.add("weak", 3);
  const first = await f.service.ai.start(f.form.id, admin, { revision: f.form.aiRevision }); await finish(f.service);
  // Completed reviews saved before submission revisions were introduced remain readable.
  delete f.documents.get(`careerAiRuns/${first.id}/careerAiScores/strong`).submissionRevision;
  assert.equal((await f.service.application("strong", admin, true)).application.aiReview.qualityScore, 10);
  await f.service.resubmit("strong", { id: "strong" }, { revision: 1, consent: true, answers: { answer: "I explain 1 practical step." } });
  assert.equal((await f.service.application("strong", admin, true)).application.aiReview, null);
  const ranked = await f.service.listApplications(admin, { formId: f.form.id, sort: "ai_rank" }, true);
  assert.deepEqual(ranked.items.map(item => item.id), ["weak", "strong"]);
  assert.equal(ranked.items[1].aiReview, null);
  assert.equal((await f.service.listApplications(admin, {}, true)).items.find(item => item.id === "strong").aiReview, null);
  const next = await f.service.ai.start(f.form.id, admin, { revision: f.form.aiRevision }); await finish(f.service);
  const reviewed = (await f.service.application("strong", admin, true)).application.aiReview;
  assert.equal(reviewed.runId, next.id); assert.equal(reviewed.qualityScore, 2); assert.equal(reviewed.submissionRevision, 2);
  assert.ok(f.calls.some(call => call.questions[0].answerExcerpts[0].text === "I explain 1 practical step."));
});
test("an answer resubmitted during an AI request cannot receive the in-flight assessment", async () => {
  let release, started;
  const waiting = new Promise(resolve => { release = resolve; }), assessing = new Promise(resolve => { started = resolve; });
  const f = await fixture({ provider: { enabled: true, assess: async () => {
    started(); await waiting;
    return { value: { summary: "Assessment", observations: "", grades: settings.criteria.map(c => ({ criterionId: c.id, score: 5, explanation: "Explanation", evidence: [] })) } };
  } } });
  f.add("one", 5);
  const run = await f.service.ai.start(f.form.id, admin, { revision: f.form.aiRevision });
  const working = f.service.ai.workNext({ owner: "worker" });
  await assessing;
  try { await f.service.resubmit("one", { id: "one" }, { revision: 1, consent: true, answers: { answer: "I explain 1 revised step." } }); }
  finally { release(); }
  await working;
  assert.equal(f.documents.get(`careerAiRuns/${run.id}`).state, "failed");
  assert.match(f.documents.get(`careerAiRuns/${run.id}`).error, /resubmitted/);
  assert.equal(f.documents.has(`careerAiRuns/${run.id}/careerAiScores/one`), false);
  assert.equal((await f.service.application("one", admin, true)).application.aiReview, null);
});
test("resubmission after assessment and before publication prevents publishing the changed pool", async () => {
  const f = await fixture(); f.add("one", 5);
  const run = await f.service.ai.start(f.form.id, admin, { revision: f.form.aiRevision });
  await f.service.ai.workNext({ owner: "worker" });
  assert.equal(f.documents.get(`careerAiRuns/${run.id}`).processed, 1);
  await f.service.resubmit("one", { id: "one" }, { revision: 1, consent: true, answers: { answer: "I explain 1 revised step." } });
  await finish(f.service);
  assert.equal(f.documents.get(`careerAiRuns/${run.id}`).state, "failed");
  assert.equal(f.documents.get(`careerForms/${f.form.id}`).aiCompletedRun, undefined);
  assert.equal(f.calls.length, 1, "changing a pool never silently starts another paid request");
});
test("Luna transport uses structured Responses, private storage settings, bounded output and safe errors", async () => {
  let captured, organizationHeader;
  const provider = createCareerAiProvider({ apiKey: "private-test-key", organizationId: "org-test", fetch: async (url, options) => {
    organizationHeader = options.headers["OpenAI-Organization"];
    captured = { url, ...JSON.parse(options.body) };
    return new Response(JSON.stringify({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ summary: "Résumé", grades: [] }) }] }], usage: { input_tokens: 15, output_tokens: 10 } }));
  } });
  const input = assessmentInput(draft, { answers: { answer: "I’d check logs.\nThen reproduce." } }, settings);
  assert.equal((await provider.assess(input)).value.summary, "Résumé");
  assert.equal(organizationHeader, "org-test"); assert.equal(captured.model, "gpt-6-luna"); assert.equal(captured.store, false); assert.equal(captured.text.format.strict, true);
  const gradeSchema = captured.text.format.schema.properties.grades;
  assert.deepEqual(gradeSchema.items.properties.criterionId.enum, settings.criteria.map(c => c.id));
  assert.deepEqual(gradeSchema.items.properties.evidence.items.enum, ["a1"]);
  assert.equal(gradeSchema.minItems, settings.criteria.length);
  assert.equal(gradeSchema.maxItems, settings.criteria.length);
  assert.deepEqual(JSON.parse(captured.input[0].content[0].text).questions[0].answerExcerpts, [{ id: "a1", text: "I’d check logs.\nThen reproduce." }]);
  assert.ok(captured.instructions.includes("never question IDs, quoted text, rubric wording or sample answers"));
  await provider.assess(assessmentInput(draft, { answers: {} }, settings));
  assert.equal(captured.text.format.schema.properties.grades.items.properties.evidence.maxItems, 0);
  assert.equal(captured.text.format.schema.properties.grades.items.properties.evidence.items.enum, undefined);
  assert.equal(JSON.stringify(captured).includes("private-test-key"), false);
  const broken = createCareerAiProvider({ apiKey: "private-test-key", fetch: async () => new Response("secret provider diagnostic", { status: 429 }) });
  await assert.rejects(broken.assess(input), error => error.status === 503 && !error.message.includes("secret provider"));
});

test("concurrent workers cannot assess the same applicant while a lease is active", async () => {
  let release, calls = 0;
  const wait = new Promise(resolve => { release = resolve; });
  const f = await fixture({ provider: { enabled: true, assess: async input => {
    calls++; await wait;
    return { value: { summary: "Summary", observations: "", grades: settings.criteria.map(c => ({ criterionId: c.id, score: 3, explanation: "Explanation", evidence: [] })) } };
  } } });
  f.add("one", 3);
  const requested = await Promise.allSettled([f.service.ai.start(f.form.id, admin, { revision: f.form.aiRevision }), f.service.ai.start(f.form.id, admin, { revision: f.form.aiRevision })]);
  assert.equal(requested.filter(result => result.status === "fulfilled").length, 1);
  const first = f.service.ai.workNext({ owner: "first" });
  while (calls === 0) await new Promise(resolve => setImmediate(resolve));
  assert.equal(await f.service.ai.workNext({ owner: "second" }), false);
  release(); await first;
  assert.equal(calls, 1);
});

test("a claimed run avoids queue rediscovery per applicant and reuses its immutable form version", async () => {
  const f = await fixture(), reads = [], originalDoc = f.db.doc;
  f.db.doc = path => { const reference = originalDoc(path); return { ...reference, get: async () => { reads.push(path); return reference.get(); } }; };
  for (let i = 0; i < 15; i++) f.add(`person${i}`, i % 6);
  await f.service.ai.start(f.form.id, admin, { revision: f.form.aiRevision });
  f.queries.length = 0; reads.length = 0;
  await finish(f.service);
  assert.equal(f.calls.length, 15);
  assert.equal(f.queries.filter(query => query.collection === "careerAiRuns").length, 2, "one discovery and one durable empty fallback after completion");
  assert.equal(reads.filter(path => path === `careerFormVersions/${f.form.publishedVersion}`).length, 1, "one immutable version read for the cohort");
});
test("completed row badges reuse a minimal index while full grades load only on the detail request", async () => {
  const f = await fixture(), reads = [], originalDoc = f.db.doc;
  f.db.doc = path => { const reference = originalDoc(path); return { ...reference, get: async () => { reads.push(path); return reference.get(); } }; };
  for (let i = 0; i < 8; i++) f.add(`person${i}`, i % 6);
  await f.service.ai.start(f.form.id, admin, { revision: f.form.aiRevision }); await finish(f.service);
  f.queries.length = 0; reads.length = 0;
  const rows = (await f.service.listApplications(admin, {}, true)).items;
  assert.ok(rows.every(row => row.aiReview && !Object.hasOwn(row.aiReview, "grades") && !Object.hasOwn(row.aiReview, "summary")));
  await f.service.ai.scoreIndex(f.form.id); await f.service.ai.scoreIndex(f.form.id);
  assert.equal(reads.filter(path => path.includes("/careerAiScores/")).length, 0);
  assert.equal(f.queries.filter(query => query.collection.includes("careerAiScores")).length, 0, "worker seeded immutable minimal rows");
  const first = await f.service.application("person1", admin, true), second = await f.service.application("person1", admin, true);
  assert.equal(first.application.aiReview.grades.length, settings.criteria.length);
  assert.deepEqual(second.application.aiReview, first.application.aiReview);
  assert.equal(reads.filter(path => path.endsWith("/careerAiScores/person1")).length, 1, "full completed detail is cached independently");
});
test("active status reads one live job, terminal status is cached, and history is explicitly expanded", async () => {
  const f = await fixture(), reads = [], originalDoc = f.db.doc;
  f.db.doc = path => { const reference = originalDoc(path); return { ...reference, get: async () => { reads.push(path); return reference.get(); } }; };
  f.add("one", 3);
  const run = await f.service.ai.start(f.form.id, admin, { revision: f.form.aiRevision });
  reads.length = 0;
  await f.service.ai.runStatus(f.form.id, run.id, admin); await f.service.ai.runStatus(f.form.id, run.id, admin);
  assert.deepEqual(reads, [`careerAiRuns/${run.id}`, `careerAiRuns/${run.id}`], "progress polling does not read forms or historical jobs");
  await assert.rejects(f.service.ai.runStatus("other-form", run.id, admin), { status: 404 });
  await assert.rejects(f.service.ai.runStatus(f.form.id, run.id, { id: "lead", role: "leadqa" }), { status: 403 });
  await finish(f.service);
  reads.length = 0;
  const completed = await f.service.ai.runStatus(f.form.id, run.id, admin); await f.service.ai.runStatus(f.form.id, run.id, admin);
  assert.equal(completed.completedRun.id, run.id);
  assert.equal(reads.length, 1);
  f.advance(1);
  const next = await f.service.ai.start(f.form.id, admin, { revision: f.form.aiRevision });
  const current = await f.service.ai.overview(f.form.id, admin);
  assert.equal(current.runs.length, 1); assert.equal(current.runs[0].id, next.id); assert.equal(current.hasHistory, true);
  assert.equal((await f.service.ai.overview(f.form.id, admin, { history: true })).runs.length, 2);
});
test("a cold ordinary list reads badges only for its page rather than scanning the entire completed ranking", async () => {
  const f = await fixture(), reads = [], originalDoc = f.db.doc;
  f.db.doc = path => { const reference = originalDoc(path); return { ...reference, get: async () => { reads.push(path); return reference.get(); } }; };
  for (let i = 0; i < 35; i++) f.add(`person${String(i).padStart(2, "0")}`, i % 6);
  await f.service.ai.start(f.form.id, admin, { revision: f.form.aiRevision }); await finish(f.service);
  const restarted = createCareersService(f.db, { aiProvider: { enabled: false } });
  reads.length = 0; f.queries.length = 0;
  const first = await restarted.listApplications(admin, {}, true);
  assert.equal(first.items.length, 20);
  assert.equal(reads.filter(path => path.includes("/careerAiScores/")).length, 20);
  assert.equal(f.queries.filter(query => query.collection.includes("careerAiScores")).length, 0);
  assert.ok(first.items.every(item => item.aiReview && !Object.hasOwn(item.aiReview, "grades")));
  await restarted.listApplications(admin, {}, true);
  assert.equal(reads.filter(path => path.includes("/careerAiScores/")).length, 20, "the same visible badges are reused");
});
