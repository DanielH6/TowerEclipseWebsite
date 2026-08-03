import type {
  AttachmentPolicy,
  AuthResponse,
  BugAttachment,
  BugComment,
  BugDetailsResponse,
  BugReport,
  DeveloperNote,
  Dictionaries,
  DictionaryEntry,
  DictionaryName,
  RobloxStats,
  Tournament,
  TournamentParticipant,
  TournamentSettings,
  TournamentSummary,
} from "./types";

async function readJson<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => null)) as T | null;

  if (!response.ok) {
    const message =
      body && typeof body === "object" && "error" in body
        ? String((body as { error: unknown }).error)
        : `Request failed with status ${response.status}.`;

    throw new Error(message);
  }

  if (body === null) {
    throw new Error("The server returned an empty response.");
  }

  return body;
}

function writeHeaders(csrfToken: string): HeadersInit {
  return {
    Accept: "application/json",
    "Content-Type": "application/json",
    "X-CSRF-Token": csrfToken,
  };
}

export async function loadRobloxStats(signal?: AbortSignal): Promise<RobloxStats> {
  const response = await fetch("/api/roblox/stats", {
    headers: { Accept: "application/json" },
    signal,
  });
  const body = await readJson<{ stats: RobloxStats }>(response);
  return body.stats;
}

export async function loadAuthentication(): Promise<AuthResponse> {
  const response = await fetch("/api/auth/me", {
    credentials: "include",
    headers: { Accept: "application/json" },
  });
  return readJson<AuthResponse>(response);
}

export async function recheckDiscordRole(csrfToken: string): Promise<AuthResponse> {
  const response = await fetch("/api/auth/recheck", {
    method: "POST",
    credentials: "include",
    headers: {
      Accept: "application/json",
      "X-CSRF-Token": csrfToken,
    },
  });
  return readJson<AuthResponse>(response);
}

export async function logout(csrfToken: string): Promise<void> {
  const response = await fetch("/api/auth/logout", {
    method: "POST",
    credentials: "include",
    headers: { "X-CSRF-Token": csrfToken },
  });
  if (!response.ok) throw new Error("Could not sign out.");
}

export async function loadDictionaries(): Promise<Dictionaries> {
  const response = await fetch("/api/dictionaries", {
    credentials: "include",
    headers: { Accept: "application/json" },
  });
  const body = await readJson<{ dictionaries: Dictionaries }>(response);
  return body.dictionaries;
}

export interface BugFilters {
  search?: string;
  status?: string;
  version?: string;
  priority?: string;
  category?: string;
  type?: string;
  device?: string;
}

export async function loadBugs(filters: BugFilters = {}): Promise<BugReport[]> {
  const parameters = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value) parameters.set(key, value);
  });
  const suffix = parameters.size ? `?${parameters.toString()}` : "";
  const response = await fetch(`/api/bugs${suffix}`, {
    credentials: "include",
    headers: { Accept: "application/json" },
  });
  const body = await readJson<{ reports: BugReport[] }>(response);
  return body.reports;
}

export interface BugInput {
  description: string;
  versionId: string;
  priorityId: string;
  categoryId: string;
  typeId: string;
  deviceId: string;
}

export async function createBug(
  input: BugInput,
  csrfToken: string,
  expectedAttachments = 0,
): Promise<BugReport> {
  const response = await fetch("/api/bugs", {
    method: "POST",
    credentials: "include",
    headers: writeHeaders(csrfToken),
    body: JSON.stringify({ ...input, expectedAttachments }),
  });
  const body = await readJson<{ report: BugReport }>(response);
  return body.report;
}

export async function finalizeBugSubmission(
  reportId: string,
  csrfToken: string,
): Promise<BugReport> {
  const response = await fetch(`/api/bugs/${encodeURIComponent(reportId)}/finalize`, {
    method: "POST",
    credentials: "include",
    headers: writeHeaders(csrfToken),
    body: "{}",
  });
  const body = await readJson<{ report: BugReport }>(response);
  return body.report;
}

export async function cancelBugSubmission(
  reportId: string,
  csrfToken: string,
): Promise<void> {
  const response = await fetch(`/api/bugs/${encodeURIComponent(reportId)}/cancel-submission`, {
    method: "DELETE",
    credentials: "include",
    headers: { "X-CSRF-Token": csrfToken },
  });
  if (!response.ok) await readJson(response);
}

