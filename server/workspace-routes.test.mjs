import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createWorkspaceRouter } from './workspace-routes.mjs';
import { createAdminWorkspaceRouter } from './admin-workspace.mjs';
import { config } from './config.mjs';
test('workspace HTTP routes reject members, enforce CSRF and scope queue/progress writes to the signed-in user', async t => {
  const calls = []; const service = new Proxy({}, { get: (_, method) => async (...args) => { calls.push({ method, args }); return { ok: true }; } });
  const auth = (req, res, next) => { const role = req.get('X-Test-Role'); if (!role) return res.sendStatus(401); req.authUser = { id: `signed-${role}`, role }; req.authSession = { role, csrfToken: 'test-token' }; next(); };
  const app = express(); app.use(express.json()); app.use('/account', createWorkspaceRouter(service, auth)); app.use('/admin', createAdminWorkspaceRouter(service, auth));
  const server = await new Promise((resolve, reject) => { const instance = app.listen(0, '127.0.0.1', error => error ? reject(error) : resolve(instance)); }); t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (path, role, method = 'GET', headers = {}, body) => fetch(base + path, { method, headers: { ...(role ? { 'X-Test-Role': role } : {}), ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) });
  for (const path of ['/account/onboarding', '/account/queues']) {
    assert.equal((await request(path)).status, 401); assert.equal((await request(path, 'member')).status, 403);
    for (const role of ['qa','leadqa','dev']) { assert.equal((await request(path, role)).status, 200); assert.equal((await request(path, role, 'PUT')).status, 403); }
  }
  assert.equal((await request('/admin', 'qa')).status, 403); assert.equal((await request('/admin', 'member')).status, 403); assert.equal((await request('/admin', 'dev')).status, 200);
  assert.equal((await request('/account/queues', 'qa', 'PUT', { 'X-CSRF-Token': 'test-token', Origin: 'https://wrong.test' })).status, 403);
  assert.equal((await request('/account/onboarding', 'qa', 'PUT', { 'X-CSRF-Token': 'test-token', Origin: config.appOrigin, 'Content-Type': 'application/json' }, { userId: 'someone-else' })).status, 200);
  assert.equal(calls.at(-1).args[0], 'signed-qa');
});
