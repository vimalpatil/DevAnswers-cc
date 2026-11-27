import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Provider } from 'react-redux';
import { MemoryRouter, Routes, Route, Link } from 'react-router-dom';
import { configureStore } from '@reduxjs/toolkit';
import { http, HttpResponse, delay } from 'msw';
import { server } from '../../mocks/server';
import { seedBookmarks } from '../../mocks/handlers';
import { mockQuestions } from '../../mocks/mockData';
import BookmarkButton from '../../../src/components/Shared/BookmarkButton';
import bookmarkReducer, { fetchBookmarkIds } from '../../../src/reducers/bookmarkSlice';
import { logout } from '../../../src/reducers/userSlice';

const BASE_URL = 'http://localhost:3000/api';
const question = mockQuestions[0]; // question-1

const createStore = ({ userInfo = { token: 'tok', userId: 'user-1', name: 'Alice' } } = {}) =>
  configureStore({
    reducer: {
      user: () => ({ userInfo }),
      bookmark: bookmarkReducer,
    },
  });

const renderButton = (store = createStore(), ui = <BookmarkButton question={question} />) => {
  render(
    <Provider store={store}>
      <MemoryRouter>{ui}</MemoryRouter>
    </Provider>
  );
  return store;
};

describe('BookmarkButton', () => {
  let alertSpy;
  let requests;

  beforeEach(() => {
    alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    requests = [];
    const record = ({ request }) => {
      if (request.url.includes('/bookmarks')) requests.push(`${request.method} ${new URL(request.url).pathname}`);
    };
    server.events.on('request:start', record);
  });

  afterEach(() => {
    alertSpy.mockRestore();
    server.events.removeAllListeners();
  });

  it('shows the outline icon and aria-pressed=false when not bookmarked', () => {
    renderButton();

    const button = screen.getByRole('button', { name: 'Bookmark question' });
    expect(button).toHaveAttribute('aria-pressed', 'false');
    expect(button).toHaveAttribute('title', 'Bookmark question');
    expect(screen.getByTestId('bookmark-icon-outline')).toBeInTheDocument();
  });

  it('shows the filled icon and aria-pressed=true when bookmarked', async () => {
    seedBookmarks([{ _id: 'question-1', bookmarkedAt: '2026-11-20T00:00:00.000Z' }]);
    const store = createStore();
    await store.dispatch(fetchBookmarkIds());
    renderButton(store);

    const button = screen.getByRole('button', { name: 'Remove bookmark' });
    expect(button).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('bookmark-icon-filled')).toBeInTheDocument();
  });

  it('adds a bookmark on click', async () => {
    const store = renderButton();

    await userEvent.click(screen.getByRole('button', { name: 'Bookmark question' }));

    expect(screen.getByRole('button', { name: 'Remove bookmark' })).toBeInTheDocument();
    await waitFor(() => expect(store.getState().bookmark.pending).toEqual({}));
    expect(requests).toEqual(['PUT /api/bookmarks/question-1']);
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('removes a bookmark on click', async () => {
    seedBookmarks([{ _id: 'question-1', bookmarkedAt: '2026-11-20T00:00:00.000Z' }]);
    const store = createStore();
    await store.dispatch(fetchBookmarkIds());
    renderButton(store);
    requests.length = 0;

    await userEvent.click(screen.getByRole('button', { name: 'Remove bookmark' }));

    expect(screen.getByRole('button', { name: 'Bookmark question' })).toBeInTheDocument();
    await waitFor(() => expect(store.getState().bookmark.pending).toEqual({}));
    expect(requests).toEqual(['DELETE /api/bookmarks/question-1']);
  });

  it('shows a login prompt and sends no request when logged out (AC-10)', async () => {
    const store = renderButton(createStore({ userInfo: null }));

    await userEvent.click(screen.getByRole('button', { name: 'Bookmark question' }));

    expect(alertSpy).toHaveBeenCalledWith('You must be logged in to bookmark a question.');
    expect(store.getState().bookmark.ids).toEqual({});
    expect(requests).toEqual([]);
  });

  it('is disabled while the request is in flight (AC-5)', async () => {
    server.use(
      http.put(`${BASE_URL}/bookmarks/:questionId`, async ({ params }) => {
        await delay(100);
        return HttpResponse.json({ data: { questionId: params.questionId, bookmarked: true } });
      })
    );
    renderButton();

    await userEvent.click(screen.getByRole('button', { name: 'Bookmark question' }));

    const button = screen.getByRole('button', { name: 'Remove bookmark' });
    expect(button).toBeDisabled();
    // fireEvent bypasses userEvent's pointer-events check on disabled buttons
    fireEvent.click(button);
    await waitFor(() => expect(button).not.toBeDisabled());
    expect(requests).toEqual(['PUT /api/bookmarks/question-1']);
  });

  it('reverts and shows an error alert when the request fails (AC-4)', async () => {
    server.use(
      http.put(`${BASE_URL}/bookmarks/:questionId`, () =>
        HttpResponse.json({ message: 'Question not found' }, { status: 404 })
      )
    );
    renderButton();

    await userEvent.click(screen.getByRole('button', { name: 'Bookmark question' }));

    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith('Question not found'));
    expect(screen.getByRole('button', { name: 'Bookmark question' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('shows no error alert for a request that fails after logout', async () => {
    server.use(
      http.put(`${BASE_URL}/bookmarks/:questionId`, async () => {
        await delay(50);
        return HttpResponse.json({ message: 'Server exploded' }, { status: 500 });
      })
    );
    const store = configureStore({
      reducer: {
        user: (state = { userInfo: { token: 'tok', userId: 'user-1' } }, action) =>
          action.type === logout.type ? { userInfo: null } : state,
        bookmark: bookmarkReducer,
      },
    });
    renderButton(store);

    await userEvent.click(screen.getByRole('button', { name: 'Bookmark question' }));
    store.dispatch(logout());

    // Logged out: the control shows not-bookmarked and is no longer pending
    await waitFor(() => expect(screen.getByRole('button', { name: 'Bookmark question' })).not.toBeDisabled());
    await new Promise((resolve) => setTimeout(resolve, 100)); // let the failed PUT land
    expect(alertSpy).not.toHaveBeenCalled();
    expect(store.getState().bookmark.ids).toEqual({});
  });

  it('does not trigger a parent Link', async () => {
    const store = createStore();
    render(
      <Provider store={store}>
        <MemoryRouter initialEntries={['/']}>
          <Routes>
            <Route
              path="/"
              element={
                <Link to="/question/question-1">
                  <BookmarkButton question={question} />
                </Link>
              }
            />
            <Route path="/question/:id" element={<div>Detail page</div>} />
          </Routes>
        </MemoryRouter>
      </Provider>
    );

    await userEvent.click(screen.getByRole('button', { name: 'Bookmark question' }));

    expect(screen.queryByText('Detail page')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove bookmark' })).toBeInTheDocument();
  });
});
