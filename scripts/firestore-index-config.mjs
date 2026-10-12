import { parseArgs } from "node:util";

// firebase.indexes.json uses a shorthand for field overrides; the Admin REST API
// expects each single-field Index to contain an IndexField in `fields`.
export function fieldIndexConfig(definition) {
  return { indexes: definition.indexes.map(({ queryScope, order, arrayConfig }) => ({ queryScope,
    fields: [{ fieldPath: definition.fieldPath, ...(order ? { order } : { arrayConfig }) }],
  })) };
}
export function fieldIndexMatches(current, definition) {
  if (!current.indexConfig || current.indexConfig.usesAncestorConfig || current.indexConfig.reverting) return false;
  const normalize = indexes => indexes.map(index => {
    const field = index.fields?.find(item => item.fieldPath === definition.fieldPath) ?? index;
    return JSON.stringify([index.queryScope, field.order ?? null, field.arrayConfig ?? null]);
  }).sort();
  return JSON.stringify(normalize(current.indexConfig.indexes ?? [])) === JSON.stringify(normalize(definition.indexes));
}

export function compositeIndexMatches(current, definition) {
  if (current.queryScope !== definition.queryScope) return false;
  const fields = value => value.fields ?? [];
  const withoutName = value => fields(value).filter(field => field.fieldPath !== '__name__');
  const nameOrder = value => fields(value).find(field => field.fieldPath === '__name__')?.order ?? withoutName(value).at(-1)?.order ?? 'ASCENDING';
  const normalize = value => withoutName(value).map(field => [field.fieldPath, field.order ?? null, field.arrayConfig ?? null]);
  return nameOrder(current) === nameOrder(definition) && JSON.stringify(normalize(current)) === JSON.stringify(normalize(definition));
}

export function scopedIndexDefinitions(definitions, scope = 'all') {
  if (!['all', 'qa-careers', 'players'].includes(scope)) throw new Error('Invalid index scope.');
  const players = new Set(['tePlayerSummaries', 'tePlayerImportJobs', 'tePlayerImportFailures']);
  return {
    indexes: definitions.indexes.filter(index => scope === 'all' || (scope === 'players' ? players.has(index.collectionGroup)
      : index.collectionGroup === 'careerApplications' && index.fields[0]?.fieldPath === 'category')),
    fieldOverrides: scope === 'qa-careers' ? [] : definitions.fieldOverrides.filter(field => scope === 'all' || players.has(field.collectionGroup)),
  };
}

export function parseIndexSetupArguments(argv) {
  const { values, tokens } = parseArgs({ args: argv, strict: true, allowPositionals: false, tokens: true,
    options: Object.fromEntries(['apply', 'only-qa-careers', 'only-player-data', 'require-ready'].map(key => [key, { type: 'boolean' }])) });
  const flags = tokens.map(token => token.name);
  if (new Set(flags).size !== flags.length || (values['only-qa-careers'] && values['only-player-data'])) throw new Error('Choose one index setup scope without duplicate flags.');
  return { apply: values.apply === true, requireReady: values['require-ready'] === true,
    scope: values['only-player-data'] ? 'players' : values['only-qa-careers'] ? 'qa-careers' : 'all' };
}
