import { useEffect, useState } from "react";
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

export default function News() {
  const [updates, setUpdates] = useState<GameUpdate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <section className="content-band news-page">
      <div className="news-page-inner">
        <header className="news-heading">
          <p className="workspace-kicker">PATCH NOTES & ANNOUNCEMENTS</p>
          <h2>NEWS</h2>
          <p>Game updates, balancing notes, fixes, and development commentary.</p>
        </header>

        {loading && <div className="news-message">Loading updates…</div>}
        {error && <div className="workspace-error news-message" role="alert">{error}</div>}
        {!loading && !error && updates.length === 0 && (
          <div className="news-message">No updates have been published yet.</div>
        )}

        <div className="news-card-grid">
          {updates.map((update) => (
            <article className="news-card" key={update.id}>
              <Link className="news-card-image" to={`/news/${encodeURIComponent(update.id)}`}>
                {update.coverImage?.downloadUrl ? (
                  <img src={update.coverImage.downloadUrl} alt="" />
                ) : (
                  <span>TOWER ECLIPSE</span>
                )}
              </Link>
              <div className="news-card-copy">
                <div className="news-card-meta">
                  <span>VERSION {update.version}</span>
                  <time dateTime={update.publishedAt ?? update.updatedAt}>{formatDate(update.publishedAt ?? update.updatedAt)}</time>
                </div>
                <h3><Link to={`/news/${encodeURIComponent(update.id)}`}>{update.title}</Link></h3>
                <p>{entryCount(update)} documented changes</p>
                <Link className="news-read-link" to={`/news/${encodeURIComponent(update.id)}`}>READ UPDATE →</Link>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
