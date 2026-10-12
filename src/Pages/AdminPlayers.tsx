import { useEffect, useState, type FormEvent } from "react";
import { Link } from "../router";
import PlayerFiltersForm from "../Components/PlayerFilters";
import PlayerSummaryTable from "../Components/PlayerSummaryTable";
import SavedPlayerProfile from "../Components/SavedPlayerProfile";
import { loadPlayers, savedTime } from "../player-data";
import type { PlayerFilters, PlayerList } from "../player-data";
import "./Bugs.css";
import "./AdminPlayers.css";

const initialFilters: PlayerFilters = { mode: "main", search: "", searchField: "username", sort: "level", order: "desc", minLevel: "" };

export default function AdminPlayersPage() {
  const [draft, setDraft] = useState<PlayerFilters>(initialFilters);
  const [filters, setFilters] = useState<PlayerFilters>(initialFilters);
  const [pages, setPages] = useState<string[]>([""]);
  const [data, setData] = useState<PlayerList | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [completedRequest, setCompletedRequest] = useState("");
  const [lookup, setLookup] = useState("");
  const [lookupError, setLookupError] = useState("");
  const [selected, setSelected] = useState("");
  const cursor = pages.at(-1) ?? "";
  const requestKey = JSON.stringify({ filters, cursor, revision });
  // Gate rendered rows with their request key, including the render before useEffect runs.
  const currentRequest = completedRequest === requestKey;
  const busy = loading || !currentRequest;
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setData(null); setError("");
    loadPlayers(filters, cursor, controller.signal)
      .then(value => { if (!controller.signal.aborted) setData(value); })
      .catch((reason: unknown) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not load player summaries."); })
      .finally(() => { if (!controller.signal.aborted) { setLoading(false); setCompletedRequest(requestKey); } });
    return () => controller.abort();
  }, [filters, cursor, revision, requestKey]);

  function applyFilters(event: FormEvent) {
    event.preventDefault();
    const search = draft.search.trim();
    setFilters({ ...draft, search, sort: search ? draft.searchField : draft.sort, order: search ? "asc" : draft.order, minLevel: search ? "" : draft.minLevel });
    setPages([""]); setRevision(value => value + 1);
  }
  function findPlayer(event: FormEvent) {
    event.preventDefault();
    const userId = lookup.trim();
    if (!/^[1-9]\d{0,15}$/.test(userId) || BigInt(userId) > BigInt(Number.MAX_SAFE_INTEGER)) { setLookupError("Enter a positive Roblox UserId containing only digits."); return; }
    setLookupError(""); setSelected(userId);
  }
  return (
    <section className="workspace-page player-page">
      <div className="workspace-header"><div><p className="workspace-kicker">DEVELOPER ADMIN</p>
        <h2>PLAYER DATA</h2>
        <p>Search saved progress and inspect Main and Battlefront profiles.</p></div>
        <div className="button-row"><Link className="ghost-link" to="/admin">ADMIN</Link>
          <button className="primary-action" disabled={busy} onClick={() => { setPages([""]); setRevision(value => value + 1); }}>REFRESH LIST</button></div>
      </div>
      <div className="player-content">
        <div className="panel-card player-introduction"><p>Saved snapshots can trail active gameplay. Name searches use indexed prefixes; exact UserId lookup also works when a player is absent from the index.</p>
          <p className="player-muted">Private admin access · No edits or game-session locks · Unknown values remain unknown</p></div>
        <form className="panel-card player-lookup" onSubmit={findPlayer}><label className="filter-field"><span>EXACT ROBLOX USERID</span>
          <input inputMode="numeric" value={lookup} maxLength={16} onChange={event => setLookup(event.target.value)} placeholder="Enter UserId" aria-describedby={lookupError ? "player-lookup-error" : undefined} /></label>
          <button className="primary-action" type="submit">VIEW PROFILE</button>
          {lookupError && <p id="player-lookup-error" role="alert" className="player-warning">{lookupError}</p>}
        </form>
        <PlayerFiltersForm draft={draft} onChange={setDraft} onSubmit={applyFilters} />
        <p className="player-muted">Prefix searches sort by the selected name, ascending. Apply filters to start a new snapshot.</p>
        {busy && <p role="status">Loading player summaries…</p>}
        {error && currentRequest && <div className="workspace-error" role="alert"><p>{error}</p><button className="ghost-link" onClick={() => { setPages([""]); setRevision(value => value + 1); }}>TRY AGAIN</button></div>}
        {data && !busy && <>
          {data.synthetic && <p className="player-warning">SYNTHETIC PREVIEW — fictional players, no live datastore connection.</p>}
          <p className="player-muted">{data.coverage.description} Snapshot: {savedTime(data.snapshotAt)}.</p>
          <PlayerSummaryTable mode={filters.mode} players={data.items} selected={selected}
            onSelect={userId => { setSelected(userId); setLookup(userId); setLookupError(""); }} />
          <div className="player-pagination"><span>Page {pages.length} · {data.items.length} summaries · {filters.mode === "main" ? "Main" : "Battlefront"}</span>
            <div className="button-row"><button className="ghost-link" disabled={pages.length === 1} onClick={() => setPages(value => value.slice(0, -1))}>PREVIOUS</button>
              <button className="primary-action" disabled={!data.nextCursor} onClick={() => setPages(value => [...value, data.nextCursor!])}>NEXT PAGE</button></div>
          </div>
        </>}
        {selected ? <SavedPlayerProfile userId={selected} key={selected} /> : <div className="panel-card player-empty"><h3>SELECT A PLAYER</h3><p>Choose an indexed player or enter their Roblox UserId to inspect both saved profiles.</p></div>}
      </div>
    </section>
  );
}
