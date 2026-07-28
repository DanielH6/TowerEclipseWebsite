import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { loadAuthentication, logout, recheckDiscordRole } from "./api";
import type { AuthenticatedResponse, AuthResponse } from "./types";
import "./App.css";

type ScreenState =
  | { type: "loading" }
  | { type: "guest"; message: string | null }
  | { type: "authenticated"; auth: AuthenticatedResponse }
  | { type: "error"; message: string };

const authenticationErrors: Record<string, string> = {
  missing_role:
    "Your Discord account does not have the QA Lead, QA Tester, or Developer role.",
  not_in_server:
    "Your Discord account is not a member of the configured Tower Eclipse server.",
  oauth_cancelled: "Discord authorization was cancelled.",
  oauth_failed: "Discord sign-in failed. Please try again.",
};

function DiscordIcon() {
  return (
    <svg
      aria-hidden="true"
      className="discord-icon"
      viewBox="0 0 24 24"
      fill="currentColor"
    >
      <path d="M19.54 5.34A16.3 16.3 0 0 0 15.44 4a11.26 11.26 0 0 0-.52 1.07 15.15 15.15 0 0 0-5.84 0A11.3 11.3 0 0 0 8.56 4a16.5 16.5 0 0 0-4.11 1.35C1.85 9.2 1.15 12.96 1.5 16.66a16.69 16.69 0 0 0 5.03 2.53c.41-.55.77-1.14 1.08-1.76-.59-.22-1.16-.5-1.7-.82.14-.1.28-.21.41-.32a11.72 11.72 0 0 0 11.36 0c.14.11.27.22.41.32-.54.32-1.11.6-1.7.82.31.62.67 1.21 1.08 1.76a16.62 16.62 0 0 0 5.03-2.53c.42-4.29-.72-8.02-2.96-11.32ZM8.47 14.39c-1 0-1.82-.92-1.82-2.05s.8-2.06 1.82-2.06c1.01 0 1.84.93 1.82 2.06 0 1.13-.81 2.05-1.82 2.05Zm7.06 0c-1 0-1.82-.92-1.82-2.05s.8-2.06 1.82-2.06c1.01 0 1.84.93 1.82 2.06 0 1.13-.8 2.05-1.82 2.05Z" />
    </svg>
  );
}

function Navigation() {
  const links = ["HOME", "NEWS", "ABOUT US", "BUGS", "LOGIN"];

  return (
    <nav className="top-navigation" aria-label="Primary navigation">
      {links.map((link) => (
        <a
          className={link === "LOGIN" ? "active" : undefined}
          href={link === "LOGIN" ? "#login" : `#${link.toLowerCase().replace(" ", "-")}`}
          key={link}
        >
          {link}
        </a>
      ))}
    </nav>
  );
}

function Stats() {
  return (
    <div className="stats-row" aria-label="Game statistics">
      <div>
        <span>TOTAL PLAYS</span>
        <strong>42K+</strong>
      </div>
      <div>
        <span>MONTHLY PLAYERS</span>
        <strong>100+</strong>
      </div>
      <div>
        <span>PEAK CCU</span>
        <strong>21+</strong>
      </div>
    </div>
  );
}

function Footer() {
  const socialLinks = [
    {
      name: "Roblox",
      icon: "/social/roblox.png",
      href: "https://www.roblox.com/games/80787635946901/Tower-Eclipse",
    },
    {
      name: "Tower Eclipse Wiki",
      icon: "/social/fandom.png",
      href: "https://tower-eclipse.fandom.com/wiki/Tower_Eclipse_Wiki",
    },
    {
      name: "Discord",
      icon: "/social/discord.png",
      href: "https://discord.gg/DSs9bxTUEr",
    },
    {
      name: "YouTube",
      icon: "/social/youtube.png",
      href: "https://www.youtube.com/channel/UCcMo-YhbpBWoxZ-d2n9IS1A",
    },
  ];

  return (
    <footer className="site-footer">
      <div className="social-row" aria-label="Social channels">
        {socialLinks.map((socialLink) => (
          <a
            className="social-link"
            href={socialLink.href}
            key={socialLink.name}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={socialLink.name}
            title={socialLink.name}
          >
            <img src={socialLink.icon} alt="" />
          </a>
        ))}

        <span
          className="social-link social-link-disabled"
          aria-label="Twitter link coming soon"
          title="Twitter link coming soon"
        >
          <img src="/social/twitter.png" alt="" />
        </span>
      </div>
      <p>© 2026 Eclipse Development Studio. All Rights Reserved.</p>
    </footer>
  );
}

