---
name: verify
description: Run DevAnswers (backend + frontend) from this checkout and drive it in a headless browser to verify a change end to end.
---

# Verifying DevAnswers changes at runtime

## Gotchas
- **Ports 3000 and 5173 are usually taken by the main checkout's dev servers**
  (`WK11_GradedProject_DevAnswers`). They run *that* checkout's code, not this
  worktree's. Don't kill them; run this worktree on other ports.
- `devanswers-frontend/src/api/axiosInstance.js` hard-codes
  `http://localhost:3000/api`. Instead of editing it, have Playwright reroute
  `http://localhost:3000/**` to the worktree backend's port.
- There is no local MongoDB and no `.env` in worktrees. Use
  `mongodb-memory-server` (a backend devDependency). Its first start may download
  a ~780 MB MongoDB binary.
- The backend rate limit is **100 requests / 15 min per IP**. A full browser pass plus
  curl probes can exhaust it (symptom: 429, pages render without data).
  Restarting the backend resets it, but also gives you a fresh DB with **new ObjectIds**.

## Launch
1. Backend on 3001 with an in-memory DB, seeded with `src/scripts/populate-db.js`:
   a small Node launcher that creates `MongoMemoryServer`, sets `PORT=3001`,
   `MONGODB_URI`, `JWT_SECRET`, `JWT_EXPIRATION`, `NODE_ENV=development`, runs
   `node src/scripts/populate-db.js`, then `node main.js` (cwd `devanswers-backend`).
   Resolve the package with `createRequire(<backend>/package.json)`.
2. Frontend: `npx vite --port 5190 --strictPort` in `devanswers-frontend`
   (5174 is often taken too).
3. Playwright: install `playwright` in a scratch dir. If its pinned Chromium isn't
   cached, pass `executablePath` to a cached build under
   `%LOCALAPPDATA%\ms-playwright\chromium_headless_shell-*\...\chrome-headless-shell.exe`.

## Seed accounts (password `pass123`)
- `bob@example.com`: Bob Smith, **admin**, author of "How to implement authentication in Express.js?"
- `alice@example.com`: Alice Johnson, not an admin, author of that question's first answer ("You can use Passport.js…")
- `charlie@example.com` and others: ordinary users
- That question and Alice's answer are seeded with `editedAt` set.

## Driving tips
- Log in through `/login` (placeholders "Enter your email" / "Enter your password",
  `button[type=submit]`). Use one browser context per user.
- Count `GET /api/questions/:id` and `PUT` calls inside the route handler, to check
  that nothing refetches. Set `window.__marker` before a navigation to detect full reloads.
- Don't locate an answer card by its text if the action replaces that text
  (for example the inline editor). Pin it with `.nth(index)`.
