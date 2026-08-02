import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { config } from "./config.mjs";
import {
  DiscordApiError,
  avatarUrl,
  buildAuthorizationUrl,
  exchangeAuthorizationCode,
  getCurrentGuildMember,
  getCurrentUser,
  mapDiscordRole,
  refreshDiscordSession,
  roleLabel,
} from "./discord.mjs";
import {
  createOauthTransaction,
  consumeOauthTransaction,
  createSession,
  deleteSession,
  getSession,
  saveSession,
} from "./session-store.mjs";
import { createBugRouter } from "./bug-routes.mjs";
import {
  createAdminDictionaryRouter,
  createDictionaryRouter,
  ensureDefaultDictionaries,
} from "./dictionaries.mjs";
import {
  OAUTH_COOKIE,
  SESSION_COOKIE,
  clearCookie,
  readSignedCookie,
  requireSameOrigin,
  setSignedCookie,
} from "./security.mjs";
import { createRobloxStatsService } from "./roblox-stats.mjs";

const app = express();
const robloxStats = createRobloxStatsService(config.roblox);

let firestoreState = "initializing";
let firestoreInitializationError = null;

const firestoreReadyPromise = ensureDefaultDictionaries()
  .then(({ created }) => {
    firestoreState = "ready";
    console.log(
      created > 0
        ? `Firestore dictionaries are ready (${created} defaults created).`
        : "Firestore dictionaries are ready.",
    );
    return true;
  })
  .catch((error) => {
    firestoreState = "failed";
    firestoreInitializationError = error;
    console.error("Firestore initialization failed:", error);
    return false;
  });

async function requireFirestoreReady(_request, response, next) {
  const ready = await firestoreReadyPromise;

  if (!ready) {
    response.status(503).json({
      error: "Database initialization failed. Check the API terminal for details.",
    });
    return;
  }

  next();
}

if (config.production) {
  app.set("trust proxy", 1);
}

app.disable("x-powered-by");

app.use(
  helmet({
    crossOriginEmbedderPolicy: false,
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'none'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        formAction: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        connectSrc: [
          "'self'",
          ...(config.r2 ? [config.r2.endpointOrigin] : []),
        ],
        imgSrc: [
          "'self'",
          "data:",
          "https://cdn.discordapp.com",
          "https://media.discordapp.net",
          ...(config.r2 ? [config.r2.endpointOrigin] : []),
        ],
        mediaSrc: [
          "'self'",
          ...(config.r2 ? [config.r2.endpointOrigin] : []),
        ],
        fontSrc: ["'self'", "data:"],
      },
    },
  }),
);

app.use(express.json({ limit: "32kb" }));

app.use("/api", (_request, response, next) => {
  response.setHeader("Cache-Control", "no-store");
  next();
});

const authStartLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: "draft-8",
  legacyHeaders: false,
});

const callbackLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: "draft-8",
  legacyHeaders: false,
});

function sessionFromRequest(request) {
  const sessionId = readSignedCookie(request, SESSION_COOKIE);

  if (!sessionId) {
    return null;
  }

  return getSession(sessionId);
}

function clearAuthentication(response, sessionId = null) {
  if (sessionId) {
    deleteSession(sessionId);
  }

  clearCookie(response, SESSION_COOKIE);
}

function publicUser(session) {
  const user = session.discordUser;
  const member = session.discordMember;

  return {
    id: user.id,
    username: user.username,
    displayName: user.global_name || member.nick || user.username,
    guildNickname: member.nick ?? null,
    avatarUrl: avatarUrl(user),
    role: session.role,
    roleLabel: roleLabel(session.role),
  };
}

function authResponse(session) {
  return {
    authenticated: true,
    csrfToken: session.csrfToken,
    user: publicUser(session),
  };
}

function redirectWithError(response, code) {
  const url = new URL("/login", config.appOrigin);
  url.searchParams.set("authError", code);
  response.redirect(303, url.toString());
}

function verifyCsrf(request, response, session) {
  const token = request.get("X-CSRF-Token");

  if (
    !token ||
    token.length !== session.csrfToken.length ||
    !crypto.timingSafeEqual(
      Buffer.from(token),
      Buffer.from(session.csrfToken),
    )
  ) {
    response.status(403).json({ error: "Invalid CSRF token." });
    return false;
  }

  return true;
}

app.get("/api/health", (_request, response) => {
  const failed = firestoreState === "failed";

  response.status(failed ? 503 : 200).json({
    ok: !failed,
    firestore: firestoreState,
    r2: config.r2 ? "configured" : "disabled",
    ...(failed && config.production === false
      ? { firestoreError: firestoreInitializationError?.message ?? "Unknown error" }
      : {}),
  });
});

app.get("/api/roblox/stats", async (_request, response) => {
  try {
    response.json({ stats: await robloxStats.getStats() });
  } catch (error) {
    console.error("Roblox statistics refresh failed:", error);
    response.status(503).json({
      error: "Roblox game statistics are temporarily unavailable.",
    });
  }
});

app.get(
  "/api/auth/discord",
  authStartLimiter,
  (_request, response) => {
    const browserNonce = crypto.randomBytes(24).toString("base64url");
    const state = createOauthTransaction(browserNonce);

    setSignedCookie(response, OAUTH_COOKIE, browserNonce, 10 * 60);
    response.redirect(302, buildAuthorizationUrl(state));
  },
);

