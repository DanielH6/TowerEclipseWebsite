import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import { Navigate, NavLink, RouteParamsProvider, useLocation } from "./router";
import { AuthProvider, useAuth } from "./AuthContext";
import { loadRobloxStats } from "./api";
import type { RobloxStats } from "./types";
import ProtectedRoute from "./ProtectedRoute";
import HomePage from "./Pages/HomePage";
import AboutUs from "./Pages/About";
import News from "./Pages/News";
import Login from "./Pages/Login";
import BugsPage from "./Pages/Bugs";
import NewBugPage from "./Pages/NewBug";
import BugDetailsPage from "./Pages/BugDetails";
import AdminPage from "./Pages/Admin";
import AdminUpdatesPage from "./Pages/AdminUpdates";
import UpdateEditorPage from "./Pages/UpdateEditor";
import UpdateDetailsPage from "./Pages/UpdateDetails";
import { BUG_STAFF_ROLES } from "./roles";
import "./App.css";

const EsportsPage = lazy(() => import("./Pages/Esports"));
const TournamentDetailsPage = lazy(() => import("./Pages/TournamentDetails"));
const TournamentManagerPage = lazy(() => import("./Pages/TournamentManager"));

function Navigation() {
  const { auth } = useAuth();
  const links = [
    { to: "/", label: "HOME", end: true },
    { to: "/about", label: "ABOUT US" },
    { to: "/news", label: "NEWS" },
    { to: "/esports", label: "ESPORTS" },
    { to: "/bugs", label: "BUGS" },
  ];

  return (
    <nav className="top-navigation" aria-label="Primary navigation">
      {links.map((link) => (
        <NavLink
          to={link.to}
          end={link.end}
          className={({ isActive }) => (isActive ? "active" : undefined)}
          key={link.to}
        >
          {link.label}
        </NavLink>
      ))}
      {auth?.user.role === "dev" && (
        <NavLink to="/admin" className={({ isActive }) => (isActive ? "active" : undefined)}>ADMIN</NavLink>
      )}
      <NavLink to="/login" className={({ isActive }) => (isActive ? "active" : undefined)}>
        ACCOUNT
      </NavLink>
    </nav>
  );
}

function Stats() {
  const [stats, setStats] = useState<RobloxStats | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let controller = new AbortController();

    async function refresh() {
      controller.abort();
      controller = new AbortController();

      try {
        const nextStats = await loadRobloxStats(controller.signal);
        setStats(nextStats);
        setFailed(false);
      } catch (error) {
        if ((error as Error).name !== "AbortError") {
          setFailed(true);
        }
      }
    }

    void refresh();
    const interval = window.setInterval(() => void refresh(), 5 * 60 * 1000);

    return () => {
      window.clearInterval(interval);
      controller.abort();
    };
  }, []);

  const format = (value: number | null | undefined) => (
    value === null || value === undefined
      ? "—"
      : new Intl.NumberFormat("en-US", {
          notation: "compact",
          maximumFractionDigits: 1,
        }).format(value)
  );
  const exact = (value: number | null | undefined) => (
    value === null || value === undefined
      ? "Unavailable"
      : new Intl.NumberFormat("en-US").format(value)
  );
  const ccuLabel = stats?.ccuMode === "current"
    ? "CURRENT CCU"
    : "PEAK CCU (28D)";
  const statusText = failed
    ? "Roblox statistics are temporarily unavailable."
    : stats
      ? `Roblox statistics updated ${new Date(stats.updatedAt).toLocaleString()}.`
      : "Loading Roblox statistics.";

  return (
    <div
      className="stats-row"
      aria-label="Live Roblox game statistics"
      aria-busy={!stats && !failed}
    >
      <div title={`Total plays: ${exact(stats?.totalPlays)}`}>
        <span>TOTAL PLAYS</span>
        <strong>{format(stats?.totalPlays)}</strong>
      </div>
      <div title={`Monthly active players: ${exact(stats?.monthlyPlayers)}`}>
        <span>MONTHLY PLAYERS</span>
        <strong>{format(stats?.monthlyPlayers)}</strong>
      </div>
      <div title={`${ccuLabel}: ${exact(stats?.ccu)}`}>
        <span>{ccuLabel}</span>
        <strong>{format(stats?.ccu)}</strong>
      </div>
      <span className="stats-status" role="status" aria-live="polite">
        {statusText}
      </span>
    </div>
  );
}

