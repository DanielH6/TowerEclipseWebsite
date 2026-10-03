import { useEffect, useState } from "react";
import { apiJson } from "../api";
import { Link } from "../router";
import type { AchievementChange, ListHistory, ListPublication } from "../../shared/achievement-list.mjs";
import { achievementThumbnailUrl, formatVerificationDate } from "../../shared/achievement-list.mjs";
import { DifficultyBadge } from "./AchievementDifficulty";

const fieldLabels = { name: "Name", difficulty: "Difficulty", verifier: "Verifier", requirements: "Completion requirements", videoUrl: "Verification video", verifiedOn: "Verification date", verifiedVersion: "Verified game version", thumbnailId: "Thumbnail override", completionMode: "Completion mode" };
function ChangeValue({ field, value }: { field: keyof typeof fieldLabels; value: string | number | null }) {
  if (field === "thumbnailId") return value ? <a href={achievementThumbnailUrl(String(value))} target="_blank" rel="noopener noreferrer">View uploaded thumbnail ↗</a> : <span className="change-unset">Automatic thumbnail</span>;
  if (value === null || value === "") return <span className="change-unset">Not set</span>;
  if (field === "completionMode") return <span>{value === "solo" ? "Solo" : "Grouped"}</span>;
  if (field === "difficulty" && typeof value === "number") return <DifficultyBadge value={value} />;
  if (field === "verifiedOn" && typeof value === "string") return <time dateTime={value}>{formatVerificationDate(value)}</time>;
  return <span>{value}</span>;
}

function ChangeDetails({ change, active }: { change: AchievementChange; active: boolean }) {
  const movement = change.fromPosition !== change.toPosition;
  return <li className={`list-change list-change-${change.kind}`}>
    <span className="list-change-marker" aria-hidden="true">{change.kind === "added" ? "+" : change.kind === "removed" ? "−" : movement ? "↕" : "✎"}</span>
    <div className="list-change-content"><header><strong>{active ? <Link to={`/list#achievement-${change.id}`}>{change.name}</Link> : change.name}</strong><span className="list-change-kind">{change.kind === "updated" && !change.fields.length ? "Moved" : change.kind}</span></header>
      <p className="list-change-position">{change.completionMode && <span className="list-change-mode">{change.completionMode === "solo" ? "SOLO" : "GROUPED"} · </span>}{change.kind === "added" ? `Added at #${change.toPosition}` : change.kind === "removed" ? `Removed from #${change.fromPosition}` : movement ? `#${change.fromPosition} → #${change.toPosition}` : `Position #${change.toPosition} unchanged`}</p>
      {change.fields.some(field => field.field === "difficulty") && <div className="list-rating-change">{change.fields.filter(field => field.field === "difficulty").map(field => <div key={field.field}>{field.before !== null && <DifficultyBadge value={Number(field.before)} />}{field.before !== null && field.after !== null && <span aria-label="changed to">→</span>}{field.after !== null && <DifficultyBadge value={Number(field.after)} />}</div>)}</div>}
      {change.fields.length > 0 && <details className="list-change-details"><summary>{change.kind === "updated" ? `View ${change.fields.length} field ${change.fields.length === 1 ? "change" : "changes"}` : "View achievement details"}</summary>
        <dl>{change.fields.map(field => <div key={field.field}><dt>{fieldLabels[field.field]}</dt><dd>{change.kind !== "added" && <div><small>BEFORE</small><ChangeValue field={field.field} value={field.before} /></div>}{change.kind !== "removed" && <div><small>AFTER</small><ChangeValue field={field.field} value={field.after} /></div>}</dd></div>)}</dl>
      </details>}
    </div>
  </li>;
}

export default function AchievementChangeLog({ activeIds }: { activeIds: Set<string> }) {
  const [publications, setPublications] = useState<ListPublication[]>([]);
  const [cursor, setCursor] = useState<string | undefined>();
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError("");
    apiJson<ListHistory>(`/api/list/history${cursor ? `?before=${encodeURIComponent(cursor)}` : ""}`, "GET", undefined, undefined, controller.signal).then(result => {
      if (controller.signal.aborted) return;
      setPublications(current => cursor ? [...new Map([...current, ...result.publications].map(item => [item.id, item])).values()] : result.publications);
      setNextCursor(result.nextCursor);
    }).catch(reason => { if (!controller.signal.aborted) setError(reason.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [cursor, retry]);
  return <section className="list-history" aria-label="Public change log">
    <header className="list-section-heading"><div><p className="achievement-kicker">THE LIST, THROUGH TIME</p><h3>Change Log</h3><p>Every published addition, removal, rerating, and edit. Recorded automatically when an admin updates the list.</p></div><span className="list-history-seal">PUBLIC RECORD</span></header>
    <ol className="list-publications">{publications.map(publication => <li className="list-publication" key={publication.id}>
      <header><div><span className="list-revision">REVISION {String(publication.revision).padStart(2, "0")}</span><h4>{publication.changes.length} achievement{publication.changes.length === 1 ? "" : "s"} updated</h4><p>Published by <strong>{publication.editorName}</strong></p></div><time dateTime={publication.createdAt}>{new Date(publication.createdAt).toLocaleString()}</time></header>
      {publication.note && <p className="list-publication-note">{publication.note}</p>}
      <ol className="list-changes">{publication.changes.map(change => <ChangeDetails key={change.id} change={change} active={activeIds.has(change.id)} />)}</ol>
    </li>)}</ol>
    {loading && <p role="status" className="list-history-status">Loading changes…</p>}
    {error && <div role="alert" className="list-alert error"><p>{error}</p><button className="list-button secondary" onClick={() => setRetry(value => value + 1)}>RETRY CHANGE LOG</button></div>}
    {!loading && !error && !publications.length && <div className="achievement-empty"><span className="achievement-empty-mark">↕</span><h3>The story starts here.</h3><p>Future list publications will appear here, with every change recorded.</p></div>}
    {!loading && !error && nextCursor && <button className="list-button secondary list-history-more" onClick={() => setCursor(nextCursor)}>LOAD OLDER CHANGES ↓</button>}
  </section>;
}
