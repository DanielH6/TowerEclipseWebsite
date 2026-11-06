import rateLimit from "express-rate-limit";

const publicPath = /^\/api\/(?:updates(?:\/[^/]+)?|tournaments(?:\/[^/]+)?|list(?:\/history)?)\/?$/;
export function publicReadPolicy(req, res, next) {
  // Private APIs are always no-store. Only audience-independent successful JSON
  // from an explicit allowlist may override it; authenticated previews never do.
  res.setHeader("Cache-Control", "no-store");
  const setHeader = res.setHeader;
  let handlerPolicy = false;
  res.setHeader = function (name, value) {
    if (String(name).toLowerCase() === "cache-control") handlerPolicy = true;
    return setHeader.call(this, name, value);
  };
  const original = res.json;
  res.json = function (body) {
    const eligible = req.method === "GET" && publicPath.test(req.originalUrl.split("?")[0]) && res.statusCode === 200 && !req.headers.cookie && !req.headers.authorization && !req.authUser && !res.getHeader("Set-Cookie");
    if (!eligible && !/\bno-store\b/.test(String(res.getHeader("Cache-Control")))) res.setHeader("Cache-Control", "no-store");
    if (eligible && !handlerPolicy) {
      res.vary("Cookie"); res.vary("Authorization");
      res.setHeader("Cache-Control", "public, max-age=30, s-maxage=60");
    }
    return original.call(this, body);
  };
  next();
}
export function createPublicReadLimiter() {
  return rateLimit({ windowMs: 60_000, limit: 180, standardHeaders: "draft-8", legacyHeaders: false,
    skip: req => req.method !== "GET" || !publicPath.test(req.originalUrl.split("?")[0]),
    message: { error: "Too many public content requests. Please try again shortly." } });
}
