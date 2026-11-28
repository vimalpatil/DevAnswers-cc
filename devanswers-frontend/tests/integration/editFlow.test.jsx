import React from 'react';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { server } from '../mocks/server';
import { mockUsers } from '../mocks/mockData';
import App from '../../src/App';
import userReducer from '../../src/reducers/userSlice';
import questionReducer, { editQuestion } from '../../src/reducers/questionSlice';
import themeReducer from '../../src/reducers/themeSlice';
import bookmarkReducer from '../../src/reducers/bookmarkSlice';

/**
 * Integration Tests: editing questions and answers through the whole App
 * (Redux + MSW + routing), spec 002 §11.4. App owns its BrowserRouter, so the
 * starting route is set with window.history.pushState.
 */

const alice = {
  token: mockUsers.user1.token,
  userId: mockUsers.user1.userId,
  name: mockUsers.user1.name,
};

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

describe('Edit Flow Integration Tests', () => {
  // GET /api/questions/:id calls, keyed by question ID
  let questionGets;
  let putRequests;

  beforeEach(() => {
    localStorage.clear();
    questionGets = {};
    putRequests = [];
    server.events.on('request:start', ({ request }) => {
      const { pathname } = new URL(request.url);
      const match = pathname.match(/^\/api\/questions\/([^/]+)$/);
      if (request.method === 'GET' && match) {
        questionGets[match[1]] = (questionGets[match[1]] || 0) + 1;
      }
      if (request.method === 'PUT') putRequests.push(pathname);
    });
  });

  afterEach(() => {
    server.events.removeAllListeners();
  });

  it('edits a question from its detail page and shows the result without a refetch', async () => {
    const store = renderApp('/question/question-1', createAppStore(alice));

    const pencil = await screen.findByRole('button', { name: 'Edit question' });
    expect(questionGets['question-1']).toBe(1);

    // Client-side navigation to the pre-filled edit form
    await userEvent.click(pencil);
    expect(await screen.findByText('Edit question')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/question/question-1/edit');
    const title = screen.getByLabelText('Title');
    const tags = screen.getByLabelText('Tags (comma-separated)');
    expect(title).toHaveValue('How do I manage state in React?');
    expect(tags).toHaveValue('javascript, react');

    await userEvent.clear(title);
    await userEvent.type(title, 'How should I manage state in React 19?');
    await userEvent.clear(tags);
    await userEvent.type(tags, 'react, redux');
    await userEvent.click(screen.getByRole('button', { name: /save changes/i }));

    // Back on the detail page with the saved values straight from the store
    expect(
      await screen.findByRole('heading', { name: 'How should I manage state in React 19?' })
    ).toBeInTheDocument();
    expect(window.location.pathname).toBe('/question/question-1');
    // Scope to the question body: the sidebar lists tags too
    const body = document.querySelector('.qcontent-body-card');
    expect(within(body).getByText('redux')).toBeInTheDocument();
    expect(within(body).queryByText('javascript')).not.toBeInTheDocument();
    const header = document.querySelector('.qcontent-header-card');
    expect(within(header).getByText(/^edited /)).toBeInTheDocument();
    // Answers were kept
    expect(screen.getByText('2 Answers')).toBeInTheDocument();

    expect(putRequests).toEqual(['/api/questions/question-1']);
    expect(questionGets['question-1']).toBe(1);
    expect(store.getState().question.loading).toBe(false);
  });

  it('edits your own answer inline and shows the new text and indicator', async () => {
    renderApp('/question/question-1', createAppStore(alice));

    const answerText = await screen.findByText(
      'You can also lift the state up to a common parent component.'
    );
    const card = answerText.closest('.alist-answer-card');
    // Only Alice's answer (answer-2) has a pencil
    expect(screen.getAllByRole('button', { name: 'Edit answer' })).toHaveLength(1);
    expect(within(card).queryByText(/^edited /)).not.toBeInTheDocument();

    await userEvent.click(within(card).getByRole('button', { name: 'Edit answer' }));
    const textarea = within(card).getByRole('textbox', { name: 'Edit answer' });
    await userEvent.clear(textarea);
    await userEvent.type(textarea, 'Lift state to the closest common ancestor.');
    await userEvent.click(within(card).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(within(card).queryByRole('textbox')).not.toBeInTheDocument());
    expect(card).toHaveTextContent('Lift state to the closest common ancestor.');
    expect(within(card).getByText(/^edited /)).toBeInTheDocument();
    expect(putRequests).toEqual(['/api/answers/answer-2']);
    expect(questionGets['question-1']).toBe(1);
  });

  describe('unauthorized attempts', () => {
    it("shows no pencils on someone else's question", async () => {
      renderApp('/question/question-2', createAppStore(alice));

      expect(await screen.findByRole('heading', { name: 'What is the virtual DOM?' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Edit question' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Edit answer' })).not.toBeInTheDocument();
    });

    it('shows no pencils to a logged-out reader', async () => {
      renderApp('/question/question-1', createAppStore());

      expect(await screen.findByRole('heading', { name: 'How do I manage state in React?' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /edit (question|answer)/i })).not.toBeInTheDocument();
    });

    it("guards a direct visit to the edit route of someone else's question", async () => {
      renderApp('/question/question-2/edit', createAppStore(alice));

      expect(await screen.findByText(/you can only edit your own questions/i)).toBeInTheDocument();
      expect(screen.queryByLabelText('Title')).not.toBeInTheDocument();
    });

    it('redirects a logged-out visit to the edit route to /login', async () => {
      renderApp('/question/question-1/edit', createAppStore());
      await waitFor(() => expect(window.location.pathname).toBe('/login'));
    });

    it('rejects a direct editQuestion dispatch for a post you do not own and leaves the store unchanged', async () => {
      const store = renderApp('/question/question-2', createAppStore(alice));
      await screen.findByRole('heading', { name: 'What is the virtual DOM?' });
      const before = store.getState().question;

      await expect(
        store
          .dispatch(
            editQuestion({ id: 'question-2', title: 'Hijacked', description: 'x', tags: 'react' })
          )
          .unwrap()
      ).rejects.toBe('Not authorized to update this question');

      expect(store.getState().question).toBe(before);
      expect(screen.getByRole('heading', { name: 'What is the virtual DOM?' })).toBeInTheDocument();
    });
  });
});
