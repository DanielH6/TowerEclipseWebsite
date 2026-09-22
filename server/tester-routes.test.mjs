import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createTesterRouter } from './tester-routes.mjs';
import { requireRole } from './auth-context.mjs';

test('tester directory and target history reject anonymous, member, QA and QA lead requests', async t => {
  const calls = [];
  const app = express();
  app.use((req, _res, next) => { const role = req.get('X-Test-Role'); if (role) req.authSession = { role }; next(); });
  app.use('/testers', createTesterRouter({ testers: async () => { calls.push('list'); return {}; }, tester: async id => { calls.push(id); return {}; } }, requireRole('dev')));
  const server = await new Promise((resolve, reject) => { const instance = app.listen(0, '127.0.0.1', error => error ? reject(error) : resolve(instance)); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/testers`;
  for (const path of ['', '/123456']) {
    assert.equal((await fetch(base + path)).status, 401);
    for (const role of ['member', 'qa', 'leadqa']) assert.equal((await fetch(base + path, { headers: { 'X-Test-Role': role } })).status, 403);
  }
  assert.deepEqual(calls, []);
  for (const path of ['', '/123456']) assert.equal((await fetch(base + path, { headers: { 'X-Test-Role': 'dev' } })).status, 200);
  assert.deepEqual(calls, ['list', '123456']);
});
