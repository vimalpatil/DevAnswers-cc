import { describe, it, expect } from 'vitest';
import {
  parseTagInput,
  validateTags,
  validateQuestionForm,
  validateAnswerText,
} from '../../../src/utils/postValidation';

describe('postValidation', () => {
  describe('parseTagInput', () => {
    it('splits, trims and drops blanks', () => {
      expect(parseTagInput('  react , , node,')).toEqual(['react', 'node']);
    });

    it('de-dupes case-insensitively, keeping the first spelling', () => {
      expect(parseTagInput('React, react, REACT, node')).toEqual(['React', 'node']);
    });

    it('returns an empty list for blank input', () => {
      expect(parseTagInput('')).toEqual([]);
      expect(parseTagInput(' , ')).toEqual([]);
    });
  });

  describe('validateTags', () => {
    it('accepts 1 to 5 tags', () => {
      expect(validateTags('a')).toBeNull();
      expect(validateTags('a, b, c, d, e')).toBeNull();
    });

    it.each(['', ' , ', 'a, b, c, d, e, f'])('rejects %j', (input) => {
      expect(validateTags(input)).toBe('Provide between 1 and 5 tags');
    });

    it('counts tags after de-duping', () => {
      expect(validateTags('a, b, c, d, e, A')).toBeNull();
    });

    it('allows 30 characters and rejects 31', () => {
      expect(validateTags('x'.repeat(30))).toBeNull();
      expect(validateTags('x'.repeat(31))).toBe('Each tag must be at most 30 characters');
    });
  });

  describe('validateQuestionForm', () => {
    const valid = { title: 'Title', description: 'Body', tags: 'react' };

    it('returns no errors for a valid form', () => {
      expect(validateQuestionForm(valid)).toEqual({});
    });

    it('reports blank or whitespace fields', () => {
      expect(validateQuestionForm({ title: '  ', description: '', tags: ' , ' })).toEqual({
        title: 'Title is required',
        description: 'Description is required',
        tags: 'Provide between 1 and 5 tags',
      });
    });

    it('reports over-long title and description', () => {
      const errors = validateQuestionForm({
        ...valid,
        title: 't'.repeat(201),
        description: 'd'.repeat(10001),
      });
      expect(errors.title).toBe('Title must be at most 200 characters');
      expect(errors.description).toBe('Description must be at most 10000 characters');
    });
  });

  describe('validateAnswerText', () => {
    it('accepts non-blank text', () => {
      expect(validateAnswerText('An answer')).toBeNull();
    });

    it.each(['', '   ', '\n\t'])('rejects %j', (text) => {
      expect(validateAnswerText(text)).toBe('Answer text is required');
    });

    it('rejects text over 10000 characters', () => {
      expect(validateAnswerText('a'.repeat(10001))).toBe(
        'Answer text must be at most 10000 characters',
      );
    });
  });
});
