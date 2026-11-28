# Plan: Spec 002, Edit User Posts

**Spec:** [002-edit-user-posts.md](002-edit-user-posts.md)
**Order:** model → service → controller → route → backend tests → Redux slice → frontend service → components → wire-up → frontend tests.
**Branch:** this should go on its own branch, for example `feature/edit-posts`, in a worktree like `feature/bookmarks`. `QuestionContent.jsx` conflicts with Bookmarks (spec §9).

## Things found in the code that the plan accounts for

1. **Unit tests use IDs that aren't ObjectIds.** For example, `answerService.test.js` uses `'answer123'` and `'nonexistent'`. With the new ID check (spec §5.1 and §5.2) those calls would return 400 before reaching the mocked model. The update-service tests must switch to 24-character hex IDs. Tests for the other services stay as they are.
2. **The `updateQuestionService` unit tests mock `findByIdAndUpdate`** (`questionService.test.js:326–430`). The rewrite uses `findById(...).select(...)` and `findOneAndUpdate(...).populate(...).populate(...)`, so that `describe` block is rewritten rather than patched. The `getQuestionByIdService` tests (lines 139–215) also use `findByIdAndUpdate` and **must not change**.
3. **`QuestionContent.test.jsx` doesn't wrap renders in a Router.** Adding `useNavigate` to `QuestionContent` would break every existing test there, so the plan adds a `MemoryRouter` wrapper in the same step.
4. **`postQuestion.test.jsx` uses `BrowserRouter`,** which can't start on `/question/:id/edit`. The edit-mode tests use `MemoryRouter` with `Routes`, while the create-mode tests stay as they are.
5. **The integration tests contain two "admin can update" tests** (`questions.test.js:332`, `answers.test.js:276`). They flip to expect 403, keeping the same setup.
6. **The existing 403 integration test** sends `tags: 'hack'`. It still gets 403, because ownership is checked before the body (spec §5.1), so it is unchanged.
7. **MSW has no `PUT` handlers** (`tests/mocks/handlers.js`), and `mockData.js` authors are `user-1` (Alice) and `user-2` (Bob). Tests log in as `user-1`, and any question or answer by `user-2` is "not mine".
8. **No frontend test renders `App`.** The `/question/:id/edit` route is exercised through `MemoryRouter` + `Routes` in the page and flow tests. The `App.jsx` change is checked by hand.

---

## Phase A: Model

**A1. Add `editedAt` to both schemas**

- **Edit `devanswers-backend/src/models/Question.js`:**
  - add `editedAt: { type: Date, default: null }`
  - remove the unused `Mongoose` named import
- **Edit `devanswers-backend/src/models/Answer.js`:** add `editedAt: { type: Date, default: null }`.
- No index and no migration (spec §8).

## Phase B: Service

**B1. Tag helper (new)**

- **Create `devanswers-backend/src/services/tagHelper.js`** with two functions:
  - `parseTagNames(input) → string[]` enforces the rules in spec §5.3:
    - the input is a string or an array of strings
    - trim each tag, drop blanks, de-dupe ignoring case
    - 1 to 5 tags, each at most 30 characters
    - throws `createAppError(msg, 400)` with the exact messages from §5.3
  - `resolveTagIds(names) → Promise<ObjectId[]>` finds or creates tags by exact name, in order. The logic is lifted from `updateQuestionService`.
- `createQuestionService` is **not** changed to use it (decision D3).

**B2. Answer update service**

- **Edit `devanswers-backend/src/services/answerService.js`:**
  - import `mongoose`
  - rewrite `updateAnswerService(answerId, answerText, loggedInUser)`. It keeps its signature and runs these steps in order:
    1. `!mongoose.Types.ObjectId.isValid(answerId)` → 400 `Invalid answer ID`
    2. `Answer.findById(answerId).select('author answerText')`; if there is none → 404
    3. `answer.author.toString() !== loggedInUser.id.toString()` → 403 (**the `isAdmin` bypass is removed**)
    4. validate: `typeof answerText === 'string'`, the trimmed text is non-empty, and at most 10,000 characters → 400 with the spec's messages
    5. if the trimmed text equals the stored text → return `Answer.findById(answerId).populate('author', 'name')` and skip the write
    6. otherwise `Answer.findOneAndUpdate({ _id: answerId, author: loggedInUser.id }, { $set: { answerText: trimmed, editedAt: new Date() } }, { new: true, runValidators: true }).populate('author', 'name')`
    7. if the result is `null` → 404
