import test from "node:test";
import assert from "node:assert/strict";
import { createAccountService } from "./account-service.mjs";
import { createAccountCalendar } from "./account-calendar.mjs";
import { createWorkflowMemoryDb } from "./testing/workflow-memory-db.mjs";

const NOW = Date.parse("2026-11-07T12:00:00Z");
const report = (id, extra = {}) => ({ id, reporter: { discordId: "123456" }, createdAt: new Date(NOW - 60_000), submissionState: "submitted", ...extra });

test("daily calendar builds complete legacy history once, then reads one summary and applies idempotent contribution changes", async () => {
  const f = createWorkflowMemoryDb(Object.fromEntries(Array.from({ length: 2450 }, (_, index) => [`bugReports/r${index}`, report(`r${index}`)])));
  const model = createAccountCalendar(f.db, { now: () => NOW });
  const first = await model.read("123456"); assert.equal(first.days.length, 365); assert.equal(first.days.at(-1).count, 2450); assert.equal(first.limited, false);
  assert.equal(f.calls.filter(call => call.path === "bugReports").length, 5);
  const before = f.calls.length; await model.read("123456"); assert.equal(f.calls.length - before, 1);
  const added = report("new"); await model.record(null, added); await model.record(null, added);
  assert.equal((await model.read("123456")).days.at(-1).count, 2451);
  await model.record(added, null); await model.record(added, null);
  assert.equal((await model.read("123456")).days.at(-1).count, 2450);
  const draft = report("draft", { submissionState: "uploading" }); await model.record(null, draft);
  assert.equal((await model.read("123456")).days.at(-1).count, 2450);
  await model.record(draft, { ...draft, submissionState: "submitted" });
  assert.equal((await model.read("123456")).days.at(-1).count, 2451);
  assert.equal((await model.read("654321")).days.at(-1).count, 0);
});

test("calendar reconciliation and late callbacks cannot double count an already scanned contribution", async () => {
  const value = report("existing"), f = createWorkflowMemoryDb({ "bugReports/existing": value }), model = createAccountCalendar(f.db, { now: () => NOW });
  await model.read("123456"); await model.record(null, value);
  assert.equal((await model.read("123456")).days.at(-1).count, 1);
  f.documents.delete("bugReports/existing"); model.invalidate("123456"); await model.read("123456"); await model.record(value, null);
  assert.equal((await model.read("123456")).days.at(-1).count, 0);
});

test("tester directory reads 51 rows per page, caches searches, and report-only pages reuse the private header", async () => {
  const seed = Object.fromEntries(Array.from({ length: 72 }, (_, index) => [`websiteAccounts/${123456 + index}`, { displayName: `Tester ${String(index).padStart(3, "0")}`, username: `user${index}`, verifiedRole: "qa", roleVerifiedAt: new Date(NOW).toISOString() }]));
  seed["websiteAccounts/654321"] = { displayName: "Private member", username: "ordinary", verifiedRole: "member" };
  for (let index = 0; index < 45; index++) seed[`bugReports/r${String(index).padStart(3, "0")}`] = report(`r${index}`);
  const f = createWorkflowMemoryDb(seed), service = createAccountService(f.db, { now: () => NOW });
  const first = await service.testers(); assert.equal(first.testers.length, 50); assert.ok(first.nextCursor);
  const directoryQuery = f.calls.find(call => call.path === "websiteAccounts"); assert.equal(directoryQuery.maximum, 51); assert.equal(directoryQuery.documents, 51);
  const second = await service.testers({ cursor: first.nextCursor }); assert.equal(second.testers.length, 22);
  assert.equal(new Set([...first.testers, ...second.testers].map(item => item.discordId)).size, 72);
  assert.equal((await service.testers({ search: "user71" })).testers[0].username, "user71"); const searchReads = f.calls.length; await service.testers({ search: "user71" }); assert.equal(f.calls.length, searchReads);
  const detail = await service.tester("123456"), before = f.calls.length;
  await service.testerReports("123456", { cursor: detail.nextCursor });
  const calls = f.calls.slice(before); assert.equal(calls.length, 1); assert.equal(calls[0].path, "bugReports"); assert.equal(calls[0].maximum, 21);
});

test("profile identity requests share a fill, identity changes invalidate directory visibility, and linking invalidation reloads safely", async () => {
  const f = createWorkflowMemoryDb(), service = createAccountService(f.db, { now: () => NOW });
  const user = { id: "123456", username: "tester", displayName: "Tester", avatarUrl: null, role: "qa", roleCheckedAt: NOW };
  await Promise.all([service.ensureProfile(user), service.ensureProfile(user)]);
  assert.equal(f.calls.filter(call => call.path === "websiteAccounts/123456").length, 1);
  assert.equal((await service.testers()).testers.length, 1);
  await service.ensureProfile({ ...user, role: "member", roleCheckedAt: NOW + 1 });
  assert.equal((await service.testers()).testers.length, 0);
  const before = f.calls.length; service.invalidateProfile(); await service.ensureProfile(user); assert.equal(f.calls.length, before + 1);
  assert.equal(f.documents.get("websiteAccounts/123456").verifiedRole, "member", "stale identity requests cannot regrant a recorded display rank");
});
