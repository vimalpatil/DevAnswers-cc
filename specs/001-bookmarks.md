# Spec 001: Bookmarks

- **Status:** Draft
- **Epic:** [User Post Management & Engagement](../docs/epic-userpost-engage.md), Feature 1
- **Decisions (confirmed):**
  - Saved Questions is a **section on `/profile`**, not a new route.
  - It **reuses `QuestionList`** (which renders `QuestionCard`).
  - Logged-out users **see the control and get a login prompt** on click, the same as `VoteButtons`.

---

## 1. Problem / motivation

DevAnswers has no way to keep track of a question. A user who finds a useful question, or one they want to come back to once it has answers, has to search for it again. Bookmarks give authenticated users a private, persistent list of saved questions on their profile, which gives them a reason to return and a reason to keep an account.

## 2. User stories

- **US-1:** As an authenticated user, I can bookmark a question from the question list or from the question detail page, so I can find it later.
- **US-2:** As an authenticated user, I can remove a bookmark from the same places, or from my profile.
- **US-3:** As an authenticated user, I can see all my saved questions in a "Saved Questions" section on my profile, and open any of them in one click.
- **US-4:** As an authenticated user, my bookmarks are still there after I log out and back in, or open the app on another device.
- **US-5:** As a logged-out visitor, I can see that bookmarking exists, and I'm told to log in when I try it.

## 3. Acceptance criteria

Each criterion maps to at least one test in §9.

| ID | Criterion |
| --- | --- |
| AC-1 | An authenticated user can bookmark a question via `QuestionCard` and via the question detail view (`QuestionContent`). After the server confirms, the question is in `GET /api/bookmarks` for that user. |
| AC-2 | An authenticated user can remove a bookmark from `QuestionCard`, `QuestionContent`, or the Saved Questions section. Afterwards the question is no longer in `GET /api/bookmarks`. |
| AC-3 | A bookmark control renders on every `QuestionCard` and in the `QuestionContent` header. |
| AC-4 | Clicking the control updates its visual state **immediately, before the API responds** (optimistic). If the request fails, the state reverts and an error message is shown. |
| AC-5 | While a request for a question is in flight, that question's control is disabled, so double-clicks don't send conflicting requests. |
| AC-6 | Bookmarks are stored server-side. After logout then login, or in a fresh browser, the same questions show as bookmarked. Bookmark state is **not** stored in `localStorage`. |
| AC-7 | A user can only read and modify their own bookmarks. No endpoint accepts a user ID; the user always comes from the JWT. User B never sees user A's bookmarks. |
| AC-8 | `/profile` shows a "Saved Questions" section listing the user's bookmarked questions with `QuestionList` and `QuestionCard`. The default order is most recently saved first. |
| AC-9 | With zero bookmarks, the Saved Questions section shows an empty state: "No saved questions yet" plus a hint on how to bookmark. It does not show the home page's "be the first to ask" text. |
| AC-10 | Every `/api/bookmarks` endpoint returns **401** without a valid Bearer token. A logged-out user who clicks a bookmark control gets a login-required prompt, and no request is sent. |
| AC-11 | When the app loads with a stored session, or right after login, the frontend fetches the user's bookmarked question IDs once. Controls on every page then reflect the correct state without fetching again. |
| AC-12 | On logout, all bookmark state in Redux is cleared, so the next user on the same browser sees no bookmarks. |
| AC-13 | When a question is deleted, its bookmarks are deleted too, and it no longer appears in anyone's Saved Questions. |
| AC-14 | Existing component tests that build their own Redux store without a `bookmark` slice keep passing: bookmark selectors handle a missing slice. |

## 4. API contract

New router `src/routes/bookmarks.js`, mounted at `/api/bookmarks` in `src/routes/index.js`. Every route uses `authenticate`. The layering follows the codebase: route → `bookmarkController` → `bookmarkService` → model.

