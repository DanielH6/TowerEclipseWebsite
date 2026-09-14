import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const OAUTH_BASE = "https://apis.roblox.com/oauth/v1";
const linkError = (code, message, status = 400) => Object.assign(new Error(message), { code, status });

export function parseRobloxIdentity(body) {
  if (typeof body?.sub !== "string" || !/^[1-9]\d{0,19}$/.test(body.sub)
    || typeof body.preferred_username !== "string" || !/^[A-Za-z0-9_]{3,20}$/.test(body.preferred_username)) {
    throw linkError("invalid_profile", "Roblox did not return a valid username and user ID.", 502);
  }
  return { userId: body.sub, username: body.preferred_username };
}

export function createRobloxLinkService({ db, oauth, saveSession, isSessionActive = () => true, fetchImpl = fetch, now = () => Date.now() }) {
  const enabled = Boolean(oauth?.clientId && oauth?.clientSecret && oauth?.redirectUri);
  function assertConfigured() {
    if (!enabled) throw linkError("not_configured", "Roblox linking is not available yet. Please try again later.", 503);
  }
  function consume(session, state) {
    const pending = session.robloxLink;
    const validState = typeof state === "string" && typeof pending?.state === "string"
      && Buffer.byteLength(state) === Buffer.byteLength(pending.state)
      && timingSafeEqual(Buffer.from(state), Buffer.from(pending.state));
    if (!validState || pending.expiresAt <= now() || pending.discordId !== session.discordUser.id) {
      throw linkError("expired", "This Roblox link request has expired. Please start again.");
    }
    delete session.robloxLink;
    saveSession(session);
    return pending;
  }
  async function start(session) {
    assertConfigured();
    const profile = await db.doc(`websiteAccounts/${session.discordUser.id}`).get();
    if (!profile.exists) throw linkError("profile_required", "Load your profile before linking Roblox.", 409);
    const state = randomBytes(32).toString("base64url");
    const verifier = randomBytes(32).toString("base64url");
    session.robloxLink = { state, verifier, discordId: session.discordUser.id, revision: profile.data().robloxRevision ?? 0, expiresAt: now() + 10 * 60_000 };
    saveSession(session);
    const url = new URL(`${OAUTH_BASE}/authorize`);
    url.search = new URLSearchParams({ client_id: oauth.clientId, redirect_uri: oauth.redirectUri,
      response_type: "code", scope: "openid profile", prompt: "select_account", state,
      code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256" }).toString();
    return { authorizationUrl: url.toString() };
  }

  async function request(url, options) {
    const response = await fetchImpl(url, { ...options, signal: AbortSignal.timeout(15_000), redirect: "error" });
    const body = await response.json().catch(() => null);
    if (!response.ok) throw linkError("provider_failed", "Roblox could not verify your account. Please try again.", 502);
    return body;
  }

  async function finish(session, query) {
    assertConfigured();
    const pending = consume(session, query.state);
    if (query.error) throw linkError(query.error === "access_denied" ? "cancelled" : "provider_failed", "Roblox account linking was not completed.");
    if (typeof query.code !== "string" || !query.code || query.code.length > 4096) throw linkError("expired", "Invalid Roblox authorization response.");
    const tokens = await request(`${OAUTH_BASE}/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: oauth.clientId, client_secret: oauth.clientSecret, redirect_uri: oauth.redirectUri,
        code: query.code, code_verifier: pending.verifier, grant_type: "authorization_code" }) });
    if (typeof tokens?.access_token !== "string" || !tokens.access_token) throw linkError("provider_failed", "Roblox did not provide an access token.", 502);
    // Use the authenticated UserInfo response; never trust a browser-supplied username or decode an unsigned ID token.
    const identity = parseRobloxIdentity(await request(`${OAUTH_BASE}/userinfo`, { headers: { authorization: `Bearer ${tokens.access_token}` } }));
    if (!isSessionActive(session)) throw linkError("expired", "Your website session expired. Sign in and try again.");
    const account = db.doc(`websiteAccounts/${session.discordUser.id}`);
    const claim = db.doc(`websiteRobloxLinks/${identity.userId}`);
    return db.runTransaction(async transaction => {
      const profile = await transaction.get(account);
      const owner = await transaction.get(claim);
      const data = profile.data();
      if (!profile.exists || (data.robloxRevision ?? 0) !== pending.revision) throw linkError("changed", "Your connection changed. Please start linking again.", 409);
      if (owner.exists && owner.data().discordId !== session.discordUser.id) throw linkError("already_linked", "That Roblox account is linked to another website account. Unlink it there first.", 409);
      const oldClaim = data.roblox?.userId && data.roblox.userId !== identity.userId ? db.doc(`websiteRobloxLinks/${data.roblox.userId}`) : null;
      const oldOwner = oldClaim ? await transaction.get(oldClaim) : null;
      const roblox = { ...identity, linkedAt: data.roblox?.userId === identity.userId ? data.roblox.linkedAt : new Date(now()), verifiedAt: new Date(now()) };
      if (oldOwner?.data()?.discordId === session.discordUser.id) transaction.delete(oldClaim);
      transaction.set(claim, { discordId: session.discordUser.id });
      transaction.update(account, { roblox, robloxRevision: pending.revision + 1 });
      // OAuth tokens are deliberately not persisted; this is identity linking, with no background Roblox access.
      return roblox;
    });
  }

  async function unlink(session, expectedUserId) {
    delete session.robloxLink;
    saveSession(session);
    const account = db.doc(`websiteAccounts/${session.discordUser.id}`);
    await db.runTransaction(async transaction => {
      const profile = await transaction.get(account);
      if (!profile.exists) throw linkError("profile_required", "Your account profile could not be loaded.", 409);
      const data = profile.data();
      if ((data.roblox?.userId ?? null) !== expectedUserId) throw linkError("changed", "Your Roblox connection changed. Refresh your profile and try again.", 409);
      const claim = data.roblox?.userId ? db.doc(`websiteRobloxLinks/${data.roblox.userId}`) : null;
      const owner = claim ? await transaction.get(claim) : null;
      if (owner?.data()?.discordId === session.discordUser.id) transaction.delete(claim);
      transaction.update(account, { roblox: null, robloxRevision: (data.robloxRevision ?? 0) + 1 });
    });
  }
  return { enabled, start, finish, unlink };
}
