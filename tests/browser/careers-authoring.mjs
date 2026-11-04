import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import express from "express";
import { chromium, expect } from "@playwright/test";
import { createCareersService } from "../../server/careers-service.mjs";
import { createCareersRouter } from "../../server/careers-routes.mjs";
import { createMemoryDb } from "../../server/testing/careers-memory-db.mjs";

// Synthetic accounts, isolated DB/storage, and the real built UI/router/service.
// No calls to production services or real OAuth are made.
const admin = { id: "admin", username: "admin", displayName: "Admin", role: "dev" };
const member = { id: "applicant", username: "applicant", displayName: "Applicant", role: "member" };
let actor = admin, base;
const memory = createMemoryDb({ "websiteAccounts/applicant": { roblox: { userId: "123", username: "Player", verifiedAt: "2026-09-14T00:00:00.000Z" } }, "websiteRobloxLinks/123": { discordId: "applicant" } });
const objects = new Map();
const service = createCareersService(memory.db, { imageStorage: {
  policy: () => ({ enabled: true, maxFileSizeBytes: 5242880, maxFilesPerReport: 1, allowedExtensions: ["png", "jpg", "jpeg"] }),
  normalize: input => ({ objectName: input.fileName, contentType: input.contentType, size: input.size }),
  upload: (key, type) => ({ url: `${base}/fixture-storage/${key}`, headers: { "Content-Type": type }, expiresIn: 300 }),
  head: async key => objects.get(key), download: key => `${base}/fixture-storage/${key}`,
} });
const app = express();
app.use((_req, res, next) => { res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'"); next(); });
app.use(express.json({ limit: "768kb" }));
app.get("/api/auth/me", (_req, res) => res.json({ authenticated: true, csrfToken: "fixture", user: actor }));
app.get("/api/roblox/stats", (_req, res) => res.json({ stats: {} }));
app.use("/fixture-storage", express.raw({ type: ["image/png", "image/jpeg"], limit: "5mb" }), (req, res) => {
  const key = decodeURIComponent(req.path.slice(1));
  if (req.method === "PUT") { objects.set(key, { bytes: req.body, size: req.body.length, contentType: req.get("Content-Type") }); return res.sendStatus(200); }
  const object = objects.get(key); if (!object) return res.sendStatus(404);
  res.type(object.contentType).send(object.bytes);
});
app.use("/api/careers", createCareersRouter({ service, auth: (req, _res, next) => { req.authUser = actor; req.authSession = { role: actor.role, csrfToken: "fixture" }; next(); }, origin: (_req, _res, next) => next() }));
app.use((error, _req, res, _next) => res.status(error.status || 500).json({ error: error.message }));
app.use(express.static("dist"));
app.use((_req, res) => res.sendFile("index.html", { root: `${process.cwd()}/dist` }));
const server = await new Promise((resolve, reject) => { const instance = app.listen(0, "127.0.0.1", error => error ? reject(error) : resolve(instance)); });
base = `http://127.0.0.1:${server.address().port}`;
const created = await service.createForm();
await service.saveForm(created.id, { action: "save", revision: 1, draft: { title: "Tester opening", category: "Quality assurance", description: "Help us test", commitment: "Volunteer", confirmation: "Thank you", closesAt: null, questions: [
  { id: "essay", type: "paragraph", label: "Describe your experience", help: "Give examples", required: true },
  { id: "choice", type: "choice", label: "Availability", help: "", required: true, options: ["Weekends", "Weekdays", "Evenings"] },
  { id: "scale", type: "scale", label: "Confidence", help: "", required: false, min: 0, max: 5, minLabel: "Low", maxLabel: "High" },
] } });
let browser;
try {
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || "chrome", headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(12000);
  const errors = [], violations = [], external = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.exposeFunction("reportViolation", value => violations.push(value));
  await page.addInitScript(() => document.addEventListener("securitypolicyviolation", e => window.reportViolation(e.effectiveDirective)));
  await page.route("**/*", route => { if (new URL(route.request().url()).origin !== base) { external.push(route.request().url()); return route.abort(); } return route.continue(); });
  page.on("dialog", dialog => dialog.accept());
  const field = name => page.getByRole("textbox", { name, exact: true });
  async function selectAll(locator) { await locator.focus(); await locator.press("ControlOrMeta+A"); }
  async function format(name, action) {
    await selectAll(field(name));
    await field(name).locator("..").getByRole("button", { name: action, exact: true }).click();
  }
  await page.goto(`${base}/admin/careers/forms/${created.id}`);
  await expect(field("Opening title")).toHaveText("Tester opening");
  await format("Opening title", "Bold");
  await format("Category", "Italic");
  await format("Commitment / role details", "Underline");
  await selectAll(field("Commitment / role details"));
  await field("Commitment / role details").locator("..").getByLabel("Text size", { exact: true }).selectOption("5");
  await selectAll(field("Commitment / role details"));
  await field("Commitment / role details").locator("..").getByLabel("Highlight colour", { exact: true }).fill("#304050");
  await field("Description").fill("Help us test\nBring your ideas");
  await format("Description", "Strikethrough");
  await selectAll(field("Description"));
  await field("Description").locator("..").getByLabel("Text colour", { exact: true }).fill("#ffdd88");
  await format("Message after submission", "Italic");
  await selectAll(field("Message after submission"));
  await field("Message after submission").locator("..").getByRole("button", { name: "Add link", exact: true }).click();
  await field("Link URL").fill("https://example.com/thanks");
  await page.getByRole("button", { name: "Apply link", exact: true }).click();
  const questions = page.locator(".career-question-editor");
  await selectAll(questions.nth(0).getByRole("textbox", { name: "Question", exact: true }));
  await questions.nth(0).getByRole("group", { name: "Question formatting", exact: true }).getByRole("button", { name: "Bold", exact: true }).click();
  await format("Question 2, option 2", "Underline");
  await format("Question 2, option 3", "Bold");
  // Removing an earlier option must move its successor's formatting with the text.
  await questions.nth(1).getByRole("button", { name: "Remove option 1", exact: true }).click();
  await format("Low label", "Italic");
  const imageInput = questions.nth(0).getByLabel("Attach question image (optional)");
  await imageInput.setInputFiles({ name: "bad.png", mimeType: "image/png", buffer: Buffer.from("not an image") });
  await expect(questions.nth(0).getByRole("alert")).toContainText("could not be opened");
  assert.equal(objects.size, 0);
  await imageInput.setInputFiles({ name: "question.png", mimeType: "image/png", buffer: await readFile("public/harbor-background.png") });
  await expect(questions.nth(0).getByLabel("Image description (required before publishing)")).toBeVisible();
  await questions.nth(0).getByLabel("Image description (required before publishing)").fill("Describe this game scene");
  await questions.nth(0).locator(".career-question-image img").waitFor();
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.locator(".career-notice[role=status]")).toContainText("Draft saved");
  const saved = await service.adminForm(created.id);
  assert.equal(saved.draft.formatting.title[0].bold, true);
  assert.equal(saved.draft.formatting.commitment[0].size, "large");
  assert.equal(saved.draft.formatting.commitment[0].highlight, "#304050");
  assert.equal(saved.draft.formatting.confirmation[0].href, "https://example.com/thanks");
  assert.equal(saved.draft.formatting.description[0].color, "#ffdd88");
  assert.equal(saved.draft.questions[1].options[0], "Weekdays");
  assert.equal(saved.draft.questions[1].formatting.option0[0].underline, true);
  assert.equal(saved.draft.questions[1].formatting.option1[0].bold, true);
  await page.reload();
  await expect(field("Opening title").locator("span").first()).toHaveCSS("font-weight", "750");
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await expect(page.locator(".career-preview h3")).toContainText("Tester opening");
  await page.locator(".career-preview .career-question-image img").scrollIntoViewIfNeeded();
  await expect.poll(() => page.locator(".career-preview .career-question-image img").evaluate(img => img.naturalWidth > 0)).toBe(true);
  await page.getByRole("button", { name: "Publish opening ↗", exact: true }).click();
  await page.getByRole("button", { name: "Confirm publish", exact: true }).click();
  await expect(page.locator(".career-notice[role=status]")).toContainText("Published.");
  actor = member;
  await page.goto(`${base}/careers/${created.id}`);
  await expect(page.locator(".career-hero h2 span span")).toHaveCSS("font-weight", "750");
  await expect(page.locator(".career-question-image img")).toBeVisible();
  await page.getByLabel("Describe your experience", { exact: true }).fill("I test carefully.\nI report bugs clearly.");
  await page.getByRole("radio", { name: "Weekdays", exact: true }).check();
  await page.getByRole("checkbox", { name: /I have read the/ }).check();
  await page.getByRole("button", { name: "Submit application ↗", exact: true }).click();
  await expect(page.locator(".career-word-total")).toContainText("7 words in this application");
  const applicationId = new URL(page.url()).pathname.split("/").at(-1);
  assert.equal((await service.application(applicationId, member)).application.answers.choice, "Weekdays");
  actor = admin;
  await page.goto(`${base}/admin/careers/review`);
  await expect(page.locator(".career-stat-totals")).toContainText("1Total applicants");
  await expect(page.locator(".career-stat-categories")).toContainText("Quality assurance");
  await page.getByRole("link", { name: /Tester opening.*applicant/ }).click();
  await field("Feedback to applicant").fill("Great examples");
  await format("Feedback to applicant", "Bold");
  await field("Private review notes").fill("Private context");
  await format("Private review notes", "Italic");
  await page.getByRole("combobox", { name: "Review status", exact: true }).selectOption("under_review");
  const reviewSaved = page.waitForResponse(response => response.url().endsWith(`/admin/applications/${applicationId}`) && response.request().method() === "PUT" && response.ok());
  await page.getByRole("button", { name: "Save review", exact: true }).click();
  await reviewSaved;
  await expect(page.locator(".career-review-form")).toContainText("Last reviewed by Admin");
  await expect(page.getByRole("button", { name: "Save review", exact: true })).toBeDisabled();
  actor = member;
  await page.goto(`${base}/applications/${applicationId}`);
  await expect(page.locator(".career-detail-sidebar")).toContainText("Great examples");
  await expect(page.locator(".career-detail-sidebar")).not.toContainText("Private context");
  actor = { id: "lead", username: "lead", displayName: "QA Lead", role: "leadqa" };
  await page.goto(`${base}/admin/careers/review/${applicationId}`);
  await expect(page.locator(".career-detail-sidebar")).toContainText("Private context");
  await expect(page.getByRole("button", { name: "Save review" })).toHaveCount(0);
  await expect(page.getByRole("textbox")).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  actor = admin;
  await page.goto(`${base}/admin/careers/forms/${created.id}`);
  await expect(field("Opening title")).toBeVisible();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  await field("Description").scrollIntoViewIfNeeded();
  await page.screenshot({ path: "/tmp/careers-authoring-mobile.png", fullPage: false });
  assert.deepEqual(errors, []); assert.deepEqual(violations, []); assert.deepEqual(external, []);
  console.log("PASS: careers formatting/save/reload/preview/publish, option identity after removal, corrupt image rejection/upload/preserved image, submission, word counts, applicant stats, styled reviews/private notes, QA read-only access, 390px layout, zero CSP violations or external requests. Isolated fixtures only.");
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