export async function loadBug(reportId: string): Promise<BugDetailsResponse> {
  const response = await fetch(`/api/bugs/${encodeURIComponent(reportId)}`, {
    credentials: "include",
    headers: { Accept: "application/json" },
  });
  return readJson<BugDetailsResponse>(response);
}

export async function updateBug(
  reportId: string,
  changes: Partial<BugInput> & { statusId?: string },
  csrfToken: string,
): Promise<BugReport> {
  const response = await fetch(`/api/bugs/${encodeURIComponent(reportId)}`, {
    method: "PATCH",
    credentials: "include",
    headers: writeHeaders(csrfToken),
    body: JSON.stringify(changes),
  });
  const body = await readJson<{ report: BugReport }>(response);
  return body.report;
}

export async function approveBug(reportId: string, comment: string, csrfToken: string): Promise<BugReport> {
  const response = await fetch(`/api/bugs/${encodeURIComponent(reportId)}/approve`, {
    method: "POST",
    credentials: "include",
    headers: writeHeaders(csrfToken),
    body: JSON.stringify({ comment }),
  });
  const body = await readJson<{ report: BugReport }>(response);
  return body.report;
}

export async function rejectBug(reportId: string, comment: string, csrfToken: string): Promise<BugReport> {
  const response = await fetch(`/api/bugs/${encodeURIComponent(reportId)}/reject`, {
    method: "POST",
    credentials: "include",
    headers: writeHeaders(csrfToken),
    body: JSON.stringify({ comment }),
  });
  const body = await readJson<{ report: BugReport }>(response);
  return body.report;
}

export async function deleteBug(reportId: string, csrfToken: string): Promise<void> {
  const response = await fetch(`/api/bugs/${encodeURIComponent(reportId)}`, {
    method: "DELETE",
    credentials: "include",
    headers: { "X-CSRF-Token": csrfToken },
  });
  if (!response.ok) await readJson(response);
}

export async function addBugComment(reportId: string, body: string, csrfToken: string): Promise<BugComment> {
  const response = await fetch(`/api/bugs/${encodeURIComponent(reportId)}/comments`, {
    method: "POST",
    credentials: "include",
    headers: writeHeaders(csrfToken),
    body: JSON.stringify({ body }),
  });
  const result = await readJson<{ comment: BugComment }>(response);
  return result.comment;
}

export async function addDeveloperNote(reportId: string, body: string, csrfToken: string): Promise<DeveloperNote> {
  const response = await fetch(`/api/bugs/${encodeURIComponent(reportId)}/developer-notes`, {
    method: "POST",
    credentials: "include",
    headers: writeHeaders(csrfToken),
    body: JSON.stringify({ body }),
  });
  const result = await readJson<{ note: DeveloperNote }>(response);
  return result.note;
}

export async function loadAttachmentPolicy(): Promise<AttachmentPolicy> {
  const response = await fetch("/api/bugs/storage-config", {
    credentials: "include",
    headers: { Accept: "application/json" },
  });
  const body = await readJson<{ attachmentPolicy: AttachmentPolicy }>(response);
  return body.attachmentPolicy;
}

interface AttachmentUploadTicket {
  attachmentId: string;
  uploadUrl: string;
  uploadHeaders: Record<string, string>;
  expiresIn: number;
}