All responses use the standard envelope `{ success, message, data }`. Errors come from `createAppError` through `errorHandler`: `{ success: false, message }`.

### 4.1 `GET /api/bookmarks`

The current user's bookmarked questions, most recently saved first.

- **Auth:** required.
- **200 response:** questions in the same shape as `GET /api/questions` items, plus `bookmarkedAt`:

```json
{
  "success": true,
  "message": "Bookmarks fetched successfully",
  "data": [
    {
      "_id": "665f…",
      "title": "How do I …",
      "description": "…",
      "tags": [{ "_id": "…", "name": "react" }],
      "author": { "_id": "…", "name": "Alice" },
      "voteCount": 3,
      "upvotes": ["…"],
      "downvotes": [],
      "views": 12,
      "answerCount": 2,
      "createdAt": "2026-01-15T12:00:00.000Z",
      "updatedAt": "…",
      "bookmarkedAt": "2026-11-20T09:30:00.000Z"
    }
  ]
}
```

- **Empty:** 200 with `data: []`. This is **not** a 404, unlike `GET /api/questions`.
- Bookmarks whose question no longer exists are left out.
- **Errors:** 401 for a missing or invalid token.

### 4.2 `GET /api/bookmarks/ids`

A lightweight list of the current user's bookmarked question IDs, used at startup to drive control state.

- **Auth:** required.
- **200 response:** `{ "success": true, "message": "Bookmark IDs fetched successfully", "data": ["665f…", "6660…"] }`. Empty is `data: []`.
- **Errors:** 401.

### 4.3 `PUT /api/bookmarks/:questionId`

Bookmark a question. This is **idempotent**: bookmarking an already bookmarked question succeeds with no change.

- **Auth:** required.
- **Body:** none.
- **200 response:** `{ "success": true, "message": "Question bookmarked", "data": { "questionId": "665f…", "bookmarked": true, "bookmarkedAt": "…" } }`. The status is 200 whether the bookmark was created or already existed.
- **Errors:**
  - 400 `"Invalid question ID"`: `questionId` is not a valid ObjectId.
  - 404 `"Question not found"`: the question doesn't exist.
  - 401: missing or invalid token.

### 4.4 `DELETE /api/bookmarks/:questionId`

Remove a bookmark. This is **idempotent**: removing a bookmark that doesn't exist succeeds. It does **not** require the question to exist, so a stale bookmark can always be removed.

- **Auth:** required.
- **200 response:** `{ "success": true, "message": "Bookmark removed", "data": { "questionId": "665f…", "bookmarked": false } }`.
- **Errors:**
  - 400 `"Invalid question ID"`.
  - 401.

### 4.5 Validation & authorization rules

- **Path validation:** `questionId` is checked with `mongoose.Types.ObjectId.isValid` before any query, the same pattern `getUserStats` uses.
- **Identity:** the owning user is always `req.user.id`. No endpoint reads a user ID from params, query, or body. This is what keeps bookmarks private (AC-7).
- **No admin exception:** admins cannot read or modify other users' bookmarks.
- **Own questions:** users may bookmark their own questions.
- **Concurrent creates:** `PUT` is an upsert. A duplicate-key error (E11000) from a concurrent create is treated as success, not a 500.
- **Rate limiting:** the global limiter (100 requests per 15 minutes per IP) applies. No bookmark-specific limit.

### 4.6 Changes to existing endpoints

- **`DELETE /api/questions/:id`:** `deleteQuestionService` also deletes all `Bookmark` documents for that question (AC-13), alongside the existing answer cascade.
- No other existing endpoint changes. `GET /api/questions` and `GET /api/questions/:id` stay public and do **not** gain an `isBookmarked` field. Bookmark state comes from §4.2 instead.

## 5. Data model changes

### 5.1 New model: `devanswers-backend/src/models/Bookmark.js`

