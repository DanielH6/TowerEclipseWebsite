import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import express from 'express';
import { createWorkflowMemoryDb } from './testing/workflow-memory-db.mjs';

// Exercise the production router and authorization middleware without credentials,
// persistent sessions, Firestore, or R2. Only service boundaries are replaced.
const memory = createWorkflowMemoryDb();
const sessions = new Map();
const deletedObjects = [];
const dictionaryNames = ['statuses', 'versions', 'priorities', 'categories', 'types', 'devices'];
const entry = (id) => ({ id, code: id.replaceAll('-', '_'), label: id, active: true, terminal: ['closed', 'rejected'].includes(id) });
const applyUpdate = (reference, values) => {
  const current = memory.documents.get(reference.path) ?? {};
  memory.documents.set(reference.path, {
    ...current,
    ...Object.fromEntries(Object.entries(values).map(([key, value]) => [key,
      value?.testIncrement === undefined ? value : Number(current[key] ?? 0) + value.testIncrement,
    ])),
  });
};
memory.db.batch = () => {
  const writes = [];
  return {
    set: (reference, values, options) => writes.push(() => options?.merge
      ? applyUpdate(reference, values) : memory.documents.set(reference.path, values)),
    update: (reference, values) => writes.push(() => applyUpdate(reference, values)),
    delete: reference => writes.push(() => memory.documents.delete(reference.path)),
    commit: async () => { writes.forEach(write => write()); },
  };
};
memory.db.runTransaction = async callback => {
  const batch = memory.db.batch();
  const result = await callback({ ...batch, get: reference => reference.get() });
  await batch.commit();
  return result;
};
memory.db.recursiveDelete = async reference => {
  for (const key of memory.documents.keys()) {
    if (key === reference.path || key.startsWith(reference.path + '/')) memory.documents.delete(key);
  }
};
globalThis.__bugPermissionFixture = { db: memory.db, sessions, deletedObjects, entry, dictionaryNames };
const substitutions = new Map([
  ['firebase.mjs', `
    export { Timestamp } from ${JSON.stringify(new URL('./firestore-timestamp.mjs', import.meta.url).href)};
    export const db = globalThis.__bugPermissionFixture.db;
    export const FieldValue = { serverTimestamp: () => new Date(), increment: value => ({testIncrement:value}) };
  `],
  ['session-store.mjs', 'export const getSession = id => globalThis.__bugPermissionFixture.sessions.get(id);'],
  ['dictionaries.mjs', `
    const fixture = globalThis.__bugPermissionFixture;
    export const dictionarySnapshot = value => value;
    export const getDictionaryEntry = async (_dictionary, id) => fixture.entry(id);
    export const getDictionaryCatalog = async () => Object.fromEntries(fixture.dictionaryNames.map(name => [name, []]));
  `],
  ['r2.mjs', `
    export const attachmentStoragePolicy = () => ({ enabled:true, maxFilesPerReport:10 });
    export const createAttachmentDownloadUrl = key => 'https://fixture.invalid/' + key;
    export const createAttachmentUploadUrl = () => ({ url:'https://fixture.invalid/upload', headers:{}, expiresIn:600 });
    export const deleteAttachmentObject = async key => { globalThis.__bugPermissionFixture.deletedObjects.push(key); };
    export const headAttachmentObject = async () => ({ size:12, contentType:'image/png', etag:'fixture' });
    export const normalizeAttachmentInput = () => ({ objectName:'proof.png', originalName:'proof.png', contentType:'image/png', contentDisposition:'inline', previewKind:'image', size:12 });
  `],
].map(([name, source]) => [new URL(name, import.meta.url).href, source]));
const hooks = registerHooks({ load(url, context, nextLoad) {
  if (substitutions.has(url)) return { format: 'module', source: substitutions.get(url), shortCircuit: true };
  return nextLoad(url, context);
} });
const { createBugRouter } = await import('./bug-routes.mjs');
const { SESSION_COOKIE, signCookieValue } = await import('./security.mjs');
hooks.deregister();

function report(owner, approval = 'pending', extra = {}) {
  return {
    displayId: 'TE-000001', description: 'Original report description',
    reporter: { discordId: owner, displayName: 'Reporter' },
    approval: { state: approval }, status: entry(approval === 'pending' ? 'pending-approval' : 'approved'),
    submissionState: 'submitted', createdAt: new Date(), ...extra,
  };
}

