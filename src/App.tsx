import type { ReactNode } from "react";
import { Routes, Route, Link } from "react-router-dom";
import HomePage from "./Pages/HomePage";
import AboutUs from "./Pages/About";
import Login from "./Pages/Login";
import "./App.css";

function Navigation() {
  return (
    <nav className="top-navigation" aria-label="Primary navigation">
      <Link to="/">HOME</Link>
      <Link to="/news">NEWS</Link>
      <Link to="/about">ABOUT US</Link>
      <Link to="/bugs">BUGS</Link>
      <Link to="/login" className="active">LOGIN</Link>
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
            title={socialLink.name}>
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

export default function App() {
  return (
    <PageShell>
      <Routes>
        <Route path="/" element={<HomePage/>} />
        <Route path="/about" element={<AboutUs />} />
        <Route path="/login" element={<Login/>} />
      </Routes>
    </PageShell>
  );
}