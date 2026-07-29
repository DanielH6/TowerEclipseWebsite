import crypto from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { config } from "./config.mjs";

const sessions = new Map();
const oauthTransactions = new Map();

const MAX_SESSIONS = 5000;
const MAX_OAUTH_TRANSACTIONS = 500;
const SESSION_FILE_VERSION = 1;
const sessionDirectory = path.resolve(process.cwd(), ".runtime");
const sessionFile = path.join(sessionDirectory, "sessions.enc.json");
const sessionKey = crypto.scryptSync(
  config.cookieSecret,
  "tower-eclipse-session-store-v1",
  32,
);

function randomId(bytes = 32) {
  return crypto.randomBytes(bytes).toString("base64url");
}

function evictOldest(map, maximum) {
  if (map.size < maximum) {
    return;
  }

  let oldestKey = null;
  let oldestTime = Number.POSITIVE_INFINITY;

  for (const [key, value] of map.entries()) {
    if (value.createdAt < oldestTime) {
      oldestKey = key;
      oldestTime = value.createdAt;
    }
  }

  if (oldestKey) {
    map.delete(oldestKey);
  }
}

function encryptSessions() {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", sessionKey, iv);
  const plaintext = JSON.stringify([...sessions.entries()]);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);

  return JSON.stringify({
    version: SESSION_FILE_VERSION,
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  });
}

function persistSessions() {
  mkdirSync(sessionDirectory, { recursive: true });
  const temporaryFile = `${sessionFile}.${process.pid}.tmp`;

  try {
    writeFileSync(temporaryFile, encryptSessions(), {
      encoding: "utf8",
      mode: 0o600,
    });
    renameSync(temporaryFile, sessionFile);
  } catch (error) {
    rmSync(temporaryFile, { force: true });
    console.error("Could not persist encrypted sessions:", error);
  }
}

function restoreSessions() {
  let saved;

  try {
    saved = JSON.parse(readFileSync(sessionFile, "utf8"));
  } catch (error) {
    if (error?.code !== "ENOENT") {
      console.warn("Encrypted session store could not be read; starting empty.");
    }
    return;
  }

  try {
    if (saved.version !== SESSION_FILE_VERSION) {
      throw new Error("Unsupported session-store version.");
    }

    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      sessionKey,
      Buffer.from(saved.iv, "base64"),
    );
    decipher.setAuthTag(Buffer.from(saved.tag, "base64"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(saved.ciphertext, "base64")),
      decipher.final(),
    ]).toString("utf8");

    const now = Date.now();
    for (const [id, session] of JSON.parse(plaintext)) {
      if (
        typeof id === "string" &&
        session &&
        typeof session === "object" &&
        Number(session.expiresAt) > now
      ) {
        sessions.set(id, session);
      }
    }

    if (sessions.size > 0) {
      console.log(`Restored ${sessions.size} encrypted session(s).`);
    }
  } catch {
    console.warn(
      "Encrypted session store could not be decrypted. This normally means COOKIE_SECRET changed; starting empty.",
    );
  }
}

restoreSessions();

export function createOauthTransaction(browserNonce) {
  evictOldest(oauthTransactions, MAX_OAUTH_TRANSACTIONS);

  const state = randomId();
  const transaction = {
    browserNonce,
    createdAt: Date.now(),
    expiresAt: Date.now() + 10 * 60 * 1000,
  };

  oauthTransactions.set(state, transaction);
  return state;
}

export function consumeOauthTransaction(state, browserNonce) {
  const transaction = oauthTransactions.get(state);
  oauthTransactions.delete(state);

  if (
    !transaction ||
    transaction.expiresAt <= Date.now() ||
    transaction.browserNonce !== browserNonce
  ) {
    return false;
  }

  return true;
}

export function createSession(data) {
  evictOldest(sessions, MAX_SESSIONS);

  const now = Date.now();
  const session = {
    id: randomId(),
    csrfToken: randomId(24),
    createdAt: now,
    lastSeenAt: now,
    expiresAt: now + config.sessionTtlMs,
    ...data,
  };

  sessions.set(session.id, session);
  persistSessions();
  return session;
}

export function getSession(id) {
  const session = sessions.get(id);

  if (!session) {
    return null;
  }

  if (session.expiresAt <= Date.now()) {
    sessions.delete(id);
    persistSessions();
    return null;
  }

  session.lastSeenAt = Date.now();
  return session;
}

export function saveSession(session) {
  if (!session?.id || sessions.get(session.id) !== session) {
    return;
  }

  persistSessions();
}

export function deleteSession(id) {
  if (sessions.delete(id)) {
    persistSessions();
  }
}

function cleanup() {
  const now = Date.now();
  let changed = false;

  for (const [id, session] of sessions.entries()) {
    if (session.expiresAt <= now) {
      sessions.delete(id);
      changed = true;
    }
  }

  for (const [state, transaction] of oauthTransactions.entries()) {
    if (transaction.expiresAt <= now) {
      oauthTransactions.delete(state);
    }
  }

  if (changed) {
    persistSessions();
  }
}

const cleanupTimer = setInterval(cleanup, 60_000);
cleanupTimer.unref();