function Footer() {
  const socialLinks = [
    { name: "Roblox", icon: "/social/roblox.png", href: "https://www.roblox.com/games/80787635946901/Tower-Eclipse" },
    { name: "Tower Eclipse Wiki", icon: "/social/fandom.png", href: "https://tower-eclipse.fandom.com/wiki/Tower_Eclipse_Wiki" },
    { name: "Discord", icon: "/social/discord.png", href: "https://discord.gg/DSs9bxTUEr" },
    { name: "YouTube", icon: "/social/youtube.png", href: "https://www.youtube.com/channel/UCcMo-YhbpBWoxZ-d2n9IS1A" },
    { name: "Twitter", icon: "/social/twitter.png", href: "https://x.com/Superstitic" },
    { name: "Patreon", icon: "/social/patreon.png", href: "https://www.patreon.com/cw/towereclipse" },
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
        
      </div>
      <p>© 2026 Eclipse Development Studio. All Rights Reserved.</p>
    </footer>
  );
}

function PageShell({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const isAboutPage = pathname === "/about";

  return (
    <main className="background-page">
      <div className="site-frame">
        <header className="hero-header">
          <Navigation />
          {isAboutPage ? (
            <h1>ABOUT US</h1>
          ) : (
            <h1>
              TOWER <span className="hero-title-accent">ECLIPSE</span>
            </h1>
          )}
          <Stats />
        </header>
        {children}
        <Footer />
      </div>
    </main>
  );
}

function AppRoutes() {
  const { pathname } = useLocation();
  let element: ReactNode;
  let params: Record<string, string> = {};

  if (pathname === "/") element = <HomePage />;
  else if (pathname === "/news") element = <News />;
  else if (pathname === "/esports") element = <EsportsPage />;
  else if (pathname === "/esports/manage") {
    element = <ProtectedRoute role="dev" fallbackTo="/esports"><TournamentManagerPage /></ProtectedRoute>;
  }
  else if (pathname === "/esports/manage/new") {
    params = { tournamentId: "new" };
    element = <ProtectedRoute role="dev" fallbackTo="/esports"><TournamentManagerPage /></ProtectedRoute>;
  }
  else if (pathname === "/about") element = <AboutUs />;
  else if (pathname === "/login") element = <Login />;
  else if (pathname === "/bugs") element = <BugsPage />;
  else if (pathname === "/bugs/new") {
    element = <ProtectedRoute roles={BUG_STAFF_ROLES}><NewBugPage /></ProtectedRoute>;
  }
  else if (pathname === "/admin") element = <ProtectedRoute role="dev"><AdminPage /></ProtectedRoute>;
  else if (pathname === "/admin/updates") element = <ProtectedRoute role="dev"><AdminUpdatesPage /></ProtectedRoute>;
  else {
    const newsMatch = pathname.match(/^\/news\/([^/]+)$/);
    const publicUpdateId = newsMatch?.[1];
    const updateEditorMatch = pathname.match(/^\/admin\/updates\/([^/]+)$/);
    const updateId = updateEditorMatch?.[1];

    if (publicUpdateId) {
      params = { updateId: decodeURIComponent(publicUpdateId) };
      element = <UpdateDetailsPage />;
    } else if (updateId) {
      params = { updateId: decodeURIComponent(updateId) };
      element = <ProtectedRoute role="dev"><UpdateEditorPage /></ProtectedRoute>;
    } else {
      const tournamentManagerMatch = pathname.match(/^\/esports\/manage\/([^/]+)$/);
    const managedTournamentId = tournamentManagerMatch?.[1];
    if (managedTournamentId) {
      params = { tournamentId: decodeURIComponent(managedTournamentId) };
      element = <ProtectedRoute role="dev" fallbackTo="/esports"><TournamentManagerPage /></ProtectedRoute>;
    } else {
      const tournamentMatch = pathname.match(/^\/esports\/([^/]+)$/);
      const tournamentSlug = tournamentMatch?.[1];
      if (tournamentSlug) {
        params = { tournamentSlug: decodeURIComponent(tournamentSlug) };
        element = <TournamentDetailsPage />;
      } else {
        const bugMatch = pathname.match(/^\/bugs\/([^/]+)$/);
        const reportId = bugMatch?.[1];
        if (reportId) {
          params = { reportId: decodeURIComponent(reportId) };
          element = <BugDetailsPage />;
        } else {
          element = <Navigate to="/" replace />;
        }
      }
    }
    }
  }

  return (
    <RouteParamsProvider params={params}>
      <Suspense fallback={<section className="content-band loading-band"><div className="loading-spinner" aria-label="Loading page" /></section>}>
        {element}
      </Suspense>
    </RouteParamsProvider>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <PageShell>
        <AppRoutes />
      </PageShell>
    </AuthProvider>
  );
}
