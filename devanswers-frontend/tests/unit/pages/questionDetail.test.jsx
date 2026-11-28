import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Provider } from 'react-redux';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { server } from '../../mocks/server';
import { configureStore } from '@reduxjs/toolkit';
import QuestionDetail from '../../../src/pages/Question/QuestionDetail';

const createMockStore = ({ currentQuestion = null, loading = false, error = null } = {}) => {
  return configureStore({
    reducer: {
      question: () => ({ questions: [], currentQuestion, loading, error }),
      user: () => ({
        userInfo: { userId: 'u1' },
        loading: false,
        error: null,
      }),
    },
  });
};

const renderQuestionDetail = (storeOptions = {}, questionId = 'q1') => {
  const store = createMockStore(storeOptions);
  return render(
    <Provider store={store}>
      <MemoryRouter initialEntries={[`/question/${questionId}`]}>
        <Routes>
          <Route path="/question/:id" element={<QuestionDetail />} />
        </Routes>
      </MemoryRouter>
    </Provider>
  );
};

describe('QuestionDetail Page', () => {
  const mockQuestion = {
    _id: 'q1',
    title: 'How do I use the useEffect hook?',
    description: 'I have trouble with the dependency array.',
    voteCount: 8,
    tags: [{ _id: 't1', name: 'react' }, { _id: 't2', name: 'hooks' }],
    author: { _id: 'u2', name: 'Alice' },
    createdAt: '2026-01-15T00:00:00.000Z',
    answers: [],
  };

  it('shows question not found when no current question is loaded', () => {
    renderQuestionDetail();
    expect(screen.getByText(/question not found/i)).toBeInTheDocument();
  });

  it('shows an error message when there is an error', () => {
    renderQuestionDetail({ error: 'Not Found' });
    expect(screen.getByText(/error loading question/i)).toBeInTheDocument();
  });

  it('renders the question title when a question is loaded', () => {
    renderQuestionDetail({ currentQuestion: mockQuestion });
    expect(screen.getByText('How do I use the useEffect hook?')).toBeInTheDocument();
  });

  it('renders the question description when a question is loaded', () => {
    renderQuestionDetail({ currentQuestion: mockQuestion });
    expect(screen.getByText('I have trouble with the dependency array.')).toBeInTheDocument();
  });

  it('renders the answer form when a question is loaded', () => {
    renderQuestionDetail({ currentQuestion: mockQuestion });
    expect(screen.getByPlaceholderText(/write your answer here/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /post answer/i })).toBeInTheDocument();
  });

  it('renders the answers section heading when a question is loaded', () => {
    renderQuestionDetail({ currentQuestion: mockQuestion });
    expect(screen.getByText('0 Answers')).toBeInTheDocument();
  });

  it('renders question tags when a question is loaded', () => {
    renderQuestionDetail({ currentQuestion: mockQuestion });
    expect(screen.getByText('react')).toBeInTheDocument();
    expect(screen.getByText('hooks')).toBeInTheDocument();
  });
});

// Returning from a successful edit skips the refetch (spec 002 §6.2, AC-4)
describe('QuestionDetail after an edit', () => {
  const question = {
    _id: 'q1',
    title: 'Edited title',
    description: 'Body',
    tags: [],
    author: { _id: 'u2', name: 'Alice' },
    createdAt: '2026-01-15T00:00:00.000Z',
    answers: [],
  };

  let getRequests = [];
  const onRequest = ({ request }) => {
    if (request.method === 'GET' && /\/questions\/[^/]+$/.test(request.url)) {
      getRequests.push(request.url);
    }
  };

  beforeEach(() => {
    getRequests = [];
    server.events.on('request:start', onRequest);
  });

  afterEach(() => {
    server.events.removeListener('request:start', onRequest);
  });

  // Shows the current location state so the test can see the flag being cleared.
  const LocationState = () => {
    const location = useLocation();
    return <div data-testid="location-state">{JSON.stringify(location.state)}</div>;
  };

  const renderAt = (entry) => {
    const store = createMockStore({ currentQuestion: question });
    render(
      <Provider store={store}>
        <MemoryRouter initialEntries={[entry]}>
          <Routes>
            <Route
              path="/question/:id"
              element={<><QuestionDetail /><LocationState /></>}
            />
          </Routes>
        </MemoryRouter>
      </Provider>
    );
  };

  it('does not refetch when state.fromEdit is set and the store holds the question', async () => {
    renderAt({ pathname: '/question/q1', state: { fromEdit: true } });

    expect(screen.getByText('Edited title')).toBeInTheDocument();
    // The flag is cleared so a later reload behaves normally
    await waitFor(() =>
      expect(screen.getByTestId('location-state')).toHaveTextContent('null')
    );
    expect(getRequests).toHaveLength(0);
  });

  it('still fetches on a normal visit', async () => {
    renderAt('/question/q1');
    await waitFor(() =>
      expect(getRequests).toEqual(['http://localhost:3000/api/questions/q1'])
    );
  });

  it('fetches when fromEdit is set but the store holds a different question', async () => {
    renderAt({ pathname: '/question/other', state: { fromEdit: true } });
    await waitFor(() =>
      expect(getRequests).toEqual(['http://localhost:3000/api/questions/other'])
    );
  });
});
