import express from "express";
import rateLimit from "express-rate-limit";
import { GAME_DATA_LIMITS } from "./game-data-config.mjs";

export function createGameDataRouter({ service, requireAuth, requireAdmin, requestsPerMinute = GAME_DATA_LIMITS.requestsPerMinute }) {
  if (typeof requireAuth !== "function" || typeof requireAdmin !== "function") throw new Error("Both authentication and server-side admin role guards are required.");
  const router = express.Router();
  router.use(requireAuth, requireAdmin);
  router.use((_request, response, next) => { response.set("Cache-Control", "no-store"); next(); });
  router.use(rateLimit({ windowMs: 60000, limit: requestsPerMinute, standardHeaders: "draft-8", legacyHeaders: false, keyGenerator: request => request.authUser.id, message: { error: "Too many player-data requests. Try again shortly.", code: "RATE_LIMITED" } }));
  function handler(action) {
    return async (request, response) => {
      try {
        const value = await action(request);
        if (!response.destroyed && !response.writableEnded) response.json(value);
      }
      catch (error) {
        if (response.destroyed || response.writableEnded) return;
        const safe = ["INVALID_PLAYER_ID", "INVALID_QUERY", "CURSOR_EXPIRED", "VIEWER_DISABLED", "INDEX_UNAVAILABLE"].includes(error?.code);
        response.status(safe ? error.status : 503).json({ error: safe ? error.message : "Player data is temporarily unavailable.", code: safe ? error.code : "DATA_UNAVAILABLE" });
      }
    };
  }
  router.get("/players", handler(request => service.list(request.query, request.authUser.id)));
  router.get("/players/:userId", handler(request => service.profile(request.params.userId)));
  return router;
}
