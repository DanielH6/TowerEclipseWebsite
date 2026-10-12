import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createGameDataService } from "../game-data-service.mjs";
import { createGameDataRouter } from "../game-data-routes.mjs";
import { createGameDataFixtures, FIXTURE_PLAYER_ID } from "./game-data-fixtures.mjs";
import { createPlayerImportRouter } from "../player-import-routes.mjs";
import { createPlayerImportFixtures } from "./player-import-fixtures.mjs";

// This standalone loopback preview is never imported by the production bootstrap.
// It does not import config, dotenv, Firebase, session storage or Roblox transports.
export async function createPlayerPreviewApp() {
  if (process.env.NODE_ENV === "production") throw new Error("Synthetic preview cannot run in production mode.");
  const app = express();
  const fixtures = createGameDataFixtures();
  let clockOffset = -120000;
  const service = createGameDataService({ ...fixtures, cursorSecret: "synthetic-preview-cursor-signing-only", now: () => Date.now() + clockOffset });
  const staleId = String(BigInt(FIXTURE_PLAYER_ID) + 2n);
  await service.profile(staleId);
  fixtures.fail("main", staleId); clockOffset = 0;
  app.disable("x-powered-by");
  app.use(express.json({ limit: "96kb" }));
  app.use((_request, response, next) => { response.set("Cache-Control", "no-store"); next(); });
  app.use((request, _response, next) => {
    const role = request.headers.cookie?.match(/(?:^|;\s*)player_preview_role=(dev|qa|leadqa|member|guest)(?:;|$)/)?.[1] ?? "dev";
    if (role !== "guest") {
      request.authSession = { role };
      request.authUser = { id: "synthetic-preview", username: "preview_admin", displayName: "Synthetic preview", role, roleLabel: role === "dev" ? "Developer" : "Member", avatarUrl: null, guildNickname: null };
    }
    next();
  });
  app.get("/api/auth/me", (request, response) => response.json(request.authUser ? { authenticated: true, csrfToken: "synthetic-preview-only", user: request.authUser } : { authenticated: false }));
  app.get("/api/roblox/stats", (_request, response) => response.json({ stats: { totalPlays: null, monthlyPlayers: null, ccu: null, partial: true, stale: true, ccuMode: "current" } }));
  app.get("/api/admin/overview", (_request, response) => response.json({ counts: {}, drafts: [], refreshedAt: new Date().toISOString() }));
  app.get("/api/account", (request, response) => response.json({ robloxLinkingEnabled: false, profile: { discordId: "synthetic-preview", username: "preview_member", displayName: "Synthetic preview", avatarUrl: null, firstLoginAt: "2026-10-01T12:00:00Z", activitySeenAt: null, roblox: null, role: request.authUser?.role } }));
  const requireFixtureAuth = (request, response, next) => request.authSession ? next() : response.status(401).json({ error: "Authentication required." });
  const requireFixtureAdmin = (request, response, next) => request.authSession?.role === "dev" ? next() : response.status(403).json({ error: "Developer access required." });
  const requireFixtureCsrf = (request, response, next) => request.get("X-CSRF-Token") === "synthetic-preview-only" ? next() : response.status(403).json({ error: "Invalid CSRF token." });
  // The test origin is derived from this loopback-only preview request's host.
  const importer = createPlayerImportFixtures();
  app.locals.playerImportFixture = importer; // Node-only test handle; no HTTP mutation endpoint.
  app.use("/api/admin/game-data/imports", createPlayerImportRouter({ service: importer.service, requireAuth: requireFixtureAuth,
    requireAdmin: requireFixtureAdmin, requireCsrf: requireFixtureCsrf, appOrigin: request => `${request.protocol}://${request.get("host")}` }));
  app.use("/api/admin/game-data", createGameDataRouter({ service, requireAuth: requireFixtureAuth, requireAdmin: requireFixtureAdmin }));
  app.use("/api", (_request, response) => response.status(404).json({ error: "This API is outside the synthetic player preview." }));
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../dist");
  app.use(express.static(root, { index: false }));
  app.use((_request, response) => response.sendFile("index.html", { root }));
  return app;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const app = await createPlayerPreviewApp();
  const server = app.listen(4317, "127.0.0.1", () => console.log("SYNTHETIC PLAYER PREVIEW: http://127.0.0.1:4317/admin/players — no live services"));
  for (const signal of ["SIGTERM", "SIGINT"]) process.once(signal, () => server.close());
}
