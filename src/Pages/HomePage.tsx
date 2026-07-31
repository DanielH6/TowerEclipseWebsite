import { useState } from "react";
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
  return (
    <main className="home-page">
      <section className="content-band home-intro-band">
        <article className="home-intro-panel">
          <p className="workspace-kicker">{HOME_INTRO.kicker}</p>
          <h2>{HOME_INTRO.title}</h2>
          <p>{HOME_INTRO.description}</p>
          <a
            className="primary-action"
            href={HOME_INTRO.robloxUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            {HOME_INTRO.buttonLabel}
          </a>
        </article>
      </section>

      <section className="home-info-band" aria-label="About Tower Eclipse">
        <div className="home-info-list">
          {HOME_INFO_SECTIONS.map((section) => (
            <article className="home-info-card" key={section.title}>
              <div className="home-info-copy">
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
    </main>
  );
}
