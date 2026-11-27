import axiosInstance from "../api/axiosInstance.js";
import { BOOKMARK_API } from "../config/config.js";

const authHeader = (token) => ({
  headers: { Authorization: `Bearer ${token}` },
});

export const getBookmarks = async (token) => {
  const res = await axiosInstance.get(BOOKMARK_API.LIST, authHeader(token));
  return res.data.data || [];
};

export const getBookmarkIds = async (token) => {
  const res = await axiosInstance.get(BOOKMARK_API.IDS, authHeader(token));
  return res.data.data || [];
};

export const addBookmark = async (questionId, token) => {
  const res = await axiosInstance.put(
    BOOKMARK_API.ADD(questionId),
    {},
    authHeader(token),
  );
  return res.data.data;
};

export const removeBookmark = async (questionId, token) => {
  const res = await axiosInstance.delete(
    BOOKMARK_API.REMOVE(questionId),
    authHeader(token),
  );
  return res.data.data;
};
