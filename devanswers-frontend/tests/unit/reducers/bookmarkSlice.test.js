import { describe, it, expect, beforeEach } from 'vitest';
import { configureStore } from '@reduxjs/toolkit';
import { http, HttpResponse, delay } from 'msw';
import { server } from '../../mocks/server';
import { seedBookmarks } from '../../mocks/handlers';
import { mockBookmarkedQuestions, mockQuestions } from '../../mocks/mockData';
import userReducer, { logout } from '../../../src/reducers/userSlice';
import bookmarkReducer, {
  fetchBookmarkIds,
  fetchBookmarks,
  addBookmark,
  removeBookmark,
  selectIsBookmarked,
  selectIsBookmarkPending,
  selectBookmarks,
  selectBookmarksStatus,
  selectBookmarksError,
} from '../../../src/reducers/bookmarkSlice';

const BASE_URL = 'http://localhost:3000/api';

const createTestStore = (userInfo = { token: 'tok', userId: 'user-1', name: 'Alice' }) =>
  configureStore({
    reducer: { user: userReducer, bookmark: bookmarkReducer },
    preloadedState: {
      user: {
        userInfo,
        login: { status: 'idle', error: null },
        registration: { status: 'idle', error: null },
      },
    },
  });

const failWith = (method, path, status = 500, message = 'Server exploded') =>
  server.use(http[method](`${BASE_URL}${path}`, () => HttpResponse.json({ message }, { status })));

