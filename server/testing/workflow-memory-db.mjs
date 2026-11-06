// Isolated test double, never imported by production. Preserves per-readTime snapshots.
export function createWorkflowMemoryDb(seed = {}) {
  const documents = new Map(Object.entries(seed)); const frozen = new Map(); const calls = [];
  const clone = value => value === undefined ? undefined : structuredClone(value);
  const valueAt = (data, key) => key.split('.').reduce((value, part) => value?.[part], data);
  function storeAt(at) { if (at && !frozen.has(at)) frozen.set(at, new Map([...documents].map(([key, value]) => [key, clone(value)]))); return at ? frozen.get(at) : documents; }
  function doc(path) { return { path, id: path.split('/').at(-1), get: async (options = {}) => { calls.push({ path, lookup: true, at: options.readTime }); return snap(path, storeAt(options.readTime).get(path)); }, collection: name => collection(`${path}/${name}`), set: async value => documents.set(path, clone(value)) }; }
  function snap(path, value) { return { id: path.split('/').at(-1), ref: doc(path), exists: value !== undefined, data: () => clone(value) }; }
  function collection(path, filters = [], orders = [], maximum, cursor, at, group = false, selected = null) {
    const q = {
      where: (key, op, value) => collection(path, [...filters, [key, op, value]], orders, maximum, cursor, at, group, selected),
      orderBy: (key, dir = 'asc') => collection(path, filters, [...orders, [key, dir]], maximum, cursor, at, group, selected),
      limit: max => collection(path, filters, orders, max, cursor, at, group, selected),
      startAfter: (...values) => collection(path, filters, orders, maximum, values, at, group, selected),
      atReadTime: time => collection(path, filters, orders, maximum, cursor, time, group, selected),
      select: (...fields) => collection(path, filters, orders, maximum, cursor, at, group, fields),
      doc: id => doc(`${path}/${id ?? crypto.randomUUID()}`),
      count: async () => (await q.get({ aggregate: true })).docs.length,
      get: async ({ aggregate = false } = {}) => {
        const call = { path, at, maximum, cursor, aggregate, selected }; calls.push(call);
        const store = storeAt(at);
        const val = (entry, key) => key === '__name__' ? entry[0] : valueAt(entry[1], key);
        const comparable = value => value?.toDate ? value.toDate().getTime() : value instanceof Date ? value.getTime() : value;
        const compare = (entry, values) => { for (let i = 0; i < orders.length; i++) { const a = comparable(val(entry, orders[i][0])), b = comparable(values[i]); if (a !== b) return (a < b ? -1 : 1) * (orders[i][1] === 'desc' ? -1 : 1); } return 0; };
        let rows = [...store].filter(([key, data]) => (group ? key.split('/').at(-2) === path : key.split('/').slice(0, -1).join('/') === path) && filters.every(([field, op, expected]) => {
          const actual = valueAt(data, field); if (op === 'array-contains') return actual?.includes(expected); if (op === 'in') return expected.includes(actual);
          const a = comparable(actual), b = comparable(expected);
          return op === '==' ? a === b : op === '>=' ? a >= b : op === '<=' ? a <= b : op === '>' ? a > b : a < b;
        }));
        rows.sort((a, b) => compare(a, orders.map(([field]) => val(b, field))));
        if (cursor) rows = rows.filter(row => compare(row, cursor) > 0);
        if (maximum) rows = rows.slice(0, maximum);
        call.documents = rows.length;
        return { docs: rows.map(([key, value]) => {
          if (!selected || aggregate) return snap(key, value);
          const projected = {};
          for (const field of selected) {
            const item = valueAt(value, field); if (item === undefined) continue;
            const parts = field.split('.'); let target = projected;
            for (const part of parts.slice(0, -1)) target = target[part] ??= {};
            target[parts.at(-1)] = item;
          }
          return snap(key, projected);
        }) };
      },
    }; return q;
  }
  let queue = Promise.resolve();
  const db = { doc, collection, collectionGroup: name => collection(name, [], [], undefined, undefined, undefined, true), runTransaction(callback) {
    const work = queue.then(async () => {
      const writes = []; const result = await callback({ get: ref => ref.get(), update: (ref, value) => writes.push(() => documents.set(ref.path, { ...documents.get(ref.path), ...clone(value) })), set: (ref, value, options) => writes.push(() => documents.set(ref.path, options?.merge ? { ...documents.get(ref.path), ...clone(value) } : clone(value))) });
      writes.forEach(write => write()); return result;
    }); queue = work.catch(() => {}); return work;
  } };
  return { db, documents, calls };
}
