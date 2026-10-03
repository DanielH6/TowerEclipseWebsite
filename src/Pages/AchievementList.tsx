import { useEffect, useMemo, useState } from "react";
import { apiJson } from "../api";
import { useAuth } from "../AuthContext";
import { Link, useLocation, useNavigate } from "../router";
import { difficultyRating, formatVerificationDate, youtubeVideoId, type AchievementEntry, type AchievementList } from "../../shared/achievement-list.mjs";
import { DifficultyBadge, DifficultySpectrum, difficultyStyle } from "../Components/AchievementDifficulty";
import AchievementChangeLog from "../Components/AchievementChangeLog";
import "./AchievementList.css";

export function AchievementCard({ entry, position }: { entry: AchievementEntry; position: number }) {
  const videoId = youtubeVideoId(entry.videoUrl);
  const rating = difficultyRating(entry.difficulty);
  const [failedImage, setFailedImage] = useState<string | null>(null);
  const thumbnail = <>
    {videoId && failedImage !== videoId
      ? <img src={`https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`} alt="" loading="lazy" onError={() => setFailedImage(videoId)} />
      : <div className="achievement-placeholder"><img src="/favicon.png" alt="" /><span>TOWER ECLIPSE</span></div>}
    <span className="achievement-video-label">{videoId ? "▶ WATCH VERIFICATION ↗" : "VIDEO NOT ADDED"}</span>
  </>;
  return <article className={`achievement-card ${position === 1 ? "achievement-first" : ""} ${rating?.eclipse ? "achievement-eclipse" : ""}`} style={difficultyStyle(rating?.color ?? "#76bdff")} id={`achievement-${entry.id}`}>
    <div className="achievement-rank" aria-label={`Rank ${position}`}><small>RANK</small><strong>#{String(position).padStart(2, "0")}</strong></div>
    {videoId ? <a className="achievement-thumbnail" href={`https://www.youtube.com/watch?v=${videoId}`} target="_blank" rel="noopener noreferrer" aria-label={`Watch ${entry.name} verification on YouTube`}>{thumbnail}</a> : <div className="achievement-thumbnail">{thumbnail}</div>}
    <div className="achievement-copy">
      <p className="achievement-kicker">{position === 1 ? "THE SUMMIT" : "TOP 50 ACHIEVEMENT"}</p>
      <h3><a href={`#achievement-${entry.id}`}>{entry.name}</a></h3>
      <p className="achievement-verifier">Verified by <strong>{entry.verifier}</strong></p>
      <dl className="achievement-verification-meta"><div><dt>VERIFIED ON</dt><dd>{entry.verifiedOn ? <time dateTime={entry.verifiedOn}>{formatVerificationDate(entry.verifiedOn)}</time> : "Not recorded"}</dd></div><div><dt>GAME VERSION</dt><dd>{entry.verifiedVersion || "Not recorded"}</dd></div></dl>
      {entry.requirements && <details><summary>Completion requirements</summary><p>{entry.requirements}</p></details>}
    </div>
    <div className="achievement-difficulty"><span>DIFFICULTY</span><DifficultyBadge value={entry.difficulty} /></div>
  </article>;
}

