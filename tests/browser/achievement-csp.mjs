import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import express from "express";
import { chromium } from "@playwright/test";
import { createAchievementListService } from "../../server/achievement-list.mjs";
import { createMemoryDb } from "../../server/testing/careers-memory-db.mjs";

// Reproduce the restrictive frontend policy observed on /list on 2026-10-03.
// In particular, NO blob: images and NO Google Fonts stylesheets or font hosts.
// All test data/storage are disposable; this script never connects to production.
const policy = "default-src 'self'; base-uri 'none'; object-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data: https://cdn.discordapp.com https://media.discordapp.net; connect-src 'self'";
const memory = createMemoryDb();
const objects = new Map();
const app = express();
app.use((_req, res, next) => { res.setHeader("Content-Security-Policy", policy); next(); });
app.use(express.static("dist"));
app.use((_req, res) => res.sendFile("index.html", { root: `${process.cwd()}/dist` }));
const server = await new Promise(resolve => { const instance = app.listen(0, "127.0.0.1", () => resolve(instance)); });
const base = `http://127.0.0.1:${server.address().port}`;
const service = createAchievementListService(memory.db, { thumbnailStorage: {
  policy: () => ({ enabled: true, maxFileSizeBytes: 5242880, allowedExtensions: ["png", "jpg", "jpeg"] }),
  normalize: input => ({ originalName: input.fileName, objectName: input.fileName, contentType: input.contentType, size: input.size }),
  upload: (key, type) => ({ url: `${base}/fixture-storage/${key}`, headers: { "Content-Type": type }, expiresIn: 300 }),
  download: key => `${base}/fixture-storage/${key}`,
  head: async key => { const object = objects.get(key); return object ? { size: object.bytes.length, contentType: object.type } : null; },
  remove: async key => objects.delete(key),
} });
const actor = { id: "fixture", role: "dev", displayName: "Preview Admin" };
let browser;
try {
  browser = await chromium.launch({ ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}), headless: true });
  const page = await browser.newPage();
  page.setDefaultTimeout(12000);
  const violations = [], errors = [], externalRequests = [];
  await page.exposeFunction("reportCspViolation", value => violations.push(value));
  await page.addInitScript(() => document.addEventListener("securitypolicyviolation", event => window.reportCspViolation({ directive: event.effectiveDirective, uri: event.blockedURI })));
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname;
    if (url.origin !== base) { externalRequests.push(url.href); return route.abort(); }
    if (path.startsWith("/fixture-storage/")) {
      const key = decodeURIComponent(path.slice("/fixture-storage/".length));
      objects.set(key, { bytes: request.postDataBuffer(), type: request.headers()["content-type"] });
      return route.fulfill({ status: 200 });
    }
    if (!path.startsWith("/api/")) return route.continue();
    try {
      if (path === "/api/auth/me") return route.fulfill({ json: { authenticated: true, csrfToken: "fixture", user: actor } });
      if (path === "/api/roblox/stats") return route.fulfill({ json: { stats: {} } });
      if (path === "/api/list/thumbnail-config") return route.fulfill({ json: service.thumbnails.policy() });
      if (path === "/api/list/thumbnails") return route.fulfill({ status: 201, json: await service.thumbnails.begin(request.postDataJSON(), actor) });
      const match = path.match(/^\/api\/list\/thumbnails\/([^/]+)\/(image|complete)$/);
      if (match?.[2] === "complete") return route.fulfill({ json: await service.thumbnails.complete(match[1], actor) });
      if (match?.[2] === "image") {
        const location = await service.thumbnails.image(match[1], actor);
        const object = objects.get(decodeURIComponent(new URL(location).pathname.slice("/fixture-storage/".length)));
        return route.fulfill({ contentType: object.type, body: object.bytes });
      }
      if (path === "/api/list") return route.fulfill({ json: request.method() === "GET" ? await service.read() : await service.save(request.postDataJSON(), actor) });
      return route.fulfill({ status: 404, json: { error: "Isolated fixture" } });
    } catch (error) { return route.fulfill({ status: error.status || 500, json: { error: error.message } }); }
  });
  await service.save({ revision: 0, entries: [{ id: "fixture-entry", name: "CSP upload check", completionMode: "solo", difficulty: 6.9, verifier: "Preview Player", videoUrl: "", requirements: "" }] }, actor);
  await page.goto(`${base}/admin/list`);
  await page.waitForFunction(() => document.querySelector('input[type="file"]')?.disabled === false);
  const input = page.getByLabel("Upload thumbnail image", { exact: true });
  await input.setInputFiles({ name: "invalid.png", mimeType: "image/png", buffer: Buffer.from("Not an image") });
  await page.getByRole("alert").filter({ hasText: "could not be opened" }).waitFor();
  assert.equal(objects.size, 0);
  await input.setInputFiles({ name: "thumbnail.png", mimeType: "image/png", buffer: await readFile("public/harbor-background.png") });
  await page.getByRole("status").filter({ hasText: "Thumbnail uploaded." }).waitFor();
  await page.waitForFunction(() => document.querySelector(".list-thumbnail-preview")?.naturalWidth > 0);
  await page.getByRole("button", { name: "PUBLISH LIST", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "List published." }).waitFor();
  assert.ok((await service.read()).entries[0].thumbnailId);
  await page.getByRole("link", { name: "VIEW PUBLIC LIST" }).click();
  await page.waitForFunction(() => document.querySelector(".achievement-thumbnail > img")?.naturalWidth > 0);
  const fonts = await page.evaluate(async () => {
    const loaded = await Promise.all([document.fonts.load('500 16px "Montserrat"'), document.fonts.load('600 16px "Roboto Mono"')]);
    return loaded.map(faces => faces.map(face => face.status));
  });
  assert.deepEqual(fonts, [["loaded"], ["loaded"]]);
  assert.deepEqual(errors, []);
  assert.deepEqual(violations, []);
  assert.deepEqual(externalRequests, []);
  console.log("PASS: corrupt image rejected; PNG upload, preview, publication and public thumbnail work with blob: blocked; both local fonts load; zero CSP violations or external requests. Isolated storage only.");
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
