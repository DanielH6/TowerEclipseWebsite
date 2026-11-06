import assert from "node:assert/strict";
import express from "express";
import { chromium, expect } from "@playwright/test";
import { createCareersService } from "../../server/careers-service.mjs";
import { createCareersRouter } from "../../server/careers-routes.mjs";
import { createMemoryDb } from "../../server/testing/careers-memory-db.mjs";

// Real built UI/router/service with synthetic accounts and an isolated DB.
// Draft answers never leave this fixture or reach a real AI provider.
const member = { id: "applicant", username: "applicant", displayName: "Applicant", role: "member" };
const admin = { id: "admin", username: "admin", displayName: "Administrator", role: "dev" };
let now = Date.now();
const memory = createMemoryDb({
  "websiteAccounts/applicant": { roblox: { userId: "123", username: "Player", verifiedAt: new Date(now).toISOString() } },
  "websiteRobloxLinks/123": { discordId: "applicant" },
});
const service = createCareersService(memory.db, { now: () => now, aiProvider: { enabled: false } });
const deadline = new Date(now + 3_600_000).toISOString();
const formDraft = { title: "Private draft test", category: "Quality assurance", description: "Tell us how you test.", commitment: "Volunteer", confirmation: "Thanks for applying.", closesAt: deadline, questions: [
  { id: "short", type: "short", label: "Time zone", help: "", required: true },
  { id: "long", type: "paragraph", label: "Experience", help: "", required: true },
  { id: "choice", type: "choice", label: "Availability", help: "", required: true, options: ["Weekends", "Weekdays"] },
  { id: "checks", type: "checkboxes", label: "Devices", help: "", required: true, options: ["PC", "Mobile"] },
  { id: "rank", type: "ranking", label: "Preferences", help: "", required: true, options: ["Combat", "UI", "Balance"] },
  { id: "scale", type: "scale", label: "Confidence", help: "", required: true, min: 0, max: 5, minLabel: "Low", maxLabel: "High" },
] };
async function opening(title) {
  const created = await service.createForm();
  return service.saveForm(created.id, { action: "publish", revision: created.revision, draft: { ...formDraft, title } });
}
const initialOpening = await opening("First application"), recoveryOpening = await opening("Draft recovery");
const app = express();
app.use((_req, res, next) => { res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'"); next(); });
app.use(express.json({ limit: "768kb" }));
app.get("/api/auth/me", (_req, res) => res.json({ authenticated: true, csrfToken: "fixture", user: member }));
app.get("/api/roblox/stats", (_req, res) => res.json({ stats: {} }));
app.use("/api/careers", createCareersRouter({ service, auth: (req, _res, next) => { req.authUser = member; req.authSession = { role: member.role, csrfToken: "fixture" }; next(); }, origin: (_req, _res, next) => next() }));
app.use((error, _req, res, _next) => res.status(error.status || 500).json({ error: error.message }));
app.use(express.static("dist"));
app.use((_req, res) => res.sendFile("index.html", { root: `${process.cwd()}/dist` }));
const server = await new Promise((resolve, reject) => { const instance = app.listen(0, "127.0.0.1", error => error ? reject(error) : resolve(instance)); });
const base = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || "chrome", headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const errors = [], violations = [], external = [], draftRequests = [], dialogMessages = [], dialogChoices = [];
  await context.exposeFunction("reportViolation", value => violations.push(value));
  await context.addInitScript(() => document.addEventListener("securitypolicyviolation", event => window.reportViolation(event.effectiveDirective)));
  await context.route("**/*", route => { if (new URL(route.request().url()).origin !== base) { external.push(route.request().url()); return route.abort(); } return route.continue(); });
  context.on("page", tab => {
    tab.setDefaultTimeout(12000);
    tab.on("pageerror", error => errors.push(error.message));
    tab.on("dialog", dialog => { dialogMessages.push(dialog.message()); return dialogChoices.shift() === false ? dialog.dismiss() : dialog.accept(); });
    tab.on("request", request => { if (/\/forms\/[^/]+\/draft$/.test(request.url()) && request.method() === "PUT") draftRequests.push(request.postDataJSON()); });
  });
  const page = await context.newPage(), staleTab = await context.newPage();
  const formUrl = id => `${base}/careers/${id}`;
  const saveButton = tab => tab.getByRole("button", { name: "Save draft", exact: true });
  const consent = tab => tab.getByRole("checkbox", { name: /I have read the/ });
  const draftDocs = () => [...memory.documents].filter(([key]) => key.startsWith("careerApplicationDrafts/"));
  async function save(tab, formId, status = 200) {
    const response = tab.waitForResponse(result => result.url().endsWith(`/forms/${formId}/draft`) && result.request().method() === "PUT");
    await saveButton(tab).click();
    const result = await response;
    assert.equal(result.status(), status);
    if (status === 200) await expect(tab.getByRole("status").filter({ hasText: /^Draft saved\./ })).toBeVisible();
    return result.json();
  }

  await Promise.all([page.goto(formUrl(initialOpening.id)), staleTab.goto(formUrl(initialOpening.id))]);
  await expect(saveButton(page)).toBeDisabled();
  await expect(saveButton(staleTab)).toBeDisabled();
  await page.locator(".career-back").click();
  await expect(page).toHaveURL(`${base}/careers`);
  await page.locator(`a[href="/careers/${initialOpening.id}"]`).click();
  await page.getByLabel("Time zone", { exact: true }).fill("Unsaved navigation proof");
  dialogChoices.push(false);
  await page.locator(".career-back").click();
  await expect(page).toHaveURL(formUrl(initialOpening.id));
  await expect(page.getByLabel("Time zone", { exact: true })).toHaveValue("Unsaved navigation proof");
  assert.match(dialogMessages.at(-1), /Save draft/);
  const beforeBack = dialogMessages.length;
  dialogChoices.push(false);
  await page.evaluate(() => window.history.back());
  await expect.poll(() => dialogMessages.length).toBe(beforeBack + 1);
  await expect(page).toHaveURL(formUrl(initialOpening.id));
  await expect(page.getByLabel("Time zone", { exact: true })).toHaveValue("Unsaved navigation proof");
  dialogChoices.push(true);
  await page.locator(".career-back").click();
  await expect(page).toHaveURL(`${base}/careers`);
  await page.locator(`a[href="/careers/${initialOpening.id}"]`).click();
  await expect(page.getByLabel("Time zone", { exact: true })).toHaveValue("");
  await page.getByLabel("Time zone", { exact: true }).fill("Australia/Sydney");
  await page.getByRole("radio", { name: "Weekdays", exact: true }).check();
  await page.getByRole("checkbox", { name: "PC", exact: true }).check();
  await page.getByRole("button", { name: "Move UI up", exact: true }).click();
  await page.getByRole("radio", { name: "0", exact: true }).check();
  await page.waitForTimeout(900);
  assert.equal(draftRequests.length, 0, "Typing does not save drafts automatically");
  assert.equal(draftDocs().length, 0);
  await expect(page.getByLabel("Experience", { exact: true })).toHaveValue("");
  await expect(consent(page)).not.toBeChecked();
  assert.equal(await saveButton(page).getAttribute("type"), "button");
  const saved = await save(page, initialOpening.id);
  assert.equal(saved.revision, 1);
  assert.equal(draftRequests.length, 1);
  await expect(saveButton(page)).toBeDisabled();
  const afterSaveDialogs = dialogMessages.length;
  await page.locator(".career-back").click();
  await expect(page).toHaveURL(`${base}/careers`);
  assert.equal(dialogMessages.length, afterSaveDialogs, "Saved drafts can be left without an unsaved warning");
  await page.locator(`a[href="/careers/${initialOpening.id}"]`).click();
  await expect(page.getByLabel("Time zone", { exact: true })).toHaveValue("Australia/Sydney");
  assert.equal((await service.listApplications(member)).items.length, 0);
  assert.equal((await service.listApplications(admin, {}, true)).items.length, 0);
  assert.equal((await service.applicationStats(admin)).applications, 0);

  await staleTab.getByLabel("Time zone", { exact: true }).fill("Stale tab text remains recoverable");
  await save(staleTab, initialOpening.id, 409);
  await expect(staleTab.getByRole("alert")).toContainText("another tab");
  await expect(staleTab.getByLabel("Time zone", { exact: true })).toHaveValue("Stale tab text remains recoverable");
  assert.equal(draftDocs()[0][1].revision, 1);
  assert.equal(draftDocs()[0][1].answers.short, "Australia/Sydney");
  await staleTab.close();

  await page.reload();
  await expect(page.getByLabel("Time zone", { exact: true })).toHaveValue("Australia/Sydney");
  await expect(page.getByLabel("Experience", { exact: true })).toHaveValue("");
  await expect(page.getByRole("radio", { name: "Weekdays", exact: true })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: "PC", exact: true })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: "Mobile", exact: true })).not.toBeChecked();
  await expect(page.locator(".career-ranking li").first()).toContainText("UI");
  await expect(page.getByRole("checkbox", { name: "Use this ranking", exact: true })).toBeChecked();
  await expect(page.getByRole("radio", { name: "0", exact: true })).toBeChecked();
  await expect(saveButton(page)).toBeDisabled();
  await expect(consent(page)).not.toBeChecked();
  await page.getByLabel("Experience", { exact: true }).fill("Submitted answers are visible to reviewers.");
  await consent(page).check();
  const submitted = page.waitForResponse(result => result.url().endsWith(`/forms/${initialOpening.id}/applications`) && result.request().method() === "POST");
  await page.getByRole("button", { name: "Submit application ↗", exact: true }).click();
  const submission = await submitted;
  assert.equal(submission.status(), 201);
  const { id: applicationId } = await submission.json();
  await expect(page.locator(".career-notice strong").filter({ hasText: /^Application received\.$/ })).toBeVisible();
  assert.equal(draftDocs().length, 0, "Explicit submission clears its known private draft");
  const firstApplication = (await service.application(applicationId, member)).application;
  await service.review(applicationId, admin, { revision: firstApplication.revision, status: "shortlisted", feedback: "Review in progress", internalNotes: "Private reviewer note" });
  await page.reload();
  await expect(page.locator(".career-detail-header .career-status")).toHaveText("Shortlisted");
  await page.getByRole("button", { name: "Edit application", exact: true }).click();
  await page.getByLabel("Experience", { exact: true }).fill("PRIVATE EDIT DRAFT only appears after resubmission.");
  const beforeEdit = structuredClone(memory.documents.get(`careerApplications/${applicationId}`));
  await save(page, initialOpening.id);
  assert.deepEqual(memory.documents.get(`careerApplications/${applicationId}`), beforeEdit);
  assert.equal((await service.application(applicationId, member)).draft.answers.long, "PRIVATE EDIT DRAFT only appears after resubmission.");
  const adminDetail = await service.application(applicationId, admin, true);
  assert.equal(adminDetail.draft, undefined);
  assert.equal(JSON.stringify(adminDetail).includes("PRIVATE EDIT DRAFT"), false);
  assert.equal(JSON.stringify(await service.listApplications(admin, {}, true)).includes("PRIVATE EDIT DRAFT"), false);
  await page.reload();
  await expect(page.locator(".career-answers")).toContainText("Submitted answers are visible to reviewers.");
  await expect(page.locator(".career-answers")).not.toContainText("PRIVATE EDIT DRAFT");
  await page.getByRole("button", { name: "Edit application", exact: true }).click();
  await expect(page.getByLabel("Experience", { exact: true })).toHaveValue("PRIVATE EDIT DRAFT only appears after resubmission.");
  await expect(consent(page)).not.toBeChecked();
  await consent(page).check();
  const resubmitted = page.waitForResponse(result => result.url().endsWith(`/applications/${applicationId}/resubmit`) && result.request().method() === "POST");
  await page.getByRole("button", { name: "Resubmit application", exact: true }).click();
  assert.equal((await resubmitted).status(), 200);
  await expect(page.getByText("Application resubmitted.", { exact: true })).toBeVisible();
  assert.equal(draftDocs().length, 0);
  assert.equal(memory.documents.get(`careerApplications/${applicationId}`).status, "submitted");
  assert.equal(memory.documents.get(`careerApplications/${applicationId}`).answers.long, "PRIVATE EDIT DRAFT only appears after resubmission.");
  await page.getByRole("button", { name: "Edit application", exact: true }).click();
  await page.getByLabel("Experience", { exact: true }).fill("Retained edits available after deadline");
  await save(page, initialOpening.id);

  await page.goto(formUrl(recoveryOpening.id));
  await page.getByLabel("Time zone", { exact: true }).fill("Unchanged question carries this answer");
  await page.getByLabel("Experience", { exact: true }).fill("Recover my old experience answer");
  await page.getByRole("radio", { name: "Weekdays", exact: true }).check();
  await save(page, recoveryOpening.id);
  const updatedDraft = { ...formDraft, title: recoveryOpening.title, questions: formDraft.questions.map(question => question.id === "long" ? { ...question, label: "Updated experience question" } : question.id === "choice" ? { ...question, options: ["Weekends", "Weekdays", "Evenings"] } : question) };
  const republished = await service.saveForm(recoveryOpening.id, { action: "publish", revision: recoveryOpening.revision, draft: updatedDraft });
  await page.reload();
  await expect(page.getByText(/The opening has changed since you saved/)).toBeVisible();
  await expect(page.getByLabel("Time zone", { exact: true })).toHaveValue("Unchanged question carries this answer");
  await expect(page.getByLabel("Updated experience question", { exact: true })).toHaveValue("");
  await expect(page.getByRole("radio", { name: "Weekdays", exact: true })).not.toBeChecked();
  await page.getByText("View previous draft answers", { exact: true }).click();
  await expect(page.locator(".career-draft-notice details")).toContainText("Recover my old experience answer");
  await expect(page.locator(".career-draft-notice details")).toContainText("Experience");
  const recoveryData = await service.formForApplicant(recoveryOpening.id, member);
  assert.equal(recoveryData.draft.versionId, recoveryOpening.publishedVersion);
  assert.equal(recoveryData.draft.form.questions.find(question => question.id === "long").label, "Experience");
  const upgraded = await save(page, recoveryOpening.id);
  assert.equal(upgraded.revision, 2);
  assert.equal(upgraded.versionId, republished.publishedVersion);
  assert.deepEqual(upgraded.answers, { short: "Unchanged question carries this answer" });
  await expect(page.getByText(/The opening has changed since you saved/)).toHaveCount(0);
  await expect(saveButton(page)).toBeDisabled();
  await page.getByLabel("Time zone", { exact: true }).fill("Late draft edit stays on this page");
  const beforeLate = structuredClone(draftDocs());
  now = Date.parse(deadline) + 1;
  await save(page, recoveryOpening.id, 409);
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByLabel("Time zone", { exact: true })).toHaveValue("Late draft edit stays on this page");
  assert.deepEqual(draftDocs(), beforeLate);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  await page.reload();
  await expect(page.getByText("Opening closed.", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Time zone", { exact: true })).toHaveValue("Unchanged question carries this answer");
  await expect(page.getByLabel("Time zone", { exact: true })).toBeDisabled();
  await expect(page.getByLabel("Updated experience question", { exact: true })).toBeDisabled();
  await expect(saveButton(page)).toBeDisabled();
  await expect(consent(page)).toBeDisabled();
  await expect(page.getByRole("button", { name: "Submit application ↗", exact: true })).toBeDisabled();
  assert.equal((await service.formForApplicant(recoveryOpening.id, member)).acceptingApplications, false);
  assert.deepEqual(draftDocs(), beforeLate);
  await page.goto(`${base}/applications/${applicationId}`);
  await expect(page.getByRole("button", { name: "Edit application", exact: true })).toHaveCount(0);
  await page.getByText("View saved draft answers", { exact: true }).click();
  await expect(page.locator(".career-draft-notice details")).toContainText("Retained edits available after deadline");
  await expect(page.locator(".career-answers")).not.toContainText("Retained edits available after deadline");
  assert.deepEqual(errors, []);
  assert.deepEqual(violations, []);
  assert.deepEqual(external, []);
  console.log("PASS: explicit partial private drafts, no typing/autosave writes, unchanged-save prevention, six-control restoration, stale-tab protection, submission/resubmission cleanup, unchanged submitted review state, admin privacy, original-version recovery, changed-question reset, deadline rejection, closed-opening draft recovery, and mobile layout. Synthetic fixtures only.");
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
