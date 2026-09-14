# Tower Eclipse website

React/Vite frontend with a Node API, Discord OAuth, Firestore bug reports, dynamic dictionaries, Roblox statistics, persistent encrypted sessions, and private Cloudflare R2 image attachments.

## Security

Never commit or share:

```text
.env
Discord Client Secret
COOKIE_SECRET
Firebase service-account JSON
Roblox Open Cloud API key
R2 Secret Access Key
.runtime/
```

## Install

```bash
npm ci
npm run dev
```

Frontend: `http://localhost:5173`

API health: `http://localhost:3001/api/health`

## Environment

Copy `.env.example` to `.env` and replace all placeholders. Generate `COOKIE_SECRET` with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## Firestore

Publish `firestore.rules`. Browser access is denied; the Node API uses the Firebase service account.

## Attachment permissions

```text
QA:      own pending reports
QA Lead: non-terminal reports
Dev:     every report, including terminal reports
```

QA Leads remain comments-only after a report becomes terminal. Only developers can reopen terminal reports.

## Pages

```text
/bugs
/bugs/new
/bugs/:id
/admin
/login
/privacy
/terms
```

## News and update editor

Developers can manage patch notes at `/admin/updates`. Published updates appear at `/news` and `/news/:id`. The editor includes WYSIWYG fields for developer comments, section introductions, and update entries, plus R2-backed cover and entry images.

Supported update sections:

- New Features
- Balancing Changes
- Bug Fixes, split into Major and Minor
- Small Changes

Optional environment setting:

```env
R2_MAX_IMAGES_PER_UPDATE=500
```

The existing R2 credentials and CORS policy are reused for update images.

## Firestore read protection

Dictionaries and the main bug-report collection are cached **persistently on the backend machine**, not on a short timer. Normal page loads therefore do not repeat the expensive Firestore collection queries.

- `dictionaries.json` contains all dynamic dictionary entries;
- `bug-reports.json` contains the main bug-report documents used by `/api/bugs`;
- cache files are updated immediately when this backend creates, edits, archives, comments on, attaches to, finalizes, or deletes the corresponding data;
- report dictionary labels/colors are rehydrated from the local dictionary cache, so admin color/label changes still appear on existing reports;
- public update lists/details remain cached in memory for 60 seconds;
- live tournament polling is once per minute and public tournament responses are cached for 90 seconds;
- normal server startup performs one read-only Firestore connectivity check.

By default the files are written under:

```text
.runtime/cache/dictionaries.json
.runtime/cache/bug-reports.json
```

To use a different writable location, set:

```env
LOCAL_CACHE_DIR=/tmp/tower-eclipse-cache
```

For a server with a persistent writable data volume, point `LOCAL_CACHE_DIR` at that volume instead of `/tmp` so the cache survives redeployments. If the application directory is read-only, do not leave the cache at `.runtime/cache`.

The cache has no automatic Firestore refresh timer. This is intentional: admin/report mutations performed through this backend are write-through and update the local files immediately. If someone edits Firestore directly in the Firebase console, or another backend instance writes to the same database, manually resync once with:

```bash
npm run cache:refresh
```

That command intentionally performs one full dictionary read and one ordered bug-report read, then saves the result locally.

Remaining optional in-memory cache tuning:

```env
FIRESTORE_PUBLIC_UPDATE_CACHE_TTL_SECONDS=60
FIRESTORE_TOURNAMENT_CACHE_TTL_SECONDS=90
```

Dictionary defaults are seeded manually when needed:

```bash
npm run seed:dictionaries
```

The seed command only creates missing default entries and does not overwrite existing admin changes.

### Single-backend assumption

The persistent dictionary/bug cache is designed for one active Node backend. If multiple Node instances are run simultaneously against the same Firestore project, use a shared cache such as Redis rather than independent machine-local files.

## Account dashboard

Public Roblox launch instructions, production environment values, and policy review details are in [Roblox public launch](docs/roblox-public-launch.md). The public operator/contact details are in `src/content/legalContent.tsx`; the prepared policies use Eclipse Development Studio, Australia, and contact@towereclipse.com.

`/login` remains the Account navigation destination. Discord sign-in now returns to this account home instead of redirecting to the public bug list. All Discord members receive a profile and Connections section; QA Testers, QA Leads, and Developers (including the existing Discord Admin mapping) also receive personal reports, activity, statistics, and a contribution calendar.

The dashboard uses the existing website Firestore project. It does not read or write the Tower Eclipse player-data mirror. Roblox identity linking uses Roblox OAuth with `openid profile`; see [Roblox linking setup](docs/roblox-account-linking.md) to register the app and enable the flow. Personal game statistics remain a future feature.

### Stored data and access

