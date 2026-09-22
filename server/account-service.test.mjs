import assert from "node:assert/strict";
import test from "node:test";
import { accountActivityFields, buildCalendar, createAccountService, DAY_MS, decodeCursor, isAccountStaff } from "./account-service.mjs";

const NOW = Date.parse("2026-09-14T12:00:00Z");
function fixture(initial = {}) {
  const records = new Map(Object.entries(initial));
  const calls = { reads: 0, writes: 0, counts: 0 };
  function doc(path) {
    return { path, id: path.split("/").at(-1), get: async () => snapshot(path) };
  }
  function snapshot(path) { return { ref: doc(path), id: path.split("/").at(-1), exists: records.has(path), data: () => records.get(path) }; }
  const field = (value, path) => path.split(".").reduce((item, key) => item?.[key], value);
  function query(collection, filters = [], orders = [], limit = Infinity, cursor = null, group = false) {
    const self = {
      where: (key, op, value) => query(collection, [...filters, [key, op, value]], orders, limit, cursor, group),
      orderBy: (key, direction) => query(collection, filters, [...orders, [key, direction]], limit, cursor, group),
      limit: value => query(collection, filters, orders, value, cursor, group),
      select: () => self,
      startAfter: (...value) => query(collection, filters, orders, limit, value, group),
      async get() {
        calls.reads++;
        let rows = [...records.entries()].filter(([path, data]) => (group ? path.split("/").at(-2) === collection : path.split("/").slice(0, -1).join("/") === collection)
          && filters.every(([key, op, value]) => { const actual = field(data, key); return op === "==" ? actual === value : op === ">=" ? actual >= value : actual <= value; }));
        rows.sort((a, b) => {
          for (const [key, direction] of orders) { const av = key === "__name__" ? a[0] : field(a[1], key); const bv = key === "__name__" ? b[0] : field(b[1], key); const diff = av < bv ? -1 : av > bv ? 1 : 0; if (diff) return direction === "desc" ? -diff : diff; } return 0;
        });
        if (cursor) cursor = [cursor[0].toDate ? cursor[0].toDate() : cursor[0], cursor[1]];
        if (cursor) rows = rows.filter(([path, data]) => data.createdAt < cursor[0] || (+data.createdAt === +cursor[0] && path < cursor[1]));
        return { docs: rows.slice(0, limit).map(([path]) => snapshot(path)) };
      },
      async count() { calls.counts++; return (await self.get()).docs.length; },
    }; return self;
  }
  return { records, calls, db: { doc, collection: name => query(name), collectionGroup: name => query(name, [], [], Infinity, null, true),
    async runTransaction(callback) { return callback({ get: async reference => snapshot(reference.path),
      set(reference, data, options) { calls.writes++; records.set(reference.path, options?.merge ? { ...records.get(reference.path), ...data } : data); },
      update(reference, data) { calls.writes++; records.set(reference.path, { ...records.get(reference.path), ...data }); },
    }); },
  } };
}
const report = (user = "alice", age = 0, extras = {}) => ({ reporter: { discordId: user }, createdAt: new Date(NOW - age), displayId: "TE-1", description: "An issue", status: { id: "approved" }, ...extras });

test("counts use exact rolling boundaries, legacy submissions, and lifetime beyond the public 1000 report cap", async () => {
  const records = Object.fromEntries(Array.from({ length: 1200 }, (_, i) => [`bugReports/old${i}`, report("alice", 400 * DAY_MS)]));
  Object.assign(records, { "bugReports/now": report(), "bugReports/day": report("alice", DAY_MS), "bugReports/week": report("alice", 7 * DAY_MS), "bugReports/month": report("alice", 30 * DAY_MS), "bugReports/outside": report("alice", 30 * DAY_MS + 1), "bugReports/draft": report("alice", 0, { submissionState: "uploading" }), "bugReports/other": report("bob"), "bugReports/future": report("alice", -1) });
  const { db, calls } = fixture(records);
  const service = createAccountService(db, { now: () => NOW });
  assert.deepEqual((await service.stats("alice")).counts, { "24h": 2, "7d": 3, "30d": 4, lifetime: 1205 });
  const before = calls.counts;
  await service.stats("alice");
  assert.equal(calls.counts, before, "cached refresh does not issue new count queries");
  assert.equal(calls.writes, 0, "analytics do not write counters");
});

