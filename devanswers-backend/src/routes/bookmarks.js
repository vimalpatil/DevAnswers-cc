import express from "express";

import {
  getBookmarks,
  getBookmarkIds,
  addBookmark,
  removeBookmark,
} from "../controllers/bookmarkController.js";
import authenticate from "../middleware/authHandler.js";

const router = express.Router();

// Every bookmark route is protected - applied once so none can slip through
router.use(authenticate);

router.get("/", getBookmarks);
router.get("/ids", getBookmarkIds);
router.put("/:questionId", addBookmark);
router.delete("/:questionId", removeBookmark);

export default router;
