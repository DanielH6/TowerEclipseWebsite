import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRobloxLinkService } from "./roblox-account-link.mjs";

const oauth = { clientId: "1234", clientSecret: "fixture-secret", redirectUri: "https://example.test/api/account/roblox/callback" };
function fixture(options = {}) {
  const documents = new Map([["websiteAccounts/discord-1", { username: "discord_user", firstLoginAt: new Date(0), ...options.profile }], ...Object.entries(options.documents ?? {})]);
  const snapshot = path => ({ exists: documents.has(path), data: () => structuredClone(documents.get(path)) });
  const calls = [];
  let time = 1_800_000_000_000, commits = 0, saves = 0;
  const db = {
    doc: path => ({ path, get: async () => snapshot(path) }),
    runTransaction: async callback => {
      const writes = [];
      const result = await callback({
        get: async ref => { assert.equal(writes.length, 0, "Firestore requires reads before writes"); return snapshot(ref.path); },
        set: (ref, data) => writes.push(() => documents.set(ref.path, structuredClone(data))),
        update: (ref, data) => writes.push(() => documents.set(ref.path, { ...documents.get(ref.path), ...structuredClone(data) })),
        delete: ref => writes.push(() => documents.delete(ref.path)),
      });
      writes.forEach(write => write()); commits++;
      return result;
    },
  };
  const session = { id: "session-1", discordUser: { id: "discord-1" } };
  const service = createRobloxLinkService({ db, oauth: options.oauth ?? oauth, saveSession: () => saves++, now: () => time,
    isSessionActive: () => options.active !== false,
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return { ok: options.providerOk !== false, json: async () => url.endsWith("/token")
        ? { access_token: "fixture-access-token", refresh_token: "fixture-refresh-token" }
        : options.identity ?? { sub: "123456789", preferred_username: "RobloxTester", name: "Untrusted display name" } };
    },
  });
  const start = async (target = session) => {
    const { authorizationUrl } = await service.start(target);
    return { state: new URL(authorizationUrl).searchParams.get("state"), code: "fixture-code" };
  };
  return { service, session, documents, calls, start, advance: ms => { time += ms; }, commits: () => commits, saves: () => saves };
}

test("unconfigured linking is unavailable without database writes", async () => {
  const f = fixture({ oauth: {} });
  assert.equal(f.service.enabled, false);
  await assert.rejects(f.start(), { code: "not_configured", status: 503 });
  assert.equal(f.commits(), 0);
});

test("authorization uses Roblox, minimal scopes, unpredictable state, and PKCE without exposing the secret", async () => {
  const f = fixture();
  const url = new URL((await f.service.start(f.session)).authorizationUrl);
  assert.equal(url.origin + url.pathname, "https://apis.roblox.com/oauth/v1/authorize");
  assert.equal(url.searchParams.get("scope"), "openid profile");
  assert.equal(url.searchParams.get("redirect_uri"), oauth.redirectUri);
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("code_challenge"), createHash("sha256").update(f.session.robloxLink.verifier).digest("base64url"));
  assert.equal(url.href.includes(oauth.clientSecret), false);
  const first = f.session.robloxLink.state;
  await f.start();
  assert.notEqual(first, f.session.robloxLink.state);
  assert.ok(first.length >= 43);
  assert.equal(f.commits(), 0);
});

test("verified UserInfo identity is linked atomically without persisting OAuth tokens", async () => {
  const f = fixture();
  const callback = await f.start();
  const verifier = f.session.robloxLink.verifier;
  const linked = await f.service.finish(f.session, { ...callback, username: "Attacker", userId: "999" });
  assert.equal(linked.userId, "123456789");
  assert.equal(linked.username, "RobloxTester");
  assert.deepEqual(f.documents.get("websiteRobloxLinks/123456789"), { discordId: "discord-1" });
  const profile = f.documents.get("websiteAccounts/discord-1");
  assert.equal(profile.username, "discord_user");
  assert.equal(profile.firstLoginAt.getTime(), 0);
  assert.equal(profile.robloxRevision, 1);
  assert.equal(f.calls[0].init.body.get("code_verifier"), verifier);
  assert.equal(f.calls[0].init.body.get("client_secret"), oauth.clientSecret);
  assert.equal(f.calls[1].init.headers.authorization, "Bearer fixture-access-token");
  assert.equal(JSON.stringify([...f.documents]).includes("token"), false);
  assert.equal(f.session.robloxLink, undefined);
  assert.equal(f.commits(), 1);
  await assert.rejects(f.service.finish(f.session, callback), { code: "expired" });
  assert.equal(f.calls.length, 2, "replayed callbacks never reach Roblox");
});

