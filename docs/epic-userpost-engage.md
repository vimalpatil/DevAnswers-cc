# Epic: User Post Management & Engagement

Two features that let users manage the content they create and keep track of the content they care about:

1. **Bookmarks:** save questions, manage them from the profile, jump back to them.
2. **Edit User Posts:** authors edit their own questions and answers, with edit metadata and optional history.

This plan is based on the current codebase (Express 5 + Mongoose backend, React 19 + Redux Toolkit frontend). File paths are relative to the repo root.

---

## Current state that matters for this epic

| Area | What exists today | Impact |
| --- | --- | --- |
| Auth | `authenticate` middleware sets `req.user = { id, isAdmin }`. There is no "optional auth", so public routes never know who is calling. | Per-user flags (for example "is bookmarked") can't ride on the public `GET /api/questions/:id`. |
| Ownership | Services check `author === req.user.id \|\| req.user.isAdmin` (`questionService.js:105`, `answerService.js:44`). | This is **author-or-admin**, not author-only. See Decision 1. |
| Edit endpoints | `PUT /api/questions/:id` and `PUT /api/answers/:answerId` already exist and are tested. | Backend editing exists. The frontend never calls them: no service functions, thunks, or UI. |
| `updatedAt` | All models use `timestamps: true`. | **Can't be used as "last edited".** Viewing a question bumps it (`$inc: { views }` via `findByIdAndUpdate`, `questionService.js:32`), and so does voting (`document.save()`, `voteService.js:35`). |
| Question update | `updateQuestionService` calls `tags.trim()` unconditionally (`questionService.js:110`) and returns the question unpopulated. | Omitting `tags` causes a 500, and the response has raw IDs for `author` and `tags`. Both must be fixed before UI work. |
| Question fetch | `GET /api/questions/:id` increments `views` on every call. | Loading an edit form through this endpoint inflates view counts. |
| Delete | `deleteQuestionService` cascades to answers (`questionService.js:156`). | Bookmarks need the same cascade. |
| Frontend auth | Token is passed explicitly into each service call. `userInfo = { token, userId, name }` is in the `user` slice. | New services and thunks follow the same pattern. `VoteButtons` already compares `authorId === userInfo.userId`, so "is author" checks can reuse it. |
| Routers | `/api/auth`, `/questions`, `/answers` and `/tags` are mounted in `src/routes/index.js`. There is no users or me router. | Bookmarks get their own router. |

---

## Feature 1: Bookmarks

**Value proposition:** users can save useful questions and get back to them in one click, which brings them back to the site and gives them a reason to keep an account.

**Scope:** questions only. Answers are reached through their question; bookmarking answers is a possible follow-up.

### Data model

New collection, `src/models/Bookmark.js`:

```js
{
  user:     { type: ObjectId, ref: "User",     required: true },
  question: { type: ObjectId, ref: "Question", required: true },
}, { timestamps: true }   // createdAt = "saved on"
// indexes
{ user: 1, question: 1 }, { unique: true }   // one bookmark per user per question; makes PUT idempotent
{ user: 1, createdAt: -1 }                    // list newest-first
```

A separate collection rather than an array on `User` gives us:

- a "saved on" date for sorting
- room to paginate
- simple cascade deletes
- a `User` document that doesn't grow without bound

### Endpoints

New router `src/routes/bookmarks.js`, mounted at `/api/bookmarks` in `src/routes/index.js`. All routes require `authenticate`.

| Method & path | Purpose | Response `data` |
| --- | --- | --- |
| `GET /api/bookmarks` | The current user's bookmarks, newest first, question populated (title, author name, tags, voteCount, answerCount) | `[{ _id, createdAt, question: {…} }]` |
| `GET /api/bookmarks/ids` | Bookmarked question IDs only, so the UI can show bookmark state on any page | `["<questionId>", …]` |
| `PUT /api/bookmarks/:questionId` | Bookmark a question. Idempotent: returns 200 if already bookmarked. 404 if the question doesn't exist. | `{ questionId, bookmarked: true }` |
| `DELETE /api/bookmarks/:questionId` | Remove a bookmark. Idempotent. | `{ questionId, bookmarked: false }` |

`PUT` and `DELETE` are used instead of a toggle `POST`, because double-clicks and retries can't flip the state the wrong way. The routes follow the existing layering (`bookmarkController` → `bookmarkService`) and the `{ success, message, data }` envelope. `GET /api/bookmarks` must drop entries whose question has been deleted.

Backend changes outside the new files:

- `deleteQuestionService` also runs `Bookmark.deleteMany({ question: id })`.
- `app.js` imports the new model alongside the others.

### Frontend touch points

