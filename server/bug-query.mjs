import { createHmac, timingSafeEqual } from 'node:crypto';
import { filterBugReports } from './bug-export.mjs';
import { serializeAccountValue } from './account-service.mjs';

export const SNAPSHOT_TTL_MS = 45 * 60_000;
export function createSnapshotCodec(secret, now = () => Date.now()) {
  const sign = payload => createHmac('sha256', secret).update(payload).digest('base64url');
  return {
    create() { const at = new Date(now() - 1000).toISOString(); const payload = Buffer.from(JSON.stringify({ at })).toString('base64url'); return { at, token: `${payload}.${sign(payload)}` }; },
    read(token) {
      try {
        if (typeof token !== 'string' || token.length > 500) throw Error();
        const [payload, signature, extra] = token.split('.');
        const expected = Buffer.from(sign(payload)); const actual = Buffer.from(signature ?? '');
        if (extra || actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw Error();
        const { at } = JSON.parse(Buffer.from(payload, 'base64url').toString());
        if (typeof at !== 'string' || !Number.isFinite(Date.parse(at)) || Date.parse(at) > now() || now() - Date.parse(at) > SNAPSHOT_TTL_MS) throw Error();
        return { at, token };
      } catch { throw Object.assign(new Error('This report snapshot has expired or is invalid. Refresh the list and try again.'), { status: 409 }); }
    },
  };
}
const fields = { status: 'statuses', priority: 'priorities', category: 'categories', type: 'types', device: 'devices', version: 'versions' };
export function createBugQueryService({ db, snapshots, batchSize = 500 }) {
  // Optional bounded acceleration only: eviction never truncates results, which can be reread at readTime.
  const cache = new Map();
  let relatedPoint;
  async function* scan(at) {
    const cached = cache.get(at);
    if (cached && cached.expires > Date.now()) { yield* cached.reports; return; }
    const reports = []; let bytes = 0;
    for await (const report of scanDatabase(at)) {
      bytes += Buffer.byteLength(JSON.stringify(report));
      if (bytes <= 2_000_000) reports.push(report);
      else reports.length = 0;
      yield report;
    }
    if (bytes <= 2_000_000) {
      if (cache.size >= 5) cache.delete(cache.keys().next().value);
      cache.set(at, { reports, expires: Date.now() + 180_000 });
    }
  }
  async function* scanDatabase(at) {
    const catalog = Object.fromEntries(await Promise.all(Object.values(fields).map(async name => {
      const result = await db.collection(`dictionaries/${name}/items`).atReadTime(at).get();
      return [name, new Map(result.docs.map(doc => [doc.id, { id: doc.id, ...serializeAccountValue(doc.data()) }]))];
    })));
    let cursor;
    while (true) {
      let query = db.collection('bugReports').orderBy('createdAt', 'desc').orderBy('__name__', 'desc').atReadTime(at).limit(batchSize);
      if (cursor) query = query.startAfter(...cursor);
      const page = await query.get();
      for (const doc of page.docs) {
        const report = { ...serializeAccountValue(doc.data()), id: doc.id };
        for (const [field, dictionary] of Object.entries(fields)) {
          const value = catalog[dictionary].get(report[field]?.id);
          if (value) report[field] = { id: value.id, code: value.code, label: value.label, color: value.color ?? null, ...(value.terminal !== undefined ? { terminal: value.terminal } : {}) };
        }
        yield report;
      }
      if (page.docs.length < batchSize) break;
      const last = page.docs.at(-1);
      cursor = [last.data().createdAt, last.ref.path];
    }
  }
  const snapshot = query => query.snapshot ? snapshots.read(query.snapshot) : snapshots.create();
  async function list(query = {}) {
    const point = snapshot(query);
    const requestedPage = Number(query.page ?? 1);
    if (!Number.isSafeInteger(requestedPage) || requestedPage < 1) throw Object.assign(new Error('Invalid report page.'), { status: 400 });
    const reports = []; let total = 0;
    for await (const report of scan(point.at)) {
      if (!filterBugReports([report], query).length) continue;
      if (total >= (requestedPage - 1) * 50 && reports.length < 50) reports.push(report);
      total++;
    }
    return { reports, snapshot: point.token, refreshedAt: point.at, expiresAt: new Date(Date.parse(point.at) + SNAPSHOT_TTL_MS).toISOString(), pagination: { page: requestedPage, pageSize: 50, total, totalPages: Math.max(1, Math.ceil(total / 50)) } };
  }
  async function related(query = {}) {
    const words = [...new Set(String(query.search ?? '').toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [])].filter(word => !new Set(['the','and','when','with','that','this','does','not','bug','report','have','was','are']).has(word)).slice(0, 30);
    if (!words.length) return { reports: [] };
    const results = [];
    if (!relatedPoint || Date.now() > relatedPoint.expires) relatedPoint = { ...snapshots.create(), expires: Date.now() + 30_000 };
    const point = relatedPoint;
    for await (const report of scan(point.at)) {
      if (report.submissionState === 'uploading' || report.id === query.exclude) continue;
      const text = `${report.displayId} ${report.description}`.toLowerCase();
      const matches = words.filter(word => text.includes(word));
      if (matches.length < Math.min(2, words.length)) continue;
      const score = matches.length / words.length + (report.category?.id === query.categoryId ? .15 : 0);
      results.push({ id: report.id, displayId: report.displayId, description: report.description.slice(0, 300), status: report.status, reporter: report.reporter, duplicateOf: report.duplicateOf ?? null, score });
      results.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
      results.splice(6);
    }
    return { reports: results, refreshedAt: point.at };
  }
  async function exportData(query = {}, attachmentSerializer = doc => {
    const { objectKey: _privateKey, ...value } = serializeAccountValue(doc.data());
    return { ...value, id: doc.id };
  }) {
    const point = snapshot(query); const reports = [];
    for await (const report of scan(point.at)) {
      if (!filterBugReports([report], query).length) continue;
      const reference = db.doc(`bugReports/${report.id}`);
      const [comments, attachments] = await Promise.all([
        reference.collection('comments').orderBy('createdAt', 'asc').atReadTime(point.at).get(),
        reference.collection('attachments').orderBy('createdAt', 'asc').atReadTime(point.at).get(),
      ]);
      reports.push({ ...report, comments: comments.docs.map(doc => ({ ...serializeAccountValue(doc.data()), id: doc.id })),
        attachments: attachments.docs.filter(doc => doc.data().status === 'ready').map(attachmentSerializer) });
    }
    return { schemaVersion: 2, snapshot: point.token, refreshedAt: point.at, exportedAt: new Date().toISOString(), filters: query,
      scope: 'All matching submitted reports at the snapshot time, including public comments and ready attachments. Internal notes excluded. Attachment download links may expire.', total: reports.length, reports };
  }
  return { scan, list, related, snapshot, exportData };
}
