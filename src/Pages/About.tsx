import { useState, type CSSProperties, type SVGProps } from "react";
import {
  ABOUT_CREDITS,
  ABOUT_INTRO,
  ABOUT_STORY_SECTIONS,
  CREDIT_GROUPS,
  type AboutStorySection,
  type CreditIcon as CreditIconName,
  type CreditMember,
} from "../content/aboutContent";
import "./About.css";

const CREDIT_PAGE_SIZE = 4;

function StoryImage({ image, eyebrow, index }: {
  image: AboutStorySection["images"][number];
  eyebrow: string;
  index: number;
}) {
  const [failed, setFailed] = useState(false);
  const hasImage = Boolean(image.src);

  return (
    <figure className="about-story-image">
      {hasImage && !failed ? (
        <img
          src={image.src}
          alt={image.alt}
          loading="lazy"
          onError={() => setFailed(true)}
        />
      ) : (
        <div className="about-image-placeholder" role="img" aria-label="About artwork has not been added yet">
          <span>IMAGE SLOT</span>
          <strong>{hasImage ? image.src : `ADD IMAGE ${index + 1}`}</strong>
        </div>
      )}
      <figcaption>{eyebrow} · {index + 1} OF 3</figcaption>
    </figure>
  );
}

function CreditIcon({ name, ...props }: { name: CreditIconName } & SVGProps<SVGSVGElement>) {
  const common = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    ...props,
  };

  if (name === "development") {
    return (
      <svg {...common}>
        <path d="m14.7 6.3 3-3a4 4 0 0 1-5.15 5.15L6.2 14.8a2.1 2.1 0 0 1-3-3l6.35-6.35A4 4 0 0 1 14.7.3l-3 3 3 3Z" />
        <path d="m13 12 8 8-1 1-8-8" />
      </svg>
    );
  }

  if (name === "contributors") {
    return (
      <svg {...common}>
        <path d="m12 2 8 4.5v9L12 20l-8-4.5v-9L12 2Z" />
        <path d="m4.4 6.7 7.6 4.2 7.6-4.2M12 11v9" />
      </svg>
    );
  }

  if (name === "quality") {
    return (
      <svg {...common}>
        <path d="m4 6 2 2 4-4M4 13l2 2 4-4M13 6h7M13 13h7M4 20l2-2 2 2M13 20h7" />
      </svg>
    );
  }

  if (name === "testing") {
    return (
      <svg {...common}>
        <path d="M9 2h6M10 2v5l-5.5 9.5A3 3 0 0 0 7.1 21h9.8a3 3 0 0 0 2.6-4.5L14 7V2" />
        <path d="M7.4 15h9.2M10 12h4" />
      </svg>
    );
  }

  return (
    <svg {...common}>
      <path d="m12 2 2.6 6.1L21 9l-4.8 4.4 1.2 6.4-5.4-3.1-5.4 3.1 1.2-6.4L3 9l6.4-.9L12 2Z" />
    </svg>
  );
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function CreditMemberList({
  groupTitle,
  members,
}: {
  groupTitle: string;
  members: CreditMember[];
}) {
  const [page, setPage] = useState(0);
  const pageCount = Math.ceil(members.length / CREDIT_PAGE_SIZE);
  const pageStart = page * CREDIT_PAGE_SIZE;
  const visibleMembers = members.slice(pageStart, pageStart + CREDIT_PAGE_SIZE);

  return (
    <div className="credit-member-area">
      <ul className="credit-member-list">
        {visibleMembers.map((member) => (
          <li key={`${member.name}-${member.handle}`}>
            <span className="credit-avatar" aria-hidden="true">{initials(member.name)}</span>
            <span className="credit-member-name">
              <strong>{member.name}</strong>
              <small>{member.handle}</small>
            </span>
            <span className="credit-role">{member.contribution}</span>
          </li>
        ))}
      </ul>

      {pageCount > 1 && (
        <nav className="credit-pagination" aria-label={`${groupTitle} credit pages`}>
          <button
            type="button"
            onClick={() => setPage((current) => Math.max(0, current - 1))}
            disabled={page === 0}
            aria-label={`Previous ${groupTitle} credits page`}
          >
            <span aria-hidden="true">‹</span>
          </button>
          <span className="credit-page-status" aria-live="polite">
            <strong>{pageStart + 1}–{Math.min(pageStart + CREDIT_PAGE_SIZE, members.length)}</strong>
            <small>OF {members.length}</small>
          </span>
          <button
            type="button"
            onClick={() => setPage((current) => Math.min(pageCount - 1, current + 1))}
            disabled={page === pageCount - 1}
            aria-label={`Next ${groupTitle} credits page`}
          >
            <span aria-hidden="true">›</span>
          </button>
        </nav>
      )}
    </div>
  );
}