export async function uploadBugAttachment(
  reportId: string,
  file: File,
  csrfToken: string,
): Promise<BugAttachment> {
  const encodedReportId = encodeURIComponent(reportId);
  const ticketResponse = await fetch(`/api/bugs/${encodedReportId}/attachments`, {
    method: "POST",
    credentials: "include",
    headers: writeHeaders(csrfToken),
    body: JSON.stringify({
      fileName: file.name,
      contentType: file.type,
      size: file.size,
    }),
  });
  const ticket = await readJson<AttachmentUploadTicket>(ticketResponse);

  try {
    let uploadResponse: Response;
    try {
      uploadResponse = await fetch(ticket.uploadUrl, {
        method: "PUT",
        headers: ticket.uploadHeaders,
        body: file,
      });
    } catch (error) {
      if (error instanceof TypeError) {
        throw new Error(
          "The browser could not reach R2. Check that the bucket CORS policy contains the exact website origin and allows PUT with the Content-Type header.",
        );
      }
      throw error;
    }

    if (!uploadResponse.ok) {
      const details = await uploadResponse.text().catch(() => "");
      throw new Error(
        `R2 upload failed with status ${uploadResponse.status}${details ? `: ${details}` : "."}`,
      );
    }

    const completeResponse = await fetch(
      `/api/bugs/${encodedReportId}/attachments/${encodeURIComponent(ticket.attachmentId)}/complete`,
      {
        method: "POST",
        credentials: "include",
        headers: writeHeaders(csrfToken),
        body: "{}",
      },
    );
    const completed = await readJson<{ attachment: BugAttachment }>(completeResponse);
    return completed.attachment;
  } catch (error) {
    await fetch(
      `/api/bugs/${encodedReportId}/attachments/${encodeURIComponent(ticket.attachmentId)}`,
      {
        method: "DELETE",
        credentials: "include",
        headers: { "X-CSRF-Token": csrfToken },
      },
    ).catch(() => undefined);
    throw error;
  }
}

export async function deleteBugAttachment(
  reportId: string,
  attachmentId: string,
  csrfToken: string,
): Promise<void> {
  const response = await fetch(
    `/api/bugs/${encodeURIComponent(reportId)}/attachments/${encodeURIComponent(attachmentId)}`,
    {
      method: "DELETE",
      credentials: "include",
      headers: { "X-CSRF-Token": csrfToken },
    },
  );
  if (!response.ok) await readJson(response);
}

export async function loadAdminDictionary(dictionary: DictionaryName): Promise<DictionaryEntry[]> {
  const response = await fetch(`/api/admin/dictionaries/${dictionary}`, {
    credentials: "include",
    headers: { Accept: "application/json" },
  });
  const body = await readJson<{ entries: DictionaryEntry[] }>(response);
  return body.entries;
}

export interface DictionaryInput {
  code: string;
  label: string;
  description: string;
  color: string | null;
  sortOrder: number;
  active?: boolean;
  initial?: boolean;
  terminal?: boolean;
}

export async function createDictionaryEntry(
  dictionary: DictionaryName,
  input: DictionaryInput,
  csrfToken: string,
): Promise<DictionaryEntry> {
  const response = await fetch(`/api/admin/dictionaries/${dictionary}`, {
    method: "POST",
    credentials: "include",
    headers: writeHeaders(csrfToken),
    body: JSON.stringify(input),
  });
  const body = await readJson<{ entry: DictionaryEntry }>(response);
  return body.entry;
}

export async function updateDictionaryEntry(
  dictionary: DictionaryName,
  entryId: string,
  input: Partial<DictionaryInput>,
  csrfToken: string,
): Promise<DictionaryEntry> {
  const response = await fetch(`/api/admin/dictionaries/${dictionary}/${encodeURIComponent(entryId)}`, {
    method: "PATCH",
    credentials: "include",
    headers: writeHeaders(csrfToken),
    body: JSON.stringify(input),
  });
  const body = await readJson<{ entry: DictionaryEntry }>(response);
  return body.entry;
}

export async function archiveDictionaryEntry(
  dictionary: DictionaryName,
  entryId: string,
  csrfToken: string,
): Promise<void> {
  const response = await fetch(`/api/admin/dictionaries/${dictionary}/${encodeURIComponent(entryId)}`, {
    method: "DELETE",
    credentials: "include",
    headers: { "X-CSRF-Token": csrfToken },
  });
  if (!response.ok) await readJson(response);
}

export async function loadTournaments(): Promise<TournamentSummary[]> {
  const response = await fetch("/api/tournaments", {
    credentials: "include",
    headers: { Accept: "application/json" },
  });
  const body = await readJson<{ tournaments: TournamentSummary[] }>(response);
  return body.tournaments;
}

export async function loadTournament(identifier: string): Promise<Tournament> {
  const response = await fetch(`/api/tournaments/${encodeURIComponent(identifier)}`, {
    credentials: "include",
    headers: { Accept: "application/json" },
  });
  const body = await readJson<{ tournament: Tournament }>(response);
  return body.tournament;
}

