import test from "node:test";
import assert from "node:assert/strict";
import { validateAnswers } from "./careers-domain.mjs";
import { createCareersService } from "./careers-service.mjs";
import { createMemoryDb } from "./testing/careers-memory-db.mjs";

const user = { id: "applicant", username: "Applicant", displayName: "Applicant" };
const other = { id: "other", username: "Other", displayName: "Other" };
const admin = { id: "admin", role: "dev", displayName: "Reviewer" };
const draft = { title: "Tester", category: "Quality assurance", description: "Join the team", commitment: "Volunteer", confirmation: "Thank you", closesAt: null, questions: [
  { id: "short", type: "short", label: "Time zone", required: true },
  { id: "essay", type: "paragraph", label: "Experience", required: true },
  { id: "choice", type: "choice", label: "Availability", required: true, options: ["Morning", "Evening"] },
  { id: "checks", type: "checkboxes", label: "Devices", required: true, options: ["PC", "Mobile"] },
  { id: "rank", type: "ranking", label: "Preferences", required: true, options: ["Combat", "UI", "Maps"] },
  { id: "scale", type: "scale", label: "Confidence", required: true, min: 0, max: 5 },
] };
const answers = { short: "Sydney", essay: "I document reproduction steps.", choice: "Morning", checks: ["PC"], rank: ["UI", "Combat", "Maps"], scale: 0 };
async function fixture() {
  const memory = createMemoryDb();
  for (const [person, roblox] of [[user, "100"], [other, "200"]]) {
    memory.documents.set(`websiteAccounts/${person.id}`, { roblox: { userId: roblox, username: person.username, verifiedAt: "2026-11-07T00:00:00Z" } });
    memory.documents.set(`websiteRobloxLinks/${roblox}`, { discordId: person.id });
  }
  let time = Date.parse("2026-11-07T00:00:00Z"), aiCalls = 0;
  const service = createCareersService(memory.db, { now: () => time, aiProvider: { enabled: true, assess: async () => { aiCalls++; throw new Error("Drafts must not be assessed"); } } });
  const created = await service.createForm();
  const form = await service.saveForm(created.id, { action: "publish", revision: 1, draft, aiReview: { brief: "Judge practical reasoning", criteria: [{ id: "reasoning", name: "Reasoning", description: "Useful practical steps", weight: 1, low: "", middle: "", high: "" }], examples: [] } });
  const save = (changes = {}, applicant = user) => service.saveApplicationDraft(form.id, applicant, { versionId: form.publishedVersion, revision: null, answers: {}, ...changes });
  const submit = (changes = {}) => service.submit(form.id, user, { versionId: form.publishedVersion, consent: true, answers, ...changes });
  return { ...memory, service, form, save, submit, advance: ms => { time += ms; }, aiCalls: () => aiCalls };
}

