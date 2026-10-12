import { useEffect, useRef, useState } from "react";
import { useAuth } from "../AuthContext";
import { apiJson } from "../api";
import { savedTime } from "../player-data";
import type { PlayerMode } from "../player-data";

type ImportRow = { userId: string; action: string; reason?: string; identitySource?: string };
type ModeProgress = { done: boolean; pending: number; pages: number; observed: number; attempts: number; created: number; updated: number; unchanged: number; skipped: number; failures: number };
type ImportTarget = { experience: string; universeId: string; projectId: string; collection: string; stores: Record<PlayerMode, string>; scope: string };
type ImportRun = { status: string; startedAt: string | null; finishedAt: string | null; sweepDay: string | null; pendingRetries: boolean | null;
  usage: { profiles: number | null; reads: number | null; writes: number | null; attempts: number | null; elapsedSeconds: number | null };
  results: { created: number | null; updated: number | null; unchanged: number | null; deferred: number | null; retried: number | null };
  limits: { profiles: number | null; reads: number | null; writes: number | null; attempts: number | null; seconds: number | null } };
type ImportStatus = { enabled: boolean; target: ImportTarget | null; progress: null | { busy: boolean; paused: boolean; leaseExpiresAt: string | null; updatedAt: string | null; modes: Record<PlayerMode, ModeProgress>; lastBatch: ImportRow[]; run: ImportRun | null } };
type ImportPreview = { token: string; mode: PlayerMode; restart: boolean; target: ImportTarget; rows: ImportRow[]; identityStatus: string; expiresAt: string;
  budget: { maxSourceHttpAttempts: number; maxIdentityRequests: number; maxPreviewSummaryReads: number; maxPreviewCheckpointReads: number;
    maxApplySummaryReads: number; maxApplySummaryWrites: number; maxApplyCheckpointReads: number; maxApplyCheckpointWrites: number; requestSeconds: number } };
const endpoint = "/api/admin/game-data/imports";
const modeName = (mode: PlayerMode) => mode === "main" ? "Main" : "Battlefront";
const rowLabel = (row: ImportRow) => `${row.action.replaceAll("_", " ")}${row.reason ? ` · ${row.reason.replaceAll("_", " ")}` : ""}`;

