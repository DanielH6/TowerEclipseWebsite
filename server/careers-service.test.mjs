import test from "node:test";
import assert from "node:assert/strict";
import { normalizeForm, validateAnswers } from "./careers-domain.mjs";
import { createCareersService } from "./careers-service.mjs";
import { createMemoryDb } from "./testing/careers-memory-db.mjs";

const user = { id: "discord1", username: "tester", displayName: "Tester" };
const admin = { id: "admin1", username: "admin", displayName: "Reviewer", role: "dev" };
const draft = { title: "Tester application", category: "Quality assurance", description: "Help test Tower Eclipse", commitment: "Volunteer", confirmation: "Thanks!", closesAt: null, questions: [
  { id: "short", type: "short", label: "Time zone", help: "", required: true },
  { id: "long", type: "paragraph", label: "Experience", help: "", required: true },
  { id: "choice", type: "choice", label: "Availability", help: "", required: true, options: ["Weekends", "Weekdays"] },
  { id: "checks", type: "checkboxes", label: "Devices", help: "", required: true, options: ["PC", "Mobile"] },
  { id: "rank", type: "ranking", label: "Preferences", help: "", required: true, options: ["Combat", "UI", "Balance"] },
  { id: "scale", type: "scale", label: "Confidence", help: "", required: true, min: 0, max: 5, minLabel: "Low", maxLabel: "High" },
] };
const answers = { short: "Australia/Sydney", long: "I document steps to reproduce.", choice: "Weekends", checks: ["PC"], rank: ["UI", "Combat", "Balance"], scale: 0 };
async function fixture() {
  const f = createMemoryDb({ "websiteAccounts/discord1": { roblox: { userId: "123", username: "Player", verifiedAt: "2026-09-14T00:00:00.000Z" } }, "websiteRobloxLinks/123": { discordId: "discord1" } });
  let now = Date.parse("2026-09-14T01:00:00.000Z");
  const service = createCareersService(f.db, { now: () => now });
  const created = await service.createForm();
  const form = await service.saveForm(created.id, { action: "publish", revision: 1, draft });
  const input = { versionId: form.publishedVersion, answers, consent: true };
  return { ...f, service, form, input, advance: ms => { now += ms; } };
}

