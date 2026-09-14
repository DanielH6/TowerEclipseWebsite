import test from 'node:test';
import assert from 'node:assert/strict';
import { fieldIndexConfig, fieldIndexMatches } from '../scripts/firestore-index-config.mjs';
test('field index overrides are encoded in Admin REST format and compare against its response', () => {
  const definition = { fieldPath: 'createdAt', indexes: [{ order: 'DESCENDING', queryScope: 'COLLECTION' }] };
  const expected = { indexes: [{ queryScope: 'COLLECTION', fields: [{ fieldPath: 'createdAt', order: 'DESCENDING' }] }] };
  assert.deepEqual(fieldIndexConfig(definition), expected);
  assert.equal(fieldIndexMatches({ indexConfig: { ...expected, usesAncestorConfig: false } }, definition), true);
  assert.equal(fieldIndexMatches({ indexConfig: { ...expected, usesAncestorConfig: true } }, definition), false);
  assert.equal(fieldIndexMatches({ indexConfig: { indexes: [] } }, definition), false);
  assert.equal(fieldIndexMatches({ indexConfig: {} }, { fieldPath: '*', indexes: [] }), true);
});
