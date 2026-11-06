import test from "node:test";
import assert from "node:assert/strict";
import { createCareersService } from "./careers-service.mjs";
import { createMemoryDb } from "./testing/careers-memory-db.mjs";

const admin = { id: "admin", role: "dev", displayName: "Reviewer" }, lead = { id: "lead", role: "leadqa" };
const applicant = { id: "person0", username: "person0", displayName: "Person" };
const draft = { title: "Tester round", category: "Quality assurance", description: "Help test", commitment: "Volunteer", confirmation: "Thanks", closesAt: null, questions: [{ id: "answer", type: "paragraph", label: "Experience", required: true }] };
async function fixture(size = 100) {
  const memory = createMemoryDb(), lookups = [];
  const doc = memory.db.doc;
  memory.db.doc = path => { const reference = doc(path); return { ...reference, get: async () => { lookups.push(path); return reference.get(); } }; };
  let time = Date.parse("2026-11-07T00:00:00Z");
  const service = createCareersService(memory.db, { now: () => time, aiProvider: { enabled: false } });
  const created = await service.createForm(), form = await service.saveForm(created.id, { action: "publish", revision: 1, draft });
  for (let i = 0; i < size; i++) memory.documents.set(`careerApplications/app${String(i).padStart(4, "0")}`, {
    formId: form.id, versionId: form.publishedVersion, title: draft.title, category: i % 3 === 0 ? "Development" : "Quality assurance", applicantId: `person${i % 30}`,
    applicant: { username: `discord${i}`, displayName: `Display ${i}`, discordId: `person${i % 30}`, roblox: { username: `roblox${i}`, userId: String(i + 100) } },
    status: i % 2 ? "under_review" : "submitted", createdAt: new Date(time).toISOString(), updatedAt: new Date(time).toISOString(), revision: 1, submissionRevision: 1,
    answers: { answer: `Private answer ${i}` }, feedback: "", internalNotes: "Private notes", history: [],
  });
  memory.queries.length = 0; lookups.length = 0;
  return { ...memory, service, form, lookups, advance: ms => { time += ms; } };
}
const applicationQueries = f => f.queries.filter(query => query.collection === "careerApplications");
test("oldest-first uses ascending 21-document cursors across tied timestamps", async () => {
  const f = await fixture(47), options = { formId: f.form.id, sort: "oldest" };
  const first = await f.service.listApplications(admin, options, true);
  const second = await f.service.listApplications(admin, { ...options, cursor: first.nextCursor }, true);
  const third = await f.service.listApplications(admin, { ...options, cursor: second.nextCursor }, true);
  assert.deepEqual([first.items.length, second.items.length, third.items.length], [20, 20, 7]);
  assert.equal(new Set([...first.items, ...second.items, ...third.items].map(item => item.id)).size, 47);
  assert.equal(first.items[0].id, "app0000");
  assert.ok(applicationQueries(f).every(query => query.maximum === 21 && query.order.every(([, direction]) => direction === "asc")));
});
test("statistics coalesce, retain exact distinct counts, share status filters and update incrementally without note-only rescans", async () => {
  const f = await fixture(523);
  const [first, concurrent] = await Promise.all([f.service.applicationStats(admin), f.service.applicationStats(admin)]);
  assert.deepEqual(first, concurrent);
  assert.equal(first.applicants, 30); assert.equal(first.applications, 523);
  assert.equal(applicationQueries(f).length, 2);
  assert.ok(applicationQueries(f).every(query => !query.fields.includes("applicant") && !query.fields.includes("answers") && !query.fields.includes("internalNotes")));
  assert.equal((await f.service.applicationStats(admin, { status: "submitted" })).applications, 262);
  assert.equal(applicationQueries(f).length, 2, "status filters share a complete compact corpus");
  await f.service.review("app0000", admin, { revision: 1, status: "submitted", feedback: "Changed feedback", internalNotes: "Changed notes" });
  await f.service.applicationStats(admin);
  assert.equal(applicationQueries(f).length, 2, "notes and feedback do not invalidate counts");
  await f.service.review("app0000", admin, { revision: 2, status: "accepted", feedback: "Accepted", internalNotes: "" });
  assert.equal((await f.service.applicationStats(admin, { status: "accepted" })).applications, 1);
  assert.equal((await f.service.applicationStats(admin)).applicants, 30);
  assert.equal(applicationQueries(f).length, 2, "committed status changes patch the hot corpus");
  const qa = await f.service.applicationStats(lead);
  assert.equal(qa.applications, 348);
  assert.ok(qa.categories.every(group => group.category === "Quality assurance"));
  assert.equal(applicationQueries(f).length, 3, "QA receives a separately authorized category-scoped corpus");
  await f.service.applicationStats(admin, { refresh: "explicit-refresh" });
  assert.equal(applicationQueries(f).length, 5);
  await f.service.applicationStats(admin, { status: "accepted", refresh: "explicit-refresh" });
  assert.equal(applicationQueries(f).length, 5, "the same refresh token is coalesced across filter requests");
});
test("statistics expose bounded freshness and refresh external changes after expiry", async () => {
  const f = await fixture(3), initial = await f.service.applicationStats(admin);
  f.documents.get("careerApplications/app0000").status = "accepted";
  assert.equal((await f.service.applicationStats(admin, { status: "accepted" })).applications, 0);
  assert.equal(initial.maxAgeSeconds, 900); assert.ok(initial.asOf);
  f.advance(15 * 60_000 + 1);
  assert.equal((await f.service.applicationStats(admin, { status: "accepted" })).applications, 1);
});
test("searching and paging reuse a bounded full corpus and fetch at most twenty fresh authorized rows", async () => {
  const f = await fixture(103), options = { formId: f.form.id, search: "discord" };
  const first = await f.service.listApplications(admin, options, true);
  const second = await f.service.listApplications(admin, { ...options, cursor: first.nextCursor }, true);
  assert.deepEqual([first.items.length, second.items.length], [20, 20]);
  assert.equal(applicationQueries(f).length, 1);
  assert.equal(f.lookups.filter(path => path.startsWith("careerApplications/")).length, 40);
  assert.ok(applicationQueries(f).every(query => !query.fields.includes("answers") && !query.fields.includes("feedback")));
  const name = await f.service.listApplications(admin, { formId: f.form.id, search: "ROBLOX102" }, true);
  assert.equal(name.items[0].id, "app0102", "search covers the whole pool, including older rows");
  assert.equal(applicationQueries(f).length, 1, "a different term reuses the same compact search corpus");
  const qa = await f.service.listApplications(lead, { formId: f.form.id, search: "discord" }, true);
  assert.ok(qa.items.every(item => item.category === "Quality assurance"));
  assert.equal(applicationQueries(f).length, 2);
  assert.equal(JSON.stringify(qa).includes("Private notes"), false);
});
test("selectors avoid a global census, preserve legacy QA history and show unknown legacy counts explicitly", async () => {
  const f = await fixture(5);
  let forms = await f.service.reviewForms(admin);
  assert.equal(applicationQueries(f).length, 0);
  assert.equal(forms.items[0].applications, 0, "new opening count is explicitly maintained");
  const stored = f.documents.get(`careerForms/${f.form.id}`);
  delete stored.applicationCount; delete stored.qaApplicationCount; delete stored.reviewCategories;
  stored.category = "Development"; stored.title = "Current developer title";
  forms = await f.service.reviewForms(admin, { refresh: "metadata-refresh" });
  assert.equal(forms.items[0].applications, null);
  assert.equal(applicationQueries(f).length, 0);
  const oldQa = await f.service.reviewForms(lead);
  assert.equal(oldQa.items[0].title, draft.title, "historical QA title is recovered from its own scoped corpus");
  assert.equal(oldQa.items[0].applications, 3);
  assert.equal(applicationQueries(f).length, 1);
  await f.service.reviewForms(lead);
  assert.equal(applicationQueries(f).length, 1, "legacy QA reconciliation is shared and cached");
});
test("an application mutation during a cold census cannot resurrect a stale cached status", async () => {
  const f = await fixture(20), originalCollection = f.db.collection;
  let release, entered;
  const held = new Promise(resolve => { release = resolve; }), ready = new Promise(resolve => { entered = resolve; });
  let intercepted = false;
  const wrap = query => new Proxy(query, { get(target, property) {
    if (property === "get") return async () => { const result = await target.get(); if (!intercepted) { intercepted = true; entered(); await held; } return result; };
    if (typeof target[property] === "function") return (...args) => wrap(target[property](...args));
    return target[property];
  } });
  f.db.collection = path => path === "careerApplications" ? wrap(originalCollection(path)) : originalCollection(path);
  const pending = f.service.applicationStats(admin, { status: "accepted" });
  await ready;
  await f.service.review("app0000", admin, { revision: 1, status: "accepted", feedback: "Accepted", internalNotes: "" });
  release();
  assert.equal((await pending).applications, 1);
  assert.equal((await f.service.applicationStats(admin, { status: "accepted" })).applications, 1);
});
