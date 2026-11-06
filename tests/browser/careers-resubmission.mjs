import assert from "node:assert/strict";
import express from "express";
import { chromium, expect } from "@playwright/test";
import { createCareersService } from "../../server/careers-service.mjs";
import { createCareersRouter } from "../../server/careers-routes.mjs";
import { createMemoryDb } from "../../server/testing/careers-memory-db.mjs";

// Exercise the real built UI/router/service against synthetic accounts and an
// isolated database. No real OAuth, production data, or AI provider is used.
const admin = { id: "admin", username: "admin", displayName: "Admin", role: "dev" };
const member = { id: "applicant", username: "applicant", displayName: "Applicant", role: "member" };
const lead = { id: "lead", username: "lead", displayName: "QA Lead", role: "leadqa" };
let actor = member, now = Date.now();
const memory = createMemoryDb({
  "websiteAccounts/applicant": { roblox: { userId: "123", username: "Player", verifiedAt: new Date(now).toISOString() } },
  "websiteRobloxLinks/123": { discordId: "applicant" },
});
const service = createCareersService(memory.db, { now: () => now, aiProvider: { enabled: false } });
const deadline = new Date(now + 3_600_000).toISOString();
const draft = { title: "Tester application", category: "Quality assurance", description: "Help test Tower Eclipse.", commitment: "Volunteer", confirmation: "Thank you for applying.", closesAt: deadline, questions: [
  { id: "short", type: "short", label: "Time zone", help: "", required: true },
  { id: "long", type: "paragraph", label: "Experience", help: "", required: true },
  { id: "choice", type: "choice", label: "Availability", help: "", required: true, options: ["Weekends", "Weekdays"] },
  { id: "checks", type: "checkboxes", label: "Devices", help: "", required: true, options: ["PC", "Mobile"] },
  { id: "rank", type: "ranking", label: "Preferences", help: "", required: true, options: ["Combat", "UI", "Balance"] },
  { id: "scale", type: "scale", label: "Confidence", help: "", required: true, min: 0, max: 5, minLabel: "Low", maxLabel: "High" },
] };
const originalAnswers = { short: "Australia/Sydney", long: "I document steps to reproduce.", choice: "Weekends", checks: ["PC"], rank: ["UI", "Combat", "Balance"], scale: 0 };
const created = await service.createForm();
const published = await service.saveForm(created.id, { action: "publish", revision: created.revision, draft });
const submitted = await service.submit(created.id, member, { versionId: published.publishedVersion, answers: originalAnswers, consent: true });
await service.review(submitted.id, admin, { revision: 1, status: "accepted", feedback: "Previous decision", internalNotes: "Private assessment remains private" });
// Changes to the published opening must not replace the questions/answers that
// this person originally submitted, including ranking and a zero scale answer.
await service.saveForm(created.id, { action: "publish", revision: published.revision, draft: { ...draft, title: "Updated tester application", questions: [{ id: "new", type: "short", label: "New question for later applicants", help: "", required: true }] } });
const original = memory.documents.get(`careerApplications/${submitted.id}`);

