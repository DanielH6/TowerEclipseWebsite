import { useEffect, useState } from "react";
import { createGameUpdate, deleteGameUpdate, loadAdminUpdates } from "../api";
import { useAuth } from "../AuthContext";
import { Link, useNavigate } from "../router";
import type { GameUpdate } from "../types";
import "./Updates.css";

function formatDate(value: string | null) {
  if (!value) return "Not published";
  return new Date(value).toLocaleString();
}

export default function AdminUpdatesPage() {
  const { auth } = useAuth();
  const navigate = useNavigate();
  const [updates, setUpdates] = useState<GameUpdate[]>([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      setUpdates(await loadAdminUpdates());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load updates.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  return (
    <section className="workspace-page updates-admin-page">
      <div className="workspace-header">
        <div>
          <p className="workspace-kicker">DEVELOPER ADMIN</p>
          <h2>UPDATE EDITOR</h2>
          <p>Create structured patch notes with WYSIWYG fields, images, figure numbering, and draft publishing.</p>
        </div>
        <div className="workspace-header-actions">
          <Link className="ghost-link" to="/admin">DICTIONARIES</Link>
          <button
            className="primary-action"
            type="button"
            disabled={!auth || working}
            onClick={async () => {
              if (!auth) return;
              setWorking(true);
              setError(null);
              try {
                const update = await createGameUpdate(auth.csrfToken);
                navigate(`/admin/updates/${encodeURIComponent(update.id)}`);
              } catch (reason) {
                setError(reason instanceof Error ? reason.message : "Could not create an update draft.");
              } finally {
                setWorking(false);
              }
            }}
          >
            {working ? "CREATING…" : "CREATE UPDATE"}
          </button>
        </div>
      </div>

      {error && <div className="workspace-error updates-page-error" role="alert">{error}</div>}

      <div className="update-admin-list">
        {loading && <div className="panel-card table-message">Loading updates…</div>}
        {!loading && updates.length === 0 && (
          <div className="panel-card empty-update-list">
            <h3>NO UPDATES YET</h3>
            <p>Create a draft to start building the first structured update.</p>
          </div>
        )}
        {!loading && updates.map((update) => (
          <article className="panel-card update-admin-card" key={update.id}>
            <div className="update-admin-thumbnail">
              {update.coverImage?.downloadUrl ? (
                <img src={update.coverImage.downloadUrl} alt="" />
              ) : (
                <span>NO COVER</span>
              )}
            </div>
            <div className="update-admin-copy">
              <div className="update-admin-title-row">
                <h3>{update.title}</h3>
                <span className={`update-state ${update.status}`}>{update.status.toUpperCase()}</span>
              </div>
              <p>Version {update.version || "not set"}</p>
              <small>
                Last edited {formatDate(update.updatedAt)} · Published {formatDate(update.publishedAt)}
              </small>
            </div>
            <div className="update-admin-actions">
              <Link className="ghost-link" to={`/admin/updates/${encodeURIComponent(update.id)}`}>EDIT</Link>
              {update.status === "published" && (
                <Link className="ghost-link" to={`/news/${encodeURIComponent(update.id)}`}>VIEW</Link>
              )}
              <button
                className="danger-action"
                type="button"
                disabled={!auth || working}
                onClick={async () => {
                  if (!auth || !window.confirm(`Delete ${update.title}? Its R2 images will also be removed.`)) return;
                  setWorking(true);
                  setError(null);
                  try {
                    await deleteGameUpdate(update.id, auth.csrfToken);
                    setUpdates((current) => current.filter((item) => item.id !== update.id));
                  } catch (reason) {
                    setError(reason instanceof Error ? reason.message : "Could not delete the update.");
                  } finally {
                    setWorking(false);
                  }
                }}
              >
                DELETE
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
