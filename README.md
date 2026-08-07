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
