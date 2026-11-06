import { createHmac, createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { deflateSync, inflateSync } from 'node:zlib';
import { filterBugReports } from './bug-export.mjs';
import { serializeAccountValue } from './account-service.mjs';
import { Timestamp } from './firestore-timestamp.mjs';
import { createReadCache } from './read-cache.mjs';
import { readLocalJsonCache, writeLocalJsonCache } from './local-cache.mjs';

export const SNAPSHOT_TTL_MS = 45 * 60_000;
const PAGE_SIZE = 50;
const fields = { status: 'statuses', priority: 'priorities', category: 'categories', type: 'types', device: 'devices', version: 'versions' };
const SUMMARY = ['displayId', 'description', 'status', 'version', 'priority', 'category', 'type', 'device', 'reporter', 'submissionState', 'createdAt', 'updatedAt', 'submittedAt', 'commentsCount', 'attachmentsCount', 'developerNotesCount', 'duplicateOf'];
const EXPORT_FIELDS = [...SUMMARY, 'frequency', 'serverConsoleUrl', 'approval', 'expectedAttachments'];
const fail = message => { throw Object.assign(new Error(message), { status: 400 }); };
// Private, compressed byte-budgeted LRU. A cache miss never imposes a result cap.
// Pending callers share one fill; failed fills are discarded. Only raw metadata,
// never signed download URLs or authorizations, is retained here.
export function createBugReadCache({ maxBytes = 64 * 1024 * 1024, maxEntries = 600, now = Date.now } = {}) {
  const cache = createReadCache({ name: 'bug-snapshots', maxBytes, maxEntries, now, ttlMs: SNAPSHOT_TTL_MS, maxPending: 100 });
  return {
    async get(key, loader, ttl = SNAPSHOT_TTL_MS) {
      const compressed = await cache.get(key, async () => deflateSync(Buffer.from(JSON.stringify(await loader()))).toString('base64'), { ttlMs: ttl });
      return JSON.parse(inflateSync(Buffer.from(compressed, 'base64'), { maxOutputLength: 64 * 1024 * 1024 }).toString());
    },
    clear: cache.clear,
    diagnostics: cache.stats,
  };
}
export function createSnapshotCodec(secret, now = () => Date.now()) {
  const sign = payload => createHmac('sha256', secret).update(payload).digest('base64url');
  const encode = value => { const payload = Buffer.from(JSON.stringify(value)).toString('base64url'); return `${payload}.${sign(payload)}`; };
  const decode = token => {
    if (typeof token !== 'string' || token.length > 1500) throw Error();
    const [payload, signature, extra] = token.split('.'), expected = Buffer.from(sign(payload)), actual = Buffer.from(signature ?? '');
    if (extra || actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw Error();
    return JSON.parse(Buffer.from(payload, 'base64url').toString());
  };
  return {
    create() { const at = new Date(now() - 1000).toISOString(); return { at, token: encode({ at }) }; },
    cursor: encode,
    readCursor(token) { try { return decode(token); } catch { fail('Invalid report page cursor. Return to the first page.'); } },
    read(token) {
      try {
        const { at } = decode(token);
        if (typeof at !== 'string' || !Number.isFinite(Date.parse(at)) || Date.parse(at) > now() || now() - Date.parse(at) > SNAPSHOT_TTL_MS) throw Error();
        return { at, token };
      } catch { throw Object.assign(new Error('This report snapshot has expired or is invalid. Refresh the list and try again.'), { status: 409 }); }
    },
  };
}
function normalize(query) {
  const search = typeof query.search === 'string' ? query.search.trim().toLowerCase() : '';
  if (search.length > 1500) fail('Search must be at most 1500 characters.');
  return { search, ...Object.fromEntries(Object.keys(fields).map(field => {
    const values = query[field] === undefined ? [] : Array.isArray(query[field]) ? query[field] : [query[field]];
    if (values.length > 100 || values.some(value => typeof value !== 'string' || value.length > 150)) fail('Invalid report filters.');
    return [field, [...new Set(values.map(value => value.trim()).filter(Boolean))].sort()];
  })) };
}
export function createBugQueryService({ db, snapshots, batchSize = 500, now = Date.now, cache = createBugReadCache({ now }), rawBudget = 64 * 1024 * 1024, maxCorpusFills = 2, artifact = true }) {
  let latest, corpusFills = 0, exportFills = 0;
  const listeners = new Set();
  const artifactName = artifact && process.env.FIREBASE_PROJECT_ID ? `bug-generation-${createHash('sha256').update(process.env.FIREBASE_PROJECT_ID).digest('hex').slice(0, 12)}` : null;
  let generation = { id: 'startup', at: 0 };
  const mutationGeneration = () => {
    const stored = artifactName ? readLocalJsonCache(artifactName) : null;
    return stored && stored.at >= generation.at ? stored : generation;
  };
  const subscribeMutation = listener => { listeners.add(listener); return () => listeners.delete(listener); };
  function notifyMutation(before, after) {
    generation = { id: randomUUID(), at: now() };
    if (artifactName) writeLocalJsonCache(artifactName, generation);
    for (const listener of listeners) listener({ before, after, at: now(), generation: generation.id });
  }
  const snapshot = (query = {}) => {
    if (query.snapshot) return snapshots.read(query.snapshot);
    if (!latest || latest.expires <= now() || query.fresh === '1') latest = { ...snapshots.create(), expires: now() + 45_000 };
    return { at: latest.at, token: latest.token };
  };
  const invalidate = () => { latest = null; };
  const catalog = at => cache.get(`dictionary:${at}`, async () => Object.fromEntries(await Promise.all(Object.entries(fields).map(async ([field, name]) => {
    const result = await db.collection(`dictionaries/${name}/items`).atReadTime(at).get();
    return [field, result.docs.map(doc => ({ id: doc.id, ...serializeAccountValue(doc.data()) }))];
  }))));
  function hydrate(data, dictionary) {
    const report = { ...data };
    for (const field of Object.keys(fields)) {
      const value = dictionary[field].find(entry => entry.id === data[field]?.id);
      if (value) report[field] = { id: value.id, code: value.code, label: value.label, color: value.color ?? null, ...(value.terminal !== undefined ? { terminal: value.terminal } : {}) };
    }
    return report;
  }
  const ordered = (at, query = db.collection('bugReports')) => query.orderBy('createdAt', 'desc').orderBy('__name__', 'desc').atReadTime(at);
  async function corpus(at) {
    return cache.get(`corpus:${at}`, async () => {
      if (corpusFills >= maxCorpusFills) throw Object.assign(new Error('Report search snapshots are busy. Please try again shortly.'), { status: 503 });
      corpusFills++;
      try {
      const dictionary = await catalog(at), items = []; let cursor, rawBytes = 0;
      while (true) {
        let query = ordered(at).select(...SUMMARY).limit(batchSize);
        if (cursor) query = query.startAfter(...cursor);
        const result = await query.get();
        for (const doc of result.docs) {
          const item = hydrate({ ...serializeAccountValue(doc.data()), id: doc.id }, dictionary);
          rawBytes += Buffer.byteLength(JSON.stringify(item));
          if (rawBytes > rawBudget) throw Object.assign(new Error('This complete report search exceeds the server snapshot memory budget. Use a narrower structured filter; no partial results were returned.'), { status: 413 });
          items.push(item);
        }
        if (result.docs.length < batchSize) return items;
        const last = result.docs.at(-1); cursor = [last.data().createdAt, last.ref.path];
      }
      } finally { corpusFills--; }
    });
  }
  async function* scan(at) { yield* await corpus(at); }
  async function plan(at, filters) {
    if (filters.search) return null;
    const selected = Object.entries(fields).filter(([field]) => filters[field].length);
    // One structured dimension has a small, known index family. Arbitrary
    // combinations retain exact semantics through the shared complete corpus.
    if (selected.length > 1) return null;
    let query = db.collection('bugReports');
    if (selected.length) {
      const [field] = selected[0], dictionary = await catalog(at);
      const ids = dictionary[field].filter(entry => filters[field].includes(entry.code)).map(entry => entry.id);
      if (!ids.length || ids.length > 30) return null;
      query = query.where(`${field}.id`, ids.length === 1 ? '==' : 'in', ids.length === 1 ? ids[0] : ids);
    }
    return query;
  }
  const scopeOf = filters => createHash('sha256').update(JSON.stringify(filters)).digest('hex').slice(0, 24);
  async function indexedPage(point, filters, requestedPage, cursorToken, base) {
    const scope = scopeOf(filters), prefix = `page:${point.at}:${scope}:`;
    let after;
    if (cursorToken) {
      const cursor = snapshots.readCursor(cursorToken);
      if (cursor.at !== point.at || cursor.scope !== scope || cursor.page !== requestedPage || typeof cursor.value !== 'string' || !Number.isFinite(Date.parse(cursor.value)) || !/^[\w-]+$/.test(cursor.id)) fail('The page cursor does not match these report filters.');
      after = [new Timestamp(cursor.value), `bugReports/${cursor.id}`];
    }
    const total = await cache.get(`total:${point.at}:${scope}`, async () => {
      const [all, drafts] = await Promise.all([ordered(point.at, base).count(), ordered(point.at, base.where('submissionState', '==', 'uploading')).count()]);
      return Math.max(0, all - drafts);
    });
    if (total === 0 || requestedPage > Math.max(1, Math.ceil(total / PAGE_SIZE))) return { reports: [], nextCursor: null, total };
    // Numbered page jumps walk cached cursor anchors; normal next/previous
    // navigation reads only its 51-row lookahead and never uses an offset.
    async function loadPage(page, suppliedAfter) {
      return cache.get(`${prefix}${page}`, async () => {
        let start = suppliedAfter;
        const reports = [], dictionary = await catalog(point.at); let position = start;
        while (reports.length < PAGE_SIZE + 1) {
          const remaining = PAGE_SIZE + 1 - reports.length;
          let query = ordered(point.at, base).select(...SUMMARY).limit(remaining);
          if (position) query = query.startAfter(...position);
          const result = await query.get();
          for (const doc of result.docs) if (doc.data().submissionState !== 'uploading') reports.push(hydrate({ ...serializeAccountValue(doc.data()), id: doc.id }, dictionary));
          if (result.docs.length < remaining) break;
          const last = result.docs.at(-1); position = [last.data().createdAt, last.ref.path];
        }
        const shown = reports.slice(0, PAGE_SIZE), last = shown.at(-1);
        return { reports: shown, nextCursor: reports.length > PAGE_SIZE ? snapshots.cursor({ at: point.at, scope, page: page + 1, value: last.createdAt, id: last.id }) : null };
      });
    }
    if (!after && requestedPage > 1) {
      let position;
      for (let previousPage = 1; previousPage < requestedPage; previousPage++) {
        const previous = await loadPage(previousPage, position);
        if (!previous.nextCursor) return { reports: [], nextCursor: null, total };
        const cursor = snapshots.readCursor(previous.nextCursor); position = [new Timestamp(cursor.value), `bugReports/${cursor.id}`];
      }
      after = position;
    }
    return { ...await loadPage(requestedPage, after), total };
  }
  async function list(query = {}) {
    const point = snapshot(query), filters = normalize(query), page = Number(query.page ?? 1);
    if (!Number.isSafeInteger(page) || page < 1 || page > 100000) fail('Invalid report page.');
    let result;
    const base = await plan(point.at, filters);
    try { if (base) result = await indexedPage(point, filters, page, query.cursor, base); }
    catch (error) { if (error.code !== 'FAILED_PRECONDITION') throw error; }
    if (!result) {
      const items = filterBugReports(await corpus(point.at), filters);
      result = { reports: items.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), total: items.length, nextCursor: null };
    }
    return { reports: result.reports, nextCursor: result.nextCursor, snapshot: point.token, refreshedAt: point.at, expiresAt: new Date(Date.parse(point.at) + SNAPSHOT_TTL_MS).toISOString(), pagination: { page, pageSize: PAGE_SIZE, total: result.total, totalPages: Math.max(1, Math.ceil(result.total / PAGE_SIZE)) } };
  }
  async function related(query = {}) {
    const words = [...new Set(String(query.search ?? '').slice(0, 1500).toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [])].filter(word => !new Set(['the','and','when','with','that','this','does','not','bug','report','have','was','are']).has(word)).slice(0, 30);
    if (!words.length) return { reports: [] };
    const point = snapshot(query), key = JSON.stringify([words, query.categoryId ?? '', query.exclude ?? '']);
    return cache.get(`related:${point.at}:${key}`, async () => {
      const results = [];
      for (const report of await corpus(point.at)) {
        if (report.submissionState === 'uploading' || report.id === query.exclude) continue;
        const text = `${report.displayId} ${report.description}`.toLowerCase(), matches = words.filter(word => text.includes(word));
        if (matches.length < Math.min(2, words.length)) continue;
        const score = matches.length / words.length + (report.category?.id === query.categoryId ? .15 : 0);
        results.push({ id: report.id, displayId: report.displayId, description: report.description.slice(0, 300), status: report.status, reporter: report.reporter, duplicateOf: report.duplicateOf ?? null, score });
        results.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)); results.splice(6);
      }
      return { reports: results, refreshedAt: point.at };
    });
  }
  async function exportData(query = {}, attachmentSerializer = doc => {
    const { objectKey: _privateKey, ...value } = serializeAccountValue(doc.data()); return { ...value, id: doc.id };
  }) {
    const point = snapshot(query), filters = normalize(query);
    const raw = await cache.get(`export:${point.at}:${scopeOf(filters)}`, async () => {
      if (exportFills >= 1) throw Object.assign(new Error('Another complete export is being prepared. Please try again shortly.'), { status: 503 });
      exportFills++;
      try {
      const reports = []; const budget = { bytes: 0 };
      async function children(reference, name) {
        const items = []; let cursor;
        while (true) {
          let query = reference.collection(name).orderBy('createdAt', 'asc').orderBy('__name__', 'asc').atReadTime(point.at).limit(200);
          if (name === 'attachments') query = query.where('status', '==', 'ready');
          if (cursor) query = query.startAfter(...cursor);
          const result = await query.get();
          for (const doc of result.docs) {
            const value = { ...serializeAccountValue(doc.data()), id: doc.id };
            budget.bytes += Buffer.byteLength(JSON.stringify(value));
            if (budget.bytes > rawBudget) throw Object.assign(new Error('The complete export exceeds the server memory budget. Apply narrower filters; no partial export was returned.'), { status: 413 });
            items.push(value);
          }
          if (result.docs.length < 200) return items;
          const last = result.docs.at(-1); cursor = [last.data().createdAt, last.ref.path];
        }
      }
      for (const summary of filterBugReports(await corpus(point.at), filters)) {
        // Full report fields are fetched only for an explicit export, never a
        // search corpus. All reads use the same frozen read time.
        const reference = db.doc(`bugReports/${summary.id}`);
        const result = await reference.get({ readTime: point.at });
        const [comments, attachments] = await Promise.all([children(reference, 'comments'), children(reference, 'attachments')]);
        const full = result.exists ? serializeAccountValue(result.data()) : summary;
        const record = { ...Object.fromEntries(EXPORT_FIELDS.filter(key => full[key] !== undefined).map(key => [key, full[key]])), ...summary, comments, attachments };
        budget.bytes += Buffer.byteLength(JSON.stringify({ ...record, comments: [], attachments: [] }));
        if (budget.bytes > rawBudget) throw Object.assign(new Error('The complete export exceeds the server memory budget. Apply narrower filters; no partial export was returned.'), { status: 413 });
        reports.push(record);
      }
      return reports;
      } finally { exportFills--; }
    });
    const reports = raw.map(report => ({ ...report, attachments: report.attachments.map(value => attachmentSerializer({ id: value.id, ref: { path: `bugReports/${report.id}/attachments/${value.id}` }, data: () => value })) }));
    return { schemaVersion: 2, snapshot: point.token, refreshedAt: point.at, exportedAt: new Date(now()).toISOString(), filters,
      scope: 'All matching submitted reports at the snapshot time, including comments and ready attachments. Internal notes excluded. Attachment download links may expire.', total: reports.length, reports };
  }
  return { scan, list, related, snapshot, exportData, invalidate, cacheDiagnostics: cache.diagnostics, subscribeMutation, notifyMutation, mutationGeneration };
}
