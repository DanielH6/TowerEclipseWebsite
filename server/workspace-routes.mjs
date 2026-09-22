import express from 'express';
import { requireAuth, requireRole, requireCsrf } from './auth-context.mjs';
import { requireSameOrigin } from './security.mjs';
export function createWorkspaceRouter(service, auth = requireAuth) {
  const router = express.Router(); const staff = requireRole('qa', 'leadqa', 'dev');
  router.get('/queues', auth, staff, async (req, res) => res.json(await service.queues(req.authUser.id)));
  router.put('/queues', auth, staff, requireSameOrigin, requireCsrf, async (req, res) => res.json(await service.saveQueues(req.authUser.id, req.body)));
  router.get('/onboarding', auth, staff, async (req, res) => res.json(await service.onboarding(req.authUser.id)));
  router.put('/onboarding', auth, staff, requireSameOrigin, requireCsrf, async (req, res) => res.json(await service.progress(req.authUser.id, req.body)));
  return router;
}
