import assert from "node:assert/strict";
import express from "express";
import { chromium, expect } from "@playwright/test";
import { createCareersService } from "../../server/careers-service.mjs";
import { createCareersRouter } from "../../server/careers-routes.mjs";
import { createMemoryDb } from "../../server/testing/careers-memory-db.mjs";

// Built UI and real routes/service with isolated accounts, applications and saved
// scores. The provider is disabled and no production/OAuth requests are allowed.
const lead = { id: "lead", username: "lead", displayName: "QA Lead", role: "leadqa" };
let actor = lead;
const memory = createMemoryDb();
const service = createCareersService(memory.db, { aiProvider: { enabled: false } });
const now = Date.parse("2026-11-11T00:00:00Z");
const draft = { title: "Tester November", category: "Quality assurance", description: "Help test Tower Eclipse.", commitment: "Volunteer", confirmation: "Thanks", closesAt: null,
  questions: [{ id: "answer", type: "paragraph", label: "Experience", required: true }] };
async function publish(overrides = {}) {
  const created = await service.createForm();
  return service.saveForm(created.id, { action: "publish", revision: 1, draft: { ...draft, ...overrides } });
}
const testers = await publish(), developers = await publish({ title: "Developer November", category: "Development" });
const completed = { id: "saved-run", total: 238, completedAt: new Date(now).toISOString(), criteriaRevision: testers.aiRevision ?? 0 };
memory.documents.get(`careerForms/${testers.id}`).aiCompletedRun = completed;
for (let i = 0; i < 254; i++) {
  const opening = i < 241 ? testers : developers, id = `applicant${String(i).padStart(3, "0")}`;
  memory.documents.set(`careerApplications/${id}`, {
    formId: opening.id, versionId: opening.publishedVersion, title: opening.title, category: opening.category, applicantId: id,
    applicant: { discordId: id, username: id, displayName: `Applicant ${i}`, roblox: { userId: String(i + 100), username: `Roblox${id}` } },
    answers: { answer: `I document ${i} practical steps.` }, status: i === 239 ? "withdrawn" : i % 3 === 0 ? "under_review" : "submitted", revision: 1, submissionRevision: i === 238 ? 2 : 1,
    createdAt: new Date(now - i * 1000).toISOString(), updatedAt: new Date(now - i * 1000).toISOString(), feedback: "", internalNotes: "Private fixture notes", history: [],
  });
  if (i < 240) memory.documents.set(`careerAiRuns/${completed.id}/careerAiScores/${id}`, { relativeScore: i / 24, qualityScore: i / 24, rank: 238 - i, poolSize: 238, submissionRevision: 1, summary: "Saved synthetic assessment", observations: "", grades: [] });
}
const app = express(), applicationRequests = [], writes = [];
let holdNextPage = false, releasePage = null;
app.use((_req, res, next) => { res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'"); next(); });
app.use(express.json());
app.get("/api/auth/me", (_req, res) => res.json({ authenticated: true, csrfToken: "fixture", user: actor }));
app.get("/api/roblox/stats", (_req, res) => res.json({ stats: {} }));
app.use(async (req, _res, next) => {
  if (req.method !== "GET") writes.push(req.path);
  if (req.path === "/api/careers/admin/applications") {
    applicationRequests.push({ ...req.query });
    if (holdNextPage) {
      holdNextPage = false;
      await new Promise(resolve => { releasePage = resolve; });
    }
  }
  next();
});
app.use("/api/careers", createCareersRouter({ service, auth: (req, _res, next) => { req.authUser = actor; req.authSession = { role: actor.role, csrfToken: "fixture" }; next(); }, origin: (_req, _res, next) => next() }));
app.use((error, _req, res, _next) => res.status(error.status || 500).json({ error: error.message }));
app.use(express.static("dist")); app.use((_req, res) => res.sendFile("index.html", { root: `${process.cwd()}/dist` }));
const server = await new Promise((resolve, reject) => { const instance = app.listen(0, "127.0.0.1", error => error ? reject(error) : resolve(instance)); });
const base = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || "chrome", headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(12000);
  const errors = [], violations = [], external = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.exposeFunction("reportViolation", value => violations.push(value));
  await page.addInitScript(() => document.addEventListener("securitypolicyviolation", event => window.reportViolation(event.effectiveDirective)));
  await page.route("**/*", route => { if (new URL(route.request().url()).origin !== base) { external.push(route.request().url()); return route.abort(); } return route.continue(); });
  const nav = page.getByRole("navigation", { name: "Application pages", exact: true });
  const rows = page.locator(".career-application-row");
  const current = nav.locator('[aria-current="page"]');
  const next = nav.getByRole("button", { name: "Next page", exact: true });
  const previous = nav.getByRole("button", { name: "Previous page", exact: true });
  const forward = nav.getByRole("button", { name: "Forward 5 pages", exact: true });
  const back = nav.getByRole("button", { name: "Back 5 pages", exact: true });
  const sort = page.getByRole("combobox", { name: "Sort applications", exact: true });
  const status = page.getByRole("combobox", { name: "Application status filter", exact: true });
  const search = page.getByRole("textbox", { name: "Search applicants", exact: true });
  async function onPage(number, firstId) {
    await expect(current).toHaveText(String(number));
    if (number !== 13) await expect(next).toBeEnabled();
    if (firstId) await expect(rows.first()).toHaveAttribute("href", new RegExp(`/review/${firstId}\\?`));
  }
  async function go(number) {
    await nav.getByRole("button", { name: `Go to page ${number}`, exact: true }).click();
    await expect(current).toHaveText(String(number));
    await expect(rows).toHaveCount(number === 13 ? 1 : 20);
  }

  await page.goto(`${base}/admin/careers/review?formId=${testers.id}`);
  await expect(rows).toHaveCount(20);
  await expect(sort.locator("option")).toHaveCount(4);
  await expect(sort.locator('option[value="quality"]')).toHaveCount(0);
  await expect(sort.locator('option[value="ai_rank_asc"]')).toHaveText("AI relative score · lowest first");
  await expect(nav).toContainText("Page 1 of 13");
  await expect(nav).toContainText("241 applications");
  await expect(previous).toBeDisabled(); await expect(back).toBeDisabled();
  await expect(current).toHaveText("1");
  await go(3);
  await expect(rows.first()).toHaveAttribute("href", /\/review\/applicant040\?/);
  assert.equal(applicationRequests.at(-1).page, "3");
  await forward.click(); await onPage(8, "applicant140");
  assert.equal(applicationRequests.at(-1).page, "8");
  await back.click(); await onPage(3, "applicant040");
  await previous.click(); await onPage(2, "applicant020");
  await next.click(); await onPage(3, "applicant040");
  await go(13);
  await expect(rows.first()).toHaveAttribute("href", /\/review\/applicant240\?/);
  await expect(next).toBeDisabled(); await expect(forward).toBeDisabled();
  await back.click(); await onPage(8, "applicant140");

  await rows.first().click();
  await expect(page.locator(".career-detail-header")).toContainText("Tester November");
  await page.getByRole("link", { name: "Review queue", exact: false }).click();
  await onPage(8, "applicant140");

  await sort.selectOption("ai_rank_asc");
  await onPage(1, "applicant000");
  assert.equal(applicationRequests.at(-1).page, "1");
  assert.equal(applicationRequests.at(-1).sort, "ai_rank_asc");
  await expect(rows.first().locator(".career-ai-score")).toContainText("0.0");
  await expect(rows.last().locator(".career-ai-score")).toContainText("0.8");
  await go(13);
  await expect(rows.first().locator(".career-ai-score")).toContainText("Unranked");
  await sort.selectOption("ai_rank");
  await onPage(1, "applicant237");
  await expect(rows.first().locator(".career-ai-score")).toContainText("9.9");
  await forward.click(); await onPage(6);
  await status.selectOption("under_review");
  await expect(current).toHaveText("1");
  await expect(nav).toContainText("81 applications");
  assert.equal(applicationRequests.at(-1).status, "under_review");
  assert.equal(applicationRequests.at(-1).page, "1");
  await status.selectOption("");
  await go(3);
  await search.fill("Robloxapplicant00");
  await expect(rows).toHaveCount(10);
  await expect(current).toHaveText("1");
  await expect(nav).toContainText("Page 1 of 1");
  assert.equal(applicationRequests.at(-1).search, "Robloxapplicant00");
  assert.equal(applicationRequests.at(-1).page, "1");
  await expect(next).toBeDisabled(); await expect(forward).toBeDisabled();
  await search.fill("not-a-real-applicant");
  await expect(rows).toHaveCount(0);
  await expect(nav).toContainText("Page 1 of 1");
  await expect(nav).toContainText("0 applications");
  await search.fill("");
  await expect(rows).toHaveCount(20);

  holdNextPage = true;
  await next.click();
  await expect.poll(() => releasePage !== null).toBe(true);
  for (const button of await nav.getByRole("button").all()) await expect(button).toBeDisabled();
  releasePage(); releasePage = null;
  await onPage(2);

  await page.goto(`${base}/admin/careers/review?formId=${testers.id}&sort=quality&page=3`);
  await expect(sort).toHaveValue("ai_rank");
  await expect(current).toHaveText("3");
  assert.equal(applicationRequests.at(-1).sort, "ai_rank");
  await page.getByRole("button", { name: "↻ Refresh", exact: true }).click();
  await onPage(1, "applicant237");
  assert.ok(applicationRequests.at(-1).refresh);

  await page.setViewportSize({ width: 390, height: 844 });
  await nav.scrollIntoViewIfNeeded();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, "Numbered controls fit a 390px viewport");
  const bounds = await nav.boundingBox();
  assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 390, "Pagination fits the viewport");
  await page.screenshot({ path: "/tmp/careers-pagination-mobile.png" });
  await forward.click(); await onPage(6);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await nav.scrollIntoViewIfNeeded();
  await page.screenshot({ path: "/tmp/careers-pagination-desktop.png" });
  await page.getByRole("combobox", { name: "Select application form", exact: true }).selectOption("");
  await expect(current).toHaveText("1");
  await expect(nav).toContainText("241 applications");
  await expect(sort).toHaveCount(0);
  assert.equal(applicationRequests.at(-1).formId, undefined, "Overview pages reuse the role-scoped full list");
  await expect(rows.first()).toContainText("Tester November");
  assert.deepEqual(writes, [], "Paging, filtering and sorting never request mutations or AI runs");
  assert.deepEqual(errors, []); assert.deepEqual(violations, []); assert.deepEqual(external, []);
  console.log("PASS: real numbered pages and direct jumps, ±5 navigation, bounds, saved ascending/descending scores with unranked last, filter/search/sort/refresh reset, legacy sort URL, detail-return page restoration, loading protection, empty/single page, QA scope, and 390px layout. Isolated saved-score fixtures only; no AI calls.");
} finally { releasePage?.(); await browser?.close(); await new Promise(resolve => server.close(resolve)); }
