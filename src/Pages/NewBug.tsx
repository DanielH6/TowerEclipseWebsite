import { useEffect, useState } from "react";
import { Link, useNavigate } from "../router";
import {
  cancelBugSubmission,
  createBug,
  finalizeBugSubmission,
  loadAttachmentPolicy,
  loadDictionaries,
  uploadBugAttachment,
} from "../api";
import { useAuth } from "../AuthContext";
import RoleBadge from "../Components/RoleBadge";
import UserAvatar from "../Components/UserAvatar";
import {
  attachmentAccept,
  extractClipboardImageFiles,
  formatFileSize,
  mergeSelectedFiles,
} from "../attachments";
import type { BugInput } from "../api";
import type {
  AttachmentPolicy,
  Dictionaries,
  DictionaryName,
} from "../types";
import "./Bugs.css";

const initialForm: BugInput = {
  description: "",
  versionId: "",
  priorityId: "",
  categoryId: "",
  typeId: "",
  deviceId: "",
};

function DictionarySelect({
  label,
  dictionary,
  value,
  dictionaries,
  onChange,
}: {
  label: string;
  dictionary: DictionaryName;
  value: string;
  dictionaries: Dictionaries;
  onChange: (value: string) => void;
}) {
  return (
    <label className="editor-field">
      <span>{label}</span>
      <select required value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">Select {label.toLowerCase()}</option>
        {dictionaries[dictionary].map((entry) => (
          <option value={entry.id} key={entry.id}>{entry.label}</option>
        ))}
      </select>
    </label>
  );
}

