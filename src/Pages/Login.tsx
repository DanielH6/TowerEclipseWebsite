import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "../router";
import { useAuth } from "../AuthContext";

const authenticationErrors: Record<string, string> = {
  missing_role: "Your Discord account does not have access to this portal.",
  not_in_server: "Your Discord account is not a member of the configured Tower Eclipse server.",
  oauth_cancelled: "Discord authorization was cancelled.",
  oauth_failed: "Discord sign-in failed. Please try again.",
};

function DiscordIcon() {
  return (
    <svg aria-hidden="true" className="discord-icon" viewBox="0 0 24 24" fill="currentColor">
      <path d="M19.54 5.34A16.3 16.3 0 0 0 15.44 4a11.26 11.26 0 0 0-.52 1.07 15.15 15.15 0 0 0-5.84 0A11.3 11.3 0 0 0 8.56 4a16.5 16.5 0 0 0-4.11 1.35C1.85 9.2 1.15 12.96 1.5 16.66a16.69 16.69 0 0 0 5.03 2.53c.41-.55.77-1.14 1.08-1.76-.59-.22-1.16-.5-1.7-.82.14-.1.28-.21.41-.32a11.72 11.72 0 0 0 11.36 0c.14.11.27.22.41.32-.54.32-1.11.6-1.7.82.31.62.67 1.21 1.08 1.76a16.62 16.62 0 0 0 5.03-2.53c.42-4.29-.72-8.02-2.96-11.32ZM8.47 14.39c-1 0-1.82-.92-1.82-2.05s.8-2.06 1.82-2.06c1.01 0 1.84.93 1.82 2.06 0 1.13-.81 2.05-1.82 2.05Zm7.06 0c-1 0-1.82-.92-1.82-2.05s.8-2.06 1.82-2.06c1.01 0 1.84.93 1.82 2.06 0 1.13-.8 2.05-1.82 2.05Z" />
    </svg>
  );
}

function messageFromUrl(): string | null {
  const url = new URL(window.location.href);
  const errorCode = url.searchParams.get("authError");
  if (!errorCode) return null;
  url.searchParams.delete("authError");
  url.searchParams.delete("auth");
  window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  return authenticationErrors[errorCode] ?? "Access could not be verified.";
}

export default function Login() {
  const { loading, auth, error, refresh, recheck, logout } = useAuth();
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState<string | null>(() => messageFromUrl());
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    const parameters = new URLSearchParams(location.search);
    if (parameters.get("auth") === "success") {
      refresh()
        .then(() => navigate("/bugs", { replace: true }))
        .catch((reason: unknown) => setMessage(reason instanceof Error ? reason.message : "Could not finish login."));
    }
  }, [location.search]);

  if (loading) {
    return (
      <section className="content-band loading-band">
        <div className="loading-spinner" aria-label="Loading authentication" />
      </section>
    );
  }

  if (auth) {
    const { user } = auth;
    return (
      <section className="content-band" id="login">
        <article className="login-panel account-panel" aria-labelledby="account-title">
          <p className="section-kicker">DISCORD ACCESS CONFIRMED</p>
          <div className="account-header">
            {user.avatarUrl ? (
              <img className="avatar" src={user.avatarUrl} alt="" referrerPolicy="no-referrer" />
            ) : (
              <div className="avatar avatar-fallback" aria-hidden="true">{user.displayName.slice(0, 1).toUpperCase()}</div>
            )}
            <div>
              <h2 id="account-title">{user.displayName}</h2>
              <p>@{user.username}{user.guildNickname ? ` · ${user.guildNickname}` : ""}</p>
            </div>
          </div>
          <div className="role-panel">
            <span>WEBSITE ROLE</span>
            <strong data-role={user.role}>{user.roleLabel}</strong>
          </div>
          <div className="button-row">
            <button
              className="secondary-button"
              type="button"
              disabled={working}
              onClick={async () => {
                setWorking(true);
                try { await recheck(); } finally { setWorking(false); }
              }}
            >
              {working ? "CHECKING…" : "RE-CHECK DISCORD ROLE"}
            </button>
            <button
              className="danger-button"
              type="button"
              disabled={working}
              onClick={async () => {
                setWorking(true);
                try { await logout(); } finally { setWorking(false); }
              }}
            >
              SIGN OUT
            </button>
          </div>
        </article>
      </section>
    );
  }

  return (
    <section className="content-band" id="login">
      <article className="login-panel" aria-labelledby="auth-heading">
        <h2 id="auth-heading">LOGIN</h2>
        <p className="login-description">Sign in with your Tower Eclipse Discord account to continue.</p>
        {(message || error) && <div className="message error" role="alert">{message || error}</div>}
        <a className="discord-button" href="/api/auth/discord">
          <DiscordIcon />
          <span>CONTINUE WITH DISCORD</span>
        </a>
      </article>
    </section>
  );
}
