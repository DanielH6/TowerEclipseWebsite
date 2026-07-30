import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "../router";
import {
  addBugComment,
  addDeveloperNote,
  approveBug,
  deleteBug,
  loadBug,
  loadDictionaries,
  rejectBug,
  updateBug,
} from "../api";
import { useAuth } from "../AuthContext";
import UserAvatar from "../Components/UserAvatar";
import { synchronizeReportDictionaries } from "../dictionary-sync";
import type {
  ActorSnapshot,
  BugDetailsResponse,
  Dictionaries,
  DictionaryEntry,
  DictionaryName,
  DictionarySnapshot,
} from "../types";
import "./Bugs.css";

function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function Badge({ value }: { value: DictionarySnapshot }) {
  return (
    <span
      className="dictionary-badge"
      style={value.color ? { borderColor: value.color, color: value.color } : undefined}
    >
      {value.label}
    </span>
  );
}

function ActorIdentity({ actor, size = 32 }: { actor: ActorSnapshot; size?: number }) {
  return (
    <span className="actor-identity">
      <UserAvatar avatarUrl={actor.avatarUrl} displayName={actor.displayName} size={size} />
      <span className="actor-identity-copy">
        <strong>{actor.displayName}</strong>
        <small>@{actor.username}</small>
      </span>
    </span>
  );
}

