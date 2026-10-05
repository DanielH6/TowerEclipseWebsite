import { useEffect, useRef, useState } from "react";
import { apiJson, discardAchievementThumbnail } from "../api";
import { useAuth } from "../AuthContext";
import { Link } from "../router";
import { achievementCompletionMode, LIST_LIMIT, THEORETICAL_LIMIT, validateListEntries, youtubeVideoId, type AchievementEntry, type AchievementList } from "../../shared/achievement-list.mjs";
import { AchievementCard } from "./AchievementList";
import { DifficultyBadge, DifficultySpectrum } from "../Components/AchievementDifficulty";
import AchievementThumbnailEditor from "../Components/AchievementThumbnailEditor";
import { AchievementModeIcon } from "../Components/AchievementMode";
import "./AchievementList.css";

export default function AdminListPage() {
  const { auth } = useAuth();
  const [published, setPublished] = useState<AchievementList | null>(null);
  const [entries, setEntries] = useState<AchievementEntry[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [publicationNote, setPublicationNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const locked = busy || uploading;
  const uploadedThumbnails = useRef(new Set<string>());
  const csrfRef = useRef(auth?.csrfToken);
  csrfRef.current = auth?.csrfToken;
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const entriesChanged = !!published && JSON.stringify(entries) !== JSON.stringify(published.entries);
  const dirty = entriesChanged || publicationNote.length > 0 || uploading;
  const selected = entries.find(entry => entry.id === selectedId);
  const selectedIndex = entries.findIndex(entry => entry.id === selectedId);
  const theoreticalCount = entries.filter(entry => entry.theoretical).length;
  const verifiedCount = entries.length - theoreticalCount;
  const full = entries.length >= LIST_LIMIT + THEORETICAL_LIMIT;

  function releaseDraftThumbnails(publishedIds = new Set<string>()) {
    for (const id of uploadedThumbnails.current) {
      if (!publishedIds.has(id) && csrfRef.current) void discardAchievementThumbnail(id, csrfRef.current);
    }
    uploadedThumbnails.current.clear();
  }
  useEffect(() => () => {
    for (const id of uploadedThumbnails.current) {
      if (csrfRef.current) void discardAchievementThumbnail(id, csrfRef.current);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError("");
    apiJson<AchievementList>("/api/list", "GET", undefined, undefined, controller.signal).then(result => {
      if (controller.signal.aborted) return;
      setPublished(result); setEntries(result.entries); setSelectedId(result.entries[0]?.id ?? ""); setPublicationNote("");
    }).catch(reason => { if (!controller.signal.aborted) setError(reason.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [reload]);

  useEffect(() => {
    if (!dirty) return;
    const leave = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    const navigate = (event: MouseEvent) => {
      const link = (event.target as Element).closest?.("a[href]") as HTMLAnchorElement | null;
      if (!link || link.target === "_blank" || event.metaKey || event.ctrlKey || event.shiftKey || link.hash) return;
      if (!window.confirm("Leave without publishing your list changes?")) { event.preventDefault(); event.stopPropagation(); }
    };
    window.addEventListener("beforeunload", leave); document.addEventListener("click", navigate, true);
    return () => { window.removeEventListener("beforeunload", leave); document.removeEventListener("click", navigate, true); };
  }, [dirty]);

  function update(patch: Partial<AchievementEntry>) {
    setEntries(current => current.map(entry => entry.id === selectedId ? { ...entry, ...patch } : entry)); setNotice("");
  }
  function move(from: number, to: number) {
    if (from < 0 || to < 0 || to >= entries.length || from === to) return;
    setEntries(current => { const next = [...current]; const [entry] = next.splice(from, 1); if (entry) next.splice(to, 0, entry); return next; }); setNotice("");
  }
  function add() {
    if (full) return;
    const entry: AchievementEntry = { id: crypto.randomUUID(), name: "", completionMode: "solo", theoretical: verifiedCount >= LIST_LIMIT, verifier: "", verifiedOn: "", verifiedVersion: "", difficulty: 0, videoUrl: "", requirements: "" };
    setEntries(current => [...current, entry]); setSelectedId(entry.id); setNotice("");
  }
  function remove() {
    if (!selected || !window.confirm(`Remove “${selected.name || "Untitled achievement"}” from the list? This takes effect when you publish.`)) return;
    const next = entries.filter(entry => entry.id !== selectedId); setEntries(next); setSelectedId(next[Math.min(selectedIndex, next.length - 1)]?.id ?? ""); setNotice("");
  }
  function reloadPublished() {
    if (dirty && !window.confirm("Discard your unpublished changes and reload the published list?")) return;
    releaseDraftThumbnails();
    setNotice(""); setReload(value => value + 1);
  }
  async function publish() {
    if (!auth || !published || locked) return;
    setError(""); setNotice("");
    try {
      const validated = validateListEntries(entries);
      if (!entries.length && published.entries.length && !window.confirm("Publish an empty list? All current achievements will be removed from the public list.")) return;
      setBusy(true);
      const result = await apiJson<AchievementList>("/api/list", "PUT", { entries: validated, revision: published.revision, note: publicationNote }, auth.csrfToken);
      releaseDraftThumbnails(new Set(result.entries.map(entry => entry.thumbnailId).filter((id): id is string => !!id)));
      setPublished(result); setEntries(result.entries); setPublicationNote(""); setNotice(result.revision === published.revision ? "No ranking changes to publish." : "List published. Rankings and the public change log are up to date.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not publish the list."); }
    finally { setBusy(false); }
  }

  return <main className="achievement-page"><div className="achievement-container">
    <header className="list-admin-header"><div><p className="achievement-kicker">ADMIN // ACHIEVEMENT RANKINGS</p><h2>LIST CONTROL</h2><p>Curate verified and theoretical achievements. Edit, reorder, then publish your changes together.</p></div><Link to="/list" className="list-button secondary">VIEW PUBLIC LIST ↗</Link></header>
    <div className="list-publish-bar"><div><strong>{verifiedCount} / {LIST_LIMIT} verified · {theoreticalCount} / {THEORETICAL_LIMIT} theoretical</strong><span>{dirty ? "Unpublished changes" : published?.updatedAt ? `Last published ${new Date(published.updatedAt).toLocaleString()}` : "Ready for the first rankings"}</span></div><div className="list-button-row"><button className="list-button secondary" disabled={locked || loading} onClick={reloadPublished}>RELOAD PUBLISHED</button><button className="list-button" disabled={!entriesChanged || locked || loading} onClick={() => void publish()}>{busy ? "PUBLISHING…" : "PUBLISH LIST"}</button></div></div>
    {error && <p className="list-alert error" role="alert">{error}{!published && !loading && <button className="list-button secondary" onClick={reloadPublished}>TRY AGAIN</button>}</p>}
    {notice && <p className="list-alert" role="status">{notice}</p>}
    {loading ? <p role="status">Loading list editor…</p> : published && <>
      <div className="list-publication-controls"><label className="list-field">Public change note (optional)<textarea rows={2} maxLength={500} value={publicationNote} disabled={locked} onChange={event => setPublicationNote(event.target.value)} placeholder="Explain a rerating, new verification, or ranking decision…" /><small>All published changes are logged automatically with your display name and timestamp. This note is public. {publicationNote.length}/500</small></label><Link to="/list?view=changes">VIEW CHANGE LOG ↗</Link></div>
      <details className="list-rating-reference"><summary>Difficulty & tier reference</summary><DifficultySpectrum /></details>
      <fieldset className="list-editor-workspace" disabled={locked}>
        <legend className="sr-only">Edit achievement rankings</legend>
        <aside className="list-editor-order"><div className="list-order-heading"><h3>RANKING ORDER</h3><button className="list-button secondary" disabled={full} onClick={add}>+ ADD</button></div><p>#1 is hardest. This is the combined order; the verified Top 50 skips theoretical entries.</p>
          {entries.length ? <ol>{entries.map((entry, index) => <li key={entry.id}><button className={entry.id === selectedId ? "active" : ""} aria-pressed={entry.id === selectedId} onClick={() => setSelectedId(entry.id)}><span>#{String(index + 1).padStart(2, "0")}</span><strong>{entry.name || "Untitled achievement"}{achievementCompletionMode(entry) && <small className="list-order-mode">{achievementCompletionMode(entry).toUpperCase()}</small>}{entry.theoretical && <small className="list-order-mode list-order-theoretical">THEORETICAL</small>}</strong></button></li>)}</ol> : <div className="list-order-empty"><p>No achievements yet.</p><button className="list-button" onClick={add}>ADD FIRST ACHIEVEMENT</button></div>}
          {full && <p>Both lists are full. Remove an entry before adding a replacement.</p>}
        </aside>
        <section className="list-entry-editor" aria-label="Achievement details">{selected ? <>
          <div className="list-entry-heading"><div><p className="achievement-kicker">EDITING #{String(selectedIndex + 1).padStart(2, "0")}</p><h3>{selected.name || "New achievement"}</h3></div><button className="list-button danger" onClick={remove}>REMOVE</button></div>
          <div className="list-edit-grid">
            <label className="list-field full">Achievement name<input maxLength={120} value={selected.name} onChange={event => update({ name: event.target.value })} placeholder="Name of the achievement" required /></label>
            <div className="list-theoretical-control"><label className="achievement-video-filter"><input type="checkbox" checked={selected.theoretical === true} onChange={event => update({ theoretical: event.target.checked })} aria-describedby="achievement-theoretical-help" />Theoretical achievement</label><p id="achievement-theoretical-help">{selected.theoretical ? "Theoretically possible, but unverified. Appears in Theoretical mode with a clear label. No verifier or verification link required." : "Verified achievement. Appears in both the Top 50 and Theoretical mode. Turn this on for a challenge awaiting verification."}</p></div>
            <fieldset className="list-mode-toggle"><legend>Completion mode</legend><div>{(["solo", "grouped"] as const).map(mode => <label key={mode}><input className="sr-only" type="radio" name="achievement-completion-mode" value={mode} checked={achievementCompletionMode(selected) === mode} onChange={() => update({ completionMode: mode })} /><span><AchievementModeIcon mode={mode} /><b>{mode === "solo" ? "Solo" : "Grouped"}</b></span></label>)}</div><p>{achievementCompletionMode(selected) ? "Shown on the card. Solo and Grouped can share a name and have separate ranks and ratings." : "Choose Solo or Grouped for this achievement."}</p></fieldset>
            <label className="list-field">Position<select value={selectedIndex} onChange={event => move(selectedIndex, Number(event.target.value))}>{entries.map((entry, index) => <option value={index} key={entry.id}>#{index + 1}{index === 0 ? " — Hardest" : ""}</option>)}</select></label>
            <div className="list-field"><span>Quick reorder</span><div className="list-button-row"><button className="list-button secondary" disabled={selectedIndex === 0} onClick={() => move(selectedIndex, selectedIndex - 1)}>↑ MOVE UP</button><button className="list-button secondary" disabled={selectedIndex === entries.length - 1} onClick={() => move(selectedIndex, selectedIndex + 1)}>↓ MOVE DOWN</button></div></div>
            <div className="list-field"><label htmlFor="achievement-rating">Difficulty rating</label><input id="achievement-rating" type="number" min={0} step={0.1} value={Number.isFinite(selected.difficulty) ? selected.difficulty : ""} onChange={event => update({ difficulty: event.target.value === "" ? NaN : Number(event.target.value) })} required aria-describedby="achievement-rating-help" /><DifficultyBadge value={selected.difficulty} /><small id="achievement-rating-help">0.0 and above, in steps of 0.1. 8.0+ is Eclipse. Rank is set separately.</small></div>
            {!selected.theoretical && <>
            <label className="list-field">Verifier<input maxLength={80} value={selected.verifier} onChange={event => update({ verifier: event.target.value })} placeholder="Player who verified the achievement" required /></label>
            <label className="list-field">Verification date (optional)<input type="date" value={selected.verifiedOn ?? ""} onChange={event => update({ verifiedOn: event.target.value })} /></label>
            <label className="list-field">Verified game version (optional)<input maxLength={40} value={selected.verifiedVersion ?? ""} onChange={event => update({ verifiedVersion: event.target.value })} placeholder="e.g. v0.4.1" /></label>
            </>}
            <label className="list-field full">YouTube {selected.theoretical ? "showcase" : "verification"} link <span className="list-optional">(optional)</span><input type="url" maxLength={500} value={selected.videoUrl} onChange={event => update({ videoUrl: event.target.value })} placeholder="https://www.youtube.com/watch?v=…" aria-invalid={!!selected.videoUrl.trim() && !youtubeVideoId(selected.videoUrl)} /><small>{selected.videoUrl.trim() && !youtubeVideoId(selected.videoUrl) ? "Enter a valid YouTube video link." : selected.theoretical ? "Optional strategy or showcase footage. This does not mark the achievement as verified." : "Thumbnails appear automatically. Watch, share, Shorts, and live video links are supported."}</small></label>
            {auth && <AchievementThumbnailEditor key={selected.id} entryId={selected.id} thumbnailId={selected.thumbnailId} csrfToken={auth.csrfToken} onChange={thumbnailId => { if (thumbnailId) uploadedThumbnails.current.add(thumbnailId); update({ thumbnailId }); }} onBusyChange={setUploading} />}
            <label className="list-field full">Completion requirements <span className="list-optional">(optional)</span><textarea rows={5} maxLength={2000} value={selected.requirements} onChange={event => update({ requirements: event.target.value })} placeholder="Map, mode, allowed towers, player count, and any special rules…" /><small>{selected.requirements.length}/2000 characters</small></label>
          </div>
        </> : <div className="achievement-empty"><h3>Build the rankings.</h3><p>Add an achievement to start. Changes stay unpublished until you press Publish list.</p></div>}</section>
      </fieldset>
      {selected && <section className="list-live-preview" aria-label="Card preview"><p className="achievement-kicker">LIVE CARD PREVIEW // THEORETICAL MODE</p><AchievementCard entry={{ ...selected, name: selected.name || "Untitled achievement", verifier: selected.verifier || "Verifier name" }} position={selectedIndex + 1} includeTheoretical /></section>}
    </>}
  </div></main>;
}