test("all six question types validate, including zero on a 0–5 scale", () => {
  assert.deepEqual(validateAnswers(normalizeForm(draft, true), answers), answers);
});
test("total answer budget measures UTF-8 bytes across questions", () => {
  const questions = Array.from({ length: 10 }, (_, i) => ({ ...draft.questions[1], id: `essay${i}` }));
  const oversized = Object.fromEntries(questions.map(q => [q.id, "界".repeat(2500)]));
  assert.throws(() => validateAnswers({ questions }, oversized), /64 KB/);
});
for (const [name, changes] of Object.entries({ "missing required": { long: " " }, "oversized short": { short: "a".repeat(501) }, "oversized paragraph": { long: "a".repeat(5001) }, "unknown option": { choice: "Anything" }, "duplicate checks": { checks: ["PC", "PC"] }, "missing ranking option": { rank: ["UI", "Combat"] }, "duplicate ranking": { rank: ["UI", "UI", "Balance"] }, "out of range": { scale: 6 }, "fractional scale": { scale: 1.5 }, "string scale": { scale: "1" }, "unknown question": { injection: "extra" } })) {
  test(`submission rejects ${name}`, () => assert.throws(() => validateAnswers(draft, { ...answers, ...changes })));
}
test("form configuration is normalized, bounded, and rejects malformed questions", () => {
  assert.throws(() => normalizeForm({ ...draft, questions: Array(41).fill(draft.questions[0]) }, true));
  assert.throws(() => normalizeForm({ ...draft, questions: [draft.questions[0], draft.questions[0]] }, true));
  assert.throws(() => normalizeForm({ ...draft, questions: [{ ...draft.questions[2], options: ["Same", "Same"] }] }, true));
  assert.throws(() => normalizeForm({ ...draft, questions: [] }, true));
  assert.throws(() => normalizeForm({ ...draft, questions: [{ ...draft.questions[0], type: "upload" }] }));
  const form = normalizeForm({ ...draft, surprise: "removed" }, true);
  assert.equal(form.surprise, undefined);
  assert.equal(normalizeForm({ ...draft, category: "QUALITY ASSURANCE" }, true).category, "Quality assurance");
});
test("account linking is enforced both when opening and submitting", async () => {
  const f = await fixture();
  f.documents.delete("websiteAccounts/discord1");
  await assert.rejects(f.service.formForApplicant(f.form.id, user), { status: 403 });
  await assert.rejects(f.service.submit(f.form.id, user, f.input), { status: 403 });
  await assert.rejects(f.service.formForApplicant(f.form.id, null), { status: 401 });
});
test("a spoofed/stale link with a different ownership claim cannot apply", async () => {
  const f = await fixture();
  f.documents.set("websiteRobloxLinks/123", { discordId: "someone-else" });
  await assert.rejects(f.service.submit(f.form.id, user, f.input), { status: 403 });
});
test("concurrent duplicate submissions create one record and update its opening count once", async () => {
  const f = await fixture(), before = f.writes();
  const [a, b] = await Promise.all([f.service.submit(f.form.id, user, f.input), f.service.submit(f.form.id, user, f.input)]);
  assert.equal(a.id, b.id); assert.equal(b.alreadySubmitted, true); assert.equal(f.writes() - before, 2);
  assert.equal(f.documents.get(`careerForms/${f.form.id}`).applicationCount, 1);
  const stored = f.documents.get(`careerApplications/${a.id}`);
  assert.deepEqual(stored.applicant.roblox, { userId: "123", username: "Player" });
  assert.equal(stored.status, "submitted"); assert.ok(stored.consentAt);
  assert.equal(stored.questions, undefined, "form questions are stored once per published version");
});
test("invalid answers or missing consent never write application data", async () => {
  const f = await fixture(), before = f.writes();
  await assert.rejects(f.service.submit(f.form.id, user, { ...f.input, consent: false }));
  await assert.rejects(f.service.submit(f.form.id, user, { ...f.input, answers: {} }));
  assert.equal(f.writes(), before);
});
test("draft edits do not change published questions; republishing preserves answered version", async () => {
  const f = await fixture();
  const submitted = await f.service.submit(f.form.id, user, f.input);
  const nextDraft = { ...draft, title: "Updated title", questions: [{ ...draft.questions[0], label: "New wording" }] };
  const saved = await f.service.saveForm(f.form.id, { action: "save", revision: f.form.revision, draft: nextDraft });
  const live = await f.service.formForApplicant(f.form.id, user);
  assert.equal(live.form.questions.length, 6); assert.equal(live.form.title, draft.title);
  await f.service.saveForm(f.form.id, { action: "publish", revision: saved.revision, draft: nextDraft });
  const original = await f.service.application(submitted.id, user);
  assert.equal(original.form.title, draft.title); assert.equal(original.form.questions.length, 6);
});
test("stale form submissions, expired deadlines, and closed openings are rejected", async () => {
  const f = await fixture();
  await assert.rejects(f.service.submit(f.form.id, user, { ...f.input, versionId: "old" }), { status: 409 });
  const updated = await f.service.saveForm(f.form.id, { action: "publish", revision: f.form.revision, draft: { ...draft, closesAt: "2026-09-14T01:01:00Z" } });
  f.advance(61_000);
  await assert.rejects(f.service.submit(f.form.id, user, { ...f.input, versionId: updated.publishedVersion }), { status: 409 });
  assert.equal((await f.service.listForms()).items.length, 0);
  await f.service.saveForm(f.form.id, { action: "close", revision: updated.revision });
  await assert.rejects(f.service.formForApplicant(f.form.id, user), { status: 409 });
});
test("form and reviewer revisions prevent lost edits", async () => {
  const f = await fixture();
  await assert.rejects(f.service.saveForm(f.form.id, { action: "close", revision: 1 }), { status: 409 });
  const a = await f.service.submit(f.form.id, user, f.input);
  const review = { revision: 1, status: "under_review", feedback: "We are reviewing this.", internalNotes: "Private assessment" };
  await f.service.review(a.id, admin, review);
  await assert.rejects(f.service.review(a.id, admin, review), { status: 409 });
});
test("other users cannot read or withdraw applications, and private notes never reach applicants", async () => {
  const f = await fixture(), a = await f.service.submit(f.form.id, user, f.input);
  await f.service.review(a.id, admin, { revision: 1, status: "shortlisted", feedback: "Next steps soon", internalNotes: "Private assessment" });
  await assert.rejects(f.service.application(a.id, { id: "other" }), { status: 404 });
  await assert.rejects(f.service.review(a.id, { id: "other" }, { revision: 2 }, true), { status: 404 });
  const own = await f.service.application(a.id, user);
  assert.equal(JSON.stringify(own).includes("Private assessment"), false);
  assert.equal(own.application.feedback, "Next steps soon");
  assert.equal(own.application.history.length, 2);
  assert.equal((await f.service.application(a.id, admin, true)).application.internalNotes, "Private assessment");
  const list = await f.service.listApplications(user);
  assert.equal(JSON.stringify(list).includes("Private assessment"), false);
  assert.equal(list.items[0].answers, undefined);
});
test("QA Lead can read every Quality Assurance application but no other category", async () => {
  const f = await fixture(), submitted = await f.service.submit(f.form.id, user, f.input);
  const source = f.documents.get(`careerApplications/${submitted.id}`);
  f.documents.delete(`careerApplications/${submitted.id}`);
  for (let n = 0; n < 24; n++) f.documents.set(`careerApplications/other${n}`, { ...source, category: "Development" });
  for (let n = 0; n < 23; n++) f.documents.set(`careerApplications/qa${n}`, { ...source, category: n % 2 ? "Quality Assurance" : "Quality assurance", status: n % 2 ? "under_review" : "submitted" });
  const lead = { id: "lead1", role: "leadqa" };
  const first = await f.service.listApplications(lead, {}, true);
  const second = await f.service.listApplications(lead, { cursor: first.nextCursor }, true);
  assert.deepEqual([first.items.length, second.items.length], [20, 3]);
  assert.ok([...first.items, ...second.items].every(item => item.category.toLowerCase() === "quality assurance"));
  assert.equal((await f.service.listApplications(lead, { status: "under_review" }, true)).items.length, 11);
  assert.equal((await f.service.listApplications(lead, { formId: f.form.id, status: "submitted" }, true)).items.length, 12);
  assert.equal((await f.service.application("qa1", lead, true)).application.category, "Quality Assurance");
  await assert.rejects(f.service.application("other1", lead, true), { status: 404 });
  await assert.rejects(f.service.listApplications(lead, { cursor: first.nextCursor, status: "submitted" }, true), { status: 400 });
  await assert.rejects(f.service.listApplications(admin, { cursor: first.nextCursor }, true), { status: 400 });
  await assert.rejects(f.service.listApplications({ id: "member", role: "member" }, {}, true), { status: 403 });
  await assert.rejects(f.service.application("qa1", { id: "member", role: "member" }, true), { status: 403 });
  await assert.rejects(f.service.review("qa1", lead, { revision: 1, status: "accepted", feedback: "", internalNotes: "" }), { status: 403 });
});
test("applicants cannot undo withdrawal or create a second application, while administrators can restore it", async () => {
  const f = await fixture(), a = await f.service.submit(f.form.id, user, f.input);
  await f.service.review(a.id, user, { revision: 1 }, true);
  const own = await f.service.application(a.id, user);
  assert.equal(own.application.status, "withdrawn"); assert.equal(own.application.history.at(-1).status, "withdrawn");
  assert.equal((await f.service.submit(f.form.id, user, f.input)).alreadySubmitted, true);
  assert.equal(own.canResubmit, false);
  await assert.rejects(f.service.resubmit(a.id, user, { revision: 2, answers, consent: true }), { status: 409 });
  await assert.rejects(f.service.review(a.id, user, { revision: 2, status: "accepted", feedback: "", internalNotes: "" }), { status: 403 });
  await assert.rejects(f.service.review(a.id, { id: "lead", role: "leadqa" }, { revision: 2, status: "accepted", feedback: "", internalNotes: "" }), { status: 403 });
  await f.service.review(a.id, admin, { revision: 2, status: "under_review", feedback: "Restored for review", internalNotes: "Restoration reason" });
  const restored = await f.service.application(a.id, user);
  assert.equal(restored.application.status, "under_review");
  assert.equal(restored.canResubmit, true);
  assert.deepEqual(restored.application.history.map(event => event.status), ["submitted", "withdrawn", "under_review"]);
  await f.service.resubmit(a.id, user, { revision: 3, answers: { ...answers, long: "Updated after restoration" }, consent: true });
  assert.equal((await f.service.application(a.id, user)).application.status, "submitted");
});
for (const status of ["submitted", "under_review", "shortlisted", "accepted", "rejected"]) {
  test(`administrators can restore a withdrawn application to ${status}, even after closing`, async () => {
    const f = await fixture(), a = await f.service.submit(f.form.id, user, f.input);
    await f.service.review(a.id, user, { revision: 1 }, true);
    await f.service.saveForm(f.form.id, { action: "close", revision: f.form.revision });
    await f.service.review(a.id, admin, { revision: 2, status, feedback: "Restored", internalNotes: "Reviewed restoration" });
    const own = await f.service.application(a.id, user);
    assert.equal(own.application.status, status);
    assert.equal(own.application.history.at(-1).status, status);
    assert.equal(own.canResubmit, false, "restoration does not bypass a closed opening");
  });
}
test("resubmission updates the existing application, resets its decision and retains original identity, notes and history", async () => {
  const f = await fixture(), a = await f.service.submit(f.form.id, user, f.input);
  const original = f.documents.get(`careerApplications/${a.id}`);
  await f.service.review(a.id, admin, { revision: 1, status: "accepted", feedback: "Original decision", internalNotes: "Private assessment", feedbackFormatting: { feedback: [{ text: "Original decision", bold: true }] }, notesFormatting: { internalNotes: [{ text: "Private assessment", italic: true }] } });
  f.documents.delete("websiteAccounts/discord1");
  f.advance(1000);
  const before = f.writes();
  const changed = await f.service.resubmit(a.id, { ...user, username: "new-name" }, { revision: 2, answers: { ...answers, short: "  Updated time zone  " }, consent: true, status: "accepted", internalNotes: "Injected" });
  assert.deepEqual(changed, { id: a.id, revision: 3 });
  const stored = f.documents.get(`careerApplications/${a.id}`);
  assert.equal(f.writes() - before, 2, "application and form edit counter update together");
  assert.equal([...f.documents.keys()].filter(path => path.startsWith("careerApplications/")).length, 1);
  assert.deepEqual(stored.applicant, original.applicant);
  assert.equal(stored.createdAt, original.createdAt);
  assert.equal(stored.versionId, original.versionId);
  assert.equal(stored.answers.short, "Updated time zone");
  assert.equal(stored.status, "submitted");
  assert.equal(stored.feedback, "");
  assert.deepEqual(stored.feedbackFormatting, {});
  assert.equal(stored.reviewer, null);
  assert.equal(stored.internalNotes, "Private assessment");
  assert.equal(stored.notesFormatting.internalNotes[0].italic, true);
  assert.equal(stored.submissionRevision, 2);
  assert.equal(stored.resubmittedAt, stored.updatedAt);
  assert.equal(stored.consentAt, stored.updatedAt);
  assert.deepEqual(stored.history.map(event => event.status), ["submitted", "accepted", "submitted"]);
  assert.match(stored.history.at(-1).feedback, /edited and resubmitted/);
  assert.equal(f.documents.get(`careerForms/${f.form.id}`).applicationEditRevision, 1);
  const own = await f.service.application(a.id, user);
  assert.equal(own.canResubmit, true);
  assert.equal(JSON.stringify(own).includes("Private assessment"), false);
});
test("resubmissions require ownership, consent, valid answers and an unchanged revision without partial writes", async () => {
  const f = await fixture(), a = await f.service.submit(f.form.id, user, f.input), before = f.writes();
  const input = { revision: 1, answers: { ...answers, long: "Edited" }, consent: true };
  await assert.rejects(f.service.resubmit(a.id, null, input), { status: 401 });
  for (const stranger of [{ id: "other" }, admin, { id: "qa-lead", role: "leadqa" }]) await assert.rejects(f.service.resubmit(a.id, stranger, input), { status: 404 });
  await assert.rejects(f.service.resubmit(a.id, user, { ...input, consent: false }), { status: 400 });
  await assert.rejects(f.service.resubmit(a.id, user, { ...input, answers: {} }), { status: 400 });
  await assert.rejects(f.service.resubmit(a.id, user, { ...input, answers: { ...answers, choice: "Unknown" } }), { status: 400 });
  await assert.rejects(f.service.resubmit(a.id, user, { ...input, revision: 0 }), { status: 409 });
  assert.equal(f.writes(), before);
  const concurrent = await Promise.allSettled([f.service.resubmit(a.id, user, input), f.service.resubmit(a.id, user, { ...input, answers: { ...answers, long: "Other tab" } })]);
  assert.equal(concurrent.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(concurrent.find(result => result.status === "rejected").reason.status, 409);
  assert.equal(f.documents.get(`careerApplications/${a.id}`).revision, 2);
  await assert.rejects(f.service.review(a.id, admin, { revision: 1, status: "accepted", feedback: "", internalNotes: "" }), { status: 409 });
});
test("resubmission uses the original question version and current published deadline, including the exact boundary", async () => {
  const f = await fixture();
  const published = await f.service.saveForm(f.form.id, { action: "publish", revision: f.form.revision, draft: { ...draft, closesAt: "2026-09-14T01:01:00Z" } });
  const a = await f.service.submit(f.form.id, user, { ...f.input, versionId: published.publishedVersion });
  const next = await f.service.saveForm(f.form.id, { action: "publish", revision: published.revision, draft: { ...draft, closesAt: "2026-09-14T01:02:00Z", questions: [{ ...draft.questions[0], id: "new-question" }] } });
  f.advance(60_000);
  const open = await f.service.application(a.id, user);
  assert.equal(open.closesAt, "2026-09-14T01:02:00.000Z");
  assert.equal(open.canResubmit, true);
  assert.equal(open.form.questions.length, 6);
  await assert.rejects(f.service.resubmit(a.id, user, { revision: 1, consent: true, answers: { "new-question": "New version answer" } }), { status: 409 });
  await f.service.resubmit(a.id, user, { revision: 1, consent: true, answers });
  f.advance(60_000);
  assert.equal((await f.service.application(a.id, user)).canResubmit, false);
  await assert.rejects(f.service.resubmit(a.id, user, { revision: 2, consent: true, answers }), { status: 409 });
  const reopened = await f.service.saveForm(f.form.id, { action: "publish", revision: next.revision, draft });
  assert.equal((await f.service.application(a.id, user)).canResubmit, true, "no deadline permits edits until closed");
  await f.service.saveForm(f.form.id, { action: "close", revision: reopened.revision });
  assert.equal((await f.service.application(a.id, user)).canResubmit, false);
  await assert.rejects(f.service.resubmit(a.id, user, { revision: 2, consent: true, answers }), { status: 409 });
});
for (const status of ["submitted", "under_review", "shortlisted", "accepted", "rejected"]) {
  test(`applicants can resubmit from ${status} before closing and counts refresh`, async () => {
    const f = await fixture(), a = await f.service.submit(f.form.id, user, f.input);
    await f.service.review(a.id, admin, { revision: 1, status, feedback: "Previous update", internalNotes: "" });
    assert.equal((await f.service.applicationStats(admin, { status: "submitted" })).applications, status === "submitted" ? 1 : 0);
    await f.service.resubmit(a.id, user, { revision: 2, answers, consent: true });
    assert.equal((await f.service.application(a.id, user)).application.status, "submitted");
    assert.equal((await f.service.applicationStats(admin, { status: "submitted" })).applications, 1);
  });
}
test("public listing is cached and invalidated by closing; applicant data is never public", async () => {
  const f = await fixture();
  const first = await f.service.listForms(), count = f.queries.length;
  await f.service.listForms(); assert.equal(f.queries.length, count);
  assert.equal(first.items[0].draft, undefined); assert.equal(first.items[0].questions, undefined);
  await f.service.saveForm(f.form.id, { action: "close", revision: f.form.revision });
  assert.equal((await f.service.listForms()).items.length, 0);
});
test("cursor pagination with equal timestamps is complete, scoped, and bounded", async () => {
  const f = await fixture(), a = await f.service.submit(f.form.id, user, f.input);
  const source = f.documents.get(`careerApplications/${a.id}`);
  f.documents.delete(`careerApplications/${a.id}`);
  for (let n = 0; n < 47; n++) f.documents.set(`careerApplications/app${String(n).padStart(3, "0")}`, { ...source, status: "submitted" });
  const one = await f.service.listApplications(user), two = await f.service.listApplications(user, { cursor: one.nextCursor }), three = await f.service.listApplications(user, { cursor: two.nextCursor });
  assert.deepEqual([one.items.length, two.items.length, three.items.length], [20, 20, 7]);
  assert.equal(new Set([...one.items, ...two.items, ...three.items].map(item => item.id)).size, 47);
  assert.equal(three.nextCursor, null);
  await assert.rejects(f.service.listApplications({ id: "other" }, { cursor: one.nextCursor }), { status: 400 });
  await assert.rejects(f.service.listApplications(user, { status: "accepted", cursor: one.nextCursor }), { status: 400 });
  for (const query of f.queries) { assert.equal(query.maximum, 21); assert.equal(query.fields.includes("answers"), false); }
});
test("review history is bounded and private-only changes do not create applicant events", async () => {
  const f = await fixture(), a = await f.service.submit(f.form.id, user, f.input);
  await f.service.review(a.id, admin, { revision: 1, status: "submitted", feedback: "", internalNotes: "Private only" });
  assert.equal((await f.service.application(a.id, user)).application.history.length, 1);
  for (let revision = 2; revision < 56; revision++) await f.service.review(a.id, admin, { revision, status: "under_review", feedback: `Update ${revision}`, internalNotes: "Private only" });
  assert.equal((await f.service.application(a.id, user)).application.history.length, 50);
});

test("styled text is validated independently of plain answer values and HTML stays inert", () => {
  const input = structuredClone(draft);
  input.formatting = { title: [{ text: input.title, bold: true, color: "#AABBCC", onclick: "alert(1)" }] };
  input.questions[2].formatting = { option0: [{ text: "Weekends", italic: true }] };
  const normalized = normalizeForm(input, true);
  assert.equal(normalized.formatting.title[0].color, "#aabbcc");
  assert.equal(normalized.formatting.title[0].onclick, undefined);
  assert.deepEqual(validateAnswers(normalized, answers), answers);
  for (const run of [{ text: input.title, href: "javascript:alert(1)" }, { text: input.title, color: "url(https://bad.example)" }, { text: "different text", bold: true }]) {
    assert.throws(() => normalizeForm({ ...input, formatting: { title: [run] } }));
  }
  assert.throws(() => normalizeForm({ ...input, formatting: { unknown: [] } }));
  assert.equal(normalizeForm({ ...draft, title: "<img onerror=alert(1)>" }).title, "<img onerror=alert(1)>");
  assert.equal(normalizeForm({ ...input, title: `  ${draft.title}  `, formatting: { title: [{ text: `  ${draft.title}  `, underline: true }] } }).formatting.title[0].text, draft.title);
});

test("formatted review feedback reaches applicants and history, private formatting does not", async () => {
  const f = await fixture(), submitted = await f.service.submit(f.form.id, user, f.input);
  await f.service.review(submitted.id, admin, { revision: 1, status: "under_review", feedback: "Thanks", internalNotes: "Private", feedbackFormatting: { feedback: [{ text: "Thanks", bold: true }] }, notesFormatting: { internalNotes: [{ text: "Private", italic: true }] } });
  const own = (await f.service.application(submitted.id, user)).application;
  assert.equal(own.feedbackFormatting.feedback[0].bold, true);
  assert.equal(own.history.at(-1).feedbackFormatting.feedback[0].bold, true);
  assert.equal(own.notesFormatting, undefined);
  const historyLength = own.history.length;
  await f.service.review(submitted.id, admin, { revision: 2, status: "under_review", feedback: "Thanks", internalNotes: "Private", feedbackFormatting: own.feedbackFormatting, notesFormatting: { internalNotes: [{ text: "Private", underline: true }] } });
  assert.equal((await f.service.application(submitted.id, user)).application.history.length, historyLength);
  assert.equal((await f.service.application(submitted.id, admin, true)).application.notesFormatting.internalNotes[0].underline, true);
});

test("applicant counts include every page, distinct people, categories and openings with QA scope", async () => {
  const f = await fixture(), submitted = await f.service.submit(f.form.id, user, f.input);
  const source = f.documents.get(`careerApplications/${submitted.id}`);
  f.documents.delete(`careerApplications/${submitted.id}`);
  for (let i = 0; i < 523; i++) f.documents.set(`careerApplications/count${i}`, { ...source, applicantId: `person${i % 100}`, formId: i < 503 ? "qa-opening" : "dev-opening", title: i < 503 ? "Tester" : "Developer", category: i < 503 ? (i % 2 ? "Quality Assurance" : "Quality assurance") : "Development", status: i < 503 ? "submitted" : "accepted" });
  f.queries.length = 0;
  const stats = await f.service.applicationStats(admin);
  assert.equal(stats.applications, 523); assert.equal(stats.applicants, 100);
  assert.equal(stats.categories.find(group => group.category === "Quality assurance").applications, 503);
  assert.equal(stats.openings.find(group => group.id === "dev-opening").applicants, 20);
  assert.equal(f.queries.length, 2); assert.ok(f.queries.every(query => query.maximum === 500 && !query.fields.includes("answers") && !query.fields.includes("applicant")));
  await f.service.applicationStats(admin); assert.equal(f.queries.length, 2, "counts use a short cache");
  const qa = await f.service.applicationStats({ id: "qa-lead", role: "leadqa" });
  assert.equal(qa.applications, 503); assert.equal(qa.categories.length, 1);
  assert.equal((await f.service.applicationStats(admin, { status: "accepted" })).applications, 20);
  assert.equal((await f.service.applicationStats(admin, { formId: "qa-opening" })).applications, 503);
  await assert.rejects(f.service.applicationStats({ id: "member", role: "member" }), { status: 403 });
  await assert.rejects(f.service.applicationStats(admin, { status: "unknown" }), { status: 400 });
  await f.service.review("count0", admin, { revision: 1, status: "accepted", feedback: "", internalNotes: "" });
  assert.equal((await f.service.applicationStats(admin, { status: "accepted" })).applications, 21, "reviews invalidate cached counts");
});
