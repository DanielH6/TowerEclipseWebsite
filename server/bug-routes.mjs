import { reportExtras, createDuplicateService } from "./bug-workflow.mjs";
import rateLimit from "express-rate-limit";
import express from "express";
import { accountActivityFields } from "./account-service.mjs";
import { FieldValue, Timestamp, db } from "./firebase.mjs";
import { createBugQueryService, createSnapshotCodec } from "./bug-query.mjs";
import { config } from "./config.mjs";
import {
  actorSnapshot,
  requireAuth,
  requireCsrf,
  requireExactRole,
  requireRole,
} from "./auth-context.mjs";
import { dictionarySnapshot, getDictionaryCatalog, getDictionaryEntry } from "./dictionaries.mjs";
import {
  attachmentStoragePolicy,
  createAttachmentDownloadUrl,
  createAttachmentUploadUrl,
  deleteAttachmentObject,
  headAttachmentObject,
  normalizeAttachmentInput,
} from "./r2.mjs";

const EDITABLE_DICTIONARIES = Object.freeze({
  versionId: "versions",
  priorityId: "priorities",
  categoryId: "categories",
  typeId: "types",
  deviceId: "devices",
});

const REPORT_DICTIONARIES = Object.freeze({
  status: "statuses",
  version: "versions",
  priority: "priorities",
  category: "categories",
  type: "types",
  device: "devices",
});

export const bugQueries = createBugQueryService({ db, snapshots: createSnapshotCodec(config.cookieSecret) });

// Kept for the maintenance command: query the database, never restore a stale disk cache.
export async function refreshBugReportCacheFromFirestore() {
  const reports = [];
  const point = bugQueries.snapshot({});
  for await (const report of bugQueries.scan(point.at)) reports.push(report);
  return reports;
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function cleanText(value, field, { min = 1, max = 5000 } = {}) {
  if (typeof value !== "string") {
    throw httpError(400, `${field} must be a string.`);
  }
  const result = value.trim();
  if (result.length < min || result.length > max) {
    throw httpError(400, `${field} must contain between ${min} and ${max} characters.`);
  }
  return result;
}

function serialize(value) {
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (Array.isArray(value)) return value.map(serialize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, serialize(nested)]));
  }
  return value;
}

function serializeDocument(document) {
  return { id: document.id, ...serialize(document.data()) };
}

async function resolveDictionaryFields(body, { partial = false, current = null } = {}) {
  const resolved = {};

  for (const [inputName, dictionary] of Object.entries(EDITABLE_DICTIONARIES)) {
    const targetName = inputName.replace(/Id$/, "");
    if (partial && body[inputName] === undefined) continue;
    const entryId = cleanText(body[inputName], inputName, { min: 1, max: 150 });
    const activeOnly = current?.[targetName]?.id !== entryId;
    resolved[targetName] = dictionarySnapshot(
      await getDictionaryEntry(dictionary, entryId, { activeOnly }),
    );
  }

  return resolved;
}

async function pendingStatus() {
  return dictionarySnapshot(await getDictionaryEntry("statuses", "pending-approval"));
}

async function statusById(id, { activeOnly = true } = {}) {
  return dictionarySnapshot(
    await getDictionaryEntry("statuses", id, { activeOnly }),
  );
}

function reportIsPending(report) {
  return report.approval?.state === "pending";
}

function reportIsSubmitted(report) {
  return report.submissionState !== "uploading";
}

function requireSubmittedReport(report) {
  if (!reportIsSubmitted(report)) {
    throw httpError(409, "This bug report is still waiting for its attached images to finish uploading.");
  }
}

function expectedAttachmentCount(value, policy) {
  if (value === undefined || value === null || value === "") return 0;

  const count = Number(value);
  if (!Number.isSafeInteger(count) || count < 0) {
    throw httpError(400, "expectedAttachments must be a non-negative integer.");
  }
  if (count > 0 && !policy.enabled) {
    throw httpError(503, "Image storage is not configured, so this report cannot include attachments.");
  }
  if (count > policy.maxFilesPerReport) {
    throw httpError(400, `A report can contain at most ${policy.maxFilesPerReport} attachments.`);
  }

  return count;
}

async function statusIsTerminal(status) {
  if (!status?.id) return false;
  if (typeof status.terminal === "boolean") return status.terminal;

  const entry = await getDictionaryEntry("statuses", status.id, { activeOnly: false });
  return entry.terminal === true;
}

async function canModifyAttachments(session, report) {
  if (session.role === "dev") return true;

  const terminal = await statusIsTerminal(report.status);
  if (session.role === "leadqa") return !terminal;

  return (session.role === "qa" || session.role === "pentester")
    && report.reporter?.discordId === session.discordUser.id
    && reportIsPending(report);
}

