// Unit tests for questionSlice.js using Vitest. The tests should verify:
// - The initial state is correctly defined.
// - Reducer state transitions for fetchQuestions (pending, fulfilled, rejected).
// - Creating a new question adds it to the state (postQuestion fulfilled, rejected).
//
// Uses the direct reducer + action creator pattern (same as MLS reducer tests):
// questionReducer(state, thunkAction.fulfilled(payload)) — no service mocking needed.

import { describe, it, expect } from 'vitest';
import questionReducer, {
  fetchQuestions,
  postQuestion,
  editQuestion,
  editAnswer,
} from '../../../src/reducers/questionSlice.js';

describe('questionSlice', () => {
  const initialState = {
    questions: [],
    currentQuestion: null,
    loading: false,
    error: null,
  };

  describe('initial state', () => {
    it('should return initial state', () => {
      const state = questionReducer(undefined, { type: 'unknown' });
      expect(state).toEqual(initialState);
    });
  });

  describe('fetchQuestions async thunk', () => {
    it('should handle pending state', () => {
      const state = questionReducer(initialState, fetchQuestions.pending());

      expect(state.loading).toBe(true);
      expect(state.error).toBeNull();
    });

    it('should handle fulfilled state and populate questions', () => {
      const mockQuestions = [
        { _id: 'q1', title: 'First Question' },
        { _id: 'q2', title: 'Second Question' },
      ];

      const state = questionReducer(
        initialState,
        fetchQuestions.fulfilled(mockQuestions, '')
      );

      expect(state.loading).toBe(false);
      expect(state.questions).toEqual(mockQuestions);
      expect(state.questions).toHaveLength(2);
      expect(state.error).toBeNull();
    });

    it('should handle rejected state', () => {
      const errorMessage = 'Failed to fetch questions';
      const state = questionReducer(
        initialState,
        fetchQuestions.rejected(null, '', null, errorMessage)
      );

      expect(state.loading).toBe(false);
      expect(state.error).toBe(errorMessage);
    });
  });

  describe('postQuestion async thunk', () => {
    it('should add new question to list on fulfilled', () => {
      const existingState = {
        ...initialState,
        questions: [{ _id: 'q1', title: 'Existing Question' }],
      };

      const newQuestion = {
        _id: 'q3',
        title: 'New Question',
        description: 'Description',
        tags: ['redux'],
      };

      const state = questionReducer(
        existingState,
        postQuestion.fulfilled(newQuestion, '', {})
      );

      expect(state.questions).toHaveLength(2);
      expect(state.questions).toContainEqual(newQuestion);
      expect(state.currentQuestion).toEqual(newQuestion);
      expect(state.loading).toBe(false);
    });

    it('should set error on rejected', () => {
      const errorMessage = 'Failed to post question';
      const state = questionReducer(
        initialState,
        postQuestion.rejected(null, '', {}, errorMessage)
      );

      expect(state.loading).toBe(false);
      expect(state.error).toBe(errorMessage);
    });
  });
});

// Edit thunks (spec 002 §6.3): fulfilled-only merges that never touch loading/error.
describe('questionSlice edit thunks', () => {
  const answers = [
    { _id: 'a1', answerText: 'First', voteCount: 3, editedAt: null },
    { _id: 'a2', answerText: 'Second', voteCount: 1, editedAt: null },
  ];
  const baseState = {
    questions: [
      { _id: 'q1', title: 'Old', description: 'Old body', tags: [], voteCount: 5, answerCount: 2 },
      { _id: 'q2', title: 'Other', description: 'Other body', tags: [] },
    ],
    currentQuestion: {
      _id: 'q1',
      title: 'Old',
      description: 'Old body',
      tags: [{ _id: 't1', name: 'react' }],
      voteCount: 5,
      upvotes: ['u9'],
      answers,
      editedAt: null,
    },
    loading: false,
    error: 'previous error',
  };

  const savedQuestion = {
    _id: 'q1',
    title: 'New',
    description: 'New body',
    tags: [{ _id: 't2', name: 'node' }],
    voteCount: 0, // stale vote data from the server must not overwrite the store
    editedAt: '2026-02-01T00:00:00.000Z',
    updatedAt: '2026-02-01T00:00:00.000Z',
  };

  it('editQuestion.fulfilled merges into currentQuestion and keeps answers and votes', () => {
    const state = questionReducer(
      baseState,
      editQuestion.fulfilled(savedQuestion, '', { id: 'q1' })
    );

    expect(state.currentQuestion).toMatchObject({
      title: 'New',
      description: 'New body',
      tags: [{ _id: 't2', name: 'node' }],
      editedAt: '2026-02-01T00:00:00.000Z',
      updatedAt: '2026-02-01T00:00:00.000Z',
      voteCount: 5,
      upvotes: ['u9'],
    });
    expect(state.currentQuestion.answers).toEqual(answers);
  });

  it('editQuestion.fulfilled updates the matching questions[] entry only', () => {
    const state = questionReducer(
      baseState,
      editQuestion.fulfilled(savedQuestion, '', { id: 'q1' })
    );

    expect(state.questions[0]).toMatchObject({ title: 'New', voteCount: 5, answerCount: 2 });
    expect(state.questions[1]).toEqual(baseState.questions[1]);
  });

  it('editQuestion.fulfilled leaves a different currentQuestion alone', () => {
    const state = questionReducer(
      { ...baseState, currentQuestion: { ...baseState.currentQuestion, _id: 'q2' } },
      editQuestion.fulfilled(savedQuestion, '', { id: 'q1' })
    );
    expect(state.currentQuestion.title).toBe('Old');
  });

  it('editAnswer.fulfilled replaces only the matching answer', () => {
    const state = questionReducer(
      baseState,
      editAnswer.fulfilled(
        { _id: 'a2', answerText: 'Edited', voteCount: 0, editedAt: '2026-02-02T00:00:00.000Z' },
        '',
        { answerId: 'a2' }
      )
    );

    expect(state.currentQuestion.answers[0]).toEqual(answers[0]);
    expect(state.currentQuestion.answers[1]).toEqual({
      _id: 'a2',
      answerText: 'Edited',
      voteCount: 1,
      editedAt: '2026-02-02T00:00:00.000Z',
    });
  });

  it.each([
    ['editQuestion.pending', editQuestion.pending('', { id: 'q1' })],
    ['editQuestion.fulfilled', editQuestion.fulfilled(savedQuestion, '', { id: 'q1' })],
    ['editQuestion.rejected', editQuestion.rejected(null, '', { id: 'q1' }, 'Nope')],
    ['editAnswer.pending', editAnswer.pending('', { answerId: 'a1' })],
    ['editAnswer.rejected', editAnswer.rejected(null, '', { answerId: 'a1' }, 'Nope')],
  ])('%s never changes loading or error', (_label, action) => {
    const state = questionReducer(baseState, action);
    expect(state.loading).toBe(false);
    expect(state.error).toBe('previous error');
  });
});
