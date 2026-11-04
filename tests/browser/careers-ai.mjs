import assert from "node:assert/strict";
import express from "express";
import { chromium, expect } from "@playwright/test";
import { createCareersService } from "../../server/careers-service.mjs";
import { createCareersRouter } from "../../server/careers-routes.mjs";
import { createCareerAiWorker } from "../../server/careers-ai-worker.mjs";
import { createMemoryDb } from "../../server/testing/careers-memory-db.mjs";

// The real UI, router, queue and worker, with isolated accounts/data and a
// deterministic provider. This test never sends application data to OpenAI.
const admin = { id: "admin", username: "admin", displayName: "Admin", role: "dev" };
let actor = admin;
const memory = createMemoryDb(), calls = [];
const provider = {
  enabled: true,
  async draftCriteria() { return { value: { criteria: [
    { name: "Reasoning", description: "Assess useful practical reasoning.", weight: 1, low: "Vague", middle: "Usable", high: "Specific and justified" },
    { name: "Clarity", description: "Assess actionable explanations rather than length.", weight: 1, low: "Unclear", middle: "Understandable", high: "Clear and actionable" },
  ] } }; },
  async assess(input) {
    calls.push(input); await new Promise(resolve => setTimeout(resolve, 10));
    const score = Number(input.questions[0].answer.match(/\d/)[0]);
    return { value: { summary: "Assessment of practical testing knowledge.", observations: "Consider discussing an example with the applicant.", grades: input.settings.criteria.map(c => ({ criterionId: c.id, score, explanation: "Based on the submitted reproduction steps.", evidence: [{ questionId: "answer", quote: input.questions[0].answer }] })) }, usage: { inputTokens: 100, outputTokens: 50 } };
  },
};
const service = createCareersService(memory.db, { aiProvider: provider });
const worker = createCareerAiWorker({ service: service.ai, intervalMs: 200 });
const publicDraft = { title: "Tester November", category: "Quality assurance", description: "Help test Tower Eclipse.", commitment: "Volunteer", confirmation: "Thanks", closesAt: null, questions: [{ id: "answer", type: "paragraph", label: "How would you reproduce a bug?", help: "Explain your reasoning", required: true }] };
async function form(draft) { const created = await service.createForm(); return service.saveForm(created.id, { action: "publish", revision: 1, draft }); }
const testers = await form(publicDraft), developers = await form({ ...publicDraft, title: "Developer September", category: "Development" });
for (let i = 0; i < 50; i++) {
  const opening = i < 47 ? testers : developers, id = `applicant${String(i).padStart(2, "0")}`;
  memory.documents.set(`careerApplications/${id}`, { formId: opening.id, versionId: opening.publishedVersion, title: opening.title, category: opening.category, applicantId: id,
    applicant: { discordId: id, username: id, displayName: `Applicant ${i}`, roblox: { userId: "123", username: `Roblox${id}` } }, answers: { answer: `I describe ${i % 6} practical steps.` }, status: i < 5 ? "under_review" : "submitted", revision: 1, createdAt: new Date(Date.now() - i * 1000).toISOString(), updatedAt: new Date(Date.now() - i * 1000).toISOString(), feedback: "", internalNotes: "Private material that must not reach the provider", history: [] });
}
const app = express();
app.use((_req, res, next) => { res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'"); next(); });
app.use(express.json({ limit: "768kb" }));
app.get("/api/auth/me", (_req, res) => res.json({ authenticated: true, csrfToken: "fixture", user: actor }));
app.get("/api/roblox/stats", (_req, res) => res.json({ stats: {} }));
app.use("/api/careers", createCareersRouter({ service, auth: (req, _res, next) => { req.authUser = actor; req.authSession = { role: actor.role, csrfToken: "fixture" }; next(); }, origin: (_req, _res, next) => next() }));
app.use((error, _req, res, _next) => res.status(error.status || 500).json({ error: error.message }));
app.use(express.static("dist")); app.use((_req, res) => res.sendFile("index.html", { root: `${process.cwd()}/dist` }));
const server = await new Promise((resolve, reject) => { const instance = app.listen(0, "127.0.0.1", error => error ? reject(error) : resolve(instance)); });
const base = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  worker.start();
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || "chrome", headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(20000);
  const errors = [], violations = [], external = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.exposeFunction("reportViolation", value => violations.push(value));
  await page.addInitScript(() => document.addEventListener("securitypolicyviolation", e => window.reportViolation(e.effectiveDirective)));
  await page.route("**/*", route => { if (new URL(route.request().url()).origin !== base) { external.push(route.request().url()); return route.abort(); } return route.continue(); });
  page.on("dialog", dialog => dialog.accept());
  await page.goto(`${base}/admin/careers/review?formId=${testers.id}`);
  await expect(page.getByRole("combobox", { name: "Select application form" })).toHaveValue(testers.id);
  await expect(page.locator(".career-application-row")).toHaveCount(20);
  await expect(page.locator(".career-ai-score").first()).toContainText("-/10");
  await expect(page.getByRole("button", { name: "Run AI review", exact: true })).toBeDisabled();
  await page.getByRole("link", { name: "Edit AI criteria", exact: true }).click();
  await page.getByLabel("What makes a good application?", { exact: true }).fill("Reward useful testing reasoning and actionable explanations. Do not reward length alone.");
  await page.getByRole("button", { name: "Add sample answer", exact: false }).click();
  await page.getByLabel("Question for sample 1", { exact: true }).selectOption("How would you reproduce a bug?");
  await page.getByLabel("Sample answer 1", { exact: true }).fill("I would test things.");
  await page.getByLabel("Sample 1 mark", { exact: true }).selectOption("1");
  await page.getByLabel("Why this mark?", { exact: true }).fill("It has no actionable steps.");
  await page.getByRole("button", { name: "Draft guide with Luna", exact: true }).click();
  await expect(page.getByLabel("Criterion 1 name", { exact: true })).toHaveValue("Reasoning");
  await page.getByLabel("Criterion 1 importance", { exact: true }).selectOption("2");
  await expect(page.locator(".career-ai-criterion").first()).toContainText("67% of criteria score");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.locator(".career-notice[role=status]")).toContainText("Draft saved");
  assert.equal((await service.adminForm(testers.id)).publishedVersion, testers.publishedVersion);
  assert.equal(memory.documents.get(`careerFormVersions/${testers.publishedVersion}`).aiReview, undefined);
  await page.getByRole("link", { name: "Review applications ↗", exact: true }).click();
  await page.getByRole("combobox", { name: "Application status filter" }).selectOption("under_review");
  await expect(page.locator(".career-application-row")).toHaveCount(5);
  await page.getByRole("button", { name: "Run AI review", exact: true }).click();
  await expect(page.locator(".career-ai-run")).toContainText("Review completed", { timeout: 30000 });
  await expect(page.getByRole("combobox", { name: "Application status filter" })).toHaveValue("under_review");
  await expect(page.locator(".career-application-row")).toHaveCount(5);
  assert.equal(calls.length, 47); assert.ok(calls.every(call => call.opening.title === "Tester November"));
  assert.ok(calls.every(call => !JSON.stringify(call).includes("Private material")));
  await page.getByRole("combobox", { name: "Application status filter" }).selectOption("");
  await page.getByRole("combobox", { name: "Sort applications" }).selectOption("ai_rank");
  await expect(page.locator(".career-application-row")).toHaveCount(20);
  await expect(page.locator(".career-ai-score").first()).not.toContainText("Unranked");
  await page.getByRole("button", { name: "Next →", exact: true }).click();
  await page.getByRole("button", { name: "Next →", exact: true }).click();
  await expect(page.locator(".career-application-row")).toHaveCount(7);
  await expect(page.locator(".career-ai-score").last()).toContainText("of 47");
  await page.getByRole("textbox", { name: "Search applicants" }).fill("Robloxapplicant00");
  await expect(page.locator(".career-application-row")).toHaveCount(1);
  await page.locator(".career-application-row").click();
  await expect(page.getByRole("region", { name: "AI assessment" })).toContainText("Criteria score:");
  await expect(page.locator(".career-ai-grade-list")).toContainText("I describe 0 practical steps.");
  await page.getByRole("link", { name: "Review queue", exact: false }).click();
  await expect(page.getByRole("textbox", { name: "Search applicants" })).toHaveValue("Robloxapplicant00");
  await page.getByRole("combobox", { name: "Select application form" }).selectOption(developers.id);
  await expect(page.locator(".career-application-row")).toHaveCount(3);
  await expect(page.locator(".career-ai-score").first()).toContainText("-/10");
  actor = { id: "lead", username: "lead", displayName: "QA Lead", role: "leadqa" };
  await page.goto(`${base}/admin/careers/review?formId=${testers.id}`);
  await expect(page.getByRole("button", { name: "Run AI review", exact: true })).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: "Select application form" }).locator("option")).toHaveCount(2);
  actor = { id: "applicant00", username: "applicant00", displayName: "Applicant", role: "member" };
  await page.goto(`${base}/applications/applicant00`);
  await expect(page.locator(".career-word-total")).toContainText("5 words");
  await expect(page.locator(".career-ai-assessment")).toHaveCount(0);
  actor = admin;
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${base}/admin/careers/review?formId=${testers.id}`);
  await page.locator(".career-application-row").first().scrollIntoViewIfNeeded();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  await page.screenshot({ path: "/tmp/careers-ai-review-mobile.png" });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("combobox", { name: "Sort applications" }).selectOption("ai_rank");
  await page.locator(".career-application-row").first().scrollIntoViewIfNeeded();
  await page.screenshot({ path: "/tmp/careers-ai-review-desktop.png" });
  assert.deepEqual(errors, []); assert.deepEqual(violations, []); assert.deepEqual(external, []);
  console.log("PASS: private criteria/examples/drafted guide/weights save without republishing; form selector, admin-only 47-application run despite status filter, atomic ranking, complete-page sorting, search/back navigation, score colours/unranked state, QA/member isolation, mobile layout and restrictive CSP. Deterministic provider only.");
} finally { await worker.stop(); await browser?.close(); await new Promise(resolve => server.close(resolve)); }
