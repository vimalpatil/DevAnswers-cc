import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { configureStore } from '@reduxjs/toolkit';
import QuestionContent from '../../../src/components/Question/QuestionContent';
import questionReducer from '../../../src/reducers/questionSlice';
import bookmarkReducer from '../../../src/reducers/bookmarkSlice';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

const createMockStore = () => {
  return configureStore({
    reducer: {
      question: questionReducer,
      user: () => ({
        userInfo: { userId: 'user-1' },
        loading: false,
        error: null,
      }),
    },
  });
};

const mockQuestion = {
  _id: 'q1',
  title: 'How do I use the useEffect hook?',
  description: 'I have trouble with the dependency array.',
  voteCount: 8,
  tags: [
    { _id: 't1', name: 'react' },
    { _id: 't2', name: 'hooks' },
  ],
  author: { _id: 'user-2', name: 'Alice' },
  createdAt: '2026-01-15T00:00:00.000Z',
};

const renderQuestionContent = (question = mockQuestion) => {
  const store = createMockStore();
  return render(
    <Provider store={store}>
      <MemoryRouter>
        <QuestionContent question={question} />
      </MemoryRouter>
    </Provider>
  );
};

describe('QuestionContent Component', () => {
  it('renders the question title', () => {
    renderQuestionContent();
    expect(screen.getByText('How do I use the useEffect hook?')).toBeInTheDocument();
  });

  it('renders the question description', () => {
    renderQuestionContent();
    expect(screen.getByText('I have trouble with the dependency array.')).toBeInTheDocument();
  });

  it('renders the vote count', () => {
    renderQuestionContent();
    expect(screen.getByText('8')).toBeInTheDocument();
  });

  it('renders tags as badges', () => {
    renderQuestionContent();
    expect(screen.getByText('react')).toBeInTheDocument();
    expect(screen.getByText('hooks')).toBeInTheDocument();
  });

  it('renders the author name', () => {
    renderQuestionContent();
    expect(screen.getByText('Alice')).toBeInTheDocument();
  });

  it('renders upvote and downvote buttons', () => {
    renderQuestionContent();
    const buttons = screen.getAllByRole('button');
    expect(buttons.length).toBeGreaterThanOrEqual(2);
  });

  it('renders the "Asked" date text', () => {
    renderQuestionContent();
    expect(screen.getByText(/Asked/i)).toBeInTheDocument();
  });

  it('renders "Posted by" label for the author', () => {
    renderQuestionContent();
    expect(screen.getByText(/Posted by/i)).toBeInTheDocument();
  });
});

// Bookmark control in the header card (AC-3)
describe('QuestionContent bookmark control', () => {
  const renderWithBookmarks = (ids = {}) => {
    const store = configureStore({
      reducer: {
        question: questionReducer,
        user: () => ({ userInfo: { userId: 'user-1', token: 'tok' } }),
        bookmark: bookmarkReducer,
      },
      preloadedState: {
        bookmark: { ...bookmarkReducer(undefined, { type: '@@INIT' }), ids },
      },
    });
    return render(
      <Provider store={store}>
        <MemoryRouter>
          <QuestionContent question={mockQuestion} />
        </MemoryRouter>
      </Provider>
    );
  };

  it('renders the bookmark control next to the title', () => {
    renderWithBookmarks();
    const button = screen.getByRole('button', { name: 'Bookmark question' });
    const header = screen.getByText('How do I use the useEffect hook?').parentElement;
    expect(header).toContainElement(button);
  });

  it('reflects bookmarked state from the store', () => {
    renderWithBookmarks({ q1: true });
    expect(screen.getByRole('button', { name: 'Remove bookmark' })).toHaveAttribute('aria-pressed', 'true');
  });
});

// Edit control and "edited" indicator (spec 002, AC-1/2/3/15/16)
describe('QuestionContent edit control', () => {
  beforeEach(() => {
    mockNavigate.mockClear();
  });

  const renderAs = (userInfo, question = mockQuestion) => {
    const store = configureStore({
      reducer: {
        question: questionReducer,
        user: () => ({ userInfo }),
      },
    });
    return render(
      <Provider store={store}>
        <MemoryRouter>
          <QuestionContent question={question} />
        </MemoryRouter>
      </Provider>
    );
  };

  it('shows the pencil to the author', () => {
    renderAs({ userId: 'user-2', token: 'tok' });
    expect(screen.getByRole('button', { name: 'Edit question' })).toBeInTheDocument();
  });

  it('hides the pencil from a non-author', () => {
    renderAs({ userId: 'user-1', token: 'tok' });
    expect(screen.queryByRole('button', { name: 'Edit question' })).not.toBeInTheDocument();
  });

  it('hides the pencil from a logged-out user', () => {
    renderAs(null);
    expect(screen.queryByRole('button', { name: 'Edit question' })).not.toBeInTheDocument();
  });

  it('keeps the pencil in the header action group with the bookmark', () => {
    renderAs({ userId: 'user-2', token: 'tok' });
    const header = screen.getByText('How do I use the useEffect hook?').parentElement;
    expect(header).toContainElement(screen.getByRole('button', { name: 'Edit question' }));
    expect(header).toContainElement(screen.getByRole('button', { name: 'Bookmark question' }));
  });

  it('navigates client-side to the edit route on click', async () => {
    renderAs({ userId: 'user-2', token: 'tok' });
    await userEvent.click(screen.getByRole('button', { name: 'Edit question' }));
    expect(mockNavigate).toHaveBeenCalledWith('/question/q1/edit');
  });

  it('shows "edited" with a tooltip when editedAt is set', () => {
    const editedAt = '2026-02-01T10:00:00.000Z';
    renderAs(null, { ...mockQuestion, editedAt });
    const indicator = screen.getByText(/^edited /);
    expect(indicator).toHaveTextContent('edited Feb 1, 2026');
    expect(indicator).toHaveAttribute('title', new Date(editedAt).toLocaleString());
  });

  it('shows no indicator when editedAt is null', () => {
    renderAs(null, { ...mockQuestion, editedAt: null });
    expect(screen.queryByText(/^edited /)).not.toBeInTheDocument();
  });
});
