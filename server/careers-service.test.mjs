import test from "node:test";
import assert from "node:assert/strict";
import { normalizeForm, validateAnswers } from "./careers-domain.mjs";
import { createCareersService } from "./careers-service.mjs";
import { createMemoryDb } from "./testing/careers-memory-db.mjs";

const user = { id: "discord1", username: "tester", displayName: "Tester" };
const admin = { id: "admin1", username: "admin", displayName: "Reviewer" };
const draft = { title: "Tester application", category: "QA", description: "Help test Tower Eclipse", commitment: "Volunteer", confirmation: "Thanks!", closesAt: null, questions: [
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
test("concurrent duplicate submissions create one record and one write", async () => {
  const f = await fixture(), before = f.writes();
  const [a, b] = await Promise.all([f.service.submit(f.form.id, user, f.input), f.service.submit(f.form.id, user, f.input)]);
  assert.equal(a.id, b.id); assert.equal(b.alreadySubmitted, true); assert.equal(f.writes() - before, 1);
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
test("withdrawal is final, retains history, and prevents another submission to that opening", async () => {
  const f = await fixture(), a = await f.service.submit(f.form.id, user, f.input);
  await f.service.review(a.id, user, { revision: 1 }, true);
  const own = await f.service.application(a.id, user);
  assert.equal(own.application.status, "withdrawn"); assert.equal(own.application.history.at(-1).status, "withdrawn");
  assert.equal((await f.service.submit(f.form.id, user, f.input)).alreadySubmitted, true);
  await assert.rejects(f.service.review(a.id, admin, { revision: 2, status: "accepted", feedback: "", internalNotes: "" }), { status: 409 });
});
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
