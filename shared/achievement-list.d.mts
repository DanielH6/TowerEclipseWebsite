export interface AchievementEntry {
  id: string;
  name: string;
  completionMode?: "solo" | "grouped" | "";
  theoretical?: boolean;
  difficulty: number;
  verifier: string;
  verifiedOn?: string;
  verifiedVersion?: string;
  thumbnailId?: string;
  requirements: string;
  videoUrl: string;
}
export interface AchievementList {
  entries: AchievementEntry[];
  revision: number;
  updatedAt: string | null;
}
export const LIST_LIMIT: number;
export const THEORETICAL_LIMIT: number;
export function achievementRankings(entries: AchievementEntry[], includeTheoretical?: boolean): { entry: AchievementEntry; position: number }[];
export interface DifficultyDefinition { name: string; minimum: number; color: string; range: string }
export interface DifficultyRating extends DifficultyDefinition { rating: number; tier: string; label: string; eclipse: boolean }
export const DIFFICULTIES: DifficultyDefinition[];
export const DIFFICULTY_TIERS: { name: string; minimum: number; range: string }[];
export function difficultyRating(value: unknown): DifficultyRating | null;
export function formatVerificationDate(value: string | undefined): string;
export function achievementThumbnailUrl(id: string): string;
export function achievementCompletionMode(entry: Pick<AchievementEntry, "name" | "completionMode">): "solo" | "grouped" | "";
export const ACHIEVEMENT_FIELDS: (keyof Omit<AchievementEntry, "id">)[];
export interface AchievementChange {
  id: string;
  name: string;
  completionMode?: "solo" | "grouped" | "";
  theoretical?: boolean;
  kind: "added" | "removed" | "updated";
  fromPosition: number | null;
  toPosition: number | null;
  fields: { field: keyof Omit<AchievementEntry, "id">; before: string | number | boolean | null; after: string | number | boolean | null }[];
}
export interface ListPublication {
  id: string;
  revision: number;
  createdAt: string;
  editorName: string;
  note: string;
  changes: AchievementChange[];
}
export interface ListHistory { publications: ListPublication[]; nextCursor: string | null }
export function achievementChanges(before: AchievementEntry[], after: AchievementEntry[]): AchievementChange[];
export function youtubeVideoId(value: unknown): string | null;
export function validateListEntries(input: unknown): AchievementEntry[];