test('PEN Tester has QA bug permissions without approval, private-note or developer access', async t => {
  const app = express();
  app.use(express.json());
  app.use('/bugs', createBugRouter());
  app.use((error, _request, response, _next) => response.status(error.status ?? 500).json({ error: error.message }));
  const server = await new Promise((resolve, reject) => {
    const instance = app.listen(0, '127.0.0.1', error => error ? reject(error) : resolve(instance));
  });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const nativeFetch = globalThis.fetch;
  t.mock.method(globalThis, 'fetch', (url, options) => {
    assert.ok(String(url).startsWith(base + '/'), 'No external requests are allowed in permission fixtures');
    return nativeFetch(url, options);
  });
  function request(path, role, method = 'GET', body, withCsrf = true) {
    const id = role ? `session-${role}` : null;
    if (role) sessions.set(id, {
      role, csrfToken: 'test-token', roleCheckedAt: Date.now(),
      discordUser: { id: `user-${role}`, username: role, global_name: role, avatar: null },
      discordMember: { nick: null },
    });
    return fetch(base + '/bugs' + path, {
      method, headers: {
        ...(id ? { Cookie: `${SESSION_COOKIE}=${signCookieValue(id)}` } : {}),
        ...(withCsrf ? { 'X-CSRF-Token': 'test-token' } : {}),
        'Content-Type': 'application/json',
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  }

  assert.equal((await request('/storage-config')).status, 401);
  assert.equal((await request('/storage-config', 'member')).status, 403);

  for (const role of ['qa', 'pentester']) await t.test(`${role}: complete normal tester lifecycle and denied higher privileges`, async () => {
    memory.documents.clear();
    deletedObjects.length = 0;
    const own = `user-${role}`;
    for (const [id, value] of Object.entries({
      own: report(own), other: report('another-user'), approved: report(own, 'approved'),
      draft: report(own, 'pending', { submissionState: 'uploading', expectedAttachments: 1 }),
      'other-draft': report('another-user', 'pending', { submissionState: 'uploading', expectedAttachments: 1 }),
    })) memory.documents.set(`bugReports/${id}`, value);
    memory.documents.set('bugReports/own/developerNotes/secret', { body: 'Private developer note', createdAt: new Date() });
    assert.equal((await request('/storage-config', role)).status, 200);
    assert.equal((await request('/own', role, 'PATCH', { description: 'Allowed pending edit' }, false)).status, 403);
    assert.equal((await request('/own', role, 'PATCH', { description: 'Allowed pending edit' })).status, 200);
    assert.equal(memory.documents.get('bugReports/own').description, 'Allowed pending edit');
    for (const id of ['other', 'approved']) {
      assert.equal((await request(`/${id}`, role, 'PATCH', { description: 'Forbidden edit' })).status, 403);
      assert.equal(memory.documents.get(`bugReports/${id}`).description, 'Original report description');
    }
    assert.equal((await request('/own', role, 'PATCH', { statusId: 'approved' })).status, 403);
    assert.equal(memory.documents.get('bugReports/own').status.id, 'pending-approval');
    const view = await request('/own', role);
    assert.equal(view.status, 200);
    assert.deepEqual((await view.json()).developerNotes, []);
    assert.equal((await request('/draft', role)).status, 200);
    assert.equal((await request('/other-draft', role)).status, 404);

    const submitted = await request('/', role, 'POST', {
      description: 'A new tester bug report', versionId: 'v1', priorityId: 'medium',
      categoryId: 'general', typeId: 'bug', deviceId: 'pc',
    });
    assert.equal(submitted.status, 201);
    const created = (await submitted.json()).report;
    assert.equal(created.reporter.role, role);
    assert.equal(created.reporter.discordId, own);
    assert.equal(created.approval.state, 'pending');
    assert.equal((await request('/other/comments', role, 'POST', { body: 'Additional reproduction evidence' })).status, 201);

    const uploadResponse = await request('/own/attachments', role, 'POST', { fileName: 'proof.png' });
    assert.equal(uploadResponse.status, 201);
    const { attachmentId } = await uploadResponse.json();
    assert.equal((await request(`/own/attachments/${attachmentId}/complete`, role, 'POST')).status, 201);
    assert.equal(memory.documents.get(`bugReports/own/attachments/${attachmentId}`).status, 'ready');
    assert.equal((await request(`/own/attachments/${attachmentId}`, role, 'DELETE')).status, 204);
    assert.equal(memory.documents.has(`bugReports/own/attachments/${attachmentId}`), false);
    for (const id of ['other', 'approved']) {
      memory.documents.set(`bugReports/${id}/attachments/proof`, { status: 'ready', objectKey: `protected/${id}` });
      assert.equal((await request(`/${id}/attachments`, role, 'POST', { fileName: 'proof.png' })).status, 403);
      assert.equal((await request(`/${id}/attachments/proof/complete`, role, 'POST')).status, 403);
      assert.equal((await request(`/${id}/attachments/proof`, role, 'DELETE')).status, 403);
      assert.equal(memory.documents.has(`bugReports/${id}/attachments/proof`), true);
      assert.equal(deletedObjects.includes(`protected/${id}`), false);
    }
    memory.documents.set('bugReports/draft/attachments/proof', { status: 'ready', objectKey: 'draft/proof' });
    assert.equal((await request('/draft/finalize', role, 'POST')).status, 200);
    assert.equal(memory.documents.get('bugReports/draft').submissionState, 'submitted');
    assert.equal((await request('/other-draft/finalize', role, 'POST')).status, 403);
    assert.equal((await request('/other-draft/cancel-submission', role, 'DELETE')).status, 403);
    memory.documents.set('bugReports/cancel', report(own, 'pending', { submissionState: 'uploading' }));
    assert.equal((await request('/cancel/cancel-submission', role, 'DELETE')).status, 204);
    assert.equal(memory.documents.has('bugReports/cancel'), false);

    for (const [path, method, body] of [
      ['/own/approve', 'POST', {}], ['/own/reject', 'POST', { comment: 'Not a bug' }],
      ['/own/developer-notes', 'POST', { body: 'Forbidden private note' }],
      ['/own/duplicate', 'PUT', { targetId: 'other' }], ['/own', 'DELETE', null],
    ]) assert.equal((await request(path, role, method, body)).status, 403, `${role} must be denied ${method} ${path}`);
    assert.equal(memory.documents.get('bugReports/own').approval.state, 'pending');
    assert.equal(memory.documents.get('bugReports/own/developerNotes/secret').body, 'Private developer note');
  });
});
