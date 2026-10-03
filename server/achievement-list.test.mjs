import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createAchievementListRouter, createAchievementListService } from "./achievement-list.mjs";
import { achievementChanges, difficultyRating, DIFFICULTIES, formatVerificationDate, validateListEntries, youtubeVideoId } from "../shared/achievement-list.mjs";
import { createMemoryDb } from "./testing/careers-memory-db.mjs";
import { config } from "./config.mjs";

const entry = (id = "summit") => ({ id, name: `Achievement ${id}`, difficulty: 9.5, verifier: "Verifier", requirements: "Solo, no consumables", videoUrl: "https://youtu.be/abcdefghijk?si=share" });

test("verification metadata accepts real calendar dates, preserves version labels, and supports older entries", () => {
  const [valid] = validateListEntries([{ ...entry(), verifiedOn: "2024-02-29", verifiedVersion: " v0.4.1-hotfix " }]);
  assert.equal(valid.verifiedOn, "2024-02-29"); assert.equal(valid.verifiedVersion, "v0.4.1-hotfix");
  assert.equal(formatVerificationDate(valid.verifiedOn), "29 Feb 2024");
  for (const date of ["2025-02-29", "2026-04-31", "2026-13-01", "2026-00-01", "2026-10-00", "0000-01-01", "03/10/2026", "invalid"]) assert.throws(() => validateListEntries([{ ...entry(), verifiedOn: date }]), { status: 400 });
  assert.throws(() => validateListEntries([{ ...entry(), verifiedVersion: "x".repeat(41) }]), { status: 400 });
  const [legacy] = validateListEntries([entry()]);
  assert.equal(legacy.verifiedOn, ""); assert.equal(legacy.verifiedVersion, "");
  assert.equal(formatVerificationDate(undefined), "Not recorded");
  assert.deepEqual(achievementChanges([legacy], [{ ...legacy, verifiedOn: undefined, verifiedVersion: undefined }]), [], "Missing legacy fields must not create fake edits");
});

test("verification metadata persists and records both edits and clearing in the public log", async () => {
  const service = createAchievementListService(createMemoryDb().db);
  const first = await service.save({ revision: 0, entries: [entry()] }, { id: "admin" });
  const next = await service.save({ revision: 1, entries: [{ ...first.entries[0], verifiedOn: "2026-10-03", verifiedVersion: "v0.4.1" }] }, { id: "admin" });
  assert.equal((await service.read()).entries[0].verifiedOn, "2026-10-03");
  assert.equal((await service.read()).entries[0].verifiedVersion, "v0.4.1");
  assert.deepEqual((await service.history()).publications[0].changes[0].fields, [
    { field: "verifiedOn", before: "", after: "2026-10-03" },
    { field: "verifiedVersion", before: "", after: "v0.4.1" },
  ]);
  await service.save({ revision: 2, entries: [{ ...next.entries[0], verifiedOn: "", verifiedVersion: "" }] }, { id: "admin" });
  assert.deepEqual((await service.history()).publications[0].changes[0].fields, [
    { field: "verifiedOn", before: "2026-10-03", after: "" },
    { field: "verifiedVersion", before: "v0.4.1", after: "" },
  ]);
});

test("every difficulty boundary and decimal tier uses the prescribed scale, including uncapped Eclipse", () => {
  const tiers = ["Baseline", "Low", "Low", "Low", "Mid", "Mid", "Mid", "High", "High", "Peak"];
  for (const [index, definition] of DIFFICULTIES.entries()) {
    for (let tenth = 0; tenth <= 9; tenth++) {
      const value = index + tenth / 10;
      assert.equal(difficultyRating(value).label, `${tiers[tenth]} ${definition.name}`, String(value));
      assert.equal(difficultyRating(value).color, definition.color);
      assert.equal(validateListEntries([{ ...entry(), difficulty: value }])[0].difficulty, value);
    }
  }
  for (const value of [9, 10.9, 12.7, 99]) assert.equal(difficultyRating(value).name, "Eclipse");
  assert.equal(difficultyRating(6.9).label, "Peak Extreme");
  assert.equal(difficultyRating(6.3).label, "Low Extreme");
  assert.equal(difficultyRating(6.95).label, "Baseline Nightmare", "legacy two-decimal ratings round consistently for display and publication");
  for (const value of [-1, NaN, Infinity, "6.0", null, Number.MAX_VALUE]) assert.equal(difficultyRating(value), null);
});

