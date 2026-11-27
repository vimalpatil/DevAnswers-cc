import {
    getBookmarksService,
    getBookmarkIdsService,
    addBookmarkService,
    removeBookmarkService,
} from "../services/bookmarkService.js";

export const getBookmarks = async (req, res) => {
    const bookmarks = await getBookmarksService(req.user.id);

    res.status(200).json({
        success: true,
        message: "Bookmarks fetched successfully",
        data: bookmarks,
    });
};

export const getBookmarkIds = async (req, res) => {
    const ids = await getBookmarkIdsService(req.user.id);

    res.status(200).json({
        success: true,
        message: "Bookmark IDs fetched successfully",
        data: ids,
    });
};

export const addBookmark = async (req, res) => {
    const data = await addBookmarkService(req.user.id, req.params.questionId);

    res.status(200).json({
        success: true,
        message: "Question bookmarked",
        data,
    });
};

export const removeBookmark = async (req, res) => {
    const data = await removeBookmarkService(req.user.id, req.params.questionId);

    res.status(200).json({
        success: true,
        message: "Bookmark removed",
        data,
    });
};
