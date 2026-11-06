import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import express from "express";
import { chromium, expect } from "@playwright/test";
import { createWorkflowMemoryDb } from "../../server/testing/workflow-memory-db.mjs";

// Real built UI, bug router, permissions, snapshot query service, and mutations.
// Only Firestore/session/R2 transports are replaced with isolated synthetic data.
const memory = createWorkflowMemoryDb(), sessions = new Map();
const dictionaryNames = ["statuses", "versions", "priorities", "categories", "types", "devices"];
const entry = (id, label = id) => ({ id, code: id.replaceAll("-", "_"), label, active: true, sortOrder: 1, color: null, terminal: ["closed", "rejected"].includes(id) });
const catalog = {
  statuses: [entry("pending-approval", "Pending approval"), entry("approved", "Approved")],
  versions: [entry("v1", "Version one")], priorities: [entry("medium", "Medium")],
  categories: [entry("survival", "Survival")], types: [entry("bug", "Bug")], devices: [entry("pc", "PC")],
};
for (const name of dictionaryNames) for (const value of catalog[name]) memory.documents.set(`dictionaries/${name}/items/${value.id}`, value);
const apply = (reference, values) => {
  const current = memory.documents.get(reference.path) ?? {};
  memory.documents.set(reference.path, { ...current, ...Object.fromEntries(Object.entries(values).map(([key, value]) => [key, value?.testIncrement === undefined ? value : Number(current[key] ?? 0) + value.testIncrement])) });
};
memory.db.batch = () => {
  const writes = [];
  return {
    set: (reference, values, options) => writes.push(() => options?.merge ? apply(reference, values) : memory.documents.set(reference.path, values)),
    update: (reference, values) => writes.push(() => apply(reference, values)),
    delete: reference => writes.push(() => memory.documents.delete(reference.path)),
    commit: async () => { writes.forEach(write => write()); },
  };
};
memory.db.runTransaction = async callback => {
  const batch = memory.db.batch(), result = await callback({ ...batch, get: reference => reference.get() });
  await batch.commit(); return result;
};
memory.db.recursiveDelete = async reference => { for (const key of memory.documents.keys()) if (key === reference.path || key.startsWith(reference.path + "/")) memory.documents.delete(key); };
globalThis.__bugBrowserFixture = { db: memory.db, sessions, catalog, entry };
const serverUrl = name => new URL(`../../server/${name}`, import.meta.url).href;
const substitutions = new Map([
  [serverUrl("firebase.mjs"), `export { Timestamp } from ${JSON.stringify(serverUrl("firestore-timestamp.mjs"))}; export const db = globalThis.__bugBrowserFixture.db; export const FieldValue = { serverTimestamp: () => new Date(), increment: value => ({testIncrement:value}) };`],
  [serverUrl("session-store.mjs"), "export const getSession = id => globalThis.__bugBrowserFixture.sessions.get(id);"],
  [serverUrl("dictionaries.mjs"), `const fixture = globalThis.__bugBrowserFixture; export const dictionarySnapshot = value => value; export const getDictionaryEntry = async (name,id) => fixture.catalog[name].find(value=>value.id===id) ?? fixture.entry(id); export const getDictionaryCatalog = async () => fixture.catalog;`],
  [serverUrl("r2.mjs"), `export const attachmentStoragePolicy = () => ({enabled:false,maxFilesPerReport:10,maxFileSizeBytes:5242880,allowedExtensions:['png','jpg','jpeg']}); export const createAttachmentDownloadUrl = key => 'https://fixture.invalid/'+key; export const createAttachmentUploadUrl = () => ({url:'https://fixture.invalid/upload',headers:{},expiresIn:600}); export const deleteAttachmentObject = async () => {}; export const headAttachmentObject = async () => ({size:12,contentType:'image/png',etag:'fixture'}); export const normalizeAttachmentInput = input => input;`],
]);
const hooks = registerHooks({ load(url, context, nextLoad) { return substitutions.has(url) ? { format: "module", source: substitutions.get(url), shortCircuit: true } : nextLoad(url, context); } });
const { createBugRouter } = await import("../../server/bug-routes.mjs");
const { SESSION_COOKIE, signCookieValue } = await import("../../server/security.mjs");
const { sessionFromRequest, publicUser, requireAuth, requireRole, requireCsrf } = await import("../../server/auth-context.mjs");
const { normalizeReportLinks } = await import("../../server/bug-workflow.mjs");
hooks.deregister();
const stamp = new Date(Date.now() - 60_000), actor = role => ({ discordId: `user-${role}`, username: role, displayName: role === "qa" ? "Fixture tester" : role, avatarUrl: null, role });
for (const role of ["qa", "member", "dev"]) sessions.set(`session-${role}`, { role, csrfToken: "fixture", roleCheckedAt: Date.now(), discordUser: { id: `user-${role}`, username: role, global_name: role === "qa" ? "Fixture tester" : role, avatar: null }, discordMember: { nick: null } });
const reportId = "r01204";
for (let n = 0; n < 1205; n++) memory.documents.set(`bugReports/r${String(n).padStart(5, "0")}`, {
  displayId: `TE-${String(n + 1).padStart(6, "0")}`, description: n === 0 ? "Old unique historical freeze issue" : "Freeze tower targeting issue in Survival",
  reporter: actor("qa"), approval: { state: "pending", comment: "", approvedBy: null, approvedAt: null, rejectedBy: null, rejectedAt: null },
  status: catalog.statuses[0], version: catalog.versions[0], priority: catalog.priorities[0], category: catalog.categories[0], type: catalog.types[0], device: catalog.devices[0],
  submissionState: "submitted", commentsCount: n === 1204 ? 125 : 0, developerNotesCount: n === 1204 ? 1 : 0, attachmentsCount: 0, createdAt: stamp, submittedAt: stamp, updatedAt: stamp,
});
for (let n = 0; n < 125; n++) memory.documents.set(`bugReports/${reportId}/comments/c${String(n).padStart(3, "0")}`, { body: `Synthetic comment ${n}`, author: actor("qa"), createdAt: stamp, updatedAt: null });
memory.documents.set(`bugReports/${reportId}/developerNotes/private`, { body: "PRIVATE NOTE MUST NEVER REACH QA", author: actor("dev"), createdAt: stamp });
let release = {
  id: "release", title: "Synthetic release", version: "v1", status: "draft", contentType: "game_update", isMinor: false, developerCommentHtml: "", blogHtml: "", coverImageId: null, coverImage: null, publishedOn: null, publishedAt: null, createdAt: stamp.toISOString(), updatedAt: stamp.toISOString(), linkedReports: [],
  sections: ["new_features", "balancing", "bug_fixes", "small_changes"].map(kind => ({ id: kind, kind, title: kind, introHtml: "", items: [] })),
  imagePolicy: { enabled: false, maxImagesPerUpdate: 20, maxFileSizeBytes: 5242880, allowedExtensions: ["png", "jpg", "jpeg"] },
};
const app = express();
app.use((_req, res, next) => { res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'"); next(); });
app.use(express.json());
app.get("/api/auth/me", (req, res) => { const session = sessionFromRequest(req); res.json(session ? { authenticated: true, csrfToken: session.csrfToken, user: publicUser(session) } : { authenticated: false }); });
app.get("/api/roblox/stats", (_req, res) => res.json({ stats: {} }));
app.get("/api/dictionaries", (_req, res) => res.json({ dictionaries: catalog }));
app.get("/api/account/queues", (_req, res) => res.json({ queues: [] }));
app.get(["/api/account", "/api/account/"], (req, res) => { const session = sessionFromRequest(req); res.json({ profile: { discordId: session.discordUser.id, ...publicUser(session), firstLoginAt: stamp.toISOString(), roblox: null, activitySeenAt: null }, robloxLinkingEnabled: false }); });
app.get("/api/careers/applications", (_req, res) => res.json({ items: [], nextCursor: null }));
app.use("/api/bugs", createBugRouter());
app.get("/api/admin/updates/release", requireAuth, requireRole("dev"), (_req, res) => res.json({ update: release }));
app.put("/api/admin/updates/release", requireAuth, requireRole("dev"), requireCsrf, (req, res) => { release = { ...release, ...req.body, linkedReports: normalizeReportLinks(req.body.linkedReports) }; res.json({ update: release }); });
app.use((error, _req, res, _next) => res.status(error.status || 500).json({ error: error.message }));
app.use(express.static("dist"));
app.use((_req, res) => res.sendFile("index.html", { root: `${process.cwd()}/dist` }));
const server = await new Promise((resolve, reject) => { const instance = app.listen(0, "127.0.0.1", error => error ? reject(error) : resolve(instance)); });
const base = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || "chrome", headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const errors = [], violations = [], external = [], requests = [];
  await context.exposeFunction("reportViolation", value => violations.push(value));
  await context.addInitScript(() => document.addEventListener("securitypolicyviolation", event => window.reportViolation(event.effectiveDirective)));
  await context.route("**/*", route => { if (new URL(route.request().url()).origin !== base) { external.push(route.request().url()); return route.abort(); } return route.continue(); });
  context.on("page", tab => { tab.setDefaultTimeout(12000); tab.on("pageerror", error => errors.push(error.message)); tab.on("request", request => { if (new URL(request.url()).pathname.startsWith("/api/")) requests.push({ url: request.url(), method: request.method() }); }); tab.on("dialog", dialog => dialog.accept()); });
  async function role(value) { await context.clearCookies(); if (value) await context.addCookies([{ name: SESSION_COOKIE, value: signCookieValue(`session-${value}`), url: base, httpOnly: true, sameSite: "Lax" }]); }
  const page = await context.newPage();
  const listCalls = () => requests.filter(request => new URL(request.url).pathname === "/api/bugs" && request.method === "GET");
  const reportCalls = () => requests.filter(request => new URL(request.url).pathname === `/api/bugs/${reportId}` && request.method === "GET");
  await role("qa");
  const initialResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/api/bugs" && response.request().method() === "GET");
  await page.goto(`${base}/bugs`);
  const initial = await (await initialResponse).json();
  await expect(page.locator(".bug-table tbody tr")).toHaveCount(50);
  await expect(page.getByRole("navigation", { name: "Primary navigation" }).getByRole("link", { name: "BUGS", exact: true })).toBeVisible();
  assert.equal(initial.pagination.total, 1205);
  const ordinaryReads = memory.calls.filter(call => call.path === "bugReports" && !call.aggregate && !call.lookup);
  assert.equal(ordinaryReads.length, 1); assert.equal(ordinaryReads[0].documents, 51);
  const secondResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/api/bugs" && new URL(response.url()).searchParams.get("page") === "2");
  await page.getByRole("button", { name: "NEXT", exact: true }).first().click();
  const second = await secondResponse;
  assert.ok(new URL(second.url()).searchParams.get("cursor"));
  assert.equal((await second.json()).snapshot, initial.snapshot);
  await expect(page.locator(".pagination-controls.is-compact .pagination-page.is-active")).toHaveText("2");
  const beforePrevious = listCalls().length;
  await page.getByRole("button", { name: "PREVIOUS", exact: true }).first().click();
  await expect(page.locator(".pagination-controls.is-compact .pagination-page.is-active")).toHaveText("1");
  assert.equal(listCalls().length, beforePrevious, "Cached previous-page navigation makes no API request");

  await page.getByPlaceholder("ID, description, reporter…").fill("Old unique");
  const searchResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/api/bugs" && new URL(response.url()).searchParams.has("search"));
  await page.getByRole("button", { name: "APPLY", exact: true }).click();
  const searched = await searchResponse;
  assert.equal(new URL(searched.url()).searchParams.get("snapshot"), initial.snapshot);
  await expect(page.locator(".bug-table tbody tr")).toHaveCount(1);
  await expect(page.locator(".bug-table tbody")).toContainText("Old unique historical freeze issue");
  const filteredUrl = page.url(), beforeFilteredBack = listCalls().length;
  await page.getByRole("link", { name: "TE-000001", exact: true }).click();
  await expect(page.getByRole("heading", { name: "BUG REPORT DETAILS", exact: true })).toBeVisible();
  assert.equal(new URL(page.url()).searchParams.get("returnTo"), new URL(filteredUrl).pathname + new URL(filteredUrl).search);
  await page.getByRole("link", { name: "BACK TO REPORTS", exact: true }).click();
  await expect(page).toHaveURL(filteredUrl);
  await expect(page.getByPlaceholder("ID, description, reporter…")).toHaveValue("Old unique");
  await expect(page.locator(".bug-table tbody tr")).toHaveCount(1);
  await expect(page.locator(".bug-table tbody")).toContainText("Old unique historical freeze issue");
  assert.equal(listCalls().length, beforeFilteredBack, "Explicit back-to-reports keeps filters and reuses the cached snapshot/page");
  const beforeReset = listCalls().length;
  await page.getByRole("button", { name: "RESET", exact: true }).click();
  await expect(page.locator(".bug-table tbody tr")).toHaveCount(50);
  assert.equal(listCalls().length, beforeReset, "Filter reset reuses the same cached snapshot/page");

  const beforeDetail = memory.calls.length;
  await page.getByRole("link", { name: "TE-001205", exact: true }).click();
  await expect(page.getByRole("heading", { name: "BUG REPORT DETAILS", exact: true })).toBeVisible();
  assert.equal(new URL(reportCalls().at(-1).url).searchParams.get("lazy"), "1");
  assert.equal(memory.calls.slice(beforeDetail).some(call => call.path.startsWith(`bugReports/${reportId}/`)), false, "Opening details reads no collapsed child collections");
  await expect(page.locator(".developer-notes-panel")).toHaveCount(0);
  const comments = page.locator("#bug-comments");
  await comments.locator("summary").click();
  await expect(comments.locator(".message-item")).toHaveCount(50);
  await comments.getByRole("button", { name: "LOAD MORE", exact: true }).click();
  await expect(comments.locator(".message-item")).toHaveCount(100);
  await comments.getByRole("button", { name: "LOAD MORE", exact: true }).click();
  await expect(comments.locator(".message-item")).toHaveCount(125);
  await expect(comments.getByRole("button", { name: "LOAD MORE", exact: true })).toHaveCount(0);
  const coreBeforeComment = reportCalls().length;
  const childReadsBeforeComment = memory.calls.filter(call => call.path === `bugReports/${reportId}/comments` && !call.lookup).length;
  await comments.getByPlaceholder("Add a comment", { exact: true }).fill("New evidence is applied without refetching all sections.");
  await comments.getByRole("button", { name: "ADD COMMENT", exact: true }).click();
  await expect(comments.locator(".message-item")).toHaveCount(126);
  await expect(comments).toContainText("New evidence is applied without refetching all sections.");
  assert.equal(reportCalls().length, coreBeforeComment);
  assert.equal(memory.calls.filter(call => call.path === `bugReports/${reportId}/comments` && !call.lookup).length, childReadsBeforeComment);
  const beforeBack = listCalls().length;
  await page.getByRole("link", { name: "BACK TO REPORTS", exact: true }).click();
  await expect(page.locator(".bug-table tbody tr")).toHaveCount(50);
  assert.equal(listCalls().length, beforeBack, "Returning from a detail keeps the selected snapshot/page");
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  await page.setViewportSize({ width: 1440, height: 1000 });

  await role("dev");
  await page.goto(`${base}/admin/updates/release`);
  await page.getByLabel("Find reports to link", { exact: true }).fill("Freeze tower issue");
  await page.getByRole("button", { name: "SELECT REPORT", exact: true }).first().click();
  const wording = page.getByLabel("Reviewed public release-note wording", { exact: true });
  await expect(wording).toHaveValue("");
  await expect(page.locator(".linked-report-editor")).not.toContainText("Freeze tower targeting issue in Survival");
  await page.getByRole("button", { name: "SAVE DRAFT", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("public wording");
  await wording.fill("Fixed a tower targeting issue.");
  const savedRelease = page.waitForResponse(response => new URL(response.url()).pathname === "/api/admin/updates/release" && response.request().method() === "PUT" && response.ok());
  await page.getByRole("button", { name: "SAVE DRAFT", exact: true }).click();
  await savedRelease;
  assert.equal(release.linkedReports[0].summary, "Fixed a tower targeting issue.");

  for (const value of ["member", null]) {
    await role(value);
    const beforeDenied = memory.calls.length;
    await page.goto(`${base}/bugs`);
    await expect(page).toHaveURL(`${base}/login`);
    await expect(page.getByRole("navigation", { name: "Primary navigation" }).getByRole("link", { name: "BUGS", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "EXPORT DATA", exact: true })).toHaveCount(0);
    assert.equal((await page.request.get(`${base}/api/bugs`)).status(), value ? 403 : 401);
    assert.equal(memory.calls.length, beforeDenied, "Denied pages/API accesses make zero report database calls");
  }
  assert.deepEqual(errors, []); assert.deepEqual(violations, []); assert.deepEqual(external, []);
  console.log("PASS: real bug UI/router/query service, 51-row reads and cursor navigation, complete historical search, snapshot/filter/back reuse, lazy 125-comment pagination, mutation response reuse, QA note privacy, reviewed public wording, member/signed-out guards, and mobile layout. Isolated fixtures only.");
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
