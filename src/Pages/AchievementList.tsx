import { useEffect, useMemo, useState } from "react";
import { apiJson } from "../api";
import { useAuth } from "../AuthContext";
import { Link, useLocation, useNavigate } from "../router";
import { achievementCompletionMode, achievementRankings, achievementThumbnailUrl, difficultyRating, formatVerificationDate, youtubeVideoId, type AchievementEntry, type AchievementList } from "../../shared/achievement-list.mjs";
import { DifficultyBadge, DifficultySpectrum, difficultyStyle } from "../Components/AchievementDifficulty";
import AchievementChangeLog from "../Components/AchievementChangeLog";
import AchievementMode from "../Components/AchievementMode";
import "./AchievementList.css";

export function AchievementCard({ entry, position }: { entry: AchievementEntry; position: number; includeTheoretical?: boolean }) {
  const videoId = youtubeVideoId(entry.videoUrl);
  const rating = difficultyRating(entry.difficulty);
  const [failedImages, setFailedImages] = useState<string[]>([]);
  const candidates = [entry.thumbnailId ? achievementThumbnailUrl(entry.thumbnailId) : null, videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : null];
  const imageUrl = candidates.find((url): url is string => !!url && !failedImages.includes(url));
  const thumbnail = <>
    {imageUrl
      ? <img key={imageUrl} src={imageUrl} alt="" loading="lazy" onError={() => setFailedImages(current => [...current, imageUrl])} />
      : <div className="achievement-placeholder"><img src="/favicon.png" alt="" /></div>}
    <span className="achievement-video-label">{entry.theoretical ? videoId ? "Watch showcase ↗" : "Awaiting verification" : videoId ? "Watch verification ↗" : "Video not added"}</span>
  </>;
  return <article className={`achievement-card ${position === 1 ? "achievement-first" : ""} ${rating?.eclipse ? "achievement-eclipse" : ""}`} style={difficultyStyle(rating?.color ?? "#76bdff")} id={`achievement-${entry.id}`}>
    <div className="achievement-rank" aria-label={`Rank ${position}`}><strong>#{String(position).padStart(2, "0")}</strong></div>
    {videoId ? <a className="achievement-thumbnail" href={`https://www.youtube.com/watch?v=${videoId}`} target="_blank" rel="noopener noreferrer" aria-label={`Watch ${entry.name} ${entry.theoretical ? "showcase" : "verification"} on YouTube`}>{thumbnail}</a> : <div className="achievement-thumbnail">{thumbnail}</div>}
    <div className="achievement-copy">
      <h3><a href={`#achievement-${entry.id}`}>{entry.name}</a></h3>
      {entry.theoretical ? <><span className="achievement-theoretical-badge">THEORETICAL · UNVERIFIED</span><p className="achievement-verifier">Theoretically possible. Awaiting verification.</p></> : <>
        <p className="achievement-verifier">Verified by <strong>{entry.verifier}</strong></p>
        <dl className="achievement-verification-meta"><div><dt>VERIFIED ON</dt><dd>{entry.verifiedOn ? <time dateTime={entry.verifiedOn}>{formatVerificationDate(entry.verifiedOn)}</time> : "Not recorded"}</dd></div><div><dt>GAME VERSION</dt><dd>{entry.verifiedVersion || "Not recorded"}</dd></div></dl>
      </>}
      {entry.requirements && <details><summary>Completion requirements</summary><p>{entry.requirements}</p></details>}
    </div>
    <AchievementMode mode={achievementCompletionMode(entry)} />
    <div className="achievement-difficulty"><span>DIFFICULTY</span><DifficultyBadge value={entry.difficulty} /></div>
  </article>;
}

