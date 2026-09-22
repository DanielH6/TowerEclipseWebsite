import test from 'node:test';
import assert from 'node:assert/strict';
import { createBugQueryService, createSnapshotCodec, SNAPSHOT_TTL_MS } from './bug-query.mjs';
import { createDuplicateService, normalizeReportLinks, reportExtras } from './bug-workflow.mjs';
import { createWorkspaceService, normalizeQueues } from './workspace-service.mjs';
import { createWorkflowMemoryDb } from './testing/workflow-memory-db.mjs';
const now = Date.parse('2026-09-23T12:00:00Z');
const report = (i, extra = {}) => ({ displayId: `TE-${String(i).padStart(6, '0')}`, description: 'Freeze tower stops firing', createdAt: new Date(now - i * 1000), status: { id: 'approved', code: 'approved', label: 'Approved' }, reporter: { discordId: '123456', displayName: 'Tester' }, ...extra });
test('complete pagination finds old matches beyond 1000 and retains tied timestamps without duplicates', async () => {
  const records = Object.fromEntries(Array.from({ length: 1205 }, (_, i) => [`bugReports/r${i}`, report(i, { createdAt: new Date(now - 1000), description: i === 1204 ? 'Old unique issue' : 'Current issue' })]));
  const fixture = createWorkflowMemoryDb(records); const service = createBugQueryService({ db: fixture.db, snapshots: createSnapshotCodec('test-secret', () => now), batchSize: 200 });
  const old = await service.list({ search: 'old unique' }); assert.equal(old.pagination.total, 1); assert.equal(old.reports[0].id, 'r1204');
  const ids = new Set(); for (let page = 1; page <= 25; page++) { const result = await service.list({ page, snapshot: old.snapshot }); for (const item of result.reports) { assert.ok(!ids.has(item.id)); ids.add(item.id); } }
  assert.equal(ids.size, 1205); assert.ok(fixture.calls.filter(call => call.path === 'bugReports').every(call => call.maximum === 200));
});
test('snapshot freezes report data across edits, new submissions and deletions and rejects tampering/expiry', async () => {
  let clock = now; const fixture = createWorkflowMemoryDb({ 'bugReports/old': report(10) });
  const codec = createSnapshotCodec('test-secret', () => clock); const service = createBugQueryService({ db: fixture.db, snapshots: codec });
  const first = await service.list({}); fixture.documents.delete('bugReports/old'); fixture.documents.set('bugReports/new', report(0));
  assert.deepEqual((await service.list({ snapshot: first.snapshot })).reports, first.reports);
  clock += 2000; assert.equal((await service.list({})).reports[0].id, 'new');
  assert.throws(() => codec.read(first.snapshot + 'tamper'), /expired or is invalid/);
  clock += SNAPSHOT_TTL_MS; assert.throws(() => codec.read(first.snapshot), /expired/);
});
test('related suggestions include historical matches and hide unfinished drafts', async () => {
  const fixture = createWorkflowMemoryDb({ 'bugReports/a': report(1), 'bugReports/draft': report(2, { submissionState: 'uploading' }), 'bugReports/b': report(3, { description: 'An unrelated loadout screen' }) });
  const service = createBugQueryService({ db: fixture.db, snapshots: createSnapshotCodec('secret', () => now) });
  assert.deepEqual((await service.related({ search: 'Freeze tower firing' })).reports.map(item => item.id), ['a']);
});
test('Pastebin links and optional frequency are validated without accepting lookalike hosts or schemes', () => {
  assert.deepEqual(reportExtras({}), { frequency: null, serverConsoleUrl: null });
  assert.equal(reportExtras({ serverConsoleUrl: 'https://pastebin.com/Ab123', frequency: 'high' }).frequency, 'high');
  for (const serverConsoleUrl of ['javascript:alert(1)', 'https://pastebin.com.evil.test/abc', 'https://evil.test/pastebin.com/a', 'https://pastebin.com/user/name']) assert.throws(() => reportExtras({ serverConsoleUrl }));
  assert.throws(() => reportExtras({ frequency: 'critical' }));
  assert.deepEqual(reportExtras({}, true), {});
});
test('duplicates retain credit, prevent chains/cycles and correctly move or remove links', async () => {
  const { db, documents } = createWorkflowMemoryDb({ 'bugReports/a': report(1), 'bugReports/b': report(2), 'bugReports/c': report(3) });
  const link = createDuplicateService(db); const actor = { role: 'leadqa', discordId: 'lead' };
  await link('a', 'b', actor); assert.equal(documents.get('bugReports/a').reporter.displayName, 'Tester'); assert.equal(documents.get('bugReports/b').duplicateCount, 1);
  await assert.rejects(link('b', 'a', actor)); await assert.rejects(link('c', 'a', actor)); await assert.rejects(link('b', 'c', actor)); await assert.rejects(link('a', 'a', actor));
  await assert.rejects(link('a', null, { role: 'qa' }));
  await link('a', 'c', actor); assert.equal(documents.get('bugReports/b').duplicateCount, 0); assert.equal(documents.get('bugReports/c').duplicateCount, 1);
  await link('a', null, actor); assert.equal(documents.get('bugReports/c').duplicateCount, 0);
});
test('release links validate IDs and keep public wording independent of original descriptions', () => {
  assert.deepEqual(normalizeReportLinks([{ id: 'a', summary: ' Fixed freeze effect. ' }]), [{ id: 'a', summary: 'Fixed freeze effect.' }]);
  assert.throws(() => normalizeReportLinks([{ id: '../a', summary: 'Fix' }])); assert.throws(() => normalizeReportLinks([{ id: 'a', summary: '' }]));
  assert.throws(() => normalizeReportLinks([{ id: 'a', summary: 'Fix' }, { id: 'a', summary: 'Again' }]));
});
test('saved queues and onboarding are account-scoped, bounded and progress can be undone', async () => {
  const { db, documents } = createWorkflowMemoryDb({ 'websiteAccounts/a': { displayName: 'A' }, 'websiteAccounts/b': { displayName: 'B' } });
  const service = createWorkspaceService(db); const data = await service.onboarding('a');
  await service.progress('a', { stepId: data.steps[0].id, complete: true, version: data.version });
  assert.equal(Object.keys((await service.onboarding('a')).completed).length, 1); assert.equal(Object.keys((await service.onboarding('b')).completed).length, 0);
  await service.progress('a', { stepId: data.steps[0].id, complete: false, version: data.version }); assert.deepEqual((await service.onboarding('a')).completed, {});
  await assert.rejects(service.progress('a', { stepId: 'forged', complete: true, version: data.version }));
  await service.saveQueues('a', { queues: [{ id: 'q', name: 'Queue', filters: { status: ['needs_info'], snapshot: 'do-not-save', reporterId: 'b' } }] });
  assert.deepEqual((await service.queues('b')).queues, []); assert.deepEqual(documents.get('websiteAccounts/a').savedQueues[0].filters, { status: ['needs_info'] });
  assert.throws(() => normalizeQueues(Array(21).fill({})));
});

