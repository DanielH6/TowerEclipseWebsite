export type AppRole = "member" | "leadqa" | "qa" | "dev";

export interface AuthenticatedUser {
  id: string;
  username: string;
  displayName: string;
  guildNickname: string | null;
  avatarUrl: string | null;
  role: AppRole;
  roleLabel: string;
}

export interface AuthenticatedResponse {
  authenticated: true;
  csrfToken: string;
  user: AuthenticatedUser;
}

export interface GuestResponse {
  authenticated: false;
}

export type AuthResponse = AuthenticatedResponse | GuestResponse;

export interface RobloxStats {
  totalPlays: number | null;
  monthlyPlayers: number | null;
  ccu: number | null;
  ccuMode: "current" | "peak28d";
  peakCcuWindowDays: number | null;
  partial: boolean;
  stale: boolean;
  updatedAt: string;
}

export interface DictionaryEntry {
  id: string;
  code: string;
  label: string;
  description: string;
  color: string | null;
  sortOrder: number;
  active: boolean;
  initial?: boolean;
  terminal?: boolean;
}

export type DictionaryName =
  | "statuses"
  | "versions"
  | "priorities"
  | "categories"
  | "types"
  | "devices";

export type Dictionaries = Record<DictionaryName, DictionaryEntry[]>;

export interface DictionarySnapshot {
  id: string;
  code: string;
  label: string;
  color: string | null;
  initial?: boolean;
  terminal?: boolean;
}

export interface ActorSnapshot {
  discordId: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  role: AppRole;
}

export interface ApprovalInfo {
  state: "pending" | "approved" | "rejected";
  approvedBy: ActorSnapshot | null;
  approvedAt: string | null;
  rejectedBy: ActorSnapshot | null;
  rejectedAt: string | null;
  comment: string;
}