export default function AboutUs() {
  const creditBackgroundStyle = {
    "--credits-background": `url(${ABOUT_CREDITS.backgroundImage})`,
  } as CSSProperties;

  return (
    <div className="about-page">
      <section className="about-introduction" aria-labelledby="about-intro-title">
        <p className="about-eyebrow">{ABOUT_INTRO.eyebrow}</p>
        <h2 id="about-intro-title">{ABOUT_INTRO.title}</h2>
        <p>{ABOUT_INTRO.description}</p>
      </section>

      <section className="about-story-band" aria-label="Our story">
        <div className="about-story-list">
          {ABOUT_STORY_SECTIONS.map((section, index) => (
            <article className="about-story-card" key={section.title}>
              <div className="about-story-copy">
                <span className="about-story-number" aria-hidden="true">0{index + 1}</span>
                <p className="about-eyebrow">{section.eyebrow}</p>
                <h2>{section.title}</h2>
                <p className="about-byline">{section.byline}</p>
                <div className="about-story-paragraphs">
                  {section.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
                </div>
              </div>
              <div className="about-story-images" aria-label={`${section.title} image gallery`}>
                {section.images.map((image, imageIndex) => (
                  <StoryImage image={image} eyebrow={section.eyebrow} index={imageIndex} key={imageIndex} />
                ))}
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="credits-wrap" aria-labelledby="credits-title">
        <div className="credits-board" style={creditBackgroundStyle}>
          <header className="credits-header">
            <div>
              <p className="about-eyebrow">{ABOUT_CREDITS.eyebrow}</p>
              <h2 id="credits-title">{ABOUT_CREDITS.title}</h2>
            </div>
            <p className="credits-thank-you">{ABOUT_CREDITS.thankYou}</p>
          </header>

          <div className="credits-message">
            <CreditIcon name="supporters" />
            <p>{ABOUT_CREDITS.message}</p>
          </div>

          <div className="credits-grid">
            {CREDIT_GROUPS.map((group) => (
              <article
                className={`credit-card credit-card-${group.id}`}
                style={{ "--credit-accent": group.accent } as CSSProperties}
                key={group.id}
              >
                <header className="credit-card-header">
                  <span className="credit-icon"><CreditIcon name={group.icon} /></span>
                  <div>
                    <h3>{group.title}</h3>
                    <p>{group.subtitle}</p>
                  </div>
                </header>

                {group.members && (
                  <CreditMemberList groupTitle={group.title} members={group.members} />
                )}

                {group.acknowledgements && (
                  <div className="credit-acknowledgements">
                    {group.acknowledgements.map((acknowledgement) => (
                      <span key={acknowledgement}>{acknowledgement}</span>
                    ))}
                  </div>
                )}

                {group.closingNote && <p className="credit-closing-note">{group.closingNote}</p>}
              </article>
            ))}
          </div>

          <p className="credits-footer-line">
            <span aria-hidden="true" />
            THANK YOU FOR BEING PART OF TOWER ECLIPSE
            <span aria-hidden="true" />
          </p>
        </div>
      </section>
    </div>
  );
}
