import { playerNumber, savedTime } from "../player-data";
import type { PlayerMode, PlayerSummary } from "../player-data";

interface Props {
  mode: PlayerMode;
  players: PlayerSummary[];
  selected: string;
  onSelect: (userId: string) => void;
}

export default function PlayerSummaryTable({ mode, players, selected, onSelect }: Props) {
  return (
    <div className="bug-table-wrapper">
      <table className="bug-table player-table">
        <caption className="sr-only">Indexed {mode} player summaries</caption>
        <thead><tr>
          <th>PLAYER</th><th>LEVEL</th><th>GAMES</th>
          {mode === "main" && <th>ISR</th>}
          <th>LAST SAVE</th><th>PROFILE</th>
        </tr></thead>
        <tbody>
          {players.map(player => (
            <tr key={`${player.mode}:${player.userId}`}
              className={selected === player.userId ? "is-selected" : undefined}>
              <td>
                <strong>{player.identity.displayName ?? `UserId ${player.userId}`}</strong>
                <span className="player-username">@{player.identity.username ?? "unknown"}</span>
                <small>{player.userId}</small>
                <span className="player-identity-source" title={player.identity.source === "roblox_users_api" ? `Looked up ${savedTime(player.identity.checkedAt)}` : "Names from saved fields have not been checked against Roblox."}>
                  {player.identity.source === "roblox_users_api" ? "Roblox names" : "Saved names · unverified"}
                </span>
              </td>
              <td>{playerNumber(player.stats.level)}</td>
              <td>{playerNumber(player.stats.gamesPlayed)}</td>
              {mode === "main" && <td>{playerNumber(player.stats.rankedISR)}</td>}
              <td>{savedTime(player.source.updatedAt)}</td>
              <td><button className="ghost-link" onClick={() => onSelect(player.userId)}
                aria-label={`View saved profile ${player.userId}`}>VIEW</button></td>
            </tr>
          ))}
          {!players.length && <tr><td className="table-message" colSpan={mode === "main" ? 6 : 5}>
            No indexed players match. Try a shorter prefix or exact UserId lookup.
          </td></tr>}
        </tbody>
      </table>
    </div>
  );
}