export interface BugReport {
  id: string;
  displayId: string;
  status: DictionarySnapshot;
  version: DictionarySnapshot;
  priority: DictionarySnapshot;
  description: string;
  category: DictionarySnapshot;
  type: DictionarySnapshot;
  device: DictionarySnapshot;
  reporter: ActorSnapshot;
  submissionState?: "uploading" | "submitted";
  expectedAttachments?: number;
  submittedAt: string | null;
  approval: ApprovalInfo;
  commentsCount: number;
  developerNotesCount: number;
  attachmentsCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface AttachmentPolicy {
  enabled: boolean;
  maxFileSizeBytes: number;
  maxFilesPerReport: number;
  uploadUrlTtlSeconds: number;
  downloadUrlTtlSeconds: number;
  allowedExtensions: string[];
}

export interface BugAttachment {
  id: string;
  originalName: string;
  contentType: string;
  contentDisposition: string;
  previewKind: "image" | "video" | "file";
  declaredSize: number;
  size: number;
  status: "ready";
  uploader: ActorSnapshot;
  createdAt: string;
  uploadedAt: string | null;
  etag: string | null;
  downloadUrl: string | null;
}

export interface BugComment {
  id: string;
  body: string;
  author: ActorSnapshot;
  createdAt: string;
  updatedAt: string | null;
}

export interface DeveloperNote extends BugComment {}

export interface ActivityEvent {
  id: string;
  action: string;
  actor: ActorSnapshot;
  details: Record<string, unknown>;
  createdAt: string;
}

export interface BugDetailsResponse {
  report: BugReport;
  comments: BugComment[];
  developerNotes: DeveloperNote[];
  attachments: BugAttachment[];
  attachmentPolicy: AttachmentPolicy;
  activity: ActivityEvent[];
}

export type TournamentStatus = "draft" | "scheduled" | "live" | "completed" | "archived";
export type TournamentRegistrationStatus = "open" | "closed" | "invite_only";
export type TournamentParticipantStatus = "confirmed" | "waitlist" | "withdrawn";
export type TournamentMatchStatus = "scheduled" | "live" | "completed";
export type TournamentStage = "group" | "knockout";

export interface TournamentSettings {
  participantCap: number;
  groupCount: number;
  qualifiersPerGroup: number;
  pointsWin: number;
  pointsDraw: number;
  pointsLoss: number;
  allowDraws: boolean;
  autoAdvance: boolean;
  groupBestOf: number;
  knockoutBestOf: number;
  thirdPlaceMatch: boolean;
  checkInRequired: boolean;
  seedingMode: "random" | "balanced" | "manual";
  tiebreakers: string[];
}

export interface TournamentParticipant {
  id: string;
  displayName: string;
  robloxUsername: string;
  isr: number;
  status: TournamentParticipantStatus;
  groupId: string | null;
  pointsAdjustment: number;
  advanced: boolean;
  eliminated: boolean;
  checkedIn: boolean;
}

export interface TournamentMatch {
  id: string;
  stage: TournamentStage;
  groupId: string | null;
  round: number;
  bracketPosition: number;
  label: string;
  participantAId: string | null;
  participantBId: string | null;
  scoreA: number | null;
  scoreB: number | null;
  winnerId: string | null;
  status: TournamentMatchStatus;
  bestOf: number;
  scheduledAt: string | null;
  completedAt: string | null;
  notes: string;
  isBye: boolean;
  isThirdPlace?: boolean;
  sourceMatchAId: string | null;
  sourceMatchBId: string | null;
}

export interface TournamentStandingRow {
  participantId: string;
  displayName: string;
  robloxUsername: string;
  isr: number;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  scoreFor: number;
  scoreAgainst: number;
  scoreDifference: number;
  pointsAdjustment: number;
  points: number;
  rank: number;
  qualified: boolean;
}

export interface TournamentGroupStanding {
  id: string;
  label: string;
  rows: TournamentStandingRow[];
  totalMatches: number;
  expectedMatches: number;
  completedMatches: number;
  matchesComplete: boolean;
}

export interface TournamentLogEntry {
  id: string;
  type: "tournament_created" | "schedule_generated" | "match_result" | "advancement" | "points_adjustment" | "announcement";
  headline: string;
  detail: string;
  stage: TournamentStage | null;
  matchId: string | null;
  participantIds: string[];
  score: { a: number; b: number } | null;
  createdAt: string;
  recordedBy: string | null;
}

export interface TournamentBanner {
  id: string;
  originalName: string;
  contentType: string;
  size: number;
  uploadedAt: string;
  uploader: ActorSnapshot | null;
}

export interface Tournament {
  id: string;
  slug: string;
  name: string;
  tagline: string;
  description: string;
  rules: string;
  hostName: string;
  region: string;
  timezone: string;
  contact: string;
  registrationUrl: string;
  streamUrl: string;
  startsAt: string;
  endsAt: string;
  status: TournamentStatus;
  registrationStatus: TournamentRegistrationStatus;
  published: boolean;
  featured: boolean;
  banner: TournamentBanner | null;
  bannerImageUrl: string | null;
  settings: TournamentSettings;
  participants: TournamentParticipant[];
  matches: TournamentMatch[];
  log: TournamentLogEntry[];
  championId: string | null;
  groupStageGeneratedAt: string | null;
  knockoutGeneratedAt: string | null;
  createdAt: string;
  updatedAt: string;
  standings: TournamentGroupStanding[];
  participantCount: number;
  completedMatches: number;
  totalMatches: number;
  groupStageComplete: boolean;
}

export interface TournamentPreviewMatch {
  id: string;
  label: string;
  participantA: string;
  participantB: string;
  scoreA: number | null;
  scoreB: number | null;
  status: TournamentMatchStatus;
}

export interface TournamentPreviewGroup {
  id: string;
  label: string;
  rows: Array<{
    participantId: string;
    displayName: string;
    rank: number;
    points: number;
  }>;
}

export type TournamentSummary = Omit<
  Tournament,
  "participants" | "matches" | "log" | "standings" | "rules"
> & {
  previewMatches: TournamentPreviewMatch[];
  previewGroups: TournamentPreviewGroup[];
  recentResult: TournamentLogEntry | null;
};

export type UpdateStatus = "draft" | "published";
export type UpdateSectionKind =
  | "new_features"
  | "balancing"
  | "bug_fixes"
  | "small_changes";
export type UpdateImageLayout = "none" | "left" | "right";
export type BugFixLevel = "major" | "minor";

export interface UpdateImagePolicy {
  enabled: boolean;
  maxFileSizeBytes: number;
  maxImagesPerUpdate: number;
  uploadUrlTtlSeconds: number;
  downloadUrlTtlSeconds: number;
  allowedExtensions: string[];
}

export interface UpdateImage {
  id: string;
  originalName: string;
  contentType: string;
  size: number;
  status: "ready";
  uploader: ActorSnapshot;
  createdAt: string;
  uploadedAt: string | null;
  etag: string | null;
  downloadUrl: string | null;
}

export interface UpdateEntry {
  id: string;
  title: string;
  bodyHtml: string;
  imageId: string | null;
  imageLayout: UpdateImageLayout;
  caption: string;
  bugFixLevel: BugFixLevel | null;
  image?: UpdateImage | null;
  figureNumber?: number | null;
}

export interface UpdateSection {
  id: string;
  kind: UpdateSectionKind;
  title: string;
  introHtml: string;
  items: UpdateEntry[];
}

export interface GameUpdate {
  id: string;
  title: string;
  version: string;
  developerCommentHtml: string;
  coverImageId: string | null;
  coverImage: UpdateImage | null;
  status: UpdateStatus;
  sections: UpdateSection[];
  author: ActorSnapshot;
  lastEditedBy: ActorSnapshot;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  imagePolicy: UpdateImagePolicy;
}

export interface UpdateInput {
  title: string;
  version: string;
  developerCommentHtml: string;
  coverImageId: string | null;
  status: UpdateStatus;
  sections: Array<{
    id: string;
    kind: UpdateSectionKind;
    title: string;
    introHtml: string;
    items: Array<{
      id: string;
      title: string;
      bodyHtml: string;
      imageId: string | null;
      imageLayout: UpdateImageLayout;
      caption: string;
      bugFixLevel: BugFixLevel | null;
    }>;
  }>;
}
