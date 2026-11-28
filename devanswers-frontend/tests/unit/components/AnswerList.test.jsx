import React from 'react';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, afterEach } from 'vitest';
import { Provider, useSelector } from 'react-redux';
import { http, HttpResponse } from 'msw';
import { server } from '../../mocks/server';
import { mockAnswers as fixtureAnswers } from '../../mocks/mockData';
import { configureStore } from '@reduxjs/toolkit';
import AnswerList from '../../../src/components/Answer/AnswerList';
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

const mockAnswers = [
  {
    _id: 'a1',
    answerText: 'Use the useState hook for local state.',
    author: { _id: 'user-2', name: 'Alice' },
    voteCount: 5,
    createdAt: '2026-01-15T12:00:00.000Z',
  },
  {
    _id: 'a2',
    answerText: 'You can also try lifting state up.',
    author: { _id: 'user-3', name: 'Bob' },
    voteCount: -2,
    createdAt: '2026-01-15T13:00:00.000Z',
  },
];

const renderAnswerList = (answers = mockAnswers) => {
  const store = createMockStore();
  return render(
    <Provider store={store}>
      <AnswerList answers={answers} />
    </Provider>
  );
};

describe('AnswerList Component', () => {
  it('renders all answer texts', () => {
    renderAnswerList();
    expect(screen.getByText('Use the useState hook for local state.')).toBeInTheDocument();
    expect(screen.getByText('You can also try lifting state up.')).toBeInTheDocument();
  });

  it('renders answer authors', () => {
    renderAnswerList();
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
  });

  it('renders answer vote counts', () => {
    renderAnswerList();
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('-2')).toBeInTheDocument();
  });

  it('renders the answers count heading', () => {
    renderAnswerList();
    expect(screen.getByText('2 Answers')).toBeInTheDocument();
  });

  it('shows singular "Answer" for one answer', () => {
    renderAnswerList([mockAnswers[0]]);
    expect(screen.getByText('1 Answer')).toBeInTheDocument();
  });

  it('renders upvote and downvote buttons for each answer', () => {
    renderAnswerList();
    const buttons = screen.getAllByRole('button');
    // At least 2 upvote + 2 downvote = 4 buttons
    expect(buttons.length).toBeGreaterThanOrEqual(4);
  });

  it('renders "Answered by" label for each answer', () => {
    renderAnswerList();
    const answeredByTexts = screen.getAllByText(/Answered by/i);
    expect(answeredByTexts).toHaveLength(2);
  });

  it('renders empty state when no answers provided', () => {
    renderAnswerList([]);
    expect(screen.getByText(/No answers yet/i)).toBeInTheDocument();
  });

  it('shows "0 Answers" heading when answers array is empty', () => {
    renderAnswerList([]);
    expect(screen.getByText('0 Answers')).toBeInTheDocument();
  });
});