test("profile creation and identity updates preserve the first login, store no OAuth tokens, and do not persist roles", async () => {
  const { db, records, calls } = fixture();
  let clock = NOW;
  const service = createAccountService(db, { now: () => clock });
  const user = { id: "alice", username: "a", displayName: "Alice", avatarUrl: null, accessToken: "private", role: "dev" };
  const first = await service.ensureProfile(user);
  assert.equal(first.firstLoginAt, new Date(NOW).toISOString());
  assert.equal(calls.writes, 1);
  clock += DAY_MS;
  await service.ensureProfile(user);
  assert.equal(calls.writes, 1);
  const linked = { userId: "123456789", username: "RobloxTester", linkedAt: new Date(NOW), verifiedAt: new Date(NOW) };
  records.get("websiteAccounts/alice").roblox = linked;
  const changed = await service.ensureProfile({ ...user, username: "renamed" });
  assert.equal(changed.firstLoginAt, first.firstLoginAt);
  assert.equal(changed.username, "renamed");
  assert.deepEqual(changed.roblox, { ...linked, linkedAt: new Date(NOW).toISOString(), verifiedAt: new Date(NOW).toISOString() });
  assert.deepEqual(records.get("websiteAccounts/alice").roblox, linked);
  assert.equal(records.get("websiteAccounts/alice").role, undefined);
  assert.equal(records.get("websiteAccounts/alice").accessToken, undefined);
});

test("personal report pagination handles tied timestamps, status filters, and another user's cursor without exposing their reports", async () => {
  const records = Object.fromEntries(Array.from({ length: 45 }, (_, i) => [`bugReports/a${String(i).padStart(3, "0")}`, report()]));
  records["bugReports/bob"] = report("bob");
  records["bugReports/rejected"] = report("alice", 0, { status: { id: "rejected" } });
  const { db } = fixture(records);
  const service = createAccountService(db, { now: () => NOW });
  const first = await service.reports("alice", { status: "approved" });
  const second = await service.reports("alice", { status: "approved", cursor: first.nextCursor });
  const third = await service.reports("alice", { status: "approved", cursor: second.nextCursor });
  assert.equal(first.reports.length, 20);
  assert.equal(third.reports.length, 5);
  assert.equal(third.nextCursor, null);
  assert.equal(new Set([...first.reports, ...second.reports, ...third.reports].map(item => item.id)).size, 45);
  const forged = Buffer.from(JSON.stringify({ at: new Date(NOW).toISOString(), path: "bugReports/bob" })).toString("base64url");
  assert.ok((await service.reports("alice", { cursor: forged })).reports.every(item => item.id !== "bob"));
  assert.throws(() => decodeCursor("garbage"), /Invalid report page/);
});

test("inbox projection records public comments and review/status changes but excludes private notes and draft changes", () => {
  const current = report();
  for (const action of ["report_updated", "report_reopened", "report_approved", "report_rejected", "comment_added"]) {
    const projected = accountActivityFields("one", action, {}, current, { newStatus: { label: "Resolved" }, comment: "secret detail" });
    assert.equal(projected.recipientId, "alice");
    assert.equal(projected.reportId, "one");
    assert.equal(JSON.stringify(projected).includes("secret detail"), false);
  }
  assert.match(accountActivityFields("one", "report_updated", {}, current, { newStatus: { label: "Resolved" } }).accountSummary, /Resolved/);
  assert.deepEqual(accountActivityFields("one", "developer_note_added", {}, current), {});
  assert.deepEqual(accountActivityFields("one", "report_updated", {}, { ...current, submissionState: "uploading" }), {});
});