export async function loadAdminTournaments(): Promise<TournamentSummary[]> {
  const response = await fetch("/api/admin/tournaments", {
    credentials: "include",
    headers: { Accept: "application/json" },
  });
  const body = await readJson<{ tournaments: TournamentSummary[] }>(response);
  return body.tournaments;
}

export async function loadAdminTournament(tournamentId: string): Promise<Tournament> {
  const response = await fetch(`/api/admin/tournaments/${encodeURIComponent(tournamentId)}`, {
    credentials: "include",
    headers: { Accept: "application/json" },
  });
  const body = await readJson<{ tournament: Tournament }>(response);
  return body.tournament;
}

export interface TournamentInput {
  name: string;
  slug: string;
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
  status: Tournament["status"];
  registrationStatus: Tournament["registrationStatus"];
  published: boolean;
  featured: boolean;
  settings: TournamentSettings;
}

async function readTournamentMutation(response: Response): Promise<Tournament> {
  const body = await readJson<{ tournament: Tournament }>(response);
  return body.tournament;
}

export async function createTournament(
  input: TournamentInput,
  csrfToken: string,
): Promise<Tournament> {
  return readTournamentMutation(await fetch("/api/admin/tournaments", {
    method: "POST",
    credentials: "include",
    headers: writeHeaders(csrfToken),
    body: JSON.stringify(input),
  }));
}

export async function updateTournament(
  tournamentId: string,
  input: Partial<TournamentInput>,
  csrfToken: string,
): Promise<Tournament> {
  return readTournamentMutation(await fetch(`/api/admin/tournaments/${encodeURIComponent(tournamentId)}`, {
    method: "PATCH",
    credentials: "include",
    headers: writeHeaders(csrfToken),
    body: JSON.stringify(input),
  }));
}

export async function loadTournamentBannerPolicy(): Promise<AttachmentPolicy> {
  const response = await fetch("/api/admin/tournaments/banner-config", {
    credentials: "include",
    headers: { Accept: "application/json" },
  });
  const body = await readJson<{ bannerPolicy: AttachmentPolicy }>(response);
  return body.bannerPolicy;
}

interface TournamentBannerUploadTicket {
  uploadId: string;
  uploadUrl: string;
  uploadHeaders: Record<string, string>;
  expiresIn: number;
}

export async function uploadTournamentBanner(
  tournamentId: string,
  file: File,
  csrfToken: string,
): Promise<Tournament> {
  const encodedTournamentId = encodeURIComponent(tournamentId);
  const ticketResponse = await fetch(`/api/admin/tournaments/${encodedTournamentId}/banner`, {
    method: "POST",
    credentials: "include",
    headers: writeHeaders(csrfToken),
    body: JSON.stringify({ fileName: file.name, contentType: file.type, size: file.size }),
  });
  const ticket = await readJson<TournamentBannerUploadTicket>(ticketResponse);

  try {
    let uploadResponse: Response;
    try {
      uploadResponse = await fetch(ticket.uploadUrl, {
        method: "PUT",
        headers: ticket.uploadHeaders,
        body: file,
      });
    } catch (error) {
      if (error instanceof TypeError) {
        throw new Error(
          "The browser could not reach R2. Check that the bucket CORS policy contains the exact website origin and allows PUT with the Content-Type header.",
        );
      }
      throw error;
    }

    if (!uploadResponse.ok) {
      const details = await uploadResponse.text().catch(() => "");
      throw new Error(
        `R2 upload failed with status ${uploadResponse.status}${details ? `: ${details}` : "."}`,
      );
    }

    return readTournamentMutation(await fetch(
      `/api/admin/tournaments/${encodedTournamentId}/banner/${encodeURIComponent(ticket.uploadId)}/complete`,
      {
        method: "POST",
        credentials: "include",
        headers: writeHeaders(csrfToken),
        body: "{}",
      },
    ));
  } catch (error) {
    await fetch(
      `/api/admin/tournaments/${encodedTournamentId}/banner/pending/${encodeURIComponent(ticket.uploadId)}`,
      {
        method: "DELETE",
        credentials: "include",
        headers: { "X-CSRF-Token": csrfToken },
      },
    ).catch(() => undefined);
    throw error;
  }
}

