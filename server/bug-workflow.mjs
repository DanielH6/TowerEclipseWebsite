const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
export function reportExtras(input, partial = false) {
  const result = {};
  if (!partial || input.frequency !== undefined) {
    if (!['', 'low', 'medium', 'high'].includes(input.frequency ?? '')) fail('Frequency must be low, medium, high, or unspecified.');
    result.frequency = input.frequency || null;
  }
  if (!partial || input.serverConsoleUrl !== undefined) {
    const raw = input.serverConsoleUrl ?? '';
    if (typeof raw !== 'string' || raw.length > 200) fail('Enter a valid Pastebin link.');
    const value = raw.trim();
    if (value && !/^https:\/\/pastebin\.com\/(?:raw\/)?[A-Za-z0-9]+\/?$/.test(value)) fail('Server console must be an https://pastebin.com/ link to a paste.');
    result.serverConsoleUrl = value || null;
  }
  return result;
}
export function normalizeReportLinks(value = []) {
  if (!Array.isArray(value) || value.length > 100) fail('An update can link up to 100 reports.');
  const ids = new Set();
  return value.map(item => {
    if (!item || typeof item.id !== 'string' || !/^[\w-]{1,150}$/.test(item.id) || ids.has(item.id)) fail('Linked reports must have unique valid IDs.');
    ids.add(item.id);
    if (typeof item.summary !== 'string' || !item.summary.trim() || item.summary.length > 1000) fail('Each linked report needs public wording between 1 and 1000 characters.');
    return { id: item.id, summary: item.summary.trim() };
  });
}
export function createDuplicateService(db, now = () => new Date(), isTerminal = async status => status?.terminal === true) {
  return async function link(sourceId, targetId, actor) {
    if (!['dev', 'leadqa'].includes(actor.role)) fail('Only QA leads and developers can link duplicates.', 403);
    if (!/^[\w-]{1,150}$/.test(sourceId) || (targetId !== null && (typeof targetId !== 'string' || !/^[\w-]{1,150}$/.test(targetId)))) fail('Invalid report ID.');
    if (sourceId === targetId) fail('A report cannot be its own duplicate.');
    return db.runTransaction(async tx => {
      const sourceRef = db.doc(`bugReports/${sourceId}`); const source = await tx.get(sourceRef); const data = source.data();
      if (!source.exists || data.submissionState === 'uploading') fail('Submitted report not found.', 404);
      if (actor.role === 'leadqa' && await isTerminal(data.status)) fail('Only developers can edit terminal reports.', 403);
      const oldId = data.duplicateOf?.id;
      const targetRef = targetId ? db.doc(`bugReports/${targetId}`) : null;
      const target = targetRef ? await tx.get(targetRef) : null;
      const oldRef = oldId && oldId !== targetId ? db.doc(`bugReports/${oldId}`) : null;
      const old = oldRef ? await tx.get(oldRef) : null;
      if (targetRef && (!target.exists || target.data().submissionState === 'uploading')) fail('Canonical report must be a submitted report.', 404);
      if (target?.data().duplicateOf) fail('Choose the original canonical report, not another duplicate.');
      if (targetId && Number(data.duplicateCount ?? 0) > 0) fail('This report has duplicates pointing to it. Relink those reports before changing its canonical report.');
      const duplicateOf = target ? { id: targetId, displayId: target.data().displayId } : null;
      if (oldId === targetId || (!oldId && !targetId)) return { duplicateOf };
      tx.update(sourceRef, { duplicateOf, updatedAt: now() });
      if (old?.exists) tx.update(oldRef, { duplicateCount: Math.max(0, Number(old.data().duplicateCount ?? 0) - 1) });
      if (target) tx.update(targetRef, { duplicateCount: Number(target.data().duplicateCount ?? 0) + 1 });
      tx.set(db.doc(`bugReports/${sourceId}/activity/duplicate-${crypto.randomUUID()}`), { action: 'duplicate_link_changed', actor, details: { previous: data.duplicateOf ?? null, duplicateOf }, createdAt: now() });
      return { duplicateOf };
    });
  };
}
