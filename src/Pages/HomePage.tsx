import { useEffect, useState } from "react";
import {
  HOME_INFO_SECTIONS,
  HOME_INTRO,
  type HomeInfoSection,
} from "../content/homeContent";
import "./HomePage.css";

function HomeInfoImage({ section }: { section: HomeInfoSection }) {
  const [failed, setFailed] = useState(false);

  return (
    <div className="home-info-image">
      {!failed ? (
        <img
          src={section.imageSrc}
          alt={section.imageAlt}
          loading="lazy"
          onError={() => setFailed(true)}
        />
      ) : (
        <div
          className="home-info-image-placeholder"
          role="img"
          aria-label={`${section.title} image has not been added yet`}
        >
          ADD {section.imageSrc.replace("/home/", "").toUpperCase()}
        </div>
      )}
    </div>
  );
}

export default function HomePage() {
  useEffect(() => {
    const revealElements = Array.from(document.querySelectorAll<HTMLElement>("[data-reveal]"));
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (reducedMotion) {
      revealElements.forEach((element) => element.classList.add("is-visible"));
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.16, rootMargin: "0px 0px -48px" },
    );

    revealElements.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, []);

  return (
    <main className="home-page">
      <section className="home-hero" aria-labelledby="home-title">
        <div className="home-hero-art" aria-hidden="true" />
        <div className="home-hero-grid" aria-hidden="true" />
        <div className="home-hero-content">
          <p className="home-overline" data-reveal="up">{HOME_INTRO.kicker}</p>
          <h1 id="home-title" data-reveal="up">TOWER <span>ECLIPSE</span></h1>
          <p className="home-hero-description" data-reveal="up">{HOME_INTRO.description}</p>
          <div className="home-hero-actions" data-reveal="up">
            <a
              className="primary-action"
              href={HOME_INTRO.robloxUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              <span aria-hidden="true">↗</span> {HOME_INTRO.buttonLabel}
            </a>
            <a className="hero-secondary-action" href="#game-systems">
              EXPLORE THE PROJECT <span aria-hidden="true">↓</span>
            </a>
          </div>
        </div>
        <div className="home-hero-readout" data-reveal="left" aria-label="Project summary">
          <span className="readout-label">OPERATIONAL BRIEF</span>
          <strong>DEFEND SORORTERRA.</strong>
          <p>Strategic tower defence created by players and developers who care about strategy.</p>
          <div className="readout-metrics">
            <span><b>01</b> STORY</span>
            <span><b>02</b> SURVIVAL</span>
            <span><b>03</b> RANKED</span>
          </div>
        </div>
        <a className="scroll-cue" href="#game-systems" aria-label="Scroll to game systems">
          <span>SCROLL TO DISCOVER</span><i aria-hidden="true" />
        </a>
      </section>

      <section className="home-info-band" id="game-systems" aria-label="Tower Eclipse systems">
        <div className="home-info-list">
          {HOME_INFO_SECTIONS.map((section, index) => (
            <article className="home-info-card" data-reveal="up" key={section.title}>
              <div className="home-info-copy">
                <p className="home-overline">{String(index + 1).padStart(2, "0")} // {section.title}</p>
                <h2>{section.title}</h2>
                {section.paragraphs.map((paragraph) => (
                  <p key={paragraph}>{paragraph}</p>
                ))}
              </div>
              <HomeInfoImage section={section} />
            </article>
          ))}
        </div>
      </section>

      <section className="home-enlist" aria-labelledby="enlist-title">
        <div className="home-enlist-content" data-reveal="up">
          <h2 id="enlist-title">JOIN THE <span>COMMUNITY</span></h2>
          <p>Follow development, meet the team and community, and get exclusive up-to-date progress leaks and opportunities for pre-release testing.</p>
          <div className="home-enlist-actions">
            <a className="primary-action" href="https://discord.gg/DSs9bxTUEr" target="_blank" rel="noopener noreferrer">JOIN THE DISCORD <span aria-hidden="true">↗</span></a>
            <a className="hero-secondary-action" href="/news">VIEW LATEST NEWS <span aria-hidden="true">→</span></a>
          </div>
        </div>
      </section>
    </main>
  );
}