export default function AchievementListPage() {
  const { auth } = useAuth();
  const { hash, search: locationSearch } = useLocation();
  const navigate = useNavigate();
  const view = new URLSearchParams(locationSearch).get("view");
  const activeView = view === "changes" || view === "leaderboard" ? view : "top";
  const [data, setData] = useState<AchievementList | null>(null);
  const [search, setSearch] = useState("");
  const [withVideo, setWithVideo] = useState(false);
  const [difficultyFilter, setDifficultyFilter] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setError(""); setData(null);
    apiJson<AchievementList>("/api/list", "GET", undefined, undefined, controller.signal)
      .then(result => { if (!controller.signal.aborted) setData(result); })
      .catch(reason => { if (!controller.signal.aborted) setError(reason.message); });
    return () => controller.abort();
  }, [reload]);
  useEffect(() => {
    if (hash.startsWith("#achievement-")) { setSearch(""); setWithVideo(false); setDifficultyFilter(null); }
  }, [hash]);
  const visible = useMemo(() => (data?.entries ?? []).map((entry, index) => ({ entry, position: index + 1 })).filter(({ entry }) =>
    (!withVideo || !!entry.videoUrl) && (difficultyFilter === null || difficultyRating(entry.difficulty)?.minimum === difficultyFilter) && `${entry.name} ${entry.verifier} ${entry.requirements} ${difficultyRating(entry.difficulty)?.label ?? ""}`.toLowerCase().includes(search.trim().toLowerCase())), [data, search, withVideo, difficultyFilter]);
  useEffect(() => {
    if (data && hash.startsWith("#achievement-")) document.getElementById(hash.slice(1))?.scrollIntoView({ block: "center" });
  }, [data, hash, activeView, visible]);
  return <main className="achievement-page">
    <div className="achievement-container">
      <header className="achievement-hero">
        <div><p className="achievement-kicker">TOWER ECLIPSE // THE TOP 50</p><h2>THE <span>LIST.</span></h2><p>The hardest achievements. The players who proved them possible.</p><p className="achievement-intro">Fifty places at the summit. Ranked by difficulty, with #1 as the ultimate challenge.</p>
          {auth?.user.role === "dev" && <Link className="list-button" to="/admin/list">MANAGE LIST ↗</Link>}
        </div>
        <div className="achievement-hero-stat"><span>THE ULTIMATE CHALLENGES</span><strong>TOP <b>50</b></strong><div><i />{data ? `${data.entries.length} ACHIEVEMENTS RANKED` : "ACHIEVEMENT RANKINGS"}</div></div>
      </header>
      <nav className="list-view-tabs" aria-label="List sections">
        <button aria-pressed={activeView === "top"} onClick={() => navigate("/list")}><span aria-hidden="true">≡</span> The Top 50</button>
        <button aria-pressed={activeView === "changes"} onClick={() => navigate("/list?view=changes")}><span aria-hidden="true">↕</span> Change Log</button>
        <button aria-pressed={activeView === "leaderboard"} onClick={() => navigate("/list?view=leaderboard")}><span aria-hidden="true">♜</span> Leaderboard</button>
      </nav>
      {activeView === "changes" ? <AchievementChangeLog activeIds={new Set(data?.entries.map(entry => entry.id) ?? [])} /> : activeView === "leaderboard" ? <section className="list-leaderboard-placeholder achievement-empty" aria-label="Leaderboard"><div className="eclipse-orbit" aria-hidden="true" /><p className="achievement-kicker">THE NEXT CHAPTER</p><h3>Leaderboard</h3><p>A place for the players who conquer the list.</p><span className="list-coming-soon">COMING SOON</span><p>Player completions and rankings are on the way.</p></section> : <>
      <DifficultySpectrum selected={difficultyFilter} onSelect={setDifficultyFilter} />
      <section aria-label="Achievement rankings" className="achievement-directory">
        <div className="achievement-toolbar"><label className="achievement-search"><span>SEARCH THE LIST</span><input type="search" placeholder="Achievement or verifier…" value={search} onChange={event => setSearch(event.target.value)} /></label><label className="achievement-video-filter"><input type="checkbox" checked={withVideo} onChange={event => setWithVideo(event.target.checked)} />With verification video</label></div>
        <div className="achievement-directory-meta"><span aria-live="polite">{data ? `${visible.length} OF ${data.entries.length} ACHIEVEMENTS` : "OFFICIAL RANKINGS"}</span><span>{data?.updatedAt ? `UPDATED ${new Date(data.updatedAt).toLocaleDateString()}` : "ADMIN-CURATED · EFFORTLESS → ECLIPSE"}</span></div>
        {error ? <div className="achievement-empty" role="alert"><h3>Could not load the list</h3><p>{error}</p><button className="list-button" onClick={() => setReload(value => value + 1)}>TRY AGAIN</button></div>
          : !data ? <div className="achievement-empty" role="status">Loading the rankings…</div>
          : !data.entries.length ? <div className="achievement-empty"><span className="achievement-empty-mark">#—</span><h3>The summit is waiting.</h3><p>The first achievements are being curated. Check back for the official rankings.</p>{auth?.user.role === "dev" && <Link className="list-button" to="/admin/list">ADD THE FIRST ACHIEVEMENT</Link>}</div>
          : !visible.length ? <div className="achievement-empty"><h3>No matching achievements</h3><p>Try another name or clear your filters.</p><button className="list-button secondary" onClick={() => { setSearch(""); setWithVideo(false); setDifficultyFilter(null); }}>CLEAR FILTERS</button></div>
          : <ol className="achievement-entries">{visible.map(({ entry, position }) => <li value={position} key={entry.id}><AchievementCard entry={entry} position={position} /></li>)}</ol>}
      </section>
      <aside className="achievement-guide"><div><p className="achievement-kicker">HOW THE LIST WORKS</p><h3>Every place is earned.</h3></div><p>Rank is the official order of difficulty. Ratings start at 0.0, from Effortless through Eclipse at 8.0 and above. The decimal sets the tier: 6.0 is Baseline Extreme, while 6.9 is Peak Extreme. Open the requirements for the exact challenge, or watch its verification run.</p></aside>
      </>}
    </div>
  </main>;
}