- `websiteAccounts/{discordId}` stores a small profile: Discord ID, display name, username, avatar URL, first recorded login, schema version, and the activity read watermark. When linked, it also stores a verified Roblox username, numeric ID, link/verification dates, and a connection revision. Role permissions always come from the current Discord session. Discord tokens remain in the existing encrypted session store; Roblox tokens are discarded after verification. Neither is copied into account documents.
- `websiteRobloxLinks/{robloxUserId}` stores only the owning Discord ID. A transaction maintains one Roblox account per website profile and prevents another profile from claiming an already-linked account. Initial linking/refresh writes two documents; replacement adds one old-claim deletion. Unlinking updates the profile and deletes its claim. No periodic Roblox writes or token refresh jobs are introduced.
- First login is recorded from this feature's rollout. Historical sign-ins cannot be reconstructed. Existing sessions lazily create their profile on opening Account. Profile writes happen on first creation or identity changes, plus an explicit “mark all as read”; page views do not update a last-seen counter.
- New public comments, approvals, rejections, edits, and status changes add recipient metadata to the **existing** report activity document in the same commit as the report mutation. This adds no second notification write. The account feed returns only safe summary fields and its latest 30 events; private developer notes are excluded. Feed history begins at rollout, including new changes to older reports. Existing report histories remain available on report details. Deleting a report also removes its activity from the feed.
- `/api/account/*` derives ownership exclusively from the authenticated Discord session. The caller cannot choose another account ID. Staff sections retain server-side role checks; marking activity read requires same-origin and CSRF checks. Direct browser Firestore access remains denied by the existing rules.

### Read and storage budget

- Personal reports use cursor pagination (20 results plus one lookahead), optional status filtering, and selected fields. They do not depend on the public list's 1,000-report cache. Cursor timestamps preserve Firestore microseconds.
- Statistics use eight index aggregation queries: total minus unfinished uploads for each of the exact rolling 24-hour, 7-day, 30-day, and lifetime windows. Results are cached for 60 seconds, with concurrent requests coalesced. Legacy reports without `submissionState` still count. Counts are based on report creation time and exclude deleted reports; this is not a permanent count of deleted submissions.
- The calendar reads only creation time and submission state from the past 365 UTC days. Its hard budget is 2,001 records (2,000 plus a completeness check), cached for 15 minutes. If limited, the UI explicitly explains that daily totals may be incomplete; aggregate statistics remain uncapped. Selected fields reduce transfer size, not the number of billed document reads.
- Caches have a combined maximum of 200 entries per process. No account polling, background database sync, per-player writes, or duplicated report collections are introduced. Manual refresh respects statistics/calendar cache intervals. Report and activity lists refresh immediately. At substantially larger usage, move these bounded caches to shared storage across API instances.
- Profile fields are exempt from automatic indexing because accounts are fetched directly by document ID. The existing report audit history remains the long-term source; the account feature adds only its recipient metadata.

### Firestore indexes and rollout

Required definitions are checked into `firestore.indexes.json`. To inspect the configured project's current state:

```sh
npm run account:indexes
```

An identity with Firestore index-management permission can add only the missing indexes and the account-field exemption:

```sh
npm run account:indexes -- --apply
```

This script never deletes existing indexes, changes security rules, or modifies account/report documents. The website's runtime service account may have data access without index-management permission; a 403 here does not require widening its runtime permissions. In that case, use an authorized Firebase console account: **Firestore → Indexes → Manual → Add index → Structured index**. Add these definitions:

| Collection ID | Fields, in order | Query scope |
| --- | --- | --- |
| `bugReports` | `reporter.discordId` ascending; `createdAt` descending | Collection |
| `bugReports` | `reporter.discordId` ascending; `submissionState` ascending; `createdAt` descending | Collection |
| `bugReports` | `reporter.discordId` ascending; `status.id` ascending; `createdAt` descending | Collection |
| `activity` | `recipientId` ascending; `createdAt` descending | Collection group |

Firestore appends the document-name sort automatically. Under **Automatic → Add exemption**, use collection `websiteAccounts`, field `*`, Collection scope, and disable Ascending, Descending, and Arrays. Leave database-wide defaults and other collections untouched. Wait for all four manual indexes to finish building before deploying the server and frontend together. Collections are created automatically when the first account is saved. No data migration or new Firebase project is required.

Reference: [Firestore index management](https://firebase.google.com/docs/firestore/query-data/indexing), [aggregation queries](https://firebase.google.com/docs/firestore/query-data/aggregation-queries), and [Firestore best practices](https://firebase.google.com/docs/firestore/best-practices).

### Validation

`npm test` covers first-login persistence, identity-only updates, ownership isolation, exact statistic boundaries, lifetime counts exceeding 1,000, drafts, legacy reports, paginated ties, microsecond cursors, public-only activity, monotonic read acknowledgements, calendar limits, and REST query encoding. `npm run build` validates the TypeScript frontend and production bundle. Desktop/mobile browser checks use isolated synthetic data; they do not prove a real Discord OAuth login or multi-user live report notifications. Complete a tester/developer smoke test after the application is deployed.


## Careers and applications

Careers is available at `/careers` and in the header. Admins can create, preview, publish, and close multiple openings through `/admin/careers`, then review private submissions at `/admin/careers/review`. Applicants must sign in with Discord and link a verified Roblox account. Account → Applications tracks decisions, feedback, and withdrawal.

The builder supports short/long answers, multiple choice, checkboxes, rankings, and 0/1–10 linear scales, with required fields, help text, question reordering/duplication, deadlines, and starter templates. Shared immutable form versions, bounded answers/history, explicit writes, index exemptions, and 20-item cursor pages keep growth predictable.

Read [Careers setup and operating guide](docs/careers.md) before launch. It includes the new Firestore indexes, privacy/retention handling, role boundaries, and verification steps. `npm run db:indexes` checks all account and Careers definitions; `-- --apply` requires an identity authorized to manage indexes. The existing `account:indexes` alias now also processes all definitions in `firestore.indexes.json`.
