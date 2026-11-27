# Implementation Plan: Spec 001, Bookmarks

- **Spec:** [`001-bookmarks.md`](./001-bookmarks.md) · **Review deck:** [`001-bookmarks-review.html`](./001-bookmarks-review.html)
- **Order:** bottom-up. Model → service → controller → route → backend tests → Redux slice → frontend service → component → wire-up → frontend tests.
- **Conventions to follow:** see `CLAUDE.md`.
  - Controllers have no try/catch (Express 5 forwards rejections).
  - Services throw `createAppError(message, status)`.
  - Responses use the `{ success, message, data }` envelope.
  - The frontend passes the token explicitly in each service call.
  - Async work goes in `createAsyncThunk`; side effects stay out of reducers.

AC numbers refer to the spec's acceptance criteria (§3).

---

## Findings that shape the plan

These came from reading the code against the spec. They add a few files the spec's §10 didn't list.

1. **`answerCount` is computed the same way in two places:** `getAllQuestionsService` (`questionService.js:19-23`) and `getQuestionsByTagService` (`tagService.js:33-34`) each map questions to `{ ...q.toObject(), answerCount }`. Bookmarks needs it a third time, so extract a shared helper first (Task B1) instead of copying it again.
2. **The `questionService` unit tests mock models one by one** (`vi.mock` of Question, Answer and Tag). Once `deleteQuestionService` touches `Bookmark`, that test file **must also `vi.mock` `Bookmark.js`**. Otherwise the real Mongoose model buffers without a connection and the delete tests time out.
3. **`tests/setup.js` (backend) only clears Question and Answer.** The new integration test must clear `Bookmark` and `User` in its own `beforeEach`.
4. **The MSW handlers are module-level and stateless.** Bookmark handlers need per-test in-memory state, so `tests/mocks/handlers.js` exports a reset function, and `tests/setup.js` (frontend) calls it in `afterEach`. The spec didn't list this file.
5. **No existing test renders `App.jsx`**, and `App` creates its own `BrowserRouter`. The new flow test renders `App` inside a `Provider` and sets the route with `window.history.pushState`, not `MemoryRouter`.
6. **`userSlice` exports `logout`** (`userSlice.js:106`), so `bookmarkSlice` can `addCase(logout, …)` directly. `userSlice` doesn't import `bookmarkSlice`, so there is no circular import.
7. **`populate-db.js` clears and seeds each model explicitly** (lines 28-31). Seeding bookmarks is optional (spec §5.3). If it's skipped, still add `Bookmark.deleteMany({})` to the clear step so re-seeding never leaves orphans.

---

## Phase A: Data model

### A1. Create the `Bookmark` model
- **Create** `devanswers-backend/src/models/Bookmark.js`:
  - Schema with `user` (ref `User`, required) and `question` (ref `Question`, required), `{ timestamps: true }`.
  - Indexes: unique `{ user: 1, question: 1 }`, `{ user: 1, createdAt: -1 }`, `{ question: 1 }`.
  - Default export `mongoose.model("Bookmark", …)`.
- **Edit** `devanswers-backend/src/app.js`: import `Bookmark` alongside the other four models.
- **Edit** `devanswers-backend/src/scripts/populate-db.js`: add `Bookmark.deleteMany({})` to `clearExistingData`. Optionally seed 2–3 bookmarks for the first seeded user after answers are created.

## Phase B: Service

### B1. Extract the shared `answerCount` helper (refactor, no behaviour change)
- **Create** `devanswers-backend/src/services/answerCountHelper.js` with `withAnswerCounts(questions)`. It returns plain objects with `answerCount` attached and keeps the existing `q.toObject?.() ?? q` handling.
- **Edit** `questionService.js` (`getAllQuestionsService`) and `tagService.js` (`getQuestionsByTagService`) to use it.
- Run the existing backend suite. It must stay green with no test edits, which proves the refactor is behaviour-neutral.

