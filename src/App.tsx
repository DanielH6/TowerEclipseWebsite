import type { ReactNode } from "react";
import { Navigate, NavLink, RouteParamsProvider, useLocation } from "./router";
import { AuthProvider, useAuth } from "./AuthContext";
import ProtectedRoute from "./ProtectedRoute";
import HomePage from "./Pages/HomePage";
import AboutUs from "./Pages/About";
import News from "./Pages/News";
import Login from "./Pages/Login";
import BugsPage from "./Pages/Bugs";
import NewBugPage from "./Pages/NewBug";
import BugDetailsPage from "./Pages/BugDetails";
import AdminPage from "./Pages/Admin";
import "./App.css";

function Navigation() {
  const { auth } = useAuth();
  const links = [
    { to: "/", label: "HOME", end: true },
    { to: "/news", label: "NEWS" },
    { to: "/about", label: "ABOUT US" },
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
        {auth ? "ACCOUNT" : "LOGIN"}
      </NavLink>
    </nav>
  );
}

function Stats() {
  return (
    <div className="stats-row" aria-label="Game statistics">
      <div><span>TOTAL PLAYS</span><strong>42K+</strong></div>
      <div><span>MONTHLY PLAYERS</span><strong>100+</strong></div>
      <div><span>PEAK CCU</span><strong>21+</strong></div>
    </div>
  );
}

function Footer() {
  const socialLinks = [
    { name: "Roblox", icon: "/social/roblox.png", href: "https://www.roblox.com/games/80787635946901/Tower-Eclipse" },
    { name: "Tower Eclipse Wiki", icon: "/social/fandom.png", href: "https://tower-eclipse.fandom.com/wiki/Tower_Eclipse_Wiki" },
    { name: "Discord", icon: "/social/discord.png", href: "https://discord.gg/DSs9bxTUEr" },
    { name: "YouTube", icon: "/social/youtube.png", href: "https://www.youtube.com/channel/UCcMo-YhbpBWoxZ-d2n9IS1A" },
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
        <span className="social-link social-link-disabled" aria-label="Twitter link coming soon" title="Twitter link coming soon">
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

function AppRoutes() {
  const { pathname } = useLocation();
  let element: ReactNode;
  let params: Record<string, string> = {};

  if (pathname === "/") element = <HomePage />;
  else if (pathname === "/news") element = <News />;
  else if (pathname === "/about") element = <AboutUs />;
  else if (pathname === "/login") element = <Login />;
  else if (pathname === "/bugs") element = <ProtectedRoute><BugsPage /></ProtectedRoute>;
  else if (pathname === "/bugs/new") element = <ProtectedRoute><NewBugPage /></ProtectedRoute>;
  else if (pathname === "/admin") element = <ProtectedRoute role="dev"><AdminPage /></ProtectedRoute>;
  else {
    const bugMatch = pathname.match(/^\/bugs\/([^/]+)$/);
    const reportId = bugMatch?.[1];
    if (reportId) {
      params = { reportId: decodeURIComponent(reportId) };
      element = <ProtectedRoute><BugDetailsPage /></ProtectedRoute>;
    } else {
      element = <Navigate to="/" replace />;
    }
  }

  return <RouteParamsProvider params={params}>{element}</RouteParamsProvider>;
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
