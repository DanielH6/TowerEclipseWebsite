import { useEffect, useState } from "react";
import { loadPlayerProfile, playerNumber, savedTime } from "../player-data";
import type { PlayerProfile, SavedPlayerMode } from "../player-data";

const fields = [
  ["level", "Level"], ["eclipseLevel", "Eclipse level"], ["gamesPlayed", "Games played"],
  ["rankedISR", "Ranked ISR"], ["credits", "Credits"], ["cores", "Cores"], ["tokens", "Tokens"],
  ["triumphsTotal", "Triumphs"], ["normalTriumphs", "Normal triumphs"], ["hardTriumphs", "Hard triumphs"],
  ["masteryTriumphs", "Mastery triumphs"], ["endlessRecordWave", "Endless wave"],
  ["personalEnemyKillsTotal", "Personal enemy kills"],
] as const;

function SavedModePanel({ title, mode }: { title: string; mode: SavedPlayerMode }) {
  const stale = mode.freshness?.status === "stale";
  const statusLabel = stale ? "STALE SNAPSHOT"
    : mode.status === "ready" ? "SAVED SNAPSHOT"
      : mode.status === "missing" ? "NO SAVED PROFILE" : "UNAVAILABLE";
  return (
    <article className="panel-card player-mode" aria-label={`${title} saved profile`}>
      <div className="player-panel-heading"><h3>{title.toUpperCase()}</h3>
        <span className={`player-state${stale ? " is-stale" : ""}`}>{statusLabel}</span></div>
      {mode.status === "missing" && <p>No saved {title} profile was found for this UserId. A missing profile is not a record of zero progress.</p>}
      {mode.status === "unavailable" && <p role="status">{mode.message ?? "This mode is temporarily unavailable."}</p>}
      {mode.status === "ready" && mode.summary && <>
        <p className="player-muted">Last Roblox save: {savedTime(mode.freshness?.sourceUpdatedAt)}<br />Checked: {savedTime(mode.freshness?.lastCheckedAt)} · Cache age {mode.freshness?.cacheAgeSeconds ?? 0}s</p>
        {stale && <p className="player-warning" role="status">{mode.freshness?.reason} Active gameplay may be newer.</p>}
        <dl className="player-stat-grid">
          {fields.filter(([key]) => key in mode.summary!.stats).map(([key, label]) => (
            <div key={key}><dt>{label}</dt><dd>{playerNumber(mode.summary!.stats[key])}</dd></div>
          ))}
        </dl>
        <p className="player-muted">Unknown fields use —. Saved names are not a verified Roblox identity.</p>
        {mode.detail === null && <p className="player-muted">Expanded saved record is unavailable until its field schema is approved.</p>}
        {mode.detail !== null && <details className="player-record"><summary>REDACTED SAVED RECORD</summary>
          <p>Credentials, session metadata, reservation codes, receipts, private messages and unrelated identities are excluded. {mode.removedFields ?? 0} sensitive fields removed.</p>
          <pre tabIndex={0} aria-label={`${title} redacted saved record`}>{JSON.stringify(mode.detail, null, 2)}</pre></details>}
      </>}
    </article>
  );
}

export default function SavedPlayerProfile({ userId }: { userId: string }) {
  const [data, setData] = useState<PlayerProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setData(null); setError("");
    loadPlayerProfile(userId, controller.signal)
      .then(value => { if (!controller.signal.aborted) setData(value); })
      .catch((reason: unknown) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not read this saved profile."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [userId, revision]);
  return (
    <section className="player-profile" aria-label="Selected player profile" aria-busy={loading}>
      <div className="player-profile-heading"><div><p className="workspace-kicker">SAVED PLAYER DATA</p>
        <h3>{data?.main.summary?.identity.displayName ?? data?.battlefront.summary?.identity.displayName ?? `UserId ${userId}`}</h3>
        <p className="player-muted">Roblox UserId: {userId}</p></div>
        <button className="ghost-link" disabled={loading} onClick={() => setRevision(value => value + 1)}>REFRESH PROFILE</button></div>
      {loading && <p role="status">Loading saved profiles…</p>}
      {error && <div className="workspace-error" role="alert"><p>{error}</p>
        <button className="primary-action" onClick={() => setRevision(value => value + 1)}>TRY AGAIN</button></div>}
      {data && !loading && <>{data.synthetic && <p className="player-warning">SYNTHETIC PREVIEW — these records are fictional.</p>}<p className="player-muted">Read-only saved data. This viewer does not change progress or acquire a game session.</p>
        <div className="player-mode-grid"><SavedModePanel title="Main" mode={data.main} />
          <SavedModePanel title="Battlefront" mode={data.battlefront} /></div></>}
    </section>
  );
}
