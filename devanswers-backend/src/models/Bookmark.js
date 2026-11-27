import mongoose from "mongoose";

const bookmarkSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    question: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Question",
      required: true,
    },
  },
  {
    timestamps: true, // createdAt is exposed to clients as `bookmarkedAt`
  }
);

// One bookmark per user per question
bookmarkSchema.index({ user: 1, question: 1 }, { unique: true });
// List a user's bookmarks newest-saved first
bookmarkSchema.index({ user: 1, createdAt: -1 });
// Cascade delete by question
bookmarkSchema.index({ question: 1 });

const Bookmark = mongoose.model("Bookmark", bookmarkSchema);
export default Bookmark;
