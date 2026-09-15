# TE Accounts: public Roblox OAuth launch

Roblox must approve the app before more than 10 unique users can authorize it. Publishing the website or adding policy URLs alone does not lift that limit. The app stays private while its submission is reviewed. [Roblox registration and review](https://create.roblox.com/docs/cloud/auth/oauth2-registration)

## Current handoff

- Website implementation: Roblox OAuth linking, profile username/ID, update/unlink, policy routes, and policy links at sign-in and linking are implemented locally.
- Policies: prepared with the operator-provided details: Eclipse Development Studio, Australia, and contact@towereclipse.com. The host has confirmed Google Cloud `us-central1` (Council Bluffs, Iowa, US) for the website and 30-day console-log retention. The local policy now reflects those facts. Backup locations/retention and separate Firestore/R2 storage configurations remain to be confirmed.
- Deployment: the operator published the account/Careers implementation. The host confirmed `main` is deployed and `/kubectl/restart` pulls and rebuilds it. Local diagnostic/timeout and policy updates still need committing, merging into `main`, and deployment. A complete Roblox consent round trip remains unverified.
- Roblox review: not submitted. A real demo recording and the app owner's submission remain necessary.

## Existing host handoff

The operator supplied hosting conversations from 30 July–7 August 2026. Those messages describe zhuyifei1999's Google Cloud Kubernetes cluster, Traefik ingress/TLS, Caddy serving static website files, and Node handling `/api` on port 3001. The application pulls GitHub code on restart. This is historical configuration evidence, not a fresh inspection of the cluster.

The later messages supersede the early experiments: the authenticated control routes are `/kubectl/start`, `/kubectl/stop`, and `/kubectl/restart`; the old `/restart` route was retired. According to the host, restart has no effect while the application is stopped, so start is needed in that situation. No control route was called during this review.

The confirmed release sequence is: commit changes, push/merge them into `main`, update required production configuration, then restart to pull and rebuild. A push by itself is not established as a deployment trigger. Work on `superstitic` must reach `main` before restarting will deploy it.

### Host follow-up received 15 September 2026

- `main` is the deployed branch; restart pulls and rebuilds it.
- One Node instance is running. Earlier host messages establish `.runtime` as persistent storage; use that exact project-relative path, not `/runtime`.
- The website runs in Google Cloud `us-central1`, Council Bluffs, Iowa, United States.
- Console logs are retained for 30 days. The host was uncertain whether Traefik access logging was still enabled, so do not promise that IP addresses are never logged. Network processing of an IP address is distinct from retaining it in logs.
- The host reported adding the Roblox OAuth settings. A fresh live check still showed “Roblox linking is being prepared” and disabled Continue. Confirm the backend has restarted and that both variables are present in the running Node environment. Do not request or print their values for diagnostics.
- Backups (whether enabled, locations, and retention), separate Firestore/R2 configurations, and the precise access-log configuration are still open details. The host region does not establish the location of every datastore or backup.

### Original questions (superseded by the follow-up above)

> We have the account dashboard, Roblox OAuth linking, and `/privacy` and `/terms` pages ready locally. Before release, could you confirm:
>
> 1. Which GitHub branch does the site pull, and does `/kubectl/restart` still pull it, run `npm ci` / `npm run build`, and restart both the Node app and static serving as needed? Please confirm the deployed commit after release.
> 2. Can you add `ROBLOX_OAUTH_CLIENT_ID` and `ROBLOX_OAUTH_CLIENT_SECRET` to the existing production Secret/environment, plus `ROBLOX_OAUTH_REDIRECT_URI=https://towereclipse.com/api/account/roblox/callback`? `APP_ORIGIN` should remain `https://towereclipse.com`. I will provide the credentials through a private channel, outside GitHub. Please preserve the other production settings.
> 3. Please confirm Caddy serves the SPA on direct visits to `/privacy`, `/terms`, and `/login`, and `/api/account/roblox/callback` reaches Node with the full path/query intact. API responses must remain uncached.
> 4. Are we still running one active Node instance with writable, persistent `.runtime` storage? The application currently keeps its encrypted sessions and persistent report cache there and expects one backend. It requires Node 22 or newer.
> 5. For our privacy notice, which Google Cloud region/country stores the website/runtime data? Do Traefik, Caddy, the app, or the hosting platform retain IP/access/error logs or backups, for how long, and is any analytics/tracking added outside the repo?
>
> The old conversation contains deployment and service credentials. Please coordinate replacing any that remain active, including the deployment-control token and the hosting copies of affected service credentials. I will update the provider-side values I control so replacements stay synchronized.

No credential values from the conversation are included in this guide. The control token authorizes the three documented lifecycle actions; nothing in the supplied material establishes that it grants shell access or the ability to edit Kubernetes Secrets. Secret values must be made available to the Node container through the actual deployment configuration. [Kubernetes Secret environment variables](https://kubernetes.io/docs/concepts/configuration/secret/#using-secrets-as-environment-variables)

Caddy needs the existing API/static separation and an `index.html` fallback for client routes. [Caddy SPA configuration](https://caddyserver.com/docs/caddyfile/patterns#single-page-apps-spas)

The screenshots show GoDaddy as the registrar context and Cloudflare DNS records, with the apex domain set to DNS only. They do not establish a server region, mail delivery, or proxying of all website traffic. An earlier public DNS query returned no MX records. The operator has since completed email forwarding and confirmed that a test sent to `contact@towereclipse.com` arrived in the destination inbox. Incoming delivery is therefore confirmed by the operator; no test email was sent by this task.

## Finalize the policies

Public details are held in `legalDetails` in `src/content/legalContent.tsx`. The operator has provided the studio name, Australia, and contact@towereclipse.com. Confirm that this mailbox is monitored for privacy/access/deletion requests as well as general support, that the text describes actual operational practices, and that the effective date matches adoption. Eclipse Development Studio is used as the operator's chosen name; this work does not register a business or represent that a company has been incorporated.

`contact@towereclipse.com` was initially a placeholder. The operator has now configured forwarding and reported a successful delivery test. Continue monitoring the destination inbox for support and privacy requests. Forwarding does not itself configure replies to be sent from the alias. This task did not create the routing rule or handle the private destination address.

The policies are accessible without sign-in at `/privacy` and `/terms`, linked from the footer and before account authorization. They describe the current website rather than proposed in-game features. The draft terms include the Roblox-specific provisions required by section 10 of the [Creator Third Party App Terms](https://en.help.roblox.com/hc/en-us/articles/15887203369620-Creator-Third-Party-App-Terms). These drafts are not a legal determination that the operator complies with every applicable law; have a qualified adviser review them for the operator's circumstances before adoption.

Before publication, confirm:

- The operator and contact details are accurate and requests will be handled.
- Backup locations/retention, separate database/file-storage configurations, and whether access logs are enabled. The website host and its console-log retention are confirmed above. Add any provider analytics or tracking configured outside this repository to the privacy notice.
- The stated account eligibility, moderation, contribution permissions, and retention practices are acceptable and will be followed.
- The policies describe public report visibility accurately: submitted reports, comments, attachments, and actor metadata are public, including reports awaiting approval or rejected. Private developer notes are restricted to developers/QA leads.

Policy writing references: [OAIC guidance on privacy-policy contents](https://www.oaic.gov.au/privacy/your-privacy-rights/your-personal-information/what-is-a-privacy-policy), [Roblox third-party app data rules](https://en.help.roblox.com/hc/en-us/articles/37924211313044-Creator-Third-Party-App-Policy). Applicable legal obligations depend on the operator and users' jurisdictions; the draft does not assume an exemption.

## Production settings

Keep local development and the hosted backend separate. In the production host's environment/secret settings, use:

```dotenv
APP_ORIGIN=https://towereclipse.com
ROBLOX_OAUTH_CLIENT_ID=<the app's client ID>
ROBLOX_OAUTH_CLIENT_SECRET=<the app's client secret>
ROBLOX_OAUTH_REDIRECT_URI=https://towereclipse.com/api/account/roblox/callback
```

Deploy the frontend and Node backend together. Requests under `/api` on towereclipse.com must reach that backend, including the Roblox callback. Preserve the existing production Discord callback settings. Do not put the Roblox secret into frontend build variables or source control.

## Roblox Creator Dashboard values

| Field | Value |
| --- | --- |
| App name | TE Accounts |
| Description | Link your Roblox account to your Tower Eclipse website profile to display your verified Roblox username and user ID. |
| Entry Link | `https://towereclipse.com/login` |
| Privacy Policy URL | `https://towereclipse.com/privacy` |
| Terms of Service URL | `https://towereclipse.com/terms` |
| Category | Account Linking Tools |
| Permissions | `openid`, `profile` only |
| Redirect URL | `https://towereclipse.com/api/account/roblox/callback` |

Use Tower Eclipse artwork that the operator has rights to use for the thumbnail. Check each published policy URL while signed out before submitting.

Suggested permission justification:

> TE Accounts connects a user's Roblox identity to their existing Discord-authenticated Tower Eclipse website profile. We use openid to obtain the stable Roblox user ID and profile to obtain the username. After consent, the account page displays that username and ID. Users can update or unlink their connection. We do not request game data, messaging, purchases, or asset permissions, and do not retain Roblox access or refresh tokens.

## Record and submit

Record an end-to-end demonstration of at most one minute, starting signed out. Show Discord sign-in, Connections → Link Roblox, Roblox's consent screen, and the return to the website with the username and ID. Keep secrets and unrelated account information out of the recording. Supply a review-accessible video link.

In the app's **Edit and Publish** flow, fill the required app details, video, and justification, then use **Review and Publish → Submit for Review**. The app owner must review the submission and any terms before submitting it. Roblox's approval moves the app to public mode; rejection requires addressing the feedback and resubmitting. There is no website-side setting that bypasses this decision.

## Handling privacy requests

The current implementation offers self-service Roblox unlinking. Full website data access/deletion requests are handled manually by the operator at the policy's contact address. Before launch, assign someone to monitor that address.

For a verified request, locate the account by Discord user ID. Relevant sources include `websiteAccounts`, `websiteRobloxLinks`, report authors and actor snapshots, comments, report activity, developer notes, submitted attachments in R2, organizer-entered tournament records, and support correspondence. Identify precisely what must be supplied, corrected, deleted, or anonymized and what must be retained under applicable obligations.

Invalidate the user's active Discord website sessions when removing their account. Remove the Roblox claim and profile connection together. Clean up related files where removal is required. Refresh the persistent bug-list cache after direct Firestore changes, and consider historical author snapshots; deleting only `websiteAccounts/{id}` does not remove those records. Signing back in can create a new profile, so explain this to the requester. Handle relevant provider logs/backups according to the confirmed retention process and prevent deleted data being reintroduced through a restore.

Roblox's policy also requires expunging Roblox-API-derived data if API access is lost. Disabling the OAuth environment variables alone does not delete stored identities. The operator must stop linking and remove the stored Roblox identity/claim records if that requirement is triggered. No mass-deletion job has been run or added by this task.

## Runtime path clarification

Atomik confirmed that the backend uses runtime storage for caching. The current code uses `.runtime` relative to the application working directory for encrypted sessions and `.runtime/cache` for disk caches (unless `LOCAL_CACHE_DIR` overrides the cache path). A path spelled `/runtime` is a different absolute directory and should not be substituted without confirming the host mount and startup directory. Account profiles and Roblox ownership links remain in Firestore; runtime storage is not a replacement account database.
