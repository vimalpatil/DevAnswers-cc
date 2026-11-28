import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect } from 'vitest';
import { Provider } from 'react-redux';
import { BrowserRouter } from 'react-router-dom';
import { configureStore } from '@reduxjs/toolkit';
import QuestionList from '../../../src/components/Question/QuestionList';
import { SORT_OPTIONS } from '../../../src/components/Question/QuestionFilterBar';
import questionReducer from '../../../src/reducers/questionSlice';

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

const mockQuestions = [
  {
    _id: 'q1',
    title: 'First Question',
    description: 'Description for first question',
    voteCount: 5,
    answerCount: 2,
    tags: [{ _id: 't1', name: 'react' }],
    author: { _id: 'user-2', name: 'Alice' },
    createdAt: '2026-01-10T10:00:00.000Z',
  },
  {
    _id: 'q2',
    title: 'Second Question',
    description: 'Description for second question',
    voteCount: 3,
    answerCount: 1,
    tags: [{ _id: 't2', name: 'javascript' }],
    author: { _id: 'user-3', name: 'Bob' },
    createdAt: '2026-01-11T12:00:00.000Z',
  },
];

const renderQuestionList = (questions = mockQuestions) => {
  const store = createMockStore();
  return render(
    <Provider store={store}>
      <BrowserRouter>
        <QuestionList questions={questions} />
      </BrowserRouter>
    </Provider>
  );
};

describe('QuestionList Component', () => {
  it('renders all question titles', () => {
    renderQuestionList();
    expect(screen.getByText('First Question')).toBeInTheDocument();
    expect(screen.getByText('Second Question')).toBeInTheDocument();
  });

  it('renders question descriptions', () => {
    renderQuestionList();
    expect(screen.getByText('Description for first question')).toBeInTheDocument();
    expect(screen.getByText('Description for second question')).toBeInTheDocument();
  });

  it('renders "No questions found" when list is empty', () => {
    renderQuestionList([]);
    expect(screen.getByText(/No questions found/i)).toBeInTheDocument();
  });

  it('renders the question count', () => {
    renderQuestionList();
    expect(screen.getByText('2 questions')).toBeInTheDocument();
  });

  it('renders search input', () => {
    renderQuestionList();
    expect(screen.getByPlaceholderText(/search questions/i)).toBeInTheDocument();
  });

  it('filters questions by search query', async () => {
    renderQuestionList();
    await userEvent.type(screen.getByPlaceholderText(/search questions/i), 'First');

    expect(screen.getByText('First Question')).toBeInTheDocument();
    expect(screen.queryByText('Second Question')).not.toBeInTheDocument();
  });

  it('shows "No questions found" when search has no matches', async () => {
    renderQuestionList();
    await userEvent.type(screen.getByPlaceholderText(/search questions/i), 'xyz-no-match');

    expect(screen.getByText(/No questions found/i)).toBeInTheDocument();
  });

  it('renders sort dropdown', () => {
    renderQuestionList();
    expect(screen.getByText('Newest')).toBeInTheDocument();
  });
});

// Optional props used by the Saved Questions section. The tests above cover
// the defaults (home page regression).
describe('QuestionList custom props', () => {
  const savedQuestions = [
    { ...mockQuestions[0], bookmarkedAt: '2026-11-01T00:00:00.000Z' }, // older question, saved later
    { ...mockQuestions[1], bookmarkedAt: '2026-10-01T00:00:00.000Z' },
  ];
  const savedSortOptions = [{ value: 'saved', label: 'Recently Saved' }, ...SORT_OPTIONS];

  const renderWithProps = (props) => {
    const store = createMockStore();
    return render(
      <Provider store={store}>
        <BrowserRouter>
          <QuestionList {...props} />
        </BrowserRouter>
      </Provider>
    );
  };

  it('shows the custom empty title and hint when there are no questions', () => {
    renderWithProps({
      questions: [],
      emptyTitle: 'No saved questions yet',
      emptyHint: 'Click the bookmark icon on any question to save it here.',
    });

    expect(screen.getByText('No saved questions yet')).toBeInTheDocument();
    expect(screen.getByText('Click the bookmark icon on any question to save it here.')).toBeInTheDocument();
    expect(screen.queryByText(/be the first to ask/i)).not.toBeInTheDocument();
  });

  it('keeps the default text when a search filters everything out', async () => {
    renderWithProps({
      questions: savedQuestions,
      emptyTitle: 'No saved questions yet',
      emptyHint: 'Click the bookmark icon on any question to save it here.',
    });

    await userEvent.type(screen.getByPlaceholderText(/search questions/i), 'xyz-no-match');

    expect(screen.getByText('No questions found')).toBeInTheDocument();
    expect(screen.queryByText('No saved questions yet')).not.toBeInTheDocument();
  });

  it('uses custom sort options and default sort', () => {
    renderWithProps({ questions: savedQuestions, sortOptions: savedSortOptions, defaultSort: 'saved' });

    expect(screen.getByRole('button', { name: /Recently Saved/ })).toBeInTheDocument();
  });

  it("orders by bookmarkedAt descending with the 'saved' sort", () => {
    renderWithProps({ questions: savedQuestions, sortOptions: savedSortOptions, defaultSort: 'saved' });

    const titles = screen.getAllByRole('link').map((a) => a.textContent);
    expect(titles).toEqual(['First Question', 'Second Question']);
  });

  it('defaults to newest first without custom props', () => {
    renderWithProps({ questions: savedQuestions });

    const titles = screen.getAllByRole('link').map((a) => a.textContent);
    expect(titles).toEqual(['Second Question', 'First Question']);
  });
});

// Spec 002, AC-2: edit controls live only on the detail page
describe('QuestionList edit controls', () => {
  it('renders no edit control even when the user wrote every question', () => {
    renderQuestionList(mockQuestions.map((q) => ({ ...q, author: { _id: 'user-1', name: 'Me' } })));
    expect(screen.getByText('First Question')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /edit (question|answer)/i })).not.toBeInTheDocument();
  });
});