for (const scenario of ["wrong state", "different user", "expired state", "cancelled"]) {
  test(`${scenario} cannot change a Roblox connection`, async () => {
    const f = fixture();
    const callback = await f.start();
    if (scenario === "wrong state") callback.state = "wrong";
    if (scenario === "different user") f.session.discordUser.id = "discord-2";
    if (scenario === "expired state") f.advance(10 * 60_000);
    if (scenario === "cancelled") callback.error = "access_denied";
    await assert.rejects(f.service.finish(f.session, callback), { code: scenario === "cancelled" ? "cancelled" : "expired" });
    assert.equal(f.calls.length, 0);
    assert.equal(f.commits(), 0);
  });
}

for (const identity of [{ sub: "../wrong", preferred_username: "ValidName" }, { sub: "123", preferred_username: "<script>" }, { sub: 123, preferred_username: "ValidName" }]) {
  test(`invalid provider identity ${JSON.stringify(identity)} is rejected`, async () => {
    const f = fixture({ identity });
    await assert.rejects(f.service.finish(f.session, await f.start()), { code: "invalid_profile" });
    assert.equal(f.commits(), 0);
  });
}

test("another Discord account's Roblox claim cannot be taken over", async () => {
  const f = fixture({ documents: { "websiteRobloxLinks/123456789": { discordId: "discord-2" } } });
  await assert.rejects(f.service.finish(f.session, await f.start()), { code: "already_linked" });
  assert.equal(f.commits(), 0);
  assert.equal(f.documents.get("websiteRobloxLinks/123456789").discordId, "discord-2");
});

test("replacement releases the old claim and refresh of the same account preserves its join date", async () => {
  const f = fixture({ profile: { roblox: { userId: "999", username: "OldName", linkedAt: new Date(0) } },
    documents: { "websiteRobloxLinks/999": { discordId: "discord-1" } } });
  const first = await f.service.finish(f.session, await f.start());
  assert.equal(f.documents.has("websiteRobloxLinks/999"), false);
  f.advance(1000);
  const second = await f.service.finish(f.session, await f.start());
  assert.deepEqual(second.linkedAt, first.linkedAt);
  assert.ok(second.verifiedAt > first.verifiedAt);
});

test("unlink checks the displayed account, preserves profile data, and invalidates callbacks in other sessions", async () => {
  const f = fixture();
  await f.service.finish(f.session, await f.start());
  const otherSession = { id: "session-2", discordUser: { id: "discord-1" } };
  const stale = await f.start(otherSession);
  await assert.rejects(f.service.unlink(f.session, "999"), { code: "changed" });
  assert.equal(f.documents.has("websiteRobloxLinks/123456789"), true);
  await f.service.unlink(f.session, "123456789");
  assert.equal(f.documents.has("websiteRobloxLinks/123456789"), false);
  assert.equal(f.documents.get("websiteAccounts/discord-1").roblox, null);
  assert.equal(f.documents.get("websiteAccounts/discord-1").username, "discord_user");
  await assert.rejects(f.service.finish(otherSession, stale), { code: "changed" });
  assert.equal(f.documents.get("websiteAccounts/discord-1").roblox, null);
});

test("concurrent link requests cannot silently overwrite the winning connection", async () => {
  const f = fixture();
  const other = { id: "session-2", discordUser: { id: "discord-1" } };
  const a = await f.start();
  const b = await f.start(other);
  await f.service.finish(f.session, a);
  await assert.rejects(f.service.finish(other, b), { code: "changed" });
  assert.equal(f.commits(), 1);
});

test("a logged-out session cannot finish linking after provider requests complete", async () => {
  const f = fixture({ active: false });
  await assert.rejects(f.service.finish(f.session, await f.start()), { code: "expired" });
  assert.equal(f.commits(), 0);
});

test("provider failure preserves existing account data and consumes the callback", async () => {
  const f = fixture({ providerOk: false });
  const callback = await f.start();
  await assert.rejects(f.service.finish(f.session, callback), { code: "provider_failed" });
  assert.equal(f.commits(), 0);
  await assert.rejects(f.service.finish(f.session, callback), { code: "expired" });
});
