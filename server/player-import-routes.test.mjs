import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { readFile } from "node:fs/promises";
import { requireRole, requireCsrf, requireAuth } from "./auth-context.mjs";
import { createPlayerImportRouter } from "./player-import-routes.mjs";

test("every import route requires server-derived dev access; every POST requires origin and CSRF", async t => {
  const calls = [], origin = "http://127.0.0.1:4317";
  const service = new Proxy({}, { get: (_target, name) => async (...args) => { calls.push({ name, args }); return { ok: true }; } });
  const auth = (request, response, next) => {
    const role = request.get("X-Test-Session"); if (!role) return requireAuth(request, response, next);
    // Spoofing a client-visible role does not influence the real role guard.
    request.authUser = { id: request.get("X-Test-Actor") ?? `signed-${role}`, role: "dev" };
    request.authSession = { role, csrfToken: "synthetic-csrf" }; next();
  };
  const app = express(); app.use(express.json()); app.use("/imports", createPlayerImportRouter({ service, requireAuth: auth, requireAdmin: requireRole("dev"), requireCsrf, appOrigin: origin }));
  const server = await new Promise(resolve => { const instance = app.listen(0, "127.0.0.1", () => resolve(instance)); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (action, role, method = "POST", headers = {}, body = {}) => fetch(`${base}/imports/${action}`, { method,
    headers: { "Content-Type": "application/json", ...(role ? { "X-Test-Session": role } : {}), ...headers }, ...(method === "POST" ? { body: JSON.stringify(body) } : {}) });
  for (const [action, method] of [["status", "GET"], ["preview", "POST"], ["apply", "POST"], ["cancel", "POST"]]) {
    assert.equal((await request(action, null, method)).status, 401);
    for (const role of ["member", "qa", "pentester", "leadqa"]) assert.equal((await request(action, role, method)).status, 403);
  }
  assert.equal(calls.length, 0);
  assert.equal((await request("status", "dev", "GET")).status, 200); assert.equal(calls.at(-1).name, "status");
  const headers = { Origin: origin, "X-CSRF-Token": "synthetic-csrf" };
  for (const action of ["preview", "apply", "cancel"]) {
    assert.equal((await request(action, "dev")).status, 403);
    assert.equal((await request(action, "dev", "POST", { Origin: origin })).status, 403);
    assert.equal((await request(action, "dev", "POST", { ...headers, Origin: "https://evil.invalid" })).status, 403);
    assert.equal((await request(action, "dev", "POST", headers, { universeId: "999", projectId: "foreign", role: "dev" })).status, 400);
    assert.equal((await request(action, "dev", "GET", headers)).status, 404);
  }
  assert.equal(calls.length, 1);
  assert.equal((await request("preview", "dev", "POST", headers, { mode: "battlefront" })).status, 200);
  assert.equal(calls.at(-1).args[1], "signed-dev");
  assert.equal((await request("apply", "dev", "POST", headers, { token: "signed-preview", confirmation: "IMPORT SUMMARIES" })).status, 200);
  assert.equal((await request("cancel", "dev", "POST", headers)).status, 200);
});

test("route failure masks provider text and status reads cannot start mutation actions", async t => {
  const app = express(); app.use(express.json()); let writes = 0;
  const auth = (req, _res, next) => { req.authSession = { role: "dev", csrfToken: "synthetic-csrf" }; req.authUser = { id: "signed-actor" }; next(); };
  const service = { status: () => { throw new Error("synthetic-private-token-provider-message"); }, preview: () => { writes++; }, apply: () => { writes++; }, cancel: () => { writes++; } };
  app.use("/imports", createPlayerImportRouter({ service, requireAuth: auth, requireAdmin: requireRole("dev"), requireCsrf, appOrigin: "http://127.0.0.1:4317" }));
  const server = await new Promise(resolve => { const instance = app.listen(0, "127.0.0.1", () => resolve(instance)); }); t.after(() => new Promise(resolve => server.close(resolve)));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/imports/status?action=apply`);
  assert.equal(response.status, 503); assert.ok(!(await response.text()).includes("synthetic-private")); assert.equal(writes, 0);
  const source = await readFile(new URL("./index.mjs", import.meta.url), "utf8");
  assert.ok(source.includes('requireAdmin: requireRole("dev"), requireCsrf, appOrigin: config.appOrigin'));
  assert.ok(!source.includes("player-import-fixtures"));
});