test("activity stays scoped to its recipient and mark-read is monotonic and leaves newer updates unread", async () => {
  const { db, records, calls } = fixture({ "websiteAccounts/alice": { activitySeenAt: null }, "bugReports/a/activity/one": { recipientId: "alice", actor: { discordId: "dev", displayName: "Dev" }, reportId: "a", createdAt: new Date(NOW - 1000) }, "bugReports/b/activity/two": { recipientId: "bob", createdAt: new Date(NOW) } });
  const service = createAccountService(db, { now: () => NOW });
  assert.equal((await service.activity("alice")).events.length, 1);
  const at = new Date(NOW - 1000).toISOString();
  await service.markSeen("alice", at);
  await service.markSeen("alice", new Date(NOW - 2000).toISOString());
  assert.equal(calls.writes, 1);
  assert.equal(records.get("websiteAccounts/alice").activitySeenAt.toISOString(), at);
  await assert.rejects(service.markSeen("alice", new Date(NOW + 1).toISOString()), /Invalid activity/);
});

test("calendar uses 365 UTC days, excludes drafts, and explicitly signals its read budget", () => {
  const docs = [{ data: () => report() }, { data: () => report("alice", 0, { submissionState: "uploading" }) }, { data: () => report("alice", 366 * DAY_MS) }];
  const calendar = buildCalendar(docs, NOW);
  assert.equal(calendar.days.length, 365);
  assert.equal(calendar.days.at(-1).count, 1);
  assert.equal(calendar.limited, false);
  assert.equal(buildCalendar(Array.from({ length: 2001 }, () => docs[0]), NOW).limited, true);
});

test("staff account sections cover QA, QA lead, and Developer, preserving the existing admin mapping", () => {
  for (const role of ["qa", "leadqa", "dev"]) assert.equal(isAccountStaff(role), true);
  for (const role of ["member", null, "admin"]) assert.equal(isAccountStaff(role), false);
});

 test("pagination retains microsecond timestamp precision", () => {
  const raw = "2026-09-14T12:00:00.123456Z";
  const cursor = Buffer.from(JSON.stringify({ at: raw, path: "bugReports/precise" })).toString("base64url");
  assert.equal(decodeCursor(cursor).at.toISOString(), raw);
});

test("tester directory tracks verified ranks, excludes other ranks and secrets, and resists older sessions", async () => {
  const { db, records } = fixture();
  const service = createAccountService(db, { now: () => NOW });
  const user = { id: "123456", username: "tester", displayName: "Tester", avatarUrl: null, role: "qa", roleCheckedAt: NOW };
  await service.ensureProfile(user);
  records.get("websiteAccounts/123456").roblox = { userId: "private" };
  let roster = await service.testers();
  assert.equal(roster.testers.length, 1);
  assert.equal(roster.testers[0].role, "qa");
  assert.equal(roster.testers[0].roblox, undefined);
  assert.equal(roster.testers[0].roleVerifiedAt, new Date(NOW).toISOString());
  await service.ensureProfile({ ...user, role: "member", roleCheckedAt: NOW + 1000 });
  await service.ensureProfile(user);
  assert.equal((await service.testers()).testers.length, 0);
  await assert.rejects(service.tester(user.id), /not found/);
  await assert.rejects(service.tester("../other"), /Invalid tester/);
});

test("tester viewer scopes report history, counts and update activity to selected account", async () => {
  const { db } = fixture({ "bugReports/one": report("123456"), "bugReports/two": report("654321") });
  const service = createAccountService(db, { now: () => NOW });
  await service.ensureProfile({ id: "123456", username: "tester", displayName: "Tester", avatarUrl: null, role: "leadqa", roleCheckedAt: NOW });
  const detail = await service.tester("123456");
  assert.deepEqual(detail.reports.map(item => item.id), ["one"]);
  assert.equal(detail.stats.counts.lifetime, 1);
});
