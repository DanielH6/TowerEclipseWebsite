import test from "node:test";
import assert from "node:assert/strict";
import { createCareersService } from "./careers-service.mjs";
import { createMemoryDb } from "./testing/careers-memory-db.mjs";

const applicant = { id: "applicant", username: "applicant", displayName: "Applicant", role: "member" };
const developer = { id: "developer", username: "developer", displayName: "Developer", role: "dev" };
const lead = { id: "qa-lead", username: "lead", displayName: "QA Lead", role: "leadqa" };
const draft = { title: "Tester application", category: "Quality assurance", description: "Help test Tower Eclipse.", commitment: "Volunteer", confirmation: "Thanks!", closesAt: null,
  questions: [{ id: "experience", type: "short", label: "Experience", help: "", required: true }] };

async function fixture(category = "Quality assurance") {
  const memory = createMemoryDb({
    "websiteAccounts/applicant": { roblox: { userId: "123", username: "Player", verifiedAt: "2026-11-10T00:00:00.000Z" } },
    "websiteRobloxLinks/123": { discordId: "applicant" },
  });
  let now = Date.parse("2026-11-10T01:00:00.000Z");
  const service = createCareersService(memory.db, { now: () => now, aiProvider: { enabled: false } });
  const created = await service.createForm();
  const form = await service.saveForm(created.id, { action: "publish", revision: created.revision, draft: { ...draft, category } });
  const input = { versionId: form.publishedVersion, answers: { experience: "I reproduce bugs." }, consent: true };
  const application = await service.submit(form.id, applicant, input);
  return { ...memory, service, form, application, input, advance: ms => { now += ms; } };
}

test("reviewers explicitly mark their own read state without changing application content or review revisions", async () => {
  const f = await fixture(), { id } = f.application;
  const before = structuredClone(f.documents.get(`careerApplications/${id}`));
  assert.deepEqual((await f.service.application(id, lead, true)).application.readState, { readByYou: false, readers: [] });
  assert.deepEqual(f.documents.get(`careerApplications/${id}`), before, "viewing never marks an application read");
  const marked = await f.service.setApplicationReadState(id, lead, { read: true, submissionRevision: 1 });
  assert.equal(marked.readByYou, true);
  assert.equal(marked.readers.length, 1);
  assert.equal(marked.readers[0].id, lead.id);
  assert.equal(marked.readers[0].displayName, lead.displayName);
  assert.ok(Number.isFinite(Date.parse(marked.readers[0].readAt)));
  const { readReceipts, ...after } = f.documents.get(`careerApplications/${id}`);
  assert.deepEqual(after, before, "marking read leaves status, answers, notes, history, timestamps and review revision unchanged");
  f.advance(60_000);
  const writesAfterMark = f.writes();
  assert.deepEqual(await f.service.setApplicationReadState(id, lead, { read: true, submissionRevision: 1 }), marked, "repeat marking preserves the first read time");
  assert.equal(f.writes(), writesAfterMark, "repeat marking does not write");
  assert.deepEqual(await f.service.setApplicationReadState(id, lead, { read: false, submissionRevision: 1 }), { readByYou: false, readers: [] });
  await f.service.review(id, developer, { revision: before.revision, status: "under_review", feedback: "Thanks", internalNotes: "Private note" });
  assert.equal((await f.service.application(id, developer, true)).application.status, "under_review", "read tracking does not cause a stale review conflict");
});

test("concurrent reviewers keep independent receipts and one reviewer cannot clear another's mark", async () => {
  const f = await fixture(), { id } = f.application;
  await Promise.all([developer, lead].map(user => f.service.setApplicationReadState(id, user, { read: true, submissionRevision: 1 })));
  const detail = (await f.service.application(id, developer, true)).application;
  assert.equal(detail.readState.readByYou, true);
  assert.deepEqual(detail.readState.readers.map(reader => reader.id).sort(), [developer.id, lead.id].sort());
  const unmarked = await f.service.setApplicationReadState(id, developer, { read: false, submissionRevision: 1, reviewerId: lead.id });
  assert.equal(unmarked.readByYou, false);
  assert.deepEqual(unmarked.readers.map(reader => reader.id), [lead.id]);
  assert.equal((await f.service.application(id, lead, true)).application.readState.readByYou, true);
});

test("read badges are viewer-specific in normal, searched and ranked lists and never exposed to applicants", async () => {
  const f = await fixture(), { id } = f.application;
  // Warm the summary index before marking: searched/ranked results must still
  // project the current authorized document rather than stale cached receipts.
  await f.service.listApplications(developer, { formId: f.form.id, search: "applicant" }, true);
  await f.service.setApplicationReadState(id, lead, { read: true, submissionRevision: 1 });
  for (const options of [{}, { sort: "oldest" }, { formId: f.form.id, search: "applicant" }, { formId: f.form.id, sort: "ai_rank" }, { formId: f.form.id, sort: "quality" }]) {
    const own = (await f.service.listApplications(lead, options, true)).items[0];
    const other = (await f.service.listApplications(developer, options, true)).items[0];
    assert.equal(own.readState.readByYou, true);
    assert.equal(other.readState.readByYou, false);
    assert.deepEqual(other.readState.readers.map(reader => reader.id), [lead.id]);
    assert.equal(own.readReceipts, undefined, "raw storage is not part of reviewer responses");
  }
  for (const item of [(await f.service.application(id, applicant)).application, ...(await f.service.listApplications(applicant)).items]) {
    assert.equal(item.readState, undefined);
    assert.equal(item.readReceipts, undefined);
    assert.equal(JSON.stringify(item).includes(lead.id), false);
  }
});

test("resubmitted answers need a fresh read and stale tabs cannot mark the new submission", async () => {
  const f = await fixture(), { id } = f.application;
  await f.service.setApplicationReadState(id, lead, { read: true, submissionRevision: 1 });
  await f.service.resubmit(id, applicant, { revision: 1, answers: { experience: "Updated experience" }, consent: true });
  assert.deepEqual((await f.service.application(id, lead, true)).application.readState, { readByYou: false, readers: [] });
  await assert.rejects(f.service.setApplicationReadState(id, lead, { read: true, submissionRevision: 1 }), { status: 409 });
  const marked = await f.service.setApplicationReadState(id, developer, { read: true, submissionRevision: 2 });
  assert.equal(marked.readByYou, true);
  await assert.rejects(f.service.setApplicationReadState(id, developer, { read: false, submissionRevision: 1 }), { status: 409 });
  assert.equal((await f.service.application(id, developer, true)).application.readState.readByYou, true);
});

test("read tracking enforces reviewer scope and rejects malformed requests without writing", async () => {
  const f = await fixture(), { id } = f.application, before = f.writes();
  for (const role of ["member", "qa", "pentester"]) await assert.rejects(f.service.setApplicationReadState(id, { id: role, role }, { read: true, submissionRevision: 1 }), { status: 403 });
  for (const input of [undefined, {}, { read: "true", submissionRevision: 1 }, { read: 1, submissionRevision: 1 }, { read: true }, { read: false, submissionRevision: "1" }]) {
    await assert.rejects(f.service.setApplicationReadState(id, developer, input), { status: 400 });
  }
  assert.equal(f.writes(), before);
  const development = await fixture("Development");
  await assert.rejects(development.service.setApplicationReadState(development.application.id, lead, { read: true, submissionRevision: 1 }), { status: 404 });
  assert.equal((await development.service.setApplicationReadState(development.application.id, developer, { read: true, submissionRevision: 1 })).readByYou, true);
});
