import { useEffect, useMemo, useState } from "react";
import { loadPublishedUpdate } from "../api";
import { Link, useParams } from "../router";
import type { GameUpdate, UpdateEntry, UpdateEntryImage, UpdateImage } from "../types";
import "./Updates.css";

function formatDate(value: string | null) {
  if (!value) return "";
  return new Date(value).toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function RichContent({ html, className = "" }: { html: string; className?: string }) {
  if (!html) return null;
  return <div className={`published-rich-text ${className}`} dangerouslySetInnerHTML={{ __html: html }} />;
}

function UpdateImageFigure({ entryImage, fallbackCaption, onOpen }: {
  entryImage: UpdateEntryImage;
  fallbackCaption: string;
  onOpen: (image: UpdateImage) => void;
}) {
  if (!entryImage.image?.downloadUrl || !entryImage.figureNumber) return null;
  return (
    <figure className="update-figure">
      <button type="button" onClick={() => onOpen(entryImage.image as UpdateImage)} aria-label={`Enlarge ${entryImage.image.originalName}`}>
        <img src={entryImage.image.downloadUrl} alt={entryImage.caption || fallbackCaption} loading="lazy" />
        <span>CLICK TO ENLARGE</span>
      </button>
      <figcaption>Figure {entryImage.figureNumber}. {entryImage.caption || fallbackCaption}</figcaption>
    </figure>
  );
}

function UpdateEntryMedia({ entry, onOpen }: { entry: UpdateEntry; onOpen: (image: UpdateImage) => void }) {
  const visibleImages = entry.images.filter((entryImage) => entryImage.image?.downloadUrl);
  if (visibleImages.length === 0) return null;
  return (
    <div className={`update-entry-media ${visibleImages.length > 1 ? "is-gallery" : "is-single"}`}>
      {visibleImages.map((entryImage) => (
        <UpdateImageFigure
          entryImage={entryImage}
          fallbackCaption={entry.title}
          onOpen={onOpen}
          key={entryImage.imageId}
        />
      ))}
    </div>
  );
}

function UpdateEntryView({ entry, onOpen }: { entry: UpdateEntry; onOpen: (image: UpdateImage) => void }) {
  const hasImage = entry.images.some((entryImage) => entryImage.image?.downloadUrl);
  const layout = hasImage ? entry.imageLayout : "none";
  return (
    <article className={`published-update-entry layout-${layout}`}>
      {layout === "left" && <UpdateEntryMedia entry={entry} onOpen={onOpen} />}
      <div className="published-update-entry-copy">
        <h4>{entry.title}</h4>
        <RichContent html={entry.bodyHtml} />
      </div>
      {(layout === "right" || layout === "gallery") && <UpdateEntryMedia entry={entry} onOpen={onOpen} />}
    </article>
  );
}

export default function UpdateDetailsPage() {
  const { updateId = "" } = useParams<{ updateId: string }>();
  const [update, setUpdate] = useState<GameUpdate | null>(null);
  const [viewer, setViewer] = useState<UpdateImage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const viewerImages = useMemo(() => {
    if (!update) return [];
    const images = [
      ...(update.coverImage?.downloadUrl ? [update.coverImage] : []),
      ...update.sections.flatMap((section) => section.items.flatMap((entry) => (
        entry.images.flatMap((entryImage) => entryImage.image?.downloadUrl ? [entryImage.image] : [])
      ))),
    ];
    return [...new Map(images.map((image) => [image.id, image])).values()];
  }, [update]);

  const viewerIndex = viewer ? viewerImages.findIndex((image) => image.id === viewer.id) : -1;

  function moveViewer(direction: -1 | 1) {
    if (viewerImages.length < 2 || viewerIndex < 0) return;
    setViewer(viewerImages[(viewerIndex + direction + viewerImages.length) % viewerImages.length] ?? null);
  }

  useEffect(() => {
    let active = true;
    loadPublishedUpdate(updateId)
      .then((result) => {
        if (active) setUpdate(result);
      })
      .catch((reason) => {
        if (active) setError(reason instanceof Error ? reason.message : "Could not load this update.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [updateId]);

  useEffect(() => {
    if (!viewer) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setViewer(null);
      if (event.key === "ArrowLeft") moveViewer(-1);
      if (event.key === "ArrowRight") moveViewer(1);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [viewer, viewerImages, viewerIndex]);

  if (loading) {
    return <section className="content-band"><div className="news-message">Loading update…</div></section>;
  }

  if (!update) {
    return (
      <section className="content-band">
        <div className="news-message">
          <h2>UPDATE NOT FOUND</h2>
          {error && <p>{error}</p>}
          <Link className="ghost-link" to="/news">BACK TO NEWS</Link>
        </div>
      </section>
    );
  }

  const bugFixSection = update.sections.find((section) => section.kind === "bug_fixes");

  return (
    <section className="content-band update-article-page">
      <article className="update-article">
        <Link className="update-back-link" to="/news">← ALL UPDATES</Link>
        <header className="update-article-header">
          <div className="update-article-meta">
            <span>VERSION {update.version}</span>
            <time dateTime={update.publishedAt ?? update.updatedAt}>{formatDate(update.publishedAt ?? update.updatedAt)}</time>
          </div>
          <h2>{update.title}</h2>
          <p>Published by {update.author.displayName}</p>
        </header>

        {update.coverImage?.downloadUrl && (
          <button className="update-cover-viewer-button" type="button" onClick={() => setViewer(update.coverImage)}>
            <img src={update.coverImage.downloadUrl} alt={`${update.title} cover`} />
            <span>CLICK TO ENLARGE</span>
          </button>
        )}

        {update.developerCommentHtml && (
          <section className="developer-comment-block">
            <p className="workspace-kicker">DEVELOPER COMMENT</p>
            <RichContent html={update.developerCommentHtml} />
          </section>
        )}

        <div className="published-update-sections">
          {update.sections.filter((section) => section.kind !== "bug_fixes" && (section.items.length > 0 || section.introHtml)).map((section) => (
            <section className={`published-update-section published-${section.kind}`} key={section.kind}>
              <header>
                <span>{String(update.sections.indexOf(section) + 1).padStart(2, "0")}</span>
                <h3>{section.title}</h3>
              </header>
              <RichContent html={section.introHtml} className="published-section-intro" />
              <div className="published-update-entry-list">
                {section.items.map((entry) => <UpdateEntryView entry={entry} onOpen={setViewer} key={entry.id} />)}
              </div>
            </section>
          ))}

          {bugFixSection && (bugFixSection.items.length > 0 || bugFixSection.introHtml) && (
            <section className="published-update-section published-bug_fixes">
              <header>
                <span>{String(update.sections.indexOf(bugFixSection) + 1).padStart(2, "0")}</span>
                <h3>{bugFixSection.title}</h3>
              </header>
              <RichContent html={bugFixSection.introHtml} className="published-section-intro" />
              {(["major", "minor"] as const).map((level) => {
                const entries = bugFixSection.items.filter((entry) => entry.bugFixLevel === level);
                if (entries.length === 0) return null;
                return (
                  <section className={`published-bug-fix-group ${level}`} key={level}>
                    <h4>{level.toUpperCase()} FIXES</h4>
                    <div className="published-update-entry-list">
                      {entries.map((entry) => <UpdateEntryView entry={entry} onOpen={setViewer} key={entry.id} />)}
                    </div>
                  </section>
                );
              })}
            </section>
          )}
        </div>
      </article>

      {viewer?.downloadUrl && (
        <div className="update-image-viewer-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.currentTarget === event.target) setViewer(null);
        }}>
          <div className="update-image-viewer" role="dialog" aria-modal="true" aria-label={`Image viewer: ${viewer.originalName}`}>
            <div className="update-image-viewer-toolbar">
              <strong>
                {viewer.originalName}
                {viewerImages.length > 1 && <small>{viewerIndex + 1} / {viewerImages.length}</small>}
              </strong>
              <div>
                {viewerImages.length > 1 && <button type="button" onClick={() => moveViewer(-1)} aria-label="Previous image">← PREVIOUS</button>}
                {viewerImages.length > 1 && <button type="button" onClick={() => moveViewer(1)} aria-label="Next image">NEXT →</button>}
                <a href={viewer.downloadUrl} target="_blank" rel="noreferrer">OPEN ORIGINAL</a>
                <button type="button" onClick={() => setViewer(null)}>CLOSE</button>
              </div>
            </div>
            <div className="update-image-viewer-canvas">
              <img src={viewer.downloadUrl} alt={viewer.originalName} />
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
