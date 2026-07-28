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
