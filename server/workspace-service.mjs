import { onboarding } from './onboarding-content.mjs';
const fail = message => { throw Object.assign(new Error(message), { status: 400 }); };
export const queueFields = ['search', 'status', 'version', 'priority', 'category', 'type', 'device'];
export function normalizeQueues(value) {
  if (!Array.isArray(value) || value.length > 20) fail('Save up to 20 queues.');
  const ids = new Set();
  return value.map(queue => {
    if (!queue || typeof queue.id !== 'string' || !/^[\w-]{1,80}$/.test(queue.id) || ids.has(queue.id)) fail('Invalid queue ID.');
    ids.add(queue.id);
    if (typeof queue.name !== 'string' || !queue.name.trim() || queue.name.length > 60) fail('Queue names must be 1–60 characters.');
    const filters = {};
    for (const key of queueFields) {
      const field = queue.filters?.[key];
      if (field === undefined) continue;
      if (key === 'search') { if (typeof field !== 'string' || field.length > 300) fail('Search is too long.'); filters[key] = field.trim(); }
      else { if (!Array.isArray(field) || field.length > 100 || field.some(item => typeof item !== 'string' || item.length > 150)) fail('Invalid queue filters.'); filters[key] = [...new Set(field)]; }
    }
    return { id: queue.id, name: queue.name.trim(), filters };
  });
}
export function createWorkspaceService(db, now = () => new Date().toISOString()) {
  async function read(userId) { return (await db.doc(`websiteAccounts/${userId}`).get()).data() ?? {}; }
  return {
    async queues(userId) { return { queues: (await read(userId)).savedQueues ?? [] }; },
    async saveQueues(userId, body) {
      const queues = normalizeQueues(body?.queues);
      await db.runTransaction(async tx => { const ref = db.doc(`websiteAccounts/${userId}`); const doc = await tx.get(ref); if (!doc.exists) fail('Open your Account page before saving a queue.'); tx.update(ref, { savedQueues: queues }); });
      return { queues };
    },
    async onboarding(userId) { const saved = (await read(userId)).onboarding; return { ...onboarding, completed: saved?.version === onboarding.version ? saved.completed ?? {} : {} }; },
    async progress(userId, body) {
      if (!onboarding.steps.some(step => step.id === body?.stepId) || typeof body?.complete !== 'boolean' || body?.version !== onboarding.version) fail('Reload onboarding before saving progress.');
      return db.runTransaction(async tx => {
        const ref = db.doc(`websiteAccounts/${userId}`); const doc = await tx.get(ref);
        if (!doc.exists) fail('Open your Account page before saving progress.');
        const saved = doc.data().onboarding;
        const completed = saved?.version === onboarding.version ? { ...saved.completed } : {};
        if (body.complete) completed[body.stepId] = now(); else delete completed[body.stepId];
        tx.update(ref, { onboarding: { version: onboarding.version, completed, updatedAt: now() } });
        return { completed };
      });
    },
  };
}