```js
const bookmarkSchema = new mongoose.Schema(
  {
    user:     { type: mongoose.Schema.Types.ObjectId, ref: "User",     required: true },
    question: { type: mongoose.Schema.Types.ObjectId, ref: "Question", required: true },
  },
  { timestamps: true } // createdAt is exposed as `bookmarkedAt`
);

bookmarkSchema.index({ user: 1, question: 1 }, { unique: true }); // one bookmark per user per question
bookmarkSchema.index({ user: 1, createdAt: -1 });                 // list newest-saved first
bookmarkSchema.index({ question: 1 });                            // cascade delete by question

const Bookmark = mongoose.model("Bookmark", bookmarkSchema);
export default Bookmark;
```

- `src/app.js` imports `Bookmark` alongside the other models, so it is registered before any `populate()`.

### 5.2 Existing models

No changes to `User`, `Question`, `Answer`, or `Tag`. Bookmarks live in their own collection rather than as an array on `User`, so there's a `bookmarkedAt` per bookmark for sorting, cascade deletes are simple, and `User` documents don't grow without bound.

### 5.3 Seed data (optional)

`src/scripts/populate-db.js` may create a few bookmarks for seeded users. If it does, `clearExistingData` must also clear `Bookmark`.

## 6. UI changes

### 6.1 API config & service

- `src/config/config.js`: add `BOOKMARK_API`:
  - `LIST: "/bookmarks"`
  - `IDS: "/bookmarks/ids"`
  - `ADD: (questionId) => \`/bookmarks/${questionId}\``
  - `REMOVE: (questionId) => \`/bookmarks/${questionId}\``
- New `src/services/bookmarkService.js`: `getBookmarks(token)`, `getBookmarkIds(token)`, `addBookmark(questionId, token)`, `removeBookmark(questionId, token)`. They use `axiosInstance`, pass the token explicitly as an `Authorization: Bearer` header (the existing convention), and return `res.data.data`.

### 6.2 Redux: new `src/reducers/bookmarkSlice.js`

State, all serializable (no `Set`):

```js
{
  ids: {},            // { [questionId]: true }: O(1) lookup for controls
  items: [],          // questions for the Saved Questions section (§4.1 shape)
  pending: {},        // { [questionId]: true } while a PUT or DELETE is in flight
  idsStatus: 'idle',  // 'idle' | 'pending' | 'fulfilled' | 'rejected'
  itemsStatus: 'idle',
  error: null,
}
```

Thunks (`createAsyncThunk`, token read from `getState().user.userInfo`):

| Thunk | Behaviour |
| --- | --- |
| `fetchBookmarkIds` | Fills `ids`. Rejected: `ids` stays empty, `error` set, and the user is **not** logged out (§7). |
| `fetchBookmarks` | Fills `items`. |
| `addBookmark(question)` | **pending:** `ids[id] = true`, `pending[id] = true`. **fulfilled:** clear `pending[id]`. **rejected:** delete `ids[id]`, clear pending, set `error`. |
| `removeBookmark(questionId)` | **pending:** delete `ids[id]`, remove it from `items`, set `pending[id]`. **fulfilled:** clear pending. **rejected:** restore `ids[id]` and the removed item at its original index, clear pending, set `error`. |

- **Reset:** the slice listens for the `user/logout` action (`userSlice.actions.logout`) in `extraReducers` and returns `initialState` (AC-12).
- **Selectors, null-safe for AC-14:**
  - `selectIsBookmarked(state, id)` → `!!state.bookmark?.ids?.[id]`
  - `selectIsBookmarkPending(state, id)` → `!!state.bookmark?.pending?.[id]`
  - `selectBookmarks(state)` → `state.bookmark?.items ?? []`
- **`src/store.js`:** register the `bookmark` reducer.

### 6.3 New component: `src/components/Shared/BookmarkButton.jsx`

- **Props:**
  - `question` (needs `_id`)
  - `className`
  - `size`
  - `variant`: defaults to `"link"`
