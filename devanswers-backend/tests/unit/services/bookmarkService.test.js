import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  getBookmarksService,
  getBookmarkIdsService,
  addBookmarkService,
  removeBookmarkService,
  deleteBookmarksForQuestion,
} from "../../../src/services/bookmarkService.js";
import Bookmark from "../../../src/models/Bookmark.js";
import Question from "../../../src/models/Question.js";
import Answer from "../../../src/models/Answer.js";

vi.mock("../../../src/models/Bookmark.js");
vi.mock("../../../src/models/Question.js");
vi.mock("../../../src/models/Answer.js");

const USER_ID = "507f1f77bcf86cd799439011";
const QUESTION_ID = "507f1f77bcf86cd799439022";

describe("bookmarkService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("addBookmarkService", () => {
    it("should throw 400 for an invalid question ID", async () => {
      await expect(addBookmarkService(USER_ID, "not-an-id")).rejects.toMatchObject({
        message: "Invalid question ID",
        statusCode: 400,
      });
    });

    it("should throw 404 when the question does not exist", async () => {
      Question.exists = vi.fn().mockResolvedValue(null);
      Bookmark.findOneAndUpdate = vi.fn();

      await expect(addBookmarkService(USER_ID, QUESTION_ID)).rejects.toMatchObject({
        message: "Question not found",
        statusCode: 404,
      });
      expect(Bookmark.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it("should create the bookmark via upsert scoped to the user", async () => {
      const createdAt = new Date("2026-11-20T09:30:00Z");
      Question.exists = vi.fn().mockResolvedValue({ _id: QUESTION_ID });
      Bookmark.findOneAndUpdate = vi.fn().mockResolvedValue({ createdAt });

      const result = await addBookmarkService(USER_ID, QUESTION_ID);

      const filter = { user: USER_ID, question: QUESTION_ID };
      expect(Bookmark.findOneAndUpdate).toHaveBeenCalledWith(
        filter,
        { $setOnInsert: filter },
        { upsert: true, new: true },
      );
      expect(result).toEqual({ questionId: QUESTION_ID, bookmarked: true, bookmarkedAt: createdAt });
    });

    it("should succeed when the question is already bookmarked", async () => {
      const createdAt = new Date("2026-01-01T00:00:00Z");
      Question.exists = vi.fn().mockResolvedValue({ _id: QUESTION_ID });
      Bookmark.findOneAndUpdate = vi.fn().mockResolvedValue({ createdAt });

      await addBookmarkService(USER_ID, QUESTION_ID);
      const result = await addBookmarkService(USER_ID, QUESTION_ID);

      expect(result.bookmarked).toBe(true);
      expect(result.bookmarkedAt).toEqual(createdAt);
    });

    it("should treat a duplicate-key error (E11000) as success", async () => {
      const createdAt = new Date("2026-01-01T00:00:00Z");
      Question.exists = vi.fn().mockResolvedValue({ _id: QUESTION_ID });
      Bookmark.findOneAndUpdate = vi
        .fn()
        .mockRejectedValue(Object.assign(new Error("dup"), { code: 11000 }));
      Bookmark.findOne = vi.fn().mockResolvedValue({ createdAt });

      const result = await addBookmarkService(USER_ID, QUESTION_ID);

      expect(Bookmark.findOne).toHaveBeenCalledWith({ user: USER_ID, question: QUESTION_ID });
      expect(result).toEqual({ questionId: QUESTION_ID, bookmarked: true, bookmarkedAt: createdAt });
    });

    it("should rethrow other database errors", async () => {
      Question.exists = vi.fn().mockResolvedValue({ _id: QUESTION_ID });
      Bookmark.findOneAndUpdate = vi.fn().mockRejectedValue(new Error("db down"));

      await expect(addBookmarkService(USER_ID, QUESTION_ID)).rejects.toThrow("db down");
    });
  });

  describe("removeBookmarkService", () => {
    it("should throw 400 for an invalid question ID", async () => {
      await expect(removeBookmarkService(USER_ID, "bad")).rejects.toMatchObject({
        message: "Invalid question ID",
        statusCode: 400,
      });
    });

    it("should delete the user's bookmark without checking the question exists", async () => {
      Bookmark.deleteOne = vi.fn().mockResolvedValue({ deletedCount: 1 });
      Question.exists = vi.fn();

      const result = await removeBookmarkService(USER_ID, QUESTION_ID);

      expect(Bookmark.deleteOne).toHaveBeenCalledWith({ user: USER_ID, question: QUESTION_ID });
      expect(Question.exists).not.toHaveBeenCalled();
      expect(result).toEqual({ questionId: QUESTION_ID, bookmarked: false });
    });

    it("should succeed when the bookmark does not exist", async () => {
      Bookmark.deleteOne = vi.fn().mockResolvedValue({ deletedCount: 0 });

      const result = await removeBookmarkService(USER_ID, QUESTION_ID);

      expect(result).toEqual({ questionId: QUESTION_ID, bookmarked: false });
    });
  });

  describe("getBookmarksService", () => {
    it("should sort by createdAt desc, drop orphans, and add bookmarkedAt and answerCount", async () => {
      const sortSpy = vi.fn().mockResolvedValue([
        { createdAt: new Date("2026-02-01T00:00:00Z"), question: { _id: "q2", title: "Second" } },
        { createdAt: new Date("2026-01-15T00:00:00Z"), question: null },
        {
          createdAt: new Date("2026-01-01T00:00:00Z"),
          question: { _id: "q1", toObject: () => ({ _id: "q1", title: "First" }) },
        },
      ]);
      const populateSpy = vi.fn().mockReturnValue({ sort: sortSpy });
      Bookmark.find = vi.fn().mockReturnValue({ populate: populateSpy });
      Answer.countDocuments = vi.fn().mockResolvedValue(4);

      const result = await getBookmarksService(USER_ID);

      expect(Bookmark.find).toHaveBeenCalledWith({ user: USER_ID });
      expect(populateSpy).toHaveBeenCalledWith({
        path: "question",
        populate: [{ path: "author", select: "name" }, { path: "tags" }],
      });
      expect(sortSpy).toHaveBeenCalledWith({ createdAt: -1, _id: -1 });
      expect(result).toEqual([
        { _id: "q2", title: "Second", bookmarkedAt: new Date("2026-02-01T00:00:00Z"), answerCount: 4 },
        { _id: "q1", title: "First", bookmarkedAt: new Date("2026-01-01T00:00:00Z"), answerCount: 4 },
      ]);
    });

    it("should return an empty array when the user has no bookmarks", async () => {
      Bookmark.find = vi.fn().mockReturnValue({
        populate: vi.fn().mockReturnValue({ sort: vi.fn().mockResolvedValue([]) }),
      });

      expect(await getBookmarksService(USER_ID)).toEqual([]);
    });
  });

  describe("getBookmarkIdsService", () => {
    it("should return question IDs as strings", async () => {
      const selectSpy = vi.fn().mockResolvedValue([
        { question: { toString: () => "q1" } },
        { question: { toString: () => "q2" } },
      ]);
      Bookmark.find = vi.fn().mockReturnValue({ select: selectSpy });

      const result = await getBookmarkIdsService(USER_ID);

      expect(Bookmark.find).toHaveBeenCalledWith({ user: USER_ID });
      expect(selectSpy).toHaveBeenCalledWith("question");
      expect(result).toEqual(["q1", "q2"]);
    });
  });

  describe("deleteBookmarksForQuestion", () => {
    it("should delete all bookmarks for the question", async () => {
      Bookmark.deleteMany = vi.fn().mockResolvedValue({ deletedCount: 3 });

      await deleteBookmarksForQuestion(QUESTION_ID);

      expect(Bookmark.deleteMany).toHaveBeenCalledWith({ question: QUESTION_ID });
    });
  });
});
