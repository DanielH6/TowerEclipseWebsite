import express from "express";
import { FieldValue, Timestamp, db } from "./firebase.mjs";
import { actorSnapshot, requireAuth, requireCsrf, requireExactRole, requireRole } from "./auth-context.mjs";
import { dictionarySnapshot, getDictionaryEntry } from "./dictionaries.mjs";

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

async function statusIsTerminal(status) {
  if (!status?.id) return false;
  if (typeof status.terminal === "boolean") return status.terminal;

  const entry = await getDictionaryEntry("statuses", status.id, { activeOnly: false });
  return entry.terminal === true;
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
  return hydrateReportDictionaries(documents.map(serializeDocument));
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
        submittedAt: FieldValue.serverTimestamp(),
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
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      await addActivity(transaction, reportReference, "report_created", actor, { displayId });
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
    const [report, comments, activity] = await Promise.all([
      reference.get(),
      reference.collection("comments").orderBy("createdAt", "asc").limit(300).get(),
      reference.collection("activity").orderBy("createdAt", "desc").limit(300).get(),
    ]);

    if (!report.exists) {
      response.status(404).json({ error: "Bug report not found." });
      return;
    }

    let developerNotes = [];
    if (request.authSession.role === "dev" || request.authSession.role === "leadqa") {
      const notes = await reference.collection("developerNotes").orderBy("createdAt", "asc").limit(300).get();
      developerNotes = notes.docs.map(serializeDocument);
    }

    response.json({
      report: await serializeReportDocument(report),
      comments: comments.docs.map(serializeDocument),
      developerNotes,
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

async function deleteReport(request, response, next) {
  try {
    const reference = db.doc(`bugReports/${request.params.reportId}`);
    const report = await reference.get();
    if (!report.exists) {
      response.status(404).json({ error: "Bug report not found." });
      return;
    }
    await db.recursiveDelete(reference);
    response.sendStatus(204);
  } catch (error) {
    next(error);
  }
}

export function createBugRouter() {
  const router = express.Router();
  router.use(requireAuth);

  router.get("/", listReports);
  router.post("/", requireCsrf, createReport);
  router.get("/:reportId", getReport);
  router.patch("/:reportId", requireCsrf, patchReport);
  router.delete("/:reportId", requireCsrf, requireExactRole("dev"), deleteReport);
  router.post("/:reportId/approve", requireCsrf, requireRole("leadqa", "dev"), approveReport);
  router.post("/:reportId/reject", requireCsrf, requireRole("leadqa", "dev"), rejectReport);
  router.post("/:reportId/comments", requireCsrf, addComment);
  router.post("/:reportId/developer-notes", requireCsrf, requireExactRole("dev"), addDeveloperNote);

  return router;
}