- Renders `FaBookmark` when bookmarked and `FaRegBookmark` when not, from `react-icons/fa`, which is already a dependency.
- Accessible: `aria-pressed={isBookmarked}`, `aria-label="Bookmark question"` or `"Remove bookmark"`, and a matching `title` tooltip.
- **Click handler:** calls `e.preventDefault()` and `e.stopPropagation()`, as `VoteButtons` does. Then:
  - If unauthenticated: `alert("You must be logged in to bookmark a question.")`, and stop. No dispatch (AC-10).
  - If pending: ignore (AC-5). The button is also `disabled`.
  - Otherwise dispatch `addBookmark` or `removeBookmark`. On a rejected result, show an error alert, the same pattern `QuestionCard` uses for vote failures.

### 6.4 Placement

| Component | Change |
| --- | --- |
| `src/components/Question/QuestionCard.jsx` | Add `<BookmarkButton question={question} />` in the stats column, below the answer count. |
| `src/components/Question/QuestionContent.jsx` | Add `<BookmarkButton question={question} />` in the header card, right-aligned next to the title. |

### 6.5 Startup load: `src/App.jsx`

- A `useEffect` keyed on `userInfo?.token` dispatches `fetchBookmarkIds()` when a token is present.
- It fires once on load when a session is restored from `localStorage`, and again whenever a new login sets a token (AC-11).
- On logout, the token becomes null and the slice resets through the logout listener (§6.2).
- `App` must read `userInfo` via `useSelector`. `App` is already rendered inside `<Provider>` in `main.jsx`.

### 6.6 Saved Questions section: `src/pages/Profile/Profile.jsx`

- New card section titled **"Saved Questions"** below Activity Stats. Like Activity Stats, it is hidden while `isEditing`.
- On mount, when authenticated, it dispatches `fetchBookmarks()`. While loading, it shows a `Spinner`. On error, it shows an `Alert variant="danger"` with a "Retry" button.
- The list is `<QuestionList questions={bookmarks} … />` (AC-8).
- Unbookmarking a card here removes it from the list immediately, through the optimistic `removeBookmark` in §6.2.

### 6.7 `QuestionList` / `QuestionFilterBar` extensions

These are backward compatible: the home page renders unchanged with no new props.

| Component | New optional prop | Default (current behaviour) | Saved Questions value |
| --- | --- | --- | --- |
| `QuestionList` | `sortOptions` | `SORT_OPTIONS` | `[{ value: 'saved', label: 'Recently Saved' }, ...SORT_OPTIONS]` |
| `QuestionList` | `defaultSort` | `'newest'` | `'saved'` |
| `QuestionList` | `emptyTitle` | `"No questions found"` | `"No saved questions yet"` |
| `QuestionList` | `emptyHint` | `"Try adjusting your search or be the first to ask!"` | `"Click the bookmark icon on any question to save it here."` |
| `QuestionFilterBar` | `options` | `SORT_OPTIONS` | passed through from `QuestionList` |

- The `'saved'` sort orders by `bookmarkedAt` descending.
- When search filters out every bookmark, the section shows the home page's text, "No questions found". The "No saved questions yet" text appears only when the user has zero bookmarks.

### 6.8 Routes

No new routes. `/profile` already redirects unauthenticated users to `/login`.

## 7. Edge cases & error handling

