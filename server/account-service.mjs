import { Timestamp } from "./firestore-timestamp.mjs";
import { createReadCache } from "./read-cache.mjs";
import { createAccountCalendar } from "./account-calendar.mjs";

// Personal routes use the authenticated ID; admin target IDs require the dev-only router guard.
export const CALENDAR_LIMIT = 2000;
export const DAY_MS = 86_400_000;
const STAFF = new Set(["qa", "pentester", "leadqa", "dev"]);
export const isAccountStaff = (role) => STAFF.has(role);

export function toIso(value) {
  if (!value) return null;
  return value.toDate ? value.toDate().toISOString() : new Date(value).toISOString();
}

export function serializeAccountValue(value) {
  if (value instanceof Date) return value.toISOString();
  if (value?.toDate) return toIso(value);
  if (Array.isArray(value)) return value.map(serializeAccountValue);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, serializeAccountValue(item)]));
  return value;
}

export function accountActivityFields(reportId, action, actor, report, details = {}) {
  const allowed = new Set(["report_updated", "report_reopened", "report_approved", "report_rejected", "comment_added"]);
  if (!allowed.has(action) || !report?.reporter?.discordId || report.submissionState === "uploading") return {};
  return {
    recipientId: report.reporter.discordId,
    reportId,
    displayId: report.displayId,
    // Store no comment bodies, private notes, or report descriptions in the inbox projection.
    accountSummary: action === "comment_added" ? "left a comment on your report"
      : action === "report_approved" ? "approved your report"
      : action === "report_rejected" ? "rejected your report"
      : details.newStatus ? `changed the status to ${details.newStatus.label}`
      : "updated your report",
  };
}

export function encodeCursor(document) {
  return Buffer.from(JSON.stringify({ at: document.data().createdAt?.toISOString?.() ?? toIso(document.data().createdAt), path: document.ref.path })).toString("base64url");
}

export function decodeCursor(raw) {
  if (!raw) return null;
  try {
    if (typeof raw !== "string" || raw.length > 1000) throw new Error();
    const value = JSON.parse(Buffer.from(raw, "base64url").toString());
    if (typeof value.at !== "string" || !Number.isFinite(Date.parse(value.at))
      || typeof value.path !== "string" || !/^bugReports\/[\w-]+$/.test(value.path)) throw new Error();
    return { at: new Timestamp(value.at), path: value.path };
  } catch {
    throw Object.assign(new Error("Invalid report page. Return to the first page."), { status: 400 });
  }
}

export function buildCalendar(documents, now) {
  const end = new Date(now);
  end.setUTCHours(0, 0, 0, 0);
  const start = end.getTime() - 364 * DAY_MS;
  const days = Array.from({ length: 365 }, (_, index) => ({ date: new Date(start + index * DAY_MS).toISOString().slice(0, 10), count: 0 }));
  const byDate = new Map(days.map(day => [day.date, day]));
  for (const document of documents.slice(0, CALENDAR_LIMIT)) {
    const report = document.data();
    if (report.submissionState === "uploading") continue;
    const day = byDate.get(toIso(report.createdAt)?.slice(0, 10));
    if (day) day.count += 1;
  }
  return { days, limited: documents.length > CALENDAR_LIMIT, limit: CALENDAR_LIMIT, timezone: "UTC" };
}

