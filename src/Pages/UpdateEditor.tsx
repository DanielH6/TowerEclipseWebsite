import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import { loadAdminUpdate, saveGameUpdate, uploadUpdateImage } from "../api";
import { useAuth } from "../AuthContext";
import RichTextEditor from "../Components/RichTextEditor";
import { Link, useParams } from "../router";
import type {
  BugFixLevel,
  GameUpdate,
  NewsContentType,
  UpdateEntry,
  UpdateEntryImage,
  UpdateImage,
  UpdateImageLayout,
  UpdateInput,
  UpdateSection,
  UpdateSectionKind,
  UpdateStatus,
} from "../types";
import "./Updates.css";

const sectionDescriptions: Record<UpdateSectionKind, string> = {
  new_features: "Major additions and new gameplay systems. Entries can use text-only, image-column, or gallery layouts.",
  balancing: "Tower, enemy, economy, progression, and difficulty adjustments.",
  bug_fixes: "Fixes are split into Major and Minor groups automatically.",
  small_changes: "Smaller quality-of-life improvements and miscellaneous changes.",
};

const MAX_IMAGES_PER_ENTRY = 20;

function makeId(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function createEntry(sectionKind: UpdateSectionKind, bugFixLevel: BugFixLevel | null = null): UpdateEntry {
  return {
    id: makeId("entry"),
    title: "New entry",
    bodyHtml: "<p>Describe the change.</p>",
    images: [],
    imageLayout: "none",
    bugFixLevel: sectionKind === "bug_fixes" ? (bugFixLevel ?? "minor") : null,
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
    contentType: update.contentType,
    isMinor: update.contentType === "game_update" && update.isMinor,
    title: update.title,
    version: update.contentType === "game_update" ? update.version : "",
    developerCommentHtml: update.contentType === "game_update" ? update.developerCommentHtml : "",
    blogHtml: update.contentType === "developer_blog" ? update.blogHtml : "",
    coverImageId: update.contentType === "game_update" ? update.coverImageId : null,
    status,
    publishedOn: update.publishedOn,
    sections: update.contentType === "developer_blog" ? [] : update.sections.map((section) => ({
      id: section.id,
      kind: section.kind,
      title: section.title,
      introHtml: section.introHtml,
      items: section.items.map((item) => ({
        id: item.id,
        title: item.title,
        bodyHtml: item.bodyHtml,
        images: item.images.map((image) => ({
          imageId: image.imageId,
          caption: image.caption,
        })),
        imageLayout: item.images.length > 0 ? item.imageLayout : "none",
        bugFixLevel: item.bugFixLevel,
      })),
    })),
  };
}

export default function UpdateEditorPage() {
  const { updateId = "" } = useParams<{ updateId: string }>();
  const { auth } = useAuth();
  const [update, setUpdate] = useState<GameUpdate | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [collapsedItems, setCollapsedItems] = useState<Set<string>>(() => new Set());
  const [uploadMessage, setUploadMessage] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    loadAdminUpdate(updateId)
      .then((result) => {
        if (active) {
          setUpdate(result);
          setDirty(false);
        }
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
      item.images.forEach((image) => ids.add(image.imageId));
    }));
    return ids.size;
  }, [update]);

  function patchUpdate(changes: Partial<GameUpdate>) {
    setUpdate((current) => current ? { ...current, ...changes } : current);
    setDirty(true);
  }

  function patchSection(kind: UpdateSectionKind, transform: (section: UpdateSection) => UpdateSection) {
    setUpdate((current) => current ? {
      ...current,
      sections: current.sections.map((section) => section.kind === kind ? transform(section) : section),
    } : current);
    setDirty(true);
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
    setCollapsedItems((current) => {
      const next = new Set(current);
      next.delete(itemId);
      return next;
    });
  }

  function duplicateItem(kind: UpdateSectionKind, itemId: string) {
    patchSection(kind, (section) => {
      const index = section.items.findIndex((item) => item.id === itemId);
      if (index < 0) return section;
      const source = section.items[index]!;
      const duplicate: UpdateEntry = {
        ...source,
        id: makeId("entry"),
        title: `${source.title} (copy)`.slice(0, 180),
        images: source.images.map((image) => ({ ...image })),
      };
      const items = [...section.items];
      items.splice(index + 1, 0, duplicate);
      return { ...section, items };
    });
  }

  function moveEntryImage(
    kind: UpdateSectionKind,
    itemId: string,
    imageId: string,
    direction: -1 | 1,
  ) {
    patchSection(kind, (section) => ({
      ...section,
      items: section.items.map((item) => {
        if (item.id !== itemId) return item;
        const index = item.images.findIndex((image) => image.imageId === imageId);
        const target = index + direction;
        if (index < 0 || target < 0 || target >= item.images.length) return item;
        const images = [...item.images];
        const currentImage = images[index]!;
        images[index] = images[target]!;
        images[target] = currentImage;
        return { ...item, images };
      }),
    }));
  }

  function patchEntryImage(
    kind: UpdateSectionKind,
    itemId: string,
    imageId: string,
    changes: Partial<UpdateEntryImage>,
  ) {
    patchSection(kind, (section) => ({
      ...section,
      items: section.items.map((item) => item.id === itemId ? {
        ...item,
        images: item.images.map((image) => image.imageId === imageId ? { ...image, ...changes } : image),
      } : item),
    }));
  }

  function removeEntryImage(kind: UpdateSectionKind, itemId: string, imageId: string) {
    patchSection(kind, (section) => ({
      ...section,
      items: section.items.map((item) => {
        if (item.id !== itemId) return item;
        const images = item.images.filter((image) => image.imageId !== imageId);
        return {
          ...item,
          images,
          imageLayout: images.length === 0 ? "none" : item.imageLayout,
        };
      }),
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
      setDirty(false);
      setNotice(status === "published"
        ? `${update.contentType === "developer_blog" ? "Developer blog" : "Update"} published.`
        : `Draft saved at ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save the update.");
    } finally {
      setWorking(false);
    }
  }

  useEffect(() => {
    function warnAboutUnsavedChanges(event: BeforeUnloadEvent) {
      if (!dirty) return;
      event.preventDefault();
    }
    window.addEventListener("beforeunload", warnAboutUnsavedChanges);
    return () => window.removeEventListener("beforeunload", warnAboutUnsavedChanges);
  }, [dirty]);

  useEffect(() => {
    function saveWithShortcut(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "s") return;
      event.preventDefault();
      if (!working) void save("draft");
    }
    window.addEventListener("keydown", saveWithShortcut);
    return () => window.removeEventListener("keydown", saveWithShortcut);
  }, [auth, update, working]);

  function validateImageFiles(files: File[]) {
    const allowed = new Set(["image/png", "image/jpeg"]);
    const unsupported = files.find((file) => !allowed.has(file.type));
    if (unsupported) {
      setError(`${unsupported.name} is not supported. Use PNG, JPG, or JPEG images.`);
      return false;
    }
    const oversized = files.find((file) => update && file.size > update.imagePolicy.maxFileSizeBytes);
    if (oversized && update) {
      setError(`${oversized.name} exceeds the ${formatFileSize(update.imagePolicy.maxFileSizeBytes)} limit.`);
      return false;
    }
    return true;
  }

  async function uploadImages(files: File[]): Promise<UpdateImage[]> {
    if (!auth || !update || files.length === 0 || !validateImageFiles(files)) return [];
    setWorking(true);
    setError(null);
    setNotice(null);
    const uploaded: UpdateImage[] = [];
    try {
      for (const [index, file] of files.entries()) {
        setUploadMessage(`Uploading ${index + 1}/${files.length}: ${file.name}…`);
        uploaded.push(await uploadUpdateImage(update.id, file, auth.csrfToken));
      }
      return uploaded;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not upload the image.");
      return uploaded;
    } finally {
      setUploadMessage(null);
      setWorking(false);
    }
  }

  async function uploadCover(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const [image] = await uploadImages([file]);
    if (image) patchUpdate({ coverImageId: image.id, coverImage: image });
  }

  async function uploadEntryImages(kind: UpdateSectionKind, itemId: string, event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files.length === 0 || !update) return;
    const item = update.sections.find((section) => section.kind === kind)?.items.find((entry) => entry.id === itemId);
    if (!item) return;
    const entrySlots = MAX_IMAGES_PER_ENTRY - item.images.length;
    if (files.length > entrySlots) {
      setError(`This entry can contain at most ${MAX_IMAGES_PER_ENTRY} images. You can add ${entrySlots} more.`);
      return;
    }
    const updateSlots = update.imagePolicy.maxImagesPerUpdate - usedImageCount;
    if (files.length > updateSlots) {
      setError(`This update has room for ${Math.max(0, updateSlots)} more uploaded images.`);
      return;
    }
    const uploaded = await uploadImages(files);
    if (uploaded.length === 0) return;
    patchSection(kind, (section) => ({
      ...section,
      items: section.items.map((entry) => {
        if (entry.id !== itemId) return entry;
        const images = [
          ...entry.images,
          ...uploaded.map((image) => ({
            imageId: image.id,
            caption: "",
            image,
            figureNumber: null,
          })),
        ];
        return {
          ...entry,
          images,
          imageLayout: images.length > 1 ? "gallery" : (entry.imageLayout === "none" ? "right" : entry.imageLayout),
        };
      }),
    }));
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
    const isCollapsed = collapsedItems.has(item.id);
    return (
      <article className={`update-entry-editor ${isCollapsed ? "is-collapsed" : ""}`} key={item.id}>
        <div className="update-entry-editor-heading">
          <span>ENTRY {index + 1} <strong>{item.title}</strong></span>
          <div>
            <button
              type="button"
              aria-expanded={!isCollapsed}
              onClick={() => setCollapsedItems((current) => {
                const next = new Set(current);
                if (next.has(item.id)) next.delete(item.id); else next.add(item.id);
                return next;
              })}
            >
              {isCollapsed ? "EXPAND" : "COLLAPSE"}
            </button>
            <button type="button" aria-label={`Move ${item.title} up`} disabled={working || index === 0} onClick={() => moveItem(section.kind, item.id, -1)}>↑</button>
            <button type="button" aria-label={`Move ${item.title} down`} disabled={working || index === section.items.length - 1} onClick={() => moveItem(section.kind, item.id, 1)}>↓</button>
            <button type="button" disabled={working} onClick={() => duplicateItem(section.kind, item.id)}>DUPLICATE</button>
            <button className="danger-action" type="button" disabled={working} onClick={() => removeItem(section.kind, item.id)}>REMOVE</button>
          </div>
        </div>

        {!isCollapsed && <>
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
              <strong>IMAGE GALLERY · {item.images.length}/{MAX_IMAGES_PER_ENTRY}</strong>
              <small>Select several files at once or add more later. Drag-free arrow controls keep the published order predictable.</small>
            </div>
            <label className="attachment-select-button">
              {item.images.length > 0 ? "ADD MORE IMAGES" : "ADD IMAGES"}
              <input
                type="file"
                accept=".png,.jpg,.jpeg,image/png,image/jpeg"
                multiple
                disabled={working || !update?.imagePolicy.enabled || item.images.length >= MAX_IMAGES_PER_ENTRY}
                onChange={(event) => void uploadEntryImages(section.kind, item.id, event)}
              />
            </label>
          </div>

          {item.images.length > 0 && (
            <label className="editor-field entry-gallery-layout">
              <span>Published image layout</span>
              <select
                value={item.imageLayout}
                disabled={working}
                onChange={(event) => patchItem(section.kind, item.id, { imageLayout: event.target.value as UpdateImageLayout })}
              >
                <option value="gallery">Full-width responsive gallery</option>
                <option value="left">Image column left</option>
                <option value="right">Image column right</option>
              </select>
            </label>
          )}

          {item.images.length > 0 && (
            <div className="entry-image-list">
              {item.images.map((entryImage, imageIndex) => (
                <article className="entry-image-card" key={entryImage.imageId}>
                  <div className="entry-image-preview">
                    {entryImage.image?.downloadUrl ? (
                      <img src={entryImage.image.downloadUrl} alt="" />
                    ) : (
                      <span>PREVIEW UNAVAILABLE</span>
                    )}
                    <strong>IMAGE {imageIndex + 1}</strong>
                  </div>
                  <div className="entry-image-options">
                    <label className="editor-field">
                      <span>Figure caption</span>
                      <input
                        value={entryImage.caption}
                        maxLength={300}
                        disabled={working}
                        placeholder={`Defaults to ${item.title}`}
                        onChange={(event) => patchEntryImage(section.kind, item.id, entryImage.imageId, { caption: event.target.value })}
                      />
                    </label>
                    <div className="entry-image-actions">
                      <button type="button" aria-label={`Move image ${imageIndex + 1} left`} disabled={working || imageIndex === 0} onClick={() => moveEntryImage(section.kind, item.id, entryImage.imageId, -1)}>←</button>
                      <button type="button" aria-label={`Move image ${imageIndex + 1} right`} disabled={working || imageIndex === item.images.length - 1} onClick={() => moveEntryImage(section.kind, item.id, entryImage.imageId, 1)}>→</button>
                      <button className="danger-action" type="button" disabled={working} onClick={() => removeEntryImage(section.kind, item.id, entryImage.imageId)}>REMOVE</button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
        </>}
      </article>
    );
  }

  const isDeveloperBlog = update.contentType === "developer_blog";
  const contentLabel = isDeveloperBlog ? "developer blog" : update.isMinor ? "minor update" : "game update";

  return (
    <section className="workspace-page update-editor-page">
      <div className="workspace-header update-editor-header">
        <div>
          <p className="workspace-kicker">DEVELOPER ADMIN</p>
          <h2>{update.title}</h2>
          <p>
            {update.status === "published" ? "Published" : "Draft"} {contentLabel}
            {!isDeveloperBlog && <> · {usedImageCount}/{update.imagePolicy.maxImagesPerUpdate || 0} referenced images</>}
            {` · ${dirty ? "Unsaved changes" : "All changes saved"}`}
          </p>
        </div>
        <div className="workspace-header-actions">
          <Link className="ghost-link" to="/admin/updates">ALL UPDATES</Link>
          {update.status === "published" && <Link className="ghost-link" to={`/news/${encodeURIComponent(update.id)}`}>PUBLIC PREVIEW</Link>}
        </div>
      </div>

      <nav className="update-editor-outline" aria-label="Update editor sections">
        <a href="#update-header">Header</a>
        {isDeveloperBlog ? (
          <a href="#developer-blog-content">Blog content</a>
        ) : update.sections.map((section) => (
          <a href={`#update-${section.kind}`} key={section.kind}>
            {section.title} <span>{section.items.length}</span>
          </a>
        ))}
        {!isDeveloperBlog && <div>
          <button type="button" onClick={() => setCollapsedItems(new Set(update.sections.flatMap((section) => section.items.map((item) => item.id))))}>COLLAPSE ENTRIES</button>
          <button type="button" onClick={() => setCollapsedItems(new Set())}>EXPAND ENTRIES</button>
        </div>}
      </nav>

      <div className="update-editor-stack">
        <article className="panel-card update-meta-editor" id="update-header">
          <div className="update-editor-section-title">
            <div>
              <p className="workspace-kicker">NEWS CONTENT DETAILS</p>
              <h3>HEADER</h3>
            </div>
          </div>
          <div className="update-meta-grid">
            <label className="editor-field">
              <span>{isDeveloperBlog ? "Blog title" : "Update name"}</span>
              <input value={update.title} maxLength={180} disabled={working} onChange={(event) => patchUpdate({ title: event.target.value })} />
            </label>
            <label className="editor-field">
              <span>Content type</span>
              <select
                value={update.contentType}
                disabled={working}
                onChange={(event) => {
                  const contentType = event.target.value as NewsContentType;
                  const hasUpdateContent = usedImageCount > 0 || update.sections.some((section) => section.items.length > 0 || section.introHtml);
                  if (
                    contentType === "developer_blog" &&
                    hasUpdateContent &&
                    !window.confirm("Changing this to a developer blog will remove its update sections and uploaded images when you save. Continue?")
                  ) return;
                  patchUpdate({ contentType, isMinor: contentType === "developer_blog" ? false : update.isMinor });
                }}
              >
                <option value="game_update">Game update</option>
                <option value="developer_blog">Developer blog</option>
              </select>
            </label>
            <label className="editor-field">
              <span>Display publish date</span>
              <input type="date" value={update.publishedOn ?? ""} disabled={working} onChange={(event) => patchUpdate({ publishedOn: event.target.value || null })} />
              <small>Controls the public date and archive order. Leave blank to use the first publish date.</small>
            </label>
            {!isDeveloperBlog && <label className="editor-field">
              <span>Version</span>
              <input value={update.version} maxLength={80} disabled={working} placeholder="Example: 1.4.0" onChange={(event) => patchUpdate({ version: event.target.value })} />
            </label>}
          </div>

          {!isDeveloperBlog && <label className="update-minor-toggle">
            <input type="checkbox" checked={update.isMinor} disabled={working} onChange={(event) => patchUpdate({ isMinor: event.target.checked })} />
            <span>
              <strong>MINOR UPDATE</strong>
              <small>Show this as a compact archive item. Image-free minor updates use the same wide text layout as developer blogs.</small>
            </span>
          </label>}

          {!isDeveloperBlog && <div className="cover-image-field">
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
          </div>}

          {!isDeveloperBlog && <RichTextEditor
            label="Developer comment"
            value={update.developerCommentHtml}
            disabled={working}
            placeholder="Add the developer's introduction, context, or closing note."
            onChange={(developerCommentHtml) => patchUpdate({ developerCommentHtml })}
          />}
        </article>

        {isDeveloperBlog && (
          <article className="panel-card update-section-editor developer-blog-editor" id="developer-blog-content">
            <div className="update-editor-section-title">
              <div>
                <p className="workspace-kicker">MONTHLY DEVELOPMENT JOURNAL</p>
                <h3>BLOG CONTENT</h3>
                <p>Write the complete post here. Headings, bold text, links, lists, quotes, and tables are supported.</p>
              </div>
            </div>
            <RichTextEditor
              label="Developer blog post"
              value={update.blogHtml}
              disabled={working}
              placeholder="Share this month's development progress, highlights, and goals for next month."
              onChange={(blogHtml) => patchUpdate({ blogHtml })}
            />
          </article>
        )}

        {!isDeveloperBlog && update.sections.map((section) => {
          const majorItems = section.kind === "bug_fixes" ? section.items.filter((item) => item.bugFixLevel === "major") : [];
          const minorItems = section.kind === "bug_fixes" ? section.items.filter((item) => item.bugFixLevel !== "major") : [];

          return (
            <article className={`panel-card update-section-editor section-${section.kind}`} id={`update-${section.kind}`} key={section.kind}>
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
          <button className="ghost-action" type="button" disabled={working || !dirty} title="Save draft (Ctrl/Cmd + S)" onClick={() => void save("draft")}>{working ? "WORKING…" : "SAVE DRAFT"}</button>
          <button className="primary-action" type="button" disabled={working} onClick={() => void save("published")}>
            {working ? "WORKING…" : update.status === "published" ? "SAVE & PUBLISH" : isDeveloperBlog ? "PUBLISH BLOG" : "PUBLISH UPDATE"}
          </button>
        </div>
      </div>
    </section>
  );
}
