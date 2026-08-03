import { useEffect, useMemo, useState } from "react";
import { loadTournament } from "../api";
import { useAuth } from "../AuthContext";
import {
  RegistrationBadge,
  TournamentBattleLog,
  TournamentBracket,
  TournamentStandings,
  TournamentStatusBadge,
  formatTournamentDate,
  formatTournamentDateRange,
} from "../Components/TournamentUI";
import { Link, useParams } from "../router";
import type { Tournament } from "../types";
import "./Esports.css";

export default function TournamentDetailsPage() {
  const { tournamentSlug } = useParams<{ tournamentSlug: string }>();
  const { auth } = useAuth();
  const [tournament, setTournament] = useState<Tournament | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let timer: number | undefined;
    async function refresh(background = false) {
      if (!background) setLoading(true);
      try {
        const result = await loadTournament(tournamentSlug ?? "");
        if (active) {
          setTournament(result);
          setError(null);
          if (result.status === "live" && timer === undefined) {
            timer = window.setInterval(() => void refresh(true), 30_000);
          }
        }
      } catch (reason) {
        if (active) setError(reason instanceof Error ? reason.message : "Could not load this tournament.");
      } finally {
        if (active && !background) setLoading(false);
      }
    }
    void refresh();
    return () => {
      active = false;
      if (timer !== undefined) window.clearInterval(timer);
    };
  }, [tournamentSlug]);

  const champion = useMemo(
    () => tournament?.participants.find((participant) => participant.id === tournament.championId) ?? null,
    [tournament],
  );

  if (loading) {
    return <section className="esports-page tournament-detail-loading"><div className="tournament-loading"><span /><span /><span /></div></section>;
  }

  if (!tournament || error) {
    return (
      <section className="esports-page tournament-not-found">
        <p className="esports-eyebrow">EVENT UNAVAILABLE</p>
        <h2>TOURNAMENT NOT FOUND</h2>
        <p>{error ?? "This tournament is not currently available."}</p>
        <Link to="/esports" className="esports-primary-button">BACK TO ESPORTS</Link>
      </section>
    );
  }

  const confirmed = tournament.participants
    .filter((participant) => participant.status === "confirmed")
    .sort((left, right) => right.isr - left.isr || left.displayName.localeCompare(right.displayName));
  const knockoutSlots = tournament.standings.reduce(
    (total, group) => total + Math.min(group.rows.length, tournament.settings.qualifiersPerGroup),
    0,
  );

  return (
    <section className="esports-page tournament-detail-page">
      <div className={`tournament-detail-hero tournament-detail-hero-${tournament.status}`}>
        {tournament.bannerImageUrl && (
          <img className="tournament-detail-banner-image" src={tournament.bannerImageUrl} alt="" />
        )}
        <div className="tournament-detail-breadcrumbs">
          <Link to="/esports">ESPORTS</Link><span>/</span><strong>{tournament.name}</strong>
        </div>
        <div className="tournament-detail-title">
          <div>
            <div className="tournament-detail-badges">
              <TournamentStatusBadge status={tournament.status} />
              <RegistrationBadge status={tournament.registrationStatus} />
            </div>
            <p className="esports-eyebrow">{tournament.tagline || "OFFICIAL TOWER ECLIPSE EVENT"}</p>
            <h2>{tournament.name}</h2>
            <p>{tournament.description || "Tournament information is being prepared by the host."}</p>
          </div>
          <div className="tournament-detail-actions">
            {tournament.registrationStatus === "open" && tournament.registrationUrl && (
              <a href={tournament.registrationUrl} target="_blank" rel="noopener noreferrer" className="esports-primary-button">REGISTER NOW</a>
            )}
            {tournament.streamUrl && (
              <a href={tournament.streamUrl} target="_blank" rel="noopener noreferrer" className="esports-secondary-button">WATCH STREAM</a>
            )}
            {auth?.user.role === "dev" && (
              <Link to={`/esports/manage/${encodeURIComponent(tournament.id)}`} className="esports-secondary-button">MANAGE EVENT</Link>
            )}
          </div>
        </div>
        <dl className="tournament-detail-meta">
          <div><dt>DATES</dt><dd>{formatTournamentDateRange(tournament.startsAt, tournament.endsAt)}</dd></div>
          <div><dt>HOST</dt><dd>{tournament.hostName}</dd></div>
          <div><dt>REGION</dt><dd>{tournament.region}</dd></div>
          <div><dt>TIMEZONE</dt><dd>{tournament.timezone}</dd></div>
        </dl>
      </div>

      <nav className="tournament-section-navigation" aria-label="Tournament sections">
        <a href="#overview">OVERVIEW</a>
        <a href="#groups">GROUPS</a>
        <a href="#bracket">KNOCKOUT</a>
        <a href="#battle-log">BATTLE LOG</a>
        <a href="#rules">RULES</a>
      </nav>

      <div className="tournament-detail-content">
        <section className="tournament-overview-section" id="overview">
          <div className="tournament-stat-grid">
            <div><span>ENTRANTS</span><strong>{tournament.participantCount}</strong><small>of {tournament.settings.participantCap} slots</small></div>
            <div><span>GROUPS</span><strong>{tournament.settings.groupCount}</strong><small>round-robin pools</small></div>
            <div><span>ADVANCE</span><strong>{knockoutSlots || tournament.settings.groupCount * tournament.settings.qualifiersPerGroup}</strong><small>top {tournament.settings.qualifiersPerGroup} per group</small></div>
            <div><span>MATCHES</span><strong>{tournament.completedMatches}/{tournament.totalMatches}</strong><small>results recorded</small></div>
          </div>
          {champion && (
            <div className="tournament-champion-banner">
              <span>TOURNAMENT CHAMPION</span>
              <strong>{champion.displayName}</strong>
              {champion.robloxUsername && <small>@{champion.robloxUsername}</small>}
            </div>
          )}
        </section>

        <section className="tournament-content-section" id="groups">
          <header className="tournament-section-heading">
            <div><p className="esports-eyebrow">STAGE 01</p><h2>GROUP STANDINGS</h2></div>
            <p>Ranked by points, score difference, score scored, wins, head-to-head, then ISR.</p>
          </header>
          <TournamentStandings
            standings={tournament.standings}
            qualifiersPerGroup={tournament.settings.qualifiersPerGroup}
          />
        </section>

        <section className="tournament-content-section tournament-bracket-section" id="bracket">
          <header className="tournament-section-heading">
            <div><p className="esports-eyebrow">STAGE 02</p><h2>KNOCKOUT BRACKET</h2></div>
            <p>Single elimination · Best of {tournament.settings.knockoutBestOf}{tournament.settings.thirdPlaceMatch ? " · Third-place match enabled" : ""}</p>
          </header>
          <TournamentBracket tournament={tournament} />
        </section>

        <section className="tournament-content-section battle-log-section" id="battle-log">
          <header className="tournament-section-heading">
            <div><p className="esports-eyebrow">LIVE RECORD</p><h2>BATTLE LOG</h2></div>
            <p>Official results, qualification updates, point corrections, and host announcements.</p>
          </header>
          <TournamentBattleLog entries={tournament.log} />
        </section>

        <section className="tournament-detail-bottom-grid">
          <article className="tournament-content-section roster-section">
            <header className="tournament-section-heading">
              <div><p className="esports-eyebrow">FIELD</p><h2>ENTRANTS</h2></div>
            </header>
            {confirmed.length === 0 ? <div className="tournament-empty-state">Entrants have not been announced.</div> : (
              <ol className="tournament-roster">
                {confirmed.map((participant) => (
                  <li key={participant.id}>
                    <span>ISR {participant.isr}</span>
                    <div><strong>{participant.displayName}</strong>{participant.robloxUsername && <small>@{participant.robloxUsername}</small>}</div>
                    <em>{participant.groupId ? participant.groupId.replace("group-", "GROUP ").toUpperCase() : "UNASSIGNED"}</em>
                    {participant.advanced && <b>ADVANCED</b>}
                  </li>
                ))}
              </ol>
            )}
          </article>

          <article className="tournament-content-section rules-section" id="rules">
            <header className="tournament-section-heading">
              <div><p className="esports-eyebrow">EVENT INFO</p><h2>RULES & FORMAT</h2></div>
            </header>
            <dl className="format-facts">
              <div><dt>Group scoring</dt><dd>{tournament.settings.pointsWin} win / {tournament.settings.pointsDraw} draw / {tournament.settings.pointsLoss} loss</dd></div>
              <div><dt>Group matches</dt><dd>Best of {tournament.settings.groupBestOf}</dd></div>
              <div><dt>Knockout matches</dt><dd>Best of {tournament.settings.knockoutBestOf}</dd></div>
              <div><dt>Check-in</dt><dd>{tournament.settings.checkInRequired ? "Required" : "Not required"}</dd></div>
              <div><dt>Event starts</dt><dd>{formatTournamentDate(tournament.startsAt, { hour: "numeric", minute: "2-digit" })}</dd></div>
              {tournament.contact && <div><dt>Contact</dt><dd>{tournament.contact}</dd></div>}
            </dl>
            <div className="rules-copy">
              {tournament.rules ? tournament.rules.split(/\n{2,}/).map((paragraph, index) => <p key={index}>{paragraph}</p>) : (
                <p>Full event rules will be published by the tournament host.</p>
              )}
            </div>
          </article>
        </section>
      </div>
    </section>
  );
}
