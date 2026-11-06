import { createHash } from "node:crypto";

const DAY = 86_400_000, SHARDS = 32;
const iso = value => value?.toDate ? value.toDate().toISOString() : new Date(value).toISOString();
const contribution = report => report && report.submissionState !== "uploading" && report.reporter?.discordId && report.createdAt
  ? { owner: report.reporter.discordId, id: report.id, day: iso(report.createdAt).slice(0, 10) } : null;
const bucket = id => createHash("sha256").update(id).digest().readUInt32BE(0) % SHARDS;
const failure = message => Object.assign(new Error(message), { code: "CALENDAR_CHANGED" });

// A complete daily read model. Membership shards make repeated create/finalize/
// deletion callbacks idempotent, including callbacks racing a legacy rebuild.
export function createAccountCalendar(db, { now = Date.now, reconcileMs = DAY } = {}) {
  const pending = new Map(), failed = new Set();
  const meta = user => db.doc(`websiteAccountCalendars/${user}`);
  const shard = (user, index) => db.doc(`websiteAccountCalendars/${user}/websiteAccountCalendarMembers/${String(index).padStart(2, "0")}`);
  function startAt(time) { const date = new Date(time); date.setUTCHours(0, 0, 0, 0); return new Date(+date - 364 * DAY).toISOString().slice(0, 10); }
  function present(value, time) {
    const start = Date.parse(`${startAt(time)}T00:00:00.000Z`);
    return { days: Array.from({ length: 365 }, (_, index) => { const date = new Date(start + index * DAY).toISOString().slice(0, 10); return { date, count: value.days?.[date] ?? 0 }; }),
      limited: false, limit: 0, timezone: "UTC", asOf: value.updatedAt, reconciledAt: value.reconciledAt };
  }
  async function rebuild(user) {
    for (let attempt = 0; attempt < 4; attempt++) {
      const old = (await meta(user).get()).data() ?? {}, time = now();
      const from = new Date(`${startAt(time)}T00:00:00.000Z`), members = Array.from({ length: SHARDS }, () => ({})), days = {};
      const base = db.collection("bugReports").where("reporter.discordId", "==", user).where("createdAt", ">=", from).where("createdAt", "<=", new Date(time))
        .orderBy("createdAt", "desc").orderBy("__name__", "desc").select("createdAt", "submissionState");
      let cursor;
      while (true) {
        const page = await (cursor ? base.startAfter(...cursor) : base).limit(500).get();
        for (const doc of page.docs) { const value = doc.data(); if (value.submissionState === "uploading") continue; const day = iso(value.createdAt).slice(0, 10); members[bucket(doc.id)][doc.id] = day; days[day] = (days[day] ?? 0) + 1; }
        if (page.docs.length < 500) break;
        const last = page.docs.at(-1); cursor = [last.data().createdAt, last.ref.path];
      }
      const value = { ready: true, revision: (old.revision ?? 0) + 1, days, updatedAt: new Date(time).toISOString(), reconciledAt: new Date(time).toISOString() };
      // Never silently truncate an exceptional high-volume account. Serve the
      // complete calculated result without persisting an oversized membership.
      if (members.some(values => Buffer.byteLength(JSON.stringify(values)) > 700_000)) return present(value, time);
      try {
        await db.runTransaction(async tx => {
          const current = (await tx.get(meta(user))).data() ?? {};
          if ((current.revision ?? 0) !== (old.revision ?? 0)) throw failure("Calendar changed during reconciliation.");
          for (let index = 0; index < SHARDS; index++) tx.set(shard(user, index), { members: members[index] });
          tx.set(meta(user), value);
        });
        failed.delete(user); return present(value, time);
      } catch (error) { if (error.code !== "CALENDAR_CHANGED" || attempt === 3) throw error; }
    }
  }
  return {
    async read(user) {
      if (pending.has(user)) return pending.get(user);
      const work = (async () => {
        const value = (await meta(user).get()).data(), time = now();
        if (value?.ready && !failed.has(user) && time - Date.parse(value.reconciledAt) < reconcileMs) return present(value, time);
        return rebuild(user);
      })().finally(() => { if (pending.get(user) === work) pending.delete(user); });
      pending.set(user, work); return work;
    },
    async record(before, after) {
      const previous = contribution(before), next = contribution(after);
      const id = next?.id ?? previous?.id;
      if (!id) return;
      const owners = [...new Set([previous?.owner, next?.owner].filter(Boolean))];
      for (const user of owners) {
        try {
          await db.runTransaction(async tx => {
            const reference = meta(user), slot = shard(user, bucket(id));
            const state = (await tx.get(reference)).data() ?? {}, saved = (await tx.get(slot)).data()?.members ?? {};
            if (!state.ready) { tx.set(reference, { ...state, ready: false, revision: (state.revision ?? 0) + 1 }); return; }
            const members = { ...saved }, oldDay = members[id], newDay = next?.owner === user && next.day >= startAt(now()) ? next.day : null;
            if ((oldDay ?? null) === newDay) return;
            const days = { ...state.days };
            if (oldDay) { days[oldDay] = Math.max(0, (days[oldDay] ?? 0) - 1); delete members[id]; }
            if (newDay) { days[newDay] = (days[newDay] ?? 0) + 1; members[id] = newDay; }
            for (const day of Object.keys(days)) if (day < startAt(now())) delete days[day];
            for (const [key, day] of Object.entries(members)) if (day < startAt(now())) delete members[key];
            if (Buffer.byteLength(JSON.stringify(members)) > 700_000) { tx.update(reference, { ready: false, revision: (state.revision ?? 0) + 1 }); return; }
            tx.set(slot, { members }); tx.update(reference, { days, revision: (state.revision ?? 0) + 1, updatedAt: new Date(now()).toISOString() });
          });
        } catch (error) { failed.add(user); throw error; }
      }
    },
    invalidate(user) { if (user) failed.add(user); },
  };
}
