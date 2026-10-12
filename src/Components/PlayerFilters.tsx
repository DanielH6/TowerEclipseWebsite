import type { FormEvent } from "react";
import type { PlayerFilters as Filters, PlayerMode, PlayerSort } from "../player-data";

interface Props {
  draft: Filters;
  onChange: (value: Filters) => void;
  onSubmit: (event: FormEvent) => void;
}

export default function PlayerFilters({ draft, onChange, onSubmit }: Props) {
  const searching = Boolean(draft.search.trim());
  return (
    <form className="bug-filters player-filters" onSubmit={onSubmit}>
      <label className="filter-field">
        <span>MODE</span>
        <select value={draft.mode} onChange={event => onChange({
          ...draft, mode: event.target.value as PlayerMode,
          sort: draft.sort === "rankedISR" ? "level" : draft.sort,
        })}>
          <option value="main">Main</option>
          <option value="battlefront">Battlefront</option>
        </select>
      </label>
      <label className="filter-field">
        <span>NAME PREFIX</span>
        <input value={draft.search} maxLength={64} placeholder="Starts with…"
          onChange={event => onChange({ ...draft, search: event.target.value })} />
      </label>
      <label className="filter-field">
        <span>SEARCH FIELD</span>
        <select value={draft.searchField} onChange={event => onChange({
          ...draft, searchField: event.target.value as "username" | "displayName",
        })}>
          <option value="username">Username</option>
          <option value="displayName">Display name</option>
        </select>
      </label>
      <label className="filter-field">
        <span>SORT</span>
        <select value={searching ? draft.searchField : draft.sort} disabled={searching} onChange={event => onChange({
          ...draft, sort: event.target.value as PlayerSort,
          minLevel: event.target.value === "level" ? draft.minLevel : "",
        })}>
          <option value="level">Level</option>
          <option value="gamesPlayed">Games played</option>
          {draft.mode === "main" && <option value="rankedISR">Ranked ISR</option>}
          <option value="lastJoinedDate">Last joined</option>
          <option value="username">Username</option>
          <option value="displayName">Display name</option>
        </select>
      </label>
      <label className="filter-field">
        <span>ORDER</span>
        <select value={searching ? "asc" : draft.order} disabled={searching} onChange={event => onChange({
          ...draft, order: event.target.value as "asc" | "desc",
        })}>
          <option value="desc">Descending</option>
          <option value="asc">Ascending</option>
        </select>
      </label>
      <label className="filter-field">
        <span>MINIMUM LEVEL</span>
        <input type="number" min="0" max="9999999" step="1" value={draft.minLevel}
          disabled={searching || draft.sort !== "level"}
          onChange={event => onChange({ ...draft, minLevel: event.target.value })} />
      </label>
      <button className="primary-action" type="submit">APPLY FILTERS</button>
    </form>
  );
}