export function createAccountService(db, { now = () => Date.now() } = {}) {
  const cache = createReadCache({ name: "account-analytics", maxEntries: 400, maxBytes: 8 * 1024 * 1024, now });
  const profiles = createReadCache({ name: "account-profiles", maxEntries: 250, maxBytes: 2 * 1024 * 1024, now, ttlMs: 15_000 });
  const roster = createReadCache({ name: "tester-directory", maxEntries: 100, maxBytes: 4 * 1024 * 1024, now, ttlMs: 300_000 });
  const calendars = createAccountCalendar(db, { now });
  const cached = (key, ttlMs, operation) => cache.get(key, operation, { ttlMs });
  function invalidateReports(userId) {
    for (const prefix of ["stats", "calendar", "activity", "tester-header"]) userId ? cache.invalidate(`${prefix}:${userId}`) : cache.clear();
  }
  async function recordReportContribution(before, after) {
    try { await calendars.record(before, after); }
    finally { for (const user of new Set([before?.reporter?.discordId, after?.reporter?.discordId].filter(Boolean))) invalidateReports(user); }
  }

  async function ensureProfile(user) {
    const reference = db.doc(`websiteAccounts/${user.id}`);
    return profiles.get(JSON.stringify([user.id, user.username, user.displayName, user.avatarUrl, user.role, user.roleCheckedAt]), () => db.runTransaction(async transaction => {
      const snapshot = await transaction.get(reference);
      const current = snapshot.data();
      const identity = { discordId: user.id, username: user.username, displayName: user.displayName, avatarUrl: user.avatarUrl };
      if (Number.isFinite(user.roleCheckedAt) && (!current?.roleVerifiedAt || user.roleCheckedAt >= Date.parse(current.roleVerifiedAt))) {
        identity.verifiedRole = user.role;
        identity.roleVerifiedAt = new Date(user.roleCheckedAt).toISOString();
      }
      if (!snapshot.exists) {
        const profile = { ...identity, firstLoginAt: new Date(now()), activitySeenAt: null, schemaVersion: 1 };
        transaction.set(reference, profile); roster.clear(); cache.invalidate(`tester-header:${user.id}`);
        return serializeAccountValue(profile);
      }
      if (Object.entries(identity).some(([key, value]) => current[key] !== value)) {
        transaction.set(reference, identity, { merge: true }); roster.clear(); cache.invalidate(`tester-header:${user.id}`);
      }
      // Roles remain authoritative in Discord; a stored profile never grants permissions.
      return serializeAccountValue({ ...identity, roblox: current.roblox ? { userId: current.roblox.userId, username: current.roblox.username, linkedAt: current.roblox.linkedAt, verifiedAt: current.roblox.verifiedAt } : null, firstLoginAt: current.firstLoginAt, activitySeenAt: current.activitySeenAt ?? null, schemaVersion: 1 });
    }));
  }

  function ownReports(userId) {
    return db.collection("bugReports").where("reporter.discordId", "==", userId);
  }

  async function reports(userId, { cursor, status, preview } = {}) {
    let query = ownReports(userId);
    if (status) {
      if (typeof status !== "string" || !/^[\w-]{1,150}$/.test(status)) throw Object.assign(new Error("Invalid status filter."), { status: 400 });
      query = query.where("status.id", "==", status);
    }
    query = query.orderBy("createdAt", "desc").orderBy("__name__", "desc");
    const after = decodeCursor(cursor);
    if (after) query = query.startAfter(after.at, after.path);
    const pageSize = preview === "1" && !cursor ? 3 : 20;
    const snapshot = await query.limit(pageSize + 1).select("displayId", "description", "status", "approval.state", "createdAt", "updatedAt", "submissionState", "commentsCount", "version", "priority").get();
    const page = snapshot.docs.slice(0, pageSize);
    return {
      reports: page.map(document => {
        const value = serializeAccountValue(document.data());
        return { ...value, id: document.id, description: value.description?.slice(0, 240) ?? "" };
      }),
      nextCursor: snapshot.docs.length > pageSize ? encodeCursor(page.at(-1)) : null,
    };
  }

  async function stats(userId) {
    return cached(`stats:${userId}`, 60_000, async () => {
      const time = now();
      const pairs = await Promise.all([["24h", 1], ["7d", 7], ["30d", 30], ["lifetime", null]].map(async ([key, days]) => {
        let query = ownReports(userId).where("createdAt", "<=", new Date(time));
        if (days) query = query.where("createdAt", ">=", new Date(time - days * DAY_MS));
        // Subtraction keeps pre-submissionState legacy reports and excludes unfinished uploads.
        query = query.orderBy("createdAt", "desc");
        const [total, drafts] = await Promise.all([query.count(), query.where("submissionState", "==", "uploading").count()]);
        return [key, Math.max(0, total - drafts)];
      }));
      return { counts: Object.fromEntries(pairs), asOf: new Date(time).toISOString() };
    });
  }

  async function calendar(userId) {
    return cached(`calendar:${userId}`, 60_000, () => calendars.read(userId));
  }

  async function activity(userId) {
    return cached(`activity:${userId}`, 30_000, async () => {
    const snapshot = await db.collectionGroup("activity").where("recipientId", "==", userId).orderBy("createdAt", "desc").limit(30).get();
    return { events: snapshot.docs.map(document => {
      const event = serializeAccountValue(document.data());
      return { id: document.id, reportId: event.reportId, displayId: event.displayId, action: event.action, summary: event.accountSummary,
        actor: { displayName: event.actor?.displayName ?? "A team member", discordId: event.actor?.discordId }, createdAt: event.createdAt };
    }) };
    });
  }

  async function markSeen(userId, value) {
    if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) || Date.parse(value) > now()) {
      throw Object.assign(new Error("Invalid activity timestamp."), { status: 400 });
    }
    const reference = db.doc(`websiteAccounts/${userId}`);
    return db.runTransaction(async transaction => {
      const snapshot = await transaction.get(reference);
      if (!snapshot.exists) throw Object.assign(new Error("Load your account before marking activity as read."), { status: 409 });
      const previous = toIso(snapshot.data().activitySeenAt);
      const next = new Date(value).toISOString();
      if (!previous || next > previous) transaction.update(reference, { activitySeenAt: new Date(next) });
      return { activitySeenAt: previous && previous > next ? previous : next };
    });
  }

  async function testers(options = {}) {
    const role = options.role ?? "", search = String(options.search ?? "").trim().toLowerCase();
    if ((role && !["qa", "pentester", "leadqa"].includes(role)) || search.length > 100) throw Object.assign(new Error("Choose a valid tester search."), { status: 400 });
    const scope = JSON.stringify([role, search]), key = `${scope}:${options.cursor ?? ""}`;
    return roster.get(key, async () => {
      const base = db.collection("websiteAccounts").where("verifiedRole", "in", role ? [role] : ["qa", "pentester", "leadqa"]).orderBy("displayName", "asc").orderBy("__name__", "asc")
        .select("discordId", "username", "displayName", "avatarUrl", "verifiedRole", "roleVerifiedAt", "firstLoginAt");
      let after;
      if (options.cursor) {
        try { const parsed = JSON.parse(Buffer.from(options.cursor, "base64url").toString()); if (parsed.scope !== scope || typeof parsed.name !== "string" || !/^[\w-]{1,150}$/.test(parsed.id)) throw Error(); after = [parsed.name, `websiteAccounts/${parsed.id}`]; }
        catch { throw Object.assign(new Error("Invalid tester page. Return to the first page."), { status: 400 }); }
      }
      let documents;
      if (search) {
        const all = await roster.get(`search-corpus:${role}`, async () => {
          const values = []; let cursor;
          while (true) { const page = await (cursor ? base.startAfter(...cursor) : base).limit(250).get(); values.push(...page.docs.map(document => ({ id: document.id, ...serializeAccountValue(document.data()) }))); if (page.docs.length < 250) break; const last = page.docs.at(-1); cursor = [last.data().displayName, last.ref.path]; }
          return values;
        });
        const matches = all.filter(item => `${item.displayName} ${item.username} ${item.id}`.toLowerCase().includes(search));
        const offset = after ? matches.findIndex(item => item.id === after[1].split("/").at(-1)) + 1 : 0;
        if (after && !offset) throw Object.assign(new Error("The directory changed. Return to the first page."), { status: 409 });
        documents = matches.slice(offset, offset + 51);
      } else documents = (await (after ? base.startAfter(...after) : base).limit(51).get()).docs.map(document => ({ id: document.id, ...serializeAccountValue(document.data()) }));
      const page = documents.slice(0, 50), last = page.at(-1);
      return { testers: page.map(value => ({ discordId: value.id, username: value.username, displayName: value.displayName, avatarUrl: value.avatarUrl, role: value.verifiedRole, roleVerifiedAt: value.roleVerifiedAt, firstLoginAt: value.firstLoginAt })), limited: false,
        nextCursor: documents.length > 50 ? Buffer.from(JSON.stringify({ scope, name: last.displayName, id: last.id })).toString("base64url") : null };
    });
  }

  async function testerHeader(userId) {
    if (!/^\d{5,25}$/.test(userId)) throw Object.assign(new Error("Invalid tester ID."), { status: 400 });
    return cached(`tester-header:${userId}`, 60_000, async () => {
      const profile = await db.doc(`websiteAccounts/${userId}`).get();
      if (!profile.exists || !["qa", "pentester", "leadqa"].includes(profile.data().verifiedRole)) throw Object.assign(new Error("Tester account not found. Refresh the directory."), { status: 404 });
      const [totals, updates] = await Promise.all([stats(userId), activity(userId)]);
      return { stats: totals, activity: updates.events, onboarding: profile.data().onboarding ?? null };
    });
  }
  async function tester(userId, query = {}) { const [header, history] = await Promise.all([testerHeader(userId), reports(userId, query)]); return { ...history, ...header }; }
  async function testerReports(userId, query = {}) { await testerHeader(userId); return reports(userId, query); }

  return { ensureProfile, reports, stats, calendar, activity, markSeen, testers, tester, testerReports, invalidateReports, recordReportContribution,
    invalidateProfile() { profiles.clear(); roster.clear(); cache.clear(); },
  };
}
