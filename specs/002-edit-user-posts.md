# Spec 002: Edit User Posts

**Status:** Draft for review
**Epic:** [docs/epic-userpost-engage.md](../docs/epic-userpost-engage.md), Feature 2
**Related:** [001-bookmarks.md](001-bookmarks.md). Both features change the `QuestionContent.jsx` header, so they must be merged one after the other.

## Decisions (agreed with the requester)

| # | Decision | Consequence |
| --- | --- | --- |
| D1 | **Only authors can edit.** Admins can no longer edit other people's posts. | The existing "admin can update any question/answer" integration tests change to expect **403**. Admins can still delete any post. |
| D2 | **Questions are edited on a separate route**, `/question/:id/edit`, which reuses `PostQuestion` in edit mode. **Answers are edited inline** on the detail page. | The pencil appears only on the Question Details page, and moving to the edit route is client-side navigation with no page reload. The edit route is not an entry point anyone can see: it is guarded and is reached only through the pencil. |
| D3 | **Tag rules apply to edits only.** Question creation keeps its current behaviour. | A shared tag-parsing helper is added and used only by `updateQuestionService`. Applying it to create is a possible follow-up. |
| D4 | **E2E scenarios are covered by RTL + MSW flow tests** (frontend) and supertest (backend). | No Playwright or Cypress. The new flow tests go in `devanswers-frontend/tests/integration/`. |
| D5 | **"Edited" is tracked with a new `editedAt` field, not `updatedAt`.** | `updatedAt` changes on every view (`$inc views`) and every vote (`save()`), so it can't mean "edited". |
| D6 | **Saves are pessimistic, not optimistic.** The UI shows a saving state and applies the server response. | The server may reject an edit (validation, 403, 404). Rolling back an optimistic edit of a multi-field form is fiddly and the gain is small. See §6.5. |

---

## 1. Problem / motivation

Authors can't fix a typo, clarify a question or correct a wrong answer. Their only option is to delete and repost, which loses votes, answers and views. The backend already has `PUT /api/questions/:id` and `PUT /api/answers/:answerId`, but:

