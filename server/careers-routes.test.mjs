import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createCareersRouter } from "./careers-routes.mjs";
import { config } from "./config.mjs";

test("HTTP boundary requires authentication, developer access, same origin, and CSRF", async t => {
  const calls = [];
  const service = new Proxy({}, { get: (_, method) => async (...args) => { calls.push({ method, args }); return { ok: true }; } });
  const app = express(); app.use(express.json());
  const auth = (req, res, next) => {
    const role = req.get("X-Test-Role");
    if (!role) { res.status(401).json({ error: "Sign in" }); return; }
    req.authUser = { id: `test-${role}`, role }; req.authSession = { role, csrfToken: "fixture-csrf" }; next();
  };
  app.use("/api/careers", createCareersRouter({ service, auth }));
  const server = await new Promise((resolve, reject) => { const instance = app.listen(0, "127.0.0.1", error => error ? reject(error) : resolve(instance)); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api/careers`;
  const request = (path, role, method = "GET", extra = {}) => fetch(base + path, { method, headers: { ...(role ? { "X-Test-Role": role } : {}), ...extra } });
  assert.equal((await request("/forms")).status, 200);
  for (const path of ["/forms/test", "/applications", "/applications/test", "/admin/forms", "/admin/applications"]) assert.equal((await request(path)).status, 401);
  for (const role of ["member", "qa", "leadqa"]) {
    for (const path of ["/admin/forms", "/admin/applications", "/admin/applications/test"]) assert.equal((await request(path, role)).status, 403);
    assert.equal((await request("/admin/forms", role, "POST", { "X-CSRF-Token": "fixture-csrf" })).status, 403);
  }
  assert.equal((await request("/admin/forms", "dev")).status, 200);
  for (const [path, role, method] of [["/forms/test/applications", "member", "POST"], ["/applications/test/withdraw", "member", "POST"], ["/admin/forms", "dev", "POST"], ["/admin/forms/test", "dev", "PUT"], ["/admin/applications/test", "dev", "PUT"]]) {
    assert.equal((await request(path, role, method)).status, 403);
    assert.equal((await request(path, role, method, { "X-CSRF-Token": "fixture-csrf", Origin: "https://untrusted.example" })).status, 403);
    assert.ok((await request(path, role, method, { "X-CSRF-Token": "fixture-csrf", Origin: config.appOrigin })).ok);
  }
  await request("/applications?admin=true&applicantId=someone-else", "member");
  const last = calls.at(-1);
  assert.equal(last.method, "listApplications"); assert.equal(last.args[0].id, "test-member"); assert.equal(last.args[2], undefined, "client query cannot enable reviewer access");
});
