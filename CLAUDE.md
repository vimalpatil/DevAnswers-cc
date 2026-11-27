# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

DevAnswers is a Stack Overflow–style Q&A app split into two independent npm projects (no root package.json, not a git repo):

- `devanswers-backend/` — Express 5 + Mongoose REST API (ES modules), Gemini AI features via `@google/genai`
- `devanswers-frontend/` — React 19 + Vite + Redux Toolkit + React Bootstrap SPA

Run all commands from inside the relevant subproject directory.

## Commands

Backend (`devanswers-backend/`):
- `npm run dev` — start with nodemon (`main.js` → connects MongoDB, then starts server on `PORT`, default 3000)
- `npm start` — start without reload
- `npm run populate` — wipe and reseed the DB from `src/scripts/seed-data.js`
- `npm test` — Vitest, all tests (uses `mongodb-memory-server`; no real Mongo needed; files run serially)
- Single test: `npx vitest run tests/unit/services/questionService.test.js` or `npx vitest run -t "test name"`

Requires a `.env` (copy `.env.example`): `MONGODB_URI`, `JWT_SECRET`, `JWT_EXPIRATION`, `GEMINI_API_KEY`, `PORT`, `NODE_ENV` (stack traces are included in error responses only when `development`).

Frontend (`devanswers-frontend/`):
- `npm run dev` / `npm run build` / `npm run preview`
- `npm run lint` — ESLint (flat config)
- `npm test` — Vitest with jsdom
- Single test: `npx vitest run tests/unit/components/AnswerForm.test.jsx`

## Backend architecture

Layering: `src/routes/` → `src/controllers/` → `src/services/` → `src/models/`.

- **Models:** the Mongoose models (`User`, `Question`, `Answer`, `Tag`) live in `src/models/`, one file per model, each exporting `mongoose.model(...)` as the default export. `src/app.js` imports all four up front so they are registered before any `populate()` call. Questions and answers reference users by `author`; an answer points to its question through `questionId`; questions hold an array of `Tag` IDs.
- **Route mounting:** `src/app.js` builds the Express app (helmet, rate limit 100 req/15 min per IP, cors, JSON body) and mounts the router from `src/routes/index.js` at `/api`. `index.js` then mounts each resource router: `/auth`, `/questions`, `/answers` and `/tags`. To add a resource, create its router in `src/routes/` and register it in `index.js`, not in `app.js`.
- `src/app.js` is exported separately from `server.js`/`main.js` so integration tests can drive it with supertest.
- **Controllers have no try/catch** — they rely on Express 5 forwarding rejected promises to `middleware/errorHandler.js`. Services throw errors via `utils/createAppError(message, statusCode)`; the error handler maps `err.statusCode` to the response status (default 500).
- Response envelope everywhere: `{ success, message, data }`. The frontend reads `res.data.data`.
- Auth: `middleware/authHandler.js` verifies a `Bearer` JWT, loads the user, and sets `req.user = { id, isAdmin }`. Route files mark which routes are public vs. protected. Ownership checks (author or `isAdmin`) live in the services, which receive `req.user`.
- Voting: `services/voteService.js#handleVote(Model, id, userId, voteType)` is shared by questions and answers; documents store `upvotes`/`downvotes` arrays of user IDs plus a denormalized `voteCount`.
- Answers are nested for read/create (`GET|POST /api/questions/:questionId/answers`) but update/delete/vote via `/api/answers/:answerId`.
- `GET /api/auth/stats/:userId` (public) returns `{ totalQuestions, totalAnswers, totalVotesReceived, reputation }`, computed on the fly in `userService.getUserStats`. Reputation weights (+5 per question, +10 per answer, +10 per upvote received) must match the explanation shown in `Profile.jsx`.
- AI: `utils/geminiClient.js` lazily creates the Gemini client (`getAI()`) and `extractJSON()` pulls a JSON object out of model text. Used by `POST /api/questions/improve` and `POST /api/answers/summarize` (requires ≥3 answers). Note: `/improve` and `/summarize` are registered before `/:id` routes — keep that order.

Tests:
- `tests/unit/**` mock models/services with `vi.mock`.
- `tests/integration/**` import `../setup.js` explicitly (it is *not* a global setupFile) to spin up an in-memory MongoDB, then hit `app` via supertest, registering/logging in a user to get a JWT.

## Frontend architecture

- `src/api/axiosInstance.js` hardcodes `baseURL: http://localhost:3000/api`; endpoint paths are centralized in `src/config/config.js`.
- `src/services/*.js` wrap API calls; auth token is passed explicitly per call as an argument and set as an `Authorization: Bearer` header (no interceptor).
- Redux store (`src/store.js`): `user` (auth; `userInfo = { token, userId, name }` persisted to `localStorage.userInfo`), `question`, `theme` (dark mode persisted to `localStorage.darkMode`). Async work is done via `createAsyncThunk`, with localStorage side effects kept in thunks, not reducers.
- Routing in `App.jsx`: most pages render inside `SideBarLayout`; `/login` and `/register` do not. Everything is wrapped in `BaseLayout`.
- Tests: `tests/setup.js` starts an MSW server with handlers in `tests/mocks/handlers.js` (matching `http://localhost:3000/api`) and fixtures in `mockData.js`. Unit tests typically build an ad-hoc `configureStore` with stub reducers and mock `useNavigate`.
