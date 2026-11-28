import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  getAllQuestionsService,
  getQuestionByIdService,
  createQuestionService,
  updateQuestionService,
  deleteQuestionService,
  upvoteQuestionService,
  downvoteQuestionService,
} from "../../../src/services/questionService.js";
import Question from "../../../src/models/Question.js";
import Answer from "../../../src/models/Answer.js";
import Tag from "../../../src/models/Tag.js";
import Bookmark from "../../../src/models/Bookmark.js";
import { handleVote } from "../../../src/services/voteService.js";
import {
  parseTagNames,
  resolveTagIds,
} from "../../../src/services/tagHelper.js";

// Mock the models and services
// Mock voteService since questionService delegates vote logic to it
vi.mock("../../../src/models/Question.js");
vi.mock("../../../src/models/Answer.js");
vi.mock("../../../src/models/Tag.js");
vi.mock("../../../src/models/Bookmark.js");
vi.mock("../../../src/services/voteService.js");
vi.mock("../../../src/services/tagHelper.js");

describe("questionService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getAllQuestionsService", () => {
    // Success case
    it("should return all questions with populated fields", async () => {
      // Arrange
      const mockQuestions = [
        {
          _id: "question1",
          title: "Question 1",
          author: { _id: "user1", name: "User 1" },
          tags: [{ _id: "tag1", name: "javascript" }],
        },
      ];

      Question.find = vi.fn().mockReturnValue({
        populate: vi.fn().mockReturnValue({
          populate: vi.fn().mockReturnValue({
            sort: vi.fn().mockResolvedValue(mockQuestions),
          }),
        }),
      });
      Answer.countDocuments = vi.fn().mockResolvedValue(3);

      // Act
      const result = await getAllQuestionsService();

      // Assert
      expect(Question.find).toHaveBeenCalledWith({});
      expect(result).toEqual([{ ...mockQuestions[0], answerCount: 3 }]);
      expect(result).toHaveLength(1);
    });

    // Edge case - sorted by createdAt
    it("should sort questions by createdAt descending, with _id as tiebreaker", async () => {
      // Arrange
      const sortSpy = vi.fn().mockResolvedValue([{ _id: "q1" }]);

      Question.find = vi.fn().mockReturnValue({
        populate: vi.fn().mockReturnValue({
          populate: vi.fn().mockReturnValue({
            sort: sortSpy,
          }),
        }),
      });
      Answer.countDocuments = vi.fn().mockResolvedValue(0);

      // Act
      await getAllQuestionsService();

      // Assert
      expect(sortSpy).toHaveBeenCalledWith({ createdAt: -1, _id: -1 });
    });

    // Error case - no questions found
    it("should throw 404 error when no questions exist", async () => {
      // Arrange
      Question.find = vi.fn().mockReturnValue({
        populate: vi.fn().mockReturnValue({
          populate: vi.fn().mockReturnValue({
            sort: vi.fn().mockResolvedValue([]),
          }),
        }),
      });

      // Act & Assert
      await expect(getAllQuestionsService()).rejects.toThrow(
        "No questions found",
      );
      await expect(getAllQuestionsService()).rejects.toMatchObject({
        statusCode: 404,
      });
    });

    // Error case - null result
    it("should throw 404 error when result is null", async () => {
      // Arrange
      Question.find = vi.fn().mockReturnValue({
        populate: vi.fn().mockReturnValue({
          populate: vi.fn().mockReturnValue({
            sort: vi.fn().mockResolvedValue(null),
          }),
        }),
      });

      // Act & Assert
      await expect(getAllQuestionsService()).rejects.toThrow(
        "No questions found",
      );
    });
  });

  describe("getQuestionByIdService", () => {
    // Success case
    it("should return question by id with populated fields and answers", async () => {
      // Arrange
      const mockPopulatedQuestion = {
        _id: "question123",
        title: "Test Question",
        author: { _id: "user1", name: "User 1" },
        tags: [{ _id: "tag1", name: "javascript" }],
        views: 1,
        toObject: vi.fn().mockReturnValue({
          _id: "question123",
          title: "Test Question",
          author: { _id: "user1", name: "User 1" },
          views: 1,
        }),
      };

      const mockAnswers = [{ _id: "answer1", answerText: "Test Answer" }];

      // Views are incremented and the document fetched in one atomic query
      Question.findByIdAndUpdate = vi.fn().mockReturnValue({
        populate: vi.fn().mockReturnValue({
          populate: vi.fn().mockResolvedValue(mockPopulatedQuestion),
        }),
      });

      Answer.find = vi.fn().mockReturnValue({
        populate: vi.fn().mockResolvedValue(mockAnswers),
      });

      // Act
      const result = await getQuestionByIdService("question123");

      // Assert
      expect(Question.findByIdAndUpdate).toHaveBeenCalledWith(
        "question123",
        { $inc: { views: 1 } },
        { new: true },
      );
      expect(result.answers).toEqual(mockAnswers);
    });

    // Edge case - view increment
    it("should increment views count atomically", async () => {
      // Arrange
      const mockPopulated = {
        _id: "question123",
        views: 6,
        toObject: vi.fn().mockReturnValue({ _id: "question123", views: 6 }),
      };

      Question.findByIdAndUpdate = vi.fn().mockReturnValue({
        populate: vi.fn().mockReturnValue({
          populate: vi.fn().mockResolvedValue(mockPopulated),
        }),
      });

      Answer.find = vi.fn().mockReturnValue({
        populate: vi.fn().mockResolvedValue([]),
      });

      // Act
      const result = await getQuestionByIdService("question123");

      // Assert
      expect(Question.findByIdAndUpdate).toHaveBeenCalledWith(
        "question123",
        { $inc: { views: 1 } },
        { new: true },
      );
      expect(result.views).toBe(6);
    });

    // Error case - question not found
    it("should throw 404 error if question not found", async () => {
      // Arrange
      Question.findByIdAndUpdate = vi.fn().mockReturnValue({
        populate: vi.fn().mockReturnValue({
          populate: vi.fn().mockResolvedValue(null),
        }),
      });

      // Act & Assert
      await expect(getQuestionByIdService("nonexistent")).rejects.toThrow(
        "Question not found",
      );
      await expect(getQuestionByIdService("nonexistent")).rejects.toMatchObject(
        {
          statusCode: 404,
        },
      );
    });

    // Failure case - database error
    it("should propagate database errors", async () => {
      // Arrange
      Question.findByIdAndUpdate = vi.fn().mockReturnValue({
        populate: vi.fn().mockReturnValue({
          populate: vi.fn().mockRejectedValue(new Error("Database error")),
        }),
      });

      // Act & Assert
      await expect(getQuestionByIdService("question123")).rejects.toThrow(
        "Database error",
      );
    });
  });

  describe("createQuestionService", () => {
    // Success case
    it("should create and return a new question with tags", async () => {
      // Arrange
      Tag.findOne = vi.fn().mockResolvedValue(null);

      const mockTagInstance = {
        _id: "tag123",
        save: vi.fn().mockResolvedValue(true),
      };
      Tag.mockImplementation(() => mockTagInstance);

      const mockQuestionInstance = {
        _id: "question123",
        title: "New Question",
        description: "Question description",
        tags: ["tag123", "tag123"],
        author: "user123",
        save: vi.fn().mockResolvedValue(true),
      };
      Question.mockImplementation(() => mockQuestionInstance);

      // Act
      const result = await createQuestionService({
        title: "New Question",
        description: "Question description",
        tags: "javascript, nodejs",
        author: "user123",
      });

      // Assert
      expect(mockQuestionInstance.save).toHaveBeenCalled();
      expect(result).toEqual(mockQuestionInstance);
    });

    // Edge case - reuse existing tags
    it("should reuse existing tags", async () => {
      // Arrange
      const existingTag = { _id: "existingTag123", name: "javascript" };
      Tag.findOne = vi
        .fn()
        .mockResolvedValueOnce(existingTag)
        .mockResolvedValueOnce(null);

      const mockNewTag = {
        _id: "newTag123",
        save: vi.fn().mockResolvedValue(true),
      };
      Tag.mockImplementation(() => mockNewTag);

      const mockQuestion = {
        _id: "question123",
        tags: ["existingTag123", "newTag123"],
        save: vi.fn().mockResolvedValue(true),
      };
      Question.mockImplementation(() => mockQuestion);

      // Act
      await createQuestionService({
        title: "Test",
        description: "Test",
        tags: "javascript, new-tag",
        author: "user123",
      });

      // Assert
      expect(Tag.findOne).toHaveBeenCalledTimes(2);
      expect(mockNewTag.save).toHaveBeenCalled();
    });

    // Edge case - trim whitespace from tags
    it("should handle tags with extra whitespace", async () => {
      // Arrange
      Tag.findOne = vi.fn().mockResolvedValue(null);
      Tag.mockImplementation(() => ({
        _id: "tag123",
        save: vi.fn().mockResolvedValue(true),
      }));

      Question.mockImplementation(() => ({
        _id: "q123",
        save: vi.fn().mockResolvedValue(true),
      }));

      // Act
      await createQuestionService({
        title: "Test",
        description: "Test",
        tags: "  javascript  ,  nodejs  ",
        author: "user123",
      });

      // Assert
      expect(Tag.findOne).toHaveBeenCalledWith({ name: "javascript" });
      expect(Tag.findOne).toHaveBeenCalledWith({ name: "nodejs" });
    });
  });

  describe("updateQuestionService", () => {
    const QUESTION_ID = "64c000000000000000000001";
    const AUTHOR_ID = "64a000000000000000000001";
    const OTHER_ID = "64a000000000000000000002";
    const TAG_A = "64d000000000000000000001";
    const TAG_B = "64d000000000000000000002";
    const author = { id: AUTHOR_ID, isAdmin: false };
    const validBody = {
      title: "New title",
      description: "New description",
      tags: "react, node",
    };

    const storedQuestion = (overrides = {}) => ({
      _id: QUESTION_ID,
      title: "Old title",
      description: "Old description",
      tags: [TAG_A, TAG_B],
      author: { toString: () => AUTHOR_ID },
      ...overrides,
    });

    const mockFindSelect = (doc) => {
      const select = vi.fn().mockResolvedValue(doc);
      Question.findById = vi.fn().mockReturnValue({ select });
      return select;
    };

    // findOneAndUpdate(...).populate(...).populate(...)
    const mockConditionalUpdate = (result) => {
      const populateTags = vi.fn().mockResolvedValue(result);
      const populateAuthor = vi.fn().mockReturnValue({ populate: populateTags });
      Question.findOneAndUpdate = vi
        .fn()
        .mockReturnValue({ populate: populateAuthor });
      return { populateAuthor, populateTags };
    };

    beforeEach(() => {
      parseTagNames.mockImplementation((input) =>
        input.split(",").map((t) => t.trim()),
      );
      resolveTagIds.mockResolvedValue([TAG_A, TAG_B]);
    });

    it("lets the author update with a conditional, whitelisted $set and a populated result", async () => {
      const select = mockFindSelect(storedQuestion());
      const populated = {
        _id: QUESTION_ID,
        title: "New title",
        author: { _id: AUTHOR_ID, name: "Alice" },
        tags: [{ _id: TAG_A, name: "react" }],
        editedAt: new Date(),
      };
      const { populateAuthor, populateTags } = mockConditionalUpdate(populated);

      const result = await updateQuestionService(
        QUESTION_ID,
        { title: "  New title ", description: " New description ", tags: "react, node" },
        author,
      );

      expect(select).toHaveBeenCalledWith("author title description tags");
      expect(parseTagNames).toHaveBeenCalledWith("react, node");
      expect(resolveTagIds).toHaveBeenCalledWith(["react", "node"]);
      expect(Question.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: QUESTION_ID, author: AUTHOR_ID },
        {
          $set: {
            title: "New title",
            description: "New description",
            tags: [TAG_A, TAG_B],
            editedAt: expect.any(Date),
          },
        },
        { new: true, runValidators: true },
      );
      expect(populateAuthor).toHaveBeenCalledWith({ path: "author", select: "name" });
      expect(populateTags).toHaveBeenCalledWith("tags");
      expect(result).toEqual(populated);
    });

    it("ignores extra body fields such as author, voteCount and editedAt", async () => {
      mockFindSelect(storedQuestion());
      mockConditionalUpdate({});

      await updateQuestionService(
        QUESTION_ID,
        { ...validBody, author: OTHER_ID, voteCount: 999, editedAt: null, views: 5 },
        author,
      );

      const [, update] = Question.findOneAndUpdate.mock.calls[0];
      expect(Object.keys(update.$set).sort()).toEqual([
        "description",
        "editedAt",
        "tags",
        "title",
      ]);
      expect(update.$set.editedAt).toBeInstanceOf(Date);
    });

    it("throws 400 for a malformed ID without querying", async () => {
      Question.findById = vi.fn();
      await expect(
        updateQuestionService("not-an-id", validBody, author),
      ).rejects.toMatchObject({ message: "Invalid question ID", statusCode: 400 });
      expect(Question.findById).not.toHaveBeenCalled();
    });

    it("throws 404 if the question does not exist", async () => {
      mockFindSelect(null);
      await expect(
        updateQuestionService(QUESTION_ID, validBody, author),
      ).rejects.toMatchObject({ message: "Question not found", statusCode: 404 });
    });

    it("throws 403 for a non-author", async () => {
      mockFindSelect(storedQuestion());
      Question.findOneAndUpdate = vi.fn();
      await expect(
        updateQuestionService(QUESTION_ID, validBody, { id: OTHER_ID, isAdmin: false }),
      ).rejects.toMatchObject({
        message: "Not authorized to update this question",
        statusCode: 403,
      });
      expect(Question.findOneAndUpdate).not.toHaveBeenCalled();
      expect(resolveTagIds).not.toHaveBeenCalled();
    });

    it("throws 403 for an admin who is not the author", async () => {
      mockFindSelect(storedQuestion());
      Question.findOneAndUpdate = vi.fn();
      await expect(
        updateQuestionService(QUESTION_ID, validBody, { id: OTHER_ID, isAdmin: true }),
      ).rejects.toMatchObject({ statusCode: 403 });
      expect(Question.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it("checks ownership before validating the body", async () => {
      mockFindSelect(storedQuestion());
      await expect(
        updateQuestionService(
          QUESTION_ID,
          { ...validBody, title: "   " },
          { id: OTHER_ID, isAdmin: false },
        ),
      ).rejects.toMatchObject({ statusCode: 403 });
    });

    it.each([
      ["missing", undefined],
      ["empty", ""],
      ["whitespace", "   "],
      ["a number", 7],
      ["an operator object", { $ne: "" }],
    ])("throws 400 when the title is %s", async (_label, title) => {
      mockFindSelect(storedQuestion());
      Question.findOneAndUpdate = vi.fn();
      await expect(
        updateQuestionService(QUESTION_ID, { ...validBody, title }, author),
      ).rejects.toMatchObject({ message: "Title is required", statusCode: 400 });
      expect(resolveTagIds).not.toHaveBeenCalled();
      expect(Question.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it.each([
      ["missing", undefined],
      ["empty", ""],
      ["whitespace", "  \n "],
      ["an array", ["x"]],
    ])("throws 400 when the description is %s", async (_label, description) => {
      mockFindSelect(storedQuestion());
      await expect(
        updateQuestionService(QUESTION_ID, { ...validBody, description }, author),
      ).rejects.toMatchObject({ message: "Description is required", statusCode: 400 });
      expect(resolveTagIds).not.toHaveBeenCalled();
    });

    it("throws 400 when the title or description is too long", async () => {
      mockFindSelect(storedQuestion());
      await expect(
        updateQuestionService(QUESTION_ID, { ...validBody, title: "t".repeat(201) }, author),
      ).rejects.toMatchObject({
        message: "Title must be at most 200 characters",
        statusCode: 400,
      });
      await expect(
        updateQuestionService(
          QUESTION_ID,
          { ...validBody, description: "d".repeat(10001) },
          author,
        ),
      ).rejects.toMatchObject({
        message: "Description must be at most 10000 characters",
        statusCode: 400,
      });
    });

    it("propagates a tag-rule 400 and never resolves tags", async () => {
      mockFindSelect(storedQuestion());
      const err = Object.assign(new Error("Provide between 1 and 5 tags"), {
        statusCode: 400,
      });
      parseTagNames.mockImplementation(() => {
        throw err;
      });
      Question.findOneAndUpdate = vi.fn();

      await expect(
        updateQuestionService(QUESTION_ID, { ...validBody, tags: " , " }, author),
      ).rejects.toMatchObject({ message: "Provide between 1 and 5 tags", statusCode: 400 });
      expect(resolveTagIds).not.toHaveBeenCalled();
      expect(Question.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it("skips the write and keeps editedAt when nothing changed", async () => {
      const select = vi.fn().mockResolvedValue(
        storedQuestion({ title: "Same", description: "Same body" }),
      );
      const current = { _id: QUESTION_ID, title: "Same", editedAt: null };
      const populateTags = vi.fn().mockResolvedValue(current);
      Question.findById = vi
        .fn()
        .mockReturnValueOnce({ select })
        .mockReturnValueOnce({ populate: vi.fn().mockReturnValue({ populate: populateTags }) });
      Question.findOneAndUpdate = vi.fn();

      const result = await updateQuestionService(
        QUESTION_ID,
        { title: " Same ", description: "Same body  ", tags: "react, node" },
        author,
      );

      expect(Question.findOneAndUpdate).not.toHaveBeenCalled();
      expect(result).toEqual(current);
    });

    it("treats a tag reorder as a change", async () => {
      mockFindSelect(storedQuestion({ title: "Same", description: "Same body" }));
      resolveTagIds.mockResolvedValue([TAG_B, TAG_A]);
      mockConditionalUpdate({});

      await updateQuestionService(
        QUESTION_ID,
        { title: "Same", description: "Same body", tags: "node, react" },
        author,
      );

      expect(Question.findOneAndUpdate).toHaveBeenCalled();
    });

    it("throws 404 when the conditional update matches nothing", async () => {
      mockFindSelect(storedQuestion());
      mockConditionalUpdate(null);
      await expect(
        updateQuestionService(QUESTION_ID, validBody, author),
      ).rejects.toMatchObject({ message: "Question not found", statusCode: 404 });
    });
  });

  describe("deleteQuestionService", () => {
    // Success case - author deletes
    it("should delete question when user is the author", async () => {
      // Arrange
      const mockQuestion = {
        _id: "question123",
        author: { toString: () => "user123" },
        title: "Test Question",
      };

      Question.findById = vi.fn().mockResolvedValue(mockQuestion);
      Question.findByIdAndDelete = vi.fn().mockResolvedValue(mockQuestion);
      Answer.deleteMany = vi.fn().mockResolvedValue({ deletedCount: 2 });
      Bookmark.deleteMany = vi.fn().mockResolvedValue({ deletedCount: 1 });

      const loggedInUser = { id: "user123", isAdmin: false };

      // Act
      const result = await deleteQuestionService("question123", loggedInUser);

      // Assert
      expect(Question.findByIdAndDelete).toHaveBeenCalledWith("question123");
      expect(Answer.deleteMany).toHaveBeenCalledWith({
        questionId: "question123",
      });
      expect(result).toEqual(mockQuestion);
    });

    // Cascade - bookmarks for the deleted question are removed (AC-13)
    it("should delete all bookmarks for the deleted question", async () => {
      // Arrange
      const mockQuestion = {
        _id: "question123",
        author: { toString: () => "user123" },
      };

      Question.findById = vi.fn().mockResolvedValue(mockQuestion);
      Question.findByIdAndDelete = vi.fn().mockResolvedValue(mockQuestion);
      Answer.deleteMany = vi.fn().mockResolvedValue({});
      Bookmark.deleteMany = vi.fn().mockResolvedValue({ deletedCount: 2 });

      // Act
      await deleteQuestionService("question123", { id: "user123", isAdmin: false });

      // Assert
      expect(Bookmark.deleteMany).toHaveBeenCalledWith({ question: "question123" });
    });

    // Success case - admin deletes
    it("should delete question when user is an admin", async () => {
      // Arrange
      const mockQuestion = {
        _id: "question123",
        author: { toString: () => "author456" },
      };

      Question.findById = vi.fn().mockResolvedValue(mockQuestion);
      Question.findByIdAndDelete = vi.fn().mockResolvedValue(mockQuestion);
      Answer.deleteMany = vi.fn().mockResolvedValue({});

      const loggedInUser = { id: "admin789", isAdmin: true };

      // Act
      const result = await deleteQuestionService("question123", loggedInUser);

      // Assert
      expect(Question.findByIdAndDelete).toHaveBeenCalledWith("question123");
      expect(result).toEqual(mockQuestion);
    });

    // Error case - not authorized
    it("should throw 403 error when user is not authorized", async () => {
      // Arrange
      const mockQuestion = {
        _id: "question123",
        author: { toString: () => "author456" },
      };

      Question.findById = vi.fn().mockResolvedValue(mockQuestion);

      const loggedInUser = { id: "otherUser789", isAdmin: false };

      // Act & Assert
      await expect(
        deleteQuestionService("question123", loggedInUser),
      ).rejects.toThrow("Not authorized to delete this question");
      await expect(
        deleteQuestionService("question123", loggedInUser),
      ).rejects.toMatchObject({ statusCode: 403 });
    });

    // Error case - question not found
    it("should throw 404 error for non-existent question", async () => {
      // Arrange
      Question.findById = vi.fn().mockResolvedValue(null);

      // Act & Assert
      await expect(
        deleteQuestionService("nonexistent", { id: "user123", isAdmin: false }),
      ).rejects.toThrow("Question not found");
      await expect(
        deleteQuestionService("nonexistent", { id: "user123", isAdmin: false }),
      ).rejects.toMatchObject({ statusCode: 404 });
    });

    // Edge case - deletes related answers
    it("should delete related answers when deleting a question", async () => {
      // Arrange
      const mockQuestion = {
        _id: "question123",
        author: { toString: () => "user123" },
      };

      Question.findById = vi.fn().mockResolvedValue(mockQuestion);
      Question.findByIdAndDelete = vi.fn().mockResolvedValue(mockQuestion);
      Answer.deleteMany = vi.fn().mockResolvedValue({ deletedCount: 3 });

      // Act
      await deleteQuestionService("question123", {
        id: "user123",
        isAdmin: false,
      });

      // Assert
      expect(Answer.deleteMany).toHaveBeenCalledWith({
        questionId: "question123",
      });
    });
  });

  describe("upvoteQuestionService", () => {
    // Success case
    it("should call handleVote with correct parameters", async () => {
      // Arrange
      const mockDocument = {
        upvotes: ["user123"],
        downvotes: [],
        voteCount: 1,
      };
      handleVote.mockResolvedValue(mockDocument);

      // Act
      const result = await upvoteQuestionService("questionId", "user123");

      // Assert
      expect(handleVote).toHaveBeenCalledWith(
        Question,
        "questionId",
        "user123",
        "upvote",
      );
      expect(result).toEqual(mockDocument);
    });

    // Error case - handleVote returns null
    it("should throw error when handleVote returns null", async () => {
      // Arrange
      handleVote.mockResolvedValue(null);

      // Act & Assert
      await expect(
        upvoteQuestionService("questionId", "user123"),
      ).rejects.toThrow("Failed to upvote question");
    });
  });

  describe("downvoteQuestionService", () => {
    // Success case
    it("should call handleVote with correct parameters", async () => {
      // Arrange
      const mockDocument = {
        upvotes: [],
        downvotes: ["user123"],
        voteCount: -1,
      };
      handleVote.mockResolvedValue(mockDocument);

      // Act
      const result = await downvoteQuestionService("questionId", "user123");

      // Assert
      expect(handleVote).toHaveBeenCalledWith(
        Question,
        "questionId",
        "user123",
        "downvote",
      );
      expect(result).toEqual(mockDocument);
    });

    // Error case - handleVote returns null
    it("should throw error when handleVote returns null", async () => {
      // Arrange
      handleVote.mockResolvedValue(null);

      // Act & Assert
      await expect(
        downvoteQuestionService("questionId", "user123"),
      ).rejects.toThrow("Failed to downvote question");
    });
  });
});
