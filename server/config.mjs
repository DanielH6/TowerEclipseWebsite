import "dotenv/config";

function optional(name) {
  const value = process.env[name]?.trim();
  return value || null;
}

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

function optionalPrivateSecret(name, minimumLength = 16) {
  const value = process.env[name]?.trim();

  if (!value) {
    return null;
  }

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

function numericId(name, fallback = null) {
  const value = process.env[name]?.trim() || fallback;

  if (!value || !/^\d+$/.test(value)) {
    throw new Error(`${name} must be a numeric Roblox ID.`);
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

const r2Values = {
  accountId: optional("R2_ACCOUNT_ID"),
  accessKeyId: optional("R2_ACCESS_KEY_ID"),
  secretAccessKey: optional("R2_SECRET_ACCESS_KEY"),
  bucket: optional("R2_BUCKET_NAME"),
};

const configuredR2Values = Object.values(r2Values).filter(Boolean).length;

if (configuredR2Values > 0 && configuredR2Values < Object.keys(r2Values).length) {
  throw new Error(
    "R2 configuration is incomplete. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, " +
      "R2_SECRET_ACCESS_KEY, and R2_BUCKET_NAME together.",
  );
}

let r2 = null;

if (configuredR2Values === Object.keys(r2Values).length) {
  if (!/^[a-zA-Z0-9]{16,64}$/.test(r2Values.accountId)) {
    throw new Error("R2_ACCOUNT_ID has an invalid format.");
  }

  if (!/^[a-zA-Z0-9._-]{3,63}$/.test(r2Values.bucket)) {
    throw new Error("R2_BUCKET_NAME has an invalid format.");
  }

  if (r2Values.accessKeyId.length < 16) {
    throw new Error("R2_ACCESS_KEY_ID appears to be invalid.");
  }

  if (r2Values.secretAccessKey.length < 32) {
    throw new Error("R2_SECRET_ACCESS_KEY appears to be invalid.");
  }

  const endpointOrigin = `https://${r2Values.accountId}.r2.cloudflarestorage.com`;

  r2 = Object.freeze({
    ...r2Values,
    endpointOrigin,
    uploadUrlTtlSeconds: integer("R2_UPLOAD_URL_TTL_SECONDS", 600, 60, 3600),
    downloadUrlTtlSeconds: integer("R2_DOWNLOAD_URL_TTL_SECONDS", 900, 60, 86400),
    maxFileSizeBytes:
      integer("R2_MAX_FILE_SIZE_MB", 25, 1, 100) * 1024 * 1024,
    maxFilesPerReport: integer("R2_MAX_FILES_PER_REPORT", 10, 1, 30),
  });
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
  roblox: Object.freeze({
    universeId: numericId("ROBLOX_UNIVERSE_ID", "6466960954"),
    openCloudApiKey: optionalPrivateSecret("ROBLOX_OPEN_CLOUD_API_KEY"),
  }),
  r2,
  sessionTtlMs:
    integer("SESSION_TTL_HOURS", 8, 1, 24) * 60 * 60 * 1000,
  roleRecheckMs:
    integer("ROLE_RECHECK_SECONDS", 300, 30, 3600) * 1000,
});