// Inline answer editing (spec 002, AC-10–16)
describe('AnswerList inline editing', () => {
  // answer-1 is Bob's (user-2, already edited); answer-2 is Alice's (user-1).
  // answer-3 is a second answer by Alice, for the one-editor-at-a-time case.
  const answers = [
    ...fixtureAnswers,
    {
      _id: 'answer-3',
      answerText: 'A second answer by Alice.',
      author: { _id: 'user-1', name: 'Alice Johnson' },
      voteCount: 0,
      createdAt: '2026-01-15T14:00:00.000Z',
      editedAt: null,
    },
  ];
  const ALICE_TEXT = 'You can also lift the state up to a common parent component.';
  const BOB_TEXT = 'Use the useState hook to manage local component state.';

  let putRequests = [];
  const onRequest = ({ request }) => {
    if (request.method === 'PUT') putRequests.push(request.url);
  };

  afterEach(() => {
    server.events.removeListener('request:start', onRequest);
    putRequests = [];
  });

  // Reads answers from the store so a fulfilled editAnswer re-renders the list.
  const ConnectedAnswerList = () => {
    const question = useSelector((state) => state.question.currentQuestion);
    return <AnswerList answers={question.answers} question={question} />;
  };

  const renderEditable = () => {
    server.events.on('request:start', onRequest);
    const store = configureStore({
      reducer: {
        question: questionReducer,
        user: () => ({ userInfo: { userId: 'user-1', token: 'mock-jwt-token-alice' } }),
      },
      preloadedState: {
        question: {
          questions: [],
          currentQuestion: { _id: 'question-1', title: 'Q', answers },
          loading: false,
          error: null,
        },
      },
    });
    render(
      <Provider store={store}>
        <ConnectedAnswerList />
      </Provider>
    );
    return store;
  };

  const answerCard = (text) => screen.getByText(text).closest('.alist-answer-card');

  const openEditor = async (text) => {
    const card = answerCard(text);
    await userEvent.click(within(card).getByRole('button', { name: 'Edit answer' }));
    return card;
  };

  it("shows the pencil only on the current user's answers", () => {
    renderEditable();
    expect(screen.getAllByRole('button', { name: 'Edit answer' })).toHaveLength(2);
    expect(
      within(answerCard(BOB_TEXT)).queryByRole('button', { name: 'Edit answer' })
    ).not.toBeInTheDocument();
    expect(
      within(answerCard(ALICE_TEXT)).getByRole('button', { name: 'Edit answer' })
    ).toBeInTheDocument();
  });

  it('opens a textarea pre-filled with the current text', async () => {
    renderEditable();
    const card = await openEditor(ALICE_TEXT);

    expect(within(card).getByRole('textbox', { name: 'Edit answer' })).toHaveValue(ALICE_TEXT);
    expect(within(card).getByRole('button', { name: 'Save' })).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  it('Cancel restores the original text and sends no request', async () => {
    renderEditable();
    const card = await openEditor(ALICE_TEXT);
    const textarea = within(card).getByRole('textbox', { name: 'Edit answer' });
    await userEvent.clear(textarea);
    await userEvent.type(textarea, 'Something else');
    await userEvent.click(within(card).getByRole('button', { name: 'Cancel' }));

    expect(within(card).queryByRole('textbox')).not.toBeInTheDocument();
    expect(card).toHaveTextContent(ALICE_TEXT);
    expect(putRequests).toHaveLength(0);
  });

  it('Escape cancels the edit', async () => {
    renderEditable();
    const card = await openEditor(ALICE_TEXT);
    await userEvent.keyboard('{Escape}');
    expect(within(card).queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('shows an inline error for blank text and sends no request', async () => {
    renderEditable();
    const card = await openEditor(ALICE_TEXT);
    const textarea = within(card).getByRole('textbox', { name: 'Edit answer' });
    await userEvent.clear(textarea);
    await userEvent.type(textarea, '   ');
    await userEvent.click(within(card).getByRole('button', { name: 'Save' }));

    expect(within(card).getByText('Answer text is required')).toBeInTheDocument();
    expect(textarea).toHaveClass('is-invalid');
    expect(putRequests).toHaveLength(0);
  });

  it('shows "Saving…" while saving, then the new text and the indicator', async () => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    server.use(
      http.put('http://localhost:3000/api/answers/:answerId', async ({ request }) => {
        const body = await request.json();
        await gate;
        return HttpResponse.json({
          success: true,
          data: {
            ...fixtureAnswers[1],
            answerText: body.answerText.trim(),
            editedAt: '2026-02-02T10:00:00.000Z',
          },
        });
      })
    );
    renderEditable();
    const card = await openEditor(ALICE_TEXT);
    const textarea = within(card).getByRole('textbox', { name: 'Edit answer' });
    await userEvent.clear(textarea);
    await userEvent.type(textarea, 'Lift state to the nearest common parent.');
    await userEvent.click(within(card).getByRole('button', { name: 'Save' }));

    const saving = await within(card).findByRole('button', { name: 'Saving…' });
    expect(saving).toBeDisabled();
    expect(within(card).getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(textarea).toHaveAttribute('readonly');

    release();

    await waitFor(() => expect(within(card).queryByRole('textbox')).not.toBeInTheDocument());
    expect(card).toHaveTextContent('Lift state to the nearest common parent.');
    expect(within(card).getByText('edited Feb 2, 2026')).toBeInTheDocument();
    expect(putRequests).toHaveLength(1);
  });

  it('shows a server error inline and keeps the draft', async () => {
    server.use(
      http.put('http://localhost:3000/api/answers/:answerId', () =>
        HttpResponse.json(
          { success: false, message: 'Not authorized to update this answer' },
          { status: 403 }
        )
      )
    );
    renderEditable();
    const card = await openEditor(ALICE_TEXT);
    const textarea = within(card).getByRole('textbox', { name: 'Edit answer' });
    await userEvent.clear(textarea);
    await userEvent.type(textarea, 'My draft');
    await userEvent.click(within(card).getByRole('button', { name: 'Save' }));

    expect(await within(card).findByRole('alert')).toHaveTextContent(
      'Not authorized to update this answer'
    );
    expect(textarea).toHaveValue('My draft');
    expect(within(card).getByRole('button', { name: 'Save' })).toBeEnabled();
  });

  it('keeps only one editor open at a time', async () => {
    renderEditable();
    const first = await openEditor(ALICE_TEXT);
    const second = await openEditor('A second answer by Alice.');

    expect(screen.getAllByRole('textbox', { name: 'Edit answer' })).toHaveLength(1);
    expect(within(second).getByRole('textbox')).toHaveValue('A second answer by Alice.');
    expect(within(first).queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('shows the indicator only on edited answers', () => {
    renderEditable();
    expect(within(answerCard(BOB_TEXT)).getByText('edited Jan 16, 2026')).toBeInTheDocument();
    expect(within(answerCard(ALICE_TEXT)).queryByText(/^edited /)).not.toBeInTheDocument();
  });
});
