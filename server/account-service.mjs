import { Timestamp } from "./firestore-timestamp.mjs";

// Account queries always start from the authenticated Discord ID. Never accept a target user ID.
export const CALENDAR_LIMIT = 2000;
export const DAY_MS = 86_400_000;
const STAFF = new Set(["qa", "leadqa", "dev"]);
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
  const cache = new Map();
  function cached(key, ttl, operation) {
    const existing = cache.get(key);
    if (existing && existing.expires > now()) return existing.promise;
    if (cache.size >= 200) cache.delete(cache.keys().next().value);
    const entry = { expires: now() + ttl, promise: null };
    entry.promise = Promise.resolve().then(operation).catch(error => {
      if (cache.get(key) === entry) cache.delete(key);
      throw error;
    });
    cache.set(key, entry);
    return entry.promise;
  }

  async function ensureProfile(user) {
    const reference = db.doc(`websiteAccounts/${user.id}`);
    return db.runTransaction(async transaction => {
      const snapshot = await transaction.get(reference);
      const current = snapshot.data();
      const identity = { discordId: user.id, username: user.username, displayName: user.displayName, avatarUrl: user.avatarUrl };
      if (!snapshot.exists) {
        const profile = { ...identity, firstLoginAt: new Date(now()), activitySeenAt: null, schemaVersion: 1 };
        transaction.set(reference, profile);
        return serializeAccountValue(profile);
      }
      if (Object.entries(identity).some(([key, value]) => current[key] !== value)) {
        transaction.set(reference, identity, { merge: true });
      }
      // Roles remain authoritative in Discord; a stored profile never grants permissions.
      return serializeAccountValue({ ...identity, roblox: current.roblox ? { userId: current.roblox.userId, username: current.roblox.username, linkedAt: current.roblox.linkedAt, verifiedAt: current.roblox.verifiedAt } : null, firstLoginAt: current.firstLoginAt, activitySeenAt: current.activitySeenAt ?? null, schemaVersion: 1 });
    });
  }

  function ownReports(userId) {
    return db.collection("bugReports").where("reporter.discordId", "==", userId);
  }

  async function reports(userId, { cursor, status } = {}) {
    let query = ownReports(userId);
    if (status) {
      if (typeof status !== "string" || !/^[\w-]{1,150}$/.test(status)) throw Object.assign(new Error("Invalid status filter."), { status: 400 });
      query = query.where("status.id", "==", status);
    }
    query = query.orderBy("createdAt", "desc").orderBy("__name__", "desc");
    const after = decodeCursor(cursor);
    if (after) query = query.startAfter(after.at, after.path);
    const snapshot = await query.limit(21).select("displayId", "description", "status", "approval.state", "createdAt", "updatedAt", "submissionState", "commentsCount", "version", "priority").get();
    const page = snapshot.docs.slice(0, 20);
    return {
      reports: page.map(document => {
        const value = serializeAccountValue(document.data());
        return { ...value, id: document.id, description: value.description?.slice(0, 240) ?? "" };
      }),
      nextCursor: snapshot.docs.length > 20 ? encodeCursor(page.at(-1)) : null,
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
    return cached(`calendar:${userId}`, 15 * 60_000, async () => {
      const time = now();
      const start = new Date(time);
      start.setUTCHours(0, 0, 0, 0);
      start.setUTCDate(start.getUTCDate() - 364);
      const snapshot = await ownReports(userId).where("createdAt", ">=", start).where("createdAt", "<=", new Date(time))
        .orderBy("createdAt", "desc").limit(CALENDAR_LIMIT + 1).select("createdAt", "submissionState").get();
      return { ...buildCalendar(snapshot.docs, time), asOf: new Date(time).toISOString() };
    });
  }

  async function activity(userId) {
    const snapshot = await db.collectionGroup("activity").where("recipientId", "==", userId).orderBy("createdAt", "desc").limit(30).get();
    return { events: snapshot.docs.map(document => {
      const event = serializeAccountValue(document.data());
      return { id: document.id, reportId: event.reportId, displayId: event.displayId, action: event.action, summary: event.accountSummary,
        actor: { displayName: event.actor?.displayName ?? "A team member", discordId: event.actor?.discordId }, createdAt: event.createdAt };
    }) };
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

  return { ensureProfile, reports, stats, calendar, activity, markSeen };
}