- `deleteAnswerService` is unchanged.

**B3. Question update service**

- **Edit `devanswers-backend/src/services/questionService.js`:**
  - import `parseTagNames` and `resolveTagIds`, and `mongoose` if it isn't already imported
  - rewrite `updateQuestionService(id, { title, description, tags }, loggedInUser)`. This is the **new signature**. It runs these steps:
    1. check the ID → 400 `Invalid question ID`
    2. `Question.findById(id).select('author title description tags')` → 404
    3. author-only check → 403
    4. validate title and description (strings, trimmed, non-empty, at most 200 and 10,000 characters) → 400
    5. `parseTagNames(tags)` → 400
    6. `resolveTagIds(names)`; this is the first call that can write anything
    7. no-op check: trimmed title and description equal the stored values **and** the ordered tag ID strings are equal → return the populated current document
    8. otherwise `Question.findOneAndUpdate({ _id: id, author: loggedInUser.id }, { $set: { title, description, tags: tagIds, editedAt: new Date() } }, { new: true, runValidators: true }).populate({ path: 'author', select: 'name' }).populate('tags')`
    9. a `null` result → 404
  - write a small local helper `findPopulatedQuestion(id)` so the no-op path and the update path return the same shape
- `createQuestionService`, `deleteQuestionService` and `getQuestionByIdService` are unchanged.

## Phase C: Controller

**C1. `devanswers-backend/src/controllers/questionController.js`**

- In `updateQuestion`, change `let` to `const` and call `updateQuestionService(id, { title, description, tags }, req.user)`.
- **`answerController.js`:** no change.

## Phase D: Routes

**D1. Check only.** `PUT /:id` (`routes/questions.js`) and `PUT /:answerId` (`routes/answers.js`) already use `authenticate`, and `/improve` and `/summarize` are still registered first. `routes/index.js` and `app.js` don't change.

**D2. Optional seed.** In `src/scripts/seed-data.js` and populate, set `editedAt` on one question and one answer so the indicator can be checked by hand.

## Phase E: Backend tests

**E1. New `tests/unit/services/tagHelper.test.js`** (mock `Tag.js`):

- **`parseTagNames`:**
  - a string and an array give the same result
  - trimming
  - blanks dropped; `""` and `" , "` → 400
  - case-insensitive de-dupe that keeps the first spelling
  - 5 tags pass, 6 → 400
  - 30 characters pass, 31 → 400
  - a number, an object, or an array containing a non-string → 400
- **`resolveTagIds`:** an existing tag returns its ID without calling `save`, a missing tag is created, and the order is kept.

**E2. Edit `tests/unit/services/answerService.test.js`.** Rewrite `describe('updateAnswerService')` using hex IDs, and mock `findById().select()` and `findOneAndUpdate().populate()`. Cases:

- an author update calls `findOneAndUpdate` with `{ _id, author }` and a `$set` of only `answerText` + `editedAt`
- 403 for a non-author, and **403 for an admin non-author**
- 404 when the answer is missing, 400 for a malformed ID
- 400 for undefined, `""`, `"   "`, a number, or more than 10,000 characters
- a no-op skips `findOneAndUpdate`
- a conditional update that returns `null` → 404

**E3. Edit `tests/unit/services/questionService.test.js`.** Rewrite `describe('updateQuestionService')` (around lines 326–430), mocking `tagHelper.js` with `vi.mock`. Cases:

- an author update with a whitelisted `$set` and `editedAt`, returning a populated result
- 403 for a non-author and for an admin
- 404, and 400 for a malformed ID
- 400 for each title and description failure
- `parseTagNames` throwing → 400, with `resolveTagIds` never called
- a no-op (same values, same tag order) skips the write
- a tag reorder counts as a change
- extra fields (`author`, `voteCount`, `editedAt`) never reach `$set`
- 403 is thrown before body validation: a non-author sending a blank title gets 403

**E4. Edit `tests/unit/controllers/questionController.test.js`.** The `updateQuestion` test asserts the call `(id, { title, description, tags }, req.user)`.

**E5. Edit `tests/integration/questions.test.js`:**

