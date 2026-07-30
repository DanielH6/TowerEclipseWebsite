import express from "express";
import { FieldValue, Timestamp, db } from "./firebase.mjs";
import { actorSnapshot, requireAuth, requireCsrf, requireExactRole, requireRole } from "./auth-context.mjs";
import { dictionarySnapshot, getDictionaryEntry } from "./dictionaries.mjs";
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

  return session.role === "qa"
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
      ? createAttachmentDownloadUrl(objectKey)
      : null,
  };
}

async function hydrateReportDictionaries(reports) {
  const referencesByKey = new Map();

  for (const report of reports) {
    for (const [field, dictionary] of Object.entries(REPORT_DICTIONARIES)) {
      const entryId = report[field]?.id;
      if (!entryId) continue;

      const key = `${dictionary}/${entryId}`;
      if (!referencesByKey.has(key)) {
        referencesByKey.set(
          key,
          db.doc(`dictionaries/${dictionary}/items/${entryId}`),
        );
      }
    }
  }

  if (referencesByKey.size === 0) return reports;

  const referenceEntries = [...referencesByKey.entries()];
  const snapshots = await db.getAll(
    ...referenceEntries.map(([, reference]) => reference),
  );
  const currentEntries = new Map();

  snapshots.forEach((snapshot, index) => {
    if (!snapshot.exists) return;
    const [key] = referenceEntries[index];
    currentEntries.set(
      key,
      dictionarySnapshot({ id: snapshot.id, ...snapshot.data() }),
    );
  });

  return reports.map((report) => {
    const hydrated = { ...report };

    for (const [field, dictionary] of Object.entries(REPORT_DICTIONARIES)) {
      const savedValue = report[field];
      if (!savedValue?.id) continue;

      const currentValue = currentEntries.get(`${dictionary}/${savedValue.id}`);
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

async function addActivity(transactionOrBatch, reportReference, action, actor, details = {}) {
  const reference = reportReference.collection("activity").doc();
  transactionOrBatch.set(reference, {
    action,
    actor,
    details,
    createdAt: FieldValue.serverTimestamp(),
  });
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
    response.status(201).json({ report: await serializeReportDocument(created) });
  } catch (error) {
    next(error);
  }
}

async function listReports(request, response, next) {
  try {
    const snapshot = await db.collection("bugReports").orderBy("createdAt", "desc").limit(250).get();
    let reports = await serializeReportDocuments(snapshot.docs);

    const search = typeof request.query.search === "string" ? request.query.search.trim().toLowerCase() : "";
    const filters = {
      status: typeof request.query.status === "string" ? request.query.status : "",
      version: typeof request.query.version === "string" ? request.query.version : "",
      priority: typeof request.query.priority === "string" ? request.query.priority : "",
      category: typeof request.query.category === "string" ? request.query.category : "",
      type: typeof request.query.type === "string" ? request.query.type : "",
      device: typeof request.query.device === "string" ? request.query.device : "",
    };

    reports = reports.filter((report) => {
      if (!reportIsSubmitted(report)) return false;

      if (search) {
        const haystack = [
          report.displayId,
          report.description,
          report.reporter?.displayName,
          report.reporter?.username,
        ].filter(Boolean).join(" ").toLowerCase();
        if (!haystack.includes(search)) return false;
      }

      return Object.entries(filters).every(([field, code]) => !code || report[field]?.code === code);
    });

    response.json({ reports });
  } catch (error) {
    next(error);
  }
}

async function getReport(request, response, next) {
  try {
    const reference = db.doc(`bugReports/${request.params.reportId}`);
    const [report, comments, activity, attachmentSnapshot] = await Promise.all([
      reference.get(),
      reference.collection("comments").orderBy("createdAt", "asc").limit(300).get(),
      reference.collection("activity").orderBy("createdAt", "desc").limit(300).get(),
      reference.collection("attachments").orderBy("createdAt", "asc").limit(100).get(),
    ]);

    if (!report.exists) {
      response.status(404).json({ error: "Bug report not found." });
      return;
    }

    const reportData = report.data();
    if (
      !reportIsSubmitted(reportData)
      && request.authSession.role !== "dev"
      && reportData.reporter?.discordId !== request.authSession.discordUser.id
    ) {
      response.status(404).json({ error: "Bug report not found." });
      return;
    }

    let developerNotes = [];
    if (request.authSession.role === "dev" || request.authSession.role === "leadqa") {
      const notes = await reference.collection("developerNotes").orderBy("createdAt", "asc").limit(300).get();
      developerNotes = notes.docs.map(serializeDocument);
    }

    const attachments = attachmentSnapshot.docs
      .filter((document) => document.data().status === "ready")
      .map(serializeAttachmentDocument);

    response.json({
      report: await serializeReportDocument(report),
      comments: comments.docs.map(serializeDocument),
      developerNotes,
      attachments,
      attachmentPolicy: attachmentStoragePolicy(),
      activity: activity.docs.map(serializeDocument),
    });
  } catch (error) {
    next(error);
  }
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
    requireSubmittedReport(current);
    const body = request.body ?? {};
    const session = request.authSession;
    const isQaOwner = session.role === "qa" && current.reporter?.discordId === session.discordUser.id;
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

    const changes = {};
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
        ...(reopensTerminalReport
          ? {
              previousStatus: current.status,
              newStatus: changes.status,
            }
          : {}),
      },
    );
    await batch.commit();

    response.json({ report: await serializeReportDocument(await reference.get()) });
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
    await addActivity(batch, reference, "report_approved", actor, { comment });
    await batch.commit();
    response.json({ report: await serializeReportDocument(await reference.get()) });
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
    await addActivity(batch, reference, "report_rejected", actor, { comment });
    await batch.commit();
    response.json({ report: await serializeReportDocument(await reference.get()) });
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
    await addActivity(batch, reportReference, "comment_added", actorSnapshot(request.authSession));
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

    response.json({ report: await serializeReportDocument(await reference.get()) });
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
    await removeReportAndStoredAttachments(reference);
    response.sendStatus(204);
  } catch (error) {
    next(error);
  }
}

export function createBugRouter() {
  const router = express.Router();
  router.use(requireAuth);

  router.get("/storage-config", getAttachmentStorageConfig);
  router.get("/", listReports);
  router.post("/", requireCsrf, createReport);
  router.post("/:reportId/finalize", requireCsrf, finalizeReportSubmission);
  router.delete("/:reportId/cancel-submission", requireCsrf, cancelReportSubmission);
  router.post("/:reportId/attachments", requireCsrf, beginAttachmentUpload);
  router.post(
    "/:reportId/attachments/:attachmentId/complete",
    requireCsrf,
    completeAttachmentUpload,
  );
  router.delete(
    "/:reportId/attachments/:attachmentId",
    requireCsrf,
    deleteAttachment,
  );
  router.get("/:reportId", getReport);
  router.patch("/:reportId", requireCsrf, patchReport);
  router.delete("/:reportId", requireCsrf, requireExactRole("dev"), deleteReport);
  router.post("/:reportId/approve", requireCsrf, requireRole("leadqa", "dev"), approveReport);
  router.post("/:reportId/reject", requireCsrf, requireRole("leadqa", "dev"), rejectReport);
  router.post("/:reportId/comments", requireCsrf, addComment);
  router.post("/:reportId/developer-notes", requireCsrf, requireExactRole("dev"), addDeveloperNote);

  return router;
}
