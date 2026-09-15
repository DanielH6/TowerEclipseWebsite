# Enable Roblox account linking

For the public website, policy URLs, and approval beyond 10 users, follow [the public launch guide](roblox-public-launch.md). The localhost example below is only for local development.

The implementation is ready for an official Roblox OAuth app. It uses the existing website Firestore database and does not access the game's player-data mirror. The existing Roblox Open Cloud API key is unrelated to this flow.

## One-time registration

1. In [Roblox Creator Dashboard](https://create.roblox.com/dashboard/credentials), open **OAuth 2.0 Apps → Create App**. Use a name such as **Tower Eclipse Accounts**. The app owner must review and accept Roblox's terms.
2. Save the generated client ID and secret securely. Choose **Account Linking Tools** and enable only **openid** and **profile**.
3. Add the callback URL: your website's `APP_ORIGIN` followed by `/api/account/roblox/callback`. For the default local setup, add `http://localhost:5173/api/account/roblox/callback`; production must use the exact HTTPS website origin.

Roblox keeps new apps private, with a limit of 10 unique users. Public access requires review, including app details, privacy/terms URLs, and an end-to-end demo. Follow the [official registration instructions](https://create.roblox.com/docs/cloud/auth/oauth2-registration). The [OAuth overview](https://create.roblox.com/docs/cloud/auth/oauth2-overview) describes creator identity verification and user eligibility.

## Configure the website

Set these in the backend environment, locally in the ignored `.env` and separately in production's secret settings:

```dotenv
ROBLOX_OAUTH_CLIENT_ID=your-client-id
ROBLOX_OAUTH_CLIENT_SECRET=your-client-secret
# Optional: defaults to APP_ORIGIN + /api/account/roblox/callback.
ROBLOX_OAUTH_REDIRECT_URI=http://localhost:5173/api/account/roblox/callback
```

For production, omit the redirect override to use the production `APP_ORIGIN`, or replace it with the exact production callback. Do not use `VITE_` variables for these values or commit the secret. Restart the backend after changing its environment. No new Firestore index or migration is needed for linking; its records use document-ID lookups.

Leaving both credentials blank keeps the rest of the website working. The Link Roblox button opens an explanatory prompt, with Continue unavailable until configuration is present. Setting only one credential fails startup with a configuration error.

## Troubleshooting the public website

**Scope not allowed for this application: openid** means the OAuth app must allow the requested identity scopes. In the matching app's permissions, choose Account Linking Tools, enable both `openid` and `profile`, save, and start a fresh link from the website.

**Consent prompt is required for this request** can occur with the old `prompt=select_account` URL. The backend now explicitly requests `prompt=consent`. Deploy this code to the host's `main` branch and restart to pull/rebuild, then generate a new link; an already-open authorization URL still contains the old prompt. These errors are separate from the private-app user limit.

If the popup says **Roblox linking is being prepared**, the running backend has not enabled OAuth. The host must set `ROBLOX_OAUTH_CLIENT_ID` and `ROBLOX_OAUTH_CLIENT_SECRET` in the production environment, with `APP_ORIGIN=https://towereclipse.com`. Omit `ROBLOX_OAUTH_REDIRECT_URI` or set it to `https://towereclipse.com/api/account/roblox/callback`, also registered in the Roblox app. Restart the backend after changing its environment. A developer's local `.env` does not configure the hosted server.

If **PLEASE WAIT…** persists before leaving the website, inspect `POST /api/account/roblox/start` in the browser's Network panel and the backend logs. Starting a link reads the website profile and saves session state; it does not contact Roblox or wait for app review. The client times out after 20 seconds and enables retry. Do not share cookies, OAuth URLs containing state, client secrets, or authorization headers in diagnostic messages.

A blocked Google Fonts stylesheet is a separate styling issue. It does not block this same-origin API request. Private-mode quotas are enforced by Roblox after redirection, and cannot explain a request that never leaves the website.

## End-to-end check after registration

1. Sign in with Discord, open **Account → Connections → Link Roblox**, and continue to Roblox.
2. Approve your Roblox identity. On return, check that the connection card and profile show your username and numeric ID, linking to the correct Roblox profile.
3. Test cancelling Roblox's consent screen, refreshing a username with **Update link**, and both cancelling and confirming **Unlink**.
4. A Roblox account already linked to another Discord account must be unlinked there before it can be linked again. This also applies to private-mode testers using multiple Discord accounts.

Local automated tests cover callback replay, PKCE/state, expired requests, ownership collisions, stale updates, unlinking, provider failures, and token non-persistence. Synthetic browser checks validate presentation; a real consent round trip still requires configured credentials.

## Data and authorization

The backend obtains the identity from Roblox's authenticated [UserInfo endpoint](https://create.roblox.com/docs/cloud/auth/oauth2-reference); users cannot submit a username or ID to claim ownership. The flow uses authorization code with PKCE, a one-use session-bound state that expires after ten minutes, and same-origin/CSRF checks for starting and unlinking.

Only the verified username, ID, and verification/link dates are retained. Roblox access/refresh tokens are not persisted. Username changes appear when the user selects **Update link** and verifies again. Unlink removes the website association; users can separately revoke the app's authorization in Roblox settings. In-game stats and recurring Roblox syncing are not enabled.

If OAuth is unsuitable, an alternative is a one-time random code that the user places in their Roblox profile description, checked by the server before linking. That would need its own verification and anti-replay implementation; a username lookup by itself does not establish ownership. This alternative is not enabled here.