| Case | Expected behaviour |
| --- | --- |
| Expired or invalid JWT at startup (`fetchBookmarkIds` gets 401) | `ids` stays empty and controls show "not bookmarked". The user is **not** force-logged-out, matching how the app handles a 401 today. A bookmark click then fails, reverts, and shows the error. |
| Double-click on the control | The second click is ignored while `pending[id]`, and the button is disabled (AC-5). |
| Network error on add or remove | Optimistic state reverts (AC-4). An alert shows the server message or "Failed to update bookmark". |
| Bookmark a question that was deleted meanwhile | `PUT` returns 404. The UI reverts and shows "Question not found". |
| Remove a bookmark whose question was deleted | `DELETE` returns 200 (idempotent, §4.4). |
| Question deleted while bookmarked | Cascade delete (AC-13). `GET /api/bookmarks` also leaves out bookmarks whose question is missing, as a defence. |
| Concurrent `PUT` from two tabs | The unique index plus upsert means one document is created and both requests get 200. |
| Invalid ObjectId in the path | 400 `"Invalid question ID"`. |
| Two users on the same browser | Logout clears the bookmark slice (AC-12). Login triggers a fresh `fetchBookmarkIds` for the new user. |
| Tabs out of sync (bookmark in tab A, tab B still open) | Tab B shows stale state until reload. Cross-tab sync is out of scope (§8). Actions in tab B still succeed because the endpoints are idempotent. |
| Many bookmarks | All are returned (no server pagination, consistent with `GET /api/questions`). `QuestionList` paginates client-side at 5 per page. |

## 8. Out of scope

- Bookmarking answers.
- Bookmark folders, collections, notes, or tags.
- Public, shared, or exported bookmark lists, and showing a question's bookmark count to anyone.
- Server-side pagination or search for bookmarks.
- Cross-tab or real-time sync of bookmark state.
- Global 401 handling, such as auto-logout when the token expires.
- A standalone `/profile/saved` route or a Navbar link (§0 decision).
- Notifications when a bookmarked question gets new answers.

## 9. Test plan

### 9.1 Backend unit tests (`devanswers-backend/tests/unit/`, models mocked with `vi.mock`)

| File | Cases |
| --- | --- |
| `services/bookmarkService.test.js` (new) | add: invalid ID → 400; missing question → 404; creates via upsert; already bookmarked → success; E11000 treated as success. remove: invalid ID → 400; removes; non-existent → success. list: sorted by `createdAt` desc; includes `bookmarkedAt` and `answerCount`; skips null questions. ids: returns string IDs. |
| `controllers/bookmarkController.test.js` (new) | Each handler passes `req.user.id` (never a param or body user) and `req.params.questionId` to the service, returns 200 with the §4 envelope, and propagates service errors. |
| `services/questionService.test.js` (update) | `deleteQuestionService` calls `Bookmark.deleteMany({ question: id })`. |

### 9.2 Backend integration tests (supertest + `mongodb-memory-server`, importing `../setup.js`)

| File | Cases |
| --- | --- |
| `integration/bookmarks.test.js` (new) | AC-10: all 4 endpoints → 401 without a token and with an invalid token. AC-1: `PUT` then `GET /bookmarks` and `GET /bookmarks/ids` include the question; `GET` includes populated `author.name`, `tags`, `answerCount` and `bookmarkedAt`. Idempotency: `PUT` twice gives one document; `DELETE` twice → 200. AC-2: `DELETE` removes it from both lists. AC-8: order is most recently saved first (use explicit timestamps; see the `tags.test.js` flake fix). AC-7: user B's `GET` doesn't include user A's bookmarks, and B's `DELETE` doesn't remove A's. 400 for an invalid ID, 404 when bookmarking a missing question. Empty list → 200 `[]`. Own question can be bookmarked. |
| `integration/questions.test.js` (update) | AC-13: deleting a question removes its bookmarks, and they no longer appear in `GET /api/bookmarks`. |

### 9.3 Frontend tests (Vitest + RTL + MSW)

