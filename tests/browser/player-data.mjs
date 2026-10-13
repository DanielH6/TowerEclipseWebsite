import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "@playwright/test";
import { createPlayerPreviewApp } from "../../server/testing/player-preview-server.mjs";
import { createImportRunBudget, PROPOSED_IMPORT_BUDGET } from "../../server/player-import-budget.mjs";
import { createPlayerImportStore } from "../../server/player-import-store.mjs";
import { planDailyImport } from "../../server/player-import-schedule.mjs";
import { runPlayerImportSweep } from "../../server/player-import-runner.mjs";
import { FIXTURE_PLAYER_ID } from "../../server/testing/game-data-fixtures.mjs";

const output = path.resolve(process.env.PLAYER_QA_OUTPUT_DIR ?? ".runtime/player-viewer-qa");
await mkdir(output, { recursive: true });
const app = await createPlayerPreviewApp();
const server = await new Promise(resolve => { const value = app.listen(0, "127.0.0.1", () => resolve(value)); });
const base = `http://127.0.0.1:${server.address().port}`;
const errors = [], externalRequests = [], checks = [];
let browser;
try {
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? "chrome", headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, reducedMotion: "reduce" });
  await context.route("**/*", route => {
    if (new URL(route.request().url()).origin !== base) { externalRequests.push(route.request().url()); return route.abort(); }
    return route.continue();
  });
  const page = await context.newPage();
  page.setDefaultTimeout(12000);
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(`${base}/admin/players`);
  await page.getByRole("heading", { name: "PLAYER DATA", exact: true }).waitFor();
  await page.getByText("SYNTHETIC PREVIEW — fictional players", { exact: false }).waitFor();
  assert.equal(await page.locator(".player-table tbody tr").count(), 25);
  assert.ok(await page.locator(".bug-table-wrapper").evaluate(element => element.scrollWidth <= element.clientWidth));
  const firstIds = await page.locator(".player-table tbody small").allTextContents();
  await page.getByRole("button", { name: "NEXT PAGE", exact: true }).click();
  await page.getByText("Page 2 ·", { exact: false }).waitFor();
  const secondIds = await page.locator(".player-table tbody small").allTextContents();
  assert.equal(secondIds.filter(id => firstIds.includes(id)).length, 0);
  await page.getByRole("button", { name: "PREVIOUS", exact: true }).click();
  await page.getByText("Page 1 ·", { exact: false }).waitFor();
  checks.push("25-row stable next/previous pagination without duplicates");

  await page.getByLabel("NAME PREFIX", { exact: true }).fill("Preview_0001");
  await page.getByRole("button", { name: "APPLY FILTERS", exact: true }).click();
  await page.locator(".player-table tbody tr").filter({ hasText: "Preview Commander 0001" }).waitFor();
  assert.equal(await page.locator(".player-table tbody tr").count(), 1);
  await page.getByRole("button", { name: `View saved profile ${FIXTURE_PLAYER_ID}` }).click();
  await page.getByRole("heading", { name: "MAIN", exact: true }).waitFor();
  await page.getByRole("heading", { name: "BATTLEFRONT", exact: true }).waitFor();
  const mainRecord = page.getByRole("region", { name: "Selected player profile" });
  await page.getByText("REDACTED SAVED RECORD", { exact: true }).first().click();
  const record = await page.getByLabel("Main redacted saved record").textContent();
  assert.ok(!record.includes("fixture-private")); assert.ok(record.includes("Loadouts"));
  await page.getByText("REDACTED SAVED RECORD", { exact: true }).first().click();
  await page.evaluate(async () => {
    for (const video of document.querySelectorAll("video")) video.pause();
    await document.fonts.ready;
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  await page.screenshot({ path: path.join(output, "players-desktop.png"), fullPage: true });
  await mainRecord.screenshot({ path: path.join(output, "profile-desktop.png") });
  checks.push("prefix filtering, two saved modes and nested record redaction");

  const lookup = page.getByLabel("EXACT ROBLOX USERID", { exact: true });
  await lookup.fill("0"); await page.getByRole("button", { name: "VIEW PROFILE", exact: true }).click();
  await page.getByText("Enter a positive Roblox UserId", { exact: false }).waitFor();
  assert.equal((await context.request.get(`${base}/api/admin/game-data/players/0`)).status(), 400);
  checks.push("client/server identifier validation");
  for (const [offset, expected] of [[1n, "UNAVAILABLE"], [2n, "STALE SNAPSHOT"], [3n, "NO SAVED PROFILE"]]) {
    await lookup.fill(String(BigInt(FIXTURE_PLAYER_ID) + offset));
    await page.getByRole("button", { name: "VIEW PROFILE", exact: true }).click();
    await page.locator(".player-state").filter({ hasText: expected }).waitFor();
  }
  await lookup.fill("123"); await page.getByRole("button", { name: "VIEW PROFILE", exact: true }).click();
  await page.getByText("No saved Main profile", { exact: false }).waitFor();
  checks.push("independent unavailable mode, stale fallback and genuinely missing profiles");

  let releaseOldSearch;
  const oldSearchStarted = new Promise(resolve => { releaseOldSearch = resolve; });
  await page.route("**/api/admin/game-data/players?**", async route => {
    if (new URL(route.request().url()).searchParams.get("search")?.toLowerCase() === "preview_000") {
      releaseOldSearch();
      const response = await route.fetch();
      await new Promise(resolve => setTimeout(resolve, 250));
      await route.fulfill({ response }).catch(() => {});
    } else await route.continue();
  });
  await page.getByLabel("NAME PREFIX", { exact: true }).fill("Preview_000");
  await page.getByRole("button", { name: "APPLY FILTERS", exact: true }).click();
  await Promise.race([oldSearchStarted, new Promise((_, reject) => setTimeout(() => reject(new Error("Delayed search was not observed")), 5000))]);
  await page.getByLabel("NAME PREFIX", { exact: true }).fill("Preview_001");
  await page.getByRole("button", { name: "APPLY FILTERS", exact: true }).click();
  await page.locator(".player-table tbody tr").filter({ hasText: "Preview Commander 0010" }).waitFor();
  await page.waitForTimeout(300);
  const searchNames = await page.locator(".player-table tbody .player-username").allTextContents();
  assert.ok(searchNames.length && searchNames.every(name => name.startsWith("@Preview_001")));
  await page.unroute("**/api/admin/game-data/players?**");
  checks.push("late search response cannot replace newer results");

  let listFailure = "http";
  const listUrl = /\/api\/admin\/game-data\/players\?/;
  await page.route(listUrl, route => {
    const failure = listFailure; listFailure = "";
    if (failure === "http") return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Synthetic search outage." }) });
    if (failure === "network") return route.abort("failed");
    return route.continue();
  });
  await page.getByRole("button", { name: "REFRESH LIST", exact: true }).click();
  await page.getByText("Synthetic search outage.", { exact: true }).waitFor();
  assert.equal(await page.locator(".player-table tbody tr").count(), 0);
  await lookup.fill(FIXTURE_PLAYER_ID);
  await page.getByRole("button", { name: "VIEW PROFILE", exact: true }).click();
  await page.getByRole("heading", { name: "BATTLEFRONT", exact: true }).waitFor();
  assert.ok((await page.getByRole("article", { name: "Main saved profile" }).textContent()).includes("120"));
  checks.push("exact UserId profile remains usable during a summary-index outage");
  await page.getByRole("button", { name: "TRY AGAIN", exact: true }).click();
  await page.locator(".player-table tbody tr").first().waitFor();
  listFailure = "network";
  await page.getByRole("button", { name: "REFRESH LIST", exact: true }).click();
  await page.getByRole("alert").waitFor();
  assert.equal(await page.locator(".player-table tbody tr").count(), 0);
  await page.getByRole("button", { name: "TRY AGAIN", exact: true }).click();
  await page.locator(".player-table tbody tr").first().waitFor();
  await page.unroute(listUrl);
  checks.push("HTTP failure and aborted network search show retry state, clear old rows and recover");

  // The independent-lookup check selected the first player. Move away before
  // observing a new delayed request for that player; same-ID selection is inert.
  await lookup.fill(String(BigInt(FIXTURE_PLAYER_ID) + 8n));
  await page.getByRole("button", { name: "VIEW PROFILE", exact: true }).click();
  await mainRecord.getByRole("heading", { name: "Preview Commander 0009", exact: true }).waitFor();

  let releaseOldProfile;
  const oldProfileStarted = new Promise(resolve => { releaseOldProfile = resolve; });
  const firstProfileUrl = new RegExp(`/api/admin/game-data/players/${FIXTURE_PLAYER_ID}$`);
  await page.route(firstProfileUrl, async route => {
    releaseOldProfile();
    const response = await route.fetch();
    await new Promise(resolve => setTimeout(resolve, 250));
    await route.fulfill({ response }).catch(() => {});
  });
  await lookup.fill(FIXTURE_PLAYER_ID);
  await page.getByRole("button", { name: "VIEW PROFILE", exact: true }).click();
  await Promise.race([oldProfileStarted, new Promise((_, reject) => setTimeout(() => reject(new Error("Delayed profile was not observed")), 5000))]);
  await lookup.fill(String(BigInt(FIXTURE_PLAYER_ID) + 5n));
  await page.getByRole("button", { name: "VIEW PROFILE", exact: true }).click();
  await mainRecord.getByRole("heading", { name: "Preview Commander 0006", exact: true }).waitFor();
  await page.waitForTimeout(300);
  assert.ok(!(await mainRecord.textContent()).includes("Preview Commander 0001"));
  await page.unroute(firstProfileUrl);
  checks.push("aborted prior profile request cannot replace the newly selected player");

  let profileFailure = true;
  const retryId = String(BigInt(FIXTURE_PLAYER_ID) + 6n);
  const retryProfileUrl = new RegExp(`/api/admin/game-data/players/${retryId}$`);
  await page.route(retryProfileUrl, route => {
    if (!profileFailure) return route.continue();
    return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Synthetic profile outage." }) });
  });
  await lookup.fill(retryId);
  await page.getByRole("button", { name: "VIEW PROFILE", exact: true }).click();
  await mainRecord.getByText("Synthetic profile outage.", { exact: true }).waitFor();
  // Keep the simulated outage active through any repeated GETs until the user retries.
  profileFailure = false;
  await mainRecord.getByRole("button", { name: "TRY AGAIN", exact: true }).click();
  await mainRecord.getByRole("heading", { name: "Preview Commander 0007", exact: true }).waitFor();
  await page.unroute(retryProfileUrl);
  checks.push("whole-profile HTTP failure shows retry state and recovers for the same UserId");

  const viewerFont = await page.locator(".workspace-header h2").evaluate(element => getComputedStyle(element).fontFamily);
  const viewerButton = await page.getByRole("button", { name: "APPLY FILTERS", exact: true }).evaluate(element => getComputedStyle(element).backgroundColor);
  await page.getByRole("link", { name: "ADMIN", exact: true }).last().click();
  await page.getByRole("heading", { name: "TEAM OVERVIEW", exact: true }).waitFor();
  assert.equal(await page.locator(".workspace-header h2").evaluate(element => getComputedStyle(element).fontFamily), viewerFont);
  assert.equal(await page.getByRole("button", { name: "REFRESH", exact: true }).evaluate(element => getComputedStyle(element).backgroundColor), viewerButton);
  await page.screenshot({ path: path.join(output, "existing-admin-comparison.png"), fullPage: true });
  await page.getByRole("link", { name: "PLAYER DATA", exact: true }).click();
  await page.getByText("SYNTHETIC PREVIEW — fictional players", { exact: false }).waitFor();
  checks.push("repeated navigation and matching existing admin typography/button styles");

  await page.getByText("IMPORT PLAYER SUMMARIES", { exact: true }).click();
  const importer = page.locator(".player-import-panel");
  await importer.getByText("Main: Ready to continue", { exact: true }).waitFor();
  const requestBodies = [], importWrites = [];
  page.on("request", request => {
    if (request.url().includes("/api/admin/game-data/imports/") && request.method() === "POST") {
      requestBodies.push(request.postData()); if (request.url().endsWith("/apply")) importWrites.push(request.postData());
    }
  });
  await importer.getByRole("button", { name: "PREVIEW NEXT BATCH", exact: true }).click();
  const reviewed = importer.getByRole("region", { name: "Reviewed import batch" });
  await reviewed.getByRole("heading", { name: "REVIEW MAIN BATCH", exact: true }).waitFor();
  assert.equal(await reviewed.locator("li").count(), 5); assert.equal(importWrites.length, 0);
  assert.equal(await importer.getByRole("button", { name: "APPLY REVIEWED BATCH", exact: true }).isDisabled(), true);
  await reviewed.getByLabel("I confirm this batch and its displayed destination and write budget.", { exact: true }).check();
  await importer.getByRole("button", { name: "APPLY REVIEWED BATCH", exact: true }).click();
  await importer.getByText("Batch finished. Preview the next batch when ready.", { exact: true }).waitFor();
  await importer.getByText(/1 pages · 5 observed keys · 5 created/).waitFor();
  assert.equal(importWrites.length, 1); assert.ok(!requestBodies.join("").includes("synthetic-private"));
  await page.reload();
  await page.getByText("IMPORT PLAYER SUMMARIES", { exact: true }).click();
  await importer.getByText(/1 pages · 5 observed keys · 5 created/).waitFor();
  await importer.getByRole("button", { name: "PREVIEW NEXT BATCH", exact: true }).click();
  await reviewed.getByRole("heading", { name: "REVIEW MAIN BATCH", exact: true }).waitFor();
  assert.ok(!(await reviewed.textContent()).includes("UserId 910000001"));
  checks.push("dev import UI: zero-write preview, confirmation, bounded apply and durable next-batch resume after reload");
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await importer.screenshot({ path: path.join(output, "import-review-mobile.png") });
  await page.setViewportSize({ width: 1440, height: 1100 });
  await importer.screenshot({ path: path.join(output, "import-review-desktop.png") });
  // Run the actual private engine against the same in-memory fixtures after
  // manual-batch checks. No production transport or browser mutation route.
  const fixture = app.locals.playerImportFixture;
  const budget = createImportRunBudget(PROPOSED_IMPORT_BUDGET);
  try {
    const completed = await runPlayerImportSweep({ ...fixture.dependencies, store: createPlayerImportStore(fixture.db, { budget }), budget, apply: true });
    assert.equal(completed.status, "scan_complete");
  } finally { budget.dispose(); }
  const writesBeforeStatus = fixture.writes.length;
  await importer.getByRole("button", { name: "REFRESH IMPORT STATUS", exact: true }).click();
  const runStatus = importer.getByRole("region", { name: "Unattended import status" });
  await runStatus.getByText(/scan complete · Sweep day/).waitFor();
  assert.ok((await runStatus.textContent()).includes("1000 profiles"));
  assert.ok((await runStatus.textContent()).includes("19 created"));
  assert.equal(fixture.writes.length, writesBeforeStatus, "reading run status cannot write");
  await runStatus.screenshot({ path: path.join(output, "unattended-run-desktop.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await runStatus.screenshot({ path: path.join(output, "unattended-run-mobile.png") });
  checks.push("private runner resumes manual progress; persisted limits/results display without status-read writes on desktop and mobile");

  const dailyBudget = createImportRunBudget(planDailyImport(fixture.records.get("tePlayerImportJobs/current")?.value, Date.now()).limits);
  try {
    const daily = await runPlayerImportSweep({ ...fixture.dependencies,
      store: createPlayerImportStore(fixture.db, { budget: dailyBudget }), budget: dailyBudget,
      apply: true, intent: "daily", daily: true });
    assert.equal(daily.status, "scan_complete");
  } finally {
    dailyBudget.dispose();
  }
  const writesBeforeDailyStatus = fixture.writes.length;
  await importer.getByRole("button", { name: "REFRESH IMPORT STATUS", exact: true }).click();
  await runStatus.getByRole("heading", { name: "LAST DAILY REFRESH", exact: true }).waitFor();
  assert.equal(fixture.writes.length, writesBeforeDailyStatus);
  await runStatus.screenshot({ path: path.join(output, "daily-refresh-mobile.png") });
  checks.push("website daily refresh status displays its source and remains read-only");

  // Model an acquisition SET that committed while its acknowledgement was lost.
  let job = await fixture.store.readJob();
  await fixture.store.writeJob({ ...job.value, daily: { ...job.value.daily, dueAt: new Date().toISOString() } }, job);
  let acquisitionLost = false;
  fixture.hooks.afterSet = (name, value) => {
    if (!acquisitionLost && name === "tePlayerImportJobs/current" && value.lease) {
      acquisitionLost = true;
      throw new Error("Synthetic acquisition acknowledgement lost");
    }
  };
  const uncertainBudget = createImportRunBudget(planDailyImport((await fixture.store.readJob()).value, Date.now()).limits);
  try {
    const uncertain = await runPlayerImportSweep({ ...fixture.dependencies,
      store: createPlayerImportStore(fixture.db, { budget: uncertainBudget }), budget: uncertainBudget,
      apply: true, intent: "daily", daily: true });
    assert.equal(uncertain.checkpointConfirmed, false);
  } finally {
    uncertainBudget.dispose();
    fixture.hooks.afterSet = null;
  }
  job = await fixture.store.readJob();
  await fixture.store.writeJob({ ...job.value, lease: { ...job.value.lease, until: Date.now() - 1 } }, job);
  await importer.getByRole("button", { name: "REFRESH IMPORT STATUS", exact: true }).click();
  const dailyStatus = importer.getByRole("region", { name: "Daily refresh budget" });
  await dailyStatus.getByText(/unconfirmed chunk · Budget day/).waitFor();
  await dailyStatus.getByText(/Unconfirmed allocations remain charged: 25 profiles/).waitFor();
  await dailyStatus.getByText(/Next eligible:.*Australia\/Sydney/).waitFor();
  assert.ok((await runStatus.textContent()).includes("0 profiles"));
  await dailyStatus.screenshot({ path: path.join(output, "uncertain-chunk-mobile.png") });
  checks.push("uncertain acquisition displays durable charged/reserved quota and Sydney eligibility even with zero recorded profiles");

  // Exhaust the synthetic day's time allowance without refunding unverified chunks.
  job = await fixture.store.readJob();
  const exhausted = structuredClone(job.value);
  exhausted.daily.used.seconds = 1800;
  exhausted.daily.uncertainUsed.seconds = 1740;
  await fixture.store.writeJob(exhausted, job);
  const beforeBudgetStatus = fixture.writes.length;
  await importer.getByRole("button", { name: "REFRESH IMPORT STATUS", exact: true }).click();
  await dailyStatus.getByText(/daily budget exhausted · Budget day/).waitFor();
  await dailyStatus.getByText(/Next eligible:.*03:00:00.*Australia\/Sydney/).waitFor();
  assert.equal(fixture.writes.length, beforeBudgetStatus);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await dailyStatus.screenshot({ path: path.join(output, "daily-lockout-mobile.png") });
  await page.setViewportSize({ width: 1440, height: 1100 });
  await dailyStatus.evaluate(element => element.scrollIntoView({ block: "center" }));
  await dailyStatus.screenshot({ path: path.join(output, "daily-lockout-desktop.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  checks.push("daily quota lockout and next 03:00 Sydney eligibility remain visible and status reads write nothing");
  await page.getByText("IMPORT PLAYER SUMMARIES", { exact: true }).click();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByLabel("EXACT ROBLOX USERID", { exact: true }).fill(FIXTURE_PLAYER_ID);
  await page.getByRole("button", { name: "VIEW PROFILE", exact: true }).click();
  await page.getByRole("heading", { name: "BATTLEFRONT", exact: true }).waitFor();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  const panels = await page.locator(".player-mode").evaluateAll(elements => elements.map(element => { const box = element.getBoundingClientRect(); return { left: box.left, top: box.top, width: box.width, bottom: box.bottom }; }));
  assert.ok(panels[1].top >= panels[0].bottom - 1);
  await page.locator(".player-profile").screenshot({ path: path.join(output, "profile-mobile.png") });
  checks.push("390px mobile: stacked mode panels, no document overflow");

  await page.route(firstProfileUrl, async route => {
    const response = await route.fetch(), data = await response.json();
    data.synthetic = false;
    for (const mode of ["main", "battlefront"]) {
      data[mode].detail = null; data[mode].detailStatus = "withheld_pending_schema";
      data[mode].summary.source.updatedAt = null; data[mode].freshness.sourceUpdatedAt = null;
    }
    await route.fulfill({ response, json: data });
  });
  await page.getByRole("button", { name: "REFRESH PROFILE", exact: true }).click();
  await page.getByText("Expanded saved record is unavailable until its field schema is approved.", { exact: true }).first().waitFor();
  assert.equal(await page.locator(".player-record").count(), 0);
  assert.equal(await page.getByText(/Last Roblox save: Unknown/).count(), 2);
  assert.equal(await page.getByText("Expanded saved record is unavailable until its field schema is approved.", { exact: true }).count(), 2);
  assert.ok((await page.getByRole("article", { name: "Main saved profile" }).textContent()).includes("120"));
  await page.locator(".player-profile").screenshot({ path: path.join(output, "non-fixture-summary-only.png") });
  await page.unroute(firstProfileUrl);
  checks.push("non-fixture-shaped response keeps documented statistics and hides expanded detail in both modes");

  await context.addCookies([{ name: "player_preview_role", value: "member", url: base }]);
  await page.goto(`${base}/login`);
  await page.getByRole("heading", { name: "Synthetic preview", exact: true }).first().waitFor();
  await page.screenshot({ path: path.join(output, "existing-account-comparison.png"), fullPage: true });
  await page.goto(`${base}/admin/players`);
  await page.waitForURL(`${base}/bugs`);
  for (const role of ["member", "qa", "leadqa"]) {
    await context.addCookies([{ name: "player_preview_role", value: role, url: base }]);
    assert.equal((await context.request.get(`${base}/api/admin/game-data/players`)).status(), 403);
    assert.equal((await context.request.get(`${base}/api/admin/game-data/imports/status`)).status(), 403);
  }
  await context.addCookies([{ name: "player_preview_role", value: "guest", url: base }]);
  assert.equal((await context.request.get(`${base}/api/admin/game-data/players`)).status(), 401);
  assert.equal((await context.request.get(`${base}/api/admin/game-data/imports/status`)).status(), 401);
  await page.goto(`${base}/admin/players`); await page.waitForURL(`${base}/login`);
  checks.push("guest UI redirect/401 and member/QA/leadQA server denial/403");
  assert.deepEqual(errors, []); assert.deepEqual(externalRequests, []);
  await writeFile(path.join(output, "browser-results.json"), JSON.stringify({ passed: checks, pageErrors: errors, externalRequests }, null, 2));
  console.log(JSON.stringify({ passed: checks.length, checks, output, pageErrors: errors.length, externalRequests: externalRequests.length }, null, 2));
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
