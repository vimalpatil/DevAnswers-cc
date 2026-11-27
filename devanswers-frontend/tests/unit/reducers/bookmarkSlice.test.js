import { describe, it, expect, beforeEach } from 'vitest';
import { configureStore } from '@reduxjs/toolkit';
import { http, HttpResponse } from 'msw';
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
      expect(store.getState().bookmark.error).toBe('Server exploded');
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