### B2. Create `bookmarkService`
- **Create** `devanswers-backend/src/services/bookmarkService.js`. Key functions:

| Function | Behaviour (spec ref) |
| --- | --- |
| `assertValidQuestionId(questionId)` (internal) | `mongoose.Types.ObjectId.isValid`, otherwise `createAppError("Invalid question ID", 400)` (§4.5) |
| `getBookmarksService(userId)` | `Bookmark.find({ user })`, sorted `{ createdAt: -1, _id: -1 }` (the `_id` tiebreaker matches the existing sorts), populating `question` and its nested `author` (name) and `tags`. Drop entries whose `question` is null (§4.1, orphans). Map to the question plus `bookmarkedAt = bookmark.createdAt`, then `withAnswerCounts`. |
| `getBookmarkIdsService(userId)` | `Bookmark.find({ user }).select("question")`, returned as an array of string IDs (§4.2). |
| `addBookmarkService(userId, questionId)` | Validate the ID. `Question.exists({ _id })`, otherwise 404 `"Question not found"`. Upsert with `findOneAndUpdate({ user, question }, { $setOnInsert: … }, { upsert: true, new: true })`. On error `code === 11000`, re-read the existing doc. Return `{ questionId, bookmarked: true, bookmarkedAt }` (§4.3). |
| `removeBookmarkService(userId, questionId)` | Validate the ID. `Bookmark.deleteOne({ user, question })`, with no existence check on the question. Return `{ questionId, bookmarked: false }` (§4.4). |
| `deleteBookmarksForQuestion(questionId)` | `Bookmark.deleteMany({ question })`, used by the cascade (C2). |

- **Rule:** no function takes a user from anywhere but its `userId` argument. Only the controller supplies it, from `req.user.id` (AC-7).

### B3. Question delete cascade
- **Edit** `devanswers-backend/src/services/questionService.js`: in `deleteQuestionService`, after `Answer.deleteMany`, call `deleteBookmarksForQuestion(id)` (AC-13).

## Phase C: Controller

### C1. Create `bookmarkController`
- **Create** `devanswers-backend/src/controllers/bookmarkController.js`. Key handlers: `getBookmarks`, `getBookmarkIds`, `addBookmark`, `removeBookmark`.
- Each handler reads `req.user.id`, plus `req.params.questionId` where relevant, calls the matching service, and responds 200 with the §4 envelope and the spec's exact `message` strings:
  - `"Bookmarks fetched successfully"`
  - `"Bookmark IDs fetched successfully"`
  - `"Question bookmarked"`
  - `"Bookmark removed"`
- No try/catch.

## Phase D: Routes

### D1. Bookmark router
- **Create** `devanswers-backend/src/routes/bookmarks.js`:
  - `router.use(authenticate)`, applied once so no route can be added unauthenticated by mistake (AC-10).
  - `GET /` → `getBookmarks`
  - `GET /ids` → `getBookmarkIds`, declared before any parameterised GET
  - `PUT /:questionId` → `addBookmark`
  - `DELETE /:questionId` → `removeBookmark`

### D2. Mount
- **Edit** `devanswers-backend/src/routes/index.js`: `router.use('/bookmarks', bookmarksRouter)`.

## Phase E: Backend tests

### E1. Unit: service
- **Create** `devanswers-backend/tests/unit/services/bookmarkService.test.js`. Use `vi.mock` for `Bookmark.js`, `Question.js` and `Answer.js`, following the `questionService.test.js` pattern.
- **Cases:**
  - invalid ID → 400 (add and remove)
  - missing question → 404 (add)
  - upsert called with the right filter
  - E11000 → success
  - remove of a non-existent bookmark → success
  - list sorted with orphans dropped, `bookmarkedAt` and `answerCount` present
  - IDs returned as strings

### E2. Unit: controller
- **Create** `devanswers-backend/tests/unit/controllers/bookmarkController.test.js`. Mock the service, following `authController.test.js`.
- **Cases:**
  - each handler passes `req.user.id`, ignoring a `userId` planted in `req.body` or `req.params` (AC-7)
  - status, envelope and message
  - service rejection propagates

