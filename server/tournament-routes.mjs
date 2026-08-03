import crypto from "node:crypto";
import express from "express";
import { db } from "./firebase.mjs";
import {
  actorSnapshot,
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
import {
  attachmentStoragePolicy,
  createAttachmentDownloadUrl,
  createAttachmentUploadUrl,
  deleteAttachmentObject,
  headAttachmentObject,
  normalizeAttachmentInput,
} from "./r2.mjs";

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

function presentTournament(tournament, serializer) {
  const result = serializer(tournament);
  if (attachmentStoragePolicy().enabled && tournament.banner?.objectKey) {
    result.bannerImageUrl = createAttachmentDownloadUrl(tournament.banner.objectKey);
  }
  return result;
}

function presentAdminTournament(tournament) {
  return presentTournament(tournament, toAdminTournament);
}

function presentPublicTournament(tournament) {
  return presentTournament(tournament, toPublicTournament);
}

function presentTournamentSummary(tournament) {
  return presentTournament(tournament, toTournamentSummary);
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
        .map(presentTournamentSummary);
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
          ? presentAdminTournament(tournament)
          : presentPublicTournament(tournament),
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
      response.json({ tournaments: (await loadAllTournaments()).map(presentTournamentSummary) });
    } catch (error) {
      forwardError(error, next);
    }
  });

  router.get("/banner-config", (_request, response) => {
    const policy = attachmentStoragePolicy();
    response.json({
      bannerPolicy: {
        ...policy,
        maxFilesPerReport: 1,
      },
    });
  });

  router.get("/:tournamentId", async (request, response, next) => {
    try {
      const snapshot = await db.doc(`tournaments/${request.params.tournamentId}`).get();
      const tournament = tournamentFromSnapshot(snapshot);
      if (!tournament) {
        response.status(404).json({ error: "Tournament not found." });
        return;
      }
      response.json({ tournament: presentAdminTournament(tournament) });
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
      response.status(201).json({ tournament: presentAdminTournament(tournament) });
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
      response.json({ tournament: presentAdminTournament(tournament) });
    } catch (error) {
      forwardError(error, next);
    }
  });

  router.post("/:tournamentId/banner", requireCsrf, async (request, response, next) => {
    let replacedPendingKey = null;
    try {
      const policy = attachmentStoragePolicy();
      if (!policy.enabled) throw new TournamentError(503, "Tournament banner storage is not configured.");

      const normalized = normalizeAttachmentInput(request.body ?? {});
      const uploadId = crypto.randomUUID();
      const objectKey = [
        "tournament-banners",
        request.params.tournamentId,
        uploadId,
        normalized.objectName,
      ].join("/");
      const upload = createAttachmentUploadUrl(objectKey, normalized.contentType);
      const createdAt = new Date().toISOString();
      const uploadExpiresAt = new Date(Date.now() + (upload.expiresIn + 300) * 1000).toISOString();

      await mutateTournament(request.params.tournamentId, (current) => {
        replacedPendingKey = current.pendingBanner?.objectKey ?? null;
        const tournament = updateTournament(current, {}, { actor: request.authSession, now: createdAt });
        tournament.pendingBanner = {
          id: uploadId,
          objectKey,
          originalName: normalized.originalName,
          contentType: normalized.contentType,
          contentDisposition: normalized.contentDisposition,
          declaredSize: normalized.size,
          createdAt,
          uploadExpiresAt,
          uploader: actorSnapshot(request.authSession),
        };
        return tournament;
      });

      if (replacedPendingKey && replacedPendingKey !== objectKey) {
        await deleteAttachmentObject(replacedPendingKey, { ignoreMissing: true }).catch(() => false);
      }
      response.status(201).json({
        uploadId,
        uploadUrl: upload.url,
        uploadHeaders: upload.headers,
        expiresIn: upload.expiresIn,
      });
    } catch (error) {
      forwardError(error, next);
    }
  });

  router.post(
    "/:tournamentId/banner/:uploadId/complete",
    requireCsrf,
    async (request, response, next) => {
      let previousBannerKey = null;
      try {
        const reference = db.doc(`tournaments/${request.params.tournamentId}`);
        const snapshot = await reference.get();
        const current = tournamentFromSnapshot(snapshot);
        if (!current) throw new TournamentError(404, "Tournament not found.");
        const pending = current.pendingBanner;
        if (!pending || pending.id !== request.params.uploadId) {
          throw new TournamentError(404, "Tournament banner upload not found.");
        }
        if (new Date(pending.uploadExpiresAt).getTime() <= Date.now()) {
          await deleteAttachmentObject(pending.objectKey, { ignoreMissing: true });
          await mutateTournament(request.params.tournamentId, (latest) => {
            if (latest.pendingBanner?.id !== request.params.uploadId) return latest;
            const tournament = updateTournament(latest, {}, { actor: request.authSession });
            tournament.pendingBanner = null;
            return tournament;
          });
          throw new TournamentError(410, "The banner upload expired. Select the image and try again.");
        }

        const object = await headAttachmentObject(pending.objectKey);
        if (!object) throw new TournamentError(409, "R2 has not received this banner yet.");
        if (object.size !== pending.declaredSize) {
          await deleteAttachmentObject(pending.objectKey, { ignoreMissing: true });
          throw new TournamentError(400, "The uploaded banner size does not match the selected image.");
        }
        if (object.contentType && object.contentType !== pending.contentType) {
          await deleteAttachmentObject(pending.objectKey, { ignoreMissing: true });
          throw new TournamentError(400, "The uploaded banner type does not match the selected image.");
        }

        const uploadedAt = new Date().toISOString();
        const tournament = await mutateTournament(request.params.tournamentId, (latest) => {
          if (latest.pendingBanner?.id !== request.params.uploadId) {
            throw new TournamentError(409, "A newer tournament banner upload has replaced this one.");
          }
          previousBannerKey = latest.banner?.objectKey ?? null;
          const nextTournament = updateTournament(latest, {}, { actor: request.authSession, now: uploadedAt });
          nextTournament.banner = {
            id: pending.id,
            objectKey: pending.objectKey,
            originalName: pending.originalName,
            contentType: object.contentType ?? pending.contentType,
            contentDisposition: object.contentDisposition ?? pending.contentDisposition,
            size: object.size,
            etag: object.etag,
            uploadedAt,
            uploader: actorSnapshot(request.authSession),
          };
          nextTournament.pendingBanner = null;
          return nextTournament;
        });

        if (previousBannerKey && previousBannerKey !== pending.objectKey) {
          await deleteAttachmentObject(previousBannerKey, { ignoreMissing: true }).catch(() => false);
        }
        response.status(201).json({ tournament: presentAdminTournament(tournament) });
      } catch (error) {
        forwardError(error, next);
      }
    },
  );

  router.delete(
    "/:tournamentId/banner/pending/:uploadId",
    requireCsrf,
    async (request, response, next) => {
      try {
        let objectKey = null;
        await mutateTournament(request.params.tournamentId, (current) => {
          if (current.pendingBanner?.id !== request.params.uploadId) return current;
          objectKey = current.pendingBanner.objectKey;
          const tournament = updateTournament(current, {}, { actor: request.authSession });
          tournament.pendingBanner = null;
          return tournament;
        });
        if (objectKey) await deleteAttachmentObject(objectKey, { ignoreMissing: true }).catch(() => false);
        response.sendStatus(204);
      } catch (error) {
        forwardError(error, next);
      }
    },
  );

  router.delete("/:tournamentId/banner", requireCsrf, async (request, response, next) => {
    let objectKey = null;
    try {
      const tournament = await mutateTournament(request.params.tournamentId, (current) => {
        objectKey = current.banner?.objectKey ?? null;
        const nextTournament = updateTournament(current, {}, { actor: request.authSession });
        nextTournament.banner = null;
        return nextTournament;
      });
      if (objectKey) await deleteAttachmentObject(objectKey, { ignoreMissing: true }).catch(() => false);
      response.json({ tournament: presentAdminTournament(tournament) });
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
      response.status(201).json({ tournament: presentAdminTournament(tournament) });
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
        response.json({ tournament: presentAdminTournament(tournament) });
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
        response.json({ tournament: presentAdminTournament(tournament) });
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
      response.json({ tournament: presentAdminTournament(tournament) });
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
      response.json({ tournament: presentAdminTournament(tournament) });
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
      response.json({ tournament: presentAdminTournament(tournament) });
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
      response.json({ tournament: presentAdminTournament(tournament) });
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
        response.json({ tournament: presentAdminTournament(tournament) });
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
      response.status(201).json({ tournament: presentAdminTournament(tournament) });
    } catch (error) {
      forwardError(error, next);
    }
  });

  return router;
}
