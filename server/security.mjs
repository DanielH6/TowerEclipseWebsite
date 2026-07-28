import crypto from "node:crypto";
import { parse, serialize } from "cookie";
import { config } from "./config.mjs";

export const SESSION_COOKIE = config.production
  ? "__Host-te_session"
  : "te_session";

export const OAUTH_COOKIE = config.production
  ? "__Host-te_oauth"
  : "te_oauth";

function signature(value) {
  return crypto
    .createHmac("sha256", config.cookieSecret)
    .update(value)
    .digest("base64url");
}

export function signCookieValue(value) {
  return `${value}.${signature(value)}`;
}

export function verifyCookieValue(signedValue) {
  if (!signedValue) {
    return null;
  }

  const separator = signedValue.lastIndexOf(".");

  if (separator <= 0) {
    return null;
  }

  const value = signedValue.slice(0, separator);
  const receivedSignature = signedValue.slice(separator + 1);
  const expectedSignature = signature(value);

  const received = Buffer.from(receivedSignature);
  const expected = Buffer.from(expectedSignature);

  if (
    received.length !== expected.length ||
    !crypto.timingSafeEqual(received, expected)
  ) {
    return null;
  }

  return value;
}

export function readSignedCookie(request, name) {
  const cookies = parse(request.headers.cookie ?? "");
  return verifyCookieValue(cookies[name]);
}

function commonCookieOptions(maxAgeSeconds) {
  return {
    httpOnly: true,
    secure: config.production,
    sameSite: "lax",
    path: "/",
    maxAge: maxAgeSeconds,
  };
}

export function setSignedCookie(response, name, value, maxAgeSeconds) {
  response.append(
    "Set-Cookie",
    serialize(
      name,
      signCookieValue(value),
      commonCookieOptions(maxAgeSeconds),
    ),
  );
}

export function clearCookie(response, name) {
  response.append(
    "Set-Cookie",
    serialize(name, "", {
      ...commonCookieOptions(0),
      expires: new Date(0),
    }),
  );
}

export function requireSameOrigin(request, response, next) {
  const origin = request.get("origin");

  if (origin && origin !== config.appOrigin) {
    response.status(403).json({ error: "Invalid request origin." });
    return;
  }

  next();
}
