import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { loadAuthentication, logout as logoutRequest, recheckDiscordRole } from "./api";
import type { AuthenticatedResponse } from "./types";

interface AuthContextValue {
  loading: boolean;
  auth: AuthenticatedResponse | null;
  error: string | null;
  refresh: () => Promise<void>;
  recheck: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [auth, setAuth] = useState<AuthenticatedResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setError(null);
    const result = await loadAuthentication();
    setAuth(result.authenticated ? result : null);
  }

  useEffect(() => {
    refresh()
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : "Could not contact the authentication server.");
      })
      .finally(() => setLoading(false));
  }, []);

  async function recheck() {
    if (!auth) return;
    const result = await recheckDiscordRole(auth.csrfToken);
    setAuth(result.authenticated ? result : null);
  }

  async function logout() {
    if (!auth) return;
    await logoutRequest(auth.csrfToken);
    setAuth(null);
  }

  const value = useMemo<AuthContextValue>(
    () => ({ loading, auth, error, refresh, recheck, logout }),
    [loading, auth, error],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider.");
  return value;
}
