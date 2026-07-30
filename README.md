## Security warning

Never publish or commit any of these:

```text
.env
Discord Client Secret
COOKIE_SECRET
Firebase Admin service-account JSON
Roblox Open Cloud API key
```

The downloadable/project archive intentionally does not include `.env`, `.git`, `node_modules`, or `dist`.

## What is implemented

```text
Discord OAuth login
Discord role mapping: dev > leadqa > qa
Secure server-side sessions
Cloud Firestore bug reports
Automatic Discord reporter attribution
Submission and approval timestamps
Approver/rejector attribution
Comments
Developer notes
Activity history
Developer-only dynamic dictionary admin
Live Roblox plays, monthly players, and CCU statistics
```

Pages:

```text
/bugs           report table and filters
/bugs/new       new bug editor
/bugs/<id>      details, approval, comments, notes, history
/admin          developer-only dictionary editor
/login          Discord authentication
```

## Requirements

```text
Node.js 22 or newer
npm
```

### Generate `COOKIE_SECRET`

Run this command from any directory with Node.js installed:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Copy the full 64-character result into `.env`:

```env
COOKIE_SECRET=PASTE_THE_GENERATED_VALUE_HERE
```

Generate it once per environment. Changing it invalidates existing login cookies and logs everyone out.

=======
### Configure Roblox live statistics

The Tower Eclipse universe ID is:

```env
ROBLOX_UNIVERSE_ID=6466960954
```

In Roblox Creator Dashboard, create an Open Cloud API key with access restricted
to Tower Eclipse. Under `universe-analytics`, grant only the
`universe.analytics:read` operation. Store the generated key in `.env`:

```env
ROBLOX_OPEN_CLOUD_API_KEY=PASTE_THE_GENERATED_KEY_HERE
```

The key is read only by the Node API. Never put it in React code or a `VITE_`
environment variable.

## 5. Install and run

From the project directory:

```bash
npm ci
npm run dev
```

`npm run dev` now starts the API without Node watch mode, preventing development file-watcher restarts from interrupting bug submissions. The Vite frontend still supports hot module replacement. To intentionally auto-restart the API while editing files under `server/`, use:

```bash
npm run dev:watch
```

Open:

```text
http://localhost:5173
```

Both processes run together:

```text
Vite frontend: http://localhost:5173
Node API:      http://localhost:3001
```

API health check:

```text
http://localhost:3001/api/health
```

Expected response:

```json
{
  "ok": true
}
```
=======
Roblox statistics endpoint:

```text
http://localhost:3001/api/roblox/stats
```

## Dynamic dictionaries

A user with the exact `dev` website role can open `/admin` and manage:

```text
Statuses
Versions
Priorities
Categories
Types
Devices
```

## Important files

```text
.env.example                 safe environment template
firestore.rules              deny-all browser Firestore rules
server/firebase.mjs          Firebase Admin initialization
server/auth-context.mjs      Discord-session API authorization
server/bug-routes.mjs        report, approval, comments, notes API
server/dictionaries.mjs      dynamic dictionary API and seed data
<<<<<<< HEAD
=======
server/roblox-stats.mjs      Roblox public and Open Cloud analytics client
>>>>>>> origin/main
server/index.mjs             Express and Discord OAuth routes
src/Pages/Bugs.tsx           report table
src/Pages/NewBug.tsx         report editor
src/Pages/BugDetails.tsx     report workflow/details
src/Pages/Admin.tsx          developer-only dictionaries
```
