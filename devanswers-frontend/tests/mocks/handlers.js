import { http, HttpResponse } from "msw";
import {
  mockUsers,
  mockQuestions,
  mockAnswers,
  mockTags,
  mockAuthResponse,
} from "./mockData";

const BASE_URL = "http://localhost:3000/api";

// ── Bookmark store ──────────────────────────────────────────────────────────
// Per-test in-memory state: { questionId -> bookmarkedAt }. Reset after every
// test by resetBookmarkStore() in tests/setup.js. Seed with seedBookmarks().
let bookmarkStore = new Map();

export const resetBookmarkStore = () => {
  bookmarkStore = new Map();
};

export const seedBookmarks = (entries) => {
  entries.forEach(({ _id, bookmarkedAt }) => bookmarkStore.set(_id, bookmarkedAt));
};

const unauthorized = () =>
  HttpResponse.json(
    { success: false, message: "No token provided, authorization denied." },
    { status: 401 },
  );

const isAuthorized = (request) =>
  !!request.headers.get("Authorization")?.startsWith("Bearer ");

export const handlers = [
  // ── Bookmark endpoints ────────────────────────────────────────────────────
  http.get(`${BASE_URL}/bookmarks/ids`, ({ request }) => {
    if (!isAuthorized(request)) return unauthorized();
    return HttpResponse.json({
      success: true,
      message: "Bookmark IDs fetched successfully",
      data: [...bookmarkStore.keys()],
    });
  }),

  http.get(`${BASE_URL}/bookmarks`, ({ request }) => {
    if (!isAuthorized(request)) return unauthorized();
    const data = [...bookmarkStore.entries()]
      .map(([id, bookmarkedAt]) => {
        const question = mockQuestions.find((q) => q._id === id);
        return question && { ...question, bookmarkedAt };
      })
      .filter(Boolean)
      .sort((a, b) => new Date(b.bookmarkedAt) - new Date(a.bookmarkedAt));
    return HttpResponse.json({
      success: true,
      message: "Bookmarks fetched successfully",
      data,
    });
  }),

  http.put(`${BASE_URL}/bookmarks/:questionId`, ({ request, params }) => {
    if (!isAuthorized(request)) return unauthorized();
    const { questionId } = params;
    if (!mockQuestions.some((q) => q._id === questionId)) {
      return HttpResponse.json(
        { success: false, message: "Question not found" },
        { status: 404 },
      );
    }
    if (!bookmarkStore.has(questionId)) {
      bookmarkStore.set(questionId, new Date().toISOString());
    }
    return HttpResponse.json({
      success: true,
      message: "Question bookmarked",
      data: {
        questionId,
        bookmarked: true,
        bookmarkedAt: bookmarkStore.get(questionId),
      },
    });
  }),

  http.delete(`${BASE_URL}/bookmarks/:questionId`, ({ request, params }) => {
    if (!isAuthorized(request)) return unauthorized();
    bookmarkStore.delete(params.questionId);
    return HttpResponse.json({
      success: true,
      message: "Bookmark removed",
      data: { questionId: params.questionId, bookmarked: false },
    });
  }),

  // ── Auth endpoints ────────────────────────────────────────────────────────
  http.post(`${BASE_URL}/auth/login`, async ({ request }) => {
    const body = await request.json();

    if (body.email === "alice@example.com" && body.password === "password123") {
      return HttpResponse.json({ data: mockAuthResponse.login });
    }

    return HttpResponse.json(
      { message: "Invalid email or password" },
      { status: 401 },
    );
  }),

  http.post(`${BASE_URL}/auth/register`, async ({ request }) => {
    const body = await request.json();

    if (body.email === "existing@example.com") {
      return HttpResponse.json(
        { message: "Email already exists" },
        { status: 400 },
      );
    }

    return HttpResponse.json({ data: mockAuthResponse.register });
  }),

  // ── Question endpoints ────────────────────────────────────────────────────
  http.get(`${BASE_URL}/questions`, () => {
    return HttpResponse.json({ data: mockQuestions });
  }),

  http.get(`${BASE_URL}/questions/:id`, ({ params }) => {
    const question = mockQuestions.find((q) => q._id === params.id);

    if (!question) {
      return HttpResponse.json(
        { message: "Question not found" },
        { status: 404 },
      );
    }

    return HttpResponse.json({ data: question });
  }),

  http.post(`${BASE_URL}/questions`, async ({ request }) => {
    const body = await request.json();

    const newQuestion = {
      _id: `question-${Date.now()}`,
      ...body,
      voteCount: 0,
      upvotes: [],
      downvotes: [],
      answerCount: 0,
      answers: [],
      author: { _id: body.author, name: mockUsers.user1.name },
      createdAt: new Date().toISOString(),
    };

    return HttpResponse.json({ data: newQuestion }, { status: 201 });
  }),

  http.post(`${BASE_URL}/questions/:id/upvote`, ({ params }) => {
    const question = mockQuestions.find((q) => q._id === params.id);

    if (!question) {
      return HttpResponse.json(
        { message: "Question not found" },
        { status: 404 },
      );
    }

    return HttpResponse.json({
      data: { ...question, voteCount: question.voteCount + 1 },
    });
  }),

  http.post(`${BASE_URL}/questions/:id/downvote`, ({ params }) => {
    const question = mockQuestions.find((q) => q._id === params.id);

    if (!question) {
      return HttpResponse.json(
        { message: "Question not found" },
        { status: 404 },
      );
    }

    return HttpResponse.json({
      data: { ...question, voteCount: question.voteCount - 1 },
    });
  }),

  // ── Answer endpoints ──────────────────────────────────────────────────────
  http.post(
    `${BASE_URL}/questions/:questionId/answers`,
    async ({ request, params }) => {
      const body = await request.json();

      const newAnswer = {
        _id: `answer-${Date.now()}`,
        answerText: body.answerText,
        author: { _id: body.author, name: mockUsers.user1.name },
        voteCount: 0,
        upvotes: [],
        downvotes: [],
        createdAt: new Date().toISOString(),
      };

      return HttpResponse.json({ data: newAnswer }, { status: 201 });
    },
  ),

  http.post(`${BASE_URL}/answers/:id/upvote`, ({ params }) => {
    const answer = mockAnswers.find((a) => a._id === params.id);

    if (!answer) {
      return HttpResponse.json(
        { message: "Answer not found" },
        { status: 404 },
      );
    }

    return HttpResponse.json({
      data: { ...answer, voteCount: answer.voteCount + 1 },
    });
  }),

  http.post(`${BASE_URL}/answers/:id/downvote`, ({ params }) => {
    const answer = mockAnswers.find((a) => a._id === params.id);

    if (!answer) {
      return HttpResponse.json(
        { message: "Answer not found" },
        { status: 404 },
      );
    }

    return HttpResponse.json({
      data: { ...answer, voteCount: answer.voteCount - 1 },
    });
  }),

  // ── Tag endpoints ─────────────────────────────────────────────────────────
  http.get(`${BASE_URL}/tags`, () => {
    return HttpResponse.json({ data: mockTags });
  }),

  http.get(`${BASE_URL}/tags/:tagId/questions`, ({ params }) => {
    const questions = mockQuestions.filter((q) =>
      q.tags.some((t) => t._id === params.tagId),
    );
    return HttpResponse.json({ data: questions });
  }),

  // ── User stats endpoint ───────────────────────────────────────────────────
  http.get(`${BASE_URL}/auth/stats/:userId`, ({ params }) => {
    return HttpResponse.json({
      success: true,
      data: {
        totalQuestions: 3,
        totalAnswers: 5,
        totalVotesReceived: 12,
        reputation: 75,
      },
    });
  }),
];
