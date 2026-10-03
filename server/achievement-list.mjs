import express from "express";
import rateLimit from "express-rate-limit";
import { requireAuth, requireCsrf, requireRole } from "./auth-context.mjs";
import { requireSameOrigin } from "./security.mjs";
import { achievementChanges, validateListEntries } from "../shared/achievement-list.mjs";

const publicList = data => ({ entries: data?.entries ?? [], revision: data?.revision ?? 0, updatedAt: data?.updatedAt ?? null });

export function createAchievementListService(db) {
  // One bounded document makes reordering atomic and needs no composite index.
  const reference = db.doc("achievementLists/main");
  return {
    async read() { return publicList((await reference.get()).data()); },
    async history(cursor) {
      if (cursor !== undefined && (typeof cursor !== "string" || !/^\d{16}$/.test(cursor))) throw Object.assign(new Error("Invalid change log cursor."), { status: 400 });
      // Ordering by document ID uses Firestore's built-in index. Revisions are unique and monotonic.
      let query = db.collection("achievementListChanges").orderBy("__name__", "desc");
      if (cursor) query = query.startAfter(`achievementListChanges/${cursor}`);
      const result = await query.limit(11).get();
      const publications = result.docs.slice(0, 10).map(document => {
        const data = document.data();
        return { id: document.id, revision: data.revision, createdAt: data.createdAt, editorName: data.editorName, note: data.note, changes: data.changes };
      });
      return { publications, nextCursor: result.docs.length > 10 ? publications.at(-1).id : null };
    },
    async save(input, actor) {
      if (!Number.isSafeInteger(input?.revision) || input.revision < 0) throw Object.assign(new Error("A valid list revision is required."), { status: 400 });
      const entries = validateListEntries(input.entries);
      if (input.note !== undefined && (typeof input.note !== "string" || input.note.trim().length > 500)) throw Object.assign(new Error("Publication note must be 500 characters or fewer."), { status: 400 });
      const note = input.note?.trim() ?? "";
      return db.runTransaction(async transaction => {
        const current = publicList((await transaction.get(reference)).data());
        if (current.revision !== input.revision) throw Object.assign(new Error("Another admin updated the list. Reload the published list before applying your changes again."), { status: 409 });
        const changes = achievementChanges(current.entries, entries);
        if (!changes.length) return current;
        const next = { entries, revision: current.revision + 1, updatedAt: new Date().toISOString(), updatedBy: actor.id };
        const logReference = db.doc(`achievementListChanges/${String(next.revision).padStart(16, "0")}`);
        transaction.set(reference, next);
        transaction.set(logReference, { revision: next.revision, createdAt: next.updatedAt, editorName: actor.displayName || actor.username || "Administrator", note, changes });
        return publicList(next);
      });
    },
  };
}

export function createAchievementListRouter({ service, auth = requireAuth }) {
  const router = express.Router();
  router.get("/", async (_req, res) => res.json(await service.read()));
  router.get("/history", async (req, res) => res.json(await service.history(req.query.before)));
  router.put("/", auth, requireRole("dev"), requireSameOrigin, requireCsrf,
    rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: "draft-8", legacyHeaders: false, keyGenerator: req => req.authUser.id }),
    async (req, res) => res.json(await service.save(req.body, req.authUser)));
  return router;
}