| File | Change |
| --- | --- |
| `src/config/config.js` | Add `BOOKMARK_API` (`LIST`, `IDS`, `ADD(id)`, `REMOVE(id)`) |
| `src/services/bookmarkService.js` (new) | API wrappers, token passed explicitly |
| `src/reducers/bookmarkSlice.js` (new) | `ids` (lookup set), `items`, `status`. Thunks: `fetchBookmarkIds`, `fetchBookmarks`, `addBookmark`, `removeBookmark` (optimistic, rolled back on failure). Clear on `logout`. |
| `src/store.js` | Register `bookmark` reducer |
| `src/components/Shared/BookmarkButton.jsx` (new) | Toggle icon (`FaBookmark` / `FaRegBookmark`). Prompts login if unauthenticated, like `VoteButtons`. |
| `src/components/Question/QuestionContent.jsx` | Add `BookmarkButton` in the header |
| `src/components/Question/QuestionCard.jsx` | Add `BookmarkButton` on list cards |
| `src/pages/Profile/Profile.jsx` | New "Bookmarks" section: list with link to `/question/:id`, saved-on date, remove button, empty state |
| `src/components/Navbar/Navbar.jsx` or `BaseLayout` | Dispatch `fetchBookmarkIds` once after login or on app load when authenticated |
| `tests/mocks/handlers.js`, `mockData.js` | MSW handlers and fixtures for the 4 endpoints |

### Tests

- **Backend:** service unit tests, plus integration tests covering idempotent `PUT`/`DELETE`, 401 without a token, 404 for an unknown question, the unique index, cascade delete, and that users only see their own bookmarks.
- **Frontend:** slice tests (optimistic update and rollback), `BookmarkButton` tests, and a Profile bookmarks section test.

### Complexity: **Medium** (roughly 2–3 dev-days)

All new code follows existing patterns. The only moving parts are optimistic UI state and the profile list.

---

## Feature 2: Edit User Posts

**Value proposition:** authors can fix mistakes and improve their questions and answers after posting, which raises content quality without the delete-and-repost workaround that loses votes and answers.

### Decisions needed

1. **Author-only vs author-or-admin.** The epic says author-only, but the existing `PUT` endpoints also allow admins. Options:
   - (a) restrict edits to authors and keep admin rights for delete only, or
   - (b) keep admin edits as moderation and record who edited (`editedBy`).

   **Recommendation: (a).** It matches the requirement and keeps the semantics simple. The ownership check moves into one small helper (`assertAuthor(doc, user)`) used by both update services, so it can't drift.
2. **Edit history: now or later.** History is "if appropriate". **Recommendation:** ship edit metadata in this epic and treat history as a separable phase 2 (below), since it adds a collection and two endpoints but no new UI on the critical path.

### Data model

Add to both `Question` and `Answer`:

```js
editedAt:  { type: Date,     default: null },   // set only by the edit endpoints
editedBy:  { type: ObjectId, ref: "User", default: null },
editCount: { type: Number,   default: 0 },
```

Use `editedAt`, not `updatedAt`, for "edited …" in the UI, because views and votes also change `updatedAt` (see Current state).

**Phase 2, edit history.** New collection `src/models/PostRevision.js`:

```js
{
  postType: { type: String, enum: ["Question", "Answer"], required: true },
  post:     { type: ObjectId, refPath: "postType", required: true },
  editedBy: { type: ObjectId, ref: "User", required: true },
  previous: { title, description, tags: [ObjectId], answerText },  // snapshot before the edit
}, { timestamps: true }
// index { post: 1, createdAt: -1 }
```

The update services write a revision snapshot before applying changes. A separate collection keeps documents small and history unbounded. Delete cascades must also remove revisions.

### Endpoints

Existing endpoints, hardened:

| Method & path | Changes |
| --- | --- |
| `PUT /api/questions/:id` | Author-only (Decision 1). Accept partial bodies: only update fields present. Fixes the `tags.trim()` crash. Validate non-empty `title` and `description` (400). No-op if nothing changed. Set `editedAt`, `editedBy`, `$inc editCount`. Return the question **populated** (`author`, `tags`) so the UI can render it directly. |
| `PUT /api/answers/:answerId` | Author-only. Validate non-empty `answerText`. Set edit metadata. Already returns a populated answer. |

New endpoints, phase 2 only:

| Method & path | Purpose |
| --- | --- |
| `GET /api/questions/:id/revisions` | Revision list for a question (public, like the question) |
| `GET /api/answers/:answerId/revisions` | Revision list for an answer |

Loading the edit form must not go through `GET /api/questions/:id`, because that increments views. Prefer pre-filling from `state.question.currentQuestion`, since the user reaches edit from the detail page. On a hard refresh of the edit URL, either accept the extra view or add a `?noView=1` flag. **Recommendation:** pre-fill from the store and fall back to the normal fetch.

Concurrency is last-write-wins. Only the author can edit, so conflicts are limited to the same user editing in two tabs, which is acceptable for now.

### Frontend touch points

