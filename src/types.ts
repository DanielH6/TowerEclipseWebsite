export type AppRole = "leadqa" | "qa" | "dev";

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
  submittedAt: string;
  approval: ApprovalInfo;
  commentsCount: number;
  developerNotesCount: number;
  createdAt: string;
  updatedAt: string;
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
  activity: ActivityEvent[];
}
