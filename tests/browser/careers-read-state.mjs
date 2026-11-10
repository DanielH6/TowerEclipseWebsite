import assert from "node:assert/strict";
import express from "express";
import { chromium, expect } from "@playwright/test";
import { createCareersService } from "../../server/careers-service.mjs";
import { createCareersRouter } from "../../server/careers-routes.mjs";
import { createMemoryDb } from "../../server/testing/careers-memory-db.mjs";

// Real built UI, routes and service; synthetic identities and isolated storage.
// This makes no OAuth, production database or AI provider requests.
const developer = { id: "developer", username: "developer", displayName: "Developer", role: "dev" };
const lead = { id: "lead", username: "lead", displayName: "QA Lead", role: "leadqa" };
const applicant = { id: "applicant", username: "applicant", displayName: "Applicant", role: "member" };
let actor = lead, now = Date.now();
const memory = createMemoryDb({
  "websiteAccounts/applicant": { roblox: { userId: "123", username: "Player", verifiedAt: new Date(now).toISOString() } },
  "websiteRobloxLinks/123": { discordId: "applicant" },
});
const service = createCareersService(memory.db, { now: () => now, aiProvider: { enabled: false } });
const form = await service.createForm();
const published = await service.saveForm(form.id, { action: "publish", revision: form.revision, draft: {
  title: "Tester application", category: "Quality assurance", description: "Help test Tower Eclipse.", commitment: "Volunteer", confirmation: "Thanks for applying.", closesAt: new Date(now + 3_600_000).toISOString(),
  questions: [{ id: "experience", type: "paragraph", label: "Experience", help: "", required: true }],
} });
const submission = await service.submit(form.id, applicant, { versionId: published.publishedVersion, answers: { experience: "I document reproducible bugs." }, consent: true });
const applicationPath = `careerApplications/${submission.id}`;
const initial = structuredClone(memory.documents.get(applicationPath));
const app = express();
app.use((_req, res, next) => { res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'"); next(); });
app.use(express.json());
app.get("/api/auth/me", (_req, res) => res.json({ authenticated: true, csrfToken: "fixture", user: actor }));
app.get("/api/roblox/stats", (_req, res) => res.json({ stats: {} }));
app.use("/api/careers", createCareersRouter({ service, auth: (req, _res, next) => { req.authUser = actor; req.authSession = { role: actor.role, csrfToken: "fixture" }; next(); }, origin: (_req, _res, next) => next() }));
app.use((error, _req, res, _next) => res.status(error.status || 500).json({ error: error.message }));
app.use(express.static("dist"));
app.use((_req, res) => res.sendFile("index.html", { root: `${process.cwd()}/dist` }));
const server = await new Promise((resolve, reject) => { const instance = app.listen(0, "127.0.0.1", error => error ? reject(error) : resolve(instance)); });
const base = `http://127.0.0.1:${server.address().port}`;
const reviewUrl = `${base}/admin/careers/review/${submission.id}`;
const queueUrl = `${base}/admin/careers/review?formId=${form.id}`;
let browser;
try {
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || "chrome", headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(12000);
  const errors = [], violations = [], external = [], marks = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => { if (request.url().endsWith("/read-state") && request.method() === "PUT") marks.push(request.postDataJSON()); });
  await page.exposeFunction("reportViolation", value => violations.push(value));
  await page.addInitScript(() => document.addEventListener("securitypolicyviolation", event => window.reportViolation(event.effectiveDirective)));
  await page.route("**/*", route => { if (new URL(route.request().url()).origin !== base) { external.push(route.request().url()); return route.abort(); } return route.continue(); });
  page.on("dialog", dialog => dialog.accept());
  const panel = page.getByRole("region", { name: "Application read tracking", exact: true });
  const badges = page.locator(".career-detail-header .career-read-badges");
  const row = page.locator(".career-application-row").first();
  const mark = page.getByRole("button", { name: "Mark Application as Read", exact: true });
  const unmark = page.getByRole("button", { name: "Mark as unread", exact: true });
  async function toggle(button, status = 200) {
    const response = page.waitForResponse(response => response.url().endsWith("/read-state") && response.request().method() === "PUT");
    await button.click();
    assert.equal((await response).status(), status);
  }

  await page.goto(reviewUrl);
  await expect(panel).toBeVisible();
  await expect(badges).toHaveText("UNREAD BY TEAM");
  assert.equal(marks.length, 0, "Opening an application must not mark it read");
  await toggle(mark);
  await expect(badges).toContainText("READ BY YOU");
  await expect(panel.locator(".career-readers")).toContainText("QA Lead");
  assert.deepEqual(marks[0], { read: true, submissionRevision: 1 });
  for (const field of ["revision", "updatedAt", "status", "answers", "feedback", "history"]) assert.deepEqual(memory.documents.get(applicationPath)[field], initial[field], `${field} is unaffected by read tracking`);
  await page.getByRole("link", { name: "← Review queue", exact: true }).click();
  await expect(row.locator(".career-read-badges")).toContainText("READ BY YOU");

  actor = developer;
  await page.goto(queueUrl);
  await expect(row.locator(".career-read-badges")).toContainText("READ BY OTHERS");
  await expect(row.locator(".career-read-badges")).not.toContainText("READ BY YOU");
  await row.click();
  await expect(panel.locator(".career-readers")).toContainText("QA Lead");
  const notes = page.getByRole("textbox", { name: "Private review notes", exact: true });
  await notes.fill("Unsaved assessment must survive marking read.");
  await toggle(mark);
  await expect(notes).toHaveText("Unsaved assessment must survive marking read.");
  await expect(badges).toContainText("READ BY YOU");
  await expect(badges).toContainText("READ BY OTHERS");
  await expect(panel.locator(".career-readers")).toContainText("Developer");
  assert.equal(memory.documents.get(applicationPath).internalNotes, initial.internalNotes, "Marking read does not save an unsaved review");

  actor = lead;
  await page.goto(reviewUrl);
  await expect(badges).toContainText("READ BY YOU");
  await expect(badges).toContainText("READ BY OTHERS");
  await toggle(unmark);
  await expect(badges).not.toContainText("READ BY YOU");
  await expect(badges).toContainText("READ BY OTHERS");
  await expect(panel.locator(".career-readers")).not.toContainText("QA Lead");
  await expect(panel.locator(".career-readers")).toContainText("Developer");
  await page.goto(queueUrl);
  await expect(row.locator(".career-read-badges")).toContainText("READ BY OTHERS");

  actor = developer;
  await page.goto(reviewUrl);
  await expect(badges).toContainText("READ BY YOU");
  now += 1000;
  await service.resubmit(submission.id, applicant, { revision: initial.revision, answers: { experience: "Updated experience for a fresh review." }, consent: true });
  await toggle(unmark, 409);
  await expect(panel.getByRole("alert")).toBeVisible();
  await page.reload();
  await expect(badges).toHaveText("UNREAD BY TEAM");
  await toggle(mark);
  assert.deepEqual(marks.at(-1), { read: true, submissionRevision: 2 });
  await expect(badges).toContainText("READ BY YOU");

  actor = applicant;
  await page.goto(`${base}/applications/${submission.id}`);
  await expect(page.locator(".career-detail-header")).toContainText("Tester application");
  await expect(panel).toHaveCount(0);
  await expect(page.locator(".career-read-badges")).toHaveCount(0);
  assert.equal((await page.request.put(`${base}/api/careers/admin/applications/${submission.id}/read-state`, { headers: { "X-CSRF-Token": "fixture" }, data: { read: true, submissionRevision: 2 } })).status(), 403);

  actor = lead;
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(reviewUrl);
  await expect(panel).toBeVisible();
  await toggle(mark);
  await expect(badges).toContainText("READ BY YOU");
  await expect(badges).toContainText("READ BY OTHERS");
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, "Detail fits a 390px viewport");
  await page.screenshot({ path: "/tmp/careers-read-state-detail-mobile.png", fullPage: true });
  await page.goto(queueUrl);
  await expect(row.locator(".career-read-badges")).toContainText("READ BY YOU");
  await expect(row.locator(".career-read-badges")).toContainText("READ BY OTHERS");
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, "Queue fits a 390px viewport");
  await page.screenshot({ path: "/tmp/careers-read-state-queue-mobile.png", fullPage: true });
  assert.deepEqual(errors, []);
  assert.deepEqual(violations, []);
  assert.deepEqual(external, []);
  console.log("PASS: explicit personal read/unread, shared reviewer badges in detail and queue, reader attribution, unsaved review preservation, resubmission reset/stale refusal, applicant privacy/access denial, and 390px detail/queue layouts. Synthetic fixtures only.");
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