export default function AchievementListPage() {
  const { auth } = useAuth();
  const { hash, search: locationSearch } = useLocation();
  const navigate = useNavigate();
  const view = new URLSearchParams(locationSearch).get("view");
  const activeView = view === "changes" || view === "leaderboard" || view === "theoretical" ? view : "top";
  const includeTheoretical = activeView === "theoretical";
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
  const ranked = useMemo(() => achievementRankings(data?.entries ?? [], includeTheoretical), [data, includeTheoretical]);
  const visible = useMemo(() => ranked.filter(({ entry }) =>
    (!withVideo || (!entry.theoretical && !!entry.videoUrl)) && (difficultyFilter === null || difficultyRating(entry.difficulty)?.minimum === difficultyFilter) && `${entry.name} ${entry.theoretical ? "theoretical unverified" : entry.verifier} ${entry.requirements} ${achievementCompletionMode(entry)} ${difficultyRating(entry.difficulty)?.label ?? ""}`.toLowerCase().includes(search.trim().toLowerCase())), [ranked, search, withVideo, difficultyFilter]);
  useEffect(() => {
    // Shared card URLs and older change-log links should reveal theoretical entries.
    if (activeView === "top" && data?.entries.some(entry => entry.theoretical && hash === `#achievement-${entry.id}`)) navigate(`/list?view=theoretical${hash}`, { replace: true });
  }, [data, hash, activeView, navigate]);
  useEffect(() => {
    if (data && hash.startsWith("#achievement-")) document.getElementById(hash.slice(1))?.scrollIntoView({ block: "center" });
  }, [data, hash, activeView, visible]);
  return <main className="achievement-page list-public-page">
    <div className="achievement-container">
      <header className="achievement-hero">
        <div><h2>The List</h2><p>{includeTheoretical ? "The hardest achievements. The next challenges to verify." : "The top achievements verified by current players, submit a new achievement in the #list-achievements channel on discord for it to be placed."}</p>
          {auth?.user.role === "dev" && <Link className="list-button" to="/admin/list">MANAGE LIST ↗</Link>}
        </div>
      </header>
      <nav className="list-view-tabs" aria-label="List sections">
        <button aria-pressed={activeView === "top"} onClick={() => navigate("/list")}>The Top 50</button>
        <button aria-pressed={includeTheoretical} onClick={() => { setWithVideo(false); navigate("/list?view=theoretical"); }}>Theoretical</button>
        <button aria-pressed={activeView === "changes"} onClick={() => navigate("/list?view=changes")}>Change Log</button>
        <button aria-pressed={activeView === "leaderboard"} onClick={() => navigate("/list?view=leaderboard")}>Leaderboard</button>
      </nav>
      {activeView === "changes" ? <AchievementChangeLog activeIds={new Set(data?.entries.map(entry => entry.id) ?? [])} theoreticalIds={new Set(data?.entries.filter(entry => entry.theoretical).map(entry => entry.id) ?? [])} /> : activeView === "leaderboard" ? <section className="list-leaderboard-placeholder achievement-empty" aria-label="Leaderboard"><h3>Leaderboard</h3><p>Coming soon. Player completions and rankings will appear here.</p></section> : <>
      {includeTheoretical && <p className="achievement-theoretical-note"><strong>THEORETICAL MODE</strong> Includes every verified achievement. Marked challenges are considered possible but have not been verified; their ratings are estimates.</p>}
      <DifficultySpectrum selected={difficultyFilter} onSelect={setDifficultyFilter} />
      <section aria-label="Achievement rankings" className="achievement-directory">
        <div className="achievement-toolbar"><label className="achievement-search"><span>SEARCH THE LIST</span><input type="search" placeholder="Achievement or verifier…" value={search} onChange={event => setSearch(event.target.value)} /></label><label className="achievement-video-filter"><input type="checkbox" checked={withVideo} onChange={event => setWithVideo(event.target.checked)} />With verification video</label></div>
        <div className="achievement-directory-meta"><span aria-live="polite">{data ? `${visible.length} OF ${ranked.length} ACHIEVEMENTS` : "OFFICIAL RANKINGS"}</span><span>{data?.updatedAt ? `UPDATED ${new Date(data.updatedAt).toLocaleDateString()}` : "ADMIN-CURATED · EFFORTLESS → ECLIPSE"}</span></div>
        {error ? <div className="achievement-empty" role="alert"><h3>Could not load the list</h3><p>{error}</p><button className="list-button" onClick={() => setReload(value => value + 1)}>TRY AGAIN</button></div>
          : !data ? <div className="achievement-empty" role="status">Loading the rankings…</div>
          : !ranked.length ? <div className="achievement-empty"><span className="achievement-empty-mark">#—</span><h3>The summit is waiting.</h3><p>{!includeTheoretical && data.entries.length ? "No verified achievements yet. Explore the theoretical challenges to find the next verification." : "The first achievements are being curated. Check back for the official rankings."}</p>{!includeTheoretical && data.entries.length > 0 && <Link className="list-button secondary" to="/list?view=theoretical">VIEW THEORETICAL ACHIEVEMENTS</Link>}{auth?.user.role === "dev" && <Link className="list-button" to="/admin/list">ADD AN ACHIEVEMENT</Link>}</div>
          : !visible.length ? <div className="achievement-empty"><h3>No matching achievements</h3><p>Try another name or clear your filters.</p><button className="list-button secondary" onClick={() => { setSearch(""); setWithVideo(false); setDifficultyFilter(null); }}>CLEAR FILTERS</button></div>
          : <ol className="achievement-entries">{visible.map(({ entry, position }) => <li value={position} key={entry.id}><AchievementCard entry={entry} position={position} includeTheoretical={includeTheoretical} /></li>)}</ol>}
      </section>
      <aside className="achievement-guide"><div><h3>{includeTheoretical ? "Find the next challenge." : "Verified Achievements Only"}</h3></div><p>{includeTheoretical ? "This combined order compares verified runs with theoretical challenges. Theoretical ratings are estimates until a player verifies the achievement. " : "The list of the top 50 hardest achievements completed in Tower Eclipse, ranked by difficulty with #1 as the hardest challenge. "}Ratings start at 0.0, from Effortless through Eclipse at 8.0 and above. The decimal sets the tier: 6.0 is Baseline Extreme, while 6.9 is Peak Extreme. Open the requirements for the exact challenge{includeTheoretical ? "." : ", or watch its verification run."}</p></aside>
      </>}
    </div>
  </main>;
}
