import type {
  Tournament,
  TournamentGroupStanding,
  TournamentLogEntry,
  TournamentMatch,
  TournamentRegistrationStatus,
  TournamentStatus,
  TournamentSummary,
} from "../types";

const STATUS_LABELS: Record<TournamentStatus, string> = {
  draft: "Draft",
  scheduled: "Upcoming",
  live: "Live",
  completed: "Completed",
  archived: "Archived",
};

const REGISTRATION_LABELS: Record<TournamentRegistrationStatus, string> = {
  open: "Registration open",
  closed: "Registration closed",
  invite_only: "Invite only",
};

export function formatTournamentDate(value: string, options: Intl.DateTimeFormatOptions = {}) {
  return new Intl.DateTimeFormat("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
    ...options,
  }).format(new Date(value));
}

export function formatTournamentDateRange(startsAt: string, endsAt: string) {
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  const sameYear = start.getFullYear() === end.getFullYear();
  return `${formatTournamentDate(startsAt, sameYear ? { year: undefined } : {})} — ${formatTournamentDate(endsAt)}`;
}

export function TournamentStatusBadge({ status }: { status: TournamentStatus }) {
  return (
    <span className={`tournament-status tournament-status-${status}`}>
      {status === "live" && <span className="live-dot" aria-hidden="true" />}
      {STATUS_LABELS[status]}
    </span>
  );
}

export function RegistrationBadge({ status }: { status: TournamentRegistrationStatus }) {
  return (
    <span className={`registration-status registration-status-${status}`}>
      {REGISTRATION_LABELS[status]}
    </span>
  );
}

