import { useState } from "react";
import {
  HOME_INFO_SECTIONS,
  HOME_INTRO,
  HOME_VIDEO,
  type HomeInfoSection,
} from "../content/homeContent";
import "./HomePage.css";

function HomeInfoImage({ section }: { section: HomeInfoSection }) {
  const [failed, setFailed] = useState(false);

  return (
    <figure className="home-info-image">
      {!failed ? (
        <img
          src={section.imageSrc}
          alt={section.imageAlt}
          loading="lazy"
          onError={() => setFailed(true)}
        />
      ) : (
        <div className="home-info-image-placeholder">Image unavailable</div>
      )}
      <figcaption>{section.imageCaption}</figcaption>
    </figure>
  );
}

export default function HomePage() {
  return (
    <main className="home-page">
      <section className="home-hero" aria-labelledby="home-title">
        <div className="home-hero-content">
          <h1 id="home-title">TOWER <span>ECLIPSE</span></h1>
          <p className="home-hero-description">{HOME_INTRO.description}</p>
          <div className="home-hero-actions">
            <a
              className="primary-action"
              href={HOME_INTRO.robloxUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              {HOME_INTRO.buttonLabel}
            </a>
            <a className="hero-secondary-action" href="#game-systems">About the game</a>
          </div>
        </div>
        <a
          className="home-video"
          href={HOME_VIDEO.url}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Watch on YouTube: ${HOME_VIDEO.title} (opens in a new tab)`}
        >
          <div className="home-video-image">
            <img src={HOME_VIDEO.thumbnailSrc} alt="Tower Eclipse from day 0 to day 868 of development" width="1280" height="720" fetchPriority="high" />
            <span className="home-video-play" aria-hidden="true">▶</span>
          </div>
          <div className="home-video-caption">
            <h2>{HOME_VIDEO.title}</h2>
            <span>Watch on YouTube <span aria-hidden="true">↗</span></span>
          </div>
        </a>
      </section>

      <section className="home-info-band" id="game-systems" aria-label="About Tower Eclipse">
        <div className="home-info-list">
          {HOME_INFO_SECTIONS.map((section) => (
            <article className="home-info-card" key={section.title}>
              <div className="home-info-copy">
                <h2>{section.title}</h2>
                {section.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
              </div>
              <HomeInfoImage section={section} />
            </article>
          ))}
        </div>
      </section>

      <section className="home-enlist" aria-labelledby="enlist-title">
        <div className="home-enlist-content">
          <h2 id="enlist-title">Join the community</h2>
          <p>Follow development, meet the team and community, and get exclusive up-to-date progress leaks and opportunities for pre-release testing.</p>
          <div className="home-enlist-actions">
            <a className="primary-action" href="https://discord.gg/DSs9bxTUEr" target="_blank" rel="noopener noreferrer">Join the Discord</a>
            <a className="hero-secondary-action" href="/news">Latest news <span aria-hidden="true">→</span></a>
          </div>
        </div>
      </section>
    </main>
  );
}
