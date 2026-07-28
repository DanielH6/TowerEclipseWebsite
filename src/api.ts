import type { AuthResponse } from "./types";

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

export async function loadAuthentication(): Promise<AuthResponse> {
  const response = await fetch("/api/auth/me", {
    credentials: "include",
    headers: {
      Accept: "application/json",
    },
  });

  return readJson<AuthResponse>(response);
}

export async function recheckDiscordRole(
  csrfToken: string,
): Promise<AuthResponse> {
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
    headers: {
      "X-CSRF-Token": csrfToken,
    },
  });

  if (!response.ok) {
    throw new Error("Could not sign out.");
  }
}
