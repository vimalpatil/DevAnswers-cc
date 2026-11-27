import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import {
  getBookmarks,
  getBookmarkIds,
  addBookmark as addBookmarkApi,
  removeBookmark as removeBookmarkApi,
} from "../services/bookmarkService.js";
import { logout } from "./userSlice.js";

const initialState = {
  ids: {}, // { [questionId]: true } — O(1) lookup for controls
  items: [], // questions for the Saved Questions section
  pending: {}, // { [questionId]: true } while a PUT or DELETE is in flight
  rollback: {}, // { [questionId]: { item, index } } — restores an item if its remove fails
  idsStatus: "idle", // 'idle' | 'pending' | 'fulfilled' | 'rejected'
  itemsStatus: "idle",
  error: null,
};

const errorMessage = (error, fallback) =>
  error.response?.data?.message ||
  error.response?.data?.error ||
  error.message ||
  fallback;

const getToken = (getState) => getState().user?.userInfo?.token;

export const fetchBookmarkIds = createAsyncThunk(
  "bookmark/fetchBookmarkIds",
  async (_, { getState, rejectWithValue }) => {
    try {
      return await getBookmarkIds(getToken(getState));
    } catch (error) {
      return rejectWithValue(errorMessage(error, "Failed to fetch bookmarks"));
    }
  },
  {
    // Collapses duplicate startup dispatches (e.g. StrictMode effects) into one request
    condition: (_, { getState }) =>
      getState().bookmark?.idsStatus !== "pending",
  },
);

export const fetchBookmarks = createAsyncThunk(
  "bookmark/fetchBookmarks",
  async (_, { getState, rejectWithValue }) => {
    try {
      return await getBookmarks(getToken(getState));
    } catch (error) {
      return rejectWithValue(errorMessage(error, "Failed to fetch bookmarks"));
    }
  },
);

// Skip a toggle while one for the same question is already in flight (AC-5)
const notPending = (questionId, getState) =>
  !getState().bookmark?.pending?.[questionId];

export const addBookmark = createAsyncThunk(
  "bookmark/addBookmark",
  async (question, { getState, rejectWithValue }) => {
    try {
      return await addBookmarkApi(question._id, getToken(getState));
    } catch (error) {
      return rejectWithValue(errorMessage(error, "Failed to update bookmark"));
    }
  },
  { condition: (question, { getState }) => notPending(question._id, getState) },
);

export const removeBookmark = createAsyncThunk(
  "bookmark/removeBookmark",
  async (questionId, { getState, rejectWithValue }) => {
    try {
      return await removeBookmarkApi(questionId, getToken(getState));
    } catch (error) {
      return rejectWithValue(errorMessage(error, "Failed to update bookmark"));
    }
  },
  { condition: (questionId, { getState }) => notPending(questionId, getState) },
);

const bookmarkSlice = createSlice({
  name: "bookmark",
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      // Reset everything on logout so the next user starts clean (AC-12)
      .addCase(logout, () => initialState)

      // fetchBookmarkIds
      .addCase(fetchBookmarkIds.pending, (state) => {
        state.idsStatus = "pending";
        state.error = null;
      })
      .addCase(fetchBookmarkIds.fulfilled, (state, action) => {
        // Ignore a response that lands after a logout reset
        if (state.idsStatus !== "pending") return;
        const ids = {};
        action.payload.forEach((id) => {
          ids[id] = true;
        });
        // Keep the optimistic state of toggles still in flight
        Object.keys(state.pending).forEach((id) => {
          if (state.ids[id]) ids[id] = true;
          else delete ids[id];
        });
        state.ids = ids;
        state.idsStatus = "fulfilled";
      })
      .addCase(fetchBookmarkIds.rejected, (state, action) => {
        if (state.idsStatus !== "pending") return;
        state.idsStatus = "rejected";
        state.error = action.payload || action.error.message;
      })

      // fetchBookmarks
      .addCase(fetchBookmarks.pending, (state) => {
        state.itemsStatus = "pending";
        state.error = null;
      })
      .addCase(fetchBookmarks.fulfilled, (state, action) => {
        if (state.itemsStatus !== "pending") return;
        state.items = action.payload;
        action.payload.forEach((q) => {
          if (!state.pending[q._id]) state.ids[q._id] = true;
        });
        state.itemsStatus = "fulfilled";
      })
      .addCase(fetchBookmarks.rejected, (state, action) => {
        if (state.itemsStatus !== "pending") return;
        state.itemsStatus = "rejected";
        state.error = action.payload || action.error.message;
      })

      // addBookmark — optimistic (AC-4)
      .addCase(addBookmark.pending, (state, action) => {
        const id = action.meta.arg._id;
        state.ids[id] = true;
        state.pending[id] = true;
        state.error = null;
      })
      .addCase(addBookmark.fulfilled, (state, action) => {
        delete state.pending[action.meta.arg._id];
      })
      .addCase(addBookmark.rejected, (state, action) => {
        const id = action.meta.arg._id;
        delete state.ids[id];
        delete state.pending[id];
        state.error = action.payload || action.error.message;
      })

      // removeBookmark — optimistic (AC-4)
      .addCase(removeBookmark.pending, (state, action) => {
        const id = action.meta.arg;
        const index = state.items.findIndex((q) => q._id === id);
        if (index !== -1) {
          state.rollback[id] = { item: state.items[index], index };
          state.items.splice(index, 1);
        }
        delete state.ids[id];
        state.pending[id] = true;
        state.error = null;
      })
      .addCase(removeBookmark.fulfilled, (state, action) => {
        const id = action.meta.arg;
        delete state.pending[id];
        delete state.rollback[id];
      })
      .addCase(removeBookmark.rejected, (state, action) => {
        const id = action.meta.arg;
        const saved = state.rollback[id];
        if (saved) {
          state.items.splice(saved.index, 0, saved.item);
          delete state.rollback[id];
        }
        state.ids[id] = true;
        delete state.pending[id];
        state.error = action.payload || action.error.message;
      });
  },
});

// Stable reference so useSelector doesn't re-render on every store update
const EMPTY = [];

// Selectors are null-safe so stores without a `bookmark` slice keep working (AC-14)
export const selectIsBookmarked = (state, id) => !!state.bookmark?.ids?.[id];
export const selectIsBookmarkPending = (state, id) =>
  !!state.bookmark?.pending?.[id];
export const selectBookmarks = (state) => state.bookmark?.items ?? EMPTY;
export const selectBookmarksStatus = (state) =>
  state.bookmark?.itemsStatus ?? "idle";
export const selectBookmarksError = (state) => state.bookmark?.error ?? null;

export default bookmarkSlice.reducer;
