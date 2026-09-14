// Test/preview storage only. Production always uses the existing Firestore adapter.
export function createMemoryDb(initial = {}) {
  const documents = new Map(Object.entries(initial));
  const queries = [];
  let writes = 0, queue = Promise.resolve();
  const snapshot = path => ({ id: path.split("/").at(-1), ref: { path }, exists: documents.has(path), data: () => structuredClone(documents.get(path)) });
  const doc = path => ({ path, id: path.split("/").at(-1), get: async () => snapshot(path), set: async data => { documents.set(path, structuredClone(data)); writes++; } });
  const field = (data, name) => name.split(".").reduce((value, key) => value?.[key], data);
  function query(collection, filters = [], order = [], maximum = null, fields = null, cursor = null) {
    return {
      where: (name, op, value) => query(collection, [...filters, [name, op, value]], order, maximum, fields, cursor),
      orderBy: (name, direction) => query(collection, filters, [...order, [name, direction]], maximum, fields, cursor),
      limit: limit => query(collection, filters, order, limit, fields, cursor),
      select: (...select) => query(collection, filters, order, maximum, select, cursor),
      startAfter: (...values) => query(collection, filters, order, maximum, fields, values),
      get: async () => {
        queries.push({ collection, filters, order, maximum, fields, cursor });
        const value = (entry, name) => name === "__name__" ? entry[0] : field(entry[1], name);
        const compare = (entry, values) => {
          for (let i = 0; i < order.length; i++) {
            const [name, direction] = order[i];
            const a = value(entry, name), b = values[i];
            if (a !== b) return (a < b ? -1 : 1) * (direction === "desc" ? -1 : 1);
          }
          return 0;
        };
        let entries = [...documents].filter(([path, data]) => path.startsWith(`${collection}/`) && path.split("/").length === collection.split("/").length + 1 && filters.every(([name, op, expected]) => {
          const actual = field(data, name);
          return op === "==" ? actual === expected : op === ">" ? actual > expected : op === ">=" ? actual >= expected : op === "<" ? actual < expected : actual <= expected;
        }));
        entries.sort((a, b) => compare(a, order.map(([name]) => value(b, name))));
        if (cursor) entries = entries.filter(entry => compare(entry, cursor) > 0);
        if (maximum) entries = entries.slice(0, maximum);
        return { docs: entries.map(([path, data]) => ({ ...snapshot(path), data: () => structuredClone(fields ? Object.fromEntries(fields.filter(key => data[key] !== undefined).map(key => [key, data[key]])) : data) })) };
      },
    };
  }
  const db = {
    doc, collection: path => query(path),
    runTransaction: callback => {
      const run = queue.then(async () => {
        const pending = [];
        const result = await callback({
          get: async reference => { if (pending.length) throw new Error("Read after write in transaction"); return snapshot(reference.path); },
          set: (reference, data) => pending.push(() => documents.set(reference.path, structuredClone(data))),
          update: (reference, data) => pending.push(() => documents.set(reference.path, { ...documents.get(reference.path), ...structuredClone(data) })),
          delete: reference => pending.push(() => documents.delete(reference.path)),
        });
        pending.forEach(write => { write(); writes++; });
        return result;
      });
      queue = run.catch(() => {});
      return run;
    },
  };
  return { db, documents, queries, writes: () => writes };
}
