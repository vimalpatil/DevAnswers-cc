import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Provider } from 'react-redux';
import { BrowserRouter, MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import { server } from '../../mocks/server';
import { mockQuestions } from '../../mocks/mockData';
import { configureStore } from '@reduxjs/toolkit';
import PostQuestion from '../../../src/pages/Question/PostQuestion';
import questionReducer from '../../../src/reducers/questionSlice';

const createMockStore = () => {
  return configureStore({
    reducer: {
      question: () => ({ questions: [], currentQuestion: null, loading: false, error: null }),
      user: () => ({
        userInfo: { userId: 'u1', token: 'tok' },
        loading: false,
        error: null,
      }),
    },
  });
};

const renderPostQuestion = () => {
  const store = createMockStore();
  return render(
    <Provider store={store}>
      <BrowserRouter>
        <PostQuestion />
      </BrowserRouter>
    </Provider>
  );
};

describe('PostQuestion Page', () => {
  it('renders the page heading', () => {
    renderPostQuestion();
    expect(screen.getByText('Ask a Question')).toBeInTheDocument();
  });

  it('renders the title input', () => {
    renderPostQuestion();
    expect(screen.getByPlaceholderText(/what's your programming question/i)).toBeInTheDocument();
  });

  it('renders the description textarea', () => {
    renderPostQuestion();
    expect(screen.getByPlaceholderText(/provide more details about your question/i)).toBeInTheDocument();
  });

  it('renders the tags input and submit button', () => {
    renderPostQuestion();
    expect(screen.getByPlaceholderText(/e.g., javascript, react, css/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /post question/i })).toBeInTheDocument();
  });

  it('allows typing in the title field', async () => {
    renderPostQuestion();
    const titleInput = screen.getByPlaceholderText(/what's your programming question/i);

    await userEvent.type(titleInput, 'How do I use Redux Toolkit?');
    expect(titleInput).toHaveValue('How do I use Redux Toolkit?');
  });

  it('allows typing in the description field', async () => {
    renderPostQuestion();
    const descriptionInput = screen.getByPlaceholderText(/provide more details about your question/i);

    await userEvent.type(descriptionInput, 'I want to manage state effectively.');
    expect(descriptionInput).toHaveValue('I want to manage state effectively.');
  });

  it('allows typing in the tags field', async () => {
    renderPostQuestion();
    const tagsInput = screen.getByPlaceholderText(/e.g., javascript, react, css/i);

    await userEvent.type(tagsInput, 'javascript, react');
    expect(tagsInput).toHaveValue('javascript, react');
  });
});

// Edit mode at /question/:id/edit (spec 002, AC-3–9)
describe('PostQuestion edit mode', () => {
  const ALICE = { userId: 'user-1', token: 'mock-jwt-token-alice', name: 'Alice Johnson' };

  let putRequests = [];
  const onRequest = ({ request }) => {
    if (request.method === 'PUT') putRequests.push(request.url);
  };

  beforeEach(() => {
    putRequests = [];
    server.events.on('request:start', onRequest);
  });

  afterEach(() => {
    server.events.removeListener('request:start', onRequest);
  });

  // Stands in for the detail page and shows where we landed and with what state.
  const DetailProbe = () => {
    const location = useLocation();
    return (
      <div data-testid="detail-page">
        {location.pathname} {JSON.stringify(location.state)}
      </div>
    );
  };

  const renderEdit = ({
    userInfo = ALICE,
    currentQuestion = mockQuestions[0],
    questionId = 'question-1',
  } = {}) => {
    const store = configureStore({
      reducer: {
        question: questionReducer,
        user: () => ({ userInfo }),
      },
      preloadedState: {
        question: { questions: [], currentQuestion, loading: false, error: null },
      },
    });
    render(
      <Provider store={store}>
        <MemoryRouter initialEntries={[`/question/${questionId}/edit`]}>
          <Routes>
            <Route path="/question/:id/edit" element={<PostQuestion mode="edit" />} />
            <Route path="/question/:id" element={<DetailProbe />} />
            <Route path="/login" element={<div>Login page</div>} />
          </Routes>
        </MemoryRouter>
      </Provider>
    );
    return store;
  };

  const titleInput = () => screen.getByLabelText('Title');
  const descriptionInput = () => screen.getByLabelText('Description');
  const tagsInput = () => screen.getByLabelText('Tags (comma-separated)');

  it('pre-fills the form from the store, joining tags with ", "', () => {
    renderEdit();

    expect(screen.getByText('Edit question')).toBeInTheDocument();
    expect(titleInput()).toHaveValue('How do I manage state in React?');
    expect(descriptionInput()).toHaveValue(
      'I want to understand the best way to manage component state.'
    );
    expect(tagsInput()).toHaveValue('javascript, react');
    expect(screen.getByRole('button', { name: /save changes/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Improve with AI' })).toBeInTheDocument();
  });

  it('fetches and pre-fills when the store is empty', async () => {
    renderEdit({ currentQuestion: null });

    expect(await screen.findByDisplayValue('How do I manage state in React?')).toBeInTheDocument();
    expect(tagsInput()).toHaveValue('javascript, react');
  });

  it('fetches when the store holds a different question', async () => {
    renderEdit({ currentQuestion: mockQuestions[2] });
    expect(await screen.findByDisplayValue('How do I manage state in React?')).toBeInTheDocument();
  });

  it.each([
    ['title', () => titleInput(), 'Title is required'],
    ['description', () => descriptionInput(), 'Description is required'],
    ['tags', () => tagsInput(), 'Provide between 1 and 5 tags'],
  ])('shows an inline error for a blank %s and sends no request', async (_field, input, message) => {
    renderEdit();
    await userEvent.clear(input());
    await userEvent.type(input(), '   ');
    await userEvent.click(screen.getByRole('button', { name: /save changes/i }));

    expect(screen.getByText(message)).toBeInTheDocument();
    expect(input()).toHaveClass('is-invalid');
    expect(putRequests).toHaveLength(0);
  });

  it('rejects more than 5 tags and over-long tags inline', async () => {
    renderEdit();
    await userEvent.clear(tagsInput());
    await userEvent.type(tagsInput(), 'a, b, c, d, e, f');
    await userEvent.click(screen.getByRole('button', { name: /save changes/i }));
    expect(screen.getByText('Provide between 1 and 5 tags')).toBeInTheDocument();

    await userEvent.clear(tagsInput());
    await userEvent.type(tagsInput(), 'x'.repeat(31));
    await userEvent.click(screen.getByRole('button', { name: /save changes/i }));
    expect(screen.getByText('Each tag must be at most 30 characters')).toBeInTheDocument();
    expect(putRequests).toHaveLength(0);
  });

  it('saves with PUT, updates the store and navigates back with fromEdit', async () => {
    const store = renderEdit();
    await userEvent.clear(titleInput());
    await userEvent.type(titleInput(), 'How should I manage state in React?');
    await userEvent.clear(tagsInput());
    await userEvent.type(tagsInput(), 'react, redux');
    await userEvent.click(screen.getByRole('button', { name: /save changes/i }));

    expect(await screen.findByTestId('detail-page')).toHaveTextContent(
      '/question/question-1 {"fromEdit":true}'
    );
    expect(putRequests).toEqual(['http://localhost:3000/api/questions/question-1']);
    const saved = store.getState().question.currentQuestion;
    expect(saved.title).toBe('How should I manage state in React?');
    expect(saved.tags.map((t) => t.name)).toEqual(['react', 'redux']);
    expect(saved.editedAt).toBeTruthy();
    expect(saved.answers).toEqual(mockQuestions[0].answers);
  });

  it('disables the buttons and inputs while saving, sending only one request', async () => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    server.use(
      http.put('http://localhost:3000/api/questions/:id', async () => {
        await gate;
        return HttpResponse.json({ success: true, data: { ...mockQuestions[0] } });
      })
    );
    renderEdit();
    const save = screen.getByRole('button', { name: /save changes/i });
    await userEvent.dblClick(save);

    expect(await screen.findByRole('button', { name: /saving…/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(titleInput()).toHaveAttribute('readonly');
    expect(descriptionInput()).toHaveAttribute('readonly');
    expect(tagsInput()).toHaveAttribute('readonly');

    release();
    await screen.findByTestId('detail-page');
    expect(putRequests).toHaveLength(1);
  });

  it('Cancel navigates back without a request', async () => {
    renderEdit();
    await userEvent.type(titleInput(), ' (unsaved)');
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(await screen.findByTestId('detail-page')).toHaveTextContent('/question/question-1 null');
    expect(putRequests).toHaveLength(0);
  });

  it('Escape cancels too', async () => {
    renderEdit();
    await userEvent.click(titleInput());
    await userEvent.keyboard('{Escape}');
    expect(await screen.findByTestId('detail-page')).toBeInTheDocument();
    expect(putRequests).toHaveLength(0);
  });

  it.each([
    [403, 'Not authorized to update this question'],
    [400, 'Title is required'],
  ])('shows a server %i in an inline alert and keeps the input', async (status, message) => {
    server.use(
      http.put('http://localhost:3000/api/questions/:id', () =>
        HttpResponse.json({ success: false, message }, { status })
      )
    );
    renderEdit();
    await userEvent.type(titleInput(), '!');
    await userEvent.click(screen.getByRole('button', { name: /save changes/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(titleInput()).toHaveValue('How do I manage state in React?!');
    expect(screen.getByRole('button', { name: /save changes/i })).toBeEnabled();
    expect(screen.queryByTestId('detail-page')).not.toBeInTheDocument();
  });

  it('shows the session-expired message with a login link on 401', async () => {
    server.use(
      http.put('http://localhost:3000/api/questions/:id', () =>
        HttpResponse.json({ success: false, message: 'Token is not valid.' }, { status: 401 })
      )
    );
    renderEdit();
    await userEvent.click(screen.getByRole('button', { name: /save changes/i }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Your session has expired — please log in again.');
    expect(within(alert).getByRole('link', { name: 'Log in' })).toHaveAttribute('href', '/login');
  });

  it('shows "no longer exists" when the question was deleted meanwhile', async () => {
    server.use(
      http.put('http://localhost:3000/api/questions/:id', () =>
        HttpResponse.json({ success: false, message: 'Question not found' }, { status: 404 })
      )
    );
    renderEdit();
    await userEvent.click(screen.getByRole('button', { name: /save changes/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('This question no longer exists');
  });

  it('shows the guard message, and no form, to a non-author', async () => {
    renderEdit({ currentQuestion: mockQuestions[1], questionId: 'question-2' });

    expect(screen.getByText(/you can only edit your own questions/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /back to the question/i })).toHaveAttribute(
      'href',
      '/question/question-2'
    );
    expect(screen.queryByLabelText('Title')).not.toBeInTheDocument();
  });

  it('redirects a logged-out user to /login', () => {
    renderEdit({ userInfo: null });
    expect(screen.getByText('Login page')).toBeInTheDocument();
  });

  it('shows "Question not found" for an unknown ID', async () => {
    renderEdit({ currentQuestion: null, questionId: 'does-not-exist' });
    expect(await screen.findByText(/question not found/i)).toBeInTheDocument();
    expect(screen.queryByLabelText('Title')).not.toBeInTheDocument();
  });
});
