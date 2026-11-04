import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { requireRole } from "./auth-context.mjs";
import { authTrafficDiagnostics, createAuthRateLimiters, readAuthTrafficConfiguration } from "./auth-rate-limits.mjs";

async function fixture(t, configuration = readAuthTrafficConfiguration({ NODE_ENV: "production", TRUST_PROXY_HOPS: "2" })) {
  const app = express();
  app.set("trust proxy", configuration.trustProxyHops);
  const { authStartLimiter, callbackLimiter } = createAuthRateLimiters(configuration);
  const success = (request, response) => response.json({ ip: request.ip });
  app.get("/api/auth/discord", authStartLimiter, success);
  app.get("/api/auth/discord/callback", callbackLimiter, success);
  const requireAuth = (request, response, next) => {
    const role = request.get("X-Test-Role");
    if (!role) return response.status(401).end();
    request.authSession = { role };
    next();
  };
  app.get("/api/admin/auth-traffic", requireAuth, requireRole("dev"), authTrafficDiagnostics(configuration));
  const server = await new Promise((resolve, reject) => {
    const instance = app.listen(0, "127.0.0.1", error => error ? reject(error) : resolve(instance));
  });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  return (path = "/api/auth/discord", headers = {}) => fetch(base + path, { headers });
}
const chain = ip => ({ "X-Forwarded-For": `${ip}, 203.0.113.20` });

test("login traffic defaults are 300/600 per 15 minutes and proxy trust must be explicit and bounded", () => {
  assert.deepEqual(readAuthTrafficConfiguration({}), { loginPer15Minutes: 300, callbackPer15Minutes: 600, trustProxyHops: 0 });
  assert.equal(readAuthTrafficConfiguration({ NODE_ENV: "production" }).trustProxyHops, 1);
  assert.deepEqual(readAuthTrafficConfiguration({ AUTH_LOGIN_REQUESTS_PER_15_MINUTES: "1200", AUTH_CALLBACK_REQUESTS_PER_15_MINUTES: "2400", TRUST_PROXY_HOPS: "3" }),
    { loginPer15Minutes: 1200, callbackPer15Minutes: 2400, trustProxyHops: 3 });
  for (const name of ["AUTH_LOGIN_REQUESTS_PER_15_MINUTES", "AUTH_CALLBACK_REQUESTS_PER_15_MINUTES"]) {
    for (const value of ["0", "-1", "30garbage", "2.5", "1e3", "100001"]) assert.throws(() => readAuthTrafficConfiguration({ [name]: value }), new RegExp(name));
  }
  for (const value of ["true", "-1", "2junk", "1.5", "11"]) assert.throws(() => readAuthTrafficConfiguration({ TRUST_PROXY_HOPS: value }), /TRUST_PROXY_HOPS/);
});

test("a recruitment burst through the same ingress keeps separate visitor buckets and advertises the increased limits", async t => {
  const request = await fixture(t);
  for (let start = 1; start <= 80; start += 10) {
    const responses = await Promise.all(Array.from({ length: 10 }, async (_, offset) => {
      const ip = `198.51.100.${start + offset}`, headers = chain(ip);
      const starts = [await request(undefined, headers), await request(undefined, headers)];
      const callbacks = [await request("/api/auth/discord/callback", headers), await request("/api/auth/discord/callback", headers)];
      for (const response of starts) assert.match(response.headers.get("RateLimit-Policy"), /q=300; w=900/);
      for (const response of callbacks) assert.match(response.headers.get("RateLimit-Policy"), /q=600; w=900/);
      for (const response of [...starts, ...callbacks]) {
        assert.equal(response.status, 200);
        assert.equal((await response.json()).ip, ip);
      }
      return starts.length + callbacks.length;
    }));
    assert.equal(responses.reduce((a, b) => a + b), 40);
  }
});

test("a visitor still receives 429 with retry timing while callbacks and other visitors retain their allowances", async t => {
  const request = await fixture(t, { loginPer15Minutes: 2, callbackPer15Minutes: 3, trustProxyHops: 2 });
  const headers = chain("198.51.100.40");
  assert.equal((await request(undefined, headers)).status, 200);
  assert.equal((await request(undefined, headers)).status, 200);
  const blocked = await request(undefined, headers);
  assert.equal(blocked.status, 429);
  assert.match(await blocked.text(), /Too many Discord sign-in attempts from this network/);
  assert.ok(Number(blocked.headers.get("Retry-After")) > 0 && Number(blocked.headers.get("Retry-After")) <= 900);
  assert.match(blocked.headers.get("RateLimit"), /r=0/);
  assert.equal((await request(undefined, chain("198.51.100.41"))).status, 200);
  for (let i = 0; i < 3; i++) assert.equal((await request("/api/auth/discord/callback", headers)).status, 200);
  const callbackBlocked = await request("/api/auth/discord/callback", headers);
  assert.equal(callbackBlocked.status, 429);
  assert.match(await callbackBlocked.text(), /Too many Discord sign-in callbacks/);
});

test("unverified Cloudflare claims and extra leftmost forwarded IPs cannot reset the client's bucket", async t => {
  const direct = await fixture(t, { loginPer15Minutes: 2, callbackPer15Minutes: 3, trustProxyHops: 0 });
  for (let i = 1; i <= 3; i++) {
    const response = await direct(undefined, { "CF-Connecting-IP": `198.51.100.${i}` });
    assert.equal(response.status, i <= 2 ? 200 : 429);
  }
  const proxied = await fixture(t, { loginPer15Minutes: 2, callbackPer15Minutes: 3, trustProxyHops: 2 });
  for (let i = 1; i <= 3; i++) {
    const response = await proxied(undefined, { "X-Forwarded-For": `192.0.2.${i}, 198.51.100.50, 203.0.113.20`, "CF-Connecting-IP": `192.0.2.${i}` });
    assert.equal(response.status, i <= 2 ? 200 : 429);
    if (response.ok) assert.equal((await response.json()).ip, "198.51.100.50");
  }
});

test("IPv6 addresses retain the limiter's /56 subnet grouping", async t => {
  const request = await fixture(t, { loginPer15Minutes: 2, callbackPer15Minutes: 3, trustProxyHops: 2 });
  for (const [ip, status] of [["2001:db8:abcd:1200::1", 200], ["2001:db8:abcd:12ff::2", 200], ["2001:db8:abcd:1234::3", 429], ["2001:db8:abcd:1300::1", 200]]) {
    assert.equal((await request(undefined, chain(ip))).status, status);
  }
});

test("network diagnostics are developer-only, uncached, and contain no session or authorization secrets", async t => {
  const request = await fixture(t), path = "/api/admin/auth-traffic";
  assert.equal((await request(path)).status, 401);
  for (const role of ["member", "qa", "pentester", "leadqa"]) assert.equal((await request(path, { "X-Test-Role": role })).status, 403);
  const response = await request(path, { ...chain("198.51.100.60"), "CF-Connecting-IP": "198.51.100.60", "X-Test-Role": "dev", Cookie: "secret-cookie", Authorization: "secret-authorization" });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  const diagnostic = await response.json();
  assert.equal(diagnostic.resolvedClientIp, "198.51.100.60");
  assert.equal(diagnostic.trustProxyHops, 2);
  assert.equal(diagnostic.cloudflareConnectingIp, "198.51.100.60");
  assert.equal(diagnostic.windowSeconds, 900);
  assert.ok(!JSON.stringify(diagnostic).includes("secret-"));
});