### E3. Unit: update the existing `questionService` tests
- **Edit** `devanswers-backend/tests/unit/services/questionService.test.js`:
  - add `vi.mock` for `Bookmark.js` (Finding 2)
  - assert that `deleteQuestionService` calls `Bookmark.deleteMany({ question: id })`

### E4. Integration
- **Create** `devanswers-backend/tests/integration/bookmarks.test.js`. Import `../setup.js`, and clear `User`, `Question`, `Answer` and `Bookmark` in `beforeEach`. Create users and sign JWTs via register and login, as `questions.test.js` does.
- **Cases (spec §9.2):**
  - 401 on all 4 endpoints, with no token and with a bad token (AC-10)
  - add, then both lists include the question with populated `author.name`, `tags`, `answerCount` and `bookmarkedAt` (AC-1)
  - `PUT` twice gives one document; `DELETE` twice gives 200
  - remove (AC-2)
  - order by explicit `createdAt` values; don't rely on wall-clock gaps, to avoid the `tags.test.js` flake (AC-8)
  - privacy between users A and B (AC-7)
  - 400 for an invalid ID, 404 for a missing question
  - empty list returns `[]`
  - a user can bookmark their own question
- **Edit** `devanswers-backend/tests/integration/questions.test.js`: deleting a question removes its bookmarks, which then disappear from the owner's `GET /api/bookmarks` (AC-13).

**Checkpoint:** run `cd devanswers-backend && npm test`. All green.

## Phase F: Redux slice

### F1. `bookmarkSlice`
- **Create** `devanswers-frontend/src/reducers/bookmarkSlice.js`.
- **State:** `{ ids: {}, items: [], pending: {}, idsStatus, itemsStatus, error }`. Everything is serializable.
- **Thunks:** `fetchBookmarkIds`, `fetchBookmarks`, `addBookmark(question)`, `removeBookmark(questionId)`.
  - Each reads the token from `getState().user.userInfo` and uses `rejectWithValue`, with the same error-message fallback chain as `userSlice`.
  - `addBookmark` and `removeBookmark` use `condition` to skip when `pending[id]` is set (AC-5, belt-and-braces with the disabled button).
- **Optimistic reducers (AC-4):**
  - **add:** on `pending`, set `ids[id]` and `pending[id]`. On `fulfilled`, clear pending. On `rejected`, delete `ids[id]` and clear pending.
  - **remove:** on `pending`, delete `ids[id]`, splice from `items`, and stash the removed item and its index in a module-level map keyed by `requestId`. On `rejected`, restore `ids[id]` and re-insert the item at its index.
- **Reset:** `addCase(logout, () => initialState)`, importing `logout` from `userSlice` (AC-12).
- **Selectors, null-safe (AC-14):** `selectIsBookmarked`, `selectIsBookmarkPending`, `selectBookmarks`, `selectBookmarksStatus`.

### F2. Register
- **Edit** `devanswers-frontend/src/store.js`: add `bookmark: bookmarkReducer`.

## Phase G: Frontend service

### G1. Config + service
- **Edit** `devanswers-frontend/src/config/config.js`: add `BOOKMARK_API` (`LIST`, `IDS`, `ADD(id)`, `REMOVE(id)`).
- **Create** `devanswers-frontend/src/services/bookmarkService.js`:
  - `getBookmarks(token)`
  - `getBookmarkIds(token)`
  - `addBookmark(questionId, token)`, which sends `PUT` with an empty body
  - `removeBookmark(questionId, token)`

  All use `axiosInstance` with an explicit Bearer header and return `res.data.data`.

## Phase H: Components

