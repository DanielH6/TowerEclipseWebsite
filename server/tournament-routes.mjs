import express from "express";
import { db } from "./firebase.mjs";
import {
  requireAuth,
  requireCsrf,
  requireExactRole,
  optionalAuth,
} from "./auth-context.mjs";
import {
  TournamentError,
  addParticipants,
  addTournamentAnnouncement,
  adjustParticipantPoints,
  createTournament,
  generateGroupSchedule,
  generateKnockout,
  randomizeGroups,
  removeParticipant,
  toAdminTournament,
  toPublicTournament,
  toTournamentSummary,
  updateMatch,
  updateParticipant,
  updateTournament,
} from "./tournament-domain.mjs";

function forwardError(error, next) {
  if (error instanceof TournamentError) {
    error.status = error.status || 400;
  }
  next(error);
}

function tournamentFromSnapshot(snapshot) {
  if (!snapshot.exists) return null;
  return { ...snapshot.data(), id: snapshot.id };
}

async function findTournament(identifier) {
  const direct = await db.doc(`tournaments/${identifier}`).get();
  if (direct.exists) return direct;
  const slugMatches = await db.collection("tournaments").where("slug", "==", identifier).limit(1).get();
  return slugMatches.docs[0] ?? null;
}

async function ensureSlugAvailable(slug, exceptId = null) {
  const matches = await db.collection("tournaments").where("slug", "==", slug).limit(2).get();
  if (matches.docs.some((document) => document.id !== exceptId)) {
    throw new TournamentError(409, "That tournament URL is already in use.");
  }
}

async function loadAllTournaments() {
  const snapshot = await db.collection("tournaments").limit(200).get();
  return snapshot.docs
    .map(tournamentFromSnapshot)
    .filter(Boolean)
    .sort((left, right) => {
      if (Boolean(left.featured) !== Boolean(right.featured)) return left.featured ? -1 : 1;
      const statusOrder = { live: 0, scheduled: 1, draft: 2, completed: 3, archived: 4 };
      const statusDifference = (statusOrder[left.status] ?? 9) - (statusOrder[right.status] ?? 9);
      if (statusDifference !== 0) return statusDifference;
      return new Date(right.startsAt).getTime() - new Date(left.startsAt).getTime();
    });
}

async function mutateTournament(tournamentId, transform) {
  const reference = db.doc(`tournaments/${tournamentId}`);
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reference);
    if (!snapshot.exists) throw new TournamentError(404, "Tournament not found.");
    const current = tournamentFromSnapshot(snapshot);
    const next = await transform(current);
    transaction.set(reference, next);
    return next;
  });
}

export function createTournamentPublicRouter() {
  const router = express.Router();

  router.get("/", async (_request, response, next) => {
    try {
      const tournaments = (await loadAllTournaments())
        .filter((tournament) => tournament.published && tournament.status !== "archived")
        .map(toTournamentSummary);
      response.json({ tournaments });
    } catch (error) {
      forwardError(error, next);
    }
  });

  router.get("/:identifier", optionalAuth, async (request, response, next) => {
    try {
      const snapshot = await findTournament(request.params.identifier);
      const tournament = snapshot ? tournamentFromSnapshot(snapshot) : null;
      const developerPreview = request.authSession?.role === "dev";
      if (!tournament || ((!tournament.published || tournament.status === "archived") && !developerPreview)) {
        response.status(404).json({ error: "Tournament not found." });
        return;
      }
      response.json({
        tournament: developerPreview
          ? toAdminTournament(tournament)
          : toPublicTournament(tournament),
      });
    } catch (error) {
      forwardError(error, next);
    }
  });

  return router;
}

