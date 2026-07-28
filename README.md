## Run locally

Requirements:

```text
Node.js 20 or newer
npm
```

From the extracted project directory:

```bash
npm install
npm run dev
```

Open:

```text
http://localhost:5173
```

Both processes start together:

```text
Vite frontend: http://localhost:5173
Node API:      http://localhost:3001
If site returns error 500, check http://localhost:3001/api/health 
If it prints out 
"{
  "ok": true
}" and still gives 500 report this to me. This is a BUG.
Otherwise, just restart.
```

## Files

```text
.env                        local secrets and configuration <-- to get this, you have to get it from me, it wont be published here
.env.example                .env template
server/index.mjs            Express API and OAuth routes
server/discord.mjs          Discord OAuth/API integration
server/security.mjs         signed cookies and origin checks
server/session-store.mjs    in-memory session storage
src/App.tsx                 login and authenticated UI
README.md                   this setup guide
```