test('export pins comments and attachments to the list snapshot, omits private notes and pending files', async () => {
  const { db, documents } = createWorkflowMemoryDb({
    'bugReports/a': report(1),
    'bugReports/a/comments/c': { body: 'Before', createdAt: new Date(now - 2000) },
    'bugReports/a/developerNotes/private': { body: 'Private note' },
    'bugReports/a/attachments/ready': { status: 'ready', objectKey: 'private/key', originalName: 'evidence.png', createdAt: new Date(now - 2000) },
    'bugReports/a/attachments/pending': { status: 'pending', objectKey: 'private/pending', createdAt: new Date(now - 2000) },
  });
  const service = createBugQueryService({ db, snapshots: createSnapshotCodec('secret', () => now) });
  const list = await service.list({});
  documents.get('bugReports/a/comments/c').body = 'After'; documents.delete('bugReports/a/attachments/ready');
  const exported = await service.exportData({ snapshot: list.snapshot });
  assert.equal(exported.refreshedAt, list.refreshedAt); assert.equal(exported.total, 1);
  assert.equal(exported.reports[0].comments[0].body, 'Before');
  assert.equal(exported.reports[0].attachments.length, 1); assert.equal(exported.reports[0].attachments[0].objectKey, undefined);
  assert.equal(exported.reports[0].developerNotes, undefined);
});
