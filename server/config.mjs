import "dotenv/config";

function required(name) {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function integer(name, fallback, minimum, maximum) {
  const raw = process.env[name]?.trim();

  if (!raw) {
    return fallback;
  }

  const value = Number.parseInt(raw, 10);

  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(
      `${name} must be an integer between ${minimum} and ${maximum}.`,
    );
  }

  return value;
}

function snowflake(name) {
  const value = required(name);

  if (!/^\d{15,22}$/.test(value)) {
    throw new Error(`${name} must be a Discord ID containing only digits.`);
  }

  return value;
}

function privateSecret(name, minimumLength = 16) {
  const value = required(name);

  if (/PASTE_|REPLACE_|YOUR_/i.test(value)) {
    throw new Error(
      `${name} still contains a placeholder. Add the real value to .env.`,
    );
  }

  if (value.length < minimumLength) {
    throw new Error(
      `${name} must contain at least ${minimumLength} characters.`,
    );
  }

  return value;
}

const nodeEnv = process.env.NODE_ENV?.trim() || "development";
const production = nodeEnv === "production";
const appOrigin = required("APP_ORIGIN").replace(/\/$/, "");
const redirectUri = required("DISCORD_REDIRECT_URI");

if (production && !appOrigin.startsWith("https://")) {
  throw new Error("APP_ORIGIN must use HTTPS in production.");
}

if (production && !redirectUri.startsWith("https://")) {
  throw new Error("DISCORD_REDIRECT_URI must use HTTPS in production.");
}

const roleIds = {
  leadqa: snowflake("DISCORD_ROLE_LEADQA_ID"),
  qa: snowflake("DISCORD_ROLE_QA_ID"),
  dev: snowflake("DISCORD_ROLE_DEV_ID"),
};

if (new Set(Object.values(roleIds)).size !== 3) {
  throw new Error("The three Discord role IDs must be different.");
}

const cookieSecret = required("COOKIE_SECRET");

if (cookieSecret.length < 32) {
  throw new Error("COOKIE_SECRET must be at least 32 characters long.");
}

export const config = Object.freeze({
  nodeEnv,
  production,
  port: integer("PORT", 3001, 1, 65535),
  appOrigin,
  discord: Object.freeze({
    clientId: snowflake("DISCORD_CLIENT_ID"),
    clientSecret: privateSecret("DISCORD_CLIENT_SECRET"),
    redirectUri,
    guildId: snowflake("DISCORD_GUILD_ID"),
    roleIds: Object.freeze(roleIds),
  }),
  cookieSecret,
  firebase: Object.freeze({
    projectId: required("FIREBASE_PROJECT_ID"),
  }),
  sessionTtlMs:
    integer("SESSION_TTL_HOURS", 8, 1, 24) * 60 * 60 * 1000,
  roleRecheckMs:
    integer("ROLE_RECHECK_SECONDS", 300, 30, 3600) * 1000,
});
