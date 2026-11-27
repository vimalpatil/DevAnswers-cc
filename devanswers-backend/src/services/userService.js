import mongoose from "mongoose";
import User from "../models/User.js";
import Question from "../models/Question.js";
import Answer from "../models/Answer.js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { createAppError } from "../utils/createAppError.js";

export const register = async (name, email, password, isAdmin) => {
  const existingUser = await User.findOne({ email });
  if (existingUser) {
    throw createAppError('User already exists', 409); 
  }

  const hashedPassword = await bcrypt.hash(password, 10);
  const user = await User.create({
    name,
    email,
    password: hashedPassword,
    isAdmin,
  });

  const { password: _, ...userWithoutPassword } = user.toObject();
  return userWithoutPassword;
};

export const login = async (email, password) => {
  const user = await User.findOne({ email });

  if (!user) {
    throw createAppError("Invalid email or password", 400);
  }

  const isPasswordValid = await bcrypt.compare(password, user.password);
  if (!isPasswordValid) {
    throw createAppError("Invalid email or password", 400);
  }

  const token = jwt.sign(
    {
      id: user._id,
      isAdmin: user.isAdmin,
    },
    process.env.JWT_SECRET,
    {
      expiresIn: process.env.JWT_EXPIRATION,
    }
  );

  return { token, userId: user._id, name: user.name };
};

// Reputation weights (shown to users on the Profile page)
const REPUTATION_PER_QUESTION = 5;
const REPUTATION_PER_ANSWER = 10;
const REPUTATION_PER_UPVOTE = 10;

const sumUpvotesForAuthor = async (Model, authorId) => {
  const [result] = await Model.aggregate([
    { $match: { author: authorId } },
    { $group: { _id: null, total: { $sum: { $size: "$upvotes" } } } },
  ]);
  return result?.total || 0;
};

export const getUserStats = async (userId) => {
  if (!mongoose.Types.ObjectId.isValid(userId)) {
    throw createAppError("Invalid user ID", 400);
  }

  const user = await User.findById(userId).select("_id");
  if (!user) {
    throw createAppError("User not found", 404);
  }

  // aggregate() does not cast types, so match on a real ObjectId
  const authorId = new mongoose.Types.ObjectId(userId);

  const [totalQuestions, totalAnswers, questionUpvotes, answerUpvotes] =
    await Promise.all([
      Question.countDocuments({ author: authorId }),
      Answer.countDocuments({ author: authorId }),
      sumUpvotesForAuthor(Question, authorId),
      sumUpvotesForAuthor(Answer, authorId),
    ]);

  const totalVotesReceived = questionUpvotes + answerUpvotes;
  const reputation =
    totalQuestions * REPUTATION_PER_QUESTION +
    totalAnswers * REPUTATION_PER_ANSWER +
    totalVotesReceived * REPUTATION_PER_UPVOTE;

  return { totalQuestions, totalAnswers, totalVotesReceived, reputation };
};