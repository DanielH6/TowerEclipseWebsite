import assert from "node:assert/strict";
import express from "express";
import { chromium, expect } from "@playwright/test";
import { createAchievementListService } from "../../server/achievement-list.mjs";
import { createMemoryDb } from "../../server/testing/careers-memory-db.mjs";

// Disposable list and admin session. No production requests or writes.
const service = createAchievementListService(createMemoryDb().db);
const actor = { id: "fixture", role: "dev", displayName: "List Admin" };
const app = express();
app.use(express.static("dist"));
app.use((_req, res) => res.sendFile("index.html", { root: `${process.cwd()}/dist` }));
const server = await new Promise((resolve, reject) => {
  const instance = app.listen(0, "127.0.0.1", () => resolve(instance)); instance.on("error", reject);
});
const base = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  await service.save({ revision: 0, entries: [
    { id: "verified", name: "Verified summit", completionMode: "solo", difficulty: 6.9, verifier: "Summit Player", videoUrl: "", requirements: "No consumables" },
    { id: "verified-two", name: "Verified foothill", completionMode: "grouped", difficulty: 5.2, verifier: "Foothill Team", videoUrl: "https://youtu.be/abcdefghijk", requirements: "" },
  ] }, actor);
  browser = await chromium.launch({ ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}), headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [], externalRequests = [];
  page.on("pageerror", error => errors.push(error.message));
  page.setDefaultTimeout(12000);
  await page.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname;
    if (url.origin !== base) {
      // Supply a same test image for YouTube thumbnails, without accessing YouTube.
      if (url.hostname === "i.ytimg.com") return route.fulfill({ status: 200, contentType: "image/png", path: "public/favicon.png" });
      externalRequests.push(url.href); return route.abort();
    }
    if (!path.startsWith("/api/")) return route.continue();
    try {
      if (path === "/api/auth/me") return route.fulfill({ json: { authenticated: true, csrfToken: "fixture", user: actor } });
      if (path === "/api/roblox/stats") return route.fulfill({ json: { stats: {} } });
      if (path === "/api/list/thumbnail-config") return route.fulfill({ json: service.thumbnails.policy() });
      if (path === "/api/list/history") return route.fulfill({ json: await service.history() });
      if (path === "/api/list") return route.fulfill({ json: request.method() === "GET" ? await service.read() : await service.save(request.postDataJSON(), actor) });
      return route.fulfill({ status: 404, json: { error: "Isolated fixture" } });
    } catch (error) { return route.fulfill({ status: error.status || 500, json: { error: error.message } }); }
  });

  await page.goto(`${base}/admin/list`);
  await page.getByRole("button", { name: "+ ADD", exact: true }).click();
  await page.getByLabel("Achievement name", { exact: true }).fill("Theoretical peak");
  await page.getByLabel("Theoretical achievement", { exact: true }).check();
  await expect(page.getByLabel("Verifier", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("YouTube showcase link (optional)")).toHaveValue("");
  await page.getByLabel("Difficulty rating", { exact: true }).fill("8.2");
  await page.getByRole("combobox").selectOption("0");
  await expect(page.locator(".list-live-preview")).toContainText("THEORETICAL · UNVERIFIED");
  await page.getByRole("button", { name: "PUBLISH LIST", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "List published." }).waitFor();
  const theoreticalId = (await service.read()).entries[0].id;
  assert.equal((await service.read()).entries[0].verifier, "");
  assert.equal((await service.read()).entries[0].videoUrl, "");
  await page.reload();
  await expect(page.getByLabel("Theoretical achievement", { exact: true })).toBeChecked();

  await page.getByRole("link", { name: "VIEW PUBLIC LIST" }).click();
  await expect(page.locator(".achievement-entries .achievement-card")).toHaveCount(2);
  await expect(page.locator("#achievement-verified .achievement-rank strong")).toHaveText("#01");
  await expect(page.locator("#achievement-verified-two .achievement-rank strong")).toHaveText("#02");
  await page.getByRole("button", { name: "Theoretical", exact: true }).click();
  await expect(page.locator(".achievement-entries .achievement-card")).toHaveCount(3);
  await expect(page.locator(`#achievement-${theoreticalId}`)).toContainText("THEORETICAL · UNVERIFIED");
  await expect(page.locator(`#achievement-${theoreticalId}`)).not.toContainText("Verified by");
  await expect(page.locator("#achievement-verified .achievement-rank strong")).toHaveText("#02");
  await expect(page.locator("#achievement-verified-two .achievement-rank strong")).toHaveText("#03");
  await page.getByPlaceholder("Achievement or verifier…").fill("foothill");
  await expect(page.locator(".achievement-entries .achievement-card")).toHaveCount(1);
  await expect(page.locator(".achievement-rank strong")).toHaveText("#03");
  await page.getByPlaceholder("Achievement or verifier…").fill("");
  await page.getByLabel("With verification video", { exact: true }).check();
  await expect(page.locator(".achievement-entries .achievement-card")).toHaveCount(1);
  await expect(page.locator(".achievement-entries")).toContainText("Verified foothill");
  await page.getByLabel("With verification video", { exact: true }).uncheck();

  // A direct shared link must reveal a theoretical card even without its view query.
  await page.goto(`${base}/list#achievement-${theoreticalId}`);
  await expect(page.getByRole("button", { name: "Theoretical", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(`#achievement-${theoreticalId}`)).toBeVisible();
  await page.screenshot({ path: "/tmp/achievement-theoretical-desktop.png", fullPage: true });
  for (const width of [1100, 800, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, `No horizontal overflow at ${width}px`);
  }
  await page.screenshot({ path: "/tmp/achievement-theoretical-mobile.png", fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });

  await page.getByRole("button", { name: "Change Log", exact: true }).click();
  await page.locator(".list-change-content").filter({ hasText: "Theoretical peak" }).getByRole("link", { name: "Theoretical peak", exact: true }).click();
  await expect(page.getByRole("button", { name: "Theoretical", exact: true })).toHaveAttribute("aria-pressed", "true");

  await page.goto(`${base}/admin/list`);
  await page.getByLabel("Theoretical achievement", { exact: true }).uncheck();
  await page.getByRole("button", { name: "PUBLISH LIST", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Verifier");
  await page.getByLabel("Verifier", { exact: true }).fill("Peak Player");
  await page.getByRole("button", { name: "PUBLISH LIST", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "List published." }).waitFor();
  await page.getByRole("link", { name: "VIEW PUBLIC LIST" }).click();
  await expect(page.locator(".achievement-entries .achievement-card")).toHaveCount(3);
  await expect(page.locator(`#achievement-${theoreticalId}`)).toContainText("Verified by Peak Player");
  await expect(page.locator(`#achievement-${theoreticalId} .achievement-theoretical-badge`)).toHaveCount(0);
  await page.getByRole("button", { name: "Change Log", exact: true }).click();
  const latestChange = page.locator(".list-publication").first().locator(".list-change").filter({ hasText: "Theoretical peak" });
  await latestChange.getByText(/View .* field changes/).click();
  await expect(latestChange).toContainText("Verification status");
  await expect(latestChange).toContainText("Theoretical · Unverified");
  await expect(latestChange.getByRole("link", { name: "Theoretical peak", exact: true })).toHaveAttribute("href", `/list#achievement-${theoreticalId}`);
  assert.deepEqual(errors, []); assert.deepEqual(externalRequests, []);
  console.log("PASS: theoretical creation/publication without verification, reload, verified and combined ranks, labels, search/video filters, shared/history links, promotion to verified, and 320–1440px layout. Disposable data only.");
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
