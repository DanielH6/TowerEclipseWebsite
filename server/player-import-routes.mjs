import express from "express";
import rateLimit from "express-rate-limit";

const safeCodes = new Set(["IMPORT_DISABLED", "INVALID_IMPORT_REQUEST", "IMPORT_BUSY", "IMPORT_MODE_COMPLETE", "IMPORT_LIST_UNAVAILABLE", "IMPORT_CURSOR_LOOP",
  "INVALID_IMPORT_PREVIEW", "IMPORT_PREVIEW_CHANGED", "IMPORT_CONFIRMATION_REQUIRED", "IMPORT_INTERRUPTED", "IMPORT_LEASE_LOST", "IMPORT_CANCEL_CHANGED", "IMPORT_TARGET_CHANGED", "IMPORT_PREVIEW_TOO_LARGE"]);
export function createPlayerImportRouter({ service, requireAuth, requireAdmin, requireCsrf, appOrigin }) {
  if (![requireAuth, requireAdmin, requireCsrf].every(guard => typeof guard === "function") || !appOrigin) throw new Error("Importer requires authentication, developer, CSRF and origin guards.");
  const router = express.Router();
  router.use(requireAuth, requireAdmin);
  router.use((_request, response, next) => { response.set("Cache-Control", "no-store"); next(); });
  router.use(rateLimit({ windowMs: 60000, limit: 20, standardHeaders: "draft-8", legacyHeaders: false, keyGenerator: request => request.authUser.id,
    message: { error: "Too many import requests. Wait a minute before continuing.", code: "IMPORT_RATE_LIMITED" } }));
  const handler = action => async (request, response) => {
    const controller = new AbortController(), abort = () => controller.abort();
    request.once("aborted", abort); response.once("close", abort);
    try { const result = await action(request, controller.signal); if (!response.destroyed && !response.writableEnded) response.json(result); }
    catch (error) {
      if (!response.destroyed && !response.writableEnded) {
        const safe = safeCodes.has(error?.code);
        response.status(safe ? error.status : 503).json({ code: safe ? error.code : "IMPORT_UNAVAILABLE",
          error: safe ? error.message : "Importer temporarily unavailable. Refresh status before continuing." });
      }
    } finally { request.removeListener("aborted", abort); response.removeListener("close", abort); }
  };
  router.get("/status", handler((_request, signal) => service.status(signal)));
  router.use((request, response, next) => {
    const expectedOrigin = typeof appOrigin === "function" ? appOrigin(request) : appOrigin;
    if (request.get("Origin") !== expectedOrigin) return response.status(403).json({ error: "Invalid request origin." });
    next();
  }, requireCsrf);
  const body = (keys, action) => handler((request, signal) => {
    const value = request.body;
    if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))
      || Buffer.byteLength(JSON.stringify(value)) > 98304) throw Object.assign(new Error("Invalid import request."), { code: "INVALID_IMPORT_REQUEST", status: 400 });
    return action(value, request.authUser.id, signal);
  });
  router.post("/preview", body(["mode", "restart"], (input, actor, signal) => service.preview(input, actor, signal)));
  router.post("/apply", body(["token", "confirmation"], (input, actor, signal) => service.apply(input, actor, signal)));
  router.post("/cancel", body([], (_input, _actor, signal) => service.cancel(signal)));
  return router;
}
