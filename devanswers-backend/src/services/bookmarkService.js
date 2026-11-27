import mongoose from "mongoose";
import Bookmark from "../models/Bookmark.js";
import Question from "../models/Question.js";
import { createAppError } from "../utils/createAppError.js";
import { withAnswerCounts } from "./answerCountHelper.js";

// The owning user always comes from the `userId` argument, which the
// controller takes from req.user.id (never from params, query or body).

const assertValidQuestionId = (questionId) => {
  if (!mongoose.Types.ObjectId.isValid(questionId)) {
    throw createAppError("Invalid question ID", 400);
  }
};

export const getBookmarksService = async (userId) => {
  const bookmarks = await Bookmark.find({ user: userId })
    .populate({
      path: "question",
      populate: [{ path: "author", select: "name" }, { path: "tags" }],
    })
    // _id breaks ties between bookmarks created in the same millisecond
    .sort({ createdAt: -1, _id: -1 });

  // Skip bookmarks whose question no longer exists
  const questions = bookmarks
    .filter((b) => b.question)
    .map((b) => ({
      ...(b.question.toObject?.() ?? b.question),
      bookmarkedAt: b.createdAt,
    }));

  return withAnswerCounts(questions);
};

export const getBookmarkIdsService = async (userId) => {
  const bookmarks = await Bookmark.find({ user: userId }).select("question");
  return bookmarks.map((b) => b.question.toString());
};

export const addBookmarkService = async (userId, questionId) => {
  assertValidQuestionId(questionId);

  const questionExists = await Question.exists({ _id: questionId });
  if (!questionExists) {
    throw createAppError("Question not found", 404);
  }

  const filter = { user: userId, question: questionId };
  let bookmark;
  try {
    bookmark = await Bookmark.findOneAndUpdate(
      filter,
      { $setOnInsert: filter },
      { upsert: true, new: true },
    );
  } catch (err) {
    // A concurrent upsert created the document first: treat as success
    if (err?.code !== 11000) throw err;
    bookmark = await Bookmark.findOne(filter);
  }

  return {
    questionId: questionId.toString(),
    bookmarked: true,
    bookmarkedAt: bookmark?.createdAt,
  };
};

export const removeBookmarkService = async (userId, questionId) => {
  assertValidQuestionId(questionId);

  // No question-existence check, so stale bookmarks can always be removed
  await Bookmark.deleteOne({ user: userId, question: questionId });

  return { questionId: questionId.toString(), bookmarked: false };
};

export const deleteBookmarksForQuestion = (questionId) =>
  Bookmark.deleteMany({ question: questionId });