export default function PlayerImportPanel({ onApplied }: { onApplied: () => void }) {
  const { auth } = useAuth();
  const [status, setStatus] = useState<ImportStatus | null>(null);
  const [mode, setMode] = useState<PlayerMode>("main");
  const [restart, setRestart] = useState(false);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [working, setWorking] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const active = useRef<AbortController | null>(null);
  const csrf = auth?.csrfToken;
  useEffect(() => {
    if (auth?.user.role !== "dev") return;
    const controller = new AbortController();
    apiJson<ImportStatus>(`${endpoint}/status`, "GET", undefined, undefined, controller.signal).then(setStatus)
      .catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not load import status."); });
    return () => { controller.abort(); active.current?.abort(); };
  }, [auth?.user.role]);
  if (auth?.user.role !== "dev") return null;

  async function action(kind: "status" | "preview" | "apply") {
    if (!csrf || working) return;
    const controller = new AbortController(); active.current = controller;
    setWorking(kind); setError(""); setNotice("");
    try {
      if (kind === "preview") {
        setPreview(null); setConfirmed(false);
        const result = await apiJson<ImportPreview>(`${endpoint}/preview`, "POST", { mode, restart }, csrf, controller.signal);
        if (!controller.signal.aborted) setPreview(result);
      } else {
        if (kind === "apply") {
          if (!preview || !confirmed) return;
          const result = await apiJson<{ uncertain: boolean }>(`${endpoint}/apply`, "POST", { token: preview.token, confirmation: "IMPORT SUMMARIES" }, csrf, controller.signal);
          if (!controller.signal.aborted) {
            setNotice(result.uncertain ? "A write could not be confirmed. Refresh status and preview remaining records before retrying." : "Batch finished. Preview the next batch when ready.");
            setPreview(null); setConfirmed(false); setRestart(false); onApplied();
          }
        }
        const result = await apiJson<ImportStatus>(`${endpoint}/status`, "GET", undefined, undefined, controller.signal);
        if (!controller.signal.aborted) setStatus(result);
      }
    } catch (reason) {
      if (!controller.signal.aborted) { setError(reason instanceof Error ? reason.message : "Import request failed. Refresh status before retrying."); if (kind === "apply") { setPreview(null); setConfirmed(false); } }
    } finally { if (active.current === controller) { active.current = null; setWorking(""); } }
  }
  async function stop() {
    if (!csrf) return;
    setError("");
    try {
      await apiJson(`${endpoint}/cancel`, "POST", {}, csrf);
      active.current?.abort(); active.current = null; setWorking(""); setPreview(null); setConfirmed(false);
      setNotice("Stop requested. A submitted write may finish; remaining progress is preserved.");
      setStatus(await apiJson<ImportStatus>(`${endpoint}/status`));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not stop this batch. Refresh status."); }
  }
  return <details className="panel-card player-import-panel">
    <summary>IMPORT PLAYER SUMMARIES</summary>
    <p>Preview and apply up to five profiles at a time. Main and Battlefront have separate checkpoints. Progress survives server restarts; each batch runs only when requested.</p>
    <p className="player-muted">Repeat a mode sweep to refresh saved progress and Roblox names. Traversal is not an atomic snapshot, so index coverage remains unknown. Missing or failed reads never delete summaries.</p>
    {error && <p className="player-warning" role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    <div className="button-row"><button className="ghost-link" disabled={!!working} onClick={() => void action("status")}>REFRESH IMPORT STATUS</button>
      {(working || status?.progress?.busy) && <button className="ghost-link" onClick={() => void stop()}>STOP IMPORT</button>}</div>
    {!status && !error && <p role="status">Loading import status…</p>}
    {status && !status.enabled && <p className="player-muted">Imports are disabled. Enable the server import setting after setup review.</p>}
    {status?.enabled && <>
      {status.progress?.run && <section className="player-import-preview" aria-label="Unattended import status">
        <h3>LAST PRIVATE RUN</h3><p>{status.progress.run.status.replaceAll("_", " ")} · Sweep day {status.progress.run.sweepDay ?? "Unknown"}</p>
        <p className="player-muted">Started {savedTime(status.progress.run.startedAt)} · Finished {savedTime(status.progress.run.finishedAt)}.
          Recorded through the last checkpoint: {status.progress.run.usage.profiles ?? "—"} profiles, {status.progress.run.usage.reads ?? "—"} read units,{" "}
          {status.progress.run.usage.writes ?? "—"} writes, {status.progress.run.usage.attempts ?? "—"} HTTP attempts.</p>
        <p className="player-muted">Run limits: {status.progress.run.limits.profiles} profiles · {status.progress.run.limits.reads} read units · {status.progress.run.limits.writes} writes · {status.progress.run.limits.attempts} HTTP attempts · {status.progress.run.limits.seconds} seconds.</p>
        <p>{status.progress.run.results.created ?? 0} created · {status.progress.run.results.updated ?? 0} updated · {status.progress.run.results.unchanged ?? 0} unchanged · {status.progress.run.results.deferred ?? 0} deferred attempts · {status.progress.run.results.retried ?? 0} retries</p>
        {status.progress.run.pendingRetries !== false && <p className="player-warning">Retry records may remain. A finished traversal does not establish full or current coverage.</p>}
      </section>}
      {status.progress && <ul className="player-import-progress">{(["main", "battlefront"] as PlayerMode[]).map(item => {
        const value = status.progress!.modes[item];
        return <li key={item}><strong>{modeName(item)}: {value.done ? "Traversal ended" : value.pending ? `${value.pending} pending in current page` : "Ready to continue"}</strong>
          <span>{value.pages} pages · {value.observed} observed keys · {value.created} created · {value.updated} updated · {value.unchanged} unchanged · {value.skipped} skipped · {value.failures} failed attempts</span></li>;
      })}</ul>}
      {status.progress?.busy && <p role="status">A batch holds the import lease until {savedTime(status.progress.leaseExpiresAt)}. Refresh status to check progress.</p>}
      <div className="player-import-controls"><label className="filter-field"><span>IMPORT MODE</span><select value={mode} disabled={!!working} onChange={event => { setMode(event.target.value as PlayerMode); setPreview(null); setConfirmed(false); setRestart(false); }}>
        <option value="main">Main</option><option value="battlefront">Battlefront</option></select></label>
        <label className="player-import-check"><input type="checkbox" checked={restart} disabled={!!working} onChange={event => { setRestart(event.target.checked); setPreview(null); setConfirmed(false); }} />Start a new sweep from the first page</label>
        <button className="primary-action" disabled={!!working || status.progress?.busy} onClick={() => void action("preview")}>{working === "preview" ? "READING PREVIEW…" : "PREVIEW NEXT BATCH"}</button></div>
      {preview && <section className="player-import-preview" aria-label="Reviewed import batch">
        <h3>REVIEW {modeName(preview.mode).toUpperCase()} BATCH</h3>
        <p>{preview.target.experience} · Universe {preview.target.universeId} · {preview.target.stores[preview.mode]} · Scope {preview.target.scope}</p>
        <p className="player-muted">Destination: {preview.target.projectId} / {preview.target.collection}. {preview.restart ? "Starts a new mode sweep; existing summaries are retained." : "Continues the saved mode checkpoint."} Preview expires {savedTime(preview.expiresAt)}.</p>
        <p className="player-muted">Preview: zero writes; at most {preview.budget.maxSourceHttpAttempts} source HTTP attempts, {preview.budget.maxIdentityRequests} name lookup, {preview.budget.maxPreviewSummaryReads + preview.budget.maxPreviewCheckpointReads} Firestore reads.
          Apply: at most {preview.budget.maxApplySummaryWrites} summary writes, {preview.budget.maxApplyCheckpointWrites} checkpoint writes and {preview.budget.maxApplySummaryReads + preview.budget.maxApplyCheckpointReads} Firestore reads. Each request has an {preview.budget.requestSeconds}-second budget.</p>
        <ul>{preview.rows.map(row => <li key={row.userId}><strong>UserId {row.userId}</strong> — {rowLabel(row)}{row.identitySource && <span> · {row.identitySource === "roblox_users_api" ? "Roblox names" : "Unverified saved names"}</span>}</li>)}</ul>
        {!preview.rows.length && <p>No player keys on this source page. Apply to advance only the checkpoint.</p>}
        {preview.identityStatus === "unavailable_saved_names_preserved" && <p className="player-warning">Name lookup was unavailable. Existing Roblox names or unverified saved names are preserved.</p>}
        <label className="player-import-check"><input type="checkbox" checked={confirmed} disabled={!!working} onChange={event => setConfirmed(event.target.checked)} />I confirm this batch and its displayed destination and write budget.</label>
        <button className="primary-action" disabled={!confirmed || !!working} onClick={() => void action("apply")}>{working === "apply" ? "APPLYING BATCH…" : "APPLY REVIEWED BATCH"}</button>
      </section>}
      {status.progress?.lastBatch.length ? <div className="player-muted"><strong>Last batch</strong><ul>{status.progress.lastBatch.map(row => <li key={row.userId}>UserId {row.userId} — {rowLabel(row)}</li>)}</ul></div> : null}
    </>}
  </details>;
}
