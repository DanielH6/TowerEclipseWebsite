import { apiJson } from "./api";

export type PlayerMode = "main" | "battlefront";
export type PlayerSort = "level" | "gamesPlayed" | "rankedISR" | "lastJoinedDate" | "username" | "displayName";
export interface PlayerSummary {
  mode: PlayerMode;
  userId: string;
  identity: { username: string | null; displayName: string | null; source: string };
  stats: Record<string, number | null>;
  lastJoinedDate: string | null;
  source: { updatedAt: string | null; checkedAt: string | null };
}
export interface PlayerList {
  items: PlayerSummary[];
  nextCursor: string | null;
  snapshotAt: string;
  synthetic: boolean;
  coverage: { status: string; indexedRecords: number | null; description: string };
}
export interface SavedPlayerMode {
  status: "ready" | "missing" | "unavailable";
  summary: PlayerSummary | null;
  detail: Record<string, unknown> | null;
  detailStatus?: "withheld_pending_schema" | "synthetic_redacted";
  removedFields?: number;
  message?: string;
  freshness: { status: "saved_snapshot" | "stale" | "missing"; sourceUpdatedAt: string | null; lastCheckedAt: string; cacheAgeSeconds: number; reason: string | null } | null;
}
export interface PlayerProfile {
  userId: string;
  synthetic: boolean;
  main: SavedPlayerMode;
  battlefront: SavedPlayerMode;
}
export interface PlayerFilters {
  mode: PlayerMode;
  search: string;
  searchField: "username" | "displayName";
  sort: PlayerSort;
  order: "asc" | "desc";
  minLevel: string;
}
export function loadPlayers(filters: PlayerFilters, cursor: string, signal: AbortSignal) {
  const parameters = new URLSearchParams({ ...filters });
  if (cursor) parameters.set("cursor", cursor);
  return apiJson<PlayerList>(`/api/admin/game-data/players?${parameters}`, "GET", undefined, undefined, signal);
}
export function loadPlayerProfile(userId: string, signal: AbortSignal) {
  return apiJson<PlayerProfile>(`/api/admin/game-data/players/${encodeURIComponent(userId)}`, "GET", undefined, undefined, signal);
}
export function savedTime(value: string | null | undefined) {
  if (!value) return "Unknown";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : "Unknown";
}
export function playerNumber(value: number | null | undefined) {
  return value === null || value === undefined ? "—" : value.toLocaleString();
}