export default function NewBugPage() {
  const { auth } = useAuth();
  const navigate = useNavigate();
  const [dictionaries, setDictionaries] = useState<Dictionaries | null>(null);
  const [attachmentPolicy, setAttachmentPolicy] = useState<AttachmentPolicy | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [form, setForm] = useState<BugInput>(initialForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadMessage, setUploadMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([loadDictionaries(), loadAttachmentPolicy()])
      .then(([loaded, policy]) => {
        setDictionaries(loaded);
        setAttachmentPolicy(policy);
        setForm((current) => ({
          ...current,
          versionId: loaded.versions[0]?.id ?? "",
          priorityId: loaded.priorities[0]?.id ?? "",
          categoryId: loaded.categories[0]?.id ?? "",
          typeId: loaded.types[0]?.id ?? "",
          deviceId: loaded.devices[0]?.id ?? "",
        }));
      })
      .catch((reason: unknown) => setError(
        reason instanceof Error ? reason.message : "Could not load the report editor.",
      ))
      .finally(() => setLoading(false));
  }, []);

  function update<K extends keyof BugInput>(field: K, value: BugInput[K]) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  if (loading) {
    return <section className="workspace-page"><div className="table-message">Loading editor…</div></section>;
  }

  if (!dictionaries || !attachmentPolicy) {
    return <section className="workspace-page"><div className="workspace-error">{error || "The report editor is unavailable."}</div></section>;
  }

  return (
    <section className="workspace-page editor-page">
      <div className="workspace-header">
        <div>
          <p className="workspace-kicker">CREATE REPORT</p>
          <h2>NEW BUG REPORT</h2>
          {auth && (
            <div className="report-submitter">
              <UserAvatar avatarUrl={auth.user.avatarUrl} displayName={auth.user.displayName} size={42} />
              <p>
                The reporter will be recorded automatically as {auth.user.displayName}{" "}
                <RoleBadge role={auth.user.role} />.
              </p>
            </div>
          )}
        </div>
        <Link className="ghost-link" to="/bugs">BACK TO REPORTS</Link>
      </div>

      <form
        className="bug-editor"
        onSubmit={async (event) => {
          event.preventDefault();
          if (!auth) return;
          setSaving(true);
          setError(null);
          setUploadMessage(null);

          let report: Awaited<ReturnType<typeof createBug>> | null = null;
          try {
            report = await createBug(form, auth.csrfToken, files.length);

            for (let index = 0; index < files.length; index += 1) {
              const file = files[index];
              if (!file) continue;
              setUploadMessage(`Uploading image ${index + 1} of ${files.length}: ${file.name}`);
              await uploadBugAttachment(report.id, file, auth.csrfToken);
            }

            if (files.length > 0) {
              setUploadMessage("Finishing bug report submission…");
              report = await finalizeBugSubmission(report.id, auth.csrfToken);
            }

            navigate(`/bugs/${report.id}`);
          } catch (reason) {
            const message = reason instanceof Error ? reason.message : "Could not create the bug report.";
            let cleanupFailed = false;

            if (report && files.length > 0) {
              setUploadMessage("Cancelling incomplete submission…");
              try {
                await cancelBugSubmission(report.id, auth.csrfToken);
              } catch {
                cleanupFailed = true;
              }
            }

            setError(
              cleanupFailed
                ? `The report was not published because an image failed to upload: ${message} The hidden draft could not be cleaned up automatically; ask a developer to remove it.`
                : `The report was not created because an image failed to upload: ${message}`,
            );
          } finally {
            setUploadMessage(null);
            setSaving(false);
          }
        }}
      >
        <div className="editor-grid">
          <DictionarySelect label="Version" dictionary="versions" value={form.versionId} dictionaries={dictionaries} onChange={(value) => update("versionId", value)} />
          <DictionarySelect label="Priority" dictionary="priorities" value={form.priorityId} dictionaries={dictionaries} onChange={(value) => update("priorityId", value)} />
          <DictionarySelect label="Category" dictionary="categories" value={form.categoryId} dictionaries={dictionaries} onChange={(value) => update("categoryId", value)} />
          <DictionarySelect label="Type" dictionary="types" value={form.typeId} dictionaries={dictionaries} onChange={(value) => update("typeId", value)} />
          <DictionarySelect label="Device" dictionary="devices" value={form.deviceId} dictionaries={dictionaries} onChange={(value) => update("deviceId", value)} />
        </div>

        <label className="editor-field editor-description">
          <span>Description</span>
          <textarea
            required
            minLength={5}
            maxLength={10000}
            disabled={saving}
            value={form.description}
            onChange={(event) => update("description", event.target.value)}
            placeholder="Describe what happened, how to reproduce it, and what you expected to happen."
          />
          <small>{form.description.length}/10000</small>
        </label>

        <section
          className="attachment-picker attachment-paste-zone"
          tabIndex={attachmentPolicy.enabled ? 0 : -1}
          aria-label="Bug report image attachments. Click this area and paste an image with Control V."
          onClick={(event) => {
            if (event.target === event.currentTarget) event.currentTarget.focus();
          }}
          onPaste={(event) => {
            if (!attachmentPolicy.enabled || saving) return;
            const pasted = extractClipboardImageFiles(event.clipboardData);
            if (pasted.length === 0) return;
            event.preventDefault();
            try {
              const nextFiles = mergeSelectedFiles(files, pasted, attachmentPolicy);
              setFiles(nextFiles);
              setError(null);
            } catch (reason) {
              setError(reason instanceof Error ? reason.message : "Could not paste that image.");
            }
          }}
        >
          <div className="attachment-section-heading">
            <div>
              <span className="attachment-label">Attachments</span>
              {attachmentPolicy.enabled ? (
                <small>
                  PNG, JPG, or JPEG only. Up to {attachmentPolicy.maxFilesPerReport} images, {formatFileSize(attachmentPolicy.maxFileSizeBytes)} each. Click this area and press Ctrl+V to paste an image.
                </small>
              ) : (
                <small>R2 image storage is not configured on the API.</small>
              )}
            </div>
            {attachmentPolicy.enabled && (
              <label className="attachment-select-button">
                ADD IMAGES
                <input
                  type="file"
                  multiple
                  disabled={saving}
                  accept={attachmentAccept(attachmentPolicy)}
                  onChange={(event) => {
                    const selected = Array.from(event.target.files ?? []);
                    event.target.value = "";
                    try {
                      const nextFiles = mergeSelectedFiles(files, selected, attachmentPolicy);
                      setFiles(nextFiles);
                      setError(null);
                    } catch (reason) {
                      setError(reason instanceof Error ? reason.message : "Could not select those images.");
                    }
                  }}
                />
              </label>
            )}
          </div>

          {files.length > 0 && (
            <div className="selected-attachment-list">
              {files.map((file, index) => (
                <div className="selected-attachment" key={`${file.name}-${file.size}-${file.lastModified}`}>
                  <div>
                    <strong>{file.name}</strong>
                    <small>{formatFileSize(file.size)}</small>
                  </div>
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => setFiles((current) => current.filter((_, fileIndex) => fileIndex !== index))}
                  >
                    REMOVE
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        {uploadMessage && <div className="upload-status" role="status">{uploadMessage}</div>}
        {error && <div className="workspace-error" role="alert">{error}</div>}
        <div className="editor-actions">
          <Link className="ghost-link" to="/bugs">CANCEL</Link>
          <button className="primary-action" type="submit" disabled={saving}>
            {saving ? (files.length ? "SUBMITTING & UPLOADING…" : "SUBMITTING…") : "SUBMIT FOR APPROVAL"}
          </button>
        </div>
      </form>
    </section>
  );
}