- the frontend never calls them (there's no UI, service function or thunk)
- `PUT /questions/:id` returns **500** when `tags` is omitted (`tags.trim()` on `undefined`), and its response has `author` and `tags` as raw IDs
- neither endpoint validates input: a whitespace-only title or answer is accepted
- an invalid ObjectId in the URL returns 500 (a `CastError`) instead of 400
- admins can edit anyone's content, which conflicts with D1
- nothing records that a post was edited

## 2. User stories

- **US-1:** As a question author, I want to edit my question's title, body and tags from its detail page, so I can fix mistakes without losing answers and votes.
- **US-2:** As an answer author, I want to edit my answer in place on the question page, so I can correct or improve it.
- **US-3:** As a reader, I want to see when a question or answer has been edited, so I know the content may differ from what was first posted.
- **US-4:** As a user, I don't want edit controls on content I don't own, and I don't want anyone else to be able to change my posts.

## 3. Acceptance criteria

Each criterion maps to at least one test in §11.

**Question editing**

- **AC-1:** On `/question/:id`, a pencil button (`FaPen`, `aria-label="Edit question"`) appears in the question header **only** when the user is logged in and `question.author._id === userInfo.userId`.
- **AC-2:** The pencil does **not** appear for logged-out users, for non-authors, or anywhere outside the detail page (`QuestionCard`, `QuestionList`, home, tag views, profile).
- **AC-3:** Clicking the pencil navigates client-side to `/question/:id/edit` with no full reload. The form is pre-filled with the current title, description and tags (tag names joined with `", "`).
- **AC-4:** Saving valid changes sends `PUT /api/questions/:id` and then navigates back to `/question/:id`. The detail page shows the new title, body and tags straight from the store, without a spinner or refetch.
- **AC-5:** Cancel (button, or Esc when no request is in flight) navigates back to `/question/:id` without sending a request. Unsaved changes are discarded.
- **AC-6:** While saving, the Save button is disabled and reads "Saving…", and the inputs are read-only. A double-click sends only one request.
- **AC-7:** Client-side validation shows errors inline (React Bootstrap `isInvalid` + `Form.Control.Feedback`) and sends no request when:
  - the title is empty or whitespace
  - the description is empty or whitespace
  - the tags break any rule in §5.3
- **AC-8:** Server-side validation errors (400) and other failures (403, 404, 401, network) appear in an inline `Alert` above the form, the form keeps the user's input, and no `alert()` pop-up is used.
- **AC-9:** Going to `/question/:id/edit` directly:
  - logged out: redirects to `/login`
  - logged in as a non-author: shows "You can only edit your own questions" with a link back to the question, and no form
  - unknown ID: shows "Question not found"

**Answer editing**

- **AC-10:** Each answer on the detail page shows a pencil (`aria-label="Edit answer"`) **only** when `answer.author._id === userInfo.userId`.
- **AC-11:** Clicking it replaces that answer's text with a textarea pre-filled with the current text, plus Save and Cancel buttons. Only one answer can be in edit mode at a time.
- **AC-12:** Save sends `PUT /api/answers/:answerId`. On success the answer leaves edit mode and shows the new text immediately, without a page reload or refetch.
- **AC-13:** Cancel restores the original text and sends no request.
- **AC-14:** Empty or whitespace-only text shows an inline error and sends no request. While saving, Save is disabled and reads "Saving…". Server errors appear inline under the textarea.

**Edited indicator**

- **AC-15:** A question or answer whose `editedAt` is set shows "edited {formatDate(editedAt)}" next to its existing date, with the full local timestamp in a `title` tooltip.
- **AC-16:** A post that has never been edited (`editedAt` missing or `null`) shows no indicator. Voting on it or viewing it never adds one.
- **AC-17:** Saving with no real change (same trimmed title and description, same tag set, or same trimmed answer text) returns 200 but does **not** set or change `editedAt`.

**Authorization and validation (API)**

- **AC-18:** `PUT` without a token returns **401**. With a valid token for anyone other than the author, including an admin, it returns **403** and leaves the document unchanged.
- **AC-19:** A malformed ID returns **400**. A well-formed ID that doesn't exist returns **404**.
- **AC-20:** Invalid bodies return **400** with a specific message and leave the document unchanged. These are:
  - a missing, non-string, empty or whitespace `title`, `description` or `answerText`
  - tags that break any rule in §5.3
- **AC-21:** Only the editable fields can change. Any `author`, `voteCount`, `upvotes`, `views`, `editedAt`, `questionId` and so on in the body is ignored.

## 4. Current architecture assessment

| Area | What exists | Relevance |
| --- | --- | --- |
| **Question model** (`devanswers-backend/src/models/Question.js`) | `title`, `description` (both `required: true`, no trim or length rules), `tags: [ObjectId→Tag]`, `upvotes`/`downvotes: [ObjectId→User]`, `voteCount`, `views`, `author: ObjectId→User`. `timestamps: true`. | Add `editedAt`. `updatedAt` isn't usable as "edited" (D5). |
| **Answer model** (`Answer.js`) | `questionId`, `answerText` (required), `author`, vote arrays, `voteCount`. `timestamps: true`. | Add `editedAt`. |
| **Tag model** (`Tag.js`) | `name` (unique, required). Tags are found or created by exact name in `createQuestionService` and `updateQuestionService`, with the code duplicated. | The edit path gets a helper that validates tags and resolves their IDs (§5.3). |
| **Authentication** (`middleware/authHandler.js`) | Checks the `Bearer` JWT, loads the user, sets `req.user = { id, isAdmin }`, returns 401 if the token is missing or invalid. | Unchanged. Both PUT routes already use `authenticate`. |
| **Authorization** | Checked in the services as `author === req.user.id \|\| isAdmin` (`questionService.js:103`, `answerService.js:42`), using find-then-check. | Becomes author-only (D1), enforced atomically (§7.2). Delete keeps author-or-admin. |
| **Routing** (`src/routes/index.js` → `questions.js`, `answers.js`) | `PUT /api/questions/:id` and `PUT /api/answers/:answerId` are registered after the `/improve` and `/summarize` routes. | No new routes. The paths stay the same. |
| **API layer (backend)** | Controllers have no try/catch (Express 5 forwards rejections). Services throw `createAppError(msg, status)`. The response envelope is `{ success, message, data }`. | The new validation follows the same pattern, with 400s thrown from the services. |
| **API layer (frontend)** | `axiosInstance` (baseURL `http://localhost:3000/api`). `config.js` already defines `QUESTION_API.UPDATE(id)` and `ANSWER_API.UPDATE(answerId)`. Services pass the token explicitly. | Add `updateQuestion` and `updateAnswer` service functions. |
| **State management** (`reducers/questionSlice.js`) | `questions`, `currentQuestion` (which includes `answers`), and one shared `loading` and `error`. Thunks follow the `rejectWithValue(error.response?.data?.message …)` pattern. | **`QuestionDetail` replaces the whole page with a spinner whenever `loading` is true, and with an error message whenever `error` is set.** The edit thunks must not touch `loading` or `error` (§6.3). |
| **Data fetching** | `QuestionDetail` dispatches `fetchQuestionById(id)` on every mount, and that endpoint does `$inc views`. | Coming back from the edit route would refetch and count a view. The return navigation skips the refetch (§6.2). |
| **UI** | `QuestionContent.jsx` (header with title and "Asked …"; body with votes, description, tag badges and author), `AnswerList.jsx` (answer cards with votes, text and "Answered by … • date"), `PostQuestion.jsx` (create form with AI Improve; errors shown with `alert()`), `VoteButtons.jsx` (already compares `authorId === userInfo.userId`). | All four are touched or reused (§6). |

## 5. API contract and backend plan

### 5.1 `PUT /api/questions/:id` (author only)

**Request** (`Authorization: Bearer <jwt>`, JSON):

| Field | Type | Rules |
| --- | --- | --- |
| `title` | string | Required. Trimmed. Must be non-empty after trimming. Max 200 chars. |
| `description` | string | Required. Trimmed. Must be non-empty after trimming. Max 10,000 chars. |
| `tags` | string (comma-separated, as the UI sends today) **or** string[] | Required. See §5.3. |

All three fields are required: the edit form always sends the full question, and this is a PUT. Unknown fields are ignored.

**Response 200:**

```
{ success: true, message: "Question updated successfully",
  data: { _id, title, description, tags: [{ _id, name }], author: { _id, name },
          voteCount, upvotes, downvotes, views, createdAt, updatedAt, editedAt } }
```

`author` and `tags` are now **populated**, matching the shape of `GET /api/questions/:id`. `answers` is **not** included, and the frontend keeps its own copy.

**Errors**

| Status | When | Message |
| --- | --- | --- |
| 400 | Malformed `:id` | `Invalid question ID` |
| 400 | Title missing, not a string, empty or whitespace | `Title is required` |
| 400 | Description missing, not a string, empty or whitespace | `Description is required` |
| 400 | Title or description too long | `Title must be at most 200 characters` / `Description must be at most 10000 characters` |
| 400 | Tag rule broken | See §5.3 |
| 401 | No token, or an invalid token | (existing middleware message) |
| 403 | Caller isn't the author (admins included) | `Not authorized to update this question` |
| 404 | No question with that ID | `Question not found` |

**Order of checks:** ID format (400), then existence (404), then ownership (403), then body validation (400). The ownership check runs before body validation, so a non-author can't use validation messages to probe the document.

### 5.2 `PUT /api/answers/:answerId` (author only)

**Request:** `{ answerText: string }`. Required. Trimmed. Must be non-empty after trimming. Max 10,000 chars. Other fields are ignored, including `questionId`, so an answer can't be moved to another question.

**Response 200:** `{ success: true, message: "Answer updated successfully", data: { _id, questionId, answerText, author: { _id, name }, voteCount, upvotes, downvotes, createdAt, updatedAt, editedAt } }`. This is the current shape (author populated) plus `editedAt`.

**Errors:** 400 `Invalid answer ID` · 400 `Answer text is required` · 400 `Answer text must be at most 10000 characters` · 401 · 403 `Not authorized to update this answer` · 404 `Answer not found`. Checks run in the same order as §5.1.

### 5.3 Tag rules (edit only, D3)

These rules live in a new helper, `devanswers-backend/src/services/tagHelper.js`, exporting `parseTagNames(input)` and `resolveTagIds(names)`.

1. Accept a comma-separated string or an array of strings. Anything else gives 400 `Tags must be a comma-separated string or an array of strings`.
2. Trim each entry and drop empty entries. This fixes today's behaviour, where `""` creates an empty-named tag.
3. Remove duplicates, ignoring case and keeping the first spelling.
4. There must be **1 to 5** tags. Otherwise 400 `Provide between 1 and 5 tags`. This matches the form hint "Add up to 5 tags".
5. Each tag can be at most 30 characters. Otherwise 400 `Each tag must be at most 30 characters`.
6. Tags are resolved by exact name, as `createQuestionService` does today, creating any that are missing. The tag lookups run **after** the ownership check and after all other validation passes, so a rejected request never creates tags.

The frontend repeats rules 2–5 so it can show errors inline. The server stays authoritative.

### 5.4 Edit tracking

- `editedAt` is set to `new Date()` **only** by the two update services, and **only** if something actually changed:
  - **Question:** the trimmed title differs, the trimmed description differs, or the ordered list of resolved tag IDs differs from the stored one.
  - **Answer:** the trimmed `answerText` differs.
- If nothing changed, the service returns the current document unchanged with 200, and `editedAt` and `updatedAt` stay as they were.
- View increments (`getQuestionByIdService`) and votes (`voteService.handleVote`) never touch `editedAt`.
- There is no `editedBy` (because of D1, the editor is always the author) and no `editCount`. Revision history is out of scope (§10).

### 5.5 Backend file changes

| File | Purpose | Changes |
| --- | --- | --- |
| `src/models/Question.js` | Edit tracking | Add `editedAt` (§8). Leave everything else alone. (`import { Mongoose }` is unused, so it may be removed while in the file.) |
| `src/models/Answer.js` | Edit tracking | Add `editedAt` (§8). |
| `src/services/tagHelper.js` (new) | Shared tag rules | `parseTagNames(input)` returns cleaned names or throws a 400 `createAppError`. `resolveTagIds(names)` finds or creates tags and returns their IDs. |
| `src/services/questionService.js` | Edit hardening | Rewrite `updateQuestionService(id, { title, description, tags }, loggedInUser)`. It takes an object instead of positional arguments (the controller and unit tests change with it). It then:<br>1. validates the ID (400)<br>2. `findById(id).select('author title description tags')` (404)<br>3. checks author only (403)<br>4. validates title and description (400)<br>5. runs `parseTagNames` (400)<br>6. runs `resolveTagIds`<br>7. detects whether anything changed<br>8. calls `findOneAndUpdate({ _id: id, author: loggedInUser.id }, { $set: { title, description, tags, editedAt } }, { new: true, runValidators: true })`<br>9. populates `author` (name) and `tags`<br>10. if the conditional update returns `null` (the post was deleted, or its author changed, between steps 2 and 8), throws 404. `createQuestionService` and `deleteQuestionService` are unchanged. |
| `src/services/answerService.js` | Edit hardening | Rewrite `updateAnswerService` the same way: validate the ID, find it, check author only, validate the text, detect changes, run a conditional `findOneAndUpdate({ _id, author })` with `$set: { answerText, editedAt }`, and populate `author`. This replaces the current `answer.save()`. `deleteAnswerService` is unchanged (admins can still delete). |
| `src/controllers/questionController.js` | Pass-through | `updateQuestion` passes `{ title, description, tags }` as one object. The `let` becomes `const`. |
| `src/controllers/answerController.js` | None | The signature is unchanged. |
| `src/routes/*.js`, `src/app.js` | None | No new routes or models. |
| `src/scripts/seed-data.js` / populate | Optional | Seed one edited question and one edited answer so the indicator can be checked by hand. |

ID validation uses `mongoose.Types.ObjectId.isValid`, as `userService.getUserStats` does.

## 6. UI changes / frontend plan

### 6.1 Services and config

- `config.js`: no change, because `QUESTION_API.UPDATE` and `ANSWER_API.UPDATE` already exist.
- `src/services/questionService.js`: add `updateQuestion(id, { title, description, tags }, token)`. It calls `PUT` with a Bearer header and returns `res.data.data`.
- `src/services/answerService.js`: add `updateAnswer(answerId, answerText, token)`.

### 6.2 Routing

- `App.jsx`: add `<Route path='/question/:id/edit' element={<PostQuestion mode="edit" />} />` inside the `SideBarLayout` group, next to `/question/:id`. `/ask` stays as `<PostQuestion />`, which defaults to create mode.
- After a successful save, `PostQuestion` calls `navigate(`/question/${id}`, { state: { fromEdit: true } })`.
- `QuestionDetail.jsx`: skip `fetchQuestionById` when `location.state?.fromEdit && currentQuestion?._id === id`, then clear the flag with `navigate(location.pathname, { replace: true, state: null })` so a later reload behaves normally. This makes AC-4 instant and stops edits from counting as views.

### 6.3 Redux (`questionSlice.js`)

New thunks, written like the existing ones (token from `getState().user.userInfo`, errors through `rejectWithValue(error.response?.data?.message || …)`):

| Thunk | Fulfilled reducer |
| --- | --- |
| `editQuestion({ id, title, description, tags })` | If `currentQuestion?._id === id`, merge `title`, `description`, `tags`, `editedAt` and `updatedAt` into it, **keeping `answers`** and vote state. If the question is also in `questions[]`, merge the same fields there. |
| `editAnswer({ answerId, answerText })` | Find the answer in `currentQuestion.answers` and replace `answerText`, `editedAt` and `updatedAt`. |

- **Neither thunk touches `state.loading` or `state.error`, and neither has a `pending` or `rejected` case.** Setting either one would replace `QuestionDetail` with a spinner or an error page.
- Saving and error state stay in the component. The component calls `dispatch(thunk).unwrap()` and keeps `saving` and `serverError` in local `useState`.
- **Cache consistency:** `questions[]` (home list) is merged in place, so the list shows new titles and tags without a refetch. Other derived data (tag pages, profile) is fetched on mount and picks up changes the next time it loads.

### 6.4 Components

| Component | Current role | Changes |
| --- | --- | --- |
| `components/Question/QuestionContent.jsx` | Renders the question header and body on the detail page | Read `userInfo` from the store. Compute `isAuthor = !!userInfo && question.author?._id === userInfo.userId`. **Header:** put the title in a flex row with a small `Button variant="link"` holding `FaPen` (`aria-label="Edit question"`, `title="Edit question"`) on the right, shown only when `isAuthor`. Clicking it calls `navigate(`/question/${question._id}/edit`)`. **Meta row:** after "Asked …", render an `EditedIndicator` when `question.editedAt` is set. This is the same header block that Bookmarks changes (coordinate the merge). |
| `components/Answer/AnswerList.jsx` | Lists answers with votes and the AI summary | Add local `editingId`, `draft`, `saving` and `fieldError`/`serverError` state. For each answer where `answer.author?._id === userInfo?.userId`, show a pencil (`aria-label="Edit answer"`) in the meta row. In edit mode, swap `.alist-content` for a `Form.Control as="textarea"` (pre-filled, `isInvalid` + `Feedback`) and Save/Cancel buttons. Opening another answer's editor cancels the current one. Save validates the trimmed text, then calls `dispatch(editAnswer(...)).unwrap()`; success leaves edit mode, failure shows an inline `Alert`. Cancel resets the state. Render `EditedIndicator` after the answer date when `answer.editedAt` is set. **Optional refactor:** move the per-answer card into an `AnswerItem.jsx` to keep the edit state contained. |
| `components/Shared/EditedIndicator.jsx` (new) | — | `({ editedAt })` renders `null` when `editedAt` is falsy. Otherwise it renders `<span className="text-muted small" title={new Date(editedAt).toLocaleString()}>edited {formatDate(editedAt)}</span>`. Shared by question and answer. |
| `pages/Question/PostQuestion.jsx` | Create form with AI Improve | Take a `mode` prop (`'create'` by default). **Edit mode:**<br>• Read `id` from `useParams`. If `currentQuestion?._id === id`, pre-fill from it. Otherwise dispatch `fetchQuestionById(id)` (counts one view, which is accepted for deep links) and pre-fill when it arrives. Pre-fill happens once, guarded by a ref, so later store updates don't overwrite what the user typed.<br>• Guards from AC-9: no `userInfo` redirects to `/login`; a loaded question whose author isn't the user renders the "You can only edit your own questions" message; a fetch error renders "Question not found".<br>• The heading reads "Edit question", the submit button reads "Save changes" (or "Saving…"), and there is a **Cancel** button that calls `navigate(`/question/${id}`)`.<br>• Client validation (AC-7) shows inline `isInvalid` + `Form.Control.Feedback` per field. On submit, `dispatch(editQuestion(...)).unwrap()` with local `saving` state, then navigate as in §6.2. Server errors appear in an inline `Alert` (AC-8).<br>• AI Improve stays available in edit mode.<br>**Create mode:** unchanged (it keeps its `alert()` calls; D3 leaves create untouched). |
| `pages/Question/QuestionDetail.jsx` | Fetches and lays out the detail page | Skip the refetch after an edit (§6.2). Nothing else changes. |
| `QuestionCard`, `QuestionList`, `Home`, `Tags`, `Profile` | List views | **No changes.** AC-2 is checked by tests that make sure no "Edit question" control renders there. |

### 6.5 Loading, error, optimistic and cancel behaviour

- **Pessimistic saves (D6):** the store changes only after the server confirms. During the request, the form shows "Saving…", Save is disabled, and the inputs are read-only.
- **Errors:** client validation shows field-level errors. Server or network errors show an inline `Alert` and keep the user's input so they can retry. A 401 shows "Your session has expired — please log in again." with a link to `/login`.
- **Cancel:** no request is sent. For questions it navigates back; for answers it resets local state. Cancel is disabled while a save is in flight, so it can't race the save.

## 7. Security review

### 7.1 Ownership enforcement

- **Server-side (authoritative):** both update services allow only the author. `req.user.id` comes from the verified JWT, never from the body. Admins get 403 (D1).
- **Atomic check (no time-of-check/time-of-use gap):** the final write is `findOneAndUpdate({ _id, author: req.user.id }, …)`, so even a change of author between the read and the write can't let a non-author's edit through.
- **Client-side visibility is only a convenience:** hiding the pencil and the AC-9 route guard improve the UX, but security never depends on them.

### 7.2 API protection

- Both routes keep `authenticate`, so requests without a token or with an invalid one get 401.
- The global rate limit (100 requests per 15 minutes per IP) and helmet still apply.

### 7.3 Attack vectors and direct API misuse

| Scenario | Mitigation |
| --- | --- |
| Calling `PUT` directly with someone else's post ID | 403 from the ownership check, and the document is unchanged (AC-18). |
| An admin token editing other people's posts | 403 (D1). |
| **Mass assignment** (`author`, `voteCount`, `upvotes`, `views`, `editedAt`, `questionId` in the body) | The services read only whitelisted fields and build `$set` themselves (AC-21). |
| **Operator injection** (`{ "title": { "$ne": "" } }`) | The type checks reject anything that isn't a string with 400 before any query runs. |
| **Malformed ID** causing a 500 with a stack trace in dev | ID format is checked first (400). |
| **Tag spam** (hundreds of tags, or new tags created by failed requests) | At most 5 tags of 30 characters each, and tags are created only after all checks pass. |
| **Oversized payloads** | Length caps on title, description and answer text. `express.json()` keeps its default 100 kb limit. |
| **XSS through edited content** | React escapes text and nothing uses `dangerouslySetInnerHTML`. Content is stored as plain text, as it is today. |
| **Information leak through error messages** | 403 is returned before body validation, so non-authors learn nothing about the document. 404 for a missing post is the same as today. |
| **Stale or stolen token** | The JWT has an expiry (existing behaviour). Token storage in localStorage isn't changed by this feature. |

## 8. Data model changes and database impact

**Schema deltas**, added to both schemas:

- `Question`: `editedAt: { type: Date, default: null }`
- `Answer`: `editedAt: { type: Date, default: null }`

No indexes. Nothing queries or sorts by `editedAt`.

**Migration:** none needed.

- Existing documents don't have the field. Mongoose returns `null` from defaults on hydrate for missing paths, and `.lean()` reads return `undefined`.
- Both values are falsy, and the UI treats any falsy value as "never edited" (AC-16).
- No backfill, because existing posts shouldn't show as edited.

**Rollback:** revert the code. Any leftover `editedAt` values are harmless (strict mode ignores unknown paths on read once the field is gone from the schema). Optionally clean up with `db.questions.updateMany({}, { $unset: { editedAt: "" } })`, and the same for `answers`. Tags created by edits stay; they're valid tags.

**Side effects on existing data:** none. Votes, views and stats (`userService.getUserStats`) are unchanged, and editing doesn't change reputation.

## 9. Edge cases, error handling and risks

| Case | Behaviour |
| --- | --- |
| Question deleted while the edit form is open | Save gets 404, and the form shows "This question no longer exists" with a link home. |
| Answer deleted (or the question with it) during an inline edit | 404 is shown inline. The user can cancel. |
| Two tabs editing the same post | Last write wins. There's no version check, which is accepted for author-only edits (one person). Concurrency control is out of scope. |
| A vote lands during an edit | Safe. The update uses a targeted `$set` of the edited fields, so vote arrays and `voteCount` aren't overwritten (the current `answer.save()` path is replaced). |
| Token expires while the form is open | 401 is shown inline with a login link, and the input is kept. |
| User logs out on another tab | The next save gets 401 and is handled as above. The pencil disappears on next render once `userInfo` is null. |
| Deep link to `/question/:id/edit` | Pre-fills after one fetch (counts one view). AC-9 guards apply. |
| The store holds a different question than `:id` | The `currentQuestion._id === id` check forces a fetch, so the form never shows the wrong question. |
| Store updates while the user is typing (for example a vote from another component) | Pre-fill runs once, guarded by a ref, so input isn't overwritten. |
| Saving without changes | 200 with `editedAt` unchanged (AC-17). The UI still navigates back. |
| Whitespace-only change (`"Title "` to `"Title"`) | Counts as no change, because the comparison uses trimmed values. |
| Tags reordered | Counts as a change, because the ordered ID list differs and tag order is shown in the UI. |
| A tag differs only in case from an existing tag (`React` vs `react`) | Resolved by exact name, as today. This may create a new tag; tag canonicalization is out of scope. |
| An edited post appears in lists | The home `questions[]` entry is merged. Other lists refresh on their next mount. Lists never show the indicator or the pencil. |
| **Shared `loading` flag** | Edit thunks never set it. Otherwise the whole detail page would be swapped for a spinner. Note that `postAnswer` already does this today (pre-existing, not fixed here). |
| **Merge conflict with Bookmarks** | Both features change the `QuestionContent` header row. Whichever merges second must rebase and keep both controls in one `d-flex` action group. |

## 10. Out of scope

- Revision history and diffs (epic phase 2), `editedBy`, `editCount`
- Admin or moderator editing (D1)
- Applying the tag rules to question creation (D3), and canonicalizing tag case
- Optimistic concurrency control (`If-Match` or a version field)
- Edit time windows or grace periods ("edits within 5 minutes don't count")
- Notifying answerers when a question is edited
- Editing from list views, the profile or search (excluded by requirement)
- Markdown or rich text
- Browser E2E tooling such as Playwright (D4)
- Fixing `postAnswer`'s use of the shared `loading` flag

## 11. Test plan

### 11.1 Backend: unit tests (`tests/unit/**`, `vi.mock` models)

**`services/questionService.test.js`, `updateQuestionService`:**

- the author updates successfully, `editedAt` is set, the response is populated, and `findOneAndUpdate` is called with the `author` filter and the whitelisted `$set`
- a non-author gets 403
- **an admin non-author gets 403** (replaces the old admin-allowed test)
- 404, and an invalid ID gives 400
- missing, empty, whitespace or non-string title or description each give 400
- tags: zero, six, an over-long tag, or a non-string each give 400, and no `Tag.save` happens
- duplicates and blanks are collapsed
- no change means `editedAt` isn't set and no write happens
- extra body fields are ignored

**`services/answerService.test.js`, `updateAnswerService`:** the same matrix for `answerText`, plus "`questionId` in the body is ignored".

**`services/tagHelper.test.js` (new):**

- `parseTagNames` with string or array input, trimming, blanks, case-insensitive duplicates, 1–5 limits, the 30-character limit and bad types
- `resolveTagIds` finds or creates tags

**`controllers/questionController.test.js`:** `updateQuestion` passes `{ title, description, tags }` and `req.user`.

### 11.2 Backend: integration tests (`tests/integration/**`, supertest + in-memory Mongo)

**`questions.test.js`:**

- the author's `PUT` returns 200 with a populated author and tags and a set `editedAt`, and a follow-up `GET` shows the new values
- a non-author gets 403 and the document is unchanged
- **an admin gets 403** (the existing test is flipped)
- 401 without a token, 404 for an unknown ID, 400 for a malformed ID
- 400 for a blank title, a blank description, 0 or 6 tags, and a missing `tags` (the 500 regression)
- a no-op `PUT` leaves `editedAt` `null`
- **a vote and a view don't set `editedAt`** (create, view, vote, then assert `editedAt === null`)
- `author` and `voteCount` in the body are ignored

**`answers.test.js`:**

- the author's `PUT` returns 200 with `editedAt` set
- a non-author gets 403, and **an admin gets 403** (flipped)
- 401, 404, 400 for a malformed ID, 400 for blank or whitespace text
- a no-op leaves `editedAt` `null`
- voting doesn't set `editedAt`
- `questionId` in the body is ignored

### 11.3 Frontend: unit tests (RTL + MSW)

**Fixtures:** `tests/mocks/mockData.js` gets an `editedAt` on one question and one answer, and stays `null` on the others. `tests/mocks/handlers.js` gets `PUT` handlers:

- `/questions/:id` and `/answers/:answerId` return 200, echoing the body merged with the fixture plus `editedAt`
- a fixed ID returns 403, for the unauthorized path
- a blank title or text returns 400

| Test file | Cases |
| --- | --- |
| `components/QuestionContent.test.jsx` | The pencil shows for the author. It's hidden for a non-author and for a logged-out user. Clicking navigates to `/question/:id/edit` (mocked `useNavigate`). "edited …" shows when `editedAt` is set and is missing when it's `null`. |
| `components/AnswerList.test.jsx` | The pencil shows only on the user's own answers. Edit pre-fills the textarea. Cancel restores the text and sends no request. A blank value shows an inline error and sends no request. Save shows "Saving…" and then the new text. A 403/400 shows an inline error. Only one editor is open at a time. The indicator shows or hides. |
| `components/EditedIndicator.test.jsx` (new) | Renders `null` for `null` or `undefined`. Renders the "edited" text and the `title` tooltip for a date. |
| `pages/postQuestion.test.jsx` | **Edit mode:** pre-fills from the store, or from a fetch when the store is empty. Joins tags with `", "`. Shows inline errors for blank title, blank description and tag rule failures. Save dispatches `PUT` and navigates with `state.fromEdit`. Cancel navigates back with no request. The Saving state disables the buttons. A server 403 or 400 shows an inline `Alert`. A non-author sees the guard message. A logged-out user is redirected to `/login`. **Create mode:** the existing tests pass unchanged. |
| `pages/questionDetail.test.jsx` | Doesn't refetch when `location.state.fromEdit` is set and the store matches the ID. Still fetches on a normal visit. |
| `components/QuestionCard.test.jsx`, `QuestionList.test.jsx`, `pages/home.test.jsx`, `pages/profile.test.jsx` | **AC-2:** no element with the accessible name "Edit question" or "Edit answer" renders, even when the user is the author. |
| `reducers/questionSlice.test.jsx` | `editQuestion.fulfilled` merges into `currentQuestion`, keeps `answers`, and updates the matching `questions[]` entry. `editAnswer.fulfilled` replaces the right answer. Neither changes `loading` or `error`. |

### 11.4 Flow ("E2E") tests (D4)

**New file:** `devanswers-frontend/tests/integration/editFlow.test.jsx`.

- **Question edit workflow:** render `MemoryRouter` with the `/question/:id` and `/question/:id/edit` routes and a real store (`question` + `user` reducers) logged in as the author. Click the pencil, the form is pre-filled, change the title and tags, save, and land on the detail page showing the new title and tags and the "edited" indicator, with no second `GET /questions/:id` (counted in an MSW spy).
- **Answer edit workflow:** on the same page, edit your own answer inline, save, see the new text and the indicator.
- **Unauthorized attempts:**
  - logged in as a non-author, no pencils render
  - going straight to `/question/:id/edit` shows the guard message
  - dispatching `editQuestion` for a post you don't own (the MSW 403 handler) rejects with "Not authorized…" and leaves the store unchanged

**Backend:** the real-server version of the unauthorized path (direct `PUT` with another user's token returns 403 and the document is unchanged) is covered in §11.2.

## 12. Affected files

**Backend (`devanswers-backend/`)**

- `src/models/Question.js`: `editedAt`
- `src/models/Answer.js`: `editedAt`
- `src/services/tagHelper.js` (**new**)
- `src/services/questionService.js`: `updateQuestionService`
- `src/services/answerService.js`: `updateAnswerService`
- `src/controllers/questionController.js`: `updateQuestion` passes an object
- `src/scripts/seed-data.js` (optional)

**Frontend (`devanswers-frontend/`)**

- `src/services/questionService.js`: `updateQuestion`
- `src/services/answerService.js`: `updateAnswer`
- `src/reducers/questionSlice.js`: `editQuestion` and `editAnswer`
- `src/App.jsx`: the `/question/:id/edit` route
- `src/pages/Question/PostQuestion.jsx` (+ `PostQuestion.css`): edit mode
- `src/pages/Question/QuestionDetail.jsx`: skip the refetch after an edit
- `src/components/Question/QuestionContent.jsx` (+ `.css`): pencil and indicator
- `src/components/Answer/AnswerList.jsx` (+ `.css`), optionally a new `AnswerItem.jsx`: inline edit and indicator
- `src/components/Shared/EditedIndicator.jsx` (**new**)

**Shared types:** none. The project is plain JS with no shared type package. The response shape in §5 is the contract, and the MSW fixtures must match it.

**Migrations:** none (§8).

**Tests**

- **Backend:**
  - `tests/unit/services/questionService.test.js`
  - `tests/unit/services/answerService.test.js`
  - `tests/unit/services/tagHelper.test.js` (new)
  - `tests/unit/controllers/questionController.test.js`
  - `tests/integration/questions.test.js`
  - `tests/integration/answers.test.js`
- **Frontend:**
  - `tests/mocks/handlers.js`
  - `tests/mocks/mockData.js`
  - `tests/unit/components/QuestionContent.test.jsx`
  - `tests/unit/components/AnswerList.test.jsx`
  - `tests/unit/components/EditedIndicator.test.jsx` (new)
  - `tests/unit/components/QuestionCard.test.jsx`
  - `tests/unit/components/QuestionList.test.jsx`
  - `tests/unit/pages/postQuestion.test.jsx`
  - `tests/unit/pages/questionDetail.test.jsx`
  - `tests/unit/pages/home.test.jsx`
  - `tests/unit/pages/profile.test.jsx`
  - `tests/unit/reducers/questionSlice.test.jsx`
  - `tests/integration/editFlow.test.jsx` (new)

**Docs:** `CLAUDE.md` gets three bullets: edits are author-only while deletes are author-or-admin; use `editedAt`, not `updatedAt`; edit thunks must not touch the shared `loading` flag.

## 13. Implementation order (lowest risk first)

1. **Schema:** add `editedAt` to `Question` and `Answer`. This is additive and nothing reads it yet.
2. **`tagHelper.js`** and its unit tests. Pure functions, isolated.
3. **`updateAnswerService`** rewrite and its unit tests (the smaller of the two).
4. **`updateQuestionService`** rewrite, the controller signature change, and unit tests.
5. **Backend integration tests:** flip the admin tests, add validation, no-op and "views and votes don't mark edited" tests. Run the full backend suite.
6. **Frontend services and thunks** (`updateQuestion`, `updateAnswer`, `editQuestion`, `editAnswer`), plus slice tests and the MSW handlers and fixtures.
7. **`EditedIndicator`**, then wire it into `QuestionContent` and `AnswerList`. Read-only display, low risk.
8. **Answer inline editing** in `AnswerList` (or `AnswerItem`), with its tests.
9. **Question edit route:** `App.jsx` route, `PostQuestion` edit mode with guards, validation and saving state, and the pencil in `QuestionContent`, with tests.
10. **`QuestionDetail` skips the refetch after an edit**, with its test. This touches the main page's fetch path, so it goes last.
11. **Flow tests** (`editFlow.test.jsx`), the list-view "no pencil" assertions, and lint. Then check by hand in the running app, update `CLAUDE.md`, and coordinate the `QuestionContent` merge with Bookmarks.

## 14. Definition of done: QA checklist

**Backend**

- [ ] `PUT /api/questions/:id` and `PUT /api/answers/:answerId` return 200 with populated `author` (and `tags` for questions) and `editedAt` for the author.
- [ ] A non-author **and an admin** get 403, and the document is unchanged in the DB.
- [ ] 401 without a token, 404 for an unknown ID, 400 for a malformed ID (no 500s).
- [ ] Blank or whitespace title, description or answer text gives 400. Missing `tags` gives 400 (no 500). The tag rules give 400 and failed requests create no tags.
- [ ] Extra body fields (`author`, `voteCount`, `editedAt`, `questionId`) have no effect.
- [ ] A no-op save doesn't set `editedAt`. Views and votes never set it.
- [ ] Writes use a conditional `findOneAndUpdate` filtered on `author`.
- [ ] Delete behaviour is unchanged (admins can still delete).

**Frontend**

- [ ] The pencil shows only on the detail page, only to the author, for both questions and answers. It never shows in lists, home, tags or profile.
- [ ] Question edit: the pencil navigates client-side, the form is pre-filled (tags as `a, b, c`), and Save and Cancel work. After saving, the detail page shows the update instantly with no spinner and no extra view.
- [ ] Direct URL access is guarded: logged out goes to `/login`, a non-author sees a message, an unknown ID shows "not found".
- [ ] Answer edit: inline textarea, pre-filled, Save and Cancel work, one editor at a time, updates in place.
- [ ] Inline validation messages appear and no request is sent for invalid input. Server errors show inline and keep the input. No `alert()` in the edit paths.
- [ ] Saving state is visible and double submits are impossible.
- [ ] "edited …" shows only on edited posts, with a tooltip. Unedited posts show nothing.
- [ ] Create question (`/ask`) works exactly as before.
- [ ] `QuestionDetail` never shows the full-page spinner or error page because of an edit.

**Quality**

- [ ] Backend `npm test` and frontend `npm test` are all green, and the new tests in §11 are present.
- [ ] `npm run lint` is clean in `devanswers-frontend`.
- [ ] Checked by hand in light and dark themes and at phone width (the pencil and the indicator wrap cleanly).
- [ ] `CLAUDE.md` is updated. If Bookmarks merged first, the `QuestionContent` header holds both the bookmark and edit controls.
