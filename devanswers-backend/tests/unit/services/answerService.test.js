import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getAnswersByQuestionIdService,
  createAnswerService,
  updateAnswerService,
  deleteAnswerService,
  upvoteAnswerService,
  downvoteAnswerService,
} from '../../../src/services/answerService.js';
import Answer from '../../../src/models/Answer.js';
import { handleVote } from '../../../src/services/voteService.js';

// Mock the Answer model and voteService
vi.mock('../../../src/models/Answer.js');
vi.mock('../../../src/services/voteService.js');

describe('answerService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getAnswersByQuestionIdService', () => {
    // Success case
    it('should return all answers for a question with populated author', async () => {
      // Arrange
      const mockAnswers = [
        { _id: 'answer1', answerText: 'Answer 1', author: { name: 'User 1' } },
        { _id: 'answer2', answerText: 'Answer 2', author: { name: 'User 2' } },
      ];

      Answer.find = vi.fn().mockReturnValue({
        populate: vi.fn().mockResolvedValue(mockAnswers),
      });

      // Act
      const result = await getAnswersByQuestionIdService('question123');

      // Assert
      expect(Answer.find).toHaveBeenCalledWith({ questionId: 'question123' });
      expect(result).toEqual(mockAnswers);
      expect(result).toHaveLength(2);
    });

    // Edge case - populate with author name
    it('should populate author field with name only', async () => {
      // Arrange
      const populateSpy = vi.fn().mockResolvedValue([{ _id: 'a1' }]);

      Answer.find = vi.fn().mockReturnValue({
        populate: populateSpy,
      });

      // Act
      await getAnswersByQuestionIdService('question123');

      // Assert
      expect(populateSpy).toHaveBeenCalledWith('author', 'name');
    });

    // Error case - no answers found
    it('should throw 404 error when no answers exist', async () => {
      // Arrange
      Answer.find = vi.fn().mockReturnValue({
        populate: vi.fn().mockResolvedValue([]),
      });

      // Act & Assert
      await expect(
        getAnswersByQuestionIdService('question123')
      ).rejects.toThrow('No answers found for this question');
      await expect(
        getAnswersByQuestionIdService('question123')
      ).rejects.toMatchObject({ statusCode: 404 });
    });

    // Failure case - database error
    it('should propagate database errors', async () => {
      // Arrange
      Answer.find = vi.fn().mockReturnValue({
        populate: vi.fn().mockRejectedValue(new Error('Database error')),
      });

      // Act & Assert
      await expect(
        getAnswersByQuestionIdService('question123')
      ).rejects.toThrow('Database error');
    });
  });

  describe('createAnswerService', () => {
    // Success case
    it('should create and return populated answer', async () => {
      // Arrange
      const answerData = {
        questionId: 'question123',
        answerText: 'This is my answer',
        author: 'user123',
      };

      const mockNewAnswer = {
        _id: 'answer123',
        ...answerData,
        save: vi.fn().mockResolvedValue(true),
      };

      const mockPopulatedAnswer = {
        _id: 'answer123',
        ...answerData,
        author: { _id: 'user123', name: 'Test User' },
      };

      Answer.mockImplementation(() => mockNewAnswer);

      Answer.findById = vi.fn().mockReturnValue({
        populate: vi.fn().mockResolvedValue(mockPopulatedAnswer),
      });

      // Act
      const result = await createAnswerService(answerData);

      // Assert
      expect(mockNewAnswer.save).toHaveBeenCalled();
      expect(Answer.findById).toHaveBeenCalledWith('answer123');
      expect(result).toEqual(mockPopulatedAnswer);
      expect(result.author).toHaveProperty('name');
    });

    // Error case - populate fails
    it('should throw 500 error if populated answer is not found', async () => {
      // Arrange
      const mockNewAnswer = {
        _id: 'answer123',
        save: vi.fn().mockResolvedValue(true),
      };

      Answer.mockImplementation(() => mockNewAnswer);

      Answer.findById = vi.fn().mockReturnValue({
        populate: vi.fn().mockResolvedValue(null),
      });

      // Act & Assert
      await expect(
        createAnswerService({ questionId: 'q123', answerText: 'Test', author: 'u123' })
      ).rejects.toThrow('Failed to populate answer after saving');
      await expect(
        createAnswerService({ questionId: 'q123', answerText: 'Test', author: 'u123' })
      ).rejects.toMatchObject({ statusCode: 500 });
    });

    // Failure case - database error during save
    it('should propagate database errors during creation', async () => {
      // Arrange
      const mockNewAnswer = {
        _id: 'answer123',
        save: vi.fn().mockRejectedValue(new Error('Save failed')),
      };

      Answer.mockImplementation(() => mockNewAnswer);

      // Act & Assert
      await expect(
        createAnswerService({ questionId: 'q123', answerText: 'Test', author: 'u123' })
      ).rejects.toThrow('Save failed');
    });
  });

  describe('updateAnswerService', () => {
    const ANSWER_ID = '64b000000000000000000001';
    const AUTHOR_ID = '64a000000000000000000001';
    const OTHER_ID = '64a000000000000000000002';
    const author = { id: AUTHOR_ID, isAdmin: false };

    // findById(...).select(...) resolves to the stored answer
    const mockFindSelect = (doc) => {
      const select = vi.fn().mockResolvedValue(doc);
      Answer.findById = vi.fn().mockReturnValue({ select });
      return select;
    };

    const storedAnswer = (overrides = {}) => ({
      _id: ANSWER_ID,
      answerText: 'Old text',
      author: { toString: () => AUTHOR_ID },
      ...overrides,
    });

    it('lets the author update with a conditional, whitelisted $set', async () => {
      const select = mockFindSelect(storedAnswer());
      const populated = { _id: ANSWER_ID, answerText: 'New text', editedAt: new Date() };
      const populate = vi.fn().mockResolvedValue(populated);
      Answer.findOneAndUpdate = vi.fn().mockReturnValue({ populate });

      const result = await updateAnswerService(ANSWER_ID, '  New text  ', author);

      expect(Answer.findById).toHaveBeenCalledWith(ANSWER_ID);
      expect(select).toHaveBeenCalledWith('author answerText');
      expect(Answer.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: ANSWER_ID, author: AUTHOR_ID },
        { $set: { answerText: 'New text', editedAt: expect.any(Date) } },
        { new: true, runValidators: true },
      );
      const [, update] = Answer.findOneAndUpdate.mock.calls[0];
      expect(Object.keys(update.$set).sort()).toEqual(['answerText', 'editedAt']);
      expect(populate).toHaveBeenCalledWith('author', 'name');
      expect(result).toEqual(populated);
    });

    it('throws 400 for a malformed ID without querying', async () => {
      Answer.findById = vi.fn();
      await expect(updateAnswerService('not-an-id', 'text', author)).rejects.toMatchObject({
        message: 'Invalid answer ID',
        statusCode: 400,
      });
      expect(Answer.findById).not.toHaveBeenCalled();
    });

    it('throws 404 if the answer does not exist', async () => {
      mockFindSelect(null);
      await expect(updateAnswerService(ANSWER_ID, 'text', author)).rejects.toMatchObject({
        message: 'Answer not found',
        statusCode: 404,
      });
    });

    it('throws 403 for a non-author', async () => {
      mockFindSelect(storedAnswer());
      Answer.findOneAndUpdate = vi.fn();
      await expect(
        updateAnswerService(ANSWER_ID, 'Hacked', { id: OTHER_ID, isAdmin: false }),
      ).rejects.toMatchObject({ message: 'Not authorized to update this answer', statusCode: 403 });
      expect(Answer.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('throws 403 for an admin who is not the author', async () => {
      mockFindSelect(storedAnswer());
      Answer.findOneAndUpdate = vi.fn();
      await expect(
        updateAnswerService(ANSWER_ID, 'Admin edit', { id: OTHER_ID, isAdmin: true }),
      ).rejects.toMatchObject({ statusCode: 403 });
      expect(Answer.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('checks ownership before validating the body', async () => {
      mockFindSelect(storedAnswer());
      await expect(
        updateAnswerService(ANSWER_ID, '   ', { id: OTHER_ID, isAdmin: false }),
      ).rejects.toMatchObject({ statusCode: 403 });
    });

    it.each([
      ['undefined', undefined],
      ['empty', ''],
      ['whitespace', '   '],
      ['a number', 42],
      ['an object', { $ne: '' }],
    ])('throws 400 when answerText is %s', async (_label, value) => {
      mockFindSelect(storedAnswer());
      Answer.findOneAndUpdate = vi.fn();
      await expect(updateAnswerService(ANSWER_ID, value, author)).rejects.toMatchObject({
        message: 'Answer text is required',
        statusCode: 400,
      });
      expect(Answer.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('throws 400 when answerText is longer than 10000 characters', async () => {
      mockFindSelect(storedAnswer());
      await expect(
        updateAnswerService(ANSWER_ID, 'a'.repeat(10001), author),
      ).rejects.toMatchObject({
        message: 'Answer text must be at most 10000 characters',
        statusCode: 400,
      });
    });

    it('skips the write and keeps editedAt when nothing changed', async () => {
      const current = { _id: ANSWER_ID, answerText: 'Old text', editedAt: null };
      const populate = vi.fn().mockResolvedValue(current);
      const select = vi.fn().mockResolvedValue(storedAnswer());
      Answer.findById = vi.fn()
        .mockReturnValueOnce({ select })
        .mockReturnValueOnce({ populate });
      Answer.findOneAndUpdate = vi.fn();

      const result = await updateAnswerService(ANSWER_ID, '  Old text ', author);

      expect(Answer.findOneAndUpdate).not.toHaveBeenCalled();
      expect(result).toEqual(current);
    });

    it('throws 404 when the conditional update matches nothing', async () => {
      mockFindSelect(storedAnswer());
      Answer.findOneAndUpdate = vi.fn().mockReturnValue({
        populate: vi.fn().mockResolvedValue(null),
      });
      await expect(updateAnswerService(ANSWER_ID, 'New text', author)).rejects.toMatchObject({
        message: 'Answer not found',
        statusCode: 404,
      });
    });
  });

  describe('deleteAnswerService', () => {
    // Success case
    it('should delete answer successfully', async () => {
      // Arrange
      const loggedInUser = { id: 'user123', isAdmin: false };
      const mockAnswer = {
        _id: 'answer123',
        answerText: 'Deleted answer',
        author: { toString: () => 'user123' },
      };

      Answer.findById = vi.fn().mockResolvedValue(mockAnswer);
      Answer.findByIdAndDelete = vi.fn().mockResolvedValue(mockAnswer);

      // Act
      await deleteAnswerService('answer123', loggedInUser);

      // Assert
      expect(Answer.findById).toHaveBeenCalledWith('answer123');
      expect(Answer.findByIdAndDelete).toHaveBeenCalledWith('answer123');
    });

    // Error case - answer not found
    it('should throw 404 if answer not found during delete', async () => {
      // Arrange
      const loggedInUser = { id: 'user123', isAdmin: false };
      Answer.findById = vi.fn().mockResolvedValue(null);

      // Act & Assert
      await expect(
        deleteAnswerService('nonexistent', loggedInUser)
      ).rejects.toThrow('Answer not found');
      await expect(
        deleteAnswerService('nonexistent', loggedInUser)
      ).rejects.toMatchObject({ statusCode: 404 });
    });

    // Authorization case - not author or admin
    it('should throw 403 if user is not the author or admin', async () => {
      // Arrange
      const loggedInUser = { id: 'otherUser', isAdmin: false };
      const mockAnswer = {
        _id: 'answer123',
        author: { toString: () => 'user123' },
        answerText: 'Original text',
      };
      Answer.findById = vi.fn().mockResolvedValue(mockAnswer);

      // Act & Assert
      await expect(
        deleteAnswerService('answer123', loggedInUser)
      ).rejects.toThrow('Not authorized to delete this answer');
      await expect(
        deleteAnswerService('answer123', loggedInUser)
      ).rejects.toMatchObject({ statusCode: 403 });
    });
  });

  describe('upvoteAnswerService', () => {
    // Success case
    it('should call handleVote with correct parameters', async () => {
      // Arrange
      const mockDocument = {
        _id: 'answer123',
        upvotes: ['user123'],
        downvotes: [],
        voteCount: 1,
      };
      handleVote.mockResolvedValue(mockDocument);

      // Act
      const result = await upvoteAnswerService('answer123', 'user123');

      // Assert
      expect(handleVote).toHaveBeenCalledWith(Answer, 'answer123', 'user123', 'upvote');
      expect(result).toEqual(mockDocument);
    });

    // Error case - handleVote returns null
    it('should throw error when handleVote returns null', async () => {
      // Arrange
      handleVote.mockResolvedValue(null);

      // Act & Assert
      await expect(
        upvoteAnswerService('answer123', 'user123')
      ).rejects.toThrow('Failed to upvote answer');
    });
  });

  describe('downvoteAnswerService', () => {
    // Success case
    it('should call handleVote with correct parameters', async () => {
      // Arrange
      const mockDocument = {
        _id: 'answer123',
        upvotes: [],
        downvotes: ['user123'],
        voteCount: -1,
      };
      handleVote.mockResolvedValue(mockDocument);

      // Act
      const result = await downvoteAnswerService('answer123', 'user123');

      // Assert
      expect(handleVote).toHaveBeenCalledWith(Answer, 'answer123', 'user123', 'downvote');
      expect(result).toEqual(mockDocument);
    });

    // Error case - handleVote returns null
    it('should throw error when handleVote returns null', async () => {
      // Arrange
      handleVote.mockResolvedValue(null);

      // Act & Assert
      await expect(
        downvoteAnswerService('answer123', 'user123')
      ).rejects.toThrow('Failed to downvote answer');
    });
  });
});
