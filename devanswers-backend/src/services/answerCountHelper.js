import Answer from "../models/Answer.js";

/**
 * Convert questions (Mongoose documents or plain objects) to plain objects
 * with an `answerCount` attached, so the frontend can display and sort by it.
 */
export const withAnswerCounts = (questions) =>
  Promise.all(
    questions.map(async (q) => {
      const answerCount = await Answer.countDocuments({ questionId: q._id });
      return { ...(q.toObject?.() ?? q), answerCount };
    }),
  );