### H1. `BookmarkButton`
- **Create** `devanswers-frontend/src/components/Shared/BookmarkButton.jsx`, with props `question`, `className`, `size` and `variant`.
- **Behaviour (spec §6.3):**
  - selectors drive `FaBookmark` vs `FaRegBookmark`
  - `aria-pressed`, a contextual `aria-label` and `title`, and `disabled` while pending
  - the click handler calls `preventDefault` and `stopPropagation`; logged out shows the alert and returns (AC-10)
  - otherwise dispatch add or remove, then `.unwrap()` and `alert()` the message on failure, matching `QuestionCard`'s vote error handling
- Styling: reuse the colour variables from `VoteButtons`, and add a small `BookmarkButton.css` only if needed.

### H2. `QuestionList` / `QuestionFilterBar` props
- **Edit** `devanswers-frontend/src/components/Question/QuestionFilterBar.jsx`: accept an optional `options` prop, defaulting to `SORT_OPTIONS`.
- **Edit** `devanswers-frontend/src/components/Question/QuestionList.jsx`:
  - accept optional `sortOptions`, `defaultSort`, `emptyTitle` and `emptyHint`, with defaults equal to today's values
  - add a `'saved'` case to the sort `switch` (`bookmarkedAt` desc)
  - show `emptyTitle` and `emptyHint` only when `questions.length === 0`; when a search filters everything out, keep the existing text (spec §6.7)

## Phase I: Wire-up

### I1. Placement
- **Edit** `devanswers-frontend/src/components/Question/QuestionCard.jsx`: add `<BookmarkButton>` in the stats column under the answer count (AC-3).
- **Edit** `devanswers-frontend/src/components/Question/QuestionContent.jsx`: add `<BookmarkButton>` in the header card, right-aligned with the title (AC-3).

### I2. Startup load
- **Edit** `devanswers-frontend/src/App.jsx`: add `useSelector` and `useDispatch`, plus a `useEffect` keyed on `userInfo?.token` that dispatches `fetchBookmarkIds()` when a token is present (AC-11).

### I3. Saved Questions section
- **Edit** `devanswers-frontend/src/pages/Profile/Profile.jsx`:
  - new section below Activity Stats, inside the same `!isEditing` guard
  - a `useEffect` dispatches `fetchBookmarks()` when authenticated
  - `Spinner` while pending; `Alert` with a Retry button that re-dispatches on rejected
  - otherwise `<QuestionList questions={bookmarks} sortOptions=… defaultSort="saved" emptyTitle=… emptyHint=… />` (AC-8, AC-9)

## Phase J: Frontend tests

### J1. MSW
- **Edit** `devanswers-frontend/tests/mocks/mockData.js`: add `mockBookmarkedQuestions`, each with `bookmarkedAt` and `answerCount`.
- **Edit** `devanswers-frontend/tests/mocks/handlers.js`:
  - handlers for `GET /bookmarks`, `GET /bookmarks/ids`, `PUT /bookmarks/:id` and `DELETE /bookmarks/:id`, backed by a module-level in-memory store
  - return 401 when the `Authorization` header is missing
  - export `resetBookmarkStore()`
- **Edit** `devanswers-frontend/tests/setup.js`: call `resetBookmarkStore()` in `afterEach` (Finding 4).

### J2. New tests
| File | Cases |
| --- | --- |
| `tests/unit/reducers/bookmarkSlice.test.js` | Optimistic add and remove, and rollback restoring the item at its index (AC-4). Pending flags and the `condition` skip (AC-5). Logout reset (AC-12). Selectors with no `bookmark` slice (AC-14). |
| `tests/unit/components/BookmarkButton.test.jsx` | Icon and `aria-pressed` by state. Dispatch on click. Logged out: alert and no request (AC-10). Disabled while pending. Error alert on 500. Parent `Link` not triggered. |
| `tests/integration/bookmarkFlow.test.jsx` | Render `App` with a real store and stored `userInfo`: `GET /bookmarks/ids` is called once and the home cards show as bookmarked (AC-11). Bookmark on home, navigate to `/profile`, and it is listed. Logout clears the state. Uses `pushState` routing (Finding 5). |

