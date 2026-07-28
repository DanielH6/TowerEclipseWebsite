import crypto from "node:crypto";
import { config } from "./config.mjs";

const sessions = new Map();
const oauthTransactions = new Map();

const MAX_SESSIONS = 5000;
const MAX_OAUTH_TRANSACTIONS = 500;

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
  return session;
}

export function getSession(id) {
  const session = sessions.get(id);

  if (!session) {
    return null;
  }

  if (session.expiresAt <= Date.now()) {
    sessions.delete(id);
    return null;
  }

  session.lastSeenAt = Date.now();
  return session;
}

export function deleteSession(id) {
  sessions.delete(id);
}

function cleanup() {
  const now = Date.now();

  for (const [id, session] of sessions.entries()) {
    if (session.expiresAt <= now) {
      sessions.delete(id);
    }
  }

  for (const [state, transaction] of oauthTransactions.entries()) {
    if (transaction.expiresAt <= now) {
      oauthTransactions.delete(state);
    }
  }
}

const cleanupTimer = setInterval(cleanup, 60_000);
cleanupTimer.unref();
