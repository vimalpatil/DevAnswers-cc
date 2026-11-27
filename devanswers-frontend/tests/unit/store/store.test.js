import { describe, it, expect } from 'vitest';
import store from '../../../src/store';

describe('Redux Store Configuration', () => {
  it('should have all required reducers configured', () => {
    const state = store.getState();

    expect(state).toHaveProperty('user');
    expect(state).toHaveProperty('question');
    expect(state).toHaveProperty('theme');
    expect(state).toHaveProperty('bookmark');
  });

  it('should initialize bookmark state correctly', () => {
    const { bookmark } = store.getState();

    expect(bookmark.ids).toEqual({});
    expect(bookmark.items).toEqual([]);
    expect(bookmark.pending).toEqual({});
    expect(bookmark.idsStatus).toBe('idle');
    expect(bookmark.itemsStatus).toBe('idle');
    expect(bookmark.error).toBeNull();
  });

  it('should initialize user state correctly', () => {
    const state = store.getState();

    expect(state.user).toHaveProperty('userInfo');
  });

  it('should initialize question state correctly', () => {
    const state = store.getState();

    expect(state.question).toHaveProperty('questions');
    expect(state.question).toHaveProperty('currentQuestion');
    expect(state.question).toHaveProperty('loading');
    expect(state.question).toHaveProperty('error');
    expect(Array.isArray(state.question.questions)).toBe(true);
  });

  it('should initialize theme state correctly', () => {
    const state = store.getState();

    expect(state.theme).toHaveProperty('isDarkMode');
    expect(typeof state.theme.isDarkMode).toBe('boolean');
  });
});