const app = express();
app.use((_req, res, next) => { res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'"); next(); });
app.use(express.json({ limit: "768kb" }));
app.get("/api/auth/me", (_req, res) => res.json({ authenticated: true, csrfToken: "fixture", user: actor }));
app.get("/api/roblox/stats", (_req, res) => res.json({ stats: {} }));
app.use("/api/careers", createCareersRouter({ service, auth: (req, _res, next) => { req.authUser = actor; req.authSession = { role: actor.role, csrfToken: "fixture" }; next(); }, origin: (_req, _res, next) => next() }));
app.use((error, _req, res, _next) => res.status(error.status || 500).json({ error: error.message }));
app.use(express.static("dist"));
app.use((_req, res) => res.sendFile("index.html", { root: `${process.cwd()}/dist` }));
const server = await new Promise((resolve, reject) => { const instance = app.listen(0, "127.0.0.1", error => error ? reject(error) : resolve(instance)); });
const base = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || "chrome", headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(12000);
  const errors = [], violations = [], external = [], resubmissions = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => { if (request.url().endsWith(`/applications/${submitted.id}/resubmit`) && request.method() === "POST") resubmissions.push(request.postDataJSON()); });
  await page.exposeFunction("reportViolation", value => violations.push(value));
  await page.addInitScript(() => document.addEventListener("securitypolicyviolation", event => window.reportViolation(event.effectiveDirective)));
  await page.route("**/*", route => { if (new URL(route.request().url()).origin !== base) { external.push(route.request().url()); return route.abort(); } return route.continue(); });
  page.on("dialog", dialog => dialog.accept());
  const ownUrl = `${base}/applications/${submitted.id}`;
  const editButton = () => page.getByRole("button", { name: "Edit application", exact: true });
  const submitButton = () => page.getByRole("button", { name: "Resubmit application", exact: true });
  const consent = () => page.getByRole("checkbox", { name: /I have read the/ });
  const timeZone = () => page.getByLabel("Time zone", { exact: true });
  const experience = () => page.getByLabel("Experience", { exact: true });
  await page.goto(ownUrl);
  await expect(editButton()).toBeVisible();
  await expect(page.locator(".career-detail-sidebar")).not.toContainText("Private assessment remains private");
  await editButton().click();
  await expect(timeZone()).toHaveValue(originalAnswers.short);
  await expect(experience()).toHaveValue(originalAnswers.long);
  await expect(page.getByRole("radio", { name: "Weekends", exact: true })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: "PC", exact: true })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: "Mobile", exact: true })).not.toBeChecked();
  await expect(page.getByRole("radio", { name: "0", exact: true })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: "Use this ranking", exact: true })).toBeChecked();
  await expect(page.locator(".career-ranking li").nth(0)).toContainText("UI");
  await expect(page.locator(".career-ranking li").nth(1)).toContainText("Combat");
  await expect(page.getByText("New question for later applicants", { exact: true })).toHaveCount(0);
  await expect(consent()).not.toBeChecked();
  await experience().fill("This cancelled edit must not be saved.");
  await page.getByRole("button", { name: "Cancel editing", exact: true }).click();
  await expect(editButton()).toBeVisible();
  assert.equal(resubmissions.length, 0);
  assert.deepEqual(memory.documents.get(`careerApplications/${submitted.id}`).answers, originalAnswers);

  await editButton().click();
  await expect(experience()).toHaveValue(originalAnswers.long);
  await timeZone().fill("Australia/Perth");
  await experience().fill("I reproduce bugs and verify fixes on PC and mobile.");
  await page.getByRole("radio", { name: "Weekdays", exact: true }).check();
  await page.getByRole("checkbox", { name: "Mobile", exact: true }).check();
  await page.getByRole("button", { name: "Move Balance up", exact: true }).click();
  await page.getByRole("radio", { name: "5", exact: true }).check();
  await expect(consent()).not.toBeChecked();
  await consent().check();
  const resent = page.waitForResponse(response => response.url().endsWith(`/applications/${submitted.id}/resubmit`) && response.request().method() === "POST");
  await submitButton().click();
  assert.equal((await resent).status(), 200);
  await expect(page.getByText("Application resubmitted.", { exact: true })).toBeVisible();
  await expect(page.locator(".career-detail-header .career-status")).toHaveText("Submitted");
  const stored = memory.documents.get(`careerApplications/${submitted.id}`);
  const editedAnswers = { short: "Australia/Perth", long: "I reproduce bugs and verify fixes on PC and mobile.", choice: "Weekdays", checks: ["PC", "Mobile"], rank: ["UI", "Balance", "Combat"], scale: 5 };
  assert.deepEqual(stored.answers, editedAnswers);
  assert.equal(stored.status, "submitted");
  assert.equal(stored.revision, original.revision + 1);
  assert.equal(stored.createdAt, original.createdAt);
  assert.equal(stored.versionId, original.versionId);
  assert.deepEqual(stored.applicant, original.applicant);
  assert.equal(stored.feedback, "");
  assert.equal(stored.internalNotes, "Private assessment remains private");
  assert.match(stored.history.at(-1).feedback, /resubmitt/i);
  assert.equal([...memory.documents.keys()].filter(key => key.startsWith("careerApplications/")).length, 1);
  assert.deepEqual(resubmissions[0], { revision: original.revision, answers: editedAnswers, consent: true, draftRevision: null });
  const applicantDetail = await service.application(submitted.id, member);
  assert.equal(JSON.stringify(applicantDetail).includes("Private assessment remains private"), false);

  await page.getByRole("button", { name: "Withdraw application", exact: true }).click();
  await expect(page.locator(".career-withdraw-confirm")).toContainText("cannot apply again to this same opening");
  await expect(page.locator(".career-withdraw-confirm")).toContainText("edit and resubmit before the deadline");
  await page.getByRole("button", { name: "Keep application", exact: true }).click();
  assert.equal(memory.documents.get(`careerApplications/${submitted.id}`).status, "submitted");
  await page.getByRole("button", { name: "Withdraw application", exact: true }).click();
  const withdrawal = page.waitForResponse(response => response.url().endsWith(`/applications/${submitted.id}/withdraw`) && response.request().method() === "POST");
  await page.getByRole("button", { name: "Confirm withdrawal", exact: true }).click();
  assert.equal((await withdrawal).status(), 200);
  await page.goto(ownUrl);
  await expect(page.locator(".career-detail-header .career-status")).toHaveText("Withdrawn");
  await expect(editButton()).toHaveCount(0);
  actor = lead;
  await page.goto(`${base}/admin/careers/review/${submitted.id}`);
  await expect(page.locator(".career-detail-sidebar")).toContainText("Private assessment remains private");
  await expect(page.getByRole("button", { name: "Save review", exact: true })).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: "Review status", exact: true })).toHaveCount(0);
  await expect(page.getByRole("textbox")).toHaveCount(0);
  const denied = await page.request.put(`${base}/api/careers/admin/applications/${submitted.id}`, { headers: { "X-CSRF-Token": "fixture" }, data: { revision: stored.revision + 1, status: "shortlisted", feedback: "", internalNotes: "" } });
  assert.equal(denied.status(), 403);

  actor = admin;
  await page.goto(`${base}/admin/careers/review/${submitted.id}`);
  const status = page.getByRole("combobox", { name: "Review status", exact: true });
  await expect(status).toBeEnabled();
  for (const value of ["submitted", "under_review", "shortlisted", "accepted", "rejected"]) assert.equal(await status.locator(`option[value="${value}"]`).count(), 1);
  await expect(page.getByRole("textbox", { name: "Feedback to applicant", exact: true })).toBeEditable();
  await expect(page.getByRole("textbox", { name: "Private review notes", exact: true })).toBeEditable();
  await status.selectOption("shortlisted");
  await page.getByRole("textbox", { name: "Feedback to applicant", exact: true }).fill("Restored for further review.");
  const restored = page.waitForResponse(response => response.url().endsWith(`/admin/applications/${submitted.id}`) && response.request().method() === "PUT");
  await page.getByRole("button", { name: "Save review", exact: true }).click();
  assert.equal((await restored).status(), 200);
  await expect(page.locator(".career-detail-header .career-status")).toHaveText("Shortlisted");
  assert.equal(memory.documents.get(`careerApplications/${submitted.id}`).status, "shortlisted");
  assert.equal(memory.documents.get(`careerApplications/${submitted.id}`).history.at(-2).status, "withdrawn");

  actor = member;
  await page.goto(ownUrl);
  await expect(editButton()).toBeVisible();
  await editButton().click();
  await expect(experience()).toHaveValue(editedAnswers.long);
  await experience().fill("This late edit stays on the page for recovery.");
  await consent().check();
  const beforeLate = structuredClone(memory.documents.get(`careerApplications/${submitted.id}`));
  now = Date.parse(deadline) + 1;
  const late = page.waitForResponse(response => response.url().endsWith(`/applications/${submitted.id}/resubmit`) && response.request().method() === "POST");
  await submitButton().click();
  assert.equal((await late).status(), 409);
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(experience()).toHaveValue("This late edit stays on the page for recovery.");
  assert.deepEqual(memory.documents.get(`careerApplications/${submitted.id}`), beforeLate);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  await page.reload();
  await expect(page.locator(".career-detail-header .career-status")).toHaveText("Shortlisted");
  await expect(editButton()).toHaveCount(0);
  await expect(submitButton()).toHaveCount(0);
  assert.deepEqual(errors, []);
  assert.deepEqual(violations, []);
  assert.deepEqual(external, []);
  console.log("PASS: original-version prefill for six answer types, cancel without saving, explicit resubmission with consent/status reset/history/privacy, withdrawal lock, administrator restoration, QA read-only access, deadline refusal preserving edits, and 390px layout. Synthetic fixtures only.");
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