test("partial drafts accept missing required answers, exact unfinished text, partial ranking and all question types", () => {
  const partial = { short: "  Australia/", essay: "First idea.\n  Next step ", choice: "Morning", checks: ["PC"], rank: ["Maps"], scale: 0 };
  assert.deepEqual(validateAnswers(draft, partial, { partial: true }), partial);
  assert.deepEqual(validateAnswers(draft, {}, { partial: true }), {});
  assert.deepEqual(validateAnswers(draft, { short: "", essay: "  ", choice: "", checks: [], rank: [], scale: "" }, { partial: true }), { essay: "  " });
  assert.throws(() => validateAnswers(draft, partial), /each option exactly once/);
  assert.throws(() => validateAnswers(draft, {}), /Please answer/);
});
for (const [label, invalid] of Object.entries({ "array text": { short: [] }, "non-text paragraph": { essay: 10 }, "array choice": { choice: [] }, "unlisted choice": { choice: "Night" }, "string checks": { checks: "" }, "duplicate ranking": { rank: ["UI", "UI"] }, "unlisted ranking": { rank: ["Other"] }, "fractional scale": { scale: 0.5 }, "outside scale": { scale: 6 }, "unknown question": { injected: "answer" }, "long short": { short: "x".repeat(501) } })) {
  test(`partial draft rejects ${label}`, () => assert.throws(() => validateAnswers(draft, invalid, { partial: true })));
}
test("partial drafts retain the same UTF-8 byte budget as submissions", () => {
  const form = { questions: Array.from({ length: 10 }, (_, i) => ({ id: `q${i}`, type: "paragraph", label: "Essay", required: true })) };
  assert.throws(() => validateAnswers(form, Object.fromEntries(form.questions.map(q => [q.id, "界".repeat(2500)])), { partial: true }), /64 KB/);
});
test("explicit drafts are private account-bound records outside submitted queues, counts and AI", async () => {
  const f = await fixture(), before = f.writes();
  const saved = await f.save({ answers: { essay: "Only my private draft" }, applicantId: "other", status: "submitted", internalNotes: "ignored" });
  assert.equal(saved.revision, 1);
  assert.equal(saved.applicationRevision, null);
  assert.equal(f.writes() - before, 1);
  assert.deepEqual((await f.service.formForApplicant(f.form.id, user)).draft, saved);
  assert.equal((await f.service.formForApplicant(f.form.id, other)).draft, null);
  assert.equal((await f.service.formForApplicant(f.form.id, user)).existingApplicationId, null);
  assert.equal((await f.service.listApplications(user)).items.length, 0);
  assert.equal((await f.service.listApplications(admin, {}, true)).items.length, 0);
  assert.equal((await f.service.applicationStats(admin)).applications, 0);
  await assert.rejects(f.service.ai.start(f.form.id, admin, { revision: f.form.aiRevision }), /no non-withdrawn applications/);
  assert.equal(f.aiCalls(), 0);
  const records = [...f.documents].filter(([path]) => path.startsWith("careerApplicationDrafts/"));
  assert.equal(records.length, 1);
  assert.equal(records[0][1].applicantId, user.id);
  assert.equal(records[0][1].internalNotes, undefined);
  await f.save({ answers: { essay: "Other person's draft" } }, other);
  assert.equal((await f.service.formForApplicant(f.form.id, user)).draft.answers.essay, "Only my private draft");
});
test("draft saves require sign-in, current versions and optimistic revisions; identical saves do not write", async () => {
  const f = await fixture();
  await assert.rejects(f.save({}, null), { status: 401 });
  await assert.rejects(f.save({ versionId: "old-version" }), { status: 409 });
  await assert.rejects(f.save({ revision: 2 }), { status: 409 });
  const results = await Promise.allSettled([f.save({ answers: { essay: "Tab A" } }), f.save({ answers: { essay: "Tab B" } })]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(results.find(result => result.status === "rejected").reason.status, 409);
  const saved = (await f.service.formForApplicant(f.form.id, user)).draft, before = f.writes();
  f.advance(1000);
  assert.deepEqual(await f.save({ answers: saved.answers, revision: saved.revision }), saved);
  assert.equal(f.writes(), before);
  await assert.rejects(f.save({ answers: { essay: 10 }, revision: saved.revision }), { status: 400 });
  await assert.rejects(f.save({ answers: {}, revision: null }), { status: 409 });
  assert.deepEqual((await f.service.formForApplicant(f.form.id, user)).draft, saved);
});
test("new-application draft saves enforce account links and current opening deadlines", async () => {
  const f = await fixture();
  f.documents.set("websiteRobloxLinks/100", { discordId: "other" });
  const before = f.writes();
  await assert.rejects(f.save(), { status: 403 });
  assert.equal(f.writes(), before);
  f.documents.set("websiteRobloxLinks/100", { discordId: user.id });
  const published = await f.service.saveForm(f.form.id, { action: "publish", revision: f.form.revision, draft: { ...draft, closesAt: "2026-11-07T00:01:00Z" } });
  const saved = await f.save({ versionId: published.publishedVersion, answers: { essay: "Saved before the deadline" } });
  f.advance(60_000);
  const atDeadline = f.writes();
  await assert.rejects(f.save({ versionId: published.publishedVersion, revision: saved.revision }), { status: 409 });
  assert.equal(f.writes(), atDeadline);
  const record = [...f.documents].find(([path]) => path.startsWith("careerApplicationDrafts/"))[1];
  assert.equal(record.answers.essay, "Saved before the deadline");
});
test("a changed published form retains recoverable old answers and questions until explicit replacement", async () => {
  const f = await fixture(), saved = await f.save({ answers: { essay: "My original writing" } });
  const next = await f.service.saveForm(f.form.id, { action: "publish", revision: f.form.revision, draft: { ...draft, title: "New opening questions", questions: [{ id: "new", type: "short", label: "New question", required: true }] } });
  const opened = await f.service.formForApplicant(f.form.id, user);
  assert.equal(opened.form.versionId, next.publishedVersion);
  assert.equal(opened.draft.versionId, f.form.publishedVersion);
  assert.equal(opened.draft.form.questions[1].label, "Experience");
  assert.equal(opened.draft.answers.essay, "My original writing");
  await assert.rejects(f.save({ revision: saved.revision, answers: { essay: "Still old" } }), { status: 409 });
  const replaced = await f.save({ versionId: next.publishedVersion, revision: saved.revision, answers: { new: "Reviewed the new question" } });
  assert.equal(replaced.revision, saved.revision + 1);
  assert.equal((await f.service.formForApplicant(f.form.id, user)).draft.form, undefined);
});
test("initial submission atomically clears the expected draft including an acknowledged obsolete form version", async () => {
  const f = await fixture(), saved = await f.save({ answers: { essay: "Original saved draft" } });
  const next = await f.service.saveForm(f.form.id, { action: "publish", revision: f.form.revision, draft });
  const submitted = await f.submit({ versionId: next.publishedVersion, draftRevision: saved.revision });
  assert.equal((await f.service.application(submitted.id, user)).draft, null);
  assert.equal([...f.documents.keys()].filter(path => path.startsWith("careerApplicationDrafts/")).length, 0);
  assert.equal((await f.service.listApplications(user)).items.length, 1);
});
test("submission with an unseen newer draft fails without submitting or deleting answers", async () => {
  const f = await fixture(), saved = await f.save({ answers: { essay: "First" } });
  const updated = await f.save({ revision: saved.revision, answers: { essay: "Other tab's newest writing" } });
  const before = f.writes();
  for (const draftRevision of [null, saved.revision]) await assert.rejects(f.submit({ draftRevision }), { status: 409 });
  assert.equal(f.writes(), before);
  assert.equal((await f.service.listApplications(user)).items.length, 0);
  assert.deepEqual((await f.service.formForApplicant(f.form.id, user)).draft, updated);
  const legacy = await f.submit();
  assert.equal((await f.service.application(legacy.id, user)).draft.answers.essay, "Other tab's newest writing", "an older client preserves unseen draft answers");
});
test("editing drafts do not mutate applications and are never disclosed to reviewers", async () => {
  const f = await fixture(), submitted = await f.submit();
  await f.service.review(submitted.id, admin, { revision: 1, status: "under_review", feedback: "Team feedback", internalNotes: "Private team notes" });
  const before = structuredClone(f.documents.get(`careerApplications/${submitted.id}`));
  const saved = await f.save({ applicationRevision: 2, answers: { essay: "Unsubmitted personal edits" } });
  assert.deepEqual(f.documents.get(`careerApplications/${submitted.id}`), before);
  const own = await f.service.application(submitted.id, user);
  assert.deepEqual(own.draft, saved);
  assert.equal(own.application.answers.essay, answers.essay);
  assert.equal((await f.service.application(submitted.id, admin, true)).draft, undefined);
  assert.equal(JSON.stringify(await f.service.application(submitted.id, { id: "lead", role: "leadqa" }, true)).includes("Unsubmitted personal edits"), false);
  assert.equal(JSON.stringify(await f.service.listApplications(admin, {}, true)).includes("Unsubmitted personal edits"), false);
  await assert.rejects(f.service.application(submitted.id, other), { status: 404 });
  const edited = await f.service.resubmit(submitted.id, user, { revision: 2, draftRevision: saved.revision, answers: { ...answers, essay: "Final edited submission" }, consent: true });
  assert.equal(edited.revision, 3);
  assert.equal((await f.service.application(submitted.id, user)).draft, null);
  assert.equal((await f.service.application(submitted.id, user)).application.answers.essay, "Final edited submission");
});
test("stale editing draft saves cannot overwrite a new review; explicit review acknowledgement permits resubmission", async () => {
  const f = await fixture(), submitted = await f.submit(), saved = await f.save({ applicationRevision: 1, answers: { essay: "My edits" } });
  await f.service.review(submitted.id, admin, { revision: 1, status: "shortlisted", feedback: "New decision", internalNotes: "Private" });
  const before = f.writes();
  await assert.rejects(f.save({ revision: saved.revision, applicationRevision: 1, answers: { essay: "Stale save" } }), { status: 409 });
  await assert.rejects(f.service.resubmit(submitted.id, user, { revision: 1, draftRevision: saved.revision, answers, consent: true }), { status: 409 });
  assert.equal(f.writes(), before);
  const current = await f.service.application(submitted.id, user);
  assert.equal(current.application.status, "shortlisted");
  assert.equal(current.draft.applicationRevision, 1);
  await f.service.resubmit(submitted.id, user, { revision: current.application.revision, draftRevision: saved.revision, answers, consent: true });
  assert.equal((await f.service.application(submitted.id, user)).draft, null);
});
test("draft saves respect deadline, closure and withdrawal without discarding saved work", async () => {
  const f = await fixture(), submitted = await f.submit(), saved = await f.save({ applicationRevision: 1, answers: { essay: "Keep this work" } });
  await f.service.review(submitted.id, user, { revision: 1 }, true);
  await assert.rejects(f.save({ revision: saved.revision, applicationRevision: 2, answers: {} }), { status: 409 });
  assert.equal((await f.service.application(submitted.id, user)).draft.answers.essay, "Keep this work");
  await f.service.review(submitted.id, admin, { revision: 2, status: "submitted", feedback: "Restored", internalNotes: "" });
  const next = await f.service.saveForm(f.form.id, { action: "publish", revision: f.form.revision, draft: { ...draft, closesAt: "2026-11-07T00:01:00Z" } });
  f.advance(60_000);
  await assert.rejects(f.save({ revision: saved.revision, applicationRevision: 3, answers: {} }), { status: 409 });
  await f.service.saveForm(f.form.id, { action: "close", revision: next.revision });
  await assert.rejects(f.save({ revision: saved.revision, applicationRevision: 3, answers: {} }), { status: 409 });
  assert.equal((await f.service.application(submitted.id, user)).draft.answers.essay, "Keep this work");
});
test("owners can recover initial drafts read-only after deadline or closure while other applicants cannot open the form", async () => {
  const f = await fixture(), saved = await f.save({ answers: { essay: "Private unfinished work" } });
  assert.equal((await f.service.formForApplicant(f.form.id, user)).acceptingApplications, true);
  const next = await f.service.saveForm(f.form.id, { action: "publish", revision: f.form.revision, draft: { ...draft, closesAt: "2026-11-07T00:01:00Z", questions: [{ id: "new", type: "short", label: "Updated question", required: true }] } });
  f.advance(60_000);
  const expired = await f.service.formForApplicant(f.form.id, user);
  assert.equal(expired.acceptingApplications, false);
  assert.equal(expired.existingApplicationId, null);
  assert.equal(expired.draft.revision, saved.revision);
  assert.equal(expired.draft.answers.essay, "Private unfinished work");
  assert.equal(expired.draft.form.questions[1].label, "Experience");
  await assert.rejects(f.service.formForApplicant(f.form.id, other), { status: 409 });
  await assert.rejects(f.save({ revision: saved.revision, versionId: next.publishedVersion, answers: { new: "Late save" } }), { status: 409 });
  await assert.rejects(f.submit({ versionId: next.publishedVersion, answers: { new: "Late submission" }, draftRevision: saved.revision }), { status: 409 });
  await f.service.saveForm(f.form.id, { action: "close", revision: next.revision });
  const closed = await f.service.formForApplicant(f.form.id, user);
  assert.equal(closed.acceptingApplications, false);
  assert.equal(closed.draft.answers.essay, "Private unfinished work");
  assert.equal(closed.form.draft, undefined, "only the published form is returned");
  await assert.rejects(f.service.formForApplicant(f.form.id, other), { status: 409 });
});
test("closed openings can still direct existing applicants to their application without exposing unpublished openings", async () => {
  const f = await fixture(), submitted = await f.submit();
  await f.service.saveForm(f.form.id, { action: "close", revision: f.form.revision });
  const opened = await f.service.formForApplicant(f.form.id, user);
  assert.equal(opened.acceptingApplications, false);
  assert.equal(opened.existingApplicationId, submitted.id);
  assert.equal(opened.draft, null);
  const unpublished = await f.service.createForm();
  await assert.rejects(f.service.formForApplicant(unpublished.id, user), { status: 409 });
});
