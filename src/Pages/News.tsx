import { useEffect, useMemo, useState } from "react";
import { loadPublishedUpdates } from "../api";
import { Link } from "../router";
import type { GameUpdate } from "../types";
import "./Updates.css";

function formatDate(value: string | null) {
  if (!value) return "Unpublished";
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00.000Z`) : new Date(value);
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

function entryCount(update: GameUpdate) {
  return update.sections.reduce((total, section) => total + section.items.length, 0);
}

function populatedSectionCount(update: GameUpdate) {
  return update.sections.filter((section) => section.items.length > 0 || section.introHtml).length;
}

function displayPublishTime(update: GameUpdate) {
  const value = update.publishedOn
    ? `${update.publishedOn}T00:00:00.000Z`
    : (update.publishedAt ?? update.updatedAt);
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? 0 : time;
}

export default function News() {
  const [updates, setUpdates] = useState<GameUpdate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let active = true;
    loadPublishedUpdates()
      .then((result) => {
        if (active) setUpdates(result);
      })
      .catch((reason) => {
        if (active) setError(reason instanceof Error ? reason.message : "Could not load updates.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const visibleUpdates = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return updates
      .filter((update) => !normalizedQuery || [update.title, update.version, update.author.displayName]
        .some((value) => value.toLowerCase().includes(normalizedQuery)))
      .sort((left, right) => displayPublishTime(right) - displayPublishTime(left));
  }, [query, updates]);
  const displayOrderedUpdates = useMemo(
    () => [...updates].sort((left, right) => displayPublishTime(right) - displayPublishTime(left)),
    [updates],
  );
  const currentVersion = displayOrderedUpdates.find((update) => update.contentType === "game_update" && update.version)?.version ?? "—";
  const latestFullUpdateId = displayOrderedUpdates.find((update) => update.contentType === "game_update" && !update.isMinor)?.id;

  return (
    <section className="content-band news-page">
      <div className="news-page-inner">
        <header className="news-heading">
          <div className="news-heading-copy">
            <p className="workspace-kicker">PATCH NOTES & ANNOUNCEMENTS</p>
            <h2>NEWS</h2>
            <p>Game updates, balancing notes, fixes, and development commentary.</p>
          </div>
          <div className="news-heading-telemetry" aria-label="Published update archive summary">
            <div><strong>{loading ? "—" : updates.length}</strong><span>PUBLISHED POSTS</span></div>
            <div><strong className="news-current-version">{loading ? "—" : currentVersion}</strong><span>CURRENT VERSION</span></div>
            <p><i /> DEVELOPMENT FEED ONLINE</p>
          </div>
        </header>

        {loading && <div className="news-message">Loading updates…</div>}
        {error && <div className="workspace-error news-message" role="alert">{error}</div>}
        {!loading && !error && updates.length === 0 && (
          <div className="news-message">No updates have been published yet.</div>
        )}

        {!loading && !error && updates.length > 0 && (
          <div className="news-archive-tools">
            <div>
              <span>UPDATE ARCHIVE</span>
              <strong>{visibleUpdates.length} OF {updates.length}</strong>
            </div>
            <label>
              <span>Search updates</span>
              <input
                type="search"
                value={query}
                placeholder="Title, version, or author…"
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
          </div>
        )}

        {!loading && !error && updates.length > 0 && visibleUpdates.length === 0 && (
          <div className="news-message">No published update matches “{query.trim()}”.</div>
        )}

        <div className="news-card-grid">
          {visibleUpdates.map((update) => {
            const changes = entryCount(update);
            const blocks = populatedSectionCount(update);
            const isDeveloperBlog = update.contentType === "developer_blog";
            const isCompact = isDeveloperBlog || update.isMinor;
            const hasCoverImage = Boolean(update.coverImage?.downloadUrl);
            const isTextOnlyCompact = isCompact && !hasCoverImage;
            const isLatest = update.id === latestFullUpdateId;
            return (
            <article className={`news-card ${isLatest ? "is-latest" : ""} ${isCompact ? "is-compact" : ""} ${isTextOnlyCompact ? "is-text-only" : ""} type-${update.contentType}`} key={update.id}>
              {!isTextOnlyCompact && <Link className="news-card-image" to={`/news/${encodeURIComponent(update.id)}`}>
                {update.coverImage?.downloadUrl ? (
                  <img src={update.coverImage.downloadUrl} alt="" />
                ) : (
                  <span>TOWER ECLIPSE</span>
                )}
                {isLatest && <span className="news-latest-flag">LATEST UPDATE</span>}
              </Link>}
              <div className="news-card-copy">
                <div className="news-card-meta">
                  <span>{isDeveloperBlog ? "DEVELOPER BLOG" : `${update.isMinor ? "MINOR UPDATE · " : ""}VERSION ${update.version}`}</span>
                  <time dateTime={update.publishedOn ?? update.publishedAt ?? update.updatedAt}>{formatDate(update.publishedOn ?? update.publishedAt ?? update.updatedAt)}</time>
                </div>
                <h3><Link to={`/news/${encodeURIComponent(update.id)}`}>{update.title}</Link></h3>
                {!isDeveloperBlog && <div className="news-card-facts">
                  <span>{changes} {changes === 1 ? "change" : "changes"}</span>
                  <span>{blocks} {blocks === 1 ? "section" : "sections"}</span>
                </div>}
                <Link className="news-read-link" to={`/news/${encodeURIComponent(update.id)}`}>READ {isDeveloperBlog ? "BLOG" : "UPDATE"} <span>→</span></Link>
              </div>
            </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
