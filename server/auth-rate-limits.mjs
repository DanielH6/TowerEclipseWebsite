import rateLimit from "express-rate-limit";

const WINDOW_MS = 15 * 60_000;

function integer(environment, name, fallback, minimum, maximum) {
  const raw = environment[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}.`);
  }
  return value;
}

export function readAuthTrafficConfiguration(environment = process.env) {
  return Object.freeze({
    loginPer15Minutes: integer(environment, "AUTH_LOGIN_REQUESTS_PER_15_MINUTES", 300, 1, 100_000),
    callbackPer15Minutes: integer(environment, "AUTH_CALLBACK_REQUESTS_PER_15_MINUTES", 600, 1, 100_000),
    // Keep the existing production default until the host confirms its actual
    // forwarding chain. Never blindly trust a visitor-supplied Cloudflare header.
    trustProxyHops: integer(environment, "TRUST_PROXY_HOPS", environment.NODE_ENV?.trim() === "production" ? 1 : 0, 0, 10),
  });
}

export function createAuthRateLimiters(configuration) {
  const common = { windowMs: WINDOW_MS, standardHeaders: "draft-8", legacyHeaders: false };
  return {
    authStartLimiter: rateLimit({ ...common, limit: configuration.loginPer15Minutes,
      message: "Too many Discord sign-in attempts from this network. Please wait up to 15 minutes, then try again." }),
    callbackLimiter: rateLimit({ ...common, limit: configuration.callbackPer15Minutes,
      message: "Too many Discord sign-in callbacks from this network. Please wait up to 15 minutes, then start sign-in again." }),
  };
}

export function authTrafficDiagnostics(configuration) {
  return (request, response) => response.set("Cache-Control", "no-store").json({
    ...configuration,
    windowSeconds: WINDOW_MS / 1000,
    resolvedClientIp: request.ip ?? null,
    socketPeerIp: request.socket.remoteAddress ?? null,
    // Diagnostic claims only: these headers are not used as rate-limit keys.
    forwardedFor: request.get("X-Forwarded-For") ?? null,
    cloudflareConnectingIp: request.get("CF-Connecting-IP") ?? null,
  });
}
