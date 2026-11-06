import assert from "node:assert/strict";
import express from "express";
import { chromium, expect } from "@playwright/test";
import { createReadCache } from "../../server/read-cache.mjs";
import { createNewsReadModel, publicNewsFields } from "../../server/news-read-model.mjs";
import { createAccountService } from "../../server/account-service.mjs";
import { createTesterRouter } from "../../server/tester-routes.mjs";
import { requireRole } from "../../server/auth-context.mjs";
import { createTournament, toPublicTournament } from "../../server/tournament-domain.mjs";
import { createWorkflowMemoryDb } from "../../server/testing/workflow-memory-db.mjs";

// Synthetic accounts and in-memory storage only. No real provider, production
// Firestore, OAuth, or persistent public artifacts are involved.
let actor = { id: "123456", username: "tester", displayName: "Tester", role: "qa", roleLabel: "QA Tester", avatarUrl: null };
const records = Object.fromEntries(Array.from({ length: 137 }, (_, index) => [`updates/p${String(index).padStart(4, "0")}`, {
  status: "published", title: `Archive Post ${index}`, version: `v${index}`, contentType: "game_update", isMinor: false,
  publishedOn: new Date(Date.UTC(2020, 0, index + 1)).toISOString().slice(0, 10), updatedAt: "2026-11-07T00:00:00Z", sections: [], coverImageId: null,
  author: { displayName: "Public author", discordId: "private-author-id" }, internalNotes: "private-draft-note", linkedReports: [{ id: "report1", displayId: "TE-1", summary: "Approved public fix" }],
}]));
for (let index = 0; index < 72; index++) records[`websiteAccounts/${123456 + index}`] = { username: `user${index}`, displayName: `Tester ${String(index).padStart(3, "0")}`, verifiedRole: "qa", roleVerifiedAt: "2026-11-07T00:00:00Z", firstLoginAt: "2026-10-01T00:00:00Z" };
const memory = createWorkflowMemoryDb(records), accounts = createAccountService(memory.db), cache = createReadCache({ name: "fixture-news" });
const hydrate = (doc, summary = false) => ({ ...publicNewsFields(doc.data(), doc.id, { summary }), coverImage: null, imagePolicy: { enabled: false } });
const news = createNewsReadModel({ db: memory.db, cache: { get: cache.get, invalidate: cache.clear }, hydrateSummary: doc => hydrate(doc, true), hydrateDetail: doc => hydrate(doc) });
let tournamentState = "live", tournamentReads = 0;
const tournament = createTournament({ name: "Fixture Cup", slug: "fixture-cup", status: "live", published: true });
const app = express(), accountRequests = [];
app.use((_req, res, next) => { res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'"); next(); });
app.use(express.json());
app.use((req, _res, next) => { req.authUser = actor; req.authSession = { role: actor.role, csrfToken: "fixture" }; if (req.path.startsWith("/api/account")) accountRequests.push(req.path); next(); });
app.get("/api/auth/me", (_req, res) => res.json({ authenticated: true, csrfToken: "fixture", user: actor }));
app.get("/api/roblox/stats", (_req, res) => res.json({ stats: {} }));
app.get("/api/dictionaries", (_req, res) => res.json({ dictionaries: { statuses: [], versions: [], priorities: [], categories: [], types: [], devices: [] } }));
app.get("/api/careers/applications", (_req, res) => res.json({ items: [], nextCursor: null }));
app.get("/api/updates", async (req, res) => res.json(await news.list(req.query)));
app.get("/api/updates/:id", async (req, res) => res.json({ update: await news.detail(req.params.id) }));
app.get("/api/tournaments/:id", (_req, res) => { tournamentReads++; res.json({ tournament: toPublicTournament({ ...tournament, status: tournamentState }) }); });
app.get("/api/account", async (_req, res) => res.json({ profile: await accounts.ensureProfile(actor), robloxLinkingEnabled: false }));
app.get("/api/account/stats", async (_req, res) => res.json(await accounts.stats(actor.id)));
app.get("/api/account/calendar", async (_req, res) => res.json(await accounts.calendar(actor.id)));
app.get("/api/account/reports", async (req, res) => res.json(await accounts.reports(actor.id, req.query)));
app.get("/api/account/activity", async (_req, res) => res.json(await accounts.activity(actor.id)));
app.use("/api/account/testers", createTesterRouter(accounts, requireRole("dev")));
app.use((error, _req, res, _next) => res.status(error.status || 500).json({ error: error.message }));
app.use(express.static("dist"));
app.use((_req, res) => res.sendFile("index.html", { root: `${process.cwd()}/dist` }));
const server = await new Promise((resolve, reject) => { const instance = app.listen(0, "127.0.0.1", error => error ? reject(error) : resolve(instance)); });
const base = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || "chrome", headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }), errors = [], violations = [], external = [];
  page.setDefaultTimeout(12000); page.on("pageerror", error => errors.push(error.message));
  await page.exposeFunction("reportViolation", value => violations.push(value));
  await page.addInitScript(() => document.addEventListener("securitypolicyviolation", event => window.reportViolation(event.effectiveDirective)));
  await page.route("**/*", route => { if (new URL(route.request().url()).origin !== base) { external.push(route.request().url()); return route.abort(); } return route.continue(); });

  await page.goto(`${base}/news`); await expect(page.locator(".news-card")).toHaveCount(12);
  await expect(page.locator(".news-card h3").first()).toHaveText("Archive Post 136");
  const archiveReads = memory.calls.filter(call => call.path === "updates").length;
  await page.getByRole("button", { name: "NEXT", exact: true }).click(); await expect(page.locator(".news-card h3").first()).toHaveText("Archive Post 124");
  await page.getByRole("searchbox", { name: "Search updates", exact: true }).fill("Archive Post 0");
  await expect(page.locator(".news-card")).toHaveCount(1); await expect(page.locator(".news-card h3")).toHaveText("Archive Post 0");
  assert.equal(memory.calls.filter(call => call.path === "updates").length, archiveReads, "archive pages/search reuse the manifest");
  actor = { ...actor, role: "member", roleLabel: "Member" };
  await page.goto(`${base}/news/p0000`); await expect(page.getByText("Approved public fix", { exact: true })).toBeVisible();
  await expect(page.locator('a[href="/bugs/report1"]')).toHaveCount(0);
  const publicBody = await (await page.request.get(`${base}/api/updates/p0000`)).text(); assert.equal(publicBody.includes("private-author-id"), false); assert.equal(publicBody.includes("private-draft-note"), false);
  await page.goto(`${base}/login?tab=connections`); await expect(page.getByRole("heading", { name: "Account connections", exact: true })).toBeVisible();
  await expect(page.locator('.account-sidebar a[href="/bugs"]')).toHaveCount(0);
  actor = { ...actor, role: "qa", roleLabel: "QA Tester" };
  await page.goto(`${base}/news/p0000`); await expect(page.locator('a[href="/bugs/report1"]')).toBeVisible();

  accountRequests.length = 0;
  await page.goto(`${base}/login?tab=connections`); await expect(page.getByRole("tab", { name: "Connections", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("heading", { name: "Account connections", exact: true })).toBeVisible();
  for (const suffix of ["/stats", "/calendar", "/reports", "/activity"]) assert.equal(accountRequests.some(value => value.endsWith(suffix)), false, `Connections avoids ${suffix}`);
  await page.getByRole("tab", { name: "Applications", exact: true }).click(); await expect(page.getByRole("heading", { name: "My applications", exact: true })).toBeVisible();
  for (const suffix of ["/stats", "/calendar", "/reports", "/activity"]) assert.equal(accountRequests.some(value => value.endsWith(suffix)), false, `Applications avoids ${suffix}`);
  await page.getByRole("tab", { name: "Overview", exact: true }).click(); await expect(page.getByRole("heading", { name: "Make every report count.", exact: true })).toBeVisible();
  await expect.poll(() => accountRequests.some(value => value.endsWith("/calendar"))).toBe(true);

  actor = { ...actor, role: "dev", roleLabel: "Developer" };
  await page.goto(`${base}/admin/testers`); await expect(page.locator(".tester-select")).toHaveCount(50);
  await page.getByRole("button", { name: "NEXT", exact: true }).click(); await expect(page.locator(".tester-select")).toHaveCount(22);
  await page.getByRole("textbox", { name: "Find tester", exact: true }).fill("user71"); await expect(page.locator(".tester-select")).toHaveCount(1);
  await expect(page.locator(".tester-select")).toContainText("user71");

  await page.clock.install(); actor = { ...actor, role: "member", roleLabel: "Member" };
  await page.goto(`${base}/esports/fixture-cup`); await expect(page.getByRole("heading", { name: "Fixture Cup", exact: true })).toBeVisible();
  tournamentState = "completed"; await page.clock.fastForward(60_001); await expect.poll(() => tournamentReads).toBe(2);
  await expect(page.locator(".tournament-detail-badges")).toContainText("Completed");
  await page.clock.fastForward(180_000); assert.equal(tournamentReads, 2, "completed tournament stops polling");
  await page.setViewportSize({ width: 390, height: 844 }); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  assert.deepEqual(errors, []); assert.deepEqual(violations, []); assert.deepEqual(external, []);
  console.log("PASS: complete paginated/searchable news archive without repeat scans, explicit public fields and staff-only report links, lazy account tabs, real tester-directory pagination/search, terminal tournament polling, 390px layout and CSP. Synthetic fixtures only.");
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