| File | Cases |
| --- | --- |
| `tests/mocks/handlers.js`, `mockData.js` (update) | Handlers for the 4 endpoints, keeping bookmark IDs in a per-test in-memory store (reset in `afterEach` via `server.resetHandlers`). Fixtures: bookmarked questions with `bookmarkedAt`. |
| `unit/reducers/bookmarkSlice.test.js` (new) | AC-4 optimistic add and remove, plus rollback on rejection (including restoring the item at its index). AC-5 pending flags. AC-12 reset on `user/logout`. AC-14 selectors with no `bookmark` slice return false or `[]`. |
| `unit/components/BookmarkButton.test.jsx` (new) | Filled or outline icon and `aria-pressed` reflect state. Click dispatches add or remove. Logged out: alert and no request (AC-10). Disabled while pending (AC-5). Rejection shows an error alert. Click doesn't trigger a parent `Link` (propagation stopped). |
| `unit/components/QuestionCard.test.jsx`, `QuestionContent.test.jsx` (update) | AC-3: the bookmark control renders and reflects bookmarked state from the store. |
| `unit/components/QuestionList.test.jsx` (update) | New props: custom empty title and hint, custom sort options, `'saved'` sort by `bookmarkedAt`. Defaults are unchanged (home page regression). |
| `unit/pages/profile.test.jsx` (update) | AC-8: the Saved Questions section lists bookmarked questions as cards. AC-9: empty state text. Loading spinner. Error with retry. Hidden while editing. Unbookmarking removes the card. |
| `unit/store/store.test.js` (update) | The store has a `bookmark` slice. |
| `integration/bookmarkFlow.test.jsx` (new) | AC-11: rendering `App` with a stored session calls `GET /bookmarks/ids` once, and controls show the bookmarked state. Login triggers the fetch. Bookmarking on the home page then appears on `/profile`. Logout clears the state. |
| Existing tests with custom stores (`home`, `questionDetail`, `QuestionList`, …) | Must pass **unchanged** (AC-14). |

### 9.4 Manual check (`/verify` or a dev run)

Log in, then:

1. Bookmark from the home page and from a detail page. Each icon fills instantly.
2. Reload. The icons are still filled.
3. Open `/profile`. Both questions are listed, newest saved first.
4. Unbookmark one there. It disappears.
5. Log out and log in as another user. Nothing is bookmarked.
6. Delete a bookmarked question as its author. It disappears from Saved Questions.

## 10. Affected files

**Backend, new:**
- `src/models/Bookmark.js`
- `src/routes/bookmarks.js`
- `src/controllers/bookmarkController.js`
- `src/services/bookmarkService.js`
- `tests/unit/services/bookmarkService.test.js`
- `tests/unit/controllers/bookmarkController.test.js`
- `tests/integration/bookmarks.test.js`

**Backend, modified:**
- `src/app.js`: import the model
- `src/routes/index.js`: mount `/bookmarks`
- `src/services/questionService.js`: delete cascade
- `src/scripts/populate-db.js`: optional seed and clear
- `tests/unit/services/questionService.test.js`
- `tests/integration/questions.test.js`

**Frontend, new:**
- `src/services/bookmarkService.js`
- `src/reducers/bookmarkSlice.js`
- `src/components/Shared/BookmarkButton.jsx`
- `tests/unit/reducers/bookmarkSlice.test.js`
- `tests/unit/components/BookmarkButton.test.jsx`
- `tests/integration/bookmarkFlow.test.jsx`

**Frontend, modified:**
- `src/config/config.js`
- `src/store.js`
- `src/App.jsx`
- `src/components/Question/QuestionCard.jsx`
- `src/components/Question/QuestionContent.jsx`
- `src/components/Question/QuestionList.jsx`
- `src/components/Question/QuestionFilterBar.jsx`
- `src/pages/Profile/Profile.jsx`
- `tests/mocks/handlers.js`
- `tests/mocks/mockData.js`
- `tests/unit/components/QuestionCard.test.jsx`
- `tests/unit/components/QuestionContent.test.jsx`
- `tests/unit/components/QuestionList.test.jsx`
- `tests/unit/pages/profile.test.jsx`
- `tests/unit/store/store.test.js`

**Docs:** `CLAUDE.md`, to cover the bookmarks router, the `bookmark` slice, and the startup fetch in `App.jsx`.

**Conflict note:** `QuestionContent.jsx`, backend `questionService.js`, and the MSW mocks are also touched by Edit User Posts (epic, Feature 2). Land this feature and that one one after the other.
