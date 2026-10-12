import test from 'node:test';
import assert from 'node:assert/strict';
import { fieldIndexConfig, fieldIndexMatches, compositeIndexMatches, scopedIndexDefinitions, parseIndexSetupArguments } from '../scripts/firestore-index-config.mjs';
test('field index overrides are encoded in Admin REST format and compare against its response', () => {
  const definition = { fieldPath: 'createdAt', indexes: [{ order: 'DESCENDING', queryScope: 'COLLECTION' }] };
  const expected = { indexes: [{ queryScope: 'COLLECTION', fields: [{ fieldPath: 'createdAt', order: 'DESCENDING' }] }] };
  assert.deepEqual(fieldIndexConfig(definition), expected);
  assert.equal(fieldIndexMatches({ indexConfig: { ...expected, usesAncestorConfig: false } }, definition), true);
  assert.equal(fieldIndexMatches({ indexConfig: { ...expected, usesAncestorConfig: true } }, definition), false);
  assert.equal(fieldIndexMatches({ indexConfig: { indexes: [] } }, definition), false);
  assert.equal(fieldIndexMatches({ indexConfig: {} }, { fieldPath: '*', indexes: [] }), true);
});
test('composite setup recognizes implicit and explicit document-name order without requesting duplicate indexes', () => {
  const base = { queryScope: 'COLLECTION', fields: [{ fieldPath: 'mode', order: 'ASCENDING' }, { fieldPath: 'stats.level', order: 'DESCENDING' }] };
  const explicit = { ...base, fields: [...base.fields, { fieldPath: '__name__', order: 'DESCENDING' }] };
  assert.equal(compositeIndexMatches(explicit, base), true); assert.equal(compositeIndexMatches(base, explicit), true);
  assert.equal(compositeIndexMatches(explicit, explicit), true);
  assert.equal(compositeIndexMatches({ ...explicit, fields: [...base.fields, { fieldPath: '__name__', order: 'ASCENDING' }] }, explicit), false);
  assert.equal(compositeIndexMatches({ ...explicit, queryScope: 'COLLECTION_GROUP' }, explicit), false);
  assert.equal(compositeIndexMatches({ ...base, fields: [{ fieldPath: 'different', order: 'DESCENDING' }] }, base), false);
});
test('player-only index scope preserves unrelated composites and field overrides', () => {
  const values = { indexes: [{ collectionGroup: 'tePlayerSummaries' }, { collectionGroup: 'bugReports' }],
    fieldOverrides: [{ collectionGroup: 'tePlayerImportJobs' }, { collectionGroup: 'tePlayerImportFailures' }, { collectionGroup: 'websiteAccounts' }] };
  const before = structuredClone(values), selected = scopedIndexDefinitions(values, 'players');
  assert.deepEqual(selected.indexes, [values.indexes[0]]); assert.deepEqual(selected.fieldOverrides, values.fieldOverrides.slice(0, 2));
  assert.deepEqual(values, before); assert.throws(() => scopedIndexDefinitions(values, 'foreign'));
});

test('index setup rejects mistyped, mixed and duplicate scopes before credentials or transport are loaded', () => {
  assert.deepEqual(parseIndexSetupArguments(['--only-player-data']), { apply: false, requireReady: false, scope: 'players' });
  assert.deepEqual(parseIndexSetupArguments(['--only-player-data', '--apply', '--require-ready']), { apply: true, requireReady: true, scope: 'players' });
  assert.equal(parseIndexSetupArguments([]).scope, 'all');
  for (const flags of [['--only-player-dat', '--apply'], ['--only-player-data', '--only-qa-careers'], ['--apply', '--apply'], ['players']]) {
    assert.throws(() => parseIndexSetupArguments(flags));
  }
});