export function createTournamentAdminRouter() {
  const router = express.Router();
  router.use(requireAuth, requireExactRole("dev"));

  router.get("/", async (_request, response, next) => {
    try {
      response.json({ tournaments: (await loadAllTournaments()).map(toTournamentSummary) });
    } catch (error) {
      forwardError(error, next);
    }
  });

  router.get("/:tournamentId", async (request, response, next) => {
    try {
      const snapshot = await db.doc(`tournaments/${request.params.tournamentId}`).get();
      const tournament = tournamentFromSnapshot(snapshot);
      if (!tournament) {
        response.status(404).json({ error: "Tournament not found." });
        return;
      }
      response.json({ tournament: toAdminTournament(tournament) });
    } catch (error) {
      forwardError(error, next);
    }
  });

  router.post("/", requireCsrf, async (request, response, next) => {
    try {
      const reference = db.collection("tournaments").doc();
      const tournament = createTournament(request.body ?? {}, {
        id: reference.id,
        actor: request.authSession,
      });
      await ensureSlugAvailable(tournament.slug);
      await reference.set(tournament);
      response.status(201).json({ tournament: toAdminTournament(tournament) });
    } catch (error) {
      forwardError(error, next);
    }
  });

  router.patch("/:tournamentId", requireCsrf, async (request, response, next) => {
    try {
      if (request.body?.slug !== undefined) {
        const snapshot = await db.doc(`tournaments/${request.params.tournamentId}`).get();
        const current = tournamentFromSnapshot(snapshot);
        if (!current) throw new TournamentError(404, "Tournament not found.");
        const preview = updateTournament(current, { slug: request.body.slug });
        await ensureSlugAvailable(preview.slug, request.params.tournamentId);
      }
      const tournament = await mutateTournament(
        request.params.tournamentId,
        (current) => updateTournament(current, request.body ?? {}, { actor: request.authSession }),
      );
      response.json({ tournament: toAdminTournament(tournament) });
    } catch (error) {
      forwardError(error, next);
    }
  });

  router.post("/:tournamentId/participants", requireCsrf, async (request, response, next) => {
    try {
      const tournament = await mutateTournament(
        request.params.tournamentId,
        (current) => addParticipants(current, request.body?.participants, { actor: request.authSession }),
      );
      response.status(201).json({ tournament: toAdminTournament(tournament) });
    } catch (error) {
      forwardError(error, next);
    }
  });

  router.patch(
    "/:tournamentId/participants/:participantId",
    requireCsrf,
    async (request, response, next) => {
      try {
        const tournament = await mutateTournament(
          request.params.tournamentId,
          (current) => updateParticipant(
            current,
            request.params.participantId,
            request.body ?? {},
            { actor: request.authSession },
          ),
        );
        response.json({ tournament: toAdminTournament(tournament) });
      } catch (error) {
        forwardError(error, next);
      }
    },
  );

  router.delete(
    "/:tournamentId/participants/:participantId",
    requireCsrf,
    async (request, response, next) => {
      try {
        const tournament = await mutateTournament(
          request.params.tournamentId,
          (current) => removeParticipant(current, request.params.participantId, { actor: request.authSession }),
        );
        response.json({ tournament: toAdminTournament(tournament) });
      } catch (error) {
        forwardError(error, next);
      }
    },
  );

  router.post("/:tournamentId/groups/randomize", requireCsrf, async (request, response, next) => {
    try {
      const tournament = await mutateTournament(
        request.params.tournamentId,
        (current) => randomizeGroups(current, { actor: request.authSession }),
      );
      response.json({ tournament: toAdminTournament(tournament) });
    } catch (error) {
      forwardError(error, next);
    }
  });

  router.post("/:tournamentId/groups/schedule", requireCsrf, async (request, response, next) => {
    try {
      const tournament = await mutateTournament(
        request.params.tournamentId,
        (current) => generateGroupSchedule(current, { actor: request.authSession }),
      );
      response.json({ tournament: toAdminTournament(tournament) });
    } catch (error) {
      forwardError(error, next);
    }
  });

  router.post("/:tournamentId/knockout/generate", requireCsrf, async (request, response, next) => {
    try {
      const tournament = await mutateTournament(
        request.params.tournamentId,
        (current) => generateKnockout(current, { actor: request.authSession }),
      );
      response.json({ tournament: toAdminTournament(tournament) });
    } catch (error) {
      forwardError(error, next);
    }
  });

  router.patch("/:tournamentId/matches/:matchId", requireCsrf, async (request, response, next) => {
    try {
      const tournament = await mutateTournament(
        request.params.tournamentId,
        (current) => updateMatch(
          current,
          request.params.matchId,
          request.body ?? {},
          { actor: request.authSession },
        ),
      );
      response.json({ tournament: toAdminTournament(tournament) });
    } catch (error) {
      forwardError(error, next);
    }
  });

  router.post(
    "/:tournamentId/standings/:participantId/adjust",
    requireCsrf,
    async (request, response, next) => {
      try {
        const tournament = await mutateTournament(
          request.params.tournamentId,
          (current) => adjustParticipantPoints(
            current,
            request.params.participantId,
            request.body ?? {},
            { actor: request.authSession },
          ),
        );
        response.json({ tournament: toAdminTournament(tournament) });
      } catch (error) {
        forwardError(error, next);
      }
    },
  );

  router.post("/:tournamentId/log", requireCsrf, async (request, response, next) => {
    try {
      const tournament = await mutateTournament(
        request.params.tournamentId,
        (current) => addTournamentAnnouncement(
          current,
          request.body ?? {},
          { actor: request.authSession },
        ),
      );
      response.status(201).json({ tournament: toAdminTournament(tournament) });
    } catch (error) {
      forwardError(error, next);
    }
  });

  return router;
}