export async function deleteTournamentBanner(
  tournamentId: string,
  csrfToken: string,
): Promise<Tournament> {
  return readTournamentMutation(await fetch(
    `/api/admin/tournaments/${encodeURIComponent(tournamentId)}/banner`,
    {
      method: "DELETE",
      credentials: "include",
      headers: { "X-CSRF-Token": csrfToken },
    },
  ));
}

export interface TournamentParticipantInput {
  displayName: string;
  robloxUsername?: string;
  isr?: number;
  status?: TournamentParticipant["status"];
}

export async function addTournamentParticipants(
  tournamentId: string,
  participants: TournamentParticipantInput[],
  csrfToken: string,
): Promise<Tournament> {
  return readTournamentMutation(await fetch(
    `/api/admin/tournaments/${encodeURIComponent(tournamentId)}/participants`,
    {
      method: "POST",
      credentials: "include",
      headers: writeHeaders(csrfToken),
      body: JSON.stringify({ participants }),
    },
  ));
}

export async function updateTournamentParticipant(
  tournamentId: string,
  participantId: string,
  input: Partial<Pick<TournamentParticipant, "displayName" | "robloxUsername" | "isr" | "status" | "groupId" | "checkedIn">>,
  csrfToken: string,
): Promise<Tournament> {
  return readTournamentMutation(await fetch(
    `/api/admin/tournaments/${encodeURIComponent(tournamentId)}/participants/${encodeURIComponent(participantId)}`,
    {
      method: "PATCH",
      credentials: "include",
      headers: writeHeaders(csrfToken),
      body: JSON.stringify(input),
    },
  ));
}

export async function removeTournamentParticipant(
  tournamentId: string,
  participantId: string,
  csrfToken: string,
): Promise<Tournament> {
  return readTournamentMutation(await fetch(
    `/api/admin/tournaments/${encodeURIComponent(tournamentId)}/participants/${encodeURIComponent(participantId)}`,
    {
      method: "DELETE",
      credentials: "include",
      headers: { "X-CSRF-Token": csrfToken },
    },
  ));
}

async function tournamentAction(
  tournamentId: string,
  path: string,
  csrfToken: string,
  body: object = {},
): Promise<Tournament> {
  return readTournamentMutation(await fetch(
    `/api/admin/tournaments/${encodeURIComponent(tournamentId)}/${path}`,
    {
      method: "POST",
      credentials: "include",
      headers: writeHeaders(csrfToken),
      body: JSON.stringify(body),
    },
  ));
}

export function randomizeTournamentGroups(tournamentId: string, csrfToken: string) {
  return tournamentAction(tournamentId, "groups/randomize", csrfToken);
}

export function generateTournamentGroupSchedule(tournamentId: string, csrfToken: string) {
  return tournamentAction(tournamentId, "groups/schedule", csrfToken);
}

export function generateTournamentKnockout(tournamentId: string, csrfToken: string) {
  return tournamentAction(tournamentId, "knockout/generate", csrfToken);
}

export async function updateTournamentMatch(
  tournamentId: string,
  matchId: string,
  input: {
    status: "scheduled" | "live" | "completed";
    scoreA?: number | null;
    scoreB?: number | null;
    scheduledAt?: string | null;
    notes?: string;
  },
  csrfToken: string,
): Promise<Tournament> {
  return readTournamentMutation(await fetch(
    `/api/admin/tournaments/${encodeURIComponent(tournamentId)}/matches/${encodeURIComponent(matchId)}`,
    {
      method: "PATCH",
      credentials: "include",
      headers: writeHeaders(csrfToken),
      body: JSON.stringify(input),
    },
  ));
}

export function adjustTournamentPoints(
  tournamentId: string,
  participantId: string,
  input: { delta: number; reason: string },
  csrfToken: string,
) {
  return tournamentAction(
    tournamentId,
    `standings/${encodeURIComponent(participantId)}/adjust`,
    csrfToken,
    input,
  );
}

export function addTournamentAnnouncement(
  tournamentId: string,
  input: { headline: string; detail: string },
  csrfToken: string,
) {
  return tournamentAction(tournamentId, "log", csrfToken, input);
}
