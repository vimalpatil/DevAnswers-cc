import React from 'react';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { server } from '../mocks/server';
import { seedBookmarks } from '../mocks/handlers';
import { mockUsers } from '../mocks/mockData';
import App from '../../src/App';
import userReducer from '../../src/reducers/userSlice';
import questionReducer from '../../src/reducers/questionSlice';
import themeReducer from '../../src/reducers/themeSlice';
import bookmarkReducer from '../../src/reducers/bookmarkSlice';

/**
 * Integration Tests: Bookmark flow through the whole App (Redux + MSW + routing).
 * App owns its BrowserRouter, so routes are set with window.history.pushState.
 */

const storedSession = {
  token: mockUsers.user1.token,
  userId: mockUsers.user1.userId,
  name: mockUsers.user1.name,
};

// Same reducers as src/store.js; built per test so state never leaks between tests
const createAppStore = (userInfo = null) =>
  configureStore({
    reducer: {
      user: userReducer,
      question: questionReducer,
      theme: themeReducer,
      bookmark: bookmarkReducer,
    },
    preloadedState: {
      user: {
        userInfo,
        login: { status: 'idle', error: null },
        registration: { status: 'idle', error: null },
      },
    },
  });

const renderApp = (path, store) => {
  window.history.pushState({}, '', path);
  render(
    <Provider store={store}>
      <App />
    </Provider>
  );
  return store;
};

// Bookmark controls on the home page, keyed by question title
const homeCard = async (title) => {
  const link = await screen.findByRole('link', { name: title });
  return link.closest('.qcard');
};

describe('Bookmark Flow Integration Tests', () => {
  let idsRequests;

  beforeEach(() => {
    localStorage.clear();
    idsRequests = 0;
    server.events.on('request:start', ({ request }) => {
      if (new URL(request.url).pathname === '/api/bookmarks/ids') idsRequests += 1;
    });
  });

  afterEach(() => {
    server.events.removeAllListeners();
  });

  it('fetches bookmark IDs once on load with a stored session and shows them (AC-11)', async () => {
    seedBookmarks([{ _id: 'question-1', bookmarkedAt: '2026-11-20T00:00:00.000Z' }]);
    localStorage.setItem('userInfo', JSON.stringify(storedSession));
    renderApp('/', createAppStore(storedSession));

    const card = await homeCard('How do I manage state in React?');
    await waitFor(() =>
      expect(within(card).getByRole('button', { name: 'Remove bookmark' })).toHaveAttribute('aria-pressed', 'true')
    );
    const other = await homeCard('What is the virtual DOM?');
    expect(within(other).getByRole('button', { name: 'Bookmark question' })).toBeInTheDocument();
    expect(idsRequests).toBe(1);
  });

  it('does not fetch bookmark IDs when logged out', async () => {
    renderApp('/', createAppStore());

    await homeCard('How do I manage state in React?');
    expect(idsRequests).toBe(0);
  });

  it('fetches bookmark IDs after login', async () => {
    seedBookmarks([{ _id: 'question-2', bookmarkedAt: '2026-11-20T00:00:00.000Z' }]);
    const store = renderApp('/login', createAppStore());
    expect(idsRequests).toBe(0);

    await userEvent.type(screen.getByPlaceholderText('Enter your email'), 'alice@example.com');
    await userEvent.type(screen.getByPlaceholderText('Enter your password'), 'password123');
    // The header also has a "Login" button; click the form's submit button
    const submit = screen.getAllByRole('button', { name: /^login$/i }).find((b) => b.type === 'submit');
    await userEvent.click(submit);

    await waitFor(() => expect(store.getState().bookmark.ids).toEqual({ 'question-2': true }));
    expect(idsRequests).toBe(1);
  });

  it('bookmarks on the home page, lists it on /profile, and clears state on logout (AC-1, AC-8, AC-12)', async () => {
    localStorage.setItem('userInfo', JSON.stringify(storedSession));
    const store = renderApp('/', createAppStore(storedSession));
    await waitFor(() => expect(store.getState().bookmark.idsStatus).toBe('fulfilled'));

    // Bookmark from the home page
    const card = await homeCard('What is the virtual DOM?');
    await userEvent.click(within(card).getByRole('button', { name: 'Bookmark question' }));
    expect(within(card).getByRole('button', { name: 'Remove bookmark' })).toBeInTheDocument();
    await waitFor(() => expect(store.getState().bookmark.pending).toEqual({}));

    // It shows up in Saved Questions
    await userEvent.click(screen.getAllByRole('link', { name: /profile/i })[0]);
    const section = await screen.findByRole('region', { name: 'Saved Questions' });
    expect(await within(section).findByRole('link', { name: 'What is the virtual DOM?' })).toBeInTheDocument();

    // Logout wipes bookmark state for the next user
    await userEvent.click(screen.getByRole('button', { name: /logout/i }));
    const state = store.getState().bookmark;
    expect(state.ids).toEqual({});
    expect(state.items).toEqual([]);
    expect(state.idsStatus).toBe('idle');
    expect(localStorage.getItem('userInfo')).toBeNull();
  });
});
