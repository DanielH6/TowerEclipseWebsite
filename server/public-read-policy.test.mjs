import test from "node:test";
import assert from "node:assert/strict";
import { publicReadPolicy } from "./public-read-policy.mjs";

function policy(url, { cookie, authorization, status = 200, handlerCachePolicy } = {}) {
  const headers = new Map();
  const req = { method: "GET", originalUrl: url, headers: { cookie, authorization } };
  const res = { statusCode: status, setHeader: (key, value) => headers.set(key, value), getHeader: key => headers.get(key), vary() {}, json: value => value };
  publicReadPolicy(req, res, () => {}); if (handlerCachePolicy) res.setHeader("Cache-Control", handlerCachePolicy); res.json({ ok: true }); return headers.get("Cache-Control");
}
test("only anonymous successful allowlisted responses can be publicly cached", () => {
  for (const url of ["/api/updates", "/api/updates/one", "/api/tournaments/a", "/api/list/history?before=one"]) assert.match(policy(url), /^public/);
  for (const url of ["/api/bugs", "/api/careers/applications", "/api/account", "/api/list/thumbnail-config", "/api/admin/updates"]) assert.equal(policy(url), "no-store");
  assert.equal(policy("/api/tournaments/a", { cookie: "te_session=private" }), "no-store");
  assert.equal(policy("/api/updates/a", { authorization: "Bearer private" }), "no-store");
  assert.equal(policy("/api/updates/a", { status: 404 }), "no-store");
  assert.equal(policy("/api/updates/a", { handlerCachePolicy: "no-store" }), "no-store", "short-lived signed content must retain its route-specific policy");
  assert.equal(policy("/api/tournaments/a", { handlerCachePolicy: "private, no-store" }), "private, no-store");
  assert.equal(policy("/api/careers/applications", { handlerCachePolicy: "public, max-age=60" }), "no-store");
  assert.equal(policy("/api/updates/a", { cookie: "te_session=private", handlerCachePolicy: "public, max-age=60" }), "no-store");
});
