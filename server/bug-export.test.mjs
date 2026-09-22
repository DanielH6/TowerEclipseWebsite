import test from 'node:test';
import assert from 'node:assert/strict';
import { filterBugReports } from './bug-export.mjs';

test('export filters combine search, OR within each field, AND across fields, and omit drafts', () => {
  const one = { id: 'a', displayId: 'TE-001', description: 'Freeze tower', reporter: { username: 'tester' }, status: { code: 'approved' }, version: { code: 'v1' }, priority: { code: 'high' }, category: { code: 'tower' }, type: { code: 'bug' }, device: { code: 'pc' } };
  const two = { ...one, id: 'b', status: { code: 'resolved' } };
  const draft = { ...one, id: 'c', submissionState: 'uploading' };
  const all = [one, two, draft];
  assert.deepEqual(filterBugReports(all, { search: ' FREEZE ', status: ['approved', 'pending'], version: 'v1', priority: 'high', category: 'tower', type: 'bug', device: 'pc' }), [one]);
  assert.deepEqual(filterBugReports(all, { search: 'TESTER', status: ['approved', 'resolved'] }), [one, two]);
  assert.deepEqual(filterBugReports(all, { search: 'TE-001', device: 'mobile' }), []);
  assert.deepEqual(filterBugReports(all, {}), [one, two]);
});

test('export filter selection includes all matching pages and preserves text', () => {
  const reports = Array.from({ length: 123 }, (_, i) => ({ id: String(i), description: 'Unicode ✓\n"Quoted" text', status: { code: 'approved' } }));
  const selected = filterBugReports(reports, { status: 'approved', page: '2' });
  assert.equal(selected.length, 123);
  assert.deepEqual(JSON.parse(JSON.stringify(selected, null, 2)), reports);
});
