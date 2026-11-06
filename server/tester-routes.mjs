import express from "express";

// Mounted after account authentication and rate limiting; the guard also covers target IDs.
export function createTesterRouter(service, requireDeveloper) {
  const router = express.Router();
  router.use(requireDeveloper);
  router.get("/", async (request, response) => response.json(await service.testers(request.query)));
  router.get("/:userId/reports", async (request, response) => response.json(await service.testerReports(request.params.userId, request.query)));
  router.get("/:userId", async (request, response) => response.json(await service.tester(request.params.userId, request.query)));
  return router;
}
