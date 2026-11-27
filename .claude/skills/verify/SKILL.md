---
name: verify
description: Run ThreadHive end to end (isolated backend + Vite + headless Chromium) to verify a change in the real UI
---

# Verify ThreadHive in the running app

No system `mongod` or Docker on this machine, and the user often has their own
backend on :3000 (nodemon, real `.env` DB) and Vite on :5173. Don't kill them and
don't write test data into their DB.

## Recipe

1. **Isolated Mongo:** from a scratch script, `createRequire` against
   `threadhive-backend/package.json`, then
   `await MongoMemoryServer.create({ instance: { port: 27999 } })` and keep the
   process alive. The first run downloads a MongoDB binary (~600 MB) into `~/.cache/mongodb-binaries`.
2. **Backend on a spare port:** in `threadhive-backend`, run
   `MONGODB_URI=mongodb://127.0.0.1:27999/verify JWT_SECRET=verify-secret PORT=3100 node main.js &`.
   dotenv does not override env vars that are already set.
3. **Seed through the API:** `POST /api/auth/register`, `POST /api/auth/login`, then
   `POST /api/subreddits` and `POST /api/threads` with the Bearer token.
4. **Frontend:** reuse the Vite dev server on :5173 if it's this worktree. Otherwise run
   `npm run dev -- --port 5199`.
5. **Browser:** use playwright-core from the global `@playwright/cli`
   (`%APPDATA%/npm/node_modules/@playwright/cli/node_modules/playwright-core`).
   Its bundled browser revision isn't installed, so pass
   `executablePath: %LOCALAPPDATA%/ms-playwright/chromium-1255/chrome-win64/chrome.exe`.
   The frontend hardcodes `localhost:3000/api`, so reroute it:
   `page.route("http://localhost:3000/api/**", r => r.continue({ url: r.request().url().replace(":3000", ":3100") }))`.
6. **Clean up:** stop only your own PIDs (mongo script, mongod on 27999, node on 3100).

## Gotchas
- Login: the header also has a "Login" button. Click `button[type=submit]`.
- Login and Register call `alert()`. Accept it with `page.on("dialog", d => d.accept())`.
- In dev, StrictMode runs effects twice, so every GET shows up twice in the network log. That's expected.
