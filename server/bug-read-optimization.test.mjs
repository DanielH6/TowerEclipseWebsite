import test from 'node:test';
import assert from 'node:assert/strict';
import { createBugQueryService, createSnapshotCodec } from './bug-query.mjs';
import { createAdminWorkspaceService } from './admin-workspace.mjs';
import { createWorkflowMemoryDb } from './testing/workflow-memory-db.mjs';
const epoch = Date.parse('2026-11-07T00:00:00Z');
const row = (n, overrides = {}) => ({ displayId: `TE-${n}`, description: 'Testing historical freeze tower issue ' + 'x'.repeat(2000), createdAt: new Date(epoch - 60_000), updatedAt: new Date(epoch - 60_000), submissionState: 'submitted', status: { id: 'pending', code: 'pending_approval' }, priority: { id: 'high', code: 'high' }, reporter: { discordId: 'staff', displayName: 'Tester' }, ...overrides });
function setup(count = 1205, options = {}) {
  let clock = epoch;
  const fixture = createWorkflowMemoryDb(Object.fromEntries(Array.from({ length: count }, (_, n) => [`bugReports/r${String(n).padStart(5, '0')}`, row(n)])));
  const bugs = createBugQueryService({ db: fixture.db, snapshots: createSnapshotCodec('synthetic', () => clock), now: () => clock, artifact: false, ...options });
  return { ...fixture, bugs, now: () => clock, advance: ms => { clock += ms; } };
}
const reportQueries = calls => calls.filter(call => call.path === 'bugReports' && !call.aggregate && !call.lookup);
test('ordinary 50-row pages read 51 documents; exact totals are cached aggregates and cold fills are shared', async () => {
  const f = setup();
  const [first, concurrent] = await Promise.all([f.bugs.list(), f.bugs.list()]);
  assert.deepEqual(first, concurrent); assert.equal(first.pagination.total, 1205); assert.equal(first.reports.length, 50);
  assert.equal(reportQueries(f.calls).length, 1); assert.equal(reportQueries(f.calls)[0].documents, 51);
  assert.equal(f.calls.filter(call => call.aggregate).length, 2);
  const second = await f.bugs.list({ snapshot: first.snapshot, page: 2, cursor: first.nextCursor });
  assert.equal(second.reports.length, 50);
  assert.equal(reportQueries(f.calls).at(-1).documents, 51);
  assert.equal(new Set([...first.reports, ...second.reports].map(item => item.id)).size, 100);
  const reads = f.calls.length; await f.bugs.list({ snapshot: first.snapshot, page: 2 }); assert.equal(f.calls.length, reads);
  await assert.rejects(f.bugs.list({ snapshot: first.snapshot, page: 3, cursor: first.nextCursor }), { status: 400 });
});
test('structured filters resolve frozen dictionary codes to IDs and exclude unfinished uploads without excluding legacy reports', async () => {
  const f = setup(120);
  f.documents.set('dictionaries/statuses/items/pending', { code: 'pending_approval', label: 'Awaiting review' });
  f.documents.set('bugReports/draft', row(121, { submissionState: 'uploading' }));
  f.documents.set('bugReports/legacy', row(122, { submissionState: undefined }));
  const result = await f.bugs.list({ status: 'pending_approval' });
  assert.equal(result.pagination.total, 121); assert.equal(result.reports[0].status.label, 'Awaiting review');
  assert.ok(!result.reports.some(item => item.id === 'draft'));
  assert.equal(reportQueries(f.calls).length, 1);
});
test('zero submitted reports short-circuit after exact aggregates instead of scanning unfinished uploads', async () => {
  const f = setup(1205);
  for (const [path, value] of f.documents) if (path.startsWith('bugReports/')) f.documents.set(path, { ...value, submissionState: 'uploading' });
  const result = await f.bugs.list();
  assert.equal(result.pagination.total, 0); assert.deepEqual(result.reports, []);
  assert.equal(reportQueries(f.calls).length, 0);
});
test('large historical search corpus is cached above the old 2 MB cliff and reused across terms/related results', async () => {
  const f = setup();
  const [one, two] = await Promise.all([f.bugs.related({ search: 'freeze tower issue' }), f.bugs.related({ search: 'historical testing' })]);
  assert.equal(one.reports.length, 6); assert.equal(two.reports.length, 6);
  assert.equal(reportQueries(f.calls).length, 3);
  const reads = f.calls.length;
  await f.bugs.related({ search: 'testing freeze' });
  const search = await f.bugs.list({ search: 'freeze tower', page: 25 });
  assert.equal(search.pagination.total, 1205); assert.equal(search.reports.length, 5);
  assert.equal(f.calls.length, reads);
  assert.ok(f.bugs.cacheDiagnostics().bytes < 64 * 1024 * 1024);
});
test('snapshots share a freshness window, explicit refresh advances it, and raw corpus budgets fail without partial output', async () => {
  const f = setup(10);
  const first = await f.bugs.list(); f.advance(5000);
  assert.equal((await f.bugs.list()).snapshot, first.snapshot);
  assert.notEqual((await f.bugs.list({ fresh: '1' })).snapshot, first.snapshot);
  const bounded = setup(20, { rawBudget: 3000 });
  await assert.rejects(bounded.bugs.related({ search: 'freeze tower' }), { status: 413 });
});
test('completed exports reuse frozen raw child metadata but regenerate attachment access for each response', async () => {
  const f = setup(2);
  f.documents.set('bugReports/r00000/comments/c', { body: 'Original', createdAt: new Date(epoch - 60_000) });
  f.documents.set('bugReports/r00000/attachments/a', { status: 'ready', objectKey: 'private/key', createdAt: new Date(epoch - 60_000) });
  const first = await f.bugs.list(); let issued = 0;
  const serialize = doc => ({ id: doc.id, downloadUrl: `fresh-${++issued}` });
  const one = await f.bugs.exportData({ snapshot: first.snapshot }, serialize), reads = f.calls.length;
  const two = await f.bugs.exportData({ snapshot: first.snapshot }, serialize);
  assert.equal(f.calls.length, reads); assert.notEqual(one.reports[1]?.attachments[0]?.downloadUrl ?? one.reports[0].attachments[0]?.downloadUrl, two.reports[1]?.attachments[0]?.downloadUrl ?? two.reports[0].attachments[0]?.downloadUrl);
  assert.equal(JSON.stringify(two).includes('private/key'), false);
});
test('admin report census survives new snapshot windows and applies authoritative status/create/delete deltas without another full scan', async () => {
  const f = setup(1205), admin = createAdminWorkspaceService(f.db, f.bugs, { now: f.now });
  const first = await admin.overview(); assert.equal(first.counts.reports, 1205); assert.equal(first.counts.pending, 1205);
  const initial = reportQueries(f.calls).length;
  f.advance(61_000); await f.bugs.list();
  const before = reportQueries(f.calls).length;
  assert.equal((await admin.overview()).counts.reports, 1205);
  assert.equal(reportQueries(f.calls).length, before, 'Overview does not scan reports in each new freshness window');
  const original = row(0), changed = row(0, { status: { id: 'resolved', code: 'resolved', terminal: true } });
  f.bugs.notifyMutation(original, changed);
  const updated = await admin.overview(); assert.equal(updated.counts.pending, 1204); assert.equal(updated.counts.urgentOpen, 1204);
  f.bugs.notifyMutation(null, row(2000)); assert.equal((await admin.overview()).counts.reports, 1206);
  f.bugs.notifyMutation(row(2000), null); assert.equal((await admin.overview()).counts.reports, 1205);
  assert.equal(reportQueries(f.calls).length, before); assert.equal(initial, 3);
});
