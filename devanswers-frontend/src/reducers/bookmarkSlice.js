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
  // { [questionId]: requestId } while a PUT or DELETE is in flight. Storing the
  // requestId (not just `true`) lets a response check it is still the current
  // request for that question, so responses that land after logout are ignored.
  pending: {},
  rollback: {}, // { [questionId]: { item, index } } — restores an item if its remove fails
  idsStatus: "idle", // 'idle' | 'pending' | 'fulfilled' | 'rejected'
  itemsStatus: "idle",
  // requestId of the latest fetch of each kind; only its response is applied
  idsRequestId: null,
  itemsRequestId: null,
  error: null, // last error from the ids fetch or a toggle
  itemsError: null, // error for the Saved Questions list only
};

const errorMessage = (error, fallback) =>
  error.response?.data?.message ||
  error.response?.data?.error ||
  error.message ||
  fallback;

const getToken = (getState) => getState().user?.userInfo?.token;

/**
 * Runs a bookmark request with the current token. If it fails, the rejection
 * is tagged `meta.stale` when the session changed while it was in flight
 * (logout or a different login), so the UI can skip the error alert.
 */
const runWithToken = async (request, fallback, { getState, rejectWithValue }) => {
  const token = getToken(getState);
  try {
    return await request(token);
  } catch (error) {
    const stale = getToken(getState) !== token;
    return rejectWithValue(errorMessage(error, fallback), { stale });
  }
};

export const fetchBookmarkIds = createAsyncThunk(
  "bookmark/fetchBookmarkIds",
  (_, thunkApi) =>
    runWithToken(getBookmarkIds, "Failed to fetch bookmarks", thunkApi),
  {
    // Collapses duplicate startup dispatches (e.g. StrictMode effects) into one request
    condition: (_, { getState }) =>
      getState().bookmark?.idsStatus !== "pending",
  },
);

export const fetchBookmarks = createAsyncThunk(
  "bookmark/fetchBookmarks",
  (_, thunkApi) =>
    runWithToken(getBookmarks, "Failed to fetch bookmarks", thunkApi),
);

// Skip a toggle while one for the same question is already in flight (AC-5)
const notPending = (questionId, getState) =>
  !getState().bookmark?.pending?.[questionId];

export const addBookmark = createAsyncThunk(
  "bookmark/addBookmark",
  (question, thunkApi) =>
    runWithToken(
      (token) => addBookmarkApi(question._id, token),
      "Failed to update bookmark",
      thunkApi,
    ),
  { condition: (question, { getState }) => notPending(question._id, getState) },
);

export const removeBookmark = createAsyncThunk(
  "bookmark/removeBookmark",
  (questionId, thunkApi) =>
    runWithToken(
      (token) => removeBookmarkApi(questionId, token),
      "Failed to update bookmark",
      thunkApi,
    ),
  { condition: (questionId, { getState }) => notPending(questionId, getState) },
);

// True when this action answers the toggle currently in flight for `id`.
// False after a logout reset (pending is empty) or if a newer toggle replaced it.
const isCurrentToggle = (state, id, action) =>
  state.pending[id] === action.meta.requestId;

const bookmarkSlice = createSlice({
  name: "bookmark",
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      // Reset everything on logout so the next user starts clean (AC-12)
      .addCase(logout, () => initialState)

      // fetchBookmarkIds
      .addCase(fetchBookmarkIds.pending, (state, action) => {
        state.idsStatus = "pending";
        state.idsRequestId = action.meta.requestId;
        state.error = null;
      })
      .addCase(fetchBookmarkIds.fulfilled, (state, action) => {
        // Ignore a response from an earlier session or a superseded fetch
        if (state.idsRequestId !== action.meta.requestId) return;
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
        state.idsRequestId = null;
      })
      .addCase(fetchBookmarkIds.rejected, (state, action) => {
        if (state.idsRequestId !== action.meta.requestId) return;
        state.idsStatus = "rejected";
        state.idsRequestId = null;
        state.error = action.payload || action.error.message;
      })

      // fetchBookmarks
      .addCase(fetchBookmarks.pending, (state, action) => {
        state.itemsStatus = "pending";
        state.itemsRequestId = action.meta.requestId;
        state.itemsError = null;
      })
      .addCase(fetchBookmarks.fulfilled, (state, action) => {
        if (state.itemsRequestId !== action.meta.requestId) return;
        state.items = action.payload;
        action.payload.forEach((q) => {
          if (!state.pending[q._id]) state.ids[q._id] = true;
        });
        state.itemsStatus = "fulfilled";
        state.itemsRequestId = null;
      })
      .addCase(fetchBookmarks.rejected, (state, action) => {
        if (state.itemsRequestId !== action.meta.requestId) return;
        state.itemsStatus = "rejected";
        state.itemsRequestId = null;
        state.itemsError = action.payload || action.error.message;
      })

      // addBookmark — optimistic (AC-4)
      .addCase(addBookmark.pending, (state, action) => {
        const id = action.meta.arg._id;
        state.ids[id] = true;
        state.pending[id] = action.meta.requestId;
        state.error = null;
      })
      .addCase(addBookmark.fulfilled, (state, action) => {
        const id = action.meta.arg._id;
        if (!isCurrentToggle(state, id, action)) return;
        delete state.pending[id];
      })
      .addCase(addBookmark.rejected, (state, action) => {
        const id = action.meta.arg._id;
        if (!isCurrentToggle(state, id, action)) return;
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
        state.pending[id] = action.meta.requestId;
        state.error = null;
      })
      .addCase(removeBookmark.fulfilled, (state, action) => {
        const id = action.meta.arg;
        if (!isCurrentToggle(state, id, action)) return;
        delete state.pending[id];
        delete state.rollback[id];
      })
      .addCase(removeBookmark.rejected, (state, action) => {
        const id = action.meta.arg;
        if (!isCurrentToggle(state, id, action)) return;
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
// Error for the Saved Questions list; toggles and the ids fetch don't touch it
export const selectBookmarksError = (state) =>
  state.bookmark?.itemsError ?? null;

export default bookmarkSlice.reducer;
