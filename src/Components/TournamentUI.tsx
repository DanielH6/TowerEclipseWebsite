import { useLayoutEffect, useRef, useState } from "react";
import type {
  Tournament,
  TournamentGroupStanding,
  TournamentLogEntry,
  TournamentMatch,
  TournamentKnockoutPreviewMatch,
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
  participantLabel,
  score,
  winnerId,
  participantNames,
}: {
  participantId: string | null;
  participantLabel?: string;
  score: number | null;
  winnerId: string | null;
  participantNames: Map<string, string>;
}) {
  return (
    <div className={`bracket-slot ${participantId && participantId === winnerId ? "winner" : ""}`}>
      <span>{participantLabel ?? (participantId ? participantNames.get(participantId) ?? "Unknown" : "TBD")}</span>
      <b>{score ?? "—"}</b>
    </div>
  );
}

function roundTitle(matches: Array<TournamentMatch | TournamentKnockoutPreviewMatch>) {
  if (matches.some((match) => match.isThirdPlace)) return "FINALS";
  return (matches[0]?.label ?? "Round").toUpperCase();
}

export function TournamentBracket({ tournament }: { tournament: Tournament }) {
  const matches = tournament.matches.filter((match) => match.stage === "knockout");
  const projectedMatches = tournament.knockoutPreview ?? [];
  if (matches.length === 0 && projectedMatches.length === 0) {
    return (
      <div className="tournament-empty-state bracket-empty-state">
        <span>GROUPS PENDING</span>
        <p>The projected bracket will appear once groups and their qualifiers have been assigned.</p>
      </div>
    );
  }
  const participantNames = new Map(
    tournament.participants.map((participant) => [participant.id, participant.displayName]),
  );
  const bracketMatches = matches.length > 0 ? matches : projectedMatches;
  const rounds = Array.from(new Set(bracketMatches.map((match) => match.round))).sort((a, b) => a - b);
  const bracketLayoutKey = bracketMatches.map((match) => `${match.id}:${match.round}:${match.bracketPosition}`).join("|");
  const bracketRef = useRef<HTMLDivElement>(null);
  const matchRefs = useRef(new Map<string, HTMLElement>());
  const [connectorState, setConnectorState] = useState({ width: 0, height: 0, paths: [] as string[] });

  useLayoutEffect(() => {
    const bracket = bracketRef.current;
    if (!bracket) return undefined;
    const updateConnectors = () => {
      const bounds = bracket.getBoundingClientRect();
      const paths: string[] = [];
      for (let index = 0; index < rounds.length - 1; index += 1) {
        const sourceMatches = bracketMatches
          .filter((match) => match.round === rounds[index] && !match.isThirdPlace)
          .sort((left, right) => left.bracketPosition - right.bracketPosition);
        const targetMatches = bracketMatches
          .filter((match) => match.round === rounds[index + 1] && !match.isThirdPlace)
          .sort((left, right) => left.bracketPosition - right.bracketPosition);
        targetMatches.forEach((target, targetIndex) => {
          const targetElement = matchRefs.current.get(target.id);
          const sources = sourceMatches.slice(targetIndex * 2, targetIndex * 2 + 2)
            .map((source) => matchRefs.current.get(source.id))
            .filter((source): source is HTMLElement => Boolean(source));
          if (!targetElement || sources.length === 0) return;
          const targetBounds = targetElement.getBoundingClientRect();
          const targetX = targetBounds.left - bounds.left;
          const targetY = targetBounds.top - bounds.top + targetBounds.height / 2;
          const sourceX = Math.max(...sources.map((source) => source.getBoundingClientRect().right - bounds.left));
          const bridgeX = sourceX + Math.max(14, (targetX - sourceX) / 2);
          sources.forEach((source) => {
            const sourceBounds = source.getBoundingClientRect();
            const sourceY = sourceBounds.top - bounds.top + sourceBounds.height / 2;
            paths.push(`M ${sourceX} ${sourceY} H ${bridgeX} V ${targetY} H ${targetX}`);
          });
        });
      }
      setConnectorState({ width: bounds.width, height: bounds.height, paths });
    };
    updateConnectors();
    const observer = new ResizeObserver(updateConnectors);
    observer.observe(bracket);
    matchRefs.current.forEach((match) => observer.observe(match));
    return () => observer.disconnect();
  }, [bracketLayoutKey]);

  return (
    <div className="bracket-scroll" tabIndex={0} aria-label="Knockout bracket. Scroll horizontally to see every round.">
      <div className="tournament-bracket" ref={bracketRef}>
        <svg
          className="bracket-connectors"
          aria-hidden="true"
          width={connectorState.width}
          height={connectorState.height}
          viewBox={`0 0 ${connectorState.width} ${connectorState.height}`}
        >
          {connectorState.paths.map((path, index) => <path d={path} key={`${index}-${path}`} />)}
        </svg>
        {rounds.map((round) => {
          const roundMatches = bracketMatches
            .filter((match) => match.round === round)
            .sort((left, right) => left.bracketPosition - right.bracketPosition);
          return (
            <section className="bracket-round" key={round}>
              <h3>{roundTitle(roundMatches)}</h3>
              <div className="bracket-round-matches">
                {roundMatches.map((match) => (
                  <article
                    className={`bracket-match ${"status" in match && match.status === "live" ? "match-live" : ""}`}
                    key={match.id}
                    ref={(element) => {
                      if (element) matchRefs.current.set(match.id, element);
                      else matchRefs.current.delete(match.id);
                    }}
                  >
                    <header>
                      <span>{match.isThirdPlace ? "BRONZE MATCH" : match.isBye ? "BYE" : "bestOf" in match ? `BEST OF ${match.bestOf}` : "PROJECTED"}</span>
                      {"status" in match && match.status === "live" && <b>LIVE</b>}
                    </header>
                    <MatchSlot
                      participantId={"participantAId" in match ? match.participantAId : null}
                      participantLabel={"participantA" in match ? match.participantA : undefined}
                      score={"scoreA" in match ? match.scoreA : null}
                      winnerId={"winnerId" in match ? match.winnerId : null}
                      participantNames={participantNames}
                    />
                    <MatchSlot
                      participantId={"participantBId" in match ? match.participantBId : null}
                      participantLabel={"participantB" in match ? match.participantB : undefined}
                      score={"scoreB" in match ? match.scoreB : null}
                      winnerId={"winnerId" in match ? match.winnerId : null}
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