- **Change** "should allow an admin to update any question" so it expects 403 with the message `Not authorized to update this question`, and checks the DB still holds the original title.
- **Extend** the valid-update test:
  - `data.author.name` and `data.tags[0].name` are present
  - `data.editedAt` is set
  - a follow-up `GET` returns the new values
- **Add:**
  - 400 for a malformed ID (`/api/questions/not-an-id`)
  - 400 for a blank or whitespace title and a blank description
  - 400 for zero tags (`" , "`) and for six tags
  - 400 when `tags` is missing (the regression where this returned 500)
  - a request with blank tags creates no new `Tag` documents
  - a no-op `PUT` leaves `editedAt` `null`
  - after a `GET` (view) and an upvote by another user, `editedAt` is still `null`
  - `author` and `voteCount` in the body are ignored

**E6. Edit `tests/integration/answers.test.js`:**

- **Change** the admin test to expect 403 and an unchanged answer.
- **Add:**
  - `editedAt` is set on update
  - 400 for a malformed ID, and 400 for blank or whitespace text
  - a no-op leaves `editedAt` `null`
  - an upvote doesn't set `editedAt`
  - `questionId` in the body is ignored (the answer stays on its original question)

**E7. Run `npm test` in `devanswers-backend`.** Everything must be green, including the existing create, delete and vote suites.

## Phase F: Redux slice

**F1. Edit `devanswers-frontend/src/reducers/questionSlice.js`.** Import `updateQuestion` and `updateAnswer` (from Phase G; write G1 first or in the same step) and add two thunks:

- **`editQuestion({ id, title, description, tags })`** follows the same token and `rejectWithValue` pattern as `voteQuestion`. Its `fulfilled` case:
  - if `currentQuestion?._id === payload._id`, assign `title`, `description`, `tags`, `editedAt` and `updatedAt`, leaving `answers` and votes alone
  - if the question is in `questions[]`, assign the same fields to that entry
- **`editAnswer({ answerId, answerText })`.** Its `fulfilled` case finds `currentQuestion.answers[i]._id === payload._id` and assigns `answerText`, `editedAt` and `updatedAt`.
- **Don't add `pending` or `rejected` cases** for either thunk (spec §6.3). They must never touch `loading` or `error`.

## Phase G: Frontend services

**G1. Edit `devanswers-frontend/src/services/questionService.js`.** Add `updateQuestion(id, { title, description, tags }, token)` that calls `axiosInstance.put(QUESTION_API.UPDATE(id), …, Bearer)` and returns `res.data.data`.

**G2. Edit `devanswers-frontend/src/services/answerService.js`.** Add `updateAnswer(answerId, answerText, token)` that calls `axiosInstance.put(ANSWER_API.UPDATE(answerId), { answerText }, Bearer)` and returns `res.data.data`.

- **`config.js`:** no change, because `UPDATE` already exists in both API objects.

## Phase H: Components

**H1. New `devanswers-frontend/src/components/Shared/EditedIndicator.jsx`**

- `EditedIndicator({ editedAt, className })` returns `null` when `editedAt` is falsy.
- Otherwise it renders `<span className="text-muted small …" title={localeString}>edited {formatDate(editedAt)}</span>`.

**H2. New `devanswers-frontend/src/utils/postValidation.js`**, holding client-side checks that mirror the server:

- `validateQuestionForm({ title, description, tags }) → { title?, description?, tags? }`, an error-message map
- `validateAnswerText(text) → string | null`
- `parseTagInput(str) → string[]`, using the same trim, de-dupe, 1–5 and 30-character rules

These are kept separate so the tests and both forms share one implementation.

**H3. Edit `devanswers-frontend/src/components/Question/QuestionContent.jsx` (+ `QuestionContent.css`):**

- add `useSelector(state => state.user.userInfo)`, `useNavigate` and `FaPen`
- compute `isAuthor = !!userInfo && question.author?._id === userInfo.userId`
- **header:** wrap the title in `d-flex justify-content-between align-items-start gap-2`
  - when `isAuthor`, add `<Button variant="link" aria-label="Edit question" title="Edit question" className="qcontent-edit-btn">` with `FaPen`
  - clicking it calls `navigate(`/question/${question._id}/edit`)`
  - leave room in that action group for the Bookmarks button (spec §9)
