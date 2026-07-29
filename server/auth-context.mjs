import crypto from "node:crypto";
import { avatarUrl, refreshDiscordSession, roleLabel } from "./discord.mjs";
import { getSession } from "./session-store.mjs";
import { SESSION_COOKIE, readSignedCookie } from "./security.mjs";

export function sessionIdFromRequest(request) {
  return readSignedCookie(request, SESSION_COOKIE);
}

export function sessionFromRequest(request) {
  const sessionId = sessionIdFromRequest(request);
  return sessionId ? getSession(sessionId) : null;
}

export function publicUser(session) {
  const user = session.discordUser;
  const member = session.discordMember;
  const displayName = member.nick || user.global_name || user.username;

  return {
    id: user.id,
    username: user.username,
    displayName,
    guildNickname: member.nick ?? null,
    avatarUrl: avatarUrl(user),
    role: session.role,
    roleLabel: roleLabel(session.role),
  };
}

export function actorSnapshot(session) {
  const user = publicUser(session);

  return {
    discordId: user.id,
    username: user.username,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    role: user.role,
  };
}

export async function requireAuth(request, response, next) {
  const session = sessionFromRequest(request);

  if (!session) {
    response.status(401).json({ error: "Authentication required." });
    return;
  }

  try {
    await refreshDiscordSession(session);
    request.authSession = session;
    request.authUser = publicUser(session);
    next();
  } catch (error) {
    console.error("Authenticated request role refresh failed:", error);
    response.status(401).json({ error: "Your Discord session is no longer valid." });
  }
}

export function requireRole(...allowedRoles) {
  const allowed = new Set(allowedRoles);

  return (request, response, next) => {
    if (!request.authSession) {
      response.status(401).json({ error: "Authentication required." });
      return;
    }

    if (!allowed.has(request.authSession.role)) {
      response.status(403).json({ error: "You do not have permission to perform this action." });
      return;
    }

    next();
  };
}

export function requireExactRole(role) {
  return requireRole(role);
}

export function requireCsrf(request, response, next) {
  const session = request.authSession;
  const token = request.get("X-CSRF-Token");

  if (!session || !token) {
    response.status(403).json({ error: "Invalid CSRF token." });
    return;
  }

  const expected = Buffer.from(session.csrfToken);
  const received = Buffer.from(token);

  if (
    received.length !== expected.length ||
    !crypto.timingSafeEqual(received, expected)
  ) {
    response.status(403).json({ error: "Invalid CSRF token." });
    return;
  }

  next();
}