export function TournamentPreview({ tournament }: { tournament: TournamentSummary }) {
  if (tournament.previewMatches.length > 0) {
    return (
      <div className="card-bracket-preview" aria-label="Knockout bracket preview">
        {tournament.previewMatches.map((match) => (
          <div className="preview-match" key={match.id}>
            <small>{match.label}</small>
            <span><strong>{match.participantA}</strong><b>{match.scoreA ?? "—"}</b></span>
            <span><strong>{match.participantB}</strong><b>{match.scoreB ?? "—"}</b></span>
          </div>
        ))}
      </div>
    );
  }

  if (tournament.previewGroups.length > 0) {
    return (
      <div className="card-group-preview" aria-label="Group standings preview">
        {tournament.previewGroups.map((group) => (
          <div className="preview-group" key={group.id}>
            <small>{group.label}</small>
            {group.rows.map((row) => (
              <span key={row.participantId}>
                <b>{row.rank}</b>
                <strong>{row.displayName}</strong>
                <em>{row.points} pts</em>
              </span>
            ))}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="bracket-awaiting" aria-label="Tournament bracket is being prepared">
      <div><span /><span /><span /></div>
      <p>BRACKET PREPARING</p>
    </div>
  );
}

export function TournamentStandings({
  standings,
  qualifiersPerGroup,
  compact = false,
}: {
  standings: TournamentGroupStanding[];
  qualifiersPerGroup: number;
  compact?: boolean;
}) {
  const populated = standings.filter((group) => group.rows.length > 0);
  if (populated.length === 0) {
    return <div className="tournament-empty-state">Groups have not been assigned yet.</div>;
  }

  return (
    <div className={`standings-grid ${compact ? "standings-grid-compact" : ""}`}>
      {populated.map((group) => (
        <article className="standings-card" key={group.id}>
          <header>
            <div>
              <span>GROUP STAGE</span>
              <h3>{group.label}</h3>
            </div>
            <small>{group.completedMatches}/{group.expectedMatches} matches</small>
          </header>
          <div className="standings-table-wrap">
            <table className="standings-table">
              <thead>
                <tr>
                  <th scope="col">#</th>
                  <th scope="col">Player</th>
                  <th scope="col">P</th>
                  <th scope="col">W</th>
                  <th scope="col">D</th>
                  <th scope="col">L</th>
                  <th scope="col">+/-</th>
                  <th scope="col">Pts</th>
                </tr>
              </thead>
              <tbody>
                {group.rows.map((row) => (
                  <tr className={row.rank <= qualifiersPerGroup ? "qualification-place" : ""} key={row.participantId}>
                    <td><b>{row.rank}</b></td>
                    <td>
                      <strong>{row.displayName}</strong>
                      <small>{row.robloxUsername ? `@${row.robloxUsername} · ` : ""}ISR {row.isr}</small>
                    </td>
                    <td>{row.played}</td>
                    <td>{row.wins}</td>
                    <td>{row.draws}</td>
                    <td>{row.losses}</td>
                    <td>{row.scoreDifference > 0 ? `+${row.scoreDifference}` : row.scoreDifference}</td>
                    <td><b>{row.points}</b></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <footer>
            <span className="qualification-line" />
            Top {qualifiersPerGroup} advance
          </footer>
        </article>
      ))}
    </div>
  );
}

function MatchSlot({
  participantId,
  score,
  winnerId,
  participantNames,
}: {
  participantId: string | null;
  score: number | null;
  winnerId: string | null;
  participantNames: Map<string, string>;
}) {
  return (
    <div className={`bracket-slot ${participantId && participantId === winnerId ? "winner" : ""}`}>
      <span>{participantId ? participantNames.get(participantId) ?? "Unknown" : "TBD"}</span>
      <b>{score ?? "—"}</b>
    </div>
  );
}

function roundTitle(matches: TournamentMatch[]) {
  if (matches.some((match) => match.isThirdPlace)) return "FINALS";
  return (matches[0]?.label ?? "Round").toUpperCase();
}

export function TournamentBracket({ tournament }: { tournament: Tournament }) {
  const matches = tournament.matches.filter((match) => match.stage === "knockout");
  if (matches.length === 0) {
    return (
      <div className="tournament-empty-state bracket-empty-state">
        <span>QUALIFIERS PENDING</span>
        <p>The knockout bracket will appear when the group stage is complete.</p>
      </div>
    );
  }
  const participantNames = new Map(
    tournament.participants.map((participant) => [participant.id, participant.displayName]),
  );
  const rounds = Array.from(new Set(matches.map((match) => match.round))).sort((a, b) => a - b);

  return (
    <div className="bracket-scroll" tabIndex={0} aria-label="Knockout bracket. Scroll horizontally to see every round.">
      <div className="tournament-bracket">
        {rounds.map((round) => {
          const roundMatches = matches
            .filter((match) => match.round === round)
            .sort((left, right) => left.bracketPosition - right.bracketPosition);
          return (
            <section className="bracket-round" key={round}>
              <h3>{roundTitle(roundMatches)}</h3>
              <div className="bracket-round-matches">
                {roundMatches.map((match) => (
                  <article className={`bracket-match ${match.status === "live" ? "match-live" : ""}`} key={match.id}>
                    <header>
                      <span>{match.isThirdPlace ? "BRONZE MATCH" : match.isBye ? "BYE" : `BEST OF ${match.bestOf}`}</span>
                      {match.status === "live" && <b>LIVE</b>}
                    </header>
                    <MatchSlot
                      participantId={match.participantAId}
                      score={match.scoreA}
                      winnerId={match.winnerId}
                      participantNames={participantNames}
                    />
                    <MatchSlot
                      participantId={match.participantBId}
                      score={match.scoreB}
                      winnerId={match.winnerId}
                      participantNames={participantNames}
                    />
                  </article>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function logMarker(entry: TournamentLogEntry) {
  if (entry.type === "match_result") return "VS";
  if (entry.type === "advancement") return "↑";
  if (entry.type === "points_adjustment") return "+";
  if (entry.type === "announcement") return "!";
  return "•";
}

export function TournamentBattleLog({ entries, limit }: { entries: TournamentLogEntry[]; limit?: number }) {
  const visible = limit ? entries.slice(0, limit) : entries;
  if (visible.length === 0) {
    return <div className="tournament-empty-state">No tournament activity has been recorded yet.</div>;
  }
  return (
    <ol className="battle-log-list">
      {visible.map((entry) => (
        <li key={entry.id}>
          <span className={`battle-log-marker battle-log-${entry.type}`}>{logMarker(entry)}</span>
          <div>
            <header>
              <strong>{entry.headline}</strong>
              <time dateTime={entry.createdAt}>
                {formatTournamentDate(entry.createdAt, { hour: "numeric", minute: "2-digit" })}
              </time>
            </header>
            {entry.detail && <p>{entry.detail}</p>}
            <footer>
              {entry.stage && <span>{entry.stage === "group" ? "GROUP STAGE" : "KNOCKOUT"}</span>}
              {entry.recordedBy && <span>Recorded by {entry.recordedBy}</span>}
            </footer>
          </div>
        </li>
      ))}
    </ol>
  );
}
