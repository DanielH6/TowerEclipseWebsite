import express from "express";
import rateLimit from "express-rate-limit";
import { db } from "./firebase.mjs";
import { requireAuth, requireCsrf, requireRole, optionalAuth } from "./auth-context.mjs";
import { requireSameOrigin } from "./security.mjs";
import { createAccountService } from "./account-service.mjs";

import { config } from "./config.mjs";
import { getSession, saveSession } from "./session-store.mjs";
import { createRobloxLinkService } from "./roblox-account-link.mjs";

const robloxLinks = createRobloxLinkService({ db, oauth: config.robloxOAuth, saveSession,
  isSessionActive: session => getSession(session.id) === session });
const linkResultUrl = result => `${config.appOrigin}/login?tab=connections&roblox=${encodeURIComponent(result)}`;

export const accounts = createAccountService(db);

export function createAccountRouter() {
  const router = express.Router();
  router.get("/roblox/callback", optionalAuth, async (request, response) => {
    if (!request.authSession) { response.redirect(303, linkResultUrl("expired")); return; }
    try {
      await robloxLinks.finish(request.authSession, request.query);
      response.redirect(303, linkResultUrl("linked"));
    } catch (error) {
      const allowed = new Set(["cancelled", "expired", "changed", "already_linked", "not_configured"]);
      // Never log callback query strings, tokens, client secrets, or raw provider responses.
      console.warn("Roblox linking did not complete:", allowed.has(error.code) ? error.code : "provider_failed");
      response.redirect(303, linkResultUrl(allowed.has(error.code) ? error.code : "failed"));
    }
  });
  router.use(requireAuth);
  router.use(rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: "draft-8", legacyHeaders: false,
    keyGenerator: request => request.authUser.id }));
  router.get("/", async (request, response) => response.json({ profile: await accounts.ensureProfile(request.authUser), robloxLinkingEnabled: robloxLinks.enabled }));
  router.post("/roblox/start", requireSameOrigin, requireCsrf, async (request, response) => response.json(await robloxLinks.start(request.authSession)));
  router.delete("/roblox", requireSameOrigin, requireCsrf, async (request, response) => {
    await robloxLinks.unlink(request.authSession, request.body?.userId);
    response.sendStatus(204);
  });
  const staff = requireRole("qa", "leadqa", "dev");
  router.get("/reports", staff, async (request, response) => response.json(await accounts.reports(request.authUser.id, request.query)));
  router.get("/stats", staff, async (request, response) => response.json(await accounts.stats(request.authUser.id)));
  router.get("/calendar", staff, async (request, response) => response.json(await accounts.calendar(request.authUser.id)));
  router.get("/activity", staff, async (request, response) => response.json(await accounts.activity(request.authUser.id)));
  router.post("/activity/read", staff, requireSameOrigin, requireCsrf, async (request, response) => {
    response.json(await accounts.markSeen(request.authUser.id, request.body?.through));
  });
  router.use((error, _request, response, next) => {
    if (error.code === "FAILED_PRECONDITION") {
      console.error("Account query unavailable:", error.message);
      response.status(503).json({ error: "Account data is temporarily unavailable. Please try again later." });
      return;
    }
    next(error);
  });
  return router;
}