| File | Change |
| --- | --- |
| `src/config/config.js` | `QUESTION_API.UPDATE` and `ANSWER_API.UPDATE` already exist. Add `REVISIONS` in phase 2. |
| `src/services/questionService.js` | Add `updateQuestion(id, data, token)` |
| `src/services/answerService.js` | Add `updateAnswer(answerId, answerText, token)` |
| `src/reducers/questionSlice.js` | Thunks `editQuestion` and `editAnswer`. Reducers replace `currentQuestion` fields, the matching item in `questions`, and the matching entry in `currentQuestion.answers`. |
| `src/pages/Question/PostQuestion.jsx` | Turn into a shared create/edit form: edit mode when `:id` is present. Pre-fill title, description and tags (tags joined to a comma string, which is what the API expects). Submit dispatches `editQuestion`. Keep the AI "Improve" feature working in both modes. |
| `src/App.jsx` | New route `/question/:id/edit` inside `SideBarLayout` |
| `src/components/Question/QuestionContent.jsx` | Show an "Edit" button when `question.author._id === userInfo.userId`. Add "edited {formatDate(editedAt)}" next to "Asked …". |
| `src/components/Answer/AnswerList.jsx` | Per-answer "Edit" for the author, as an inline textarea with Save and Cancel (no new route). Add an "edited …" label. |
| `tests/mocks/handlers.js`, `mockData.js` | `PUT` handlers for questions and answers. Add `editedAt` to fixtures. |
| Phase 2 | `RevisionHistory` component, a modal or collapsible list opened from the "edited …" label |

### Tests

- **Backend:** update the existing service and integration tests for author-only rules: an admin gets 403 under Decision (a). Add tests for:
  - partial bodies
  - validation errors (400)
  - edit metadata being set
  - views and votes leaving `editedAt` unchanged
  - the populated response
  - phase 2: revision snapshots and the cascade on delete
- **Frontend:**
  - edit button visibility (author vs non-author vs logged out)
  - edit-mode pre-fill and submit
  - inline answer edit save and cancel
  - slice reducers for edit success

### Complexity

| Part | Size | Notes |
| --- | --- | --- |
| Backend hardening + metadata | **Small** (~1 day) | Endpoints exist. Validation, partial updates, author-only check, metadata. |
| Frontend editing (question + answer) | **Medium** (~2–3 days) | Refactoring `PostQuestion` into a dual-mode form is the largest piece, plus inline answer editing. |
| Phase 2: edit history | **Medium** (~2 days) | New model, snapshot writes, 2 endpoints, history UI. |
| **Total** | **Medium** without history, **Medium–Large** with history | |

---

## File overlap between the features

These files are touched by **both** features. Sequence the work or have one owner for them to avoid merge conflicts:

| File | Bookmarks | Edit Posts |
| --- | --- | --- |
| `devanswers-backend/src/services/questionService.js` | `deleteQuestionService` cascades to bookmarks | `updateQuestionService` rewrite. Phase 2: revision cascade in delete. |
| `devanswers-backend/src/app.js` | Import `Bookmark` model | Phase 2: import `PostRevision` model |
| `devanswers-backend/tests/integration/questions.test.js` | Delete cascade test | Update/edit tests |
| `devanswers-frontend/src/components/Question/QuestionContent.jsx` | Bookmark button in header | Edit button + "edited" label in header and meta row (**highest conflict risk**: same header block) |
| `devanswers-frontend/src/config/config.js` | `BOOKMARK_API` | Phase 2: `REVISIONS` |
| `devanswers-frontend/tests/mocks/handlers.js` / `mockData.js` | Bookmark handlers and fixtures | `PUT` handlers, `editedAt` fixtures |
| `CLAUDE.md` | New router and slice | Ownership rule and `editedAt` vs `updatedAt` |

These files are touched by one feature only, with no conflict:

- **Bookmarks:** `Bookmark.js`, the bookmark router, controller and service, `bookmarkSlice.js`, `bookmarkService.js`, `BookmarkButton.jsx`, `store.js`, `QuestionCard.jsx`, `Profile.jsx`, `routes/index.js`
- **Edit Posts:** `Question.js`, `Answer.js`, `answerService.js` (both backend and frontend), `questionSlice.js`, frontend `questionService.js`, `PostQuestion.jsx`, `App.jsx`, `AnswerList.jsx`

## Suggested order

1. **Edit Posts: backend hardening.** It fixes the existing `tags.trim()` crash and the unpopulated response, and it is small.
2. **Bookmarks: backend.** It is independent apart from the one-line cascade in `deleteQuestionService`, so it can run in parallel with step 1 if someone owns `questionService.js`.
3. **Edit Posts: frontend**, then **Bookmarks: frontend**. Doing them one after the other avoids a conflict in the `QuestionContent.jsx` header.
4. **Edit history (phase 2)**, if it is still wanted.
