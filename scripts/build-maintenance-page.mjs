import {
  existsSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const desktopDirectory = resolve(projectRoot, "..");
const montserratSource = join(
  projectRoot,
  "scripts",
  "fonts",
  "Montserrat-Latin-500-700.woff2",
);
const backgroundSource = process.argv[2]
  ? resolve(process.cwd(), process.argv[2])
  : join(
      projectRoot,
      "scripts",
      "assets",
      "WebsiteDownBackground-960x540.png",
    );
const warningIconSource = process.argv[3]
  ? resolve(process.cwd(), process.argv[3])
  : join(desktopDirectory, "WebsiteDownWarningIcon.png");
const outputFile = process.argv[4]
  ? resolve(process.cwd(), process.argv[4])
  : join(projectRoot, "maintenance.html");

if (!existsSync(backgroundSource)) {
  throw new Error(`Background image not found: ${backgroundSource}`);
}

if (!existsSync(warningIconSource)) {
  throw new Error(`Warning icon not found: ${warningIconSource}`);
}

if (!existsSync(montserratSource)) {
  throw new Error(`Montserrat font not found: ${montserratSource}`);
}

const backgroundBase64 = readFileSync(backgroundSource).toString("base64");
const warningIconBase64 = readFileSync(warningIconSource).toString("base64");
const montserratBase64 = readFileSync(montserratSource).toString("base64");
const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="dark">
    <meta name="robots" content="noindex, nofollow">
    <title>Tower Eclipse - Maintenance</title>
    <style>
      :root {
        color-scheme: dark;
        font-family: "Montserrat", Arial, Helvetica, sans-serif;
        background: #090d16;
        color: #fff;
      }

      * {
        box-sizing: border-box;
      }

      html,
      body {
        width: 100%;
        min-width: 320px;
        min-height: 100%;
        margin: 0;
      }

      body {
        min-height: 100vh;
        min-height: 100svh;
        overflow: hidden;
        display: grid;
        place-items: center;
        background-color: #111a2a;
        background-position: center;
        background-size: cover;
        background-repeat: no-repeat;
      }

      main {
        position: relative;
        z-index: 1;
        width: min(84vw, 1600px);
      }

      .notice {
        width: 100%;
        min-height: 166px;
        padding: 28px 48px 28px 34px;
        display: grid;
        grid-template-columns: 130px minmax(0, 1fr);
        align-items: center;
        gap: 34px;
        border: 2px solid #ed1b2a;
        border-radius: 31px;
        background: linear-gradient(
          90deg,
          rgba(80, 22, 35, 0.72),
          rgba(56, 13, 29, 0.64)
        );
        box-shadow:
          0 22px 65px rgba(0, 0, 0, 0.28),
          inset 0 1px rgba(255, 255, 255, 0.025);
        backdrop-filter: blur(3px);
        -webkit-backdrop-filter: blur(3px);
      }

      .warning-icon {
        width: 116px;
        height: auto;
        display: block;
        justify-self: center;
        filter: drop-shadow(0 0 9px rgba(255, 45, 56, 0.18));
      }

      .notice-message {
        margin: 0;
        color: #fff;
        font-size: clamp(1.55rem, 2.45vw, 2.55rem);
        font-weight: 500;
        line-height: 1.12;
        letter-spacing: -0.018em;
        text-wrap: balance;
        text-shadow: 0 2px 12px rgba(0, 0, 0, 0.35);
      }

      .notice-message strong {
        font-weight: 700;
      }

      .site-address {
        position: fixed;
        z-index: 1;
        right: 20px;
        bottom: max(27px, env(safe-area-inset-bottom));
        left: 20px;
        margin: 0;
        color: rgba(255, 255, 255, 0.68);
        font-size: clamp(1rem, 2.3vw, 2rem);
        font-style: italic;
        font-weight: 500;
        letter-spacing: 0.01em;
        text-align: center;
        text-shadow: 0 3px 14px rgba(0, 0, 0, 0.75);
      }

      @media (max-width: 760px) {
        main {
          width: calc(100vw - 34px);
        }

        .notice {
          min-height: 142px;
          padding: 24px 25px;
          grid-template-columns: 78px minmax(0, 1fr);
          gap: 19px;
          border-radius: 24px;
        }

        .warning-icon {
          width: 75px;
        }

        .notice-message {
          font-size: clamp(1.1rem, 4.7vw, 1.65rem);
          line-height: 1.2;
        }

        .site-address {
          bottom: max(20px, env(safe-area-inset-bottom));
        }
      }

      @media (max-width: 430px) {
        .notice {
          min-height: 0;
          padding: 21px 18px;
          grid-template-columns: 58px minmax(0, 1fr);
          gap: 15px;
          border-radius: 20px;
        }

        .warning-icon {
          width: 56px;
        }

        .notice-message {
          font-size: 1rem;
          line-height: 1.28;
        }
      }

      @media (max-height: 480px) and (orientation: landscape) {
        .notice {
          min-height: 118px;
          padding-block: 18px;
        }

        .warning-icon {
          width: 70px;
        }

        .site-address {
          bottom: 12px;
          font-size: 1rem;
        }
      }

      @media (prefers-reduced-transparency: reduce) {
        .notice {
          background: #3e1322;
          backdrop-filter: none;
          -webkit-backdrop-filter: none;
        }
      }
    </style>
  </head>
  <body>
    <main>
      <section class="notice" role="status" aria-labelledby="maintenance-message">
        <img
          class="warning-icon"
          src="data:image/png;base64,${warningIconBase64}"
          alt=""
          aria-hidden="true"
        >
        <p class="notice-message" id="maintenance-message">
          The site is currently down for <strong>maintenance</strong> and will be back soon!<br>
          Thank you for your patience.
        </p>
      </section>
    </main>
    <p class="site-address">towereclipse.com</p>
    <!-- Keep large data URLs last so the page structure and layout arrive first. -->
    <style>
      @font-face {
        font-family: "Montserrat";
        src: url("data:font/woff2;base64,${montserratBase64}") format("woff2");
        font-style: normal;
        font-weight: 500 700;
        font-display: swap;
      }

      body {
        background-image: url("data:image/png;base64,${backgroundBase64}");
      }
    </style>
  </body>
</html>
`;

writeFileSync(outputFile, html, "utf8");

const outputSizeKb = (statSync(outputFile).size / 1024).toFixed(1);
process.stdout.write(`Created ${outputFile} (${outputSizeKb} KB)\n`);