describe('bookmarkSlice', () => {
  let store;

  beforeEach(() => {
    store = createTestStore();
  });

  describe('fetchBookmarkIds', () => {
    it('fills ids from the server', async () => {
      seedBookmarks(mockBookmarkedQuestions);

      await store.dispatch(fetchBookmarkIds());

      const state = store.getState();
      expect(selectIsBookmarked(state, 'question-1')).toBe(true);
      expect(selectIsBookmarked(state, 'question-3')).toBe(true);
      expect(selectIsBookmarked(state, 'question-2')).toBe(false);
      expect(state.bookmark.idsStatus).toBe('fulfilled');
    });

    it('keeps ids empty and does not log out on 401 (expired token)', async () => {
      failWith('get', '/bookmarks/ids', 401, 'Token is not valid.');

      await store.dispatch(fetchBookmarkIds());

      const state = store.getState();
      expect(state.bookmark.ids).toEqual({});
      expect(state.bookmark.idsStatus).toBe('rejected');
      expect(state.bookmark.error).toBeTruthy();
      expect(state.user.userInfo).not.toBeNull();
    });

    it('skips a duplicate dispatch while one is in flight', async () => {
      const first = store.dispatch(fetchBookmarkIds());
      const second = await store.dispatch(fetchBookmarkIds());

      expect(second.meta.condition).toBe(true);
      await first;
    });
  });

  describe('fetchBookmarks', () => {
    it('fills items in server order and syncs ids', async () => {
      seedBookmarks(mockBookmarkedQuestions);

      await store.dispatch(fetchBookmarks());

      const state = store.getState();
      expect(selectBookmarks(state).map((q) => q._id)).toEqual(['question-3', 'question-1']);
      expect(selectBookmarksStatus(state)).toBe('fulfilled');
      expect(selectIsBookmarked(state, 'question-3')).toBe(true);
    });

    it('sets rejected status and error on failure', async () => {
      failWith('get', '/bookmarks');

      await store.dispatch(fetchBookmarks());

      expect(selectBookmarksStatus(store.getState())).toBe('rejected');
      expect(selectBookmarksError(store.getState())).toBe('Server exploded');
    });
  });

  describe('addBookmark (optimistic, AC-4 / AC-5)', () => {
    it('marks the question bookmarked and pending before the API responds', async () => {
      const promise = store.dispatch(addBookmark(mockQuestions[1]));

      let state = store.getState();
      expect(selectIsBookmarked(state, 'question-2')).toBe(true);
      expect(selectIsBookmarkPending(state, 'question-2')).toBe(true);

      await promise;

      state = store.getState();
      expect(selectIsBookmarked(state, 'question-2')).toBe(true);
      expect(selectIsBookmarkPending(state, 'question-2')).toBe(false);
    });

    it('rolls back and sets error on failure', async () => {
      failWith('put', '/bookmarks/:questionId');

      const result = await store.dispatch(addBookmark(mockQuestions[1]));

      const state = store.getState();
      expect(addBookmark.rejected.match(result)).toBe(true);
      expect(result.payload).toBe('Server exploded');
      expect(selectIsBookmarked(state, 'question-2')).toBe(false);
      expect(selectIsBookmarkPending(state, 'question-2')).toBe(false);
      expect(state.bookmark.error).toBe('Server exploded');
    });

    it('skips a second toggle for the same question while pending', async () => {
      const first = store.dispatch(addBookmark(mockQuestions[1]));
      const second = await store.dispatch(removeBookmark('question-2'));

      expect(second.meta.condition).toBe(true);
      expect(selectIsBookmarked(store.getState(), 'question-2')).toBe(true);
      await first;
    });
  });

  describe('removeBookmark (optimistic, AC-4)', () => {
    beforeEach(async () => {
      seedBookmarks(mockBookmarkedQuestions);
      await store.dispatch(fetchBookmarks());
    });

    it('removes the id and the item before the API responds', async () => {
      const promise = store.dispatch(removeBookmark('question-3'));

      let state = store.getState();
      expect(selectIsBookmarked(state, 'question-3')).toBe(false);
      expect(selectIsBookmarkPending(state, 'question-3')).toBe(true);
      expect(selectBookmarks(state).map((q) => q._id)).toEqual(['question-1']);

      await promise;

      state = store.getState();
      expect(selectIsBookmarkPending(state, 'question-3')).toBe(false);
      expect(selectBookmarks(state).map((q) => q._id)).toEqual(['question-1']);
    });

    it('restores the id and the item at its original index on failure', async () => {
      failWith('delete', '/bookmarks/:questionId');

      const result = await store.dispatch(removeBookmark('question-3'));

      const state = store.getState();
      expect(removeBookmark.rejected.match(result)).toBe(true);
      expect(selectIsBookmarked(state, 'question-3')).toBe(true);
      expect(selectIsBookmarkPending(state, 'question-3')).toBe(false);
      expect(selectBookmarks(state).map((q) => q._id)).toEqual(['question-3', 'question-1']);
      expect(state.bookmark.error).toBe('Server exploded');
    });
  });

  describe('logout reset (AC-12)', () => {
    it('clears all bookmark state on user/logout', async () => {
      seedBookmarks(mockBookmarkedQuestions);
      await store.dispatch(fetchBookmarkIds());
      await store.dispatch(fetchBookmarks());

      store.dispatch(logout());

      const state = store.getState().bookmark;
      expect(state.ids).toEqual({});
      expect(state.items).toEqual([]);
      expect(state.pending).toEqual({});
      expect(state.idsStatus).toBe('idle');
      expect(state.itemsStatus).toBe('idle');
    });

    it('ignores an ids response that arrives after logout', async () => {
      seedBookmarks(mockBookmarkedQuestions);
      const promise = store.dispatch(fetchBookmarkIds());
      store.dispatch(logout());
      await promise;

      expect(store.getState().bookmark.ids).toEqual({});
    });
  });

  // A logs out and B logs in while A's requests are still in flight.
  // Nothing from A's session may land in B's state.
  describe('session switch while requests are in flight', () => {
    const TOKEN_A = 'token-a';
    const TOKEN_B = 'token-b';
    const setUser = (userInfo) => ({ type: 'test/setUser', payload: userInfo });

    // User reducer that can switch users directly, so no login round trip is needed
    const createSwitchableStore = () =>
      configureStore({
        reducer: {
          user: (state = { userInfo: { token: TOKEN_A, userId: 'user-a' } }, action) => {
            if (action.type === 'test/setUser') return { userInfo: action.payload };
            if (action.type === logout.type) return { userInfo: null };
            return state;
          },
          bookmark: bookmarkReducer,
        },
      });

    const switchToUserB = (s) => {
      s.dispatch(logout());
      s.dispatch(setUser({ token: TOKEN_B, userId: 'user-b' }));
    };

    // A's response arrives first, while B's fetch is still pending
    const respondPerUser = (path, dataA, dataB) =>
      server.use(
        http.get(`${BASE_URL}${path}`, async ({ request }) => {
          const isA = request.headers.get('Authorization') === `Bearer ${TOKEN_A}`;
          await delay(isA ? 20 : 60);
          return HttpResponse.json({ data: isA ? dataA : dataB });
        })
      );

    it("ignores the previous user's late ids response", async () => {
      respondPerUser('/bookmarks/ids', ['question-1'], ['question-2']);
      const s = createSwitchableStore();

      const requestA = s.dispatch(fetchBookmarkIds());
      switchToUserB(s);
      const requestB = s.dispatch(fetchBookmarkIds());
      await Promise.all([requestA, requestB]);

      const state = s.getState();
      expect(state.bookmark.ids).toEqual({ 'question-2': true });
      expect(state.bookmark.idsStatus).toBe('fulfilled');
    });

    it("ignores the previous user's late saved-questions response", async () => {
      respondPerUser(
        '/bookmarks',
        [{ ...mockQuestions[0], bookmarkedAt: '2026-11-20T00:00:00.000Z' }],
        [{ ...mockQuestions[1], bookmarkedAt: '2026-11-21T00:00:00.000Z' }]
      );
      const s = createSwitchableStore();

      const requestA = s.dispatch(fetchBookmarks());
      switchToUserB(s);
      const requestB = s.dispatch(fetchBookmarks());
      await Promise.all([requestA, requestB]);

      const state = s.getState();
      expect(selectBookmarks(state).map((q) => q._id)).toEqual(['question-2']);
      expect(selectIsBookmarked(state, 'question-1')).toBe(false);
      expect(selectBookmarksStatus(state)).toBe('fulfilled');
    });

    it('ignores a failed remove that lands after logout, and tags it stale', async () => {
      server.use(
        http.delete(`${BASE_URL}/bookmarks/:questionId`, async () => {
          await delay(20);
          return HttpResponse.json({ message: 'Server exploded' }, { status: 500 });
        })
      );
      const s = createSwitchableStore();
      // Seed A's bookmark directly with the thunk's action creators
      s.dispatch(addBookmark.pending('seed', mockQuestions[0]));
      s.dispatch(addBookmark.fulfilled({}, 'seed', mockQuestions[0]));
      expect(selectIsBookmarked(s.getState(), 'question-1')).toBe(true);

      const removal = s.dispatch(removeBookmark('question-1'));
      switchToUserB(s);
      const result = await removal;

      expect(removeBookmark.rejected.match(result)).toBe(true);
      expect(result.meta.stale).toBe(true);
      const state = s.getState().bookmark;
      expect(state.ids).toEqual({});
      expect(state.pending).toEqual({});
      expect(state.error).toBeNull();
    });

    it('ignores a failed add that lands after logout', async () => {
      server.use(
        http.put(`${BASE_URL}/bookmarks/:questionId`, async () => {
          await delay(20);
          return HttpResponse.json({ message: 'Server exploded' }, { status: 500 });
        })
      );
      const s = createSwitchableStore();

      const add = s.dispatch(addBookmark(mockQuestions[0]));
      switchToUserB(s);
      // B bookmarks the same question before A's failure arrives
      s.dispatch(addBookmark.pending('b-request', mockQuestions[0]));
      const result = await add;

      expect(result.meta.stale).toBe(true);
      const state = s.getState().bookmark;
      // A's rollback must not undo B's optimistic add
      expect(state.ids).toEqual({ 'question-1': true });
      expect(state.pending).toEqual({ 'question-1': 'b-request' });
    });

    it('does not tag a failure as stale when the session is unchanged', async () => {
      failWith('put', '/bookmarks/:questionId');

      const result = await store.dispatch(addBookmark(mockQuestions[1]));

      expect(result.meta.stale).toBe(false);
    });
  });

  describe('error fields', () => {
    it('keeps the saved-questions error when a toggle starts', async () => {
      failWith('get', '/bookmarks');
      await store.dispatch(fetchBookmarks());
      expect(selectBookmarksError(store.getState())).toBe('Server exploded');

      await store.dispatch(addBookmark(mockQuestions[1]));
      await store.dispatch(fetchBookmarkIds());

      expect(selectBookmarksError(store.getState())).toBe('Server exploded');
    });

    it('does not report a toggle failure as a saved-questions error', async () => {
      failWith('put', '/bookmarks/:questionId', 404, 'Question not found');

      await store.dispatch(addBookmark(mockQuestions[1]));

      expect(store.getState().bookmark.error).toBe('Question not found');
      expect(selectBookmarksError(store.getState())).toBeNull();
    });

    it('clears the saved-questions error when the list is refetched', async () => {
      failWith('get', '/bookmarks');
      await store.dispatch(fetchBookmarks());
      server.resetHandlers();

      await store.dispatch(fetchBookmarks());

      expect(selectBookmarksError(store.getState())).toBeNull();
      expect(selectBookmarksStatus(store.getState())).toBe('fulfilled');
    });
  });

  describe('selectors without a bookmark slice (AC-14)', () => {
    const state = { user: { userInfo: null } };

    it('return safe defaults', () => {
      expect(selectIsBookmarked(state, 'question-1')).toBe(false);
      expect(selectIsBookmarkPending(state, 'question-1')).toBe(false);
      expect(selectBookmarks(state)).toEqual([]);
      expect(selectBookmarksStatus(state)).toBe('idle');
    });
  });
});