test("the public diff captures all changed fields, additions, removals, and shifted ranks by stable ID", () => {
  const before = [entry("a"), entry("b"), entry("c")];
  const after = [entry("new"), { ...before[0], name: "Renamed", difficulty: 6.9, verifier: "New verifier", requirements: "Different rules", videoUrl: "" }];
  const changes = achievementChanges(before, after);
  assert.equal(changes.length, 4);
  const added = changes.find(change => change.id === "new");
  assert.equal(added.kind, "added"); assert.equal(added.toPosition, 1); assert.equal(added.fields.length, 5);
  const updated = changes.find(change => change.id === "a");
  assert.equal(updated.fromPosition, 1); assert.equal(updated.toPosition, 2);
  assert.deepEqual(updated.fields.map(field => field.field), ["name", "difficulty", "verifier", "requirements", "videoUrl"]);
  assert.equal(updated.fields[1].before, 9.5); assert.equal(updated.fields[1].after, 6.9);
  assert.equal(changes.find(change => change.id === "c").kind, "removed");
  assert.equal(changes.find(change => change.id === "c").fromPosition, 3);
  const moved = achievementChanges(before, [before[2], before[0], before[1]]);
  assert.equal(moved.length, 3); assert.ok(moved.every(change => change.kind === "updated" && change.fields.length === 0));
  assert.deepEqual(achievementChanges(before, before), []);
});

test("history is saved atomically, keeps before/after values and author attribution, and ignores no-op saves", async () => {
  const memory = createMemoryDb(); const service = createAchievementListService(memory.db);
  const actor = { id: "private-discord-id", displayName: "List Admin" };
  const first = await service.save({ revision: 0, entries: [entry()], note: " First verification " }, actor);
  const noOp = await service.save({ ...first, note: "Not a change" }, actor);
  assert.equal(noOp.revision, first.revision); assert.equal(memory.writes(), 2);
  const changed = await service.save({ revision: 1, entries: [{ ...first.entries[0], difficulty: 6.9 }], note: "Reassessed after verification." }, actor);
  const history = await service.history();
  assert.equal(history.publications.length, 2);
  assert.equal(history.publications[0].editorName, "List Admin");
  assert.equal(history.publications[0].createdAt, changed.updatedAt);
  assert.equal(history.publications[0].changes[0].fields[0].before, 9.5);
  assert.equal(history.publications[0].changes[0].fields[0].after, 6.9);
  assert.equal(history.publications[1].note, "First verification");
  assert.ok(!JSON.stringify(history).includes(actor.id));
  const writesBefore = memory.writes();
  await assert.rejects(service.save({ revision: 1, entries: [] }, actor), { status: 409 });
  await assert.rejects(service.save({ revision: 2, entries: [], note: "x".repeat(501) }, actor), { status: 400 });
  assert.equal(memory.writes(), writesBefore);
  const failing = createAchievementListService({ ...memory.db, runTransaction: callback => memory.db.runTransaction(transaction => callback({ ...transaction, set: (ref, value) => { if (ref.path.startsWith("achievementListChanges/")) throw new Error("Log write failed"); transaction.set(ref, value); } })) });
  await assert.rejects(failing.save({ revision: 2, entries: [] }, actor), /Log write failed/);
  assert.equal(memory.writes(), writesBefore);
  assert.equal((await service.read()).revision, 2);
  assert.equal((await service.history()).publications.length, 2);
});

test("history pagination retains every publication with stable cursors while newer edits arrive", async () => {
  const memory = createMemoryDb(); const service = createAchievementListService(memory.db);
  for (let revision = 0; revision < 23; revision++) await service.save({ revision, entries: [{ ...entry(), verifier: `Verifier ${revision}` }] }, { id: "admin" });
  const first = await service.history();
  assert.deepEqual(first.publications.map(item => item.revision), [23, 22, 21, 20, 19, 18, 17, 16, 15, 14]);
  await service.save({ revision: 23, entries: [] }, { id: "admin" });
  const second = await service.history(first.nextCursor);
  const third = await service.history(second.nextCursor);
  assert.deepEqual([...first.publications, ...second.publications, ...third.publications].map(item => item.revision), Array.from({ length: 23 }, (_, index) => 23 - index));
  assert.equal(third.nextCursor, null);
  assert.equal((await service.history()).publications[0].revision, 24);
  for (const cursor of ["", "../main", "5", [], { before: "0000000000000001" }]) await assert.rejects(service.history(cursor), { status: 400 });
});

test("YouTube links accept individual videos and reject unsafe or unrelated URLs", () => {
  for (const url of ["https://youtu.be/abcdefghijk", "https://www.youtube.com/watch?v=abcdefghijk&t=20", "https://m.youtube.com/watch?v=abcdefghijk", "https://youtube.com/shorts/abcdefghijk", "https://www.youtube.com/live/abcdefghijk", "https://youtube.com/embed/abcdefghijk"]) assert.equal(youtubeVideoId(url), "abcdefghijk");
  for (const url of ["javascript:alert(1)", "https://youtube.com.evil.example/watch?v=abcdefghijk", "https://youtube.com@evil.example/watch?v=abcdefghijk", "https://evil.example@youtube.com/watch?v=abcdefghijk", "https://youtube.com/playlist?list=abcdefghijk", "https://youtu.be/short", "https://youtu.be/abcdefghijk/extra", "https://youtube.com:444/watch?v=abcdefghijk", "", null]) assert.equal(youtubeVideoId(url), null);
});

