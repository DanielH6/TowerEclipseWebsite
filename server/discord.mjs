import { config } from "./config.mjs";

const API_BASE = "https://discord.com/api/v10";
const USER_AGENT = "TowerEclipseBugReports/1.0";

export class DiscordApiError extends Error {
  constructor(message, status, code = "discord_api_error") {
    super(message);
    this.name = "DiscordApiError";
    this.status = status;
    this.code = code;
  }
}

async function discordRequest(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      Accept: "application/json",
      "User-Agent": USER_AGENT,
      ...(options.headers ?? {}),
    },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new DiscordApiError(
      `Discord API request failed (${response.status}): ${body.slice(0, 300)}`,
      response.status,
    );
  }

  return response.json();
}

export function buildAuthorizationUrl(state) {
  const url = new URL("https://discord.com/oauth2/authorize");

  url.searchParams.set("client_id", config.discord.clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", config.discord.redirectUri);
  url.searchParams.set("scope", "identify guilds.members.read");
  url.searchParams.set("state", state);

  return url.toString();
}

async function tokenRequest(parameters) {
  const response = await fetch(`${API_BASE}/oauth2/token`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": USER_AGENT,
    },
    body: new URLSearchParams(parameters),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new DiscordApiError(
      `Discord token exchange failed (${response.status}): ${body.slice(0, 300)}`,
      response.status,
      "token_exchange_failed",
    );
  }

  return response.json();
}

export function exchangeAuthorizationCode(code) {
  return tokenRequest({
    client_id: config.discord.clientId,
    client_secret: config.discord.clientSecret,
    grant_type: "authorization_code",
    code,
    redirect_uri: config.discord.redirectUri,
  });
}

export function refreshAccessToken(refreshToken) {
  return tokenRequest({
    client_id: config.discord.clientId,
    client_secret: config.discord.clientSecret,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
}

export function getCurrentUser(accessToken) {
  return discordRequest("/users/@me", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
}

export async function getCurrentGuildMember(accessToken) {
  try {
    return await discordRequest(
      `/users/@me/guilds/${config.discord.guildId}/member`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
    );
  } catch (error) {
    if (error instanceof DiscordApiError && error.status === 404) {
      throw new DiscordApiError(
        "The user is not a member of the configured Discord server.",
        404,
        "not_in_server",
      );
    }

    throw error;
  }
}

export function mapDiscordRole(roleIds) {
  const roleSet = new Set(roleIds);

  if (
    roleSet.has(config.discord.roleIds.owner) ||
    roleSet.has(config.discord.roleIds.dev)
  ) {
    return "dev";
  }

  if (roleSet.has(config.discord.roleIds.leadqa)) {
    return "leadqa";
  }

  if (roleSet.has(config.discord.roleIds.qa)) {
    return "qa";
  }

  return "member";
}

export function roleLabel(role) {
  switch (role) {
    case "member":
      return "Member";
    case "leadqa":
      return "QA Lead";
    case "qa":
      return "QA Tester";
    case "dev":
      return "Developer";
    default:
      return "Unknown";
  }
}

export function avatarUrl(user) {
  if (!user.avatar) {
    return null;
  }

  const extension = user.avatar.startsWith("a_") ? "gif" : "png";
  return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${extension}?size=128`;
}

async function ensureAccessToken(session) {
  const safetyWindowMs = 60_000;

  if (session.accessTokenExpiresAt - safetyWindowMs > Date.now()) {
    return;
  }

  const token = await refreshAccessToken(session.refreshToken);

  session.accessToken = token.access_token;
  session.refreshToken = token.refresh_token ?? session.refreshToken;
  session.accessTokenExpiresAt = Date.now() + token.expires_in * 1000;
}

export async function refreshDiscordSession(session, force = false) {
  if (
    !force &&
    session.roleCheckedAt + config.roleRecheckMs > Date.now()
  ) {
    return session;
  }

  await ensureAccessToken(session);

  const [user, member] = await Promise.all([
    getCurrentUser(session.accessToken),
    getCurrentGuildMember(session.accessToken),
  ]);

  const role = mapDiscordRole(member.roles ?? []);

  session.discordUser = user;
  session.discordMember = member;
  session.role = role;
  session.roleCheckedAt = Date.now();

  return session;
}