### J3. Updated tests
| File | Change |
| --- | --- |
| `tests/unit/components/QuestionCard.test.jsx`, `QuestionContent.test.jsx` | The control renders and reflects store state (AC-3). |
| `tests/unit/components/QuestionList.test.jsx` | New props. `'saved'` sort. Empty text vs search-miss text. Default regression. |
| `tests/unit/pages/profile.test.jsx` | Store gains the `bookmark` reducer for the new cases: list, empty state, spinner, error with retry, hidden while editing, unbookmark removes the card (AC-8, AC-9). Existing cases are untouched. |
| `tests/unit/store/store.test.js` | Store has a `bookmark` slice. |

**Checkpoint:** run `cd devanswers-frontend && npm test && npm run lint`. All green, with **no edits** to the existing custom-store tests (`home`, `questionDetail`, …) (AC-14).

## Phase K: Docs & final verification

### K1. Docs
- **Edit** `CLAUDE.md`. Add:
  - the `/api/bookmarks` router (all routes authenticated)
  - the `Bookmark` model
  - the `withAnswerCounts` helper
  - the `bookmark` slice and its logout reset
  - the startup fetch in `App.jsx`
  - the MSW `resetBookmarkStore` convention

### K2. Manual check (spec §9.4)
- Run `npm run dev` in both apps and walk through the six-step manual check.
- The `verify` skill was removed from `.claude/`, so this is a manual dev run.

---

## Task checklist

**Backend**
- [ ] A1: Create `Bookmark` model, import it in `app.js`, clear it in `populate-db.js`
- [ ] B1: Extract `withAnswerCounts` and use it in `questionService` and `tagService` (suite stays green)
- [ ] B2: Create `bookmarkService` (list, ids, add/upsert, remove, cascade helper)
- [ ] B3: Cascade bookmark delete in `deleteQuestionService`
- [ ] C1: Create `bookmarkController` (4 handlers)
- [ ] D1: Create `routes/bookmarks.js` with `router.use(authenticate)`
- [ ] D2: Mount `/bookmarks` in `routes/index.js`
- [ ] E1: `bookmarkService.test.js` (unit)
- [ ] E2: `bookmarkController.test.js` (unit)
- [ ] E3: Mock `Bookmark` in `questionService.test.js`, add a cascade assertion
- [ ] E4: `bookmarks.test.js` (integration) and the cascade case in `questions.test.js`
- [ ] ✅ Backend checkpoint: `npm test` green

**Frontend**
- [ ] F1: Create `bookmarkSlice` (thunks, optimistic reducers, logout reset, null-safe selectors)
- [ ] F2: Register `bookmark` in `store.js`
- [ ] G1: Add `BOOKMARK_API` to `config.js` and create `services/bookmarkService.js`
- [ ] H1: Create `BookmarkButton.jsx`
- [ ] H2: Add optional props to `QuestionList` and `QuestionFilterBar` (`'saved'` sort, empty text)
- [ ] I1: Add `BookmarkButton` to `QuestionCard` and `QuestionContent`
- [ ] I2: Fetch bookmark IDs on startup and login in `App.jsx`
- [ ] I3: Add the Saved Questions section to `Profile.jsx`
- [ ] J1: MSW bookmark handlers, `resetBookmarkStore`, fixtures, setup hook
- [ ] J2: `bookmarkSlice.test.js`, `BookmarkButton.test.jsx`, `bookmarkFlow.test.jsx`
- [ ] J3: Update `QuestionCard`, `QuestionContent`, `QuestionList`, `profile` and `store` tests
- [ ] ✅ Frontend checkpoint: `npm test` and `npm run lint` green, existing custom-store tests unedited

**Wrap-up**
- [ ] K1: Update `CLAUDE.md`
- [ ] K2: Manual end-to-end check (spec §9.4)
- [ ] Every AC-1 to AC-14 is covered by at least one passing test