- **meta row:** after "Asked …", add `<EditedIndicator editedAt={question.editedAt} />`
- **CSS:** add a `.qcontent-edit-btn` style with a muted colour that turns to the accent colour on hover, and works in dark mode

**H4. Edit `devanswers-frontend/src/components/Answer/AnswerList.jsx` (+ `AnswerList.css`).** Optionally extract `AnswerItem.jsx`; do it if `AnswerList` gets past about 200 lines.

- **State:**
  - `editingId`, `draft`
  - `saving`
  - `fieldError`, `serverError`
- **Handlers:**
  - `startEdit(answer)` sets `editingId` and `draft = answer.answerText` and clears the errors. Opening a different answer replaces the current editor.
  - `cancelEdit()` resets the state and is disabled while `saving`.
  - `saveEdit(answer)`:
    1. runs `validateAnswerText`; if that fails, sets `fieldError` and stops
    2. sets `saving`
    3. calls `await dispatch(editAnswer({ answerId, answerText: draft })).unwrap()`
    4. on success → `cancelEdit()`; on failure → `setServerError(msg)`
    5. finally clears `saving`
- **Render, per answer:**
  - when `answer.author?._id === userInfo?.userId`, a pencil `Button variant="link" aria-label="Edit answer"` goes in `.alist-meta`
  - in edit mode:
    - a `Form.Control as="textarea"` with `isInvalid={!!fieldError}` and a `Form.Control.Feedback`
    - an `Alert variant="danger"` for `serverError`
    - a **Save** button that reads "Saving…" while saving and is disabled
    - a **Cancel** button
    - the textarea is `readOnly` while saving
  - `<EditedIndicator editedAt={answer.editedAt} />` goes after the date

**H5. Edit `devanswers-frontend/src/pages/Question/PostQuestion.jsx` (+ `PostQuestion.css`)**

- Add a `mode = 'create'` prop. When `mode === 'edit'`:
  - **Reading state:** `const { id } = useParams()`, and select `currentQuestion`, `loading` and `error` from `state.question`.
  - **Loading:** a `useEffect` dispatches `fetchQuestionById(id)` if `currentQuestion?._id !== id`.
  - **Pre-fill:** a `prefilledRef` makes this run once. When `currentQuestion?._id === id`, set `title`, `description`, and `tags = currentQuestion.tags.map(t => t.name).join(', ')`.
  - **Guards** (spec AC-9):
    - no `userInfo` → `<Navigate to="/login" replace />`
    - loading → a spinner
    - an error or no question → "Question not found"
    - `currentQuestion.author?._id !== userInfo.userId` → an `Alert` reading "You can only edit your own questions", with a `Link` back to the question
  - **State:**
    - `fieldErrors`
    - `serverError`
    - `saving`
  - **`handleSubmit` (edit):**
    1. `preventDefault`
    2. run `validateQuestionForm`; if there are errors, set them and stop
    3. set `saving`
    4. `await dispatch(editQuestion({ id, title, description, tags })).unwrap()`
    5. on success: `navigate(`/question/${id}`, { state: { fromEdit: true } })`
    6. on failure: `setServerError(msg)` (a 401 gets the session-expired text and a login link)
    7. finally clear `saving`
  - **Rendering:**
    - the heading reads "Edit question"
    - the submit button reads "Save changes" or "Saving…"
    - a Cancel button calls `navigate(`/question/${id}`)` and is disabled while saving
    - inputs get `isInvalid` and `Form.Control.Feedback`, and are `readOnly` while saving
    - AI Improve is kept
- **Create mode** keeps its current behaviour, including the `alert()` calls. Branch inside `handleSubmit`, or split it into `handleCreate` and `handleEdit`.

## Phase I: Wire-up

**I1. Edit `devanswers-frontend/src/App.jsx`.** Add `<Route path='/question/:id/edit' element={<PostQuestion mode="edit" />} />` inside the `SideBarLayout` group.

**I2. Edit `devanswers-frontend/src/pages/Question/QuestionDetail.jsx`:**

- add `useLocation` and `useNavigate`
- in the fetch effect:
  - `if (location.state?.fromEdit && currentQuestion?._id === id)`: skip the fetch, then call `navigate(location.pathname, { replace: true, state: null })`
  - otherwise dispatch as now
