import express from 'express';
import { requireAuth, requireRole } from './auth-context.mjs';
export function createAdminWorkspaceService(db, bugs) {
  return { async overview() {
    const point = bugs.snapshot({});
    const counts = { reports: 0, pending: 0, needsInfo: 0, readyForQa: 0, urgentOpen: 0, submittedToday: 0 };
    for await (const report of bugs.scan(point.at)) {
      if (report.submissionState === 'uploading') continue;
      counts.reports++;
      if (report.status?.code === 'pending_approval') counts.pending++;
      if (report.status?.code === 'needs_info') counts.needsInfo++;
      if (report.status?.code === 'ready_for_qa') counts.readyForQa++;
      if (['high', 'critical'].includes(report.priority?.code) && !['resolved', 'closed', 'rejected'].includes(report.status?.code) && !report.status?.terminal) counts.urgentOpen++;
      if (Date.parse(report.createdAt) >= Date.parse(point.at) - 86_400_000) counts.submittedToday++;
    }
    const [draftUpdates, applications, qa, leads, drafts] = await Promise.all([
      db.collection('updates').where('status', '==', 'draft').count(),
      db.collection('careerApplications').where('status', '==', 'submitted').count(),
      db.collection('websiteAccounts').where('verifiedRole', '==', 'qa').count(),
      db.collection('websiteAccounts').where('verifiedRole', '==', 'leadqa').count(),
      db.collection('updates').where('status', '==', 'draft').limit(5).select('title', 'contentType').get(),
    ]);
    return { counts: { ...counts, draftUpdates, applications, testers: qa + leads }, refreshedAt: point.at,
      drafts: drafts.docs.map(doc => ({ id: doc.id, title: doc.data().title, contentType: doc.data().contentType })) };
  } };
}
export function createAdminWorkspaceRouter(service, auth = requireAuth) {
  const router = express.Router();
  router.use(auth, requireRole('dev'));
  router.get('/', async (_req, res) => res.json(await service.overview()));
  return router;
}
