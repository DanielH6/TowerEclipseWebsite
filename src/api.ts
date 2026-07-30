import type {
  AuthResponse,
  BugComment,
  BugDetailsResponse,
  BugReport,
  DeveloperNote,
  Dictionaries,
  DictionaryEntry,
  DictionaryName,
  RobloxStats,
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

export async function createBug(input: BugInput, csrfToken: string): Promise<BugReport> {
  const response = await fetch("/api/bugs", {
    method: "POST",
    credentials: "include",
    headers: writeHeaders(csrfToken),
    body: JSON.stringify(input),
  });
  const body = await readJson<{ report: BugReport }>(response);
  return body.report;
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
