import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import { loadAdminUpdate, saveGameUpdate, uploadUpdateImage } from "../api";
import { useAuth } from "../AuthContext";
import RichTextEditor from "../Components/RichTextEditor";
import { Link, useNavigate, useParams } from "../router";
import type {
  BugFixLevel,
  GameUpdate,
  UpdateEntry,
  UpdateImage,
  UpdateImageLayout,
  UpdateInput,
  UpdateSection,
  UpdateSectionKind,
  UpdateStatus,
} from "../types";
import "./Updates.css";

const sectionDescriptions: Record<UpdateSectionKind, string> = {
  new_features: "Major additions and new gameplay systems. Entries can use a text-only layout or an image column.",
  balancing: "Tower, enemy, economy, progression, and difficulty adjustments.",
  bug_fixes: "Fixes are split into Major and Minor groups automatically.",
  small_changes: "Smaller quality-of-life improvements and miscellaneous changes.",
};

function makeId(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function createEntry(sectionKind: UpdateSectionKind, bugFixLevel: BugFixLevel | null = null): UpdateEntry {
  return {
    id: makeId("entry"),
    title: "New entry",
    bodyHtml: "<p>Describe the change.</p>",
    imageId: null,
    imageLayout: "none",
    caption: "",
    bugFixLevel: sectionKind === "bug_fixes" ? (bugFixLevel ?? "minor") : null,
    image: null,
    figureNumber: null,
  };
}

function formatFileSize(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function toInput(update: GameUpdate, status: UpdateStatus): UpdateInput {
  return {
    title: update.title,
    version: update.version,
    developerCommentHtml: update.developerCommentHtml,
    coverImageId: update.coverImageId,
    status,
    sections: update.sections.map((section) => ({
      id: section.id,
      kind: section.kind,
      title: section.title,
      introHtml: section.introHtml,
      items: section.items.map((item) => ({
        id: item.id,
        title: item.title,
        bodyHtml: item.bodyHtml,
        imageId: item.imageId,
        imageLayout: item.imageId ? item.imageLayout : "none",
        caption: item.caption,
        bugFixLevel: item.bugFixLevel,
      })),
    })),
  };
}

export default function UpdateEditorPage() {
  const { updateId = "" } = useParams<{ updateId: string }>();
  const { auth } = useAuth();
  const navigate = useNavigate();
  const [update, setUpdate] = useState<GameUpdate | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [uploadMessage, setUploadMessage] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    loadAdminUpdate(updateId)
      .then((result) => {
        if (active) setUpdate(result);
      })
      .catch((reason) => {
        if (active) setError(reason instanceof Error ? reason.message : "Could not load the update editor.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [updateId]);

  const usedImageCount = useMemo(() => {
    if (!update) return 0;
    const ids = new Set<string>();
    if (update.coverImageId) ids.add(update.coverImageId);
    update.sections.forEach((section) => section.items.forEach((item) => {
      if (item.imageId) ids.add(item.imageId);
    }));
    return ids.size;
  }, [update]);

  function patchUpdate(changes: Partial<GameUpdate>) {
    setUpdate((current) => current ? { ...current, ...changes } : current);
  }

  function patchSection(kind: UpdateSectionKind, transform: (section: UpdateSection) => UpdateSection) {
    setUpdate((current) => current ? {
      ...current,
      sections: current.sections.map((section) => section.kind === kind ? transform(section) : section),
    } : current);
  }

  function patchItem(kind: UpdateSectionKind, itemId: string, changes: Partial<UpdateEntry>) {
    patchSection(kind, (section) => ({
      ...section,
      items: section.items.map((item) => item.id === itemId ? { ...item, ...changes } : item),
    }));
  }

  function addItem(kind: UpdateSectionKind, level: BugFixLevel | null = null) {
    patchSection(kind, (section) => ({
      ...section,
      items: [...section.items, createEntry(kind, level)],
    }));
  }

  function removeItem(kind: UpdateSectionKind, itemId: string) {
    patchSection(kind, (section) => ({
      ...section,
      items: section.items.filter((item) => item.id !== itemId),
    }));
  }

  function moveItem(kind: UpdateSectionKind, itemId: string, direction: -1 | 1) {
    patchSection(kind, (section) => {
      const index = section.items.findIndex((item) => item.id === itemId);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= section.items.length) return section;
      const items = [...section.items];
      const currentItem = items[index]!;
      items[index] = items[target]!;
      items[target] = currentItem;
      return { ...section, items };
    });
  }

  async function save(status: UpdateStatus) {
    if (!auth || !update) return;
    setWorking(true);
    setError(null);
    setNotice(null);
    try {
      const saved = await saveGameUpdate(update.id, toInput(update, status), auth.csrfToken);
      setUpdate(saved);
      setNotice(status === "published" ? "Update published." : "Draft saved.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save the update.");
    } finally {
      setWorking(false);
    }
  }

  async function uploadImage(file: File): Promise<UpdateImage | null> {
    if (!auth || !update) return null;
    const allowed = new Set(["image/png", "image/jpeg"]);
    if (!allowed.has(file.type)) {
      setError("Use a PNG, JPG, or JPEG image.");
      return null;
    }
    if (file.size > update.imagePolicy.maxFileSizeBytes) {
      setError(`Images may not exceed ${formatFileSize(update.imagePolicy.maxFileSizeBytes)}.`);
      return null;
    }
    setWorking(true);
    setError(null);
    setNotice(null);
    setUploadMessage(`Uploading ${file.name}…`);
    try {
      const image = await uploadUpdateImage(update.id, file, auth.csrfToken);
      setUploadMessage(null);
      return image;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not upload the image.");
      setUploadMessage(null);
      return null;
    } finally {
      setWorking(false);
    }
  }

  async function uploadCover(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const image = await uploadImage(file);
    if (image) patchUpdate({ coverImageId: image.id, coverImage: image });
  }

  async function uploadEntryImage(kind: UpdateSectionKind, itemId: string, event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const image = await uploadImage(file);
    if (image) {
      patchItem(kind, itemId, {
        imageId: image.id,
        image,
        imageLayout: "right",
      });
    }
  }

  if (loading) {
    return <section className="workspace-page"><div className="panel-card table-message">Loading update editor…</div></section>;
  }

  if (!update) {
    return (
      <section className="workspace-page">
        <div className="panel-card">
          <h2>UPDATE UNAVAILABLE</h2>
          {error && <div className="workspace-error">{error}</div>}
          <Link className="ghost-link" to="/admin/updates">BACK TO UPDATES</Link>
        </div>
      </section>
    );
  }

  function renderEntry(section: UpdateSection, item: UpdateEntry, index: number) {
    return (
      <article className="update-entry-editor" key={item.id}>
        <div className="update-entry-editor-heading">
          <span>ENTRY {index + 1}</span>
          <div>
            <button type="button" disabled={working || index === 0} onClick={() => moveItem(section.kind, item.id, -1)}>↑</button>
            <button type="button" disabled={working || index === section.items.length - 1} onClick={() => moveItem(section.kind, item.id, 1)}>↓</button>
            <button className="danger-action" type="button" disabled={working} onClick={() => removeItem(section.kind, item.id)}>REMOVE</button>
          </div>
        </div>

        <div className="update-entry-grid">
          <label className="editor-field">
            <span>Entry title</span>
            <input
              value={item.title}
              disabled={working}
              maxLength={180}
              onChange={(event) => patchItem(section.kind, item.id, { title: event.target.value })}
            />
          </label>
          {section.kind === "bug_fixes" && (
            <label className="editor-field">
              <span>Bug-fix group</span>
              <select
                value={item.bugFixLevel ?? "minor"}
                disabled={working}
                onChange={(event) => patchItem(section.kind, item.id, { bugFixLevel: event.target.value as BugFixLevel })}
              >
                <option value="major">Major</option>
                <option value="minor">Minor</option>
              </select>
            </label>
          )}
        </div>

        <RichTextEditor
          label="Entry content"
          value={item.bodyHtml}
          compact
          disabled={working}
          placeholder="Describe this change exactly as it should appear in the published update."
          onChange={(bodyHtml) => patchItem(section.kind, item.id, { bodyHtml })}
        />

        <div className="entry-image-editor">
          <div className="entry-image-controls">
            <div>
              <strong>OPTIONAL IMAGE</strong>
              <small>PNG, JPG, or JPEG. Images are automatically numbered as Figure 1, Figure 2, and so on.</small>
            </div>
            <label className="attachment-select-button">
              {item.imageId ? "REPLACE IMAGE" : "ADD IMAGE"}
              <input type="file" accept=".png,.jpg,.jpeg,image/png,image/jpeg" disabled={working || !update?.imagePolicy.enabled} onChange={(event) => void uploadEntryImage(section.kind, item.id, event)} />
            </label>
          </div>

          {item.image?.downloadUrl && (
            <div className="entry-image-preview-row">
              <img src={item.image.downloadUrl} alt="" />
              <div className="entry-image-options">
                <label className="editor-field">
                  <span>Layout</span>
                  <select
                    value={item.imageLayout}
                    disabled={working}
                    onChange={(event) => patchItem(section.kind, item.id, { imageLayout: event.target.value as UpdateImageLayout })}
                  >
                    <option value="left">Image column left</option>
                    <option value="right">Image column right</option>
                  </select>
                </label>
                <label className="editor-field">
                  <span>Figure caption</span>
                  <input
                    value={item.caption}
                    maxLength={300}
                    disabled={working}
                    placeholder="Defaults to the entry title"
                    onChange={(event) => patchItem(section.kind, item.id, { caption: event.target.value })}
                  />
                </label>
                <button
                  className="danger-action"
                  type="button"
                  disabled={working}
                  onClick={() => patchItem(section.kind, item.id, {
                    imageId: null,
                    image: null,
                    imageLayout: "none",
                    caption: "",
                  })}
                >
                  REMOVE IMAGE
                </button>
              </div>
            </div>
          )}
        </div>
      </article>
    );
  }

  return (
    <section className="workspace-page update-editor-page">
      <div className="workspace-header update-editor-header">
        <div>
          <p className="workspace-kicker">DEVELOPER ADMIN</p>
          <h2>{update.title}</h2>
          <p>
            {update.status === "published" ? "Published update" : "Draft update"} · {usedImageCount}/{update.imagePolicy.maxImagesPerUpdate || 0} referenced images
          </p>
        </div>
        <div className="workspace-header-actions">
          <Link className="ghost-link" to="/admin/updates">ALL UPDATES</Link>
          {update.status === "published" && <Link className="ghost-link" to={`/news/${encodeURIComponent(update.id)}`}>PUBLIC PREVIEW</Link>}
        </div>
      </div>

      <div className="update-editor-stack">
        <article className="panel-card update-meta-editor">
          <div className="update-editor-section-title">
            <div>
              <p className="workspace-kicker">UPDATE DETAILS</p>
              <h3>HEADER</h3>
            </div>
          </div>
          <div className="update-meta-grid">
            <label className="editor-field">
              <span>Update name</span>
              <input value={update.title} maxLength={180} disabled={working} onChange={(event) => patchUpdate({ title: event.target.value })} />
            </label>
            <label className="editor-field">
              <span>Version</span>
              <input value={update.version} maxLength={80} disabled={working} placeholder="Example: 1.4.0" onChange={(event) => patchUpdate({ version: event.target.value })} />
            </label>
          </div>

          <div className="cover-image-field">
            <div className="cover-image-copy">
              <strong>COVER IMAGE</strong>
              <small>
                PNG, JPG, or JPEG · {formatFileSize(update.imagePolicy.maxFileSizeBytes)} maximum
              </small>
            </div>
            {update.coverImage?.downloadUrl ? (
              <div className="cover-image-preview">
                <img src={update.coverImage.downloadUrl} alt="Current update cover" />
                <div>
                  <label className="attachment-select-button">
                    REPLACE COVER
                    <input type="file" accept=".png,.jpg,.jpeg,image/png,image/jpeg" disabled={working} onChange={(event) => void uploadCover(event)} />
                  </label>
                  <button className="danger-action" type="button" disabled={working} onClick={() => patchUpdate({ coverImageId: null, coverImage: null })}>REMOVE COVER</button>
                </div>
              </div>
            ) : (
              <label className="cover-image-drop">
                <span>{update.imagePolicy.enabled ? "SELECT COVER IMAGE" : "R2 IMAGE STORAGE IS DISABLED"}</span>
                <input type="file" accept=".png,.jpg,.jpeg,image/png,image/jpeg" disabled={working || !update?.imagePolicy.enabled} onChange={(event) => void uploadCover(event)} />
              </label>
            )}
          </div>

          <RichTextEditor
            label="Developer comment"
            value={update.developerCommentHtml}
            disabled={working}
            placeholder="Add the developer's introduction, context, or closing note."
            onChange={(developerCommentHtml) => patchUpdate({ developerCommentHtml })}
          />
        </article>

        {update.sections.map((section) => {
          const majorItems = section.kind === "bug_fixes" ? section.items.filter((item) => item.bugFixLevel === "major") : [];
          const minorItems = section.kind === "bug_fixes" ? section.items.filter((item) => item.bugFixLevel !== "major") : [];

          return (
            <article className={`panel-card update-section-editor section-${section.kind}`} key={section.kind}>
              <div className="update-editor-section-title">
                <div>
                  <p className="workspace-kicker">BLOCK TEMPLATE</p>
                  <h3>{section.title.toUpperCase()}</h3>
                  <p>{sectionDescriptions[section.kind]}</p>
                </div>
                {section.kind !== "bug_fixes" && (
                  <button className="primary-action" type="button" disabled={working} onClick={() => addItem(section.kind)}>ADD ENTRY</button>
                )}
              </div>

              <RichTextEditor
                label="Optional block introduction"
                value={section.introHtml}
                compact
                disabled={working}
                placeholder={`Optional introduction shown beneath ${section.title}.`}
                onChange={(introHtml) => patchSection(section.kind, (current) => ({ ...current, introHtml }))}
              />

              {section.kind === "bug_fixes" ? (
                <div className="bug-fix-editor-groups">
                  <section>
                    <div className="bug-fix-group-heading">
                      <h4>MAJOR FIXES</h4>
                      <button className="primary-action" type="button" disabled={working} onClick={() => addItem(section.kind, "major")}>ADD MAJOR FIX</button>
                    </div>
                    <div className="update-entry-list">
                      {majorItems.length === 0 && <p className="empty-copy">No major fixes in this update.</p>}
                      {majorItems.map((item) => renderEntry(section, item, section.items.indexOf(item)))}
                    </div>
                  </section>
                  <section>
                    <div className="bug-fix-group-heading">
                      <h4>MINOR FIXES</h4>
                      <button className="primary-action" type="button" disabled={working} onClick={() => addItem(section.kind, "minor")}>ADD MINOR FIX</button>
                    </div>
                    <div className="update-entry-list">
                      {minorItems.length === 0 && <p className="empty-copy">No minor fixes in this update.</p>}
                      {minorItems.map((item) => renderEntry(section, item, section.items.indexOf(item)))}
                    </div>
                  </section>
                </div>
              ) : (
                <div className="update-entry-list">
                  {section.items.length === 0 && <p className="empty-copy">No entries in this block yet.</p>}
                  {section.items.map((item, index) => renderEntry(section, item, index))}
                </div>
              )}
            </article>
          );
        })}
      </div>

      <div className="update-sticky-actions">
        <div>
          {uploadMessage && <span className="update-save-message">{uploadMessage}</span>}
          {notice && <span className="update-save-message success">{notice}</span>}
          {error && <span className="update-save-message error" role="alert">{error}</span>}
        </div>
        <div>
          {update.status === "published" && (
            <button className="ghost-action" type="button" disabled={working} onClick={() => void save("draft")}>UNPUBLISH</button>
          )}
          <button className="ghost-action" type="button" disabled={working} onClick={() => void save("draft")}>{working ? "WORKING…" : "SAVE DRAFT"}</button>
          <button className="primary-action" type="button" disabled={working} onClick={() => void save("published")}>{working ? "WORKING…" : update.status === "published" ? "SAVE & PUBLISH" : "PUBLISH UPDATE"}</button>
        </div>
      </div>
    </section>
  );
}