async function requireAttachmentAccess(session, report) {
  if (!await canModifyAttachments(session, report)) {
    throw httpError(
      403,
      session.role === "leadqa"
        ? "Terminal bug reports are read-only for QA leads. Only comments are allowed."
        : "You cannot modify attachments on this bug report.",
    );
  }
}

function attachmentIsExpired(attachment) {
  const expiresAt = attachment.uploadExpiresAt;
  if (!(expiresAt instanceof Timestamp)) return false;
  return expiresAt.toDate().getTime() < Date.now();
}

async function cleanupExpiredPendingAttachments(documents) {
  const remaining = [];

  for (const document of documents) {
    const attachment = document.data();
    if (attachment.status !== "pending" || !attachmentIsExpired(attachment)) {
      remaining.push(document);
      continue;
    }

    try {
      await deleteAttachmentObject(attachment.objectKey, { ignoreMissing: true });
    } catch (error) {
      console.warn(`Could not remove expired R2 object ${attachment.objectKey}:`, error);
    }

    await document.ref.delete();
  }

  return remaining;
}

function serializeAttachmentDocument(document) {
  const value = serializeDocument(document);
  const storage = attachmentStoragePolicy();
  const { objectKey, ...publicValue } = value;
  return {
    ...publicValue,
    downloadUrl: storage.enabled && value.status === "ready"
      ? `/api/bugs/${encodeURIComponent(document.ref?.path.split("/")[1] ?? value.reportId ?? "")}/attachments/${encodeURIComponent(value.id)}/download`
      : null,
  };
}

async function hydrateReportDictionaries(reports) {
  if (reports.length === 0) return reports;

  const catalog = await getDictionaryCatalog({ activeOnly: false });
  const entriesByDictionary = Object.fromEntries(
    Object.entries(catalog).map(([dictionary, entries]) => [
      dictionary,
      new Map(entries.map((entry) => [entry.id, dictionarySnapshot(entry)])),
    ]),
  );

  return reports.map((report) => {
    const hydrated = { ...report };

    for (const [field, dictionary] of Object.entries(REPORT_DICTIONARIES)) {
      const savedValue = report[field];
      if (!savedValue?.id) continue;
      const currentValue = entriesByDictionary[dictionary]?.get(savedValue.id);
      if (currentValue) hydrated[field] = currentValue;
    }

    return hydrated;
  });
}

async function serializeReportDocuments(documents) {
  const reports = await hydrateReportDictionaries(documents.map(serializeDocument));
  return reports.map((report) => ({
    ...report,
    commentsCount: Number(report.commentsCount ?? 0),
    developerNotesCount: Number(report.developerNotesCount ?? 0),
    attachmentsCount: Number(report.attachmentsCount ?? 0),
  }));
}

async function serializeReportDocument(document) {
  const [report] = await serializeReportDocuments([document]);
  return report;
}

async function addActivity(transactionOrBatch, reportReference, action, actor, details = {}, report = null) {
  const reference = reportReference.collection("activity").doc();
  transactionOrBatch.set(reference, {
    ...accountActivityFields(reportReference.id, action, actor, report, details),
    action,
    actor,
    details,
    createdAt: FieldValue.serverTimestamp(),
  });
}

async function observeContribution(request, before, after) {
  try { await request.bugObservers?.onContribution?.(before, after); }
  catch { console.warn('Report contribution summary needs reconciliation.'); }
}

