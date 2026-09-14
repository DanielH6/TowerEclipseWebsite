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