function DetailSelect({
  label,
  dictionary,
  value,
  dictionaries,
  onChange,
  disabled,
  isOptionDisabled,
}: {
  label: string;
  dictionary: DictionaryName;
  value: string;
  dictionaries: Dictionaries;
  onChange: (value: string) => void;
  disabled: boolean;
  isOptionDisabled?: (entry: DictionaryEntry) => boolean;
}) {
  return (
    <label className="editor-field">
      <span>{label}</span>
      <select disabled={disabled} value={value} onChange={(event) => onChange(event.target.value)}>
        {dictionaries[dictionary].map((entry) => (
          <option
            value={entry.id}
            key={entry.id}
            disabled={isOptionDisabled?.(entry) ?? false}
          >
            {entry.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export default function BugDetailsPage() {
  const { reportId } = useParams();
  const { auth } = useAuth();
  const navigate = useNavigate();
  const [details, setDetails] = useState<BugDetailsResponse | null>(null);
  const [dictionaries, setDictionaries] = useState<Dictionaries | null>(null);
  const [description, setDescription] = useState("");
  const [versionId, setVersionId] = useState("");
  const [priorityId, setPriorityId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [typeId, setTypeId] = useState("");
  const [deviceId, setDeviceId] = useState("");
  const [statusId, setStatusId] = useState("");
  const [commentBody, setCommentBody] = useState("");
  const [developerNoteBody, setDeveloperNoteBody] = useState("");
  const [approvalComment, setApprovalComment] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    if (!reportId) return;
    setError(null);
    const [loadedDetails, loadedDictionaries] = await Promise.all([
      loadBug(reportId),
      loadDictionaries(),
    ]);
    const dictionaryFields: Array<[keyof Dictionaries, DictionarySnapshot]> = [
      ["statuses", loadedDetails.report.status],
      ["versions", loadedDetails.report.version],
      ["priorities", loadedDetails.report.priority],
      ["categories", loadedDetails.report.category],
      ["types", loadedDetails.report.type],
      ["devices", loadedDetails.report.device],
    ];
    const mergedDictionaries = { ...loadedDictionaries };
    for (const [name, snapshot] of dictionaryFields) {
      if (!mergedDictionaries[name].some((entry) => entry.id === snapshot.id)) {
        mergedDictionaries[name] = [
          ...mergedDictionaries[name],
          {
            ...snapshot,
            description: "Archived value",
            sortOrder: 100000,
            active: false,
          },
        ];
      }
    }

    const synchronizedReport = synchronizeReportDictionaries(
      loadedDetails.report,
      mergedDictionaries,
    );

    setDetails({ ...loadedDetails, report: synchronizedReport });
    setDictionaries(mergedDictionaries);
    setDescription(synchronizedReport.description);
    setVersionId(synchronizedReport.version.id);
    setPriorityId(synchronizedReport.priority.id);
    setCategoryId(synchronizedReport.category.id);
    setTypeId(synchronizedReport.type.id);
    setDeviceId(synchronizedReport.device.id);
    setStatusId(synchronizedReport.status.id);
  }

  useEffect(() => {
    const refreshCurrentReport = () => {
      void refresh().catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : "Could not load the bug report.");
      });
    };

    refreshCurrentReport();
    window.addEventListener("focus", refreshCurrentReport);
    return () => window.removeEventListener("focus", refreshCurrentReport);
  }, [reportId]);

  const canEdit = useMemo(() => {
    if (!auth || !details) return false;
    if (auth.user.role === "dev") return true;
    if (auth.user.role === "leadqa") {
      return details.report.status.terminal !== true;
    }
    return auth.user.role === "qa" &&
      details.report.reporter.discordId === auth.user.id &&
      details.report.approval.state === "pending";
  }, [auth, details]);

  if (error && !details) {
    return <section className="workspace-page"><div className="workspace-error">{error}</div></section>;
  }

  if (!details || !dictionaries || !auth || !reportId) {
    return <section className="workspace-page"><div className="table-message">Loading report…</div></section>;
  }

  const { report } = details;
  const isApprovalStaff = auth.user.role === "leadqa" || auth.user.role === "dev";
  const canSeeDeveloperNotes = isApprovalStaff;
  const currentStatusEntry = dictionaries.statuses.find((entry) => entry.id === report.status.id);
  const reportIsTerminal = report.status.terminal === true || currentStatusEntry?.terminal === true;
  const canReopenTerminalReport = auth.user.role === "dev";
  const leadQaTerminalReadOnly = auth.user.role === "leadqa" && reportIsTerminal;
  const canManageApproval = isApprovalStaff && !leadQaTerminalReadOnly;

  async function perform<T>(
    action: () => Promise<T>,
    applyResult?: (result: T) => void,
  ) {
    setWorking(true);
    setError(null);
    try {
      const result = await action();
      applyResult?.(result);

      setWorking(false);
      void refresh().catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : "Could not refresh the report.");
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The operation failed.");
      setWorking(false);
    }
  }

  return (
    <section className="workspace-page report-details-page">
      <div className="workspace-header">
        <div>
          <p className="workspace-kicker">{report.displayId}</p>
          <h2>BUG REPORT DETAILS</h2>
          <div className="report-submitter">
            <UserAvatar avatarUrl={report.reporter.avatarUrl} displayName={report.reporter.displayName} size={42} />
            <p>Submitted by {report.reporter.displayName} on {formatDate(report.submittedAt)}.</p>
          </div>
        </div>
        <Link className="ghost-link" to="/bugs">BACK TO REPORTS</Link>
      </div>

      {error && <div className="workspace-error" role="alert">{error}</div>}

      <div className="details-layout">
        <article className="details-main panel-card">
          <div className="details-summary">
            <div><span>Status</span><Badge value={report.status} /></div>
            <div><span>Priority</span><Badge value={report.priority} /></div>
            <div><span>Approval</span><strong>{report.approval.state}</strong></div>
            <div><span>Reporter</span><ActorIdentity actor={report.reporter} /></div>
          </div>

          <div className="editor-grid">
            <DetailSelect label="Version" dictionary="versions" value={versionId} dictionaries={dictionaries} onChange={setVersionId} disabled={!canEdit} />
            <DetailSelect label="Priority" dictionary="priorities" value={priorityId} dictionaries={dictionaries} onChange={setPriorityId} disabled={!canEdit} />
            <DetailSelect label="Category" dictionary="categories" value={categoryId} dictionaries={dictionaries} onChange={setCategoryId} disabled={!canEdit} />
            <DetailSelect label="Type" dictionary="types" value={typeId} dictionaries={dictionaries} onChange={setTypeId} disabled={!canEdit} />
            <DetailSelect label="Device" dictionary="devices" value={deviceId} dictionaries={dictionaries} onChange={setDeviceId} disabled={!canEdit} />
            {isApprovalStaff && (
              <DetailSelect
                label="Status"
                dictionary="statuses"
                value={statusId}
                dictionaries={dictionaries}
                onChange={setStatusId}
                disabled={!canEdit}
                isOptionDisabled={(entry) =>
                  reportIsTerminal && !canReopenTerminalReport && entry.terminal !== true
                }
              />
            )}
          </div>

          {leadQaTerminalReadOnly ? (
            <p className="permission-note" role="status">
              This report is terminal. QA leads can only add comments; all report fields and approval actions are locked.
            </p>
          ) : reportIsTerminal && !canReopenTerminalReport ? (
            <p className="permission-note">Only developers can reopen terminal bug reports.</p>
          ) : null}

          <label className="editor-field editor-description">
            <span>Description</span>
            <textarea value={description} disabled={!canEdit} onChange={(event) => setDescription(event.target.value)} />
          </label>

          {canEdit && (
            <div className="editor-actions">
              <button
                type="button"
                className="primary-action"
                disabled={working}
                onClick={() => perform(
                  () => updateBug(reportId, {
                    description,
                    versionId,
                    priorityId,
                    categoryId,
                    typeId,
                    deviceId,
                    ...(isApprovalStaff ? { statusId } : {}),
                  }, auth.csrfToken),
                  (updatedReport) => {
                    setDetails((current) =>
                      current ? { ...current, report: updatedReport } : current
                    );
                    if (auth.user.role === "leadqa" && updatedReport.status.terminal === true) {
                      window.requestAnimationFrame(() => {
                        document.getElementById("bug-comments")?.scrollIntoView({
                          behavior: "smooth",
                          block: "start",
                        });
                      });
                    }
                  },
                )}
              >
                SAVE CHANGES
              </button>
            </div>
          )}
        </article>

        <aside className="details-sidebar">
          <article className="panel-card approval-card">
            <h3>APPROVAL</h3>
            <dl>
              <div><dt>State</dt><dd>{report.approval.state}</dd></div>
              <div><dt>Approved by</dt><dd>{report.approval.approvedBy ? <ActorIdentity actor={report.approval.approvedBy} size={28} /> : "—"}</dd></div>
              <div><dt>Approved at</dt><dd>{formatDate(report.approval.approvedAt)}</dd></div>
              <div><dt>Rejected by</dt><dd>{report.approval.rejectedBy ? <ActorIdentity actor={report.approval.rejectedBy} size={28} /> : "—"}</dd></div>
              <div><dt>Rejected at</dt><dd>{formatDate(report.approval.rejectedAt)}</dd></div>
            </dl>
            {report.approval.comment && <p className="approval-comment">{report.approval.comment}</p>}

            {canManageApproval && report.approval.state === "pending" && (
              <>
                <textarea
                  className="compact-textarea"
                  placeholder="Optional approval comment; required for rejection"
                  value={approvalComment}
                  onChange={(event) => setApprovalComment(event.target.value)}
                />
                <div className="stacked-actions">
                  <button
                    disabled={working}
                    onClick={() => perform(
                      () => approveBug(reportId, approvalComment, auth.csrfToken),
                      (updatedReport) => setDetails((current) =>
                        current ? { ...current, report: updatedReport } : current
                      ),
                    )}
                  >APPROVE</button>
                  <button
                    className="danger-action"
                    disabled={working}
                    onClick={() => perform(
                      () => rejectBug(reportId, approvalComment, auth.csrfToken),
                      (updatedReport) => setDetails((current) =>
                        current ? { ...current, report: updatedReport } : current
                      ),
                    )}
                  >REJECT</button>
                </div>
              </>
            )}
          </article>

          {auth.user.role === "dev" && (
            <article className="panel-card danger-zone">
              <h3>DEVELOPER ACTIONS</h3>
              <button
                className="danger-action"
                disabled={working}
                onClick={async () => {
                  if (!window.confirm(`Delete ${report.displayId} and all of its comments, notes, and history?`)) return;
                  setWorking(true);
                  try {
                    await deleteBug(reportId, auth.csrfToken);
                    navigate("/bugs");
                  } catch (reason) {
                    setError(reason instanceof Error ? reason.message : "Could not delete the report.");
                    setWorking(false);
                  }
                }}
              >
                DELETE REPORT
              </button>
            </article>
          )}
        </aside>
      </div>

      <div className="discussion-grid">
        <article className="panel-card discussion-panel" id="bug-comments">
          <h3>COMMENTS ({details.comments.length})</h3>
          <div className="message-list">
            {details.comments.length === 0 && <p className="empty-copy">No comments yet.</p>}
            {details.comments.map((comment) => (
              <article className="message-item" key={comment.id}>
                <div className="message-heading">
                  <ActorIdentity actor={comment.author} size={34} />
                  <span>{formatDate(comment.createdAt)}</span>
                </div>
                <p>{comment.body}</p>
              </article>
            ))}
          </div>
          <form
            className="message-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (!commentBody.trim()) return;
              perform(
                () => addBugComment(reportId, commentBody, auth.csrfToken),
                (comment) => {
                  setCommentBody("");
                  setDetails((current) => current ? {
                    ...current,
                    comments: [...current.comments, comment],
                    report: {
                      ...current.report,
                      commentsCount: current.report.commentsCount + 1,
                    },
                  } : current);
                },
              );
            }}
          >
            <textarea value={commentBody} onChange={(event) => setCommentBody(event.target.value)} placeholder="Add a comment" />
            <button disabled={working}>ADD COMMENT</button>
          </form>
        </article>

        {canSeeDeveloperNotes && (
          <article className="panel-card discussion-panel developer-notes-panel">
            <h3>DEVELOPER NOTES ({details.developerNotes.length})</h3>
            <div className="message-list">
              {details.developerNotes.length === 0 && <p className="empty-copy">No developer notes yet.</p>}
              {details.developerNotes.map((note) => (
                <article className="message-item" key={note.id}>
                  <div className="message-heading">
                    <ActorIdentity actor={note.author} size={34} />
                    <span>{formatDate(note.createdAt)}</span>
                  </div>
                  <p>{note.body}</p>
                </article>
              ))}
            </div>
            {auth.user.role === "dev" && (
              <form
                className="message-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!developerNoteBody.trim()) return;
                  perform(
                    () => addDeveloperNote(reportId, developerNoteBody, auth.csrfToken),
                    (note) => {
                      setDeveloperNoteBody("");
                      setDetails((current) => current ? {
                        ...current,
                        developerNotes: [...current.developerNotes, note],
                        report: {
                          ...current.report,
                          developerNotesCount: current.report.developerNotesCount + 1,
                        },
                      } : current);
                    },
                  );
                }}
              >
                <textarea value={developerNoteBody} onChange={(event) => setDeveloperNoteBody(event.target.value)} placeholder="Add a private developer note" />
                <button disabled={working}>ADD DEVELOPER NOTE</button>
              </form>
            )}
          </article>
        )}
      </div>

      <article className="panel-card activity-panel">
        <h3>ACTIVITY</h3>
        <div className="activity-list">
          {details.activity.map((event) => (
            <div className="activity-item" key={event.id}>
              <span>{formatDate(event.createdAt)}</span>
              <ActorIdentity actor={event.actor} size={30} />
              <code>{event.action}</code>
            </div>
          ))}
        </div>
      </article>
    </section>
  );
}
