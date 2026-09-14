import express from "express";
import rateLimit from "express-rate-limit";
import { requireAuth, requireCsrf, requireRole } from "./auth-context.mjs";
import { requireSameOrigin } from "./security.mjs";
// Injectable dependencies let route tests exercise the real access boundaries without live OAuth.
export function createCareersRouter({ service, auth = requireAuth, csrf = requireCsrf, origin = requireSameOrigin }) {
  const router = express.Router();
  const writes = [origin, csrf];
  router.get("/forms", async (req, res) => res.json(await service.listForms(req.query)));
  router.use(auth);
  router.use(rateLimit({ windowMs: 60_000, limit: 90, standardHeaders: "draft-8", legacyHeaders: false, keyGenerator: req => req.authUser.id }));
  router.get("/forms/:id", async (req, res) => res.json(await service.formForApplicant(req.params.id, req.authUser)));
  router.post("/forms/:id/applications", ...writes, rateLimit({ windowMs: 15 * 60_000, limit: 10, keyGenerator: req => req.authUser.id, standardHeaders: "draft-8", legacyHeaders: false }), async (req, res) => res.status(201).json(await service.submit(req.params.id, req.authUser, req.body)));
  router.get("/applications", async (req, res) => res.json(await service.listApplications(req.authUser, req.query)));
  router.get("/applications/:id", async (req, res) => res.json(await service.application(req.params.id, req.authUser)));
  router.post("/applications/:id/withdraw", ...writes, async (req, res) => res.json(await service.review(req.params.id, req.authUser, req.body, true)));
  router.use("/admin", requireRole("dev"));
  router.get("/admin/forms", async (req, res) => res.json(await service.listForms(req.query, true)));
  router.post("/admin/forms", ...writes, async (_req, res) => res.status(201).json(await service.createForm()));
  router.get("/admin/forms/:id", async (req, res) => res.json(await service.adminForm(req.params.id)));
  router.put("/admin/forms/:id", ...writes, async (req, res) => res.json(await service.saveForm(req.params.id, req.body)));
  router.get("/admin/applications", async (req, res) => res.json(await service.listApplications(req.authUser, req.query, true)));
  router.get("/admin/applications/:id", async (req, res) => res.json(await service.application(req.params.id, req.authUser, true)));
  router.put("/admin/applications/:id", ...writes, async (req, res) => res.json(await service.review(req.params.id, req.authUser, req.body)));
  router.use((error, _req, res, next) => {
    if (error.code === "FAILED_PRECONDITION") { res.status(503).json({ error: "Applications are temporarily unavailable while the database is being prepared. Please try again later." }); return; }
    next(error);
  });
  return router;
}
