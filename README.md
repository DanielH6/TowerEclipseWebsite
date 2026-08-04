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

## Cloudflare R2 image attachments

Create a private R2 bucket and a bucket-scoped **Object Read & Write** account API token. Add the R2 values shown in `.env.example`.

Apply `r2-cors.example.json` to the bucket. It already includes `http://localhost:5173`, `https://towereclipse.com`, and `https://www.towereclipse.com`. Origins must match exactly and must not include a trailing slash or path.

Images are stored under report-specific object keys. Firestore stores attachment metadata. The actual R2 object remains until a developer removes the attachment/report or an R2 lifecycle rule deletes it. Presigned view URLs are temporary and are regenerated when the report is loaded.

When images are selected during report creation, the report stays hidden as an upload draft. It becomes visible only after every selected image has uploaded and been verified. If any image fails, the API removes the draft and any images that already reached R2. Bug detail pages include an image viewer; select a thumbnail to enlarge it.

Supported images:

```text
png jpg jpeg
```

Default limits:

```text
25 MB per file
10 images per report
10-minute upload URL
15-minute download URL
```

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