- keep the effect's dependencies lint-clean, reading `currentQuestion` through a ref if needed, so it doesn't refetch every time the store changes

**I3. Edit `CLAUDE.md`.** Add the three bullets from spec §12:

- edits are author-only, while deletes are author-or-admin
- use `editedAt`, not `updatedAt`
- edit thunks must not touch the shared `loading`

## Phase J: Frontend tests

**J1. Edit `devanswers-frontend/tests/mocks/mockData.js`.** Give `question-2` and `mockAnswers[0]` an `editedAt` ISO string, and set `editedAt: null` on the rest.

**J2. Edit `devanswers-frontend/tests/mocks/handlers.js`.** Add:

- **`http.put(`${BASE_URL}/questions/:id`)`:**
  - 401 without a Bearer header
  - 404 for an unknown ID
  - 403 when the fixture author is `user-2`
  - 400 for a blank title or description
  - otherwise 200 with the fixture merged with the body, tags mapped to `{ _id, name }`, and `editedAt: new Date().toISOString()`
- **`http.put(`${BASE_URL}/answers/:answerId`)`:** the same rules for `answerText`.

**J3. New `tests/unit/components/EditedIndicator.test.jsx`:**

- `null` and `undefined` render nothing
- a date renders "edited …" with a `title` attribute

**J4. New `tests/unit/utils/postValidation.test.js`:** cases matching E1, run on the client helpers.

**J5. Edit `tests/unit/components/QuestionContent.test.jsx`:**

- **wrap every existing render in `MemoryRouter`** (see finding 3) and mock `useNavigate`
- **add:**
  - the pencil shows for the author (`userId` matches `question.author._id`)
  - it's hidden for a non-author and when `userInfo` is null
  - clicking it calls `navigate('/question/<id>/edit')`
  - the indicator shows or is absent depending on `editedAt`

**J6. Edit `tests/unit/components/AnswerList.test.jsx`.** Use a real `questionReducer` (or a stub that spies on dispatch) with `currentQuestion` seeded. Cases:

- the pencil shows only on `user-1`'s answers
- clicking it shows a pre-filled textarea
- Cancel restores the text, and no `PUT` is sent (MSW spy)
- a blank draft shows the inline error with no request
- Save shows "Saving…", then the new text, and edit mode closes
- the 403 handler shows an inline alert and keeps the draft
- opening a second answer's editor closes the first
- the indicator shows or hides

**J7. Edit `tests/unit/pages/postQuestion.test.jsx`.** Leave the create-mode tests alone and add a `describe('edit mode')` with a `MemoryRouter` at `/question/question-1/edit` plus `Routes`. Cases:

- the form is pre-filled from the store
- with an empty store, it pre-fills after the MSW `GET`
- tags are joined as `"a, b"`
- each invalid field shows its inline error and sends no request
- Save sends the `PUT`, and `navigate` is called with `('/question/question-1', { state: { fromEdit: true } })`
- the "Saving…" state disables the buttons
- Cancel navigates back without a `PUT`
- a server 403 or 400 shows an inline `Alert`
- a non-author (`question-2`, by `user-2`) sees the guard message
- a null `userInfo` redirects to `/login`

**J8. Edit `tests/unit/pages/questionDetail.test.jsx`:**

- with `initialEntries=[{ pathname: '/question/q1', state: { fromEdit: true } }]` and the store holding `q1`, `fetchQuestionById` isn't dispatched (spy on dispatch, or count MSW `GET`s)
- without that state, it's dispatched as now

**J9. Edit `tests/unit/reducers/questionSlice.test.jsx`:**

- `editQuestion.fulfilled` merges into `currentQuestion`, keeps `answers`, and updates the matching `questions[]` entry
- `editAnswer.fulfilled` replaces the right answer only
- the `pending` and `rejected` actions of both thunks leave `loading` and `error` unchanged

**J10. List views never show edit controls (AC-2).** Edit `QuestionCard.test.jsx`, `QuestionList.test.jsx`, `pages/home.test.jsx` and `pages/profile.test.jsx`, each with the user as the author: `queryByRole('button', { name: /edit (question|answer)/i })` is null.

**J11. New `tests/integration/editFlow.test.jsx`.** Use a real `question` + `user` store logged in as `user-1`, a `MemoryRouter`, and `Routes` for `/question/:id` and `/question/:id/edit`. Count `GET /questions/:id` calls through MSW `server.events` or a wrapping handler. Three scenarios:

