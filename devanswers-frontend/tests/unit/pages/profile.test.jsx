import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Provider } from 'react-redux';
import { BrowserRouter } from 'react-router-dom';
import { configureStore } from '@reduxjs/toolkit';
import { http, HttpResponse, delay } from 'msw';
import Profile from '../../../src/pages/Profile/Profile';
import bookmarkReducer from '../../../src/reducers/bookmarkSlice';
import { server } from '../../mocks/server';
import { seedBookmarks } from '../../mocks/handlers';
import { mockBookmarkedQuestions } from '../../mocks/mockData';

const mockNavigate = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

const createMockStore = ({
  userInfo = { userId: 'u1', name: 'TestUser', token: 'tok' },
} = {}) => {
  return configureStore({
    reducer: {
      user: () => ({ userInfo, loading: false, error: null }),
    },
  });
};

const renderProfile = (storeOptions = {}) => {
  const store = createMockStore(storeOptions);
  return render(
    <Provider store={store}>
      <BrowserRouter>
        <Profile />
      </BrowserRouter>
    </Provider>
  );
};

describe('Profile Page', () => {
  beforeEach(() => {
    mockNavigate.mockClear();
  });

  it('renders the profile heading when authenticated', () => {
    renderProfile();
    expect(screen.getByText('My Profile')).toBeInTheDocument();
  });

  it('shows Edit Profile button when not in edit mode', () => {
    renderProfile();
    expect(screen.getByText(/edit profile/i)).toBeInTheDocument();
  });

  it('redirects to /login when not authenticated', () => {
    renderProfile({ userInfo: null });
    expect(mockNavigate).toHaveBeenCalledWith('/login');
  });

  it('shows activity stats section when authenticated', () => {
    renderProfile();
    expect(screen.getByText('Activity Stats')).toBeInTheDocument();
    expect(screen.getByText('Questions')).toBeInTheDocument();
    expect(screen.getByText('Answers')).toBeInTheDocument();
  });

  it('enters edit mode when Edit Profile button is clicked', async () => {
    renderProfile();
    await userEvent.click(screen.getByText(/edit profile/i));

    expect(screen.getByText(/save changes/i)).toBeInTheDocument();
    expect(screen.getByText(/cancel/i)).toBeInTheDocument();
  });

  it('exits edit mode when Cancel button is clicked', async () => {
    renderProfile();
    await userEvent.click(screen.getByText(/edit profile/i));
    await userEvent.click(screen.getByText(/cancel/i));

    expect(screen.getByText(/edit profile/i)).toBeInTheDocument();
  });

  it('shows form inputs in edit mode', async () => {
    const user = userEvent.setup();
    renderProfile();

    await user.click(screen.getByText(/edit profile/i));

    // Full Name and Email inputs should now be enabled
    expect(screen.getByPlaceholderText(/enter your name/i)).not.toBeDisabled();
    expect(screen.getByPlaceholderText(/enter your email/i)).not.toBeDisabled();
  });
});

// Saved Questions section (AC-8, AC-9). The cases above deliberately keep a
// store without a `bookmark` slice (AC-14).
describe('Profile Page - Saved Questions', () => {
  const BASE_URL = 'http://localhost:3000/api';

  const renderWithBookmarks = () => {
    const store = configureStore({
      reducer: {
        user: () => ({ userInfo: { userId: 'u1', name: 'TestUser', token: 'tok' } }),
        bookmark: bookmarkReducer,
      },
    });
    render(
      <Provider store={store}>
        <BrowserRouter>
          <Profile />
        </BrowserRouter>
      </Provider>
    );
    return store;
  };

  beforeEach(() => {
    mockNavigate.mockClear();
  });

  it('lists bookmarked questions as cards, most recently saved first', async () => {
    seedBookmarks(mockBookmarkedQuestions);
    renderWithBookmarks();

    expect(screen.getByText('Saved Questions')).toBeInTheDocument();
    const section = screen.getByRole('region', { name: 'Saved Questions' });
    await within(section).findByText('How do I center a div in CSS?');

    const titles = within(section).getAllByRole('link').map((a) => a.textContent);
    expect(titles).toEqual(['How do I center a div in CSS?', 'How do I manage state in React?']);
    expect(within(section).getByRole('button', { name: /Recently Saved/ })).toBeInTheDocument();
    within(section)
      .getAllByRole('button', { name: 'Remove bookmark' })
      .forEach((b) => expect(b).toHaveAttribute('aria-pressed', 'true'));
  });

  it('shows the empty state when there are no bookmarks', async () => {
    renderWithBookmarks();

    expect(await screen.findByText('No saved questions yet')).toBeInTheDocument();
    expect(screen.getByText('Click the bookmark icon on any question to save it here.')).toBeInTheDocument();
    expect(screen.queryByText(/be the first to ask/i)).not.toBeInTheDocument();
  });

  it('shows a spinner while loading', async () => {
    server.use(
      http.get(`${BASE_URL}/bookmarks`, async () => {
        await delay(50);
        return HttpResponse.json({ data: [] });
      })
    );
    renderWithBookmarks();

    expect(screen.getByRole('status', { name: 'Loading saved questions' })).toBeInTheDocument();
    expect(await screen.findByText('No saved questions yet')).toBeInTheDocument();
  });

  it('shows an error with a Retry button that refetches', async () => {
    let calls = 0;
    server.use(
      http.get(`${BASE_URL}/bookmarks`, () => {
        calls += 1;
        if (calls === 1) {
          return HttpResponse.json({ message: 'Server exploded' }, { status: 500 });
        }
        return HttpResponse.json({ data: [] });
      })
    );
    renderWithBookmarks();

    expect(await screen.findByText('Server exploded')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText('No saved questions yet')).toBeInTheDocument();
    expect(calls).toBe(2);
  });

  it('hides the section while editing', async () => {
    renderWithBookmarks();
    await screen.findByText('No saved questions yet');

    await userEvent.click(screen.getByText(/edit profile/i));

    expect(screen.queryByText('Saved Questions')).not.toBeInTheDocument();
  });

  it('removes a card immediately when it is unbookmarked', async () => {
    seedBookmarks(mockBookmarkedQuestions);
    renderWithBookmarks();
    const section = await screen.findByRole('region', { name: 'Saved Questions' });
    await within(section).findByText('How do I center a div in CSS?');

    const [firstButton] = within(section).getAllByRole('button', { name: 'Remove bookmark' });
    await userEvent.click(firstButton);

    expect(within(section).queryByText('How do I center a div in CSS?')).not.toBeInTheDocument();
    expect(within(section).getByText('How do I manage state in React?')).toBeInTheDocument();
  });
});