app.get(
  "/api/auth/discord/callback",
  callbackLimiter,
  async (request, response) => {
    const error = typeof request.query.error === "string"
      ? request.query.error
      : null;

    if (error) {
      clearCookie(response, OAUTH_COOKIE);
      redirectWithError(response, "oauth_cancelled");
      return;
    }

    const code = typeof request.query.code === "string"
      ? request.query.code
      : null;

    const state = typeof request.query.state === "string"
      ? request.query.state
      : null;

    const browserNonce = readSignedCookie(request, OAUTH_COOKIE);
    clearCookie(response, OAUTH_COOKIE);

    if (
      !code ||
      !state ||
      !browserNonce ||
      !consumeOauthTransaction(state, browserNonce)
    ) {
      redirectWithError(response, "oauth_failed");
      return;
    }

    try {
      const token = await exchangeAuthorizationCode(code);

      const [discordUser, discordMember] = await Promise.all([
        getCurrentUser(token.access_token),
        getCurrentGuildMember(token.access_token),
      ]);

      const role = mapDiscordRole(discordMember.roles ?? []);

      const session = createSession({
        discordUser,
        discordMember,
        role,
        accessToken: token.access_token,
        refreshToken: token.refresh_token,
        accessTokenExpiresAt: Date.now() + token.expires_in * 1000,
        roleCheckedAt: Date.now(),
      });

      setSignedCookie(
        response,
        SESSION_COOKIE,
        session.id,
        Math.floor(config.sessionTtlMs / 1000),
      );

      const successUrl = new URL("/login", config.appOrigin);
      successUrl.searchParams.set("auth", "success");
      response.redirect(303, successUrl.toString());
    } catch (authError) {
      console.error("Discord OAuth callback failed:", authError);

      if (
        authError instanceof DiscordApiError &&
        authError.code === "not_in_server"
      ) {
        redirectWithError(response, "not_in_server");
        return;
      }

      redirectWithError(response, "oauth_failed");
    }
  },
);

app.get("/api/auth/me", async (request, response) => {
  const sessionId = readSignedCookie(request, SESSION_COOKIE);

  if (!sessionId) {
    response.json({ authenticated: false });
    return;
  }

  const session = getSession(sessionId);

  if (!session) {
    clearAuthentication(response);
    response.json({ authenticated: false });
    return;
  }

  try {
    await refreshDiscordSession(session);
    saveSession(session);
    response.json(authResponse(session));
  } catch (error) {
    console.error("Discord session refresh failed:", error);
    clearAuthentication(response, sessionId);
    response.json({ authenticated: false });
  }
});

app.post(
  "/api/auth/recheck",
  requireSameOrigin,
  async (request, response) => {
    const sessionId = readSignedCookie(request, SESSION_COOKIE);
    const session = sessionId ? getSession(sessionId) : null;

    if (!session || !sessionId) {
      clearAuthentication(response);
      response.status(401).json({ error: "Authentication required." });
      return;
    }

    if (!verifyCsrf(request, response, session)) {
      return;
    }

    try {
      await refreshDiscordSession(session, true);
      saveSession(session);
      response.json(authResponse(session));
    } catch (error) {
      console.error("Discord role re-check failed:", error);
      clearAuthentication(response, sessionId);
      response.status(403).json({
        error: "Your Discord membership or role no longer grants access.",
      });
    }
  },
);

app.post(
  "/api/auth/logout",
  requireSameOrigin,
  (request, response) => {
    const sessionId = readSignedCookie(request, SESSION_COOKIE);
    const session = sessionId ? getSession(sessionId) : null;

    if (!session || !sessionId) {
      clearAuthentication(response);
      response.sendStatus(204);
      return;
    }

    if (!verifyCsrf(request, response, session)) {
      return;
    }

    clearAuthentication(response, sessionId);
    response.sendStatus(204);
  },
);


app.use("/api/dictionaries", requireFirestoreReady, createDictionaryRouter());
app.use("/api/admin/dictionaries", requireFirestoreReady, createAdminDictionaryRouter());
app.use("/api/bugs", requireFirestoreReady, createBugRouter());

if (config.production) {
  const currentFile = fileURLToPath(import.meta.url);
  const serverDirectory = path.dirname(currentFile);
  const distDirectory = path.resolve(serverDirectory, "../dist");

  app.use(
    express.static(distDirectory, {
      index: false,
      immutable: true,
      maxAge: "1h",
    }),
  );

  app.use((request, response, next) => {
    if (request.path.startsWith("/api/")) {
      next();
      return;
    }

    response.sendFile(path.join(distDirectory, "index.html"));
  });
}

app.use((error, _request, response, _next) => {
  const status = Number.isInteger(error?.status) ? error.status : 500;
  if (status >= 500) {
    console.error("Unhandled server error:", error);
  }
  response.status(status).json({
    error: status >= 500 ? "Internal server error." : error.message,
  });
});

app.listen(config.port, "0.0.0.0", () => {
  console.log(`Discord authentication API listening on port ${config.port}.`);
  console.log(`Frontend origin: ${config.appOrigin}`);
  console.log(`R2 attachments: ${config.r2 ? `enabled (${config.r2.bucket})` : "disabled"}`);
  console.log(`Register this exact Discord OAuth redirect: ${config.discord.redirectUri}`);
});
