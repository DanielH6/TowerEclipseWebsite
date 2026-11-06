import express from 'express';
import { requireAuth, requireRole } from './auth-context.mjs';
import { createReadCache } from './read-cache.mjs';

const DAY = 86_400_000;
const contribution = report => {
  const counts = { reports: 0, pending: 0, needsInfo: 0, readyForQa: 0, urgentOpen: 0 };
  if (!report || report.submissionState === 'uploading') return counts;
  counts.reports = 1;
  counts.pending = Number(report.status?.code === 'pending_approval');
  counts.needsInfo = Number(report.status?.code === 'needs_info');
  counts.readyForQa = Number(report.status?.code === 'ready_for_qa');
  counts.urgentOpen = Number(['high', 'critical'].includes(report.priority?.code) && !['resolved', 'closed', 'rejected'].includes(report.status?.code) && !report.status?.terminal);
  return counts;
};
export function createAdminWorkspaceService(db, bugs, { now = Date.now } = {}) {
  const cache = createReadCache({ name: 'admin-overview', ttlMs: 45_000, maxEntries: 5, maxBytes: 1024 * 1024, now });
  let summary, pending, events = [], revision = 0, eventEpoch = 0;
  function apply(model, event) {
    const before = event.beforeCounts, after = event.afterCounts;
    for (const key of Object.keys(model.counts)) model.counts[key] += after[key] - before[key];
    model.generation = event.generation; model.updatedAt = new Date(event.at).toISOString();
  }
  bugs.subscribeMutation?.(input => {
    const event = { at: input.at, generation: input.generation, beforeCounts: contribution(input.before), afterCounts: contribution(input.after) };
    revision++;
    if (summary) apply(summary, event);
    // Retain only recent events needed by an in-progress frozen census. The
    // summary itself is constant-size; it does not retain all report bodies.
    events.push(event); if (!pending) events = events.filter(item => item.at >= now() - 60_000);
    if (events.length > 1000) { events = []; summary = null; eventEpoch++; }
    cache.clear();
  });
  async function reportCounts(force = false) {
    const head = bugs.mutationGeneration?.() ?? { id: 'startup', at: 0 };
    if (!force && summary && (now() < (summary.recheckAfter ?? 0) || now() - summary.reconciledAt < DAY && summary.generation === head.id)) return summary;
    if (pending) return pending;
    pending = (async () => {
      const epoch = eventEpoch;
      const point = bugs.snapshot(force || summary ? { fresh: '1' } : {});
      const model = { counts: contribution(null), baselineAt: point.at, updatedAt: point.at, reconciledAt: now(), generation: head.id };
      for await (const report of bugs.scan(point.at)) {
        const value = contribution(report);
        for (const key of Object.keys(model.counts)) model.counts[key] += value[key];
      }
      if (epoch !== eventEpoch) throw Object.assign(new Error('Report summaries changed too quickly. Refresh the overview shortly.'), { status: 503 });
      for (const event of events) if (event.at > Date.parse(point.at)) apply(model, event);
      // A shared LOCAL_CACHE_DIR generation detects writes from sibling Node
      // processes. Different hosts need shared storage; the returned as-of time
      // and explicit reconciliation remain available in every deployment.
      if (head.at > Date.parse(point.at) && !events.some(event => event.generation === head.id)) { model.generation = 'reconcile-recent-write'; model.recheckAfter = now() + 2000; }
      summary = model; return model;
    })().finally(() => { pending = null; });
    return pending;
  }
  return { async overview({ fresh } = {}) {
    const model = await reportCounts(fresh === '1');
    return cache.get(`${revision}:${model.generation}`, async () => {
      const currentTime = now();
      const recent = db.collection('bugReports').where('createdAt', '>=', new Date(currentTime - DAY)).where('createdAt', '<=', new Date(currentTime)).orderBy('createdAt', 'desc');
      const [draftUpdates, applications, qa, penTesters, leads, drafts, totalToday, draftsToday] = await Promise.all([
        db.collection('updates').where('status', '==', 'draft').count(),
        db.collection('careerApplications').where('status', '==', 'submitted').count(),
        db.collection('websiteAccounts').where('verifiedRole', '==', 'qa').count(),
        db.collection('websiteAccounts').where('verifiedRole', '==', 'pentester').count(),
        db.collection('websiteAccounts').where('verifiedRole', '==', 'leadqa').count(),
        db.collection('updates').where('status', '==', 'draft').limit(5).select('title', 'contentType').get(),
        recent.count(), recent.where('submissionState', '==', 'uploading').count(),
      ]);
      return { counts: { ...model.counts, submittedToday: Math.max(0, totalToday - draftsToday), draftUpdates, applications, testers: qa + penTesters + leads }, refreshedAt: model.updatedAt, aggregateRefreshedAt: new Date(currentTime).toISOString(), reconciledAt: new Date(model.reconciledAt).toISOString(),
        drafts: drafts.docs.map(doc => ({ id: doc.id, title: doc.data().title, contentType: doc.data().contentType })) };
    });
  } };
}
export function createAdminWorkspaceRouter(service, auth = requireAuth) {
  const router = express.Router();
  router.use(auth, requireRole('dev'));
  router.get('/', async (req, res) => res.json(await service.overview(req.query)));
  return router;
}