test("list validation enforces the cap, unique identity/name, required fields and numeric ratings", () => {
  assert.equal(validateListEntries(Array.from({ length: 50 }, (_, index) => entry(String(index)))).length, 50);
  for (const input of [null, {}, Array.from({ length: 51 }, (_, index) => entry(String(index))), [entry(), entry()], [entry(), { ...entry("second"), name: " ACHIEVEMENT SUMMIT " }]]) assert.throws(() => validateListEntries(input), { status: 400 });
  for (const patch of [{ difficulty: -0.1 }, { difficulty: Infinity }, { difficulty: NaN }, { difficulty: "9" }, { name: " " }, { name: "x".repeat(121) }, { verifier: "" }, { id: "invalid/path" }, { requirements: "x".repeat(2001) }, { videoUrl: "https://example.com/video" }]) assert.throws(() => validateListEntries([{ ...entry(), ...patch }]), { status: 400 });
  const [normalized] = validateListEntries([{ ...entry(), name: " Summit ", unwanted: "ignored" }]);
  assert.equal(normalized.name, "Summit"); assert.equal(normalized.videoUrl, "https://www.youtube.com/watch?v=abcdefghijk"); assert.equal(normalized.unwanted, undefined);
  assert.equal(validateListEntries([{ ...entry(), videoUrl: "" }])[0].videoUrl, "");
});

test("publishing persists consecutive rank order, edits, removal and empty lists without exposing the editor identity", async () => {
  const memory = createMemoryDb(); const service = createAchievementListService(memory.db);
  assert.deepEqual(await service.read(), { entries: [], revision: 0, updatedAt: null });
  const initial = await service.save({ revision: 0, entries: [entry("a"), entry("b"), entry("c")] }, { id: "admin" });
  const reordered = await service.save({ revision: initial.revision, entries: [initial.entries[2], { ...initial.entries[0], verifier: "New verifier", difficulty: 8 }] }, { id: "admin" });
  assert.deepEqual(reordered.entries.map(item => item.id), ["c", "a"]);
  assert.equal(reordered.entries[1].verifier, "New verifier"); assert.equal(reordered.entries[1].difficulty, 8);
  assert.deepEqual(await createAchievementListService(memory.db).read(), reordered);
  assert.equal(reordered.updatedBy, undefined); assert.equal(memory.documents.get("achievementLists/main").updatedBy, "admin");
  assert.deepEqual((await service.save({ revision: 2, entries: [] }, { id: "admin" })).entries, []);
});

test("simultaneous editors cannot overwrite each other, including the first publication", async () => {
  const memory = createMemoryDb(); const service = createAchievementListService(memory.db);
  const results = await Promise.allSettled(["a", "b"].map(id => service.save({ revision: 0, entries: [entry(id)] }, { id })));
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(results.find(result => result.status === "rejected").reason.status, 409);
  assert.equal(memory.writes(), 2);
  await assert.rejects(service.save({ revision: 0, entries: [] }, { id: "late" }), { status: 409 });
  await assert.rejects(service.save({ entries: [] }, { id: "invalid" }), { status: 400 });
  assert.equal((await service.read()).entries.length, 1);
});

test("HTTP list is public while edits require an admin session, same origin and CSRF", async t => {
  const memory = createMemoryDb(); const service = createAchievementListService(memory.db);
  const app = express(); app.use(express.json());
  const auth = (req, res, next) => {
    const role = req.get("X-Test-Role");
    if (!role) return res.status(401).json({ error: "Sign in" });
    req.authUser = { id: `test-${role}`, role }; req.authSession = { role, csrfToken: "fixture-csrf" }; next();
  };
  app.use("/api/list", createAchievementListRouter({ service, auth }));
  app.use((error, _req, res, _next) => res.status(error.status || 500).json({ error: error.message }));
  const server = await new Promise(resolve => { const instance = app.listen(0, "127.0.0.1", () => resolve(instance)); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/api/list`;
  const write = (role, extra = {}, body = { revision: 0, entries: [entry()] }) => fetch(url, { method: "PUT", headers: { "Content-Type": "application/json", ...(role ? { "X-Test-Role": role } : {}), ...extra }, body: JSON.stringify(body) });
  assert.equal((await fetch(url + "/history")).status, 200); assert.equal((await fetch(url + "/history?before=invalid")).status, 400); assert.equal((await fetch(url)).status, 200); assert.equal((await write()).status, 401);
  const trusted = { "X-CSRF-Token": "fixture-csrf", Origin: config.appOrigin };
  for (const role of ["member", "qa", "leadqa"]) assert.equal((await write(role, trusted)).status, 403);
  assert.equal((await write("dev")).status, 403);
  assert.equal((await write("dev", { ...trusted, Origin: "https://untrusted.example" })).status, 403);
  assert.equal((await write("dev", { ...trusted, "X-CSRF-Token": "bad" })).status, 403);
  assert.equal(memory.writes(), 0);
  assert.equal((await write("dev", trusted)).status, 200);
  assert.equal((await write("dev", trusted)).status, 409);
  assert.equal((await write("dev", trusted, { revision: 1, entries: [{ ...entry(), difficulty: -1 }] })).status, 400);
  const published = await (await fetch(url)).json(); assert.equal(published.entries[0].name, entry().name); assert.equal(published.revision, 1); assert.equal(published.updatedBy, undefined);
});
