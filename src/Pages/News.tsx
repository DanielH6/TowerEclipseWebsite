import { useEffect, useMemo, useState } from "react";
import { loadPublishedUpdates } from "../api";
import { Link } from "../router";
import type { GameUpdate } from "../types";
import "./Updates.css";

function formatDate(value: string | null) {
  if (!value) return "Unpublished";
  return new Date(value).toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function entryCount(update: GameUpdate) {
  return update.sections.reduce((total, section) => total + section.items.length, 0);
}

function populatedSectionCount(update: GameUpdate) {
  return update.sections.filter((section) => section.items.length > 0 || section.introHtml).length;
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

  const totalChanges = updates.reduce((total, update) => total + entryCount(update), 0);
  const visibleUpdates = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return updates;
    return updates.filter((update) => [update.title, update.version, update.author.displayName]
      .some((value) => value.toLowerCase().includes(normalizedQuery)));
  }, [query, updates]);
  const latestUpdateId = updates[0]?.id;

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
            <div><strong>{loading ? "—" : updates.length}</strong><span>PUBLISHED UPDATES</span></div>
            <div><strong>{loading ? "—" : totalChanges}</strong><span>TRACKED CHANGES</span></div>
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
            const isLatest = update.id === latestUpdateId;
            return (
            <article className={`news-card ${isLatest ? "is-latest" : ""}`} key={update.id}>
              <Link className="news-card-image" to={`/news/${encodeURIComponent(update.id)}`}>
                {update.coverImage?.downloadUrl ? (
                  <img src={update.coverImage.downloadUrl} alt="" />
                ) : (
                  <span>TOWER ECLIPSE</span>
                )}
                {isLatest && <span className="news-latest-flag">LATEST UPDATE</span>}
              </Link>
              <div className="news-card-copy">
                <div className="news-card-meta">
                  <span>VERSION {update.version}</span>
                  <time dateTime={update.publishedAt ?? update.updatedAt}>{formatDate(update.publishedAt ?? update.updatedAt)}</time>
                </div>
                <h3><Link to={`/news/${encodeURIComponent(update.id)}`}>{update.title}</Link></h3>
                <div className="news-card-facts">
                  <span>{changes} {changes === 1 ? "change" : "changes"}</span>
                  <span>{blocks} {blocks === 1 ? "section" : "sections"}</span>
                </div>
                <Link className="news-read-link" to={`/news/${encodeURIComponent(update.id)}`}>READ UPDATE <span>→</span></Link>
              </div>
            </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
