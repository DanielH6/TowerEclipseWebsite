import { useEffect, useMemo, useState } from "react";
import { loadTournaments } from "../api";
import { useAuth } from "../AuthContext";
import {
  RegistrationBadge,
  TournamentPreview,
  TournamentStatusBadge,
  formatTournamentDateRange,
} from "../Components/TournamentUI";
import { ESPORTS_CONTENT } from "../content/esportsContent";
import { Link } from "../router";
import type { TournamentStatus, TournamentSummary } from "../types";
import "./Esports.css";

type Filter = "all" | TournamentStatus;

const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: "all", label: "All tournaments" },
  { id: "live", label: "Live" },
  { id: "scheduled", label: "Upcoming" },
  { id: "completed", label: "Completed" },
];

export default function EsportsPage() {
  const { auth } = useAuth();
  const [tournaments, setTournaments] = useState<TournamentSummary[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    loadTournaments()
      .then((items) => { if (active) setTournaments(items); })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : "Could not load tournaments.");
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    return tournaments.filter((tournament) => {
      if (filter !== "all" && tournament.status !== filter) return false;
      if (!query) return true;
      return [tournament.name, tournament.hostName, tournament.region, tournament.description]
        .some((value) => value.toLowerCase().includes(query));
    });
  }, [filter, search, tournaments]);

  const liveCount = tournaments.filter((tournament) => tournament.status === "live").length;
  const upcomingCount = tournaments.filter((tournament) => tournament.status === "scheduled").length;
  const entrants = tournaments.reduce((total, tournament) => total + tournament.participantCount, 0);

  return (
    <section className="esports-page">
      <div className="esports-hero">
        <div className="esports-hero-copy">
          <p className="esports-eyebrow">{ESPORTS_CONTENT.eyebrow}</p>
          <h2>{ESPORTS_CONTENT.title}</h2>
          <p>{ESPORTS_CONTENT.introduction}</p>
          <div className="esports-hero-actions">
            <a href="#tournaments" className="esports-primary-button">VIEW TOURNAMENTS</a>
            {auth?.user.role === "dev" && (
              <Link to="/esports/manage" className="esports-secondary-button">TOURNAMENT CONTROL</Link>
            )}
          </div>
        </div>
        <div className="esports-scoreboard" aria-label="Tournament overview">
          <div><strong>{liveCount}</strong><span>LIVE NOW</span></div>
          <div><strong>{upcomingCount}</strong><span>UPCOMING</span></div>
          <div><strong>{entrants}</strong><span>ENTRANTS</span></div>
          <div className="scoreboard-signal"><i /><span>COMPETITIVE NETWORK</span></div>
        </div>
      </div>

      <div className="tournament-directory" id="tournaments">
        <header className="directory-header">
          <div>
            <p className="esports-eyebrow">EVENT DIRECTORY</p>
            <h2>TOURNAMENTS</h2>
          </div>
          <label className="tournament-search">
            <span>Search tournaments</span>
            <input
              type="search"
              value={search}
              placeholder="Tournament, host, or region…"
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
        </header>

        <div className="tournament-filter-row" role="group" aria-label="Tournament filters">
          {FILTERS.map((item) => (
            <button
              type="button"
              className={filter === item.id ? "active" : ""}
              aria-pressed={filter === item.id}
              onClick={() => setFilter(item.id)}
              key={item.id}
            >
              {item.label}
              <span>{item.id === "all" ? tournaments.length : tournaments.filter((entry) => entry.status === item.id).length}</span>
            </button>
          ))}
        </div>

        {error && <div className="tournament-message tournament-message-error">{error}</div>}
        {loading ? (
          <div className="tournament-loading" aria-label="Loading tournaments"><span /><span /><span /></div>
        ) : visible.length === 0 ? (
          <div className="tournament-directory-empty">
            <span>00</span>
            <h3>{ESPORTS_CONTENT.emptyTitle}</h3>
            <p>{ESPORTS_CONTENT.emptyDescription}</p>
            {auth?.user.role === "dev" && (
              <Link to="/esports/manage/new" className="esports-primary-button">CREATE A TOURNAMENT</Link>
            )}
          </div>
        ) : (
          <div className="tournament-card-grid">
            {visible.map((tournament) => (
              <article className={`tournament-card tournament-card-${tournament.status}`} key={tournament.id}>
                <div className="tournament-card-preview">
                  <TournamentPreview tournament={tournament} />
                  <TournamentStatusBadge status={tournament.status} />
                  {tournament.featured && <span className="featured-flag">FEATURED</span>}
                </div>
                <div className="tournament-card-body">
                  <header>
                    <div>
                      <p>{tournament.tagline || "TOWER ECLIPSE TOURNAMENT"}</p>
                      <h3>{tournament.name}</h3>
                    </div>
                    <RegistrationBadge status={tournament.registrationStatus} />
                  </header>
                  <p className="tournament-card-description">
                    {tournament.description || "Event details will be announced by the tournament host."}
                  </p>
                  <dl className="tournament-card-facts">
                    <div><dt>DATES</dt><dd>{formatTournamentDateRange(tournament.startsAt, tournament.endsAt)}</dd></div>
                    <div><dt>HOST</dt><dd>{tournament.hostName}</dd></div>
                    <div><dt>FORMAT</dt><dd>{tournament.settings.groupCount} groups → knockout</dd></div>
                    <div><dt>FIELD</dt><dd>{tournament.participantCount}/{tournament.settings.participantCap}</dd></div>
                  </dl>
                  {tournament.recentResult && (
                    <p className="latest-result"><span>LATEST</span>{tournament.recentResult.headline}</p>
                  )}
                  <footer>
                    <Link to={`/esports/${encodeURIComponent(tournament.slug)}`}>OPEN TOURNAMENT <span>→</span></Link>
                    <small>{tournament.completedMatches}/{tournament.totalMatches} matches complete</small>
                  </footer>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