function PageShell({ children }: { children: ReactNode }) {
  return (
    <main className="background-page">
      <div className="site-frame">
        <header className="hero-header">
          <Navigation />
          <h1>TOWER ECLIPSE</h1>
          <Stats />
        </header>
        {children}
        <Footer />
      </div>
    </main>
  );
}

function messageFromUrl(): string | null {
  const url = new URL(window.location.href);
  const errorCode = url.searchParams.get("authError");

  if (!errorCode) {
    return null;
  }

  url.searchParams.delete("authError");
  url.searchParams.delete("auth");
  window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);

  return authenticationErrors[errorCode] ?? "Access could not be verified.";
}

export default function App() {
  const [screen, setScreen] = useState<ScreenState>({ type: "loading" });
  const [working, setWorking] = useState(false);

  async function refreshAuthentication() {
    const result: AuthResponse = await loadAuthentication();

    if (result.authenticated) {
      setScreen({ type: "authenticated", auth: result });
    } else {
      setScreen({ type: "guest", message: messageFromUrl() });
    }
  }

  useEffect(() => {
    refreshAuthentication().catch((error: unknown) => {
      setScreen({
        type: "error",
        message:
          error instanceof Error
            ? error.message
            : "Could not contact the authentication server.",
      });
    });
  }, []);

  async function handleRecheck(auth: AuthenticatedResponse) {
    setWorking(true);

    try {
      const result = await recheckDiscordRole(auth.csrfToken);

      if (result.authenticated) {
        setScreen({ type: "authenticated", auth: result });
      } else {
        setScreen({
          type: "guest",
          message: "Your Discord access is no longer active.",
        });
      }
    } catch (error) {
      setScreen({
        type: "error",
        message:
          error instanceof Error
            ? error.message
            : "Could not re-check your Discord role.",
      });
    } finally {
      setWorking(false);
    }
  }

  async function handleLogout(auth: AuthenticatedResponse) {
    setWorking(true);

    try {
      await logout(auth.csrfToken);
      setScreen({ type: "guest", message: null });
    } catch (error) {
      setScreen({
        type: "error",
        message: error instanceof Error ? error.message : "Could not sign out.",
      });
    } finally {
      setWorking(false);
    }
  }

  if (screen.type === "loading") {
    return (
      <PageShell>
        <section className="content-band loading-band">
          <div className="loading-spinner" aria-label="Loading authentication" />
        </section>
      </PageShell>
    );
  }

  if (screen.type === "authenticated") {
    const { auth } = screen;
    const { user } = auth;

    return (
      <PageShell>
        <section className="content-band" id="login">
          <article className="login-panel account-panel" aria-labelledby="account-title">
            <p className="section-kicker">DISCORD ACCESS CONFIRMED</p>

            <div className="account-header">
              {user.avatarUrl ? (
                <img
                  className="avatar"
                  src={user.avatarUrl}
                  alt=""
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div className="avatar avatar-fallback" aria-hidden="true">
                  {user.displayName.slice(0, 1).toUpperCase()}
                </div>
              )}

              <div>
                <h2 id="account-title">{user.displayName}</h2>
                <p>
                  @{user.username}
                  {user.guildNickname ? ` · ${user.guildNickname}` : ""}
                </p>
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
                onClick={() => handleRecheck(auth)}
              >
                {working ? "CHECKING…" : "RE-CHECK DISCORD ROLE"}
              </button>

              <button
                className="danger-button"
                type="button"
                disabled={working}
                onClick={() => handleLogout(auth)}
              >
                SIGN OUT
              </button>
            </div>
          </article>
        </section>
      </PageShell>
    );
  }

  const message = screen.type === "error" ? screen.message : screen.message;

  return (
    <PageShell>
      <section className="content-band" id="login">
        <article className="login-panel" aria-labelledby="auth-heading">
          <h2 id="auth-heading">LOGIN</h2>

          <p className="login-description">
            Access is granted through your role in the Tower Eclipse Discord server.
          </p>

          {message && (
            <div className="message error" role="alert">
              {message}
            </div>
          )}

          <a className="discord-button" href="/api/auth/discord">
            <DiscordIcon />
            <span>CONTINUE WITH DISCORD</span>
          </a>

        </article>
      </section>
    </PageShell>
  );
}