async function createReport(request, response, next) {
  try {
    const body = request.body ?? {};
    const policy = attachmentStoragePolicy();
    const expectedAttachments = expectedAttachmentCount(body.expectedAttachments, policy);
    const uploadingAttachments = expectedAttachments > 0;
    const description = cleanText(body.description, "description", { min: 5, max: 10000 });
    const dictionaryFields = await resolveDictionaryFields(body);
    const status = await pendingStatus();
    const actor = actorSnapshot(request.authSession);

    const counterReference = db.doc("systemCounters/bugReports");
    const reportReference = db.collection("bugReports").doc();

    await db.runTransaction(async (transaction) => {
      const counterSnapshot = await transaction.get(counterReference);
      const nextNumber = Number(counterSnapshot.data()?.nextNumber ?? 1);
      if (!Number.isSafeInteger(nextNumber) || nextNumber < 1) {
        throw httpError(500, "Bug report counter is invalid.");
      }

      const displayId = `TE-${String(nextNumber).padStart(6, "0")}`;
      transaction.set(counterReference, { nextNumber: nextNumber + 1 }, { merge: true });
      transaction.set(reportReference, {
        displayId,
        status,
        ...dictionaryFields,
        description,
        ...reportExtras(body),
        reporter: actor,
        submissionState: uploadingAttachments ? "uploading" : "submitted",
        expectedAttachments,
        submittedAt: uploadingAttachments ? null : FieldValue.serverTimestamp(),
        approval: {
          state: "pending",
          approvedBy: null,
          approvedAt: null,
          rejectedBy: null,
          rejectedAt: null,
          comment: "",
        },
        commentsCount: 0,
        developerNotesCount: 0,
        attachmentsCount: 0,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      await addActivity(
        transaction,
        reportReference,
        uploadingAttachments ? "report_draft_created" : "report_created",
        actor,
        { displayId, expectedAttachments },
      );
    });

    const created = await reportReference.get();
    request.bugOwner = created.data().reporter?.discordId;
    await observeContribution(request, null, { ...created.data(), id: created.id });

    response.status(201).json({ report: await serializeReportDocument(created) });
  } catch (error) {
    next(error);
  }
}

async function listReports(request, response, next) {
  try { response.json(await bugQueries.list(request.query)); } catch (error) { next(error); }
}
async function exportReports(request, response, next) {
  try { response.json(await bugQueries.exportData(request.query, serializeAttachmentDocument)); } catch (error) { next(error); }
}

const detailCursors = createSnapshotCodec(config.cookieSecret);
const detailSections = { comments: { collection: 'comments', direction: 'asc' }, activity: { collection: 'activity', direction: 'desc' }, attachments: { collection: 'attachments', direction: 'asc' }, developerNotes: { collection: 'developerNotes', direction: 'asc' } };
async function visibleReport(request) {
  if (!/^[\w-]{1,150}$/.test(request.params.reportId)) throw httpError(404, 'Bug report not found.');
  const reference = db.doc(`bugReports/${request.params.reportId}`), report = await reference.get();
  if (!report.exists) throw httpError(404, 'Bug report not found.');
  const data = report.data(), session = request.authSession;
  if (!reportIsSubmitted(data) && session.role !== 'dev' && data.reporter?.discordId !== session.discordUser.id) throw httpError(404, 'Bug report not found.');
  return { reference, report };
}
async function sectionPage(reference, section, session, cursor) {
  const definition = detailSections[section];
  if (!definition) throw httpError(404, 'Report section not found.');
  if (section === 'developerNotes' && !['dev', 'leadqa'].includes(session.role)) throw httpError(403, 'Private notes are available only to reviewers.');
  let point = detailCursors.create(), after;
  if (cursor) {
    const value = detailCursors.readCursor(cursor); point = detailCursors.read(cursor);
    if (value.reportId !== reference.id || value.section !== section || typeof value.value !== 'string' || !Number.isFinite(Date.parse(value.value)) || !/^[\w-]+$/.test(value.id)) throw httpError(400, 'Invalid report section cursor.');
    after = [new Timestamp(value.value), `${reference.path}/${definition.collection}/${value.id}`];
  }
  let query = reference.collection(definition.collection).orderBy('createdAt', definition.direction).orderBy('__name__', definition.direction).atReadTime(point.at).limit(51);
  if (section === 'attachments') query = query.where('status', '==', 'ready');
  if (after) query = query.startAfter(...after);
  const result = await query.get(), shown = result.docs.slice(0, 50), last = shown.at(-1);
  return { items: shown.filter(doc => section !== 'activity' || ['dev', 'leadqa'].includes(session.role) || doc.data().action !== 'developer_note_added').map(section === 'attachments' ? serializeAttachmentDocument : serializeDocument), nextCursor: result.docs.length > 50 ? detailCursors.cursor({ at: point.at, reportId: reference.id, section, value: serialize(last.data().createdAt), id: last.id }) : null };
}
async function getReportSection(request, response, next) {
  try {
    if (request.params.section === 'developerNotes' && !['dev', 'leadqa'].includes(request.authSession.role)) throw httpError(403, 'Private notes are available only to reviewers.');
    const { reference } = await visibleReport(request);
    response.json(await sectionPage(reference, request.params.section, request.authSession, request.query.cursor));
  } catch (error) { next(error); }
}
async function downloadAttachment(request, response, next) {
  try {
    const { reference } = await visibleReport(request);
    if (!/^[\w-]{1,150}$/.test(request.params.attachmentId)) throw httpError(404, 'Attachment not found.');
    const attachment = await reference.collection('attachments').doc(request.params.attachmentId).get();
    if (!attachment.exists || attachment.data().status !== 'ready') throw httpError(404, 'Attachment not found.');
    response.setHeader('Cache-Control', 'private, no-store');
    response.redirect(createAttachmentDownloadUrl(attachment.data().objectKey));
  } catch (error) { next(error); }
}
async function getReport(request, response, next) {
  try {
    const { reference, report } = await visibleReport(request);
    const sections = {}, values = {};
    await Promise.all(Object.keys(detailSections).map(async section => {
      const allowed = section !== 'developerNotes' || ['dev', 'leadqa'].includes(request.authSession.role);
      const data = allowed && request.query.lazy !== '1' ? await sectionPage(reference, section, request.authSession) : { items: [], nextCursor: null };
      values[section] = data.items; sections[section] = { loaded: allowed && request.query.lazy !== '1', nextCursor: data.nextCursor };
    }));
    const updates = await db.collection('updates').where('linkedReportIds', 'array-contains', report.id).where('status', '==', 'published').select('title', 'version', 'linkedReports').get();
    response.json({ relatedUpdates: updates.docs.map(doc => ({ id: doc.id, title: doc.data().title, version: doc.data().version, summary: doc.data().linkedReports?.find(item => item.id === report.id)?.summary ?? '' })), report: await serializeReportDocument(report), ...values, sections, attachmentPolicy: attachmentStoragePolicy() });
  } catch (error) { next(error); }
}

async function patchReport(request, response, next) {
  try {
    const reference = db.doc(`bugReports/${request.params.reportId}`);
    const existing = await reference.get();
    if (!existing.exists) {
      response.status(404).json({ error: "Bug report not found." });
      return;
    }

    const current = existing.data();
    request.bugBefore = { ...current, id: existing.id };
    request.bugOwner = current.reporter?.discordId;
    requireSubmittedReport(current);
    const body = request.body ?? {};
    const session = request.authSession;
    const isQaOwner = (session.role === "qa" || session.role === "pentester")
      && current.reporter?.discordId === session.discordUser.id;
    const isStaff = session.role === "leadqa" || session.role === "dev";
    const currentIsTerminal = await statusIsTerminal(current.status);

    if (session.role === "leadqa" && currentIsTerminal) {
      throw httpError(
        403,
        "Terminal bug reports are read-only for QA leads. Only comments are allowed.",
      );
    }

    if (!isStaff && !(isQaOwner && reportIsPending(current))) {
      response.status(403).json({ error: "You cannot edit this bug report." });
      return;
    }

    const changes = reportExtras(body, true);
    let reopensTerminalReport = false;

    if (body.description !== undefined) {
      changes.description = cleanText(body.description, "description", { min: 5, max: 10000 });
    }
    Object.assign(changes, await resolveDictionaryFields(body, { partial: true, current }));

    if (body.statusId !== undefined) {
      if (!isStaff) throw httpError(403, "Only QA leads and developers can change status.");

      const requestedStatusId = cleanText(body.statusId, "statusId", { min: 1, max: 150 });
      const requestedStatus = await getDictionaryEntry("statuses", requestedStatusId, {
        activeOnly: current.status?.id !== requestedStatusId,
      });
      const requestedIsTerminal = requestedStatus.terminal === true;

      reopensTerminalReport = currentIsTerminal && !requestedIsTerminal;
      if (reopensTerminalReport && session.role !== "dev") {
        throw httpError(403, "Only developers can reopen terminal bug reports.");
      }

      changes.status = dictionarySnapshot(requestedStatus);
    }

    if (Object.keys(changes).length === 0) {
      response.status(400).json({ error: "No editable fields were supplied." });
      return;
    }

    const actor = actorSnapshot(session);
    const batch = db.batch();
    batch.update(reference, {
      ...changes,
      updatedAt: FieldValue.serverTimestamp(),
    });
    await addActivity(
      batch,
      reference,
      reopensTerminalReport ? "report_reopened" : "report_updated",
      actor,
      {
        fields: Object.keys(changes),
        ...(changes.status
          ? {
              previousStatus: current.status,
              newStatus: changes.status,
            }
          : {}),
      },
      current,
    );
    await batch.commit();

    const updated = await reference.get();

    response.json({ report: await serializeReportDocument(updated) });
  } catch (error) {
    next(error);
  }
}

async function approveReport(request, response, next) {
  try {
    const reference = db.doc(`bugReports/${request.params.reportId}`);
    const existing = await reference.get();
    if (!existing.exists) {
      response.status(404).json({ error: "Bug report not found." });
      return;
    }

    const current = existing.data();
    request.bugBefore = { ...current, id: existing.id };
    request.bugOwner = current.reporter?.discordId;
    requireSubmittedReport(current);
    if (request.authSession.role === "leadqa" && await statusIsTerminal(current.status)) {
      throw httpError(
        403,
        "Terminal bug reports are read-only for QA leads. Only comments are allowed.",
      );
    }
    if (!reportIsPending(current)) {
      throw httpError(409, "Only pending bug reports can be approved.");
    }

    const actor = actorSnapshot(request.authSession);
    const status = await statusById("approved");
    const comment = typeof request.body?.comment === "string" ? request.body.comment.trim().slice(0, 1000) : "";
    const batch = db.batch();
    batch.update(reference, {
      status,
      approval: {
        state: "approved",
        approvedBy: actor,
        approvedAt: FieldValue.serverTimestamp(),
        rejectedBy: null,
        rejectedAt: null,
        comment,
      },
      updatedAt: FieldValue.serverTimestamp(),
    });
    await addActivity(batch, reference, "report_approved", actor, { comment }, current);
    await batch.commit();
    const updated = await reference.get();

    response.json({ report: await serializeReportDocument(updated) });
  } catch (error) {
    next(error);
  }
}

async function rejectReport(request, response, next) {
  try {
    const reference = db.doc(`bugReports/${request.params.reportId}`);
    const existing = await reference.get();
    if (!existing.exists) {
      response.status(404).json({ error: "Bug report not found." });
      return;
    }

    const current = existing.data();
    request.bugBefore = { ...current, id: existing.id };
    request.bugOwner = current.reporter?.discordId;
    requireSubmittedReport(current);
    if (request.authSession.role === "leadqa" && await statusIsTerminal(current.status)) {
      throw httpError(
        403,
        "Terminal bug reports are read-only for QA leads. Only comments are allowed.",
      );
    }
    if (!reportIsPending(current)) {
      throw httpError(409, "Only pending bug reports can be rejected.");
    }

    const comment = cleanText(request.body?.comment ?? "", "comment", { min: 2, max: 1000 });
    const actor = actorSnapshot(request.authSession);
    const status = await statusById("rejected");
    const batch = db.batch();
    batch.update(reference, {
      status,
      approval: {
        state: "rejected",
        approvedBy: null,
        approvedAt: null,
        rejectedBy: actor,
        rejectedAt: FieldValue.serverTimestamp(),
        comment,
      },
      updatedAt: FieldValue.serverTimestamp(),
    });
    await addActivity(batch, reference, "report_rejected", actor, { comment }, current);
    await batch.commit();
    const updated = await reference.get();

    response.json({ report: await serializeReportDocument(updated) });
  } catch (error) {
    next(error);
  }
}

async function addComment(request, response, next) {
  try {
    const reportReference = db.doc(`bugReports/${request.params.reportId}`);
    const report = await reportReference.get();
    if (!report.exists) {
      response.status(404).json({ error: "Bug report not found." });
      return;
    }
    request.bugOwner = report.data().reporter?.discordId;
    requireSubmittedReport(report.data());

    const body = cleanText(request.body?.body, "body", { min: 1, max: 5000 });
    const reference = reportReference.collection("comments").doc();
    const batch = db.batch();
    batch.set(reference, {
      body,
      author: actorSnapshot(request.authSession),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: null,
    });
    batch.update(reportReference, {
      commentsCount: FieldValue.increment(1),
      updatedAt: FieldValue.serverTimestamp(),
    });
    await addActivity(batch, reportReference, "comment_added", actorSnapshot(request.authSession), {}, report.data());
    await batch.commit();

    response.status(201).json({ comment: serializeDocument(await reference.get()) });
  } catch (error) {
    next(error);
  }
}

async function addDeveloperNote(request, response, next) {
  try {
    const reportReference = db.doc(`bugReports/${request.params.reportId}`);
    const report = await reportReference.get();
    if (!report.exists) {
      response.status(404).json({ error: "Bug report not found." });
      return;
    }
    request.bugOwner = report.data().reporter?.discordId;
    requireSubmittedReport(report.data());

    const body = cleanText(request.body?.body, "body", { min: 1, max: 10000 });
    const reference = reportReference.collection("developerNotes").doc();
    const batch = db.batch();
    batch.set(reference, {
      body,
      author: actorSnapshot(request.authSession),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: null,
    });
    batch.update(reportReference, {
      developerNotesCount: FieldValue.increment(1),
      updatedAt: FieldValue.serverTimestamp(),
    });
    await addActivity(batch, reportReference, "developer_note_added", actorSnapshot(request.authSession));
    await batch.commit();

    response.status(201).json({ note: serializeDocument(await reference.get()) });
  } catch (error) {
    next(error);
  }
}

async function removeReportAndStoredAttachments(reference) {
  const attachments = await reference.collection("attachments").limit(1000).get();
  for (const attachmentDocument of attachments.docs) {
    const objectKey = attachmentDocument.data().objectKey;
    if (objectKey) {
      await deleteAttachmentObject(objectKey, { ignoreMissing: true });
    }
  }
  await db.recursiveDelete(reference);
}

async function finalizeReportSubmission(request, response, next) {
  try {
    const reference = db.doc(`bugReports/${request.params.reportId}`);
    const [reportSnapshot, attachmentSnapshot] = await Promise.all([
      reference.get(),
      reference.collection("attachments").limit(100).get(),
    ]);

    if (!reportSnapshot.exists) throw httpError(404, "Bug report not found.");
    const report = reportSnapshot.data();
    request.bugBefore = { ...report, id: reportSnapshot.id };
    request.bugOwner = report.reporter?.discordId;
    const isOwner = report.reporter?.discordId === request.authSession.discordUser.id;
    if (!isOwner && request.authSession.role !== "dev") {
      throw httpError(403, "Only the reporter can finish this bug report submission.");
    }
    if (reportIsSubmitted(report)) {
      response.json({ report: await serializeReportDocument(reportSnapshot) });
      return;
    }

    const expected = Number(report.expectedAttachments ?? 0);
    const ready = attachmentSnapshot.docs.filter((document) => document.data().status === "ready");
    const pending = attachmentSnapshot.docs.filter((document) => document.data().status === "pending");
    if (expected < 1 || ready.length !== expected || pending.length > 0) {
      throw httpError(
        409,
        `All ${expected} selected images must finish uploading before the report can be submitted.`,
      );
    }

    const actor = actorSnapshot(request.authSession);
    const batch = db.batch();
    batch.update(reference, {
      submissionState: "submitted",
      submittedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    await addActivity(batch, reference, "report_created", actor, {
      displayId: report.displayId,
      attachmentsCount: ready.length,
    });
    await batch.commit();

    const updated = await reference.get();
    await observeContribution(request, { ...report, id: reference.id }, { ...updated.data(), id: reference.id });

    response.json({ report: await serializeReportDocument(updated) });
  } catch (error) {
    next(error);
  }
}

async function cancelReportSubmission(request, response, next) {
  try {
    const reference = db.doc(`bugReports/${request.params.reportId}`);
    const snapshot = await reference.get();
    if (!snapshot.exists) {
      response.sendStatus(204);
      return;
    }

    const report = snapshot.data();
    request.bugOwner = report.reporter?.discordId;
    const isOwner = report.reporter?.discordId === request.authSession.discordUser.id;
    if (!isOwner && request.authSession.role !== "dev") {
      throw httpError(403, "Only the reporter can cancel this bug report submission.");
    }
    if (reportIsSubmitted(report)) {
      throw httpError(409, "A submitted bug report cannot be cancelled through this endpoint.");
    }

    await removeReportAndStoredAttachments(reference);

    response.sendStatus(204);
  } catch (error) {
    next(error);
  }
}

async function getAttachmentStorageConfig(_request, response) {
  response.json({ attachmentPolicy: attachmentStoragePolicy() });
}

async function beginAttachmentUpload(request, response, next) {
  try {
    const policy = attachmentStoragePolicy();
    if (!policy.enabled) {
      throw httpError(503, "Attachment storage is not configured.");
    }

    const reportReference = db.doc(`bugReports/${request.params.reportId}`);
    const reportSnapshot = await reportReference.get();
    if (!reportSnapshot.exists) {
      throw httpError(404, "Bug report not found.");
    }

    const report = reportSnapshot.data();
    request.bugBefore = { ...report, id: reportSnapshot.id };
    request.bugOwner = report.reporter?.discordId;
    await requireAttachmentAccess(request.authSession, report);

    const attachmentSnapshot = await reportReference
      .collection("attachments")
      .orderBy("createdAt", "asc")
      .limit(100)
      .get();
    const currentAttachments = await cleanupExpiredPendingAttachments(attachmentSnapshot.docs);
    const occupiedSlots = currentAttachments.filter((document) => {
      const status = document.data().status;
      return status === "pending" || status === "ready";
    }).length;

    const attachmentLimit = report.submissionState === "uploading"
      ? Number(report.expectedAttachments ?? 0)
      : policy.maxFilesPerReport;

    if (occupiedSlots >= attachmentLimit) {
      throw httpError(409, `This report already has the maximum of ${attachmentLimit} attachments.`);
    }

    const normalized = normalizeAttachmentInput(request.body ?? {});
    const attachmentReference = reportReference.collection("attachments").doc();
    const objectKey = [
      "bug-reports",
      reportReference.id,
      attachmentReference.id,
      normalized.objectName,
    ].join("/");
    const upload = createAttachmentUploadUrl(
      objectKey,
      normalized.contentType,
    );

    await attachmentReference.set({
      objectKey,
      originalName: normalized.originalName,
      contentType: normalized.contentType,
      contentDisposition: normalized.contentDisposition,
      previewKind: normalized.previewKind,
      declaredSize: normalized.size,
      size: normalized.size,
      status: "pending",
      uploader: actorSnapshot(request.authSession),
      createdAt: FieldValue.serverTimestamp(),
      uploadedAt: null,
      uploadExpiresAt: new Timestamp(
        new Date(Date.now() + (upload.expiresIn + 300) * 1000),
      ),
      etag: null,
    });

    response.status(201).json({
      attachmentId: attachmentReference.id,
      uploadUrl: upload.url,
      uploadHeaders: upload.headers,
      expiresIn: upload.expiresIn,
    });
  } catch (error) {
    next(error);
  }
}

async function completeAttachmentUpload(request, response, next) {
  try {
    const reportReference = db.doc(`bugReports/${request.params.reportId}`);
    const attachmentReference = reportReference
      .collection("attachments")
      .doc(request.params.attachmentId);
    const [reportSnapshot, attachmentSnapshot] = await Promise.all([
      reportReference.get(),
      attachmentReference.get(),
    ]);

    if (!reportSnapshot.exists) throw httpError(404, "Bug report not found.");
    if (!attachmentSnapshot.exists) throw httpError(404, "Attachment upload not found.");

    const report = reportSnapshot.data();
    request.bugBefore = { ...report, id: reportSnapshot.id };
    request.bugOwner = report.reporter?.discordId;
    const attachment = attachmentSnapshot.data();
    await requireAttachmentAccess(request.authSession, report);

    if (attachment.status === "ready") {
      response.json({ attachment: serializeAttachmentDocument(attachmentSnapshot) });
      return;
    }
    if (attachment.status !== "pending") {
      throw httpError(409, "This attachment upload cannot be completed.");
    }
    if (attachmentIsExpired(attachment)) {
      await deleteAttachmentObject(attachment.objectKey, { ignoreMissing: true });
      await attachmentReference.delete();
      throw httpError(410, "The attachment upload expired. Select the file and try again.");
    }

    const object = await headAttachmentObject(attachment.objectKey);
    if (!object) {
      throw httpError(409, "R2 has not received this attachment yet.");
    }

    if (object.size !== attachment.declaredSize) {
      await deleteAttachmentObject(attachment.objectKey, { ignoreMissing: true });
      await attachmentReference.delete();
      throw httpError(400, "The uploaded file size does not match the requested attachment.");
    }
    if (object.contentType && object.contentType !== attachment.contentType) {
      await deleteAttachmentObject(attachment.objectKey, { ignoreMissing: true });
      await attachmentReference.delete();
      throw httpError(400, "The uploaded file type does not match the requested attachment.");
    }

    const actor = actorSnapshot(request.authSession);
    const completion = await db.runTransaction(async (transaction) => {
      const currentSnapshot = await transaction.get(attachmentReference);
      if (!currentSnapshot.exists) {
        throw httpError(404, "Attachment upload not found.");
      }

      const current = currentSnapshot.data();
      if (current.status === "ready") {
        return { created: false };
      }
      if (current.status !== "pending") {
        throw httpError(409, "This attachment upload cannot be completed.");
      }

      transaction.update(attachmentReference, {
        status: "ready",
        size: object.size,
        contentType: object.contentType ?? current.contentType,
        contentDisposition: object.contentDisposition ?? current.contentDisposition,
        etag: object.etag,
        uploadedAt: FieldValue.serverTimestamp(),
        uploadExpiresAt: null,
      });
      transaction.update(reportReference, {
        attachmentsCount: FieldValue.increment(1),
        updatedAt: FieldValue.serverTimestamp(),
      });
      await addActivity(transaction, reportReference, "attachment_added", actor, {
        attachmentId: attachmentReference.id,
        fileName: current.originalName,
        size: object.size,
        contentType: object.contentType ?? current.contentType,
      });

      return { created: true };
    });

    response.status(completion.created ? 201 : 200).json({
      attachment: serializeAttachmentDocument(await attachmentReference.get()),
    });
  } catch (error) {
    next(error);
  }
}

async function deleteAttachment(request, response, next) {
  try {
    const reportReference = db.doc(`bugReports/${request.params.reportId}`);
    const attachmentReference = reportReference
      .collection("attachments")
      .doc(request.params.attachmentId);
    const [reportSnapshot, attachmentSnapshot] = await Promise.all([
      reportReference.get(),
      attachmentReference.get(),
    ]);

    if (!reportSnapshot.exists) throw httpError(404, "Bug report not found.");
    if (!attachmentSnapshot.exists) throw httpError(404, "Attachment not found.");

    const report = reportSnapshot.data();
    request.bugBefore = { ...report, id: reportSnapshot.id };
    request.bugOwner = report.reporter?.discordId;
    const attachment = attachmentSnapshot.data();
    await requireAttachmentAccess(request.authSession, report);

    await deleteAttachmentObject(attachment.objectKey, { ignoreMissing: true });

    const batch = db.batch();
    batch.delete(attachmentReference);
    if (attachment.status === "ready") {
      batch.update(reportReference, {
        attachmentsCount: FieldValue.increment(-1),
        updatedAt: FieldValue.serverTimestamp(),
      });
      await addActivity(
        batch,
        reportReference,
        "attachment_removed",
        actorSnapshot(request.authSession),
        {
          attachmentId: attachmentReference.id,
          fileName: attachment.originalName,
        },
      );
    }
    await batch.commit();
    response.sendStatus(204);
  } catch (error) {
    next(error);
  }
}

async function deleteReport(request, response, next) {
  try {
    const reference = db.doc(`bugReports/${request.params.reportId}`);
    const report = await reference.get();
    if (!report.exists) {
      response.status(404).json({ error: "Bug report not found." });
      return;
    }
    if (report.data().duplicateOf || report.data().duplicateCount > 0) throw httpError(409, "Unlink duplicate relationships before deleting this report.");
    if ((await db.collection("updates").where("linkedReportIds", "array-contains", report.id).limit(1).get()).docs.length) throw httpError(409, "Unlink this report from its release notes before deleting it.");
    await removeReportAndStoredAttachments(reference);
    request.bugOwner = report.data().reporter?.discordId;
    request.bugBefore = { ...report.data(), id: report.id }; request.bugDeleted = true;
    await observeContribution(request, request.bugBefore, null);

    response.sendStatus(204);
  } catch (error) {
    next(error);
  }
}

export function createBugRouter({ onContribution, onChange } = {}) {
  const router = express.Router();
  const requireBugStaff = requireRole("qa", "pentester", "leadqa", "dev");
  router.use(requireAuth, requireBugStaff);
  for (const parameter of ['reportId', 'attachmentId']) router.param(parameter, (_req, res, next, value) => {
    if (typeof value !== 'string' || !/^[\w-]{1,150}$/.test(value)) { res.status(404).json({ error: 'Bug report resource not found.' }); return; }
    next();
  });
  router.use(rateLimit({ windowMs: 60_000, limit: 240, standardHeaders: "draft-8", legacyHeaders: false, keyGenerator: req => req.authUser.id, skip: req => !["GET", "HEAD"].includes(req.method) }));
  router.use((_request, response, next) => { response.setHeader('Cache-Control', 'private, no-store'); next(); });
  router.use((request, response, next) => {
    request.bugObservers = { onContribution, onChange };
    const send = response.json.bind(response);
    response.json = body => { if (body?.report) request.bugAfter = body.report; return send(body); };
    if (!['GET', 'HEAD'].includes(request.method)) response.on('finish', () => {
      if (response.statusCode < 400) {
        if (request.bugAfter || request.bugDeleted) bugQueries.notifyMutation(request.bugBefore ?? null, request.bugDeleted ? null : request.bugAfter);
        bugQueries.invalidate(); if (request.bugOwner) Promise.resolve(onChange?.(request.bugOwner)).catch(() => console.warn('Report summary cache invalidation failed.')); }
    });
    next();
  });

  router.get("/", listReports);
  router.put("/:reportId/duplicate", requireAuth, requireRole("leadqa", "dev"), requireCsrf, async (request, response) => response.json(await createDuplicateService(db, undefined, statusIsTerminal)(request.params.reportId, request.body?.targetId ?? null, actorSnapshot(request.authSession))));
  router.get("/export", rateLimit({ windowMs: 60_000, limit: 3, standardHeaders: "draft-8", legacyHeaders: false }), exportReports);
  router.get("/related", rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: "draft-8", legacyHeaders: false }), async (request, response) => response.json(await bugQueries.related(request.query)));
  router.get("/storage-config", requireAuth, requireBugStaff, getAttachmentStorageConfig);
  router.post("/", requireAuth, requireBugStaff, requireCsrf, createReport);
  router.post(
    "/:reportId/finalize",
    requireAuth,
    requireBugStaff,
    requireCsrf,
    finalizeReportSubmission,
  );
  router.delete(
    "/:reportId/cancel-submission",
    requireAuth,
    requireBugStaff,
    requireCsrf,
    cancelReportSubmission,
  );
  router.post(
    "/:reportId/attachments",
    requireAuth,
    requireBugStaff,
    requireCsrf,
    beginAttachmentUpload,
  );
  router.post(
    "/:reportId/attachments/:attachmentId/complete",
    requireAuth,
    requireBugStaff,
    requireCsrf,
    completeAttachmentUpload,
  );
  router.delete(
    "/:reportId/attachments/:attachmentId",
    requireAuth,
    requireBugStaff,
    requireCsrf,
    deleteAttachment,
  );
  router.get('/:reportId/sections/:section', getReportSection);
  router.get('/:reportId/attachments/:attachmentId/download', downloadAttachment);
  router.get("/:reportId", getReport);
  router.patch("/:reportId", requireAuth, requireBugStaff, requireCsrf, patchReport);
  router.delete(
    "/:reportId",
    requireAuth,
    requireExactRole("dev"),
    requireCsrf,
    deleteReport,
  );
  router.post(
    "/:reportId/approve",
    requireAuth,
    requireRole("leadqa", "dev"),
    requireCsrf,
    approveReport,
  );
  router.post(
    "/:reportId/reject",
    requireAuth,
    requireRole("leadqa", "dev"),
    requireCsrf,
    rejectReport,
  );
  router.post(
    "/:reportId/comments",
    requireAuth,
    requireBugStaff,
    requireCsrf,
    addComment,
  );
  router.post(
    "/:reportId/developer-notes",
    requireAuth,
    requireExactRole("dev"),
    requireCsrf,
    addDeveloperNote,
  );

  return router;
}
