import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getBookmarks,
  getBookmarkIds,
  addBookmark,
  removeBookmark,
} from '../../../src/controllers/bookmarkController.js';
import * as bookmarkService from '../../../src/services/bookmarkService.js';

// Mock the bookmark service
vi.mock('../../../src/services/bookmarkService.js');

describe('bookmarkController', () => {
  let req, res;

  beforeEach(() => {
    vi.clearAllMocks();

    // A user ID planted in params/body/query must never be used (AC-7)
    req = {
      user: { id: 'user123', isAdmin: false },
      params: { questionId: 'question123', userId: 'attacker' },
      body: { userId: 'attacker', user: 'attacker' },
      query: { userId: 'attacker' },
    };

    res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };
  });

  describe('getBookmarks', () => {
    it('should fetch bookmarks for req.user.id and return 200', async () => {
      const mockData = [{ _id: 'q1', bookmarkedAt: '2026-11-20T09:30:00.000Z' }];
      bookmarkService.getBookmarksService = vi.fn().mockResolvedValue(mockData);

      await getBookmarks(req, res);

      expect(bookmarkService.getBookmarksService).toHaveBeenCalledWith('user123');
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: 'Bookmarks fetched successfully',
        data: mockData,
      });
    });

    it('should propagate service errors', async () => {
      bookmarkService.getBookmarksService = vi.fn().mockRejectedValue(new Error('boom'));

      await expect(getBookmarks(req, res)).rejects.toThrow('boom');
      expect(res.status).not.toHaveBeenCalled();
    });
  });

  describe('getBookmarkIds', () => {
    it('should fetch ids for req.user.id and return 200', async () => {
      bookmarkService.getBookmarkIdsService = vi.fn().mockResolvedValue(['q1', 'q2']);

      await getBookmarkIds(req, res);

      expect(bookmarkService.getBookmarkIdsService).toHaveBeenCalledWith('user123');
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: 'Bookmark IDs fetched successfully',
        data: ['q1', 'q2'],
      });
    });

    it('should propagate service errors', async () => {
      bookmarkService.getBookmarkIdsService = vi.fn().mockRejectedValue(new Error('boom'));

      await expect(getBookmarkIds(req, res)).rejects.toThrow('boom');
    });
  });

  describe('addBookmark', () => {
    it('should add a bookmark for req.user.id and the path questionId', async () => {
      const data = { questionId: 'question123', bookmarked: true, bookmarkedAt: '2026-11-20T09:30:00.000Z' };
      bookmarkService.addBookmarkService = vi.fn().mockResolvedValue(data);

      await addBookmark(req, res);

      expect(bookmarkService.addBookmarkService).toHaveBeenCalledWith('user123', 'question123');
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: 'Question bookmarked',
        data,
      });
    });

    it('should propagate service errors', async () => {
      const err = Object.assign(new Error('Question not found'), { statusCode: 404 });
      bookmarkService.addBookmarkService = vi.fn().mockRejectedValue(err);

      await expect(addBookmark(req, res)).rejects.toBe(err);
    });
  });

  describe('removeBookmark', () => {
    it('should remove the bookmark for req.user.id and the path questionId', async () => {
      const data = { questionId: 'question123', bookmarked: false };
      bookmarkService.removeBookmarkService = vi.fn().mockResolvedValue(data);

      await removeBookmark(req, res);

      expect(bookmarkService.removeBookmarkService).toHaveBeenCalledWith('user123', 'question123');
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: 'Bookmark removed',
        data,
      });
    });

    it('should propagate service errors', async () => {
      bookmarkService.removeBookmarkService = vi.fn().mockRejectedValue(new Error('Invalid question ID'));

      await expect(removeBookmark(req, res)).rejects.toThrow('Invalid question ID');
    });
  });
});