- **Question flow:** click the pencil, check the pre-fill, change the title and tags, save, and check:
  - the detail page shows the new title and tags plus "edited"
  - the `GET` count didn't go up after saving
- **Answer flow:** edit your own answer inline, save, and see the new text plus "edited".
- **Unauthorized:**
  - on `question-2` (by `user-2`), no pencils render
  - going straight to `/question/question-2/edit` shows the guard message
  - `store.dispatch(editQuestion({ id: 'question-2', … }))` rejects with "Not authorized…" and the store is unchanged

**J12. Run checks in `devanswers-frontend`:**

- `npm test`, all green
- `npm run lint`, clean
- by hand: run both apps and walk through the DoD in spec §14, in light and dark mode and at phone width

---

## Checklist

**Backend**

- [ ] A1: add `editedAt` to `Question.js` and `Answer.js`, and drop the unused `Mongoose` import
- [ ] B1: create `services/tagHelper.js` (`parseTagNames`, `resolveTagIds`)
- [ ] B2: rewrite `answerService.updateAnswerService` (ID check, author-only, validation, no-op, conditional `findOneAndUpdate`)
- [ ] B3: rewrite `questionService.updateQuestionService` with the new object signature, the tag helper, no-op detection and a populated response
- [ ] C1: change `questionController.updateQuestion` to pass `{ title, description, tags }`
- [ ] D1: confirm the routes and middleware order are unchanged
- [ ] D2: (optional) seed one edited question and one edited answer
- [ ] E1: write `tagHelper.test.js`
- [ ] E2: rewrite the `updateAnswerService` unit tests with hex IDs and add the admin-403 case
- [ ] E3: rewrite the `updateQuestionService` unit tests, leaving the `getQuestionById` tests alone
- [ ] E4: update the `updateQuestion` controller unit test
- [ ] E5: in `questions.test.js`, flip the admin test and add validation, no-op, view/vote, populate and mass-assignment tests
- [ ] E6: in `answers.test.js`, flip the admin test and add validation, no-op, vote and `questionId` tests
- [ ] E7: backend `npm test` green

**Frontend**

- [ ] G1: `questionService.updateQuestion`
- [ ] G2: `answerService.updateAnswer`
- [ ] F1: `editQuestion` and `editAnswer` thunks with fulfilled-only reducers (no `loading` or `error`)
- [ ] H1: `Shared/EditedIndicator.jsx`
- [ ] H2: `utils/postValidation.js`
- [ ] H3: `QuestionContent`, adding the author pencil, the navigate call and the indicator (plus CSS)
- [ ] H4: `AnswerList`, adding inline edit, Save/Cancel, saving and error states, and the indicator (plus CSS)
- [ ] H5: `PostQuestion` edit mode, with pre-fill, guards, inline validation, saving state, Cancel and navigation using `fromEdit`
- [ ] I1: `App.jsx` route `/question/:id/edit`
- [ ] I2: make `QuestionDetail` skip the refetch when `fromEdit`
- [ ] I3: `CLAUDE.md` notes
- [ ] J1: `mockData.js` `editedAt` fixtures
- [ ] J2: `handlers.js` `PUT` handlers for questions and answers (200, 400, 401, 403, 404)
- [ ] J3: `EditedIndicator.test.jsx`
- [ ] J4: `postValidation.test.js`
- [ ] J5: `QuestionContent.test.jsx`, wrapping renders in `MemoryRouter` and adding the pencil and indicator tests
- [ ] J6: `AnswerList.test.jsx` inline-edit tests
- [ ] J7: `postQuestion.test.jsx` edit-mode suite
- [ ] J8: `questionDetail.test.jsx` refetch-skip tests
- [ ] J9: `questionSlice.test.jsx` tests for the edit thunks
- [ ] J10: no edit controls in the `QuestionCard`, `QuestionList`, `home` and `profile` tests
- [ ] J11: `tests/integration/editFlow.test.jsx` (question flow, answer flow, unauthorized)
- [ ] J12: frontend `npm test` and `npm run lint` green, plus a manual pass through spec §14 (light, dark, phone width)
- [ ] Coordinate the `QuestionContent` header merge with `feature/bookmarks`
