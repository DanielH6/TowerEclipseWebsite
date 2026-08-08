import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "../router";
import {
  addBugComment,
  addDeveloperNote,
  approveBug,
  deleteBug,
  deleteBugAttachment,
  loadBug,
  loadDictionaries,
  rejectBug,
  updateBug,
  uploadBugAttachment,
} from "../api";
import { useAuth } from "../AuthContext";
import RoleBadge from "../Components/RoleBadge";
import UserAvatar from "../Components/UserAvatar";
import { isBugStaff } from "../roles";
import { synchronizeReportDictionaries } from "../dictionary-sync";
import {
  attachmentAccept,
  extractClipboardImageFiles,
  formatFileSize,
  mergeSelectedFiles,
} from "../attachments";
import type {
  ActorSnapshot,
  BugAttachment,
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
        <span className="actor-name-line">
          <strong>{actor.displayName}</strong>
          <RoleBadge role={actor.role} />
        </span>
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
  const { auth, loading: authLoading } = useAuth();
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
  const [attachmentFiles, setAttachmentFiles] = useState<File[]>([]);
  const [viewerAttachment, setViewerAttachment] = useState<BugAttachment | null>(null);
  const [uploadMessage, setUploadMessage] = useState<string | null>(null);
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
    void refresh().catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : "Could not load the bug report.");
    });
  }, [reportId]);

  useEffect(() => {
    if (!viewerAttachment) return undefined;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setViewerAttachment(null);
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [viewerAttachment]);

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

  if (!details || !dictionaries || !reportId) {
    return <section className="workspace-page"><div className="table-message">Loading report…</div></section>;
  }

  const { report } = details;
  const role = auth?.user.role;
  const csrfToken = auth?.csrfToken ?? "";
  const isStaff = isBugStaff(role);
  const isApprovalStaff = role === "leadqa" || role === "dev";
  const canSeeDeveloperNotes = isApprovalStaff;
  const currentStatusEntry = dictionaries.statuses.find((entry) => entry.id === report.status.id);
  const reportIsTerminal = report.status.terminal === true || currentStatusEntry?.terminal === true;
  const canReopenTerminalReport = role === "dev";
  const leadQaTerminalReadOnly = role === "leadqa" && reportIsTerminal;
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
            <p>
              Submitted by {report.reporter.displayName}{" "}
              <RoleBadge role={report.reporter.role} /> on {formatDate(report.submittedAt)}.
            </p>
          </div>
        </div>
        <div className="workspace-header-actions">
          <button
            className="ghost-link"
            type="button"
            disabled={working}
            onClick={() => {
              void refresh().catch((reason: unknown) => {
                setError(reason instanceof Error ? reason.message : "Could not refresh the report.");
              });
            }}
          >
            REFRESH
          </button>
          <Link className="ghost-link" to="/bugs">BACK TO REPORTS</Link>
        </div>
      </div>

      {error && <div className="workspace-error" role="alert">{error}</div>}
      {!authLoading && !isStaff && (
        <div className="read-only-notice" role="status">
          {role === "member"
            ? "Members can view bug reports, comments, attachments, and activity in read-only mode."
            : <>You are viewing this report in read-only mode. <Link to="/login">Log in with Discord</Link> to access your account.</>}
        </div>
      )}

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
                  }, csrfToken),
                  (updatedReport) => {
                    setDetails((current) =>
                      current ? { ...current, report: updatedReport } : current
                    );
                    if (role === "leadqa" && updatedReport.status.terminal === true) {
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
                      () => approveBug(reportId, approvalComment, csrfToken),
                      (updatedReport) => setDetails((current) =>
                        current ? { ...current, report: updatedReport } : current
                      ),
                    )}
                  >APPROVE</button>
                  <button
                    className="danger-action"
                    disabled={working}
                    onClick={() => perform(
                      () => rejectBug(reportId, approvalComment, csrfToken),
                      (updatedReport) => setDetails((current) =>
                        current ? { ...current, report: updatedReport } : current
                      ),
                    )}
                  >REJECT</button>
                </div>
              </>
            )}
          </article>

          {role === "dev" && (
            <article className="panel-card danger-zone">
              <h3>DEVELOPER ACTIONS</h3>
              <button
                className="danger-action"
                disabled={working}
                onClick={async () => {
                  if (!window.confirm(`Delete ${report.displayId} and all of its comments, notes, and history?`)) return;
                  setWorking(true);
                  try {
                    await deleteBug(reportId, csrfToken);
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

      <article
        className="panel-card attachments-panel attachment-paste-zone"
        tabIndex={canEdit && details.attachmentPolicy.enabled ? 0 : -1}
        aria-label="Bug report image attachments. Click this area and paste an image with Control V."
        onClick={(event) => {
          if (event.target === event.currentTarget) event.currentTarget.focus();
        }}
        onPaste={(event) => {
          if (!canEdit || !details.attachmentPolicy.enabled || working) return;
          const pasted = extractClipboardImageFiles(event.clipboardData);
          if (pasted.length === 0) return;
          event.preventDefault();
          try {
            const nextFiles = mergeSelectedFiles(
              attachmentFiles,
              pasted,
              details.attachmentPolicy,
              details.attachments.length,
            );
            setAttachmentFiles(nextFiles);
            setError(null);
          } catch (reason) {
            setError(reason instanceof Error ? reason.message : "Could not paste that image.");
          }
        }}
      >
        <div className="attachment-section-heading">
          <div>
            <h3>ATTACHMENTS ({details.attachments.length})</h3>
            {details.attachmentPolicy.enabled ? (
              <small>
                PNG, JPG, or JPEG only. Up to {details.attachmentPolicy.maxFilesPerReport} images, {formatFileSize(details.attachmentPolicy.maxFileSizeBytes)} each. Click this area and press Ctrl+V to paste an image.
              </small>
            ) : (
              <small>R2 image storage is not configured on the API.</small>
            )}
          </div>

          {canEdit && details.attachmentPolicy.enabled && (
            <label className="attachment-select-button">
              ADD IMAGES
              <input
                type="file"
                multiple
                disabled={working}
                accept={attachmentAccept(details.attachmentPolicy)}
                onChange={(event) => {
                  const selected = Array.from(event.target.files ?? []);
                  event.target.value = "";
                  try {
                    const nextFiles = mergeSelectedFiles(
                      attachmentFiles,
                      selected,
                      details.attachmentPolicy,
                      details.attachments.length,
                    );
                    setAttachmentFiles(nextFiles);
                    setError(null);
                  } catch (reason) {
                    setError(reason instanceof Error ? reason.message : "Could not select those images.");
                  }
                }}
              />
            </label>
          )}
        </div>

        {details.attachments.length === 0 && (
          <p className="empty-copy">No images have been attached.</p>
        )}

        {details.attachments.length > 0 && (
          <div className="attachment-grid">
            {details.attachments.map((attachment) => (
              <article className="attachment-card" key={attachment.id}>
                <button
                  type="button"
                  className="attachment-preview attachment-preview-button"
                  disabled={!attachment.downloadUrl}
                  onClick={() => setViewerAttachment(attachment)}
                  aria-label={`Enlarge ${attachment.originalName}`}
                >
                  {attachment.previewKind === "image" && attachment.downloadUrl ? (
                    <>
                      <img src={attachment.downloadUrl} alt={attachment.originalName} loading="lazy" />
                      <span className="attachment-preview-hint">CLICK TO ENLARGE</span>
                    </>
                  ) : (
                    <span className="attachment-file-mark">IMAGE</span>
                  )}
                </button>
                <div className="attachment-card-copy">
                  <strong title={attachment.originalName}>{attachment.originalName}</strong>
                  <small>{formatFileSize(attachment.size)} · {attachment.contentType}</small>
                  <small className="attachment-uploader">
                    Uploaded by {attachment.uploader.displayName}{" "}
                    <RoleBadge role={attachment.uploader.role} /> on{" "}
                    {formatDate(attachment.uploadedAt || attachment.createdAt)}
                  </small>
                </div>
                <div className="attachment-card-actions">
                  {attachment.downloadUrl ? (
                    <a className="ghost-link" href={attachment.downloadUrl} target="_blank" rel="noreferrer">
                      OPEN
                    </a>
                  ) : (
                    <span className="attachment-expired">Refresh to renew link</span>
                  )}
                  {canEdit && (
                    <button
                      type="button"
                      className="danger-action"
                      disabled={working}
                      onClick={() => {
                        if (!window.confirm(`Remove ${attachment.originalName}?`)) return;
                        perform(
                          () => deleteBugAttachment(reportId, attachment.id, csrfToken),
                          () => setDetails((current) => current ? {
                            ...current,
                            attachments: current.attachments.filter((item) => item.id !== attachment.id),
                            report: {
                              ...current.report,
                              attachmentsCount: Math.max(0, current.report.attachmentsCount - 1),
                            },
                          } : current),
                        );
                      }}
                    >
                      REMOVE
                    </button>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}

        {canEdit && details.attachmentPolicy.enabled && attachmentFiles.length > 0 && (
          <div className="attachment-upload-queue">
            <div className="selected-attachment-list">
              {attachmentFiles.map((file, index) => (
                <div className="selected-attachment" key={`${file.name}-${file.size}-${file.lastModified}`}>
                  <div>
                    <strong>{file.name}</strong>
                    <small>{formatFileSize(file.size)}</small>
                  </div>
                  <button
                    type="button"
                    disabled={working}
                    onClick={() => setAttachmentFiles((current) => current.filter((_, fileIndex) => fileIndex !== index))}
                  >
                    REMOVE
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              className="primary-action"
              disabled={working}
              onClick={async () => {
                setWorking(true);
                setError(null);
                try {
                  const uploaded: BugAttachment[] = [];
                  for (let index = 0; index < attachmentFiles.length; index += 1) {
                    const file = attachmentFiles[index];
                    if (!file) continue;
                    setUploadMessage(`Uploading image ${index + 1} of ${attachmentFiles.length}: ${file.name}`);
                    uploaded.push(await uploadBugAttachment(reportId, file, csrfToken));
                  }
                  setAttachmentFiles([]);
                  setDetails((current) => current ? {
                    ...current,
                    attachments: [...current.attachments, ...uploaded],
                    report: {
                      ...current.report,
                      attachmentsCount: current.report.attachmentsCount + uploaded.length,
                    },
                  } : current);
                  setWorking(false);
                  setUploadMessage(null);
                  void refresh().catch((reason: unknown) => {
                    setError(reason instanceof Error ? reason.message : "Could not refresh attachments.");
                  });
                } catch (reason) {
                  setError(reason instanceof Error ? reason.message : "Could not upload the images.");
                  setWorking(false);
                  setUploadMessage(null);
                }
              }}
            >
              UPLOAD {attachmentFiles.length} {attachmentFiles.length === 1 ? "IMAGE" : "IMAGES"}
            </button>
          </div>
        )}

        {uploadMessage && <div className="upload-status" role="status">{uploadMessage}</div>}
      </article>

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
          {isStaff && (
            <form
              className="message-form"
              onSubmit={(event) => {
                event.preventDefault();
                if (!commentBody.trim()) return;
                perform(
                  () => addBugComment(reportId, commentBody, csrfToken),
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
          )}
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
            {role === "dev" && (
              <form
                className="message-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!developerNoteBody.trim()) return;
                  perform(
                    () => addDeveloperNote(reportId, developerNoteBody, csrfToken),
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

      {viewerAttachment?.downloadUrl && (
        <div
          className="attachment-viewer-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setViewerAttachment(null);
          }}
        >
          <section
            className="attachment-viewer"
            role="dialog"
            aria-modal="true"
            aria-label={`Attachment viewer: ${viewerAttachment.originalName}`}
          >
            <div className="attachment-viewer-toolbar">
              <div>
                <strong>{viewerAttachment.originalName}</strong>
                <small>{formatFileSize(viewerAttachment.size)}</small>
              </div>
              <div className="attachment-viewer-actions">
                <a
                  className="ghost-link"
                  href={viewerAttachment.downloadUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  OPEN ORIGINAL
                </a>
                <button
                  type="button"
                  className="attachment-viewer-close"
                  onClick={() => setViewerAttachment(null)}
                  aria-label="Close attachment viewer"
                >
                  CLOSE
                </button>
              </div>
            </div>
            <div className="attachment-viewer-canvas">
              <img src={viewerAttachment.downloadUrl} alt={viewerAttachment.originalName} />
            </div>
          </section>
        </div>
      )}
    </section>
  );
}
