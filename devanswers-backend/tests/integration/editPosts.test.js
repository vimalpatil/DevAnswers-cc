// Spec 002: hardening of PUT /api/questions/:id and PUT /api/answers/:answerId.
// Lives in its own file so the 100 req/15 min rate limit isn't shared with
// the existing questions/answers suites. Users are registered once in beforeAll.
import { describe, it, expect, beforeEach, beforeAll } from "vitest";
import request from "supertest";
import "../setup.js";
import app from "../../src/app.js";
import Question from "../../src/models/Question.js";
import Answer from "../../src/models/Answer.js";
import Tag from "../../src/models/Tag.js";
import mongoose from "mongoose";
import dotenv from "dotenv";
dotenv.config();

let author; // { user, token }
let other;
let admin;

async function registerAndLogin(name, isAdmin = false) {
  const email = `${name.toLowerCase()}+${Date.now()}@example.com`;
  const password = "password123";
  const userRes = await request(app)
    .post("/api/auth/register")
    .send({ name, email, password, isAdmin });
  const loginRes = await request(app)
    .post("/api/auth/login")
    .send({ email, password });
  return { user: userRes.body.data, token: loginRes.body.data.token };
}

beforeAll(async () => {
  author = await registerAndLogin("Author");
  other = await registerAndLogin("Other");
  admin = await registerAndLogin("Admin", true);
});

async function createQuestion(overrides = {}) {
  const tag = await new Tag({ name: `tag-${Date.now()}-${Math.random()}` }).save();
  return new Question({
    title: "Original title",
    description: "Original description",
    tags: [tag._id],
    author: author.user._id,
    ...overrides,
  }).save();
}

async function createAnswer(overrides = {}) {
  const question = overrides.question || (await createQuestion());
  return new Answer({
    questionId: question._id,
    answerText: "Original answer",
    author: author.user._id,
    ...overrides,
  }).save();
}

const putQuestion = (id, body, token = author.token) =>
  request(app)
    .put(`/api/questions/${id}`)
    .set("Authorization", `Bearer ${token}`)
    .send(body);

const putAnswer = (id, body, token = author.token) =>
  request(app)
    .put(`/api/answers/${id}`)
    .set("Authorization", `Bearer ${token}`)
    .send(body);

const validQuestionBody = {
  title: "Edited title",
  description: "Edited description",
  tags: "react, node",
};

describe("Edit posts API (spec 002)", () => {
  beforeEach(async () => {
    await Tag.deleteMany({});
  });

  describe("PUT /api/questions/:id", () => {
    it("returns a populated question with editedAt, trimming input", async () => {
      const question = await createQuestion();

      const res = await putQuestion(question._id, {
        title: "  Edited title  ",
        description: " Edited description ",
        tags: ["react", " node ", "React", ""],
      });

      expect(res.status).toBe(200);
      expect(res.body.data.title).toBe("Edited title");
      expect(res.body.data.description).toBe("Edited description");
      expect(res.body.data.author).toMatchObject({ name: "Author" });
      expect(res.body.data.tags.map((t) => t.name)).toEqual(["react", "node"]);
      expect(new Date(res.body.data.editedAt).getTime()).not.toBeNaN();
    });

    it("returns 400 for a malformed ID", async () => {
      const res = await putQuestion("not-an-id", validQuestionBody);
      expect(res.status).toBe(400);
      expect(res.body.message).toBe("Invalid question ID");
    });

    it("returns 404 for an unknown ID", async () => {
      const res = await putQuestion(new mongoose.Types.ObjectId(), validQuestionBody);
      expect(res.status).toBe(404);
      expect(res.body.message).toBe("Question not found");
    });

    it("returns 403 for a non-author and leaves the document unchanged", async () => {
      const question = await createQuestion();
      const res = await putQuestion(question._id, validQuestionBody, other.token);

      expect(res.status).toBe(403);
      const stored = await Question.findById(question._id);
      expect(stored.title).toBe("Original title");
      expect(stored.editedAt).toBeNull();
    });

    it("returns 403 for an admin who isn't the author", async () => {
      const question = await createQuestion();
      const res = await putQuestion(question._id, validQuestionBody, admin.token);

      expect(res.status).toBe(403);
      expect(res.body.message).toBe("Not authorized to update this question");
      expect((await Question.findById(question._id)).title).toBe("Original title");
    });

    it("returns 403 (not 400) for a non-author sending an invalid body", async () => {
      const question = await createQuestion();
      const res = await putQuestion(question._id, { title: "" }, other.token);
      expect(res.status).toBe(403);
    });

    it.each([
      ["a blank title", { title: "" }, "Title is required"],
      ["a whitespace title", { title: "   " }, "Title is required"],
      ["a non-string title", { title: { $ne: "" } }, "Title is required"],
      ["a blank description", { description: "  " }, "Description is required"],
      ["zero tags", { tags: " , " }, "Provide between 1 and 5 tags"],
      ["six tags", { tags: "a, b, c, d, e, f" }, "Provide between 1 and 5 tags"],
      [
        "an over-long tag",
        { tags: "x".repeat(31) },
        "Each tag must be at most 30 characters",
      ],
    ])("returns 400 for %s", async (_label, patch, message) => {
      const question = await createQuestion();
      const res = await putQuestion(question._id, { ...validQuestionBody, ...patch });

      expect(res.status).toBe(400);
      expect(res.body.message).toBe(message);
      const stored = await Question.findById(question._id);
      expect(stored.title).toBe("Original title");
      expect(stored.editedAt).toBeNull();
    });

    it("returns 400 (not 500) when tags are missing", async () => {
      const question = await createQuestion();
      const res = await putQuestion(question._id, {
        title: "Edited",
        description: "Edited",
      });

      expect(res.status).toBe(400);
      expect(res.body.message).toBe(
        "Tags must be a comma-separated string or an array of strings",
      );
    });

    it("creates no tags when the request is rejected", async () => {
      const question = await createQuestion();
      const before = await Tag.countDocuments();

      const res = await putQuestion(question._id, {
        ...validQuestionBody,
        title: "   ",
        tags: "brand-new-tag",
      });

      expect(res.status).toBe(400);
      expect(await Tag.countDocuments()).toBe(before);
      expect(await Tag.findOne({ name: "brand-new-tag" })).toBeNull();
    });

    it("leaves editedAt null on a no-op save", async () => {
      const tag = await new Tag({ name: "react" }).save();
      const question = await createQuestion({
        title: "Same",
        description: "Same body",
        tags: [tag._id],
      });

      const res = await putQuestion(question._id, {
        title: " Same ",
        description: "Same body",
        tags: "react",
      });

      expect(res.status).toBe(200);
      expect(res.body.data.editedAt).toBeNull();
      expect(res.body.data.tags.map((t) => t.name)).toEqual(["react"]);
      expect((await Question.findById(question._id)).editedAt).toBeNull();
    });

    it("never sets editedAt on a view or a vote", async () => {
      const question = await createQuestion();

      await request(app).get(`/api/questions/${question._id}`);
      await request(app)
        .post(`/api/questions/${question._id}/upvote`)
        .set("Authorization", `Bearer ${other.token}`);

      const stored = await Question.findById(question._id);
      expect(stored.views).toBe(1);
      expect(stored.voteCount).toBe(1);
      expect(stored.editedAt).toBeNull();
    });

    it("ignores author, voteCount and other non-editable fields in the body", async () => {
      const question = await createQuestion();

      const res = await putQuestion(question._id, {
        ...validQuestionBody,
        author: other.user._id,
        voteCount: 999,
        views: 999,
        upvotes: [other.user._id],
      });

      expect(res.status).toBe(200);
      const stored = await Question.findById(question._id);
      expect(stored.author.toString()).toBe(author.user._id.toString());
      expect(stored.voteCount).toBe(0);
      expect(stored.views).toBe(0);
      expect(stored.upvotes).toHaveLength(0);
    });
  });

  describe("PUT /api/answers/:answerId", () => {
    it("returns the updated answer with editedAt and a populated author", async () => {
      const answer = await createAnswer();

      const res = await putAnswer(answer._id, { answerText: "  Better answer " });

      expect(res.status).toBe(200);
      expect(res.body.data.answerText).toBe("Better answer");
      expect(res.body.data.author).toMatchObject({ name: "Author" });
      expect(res.body.data.editedAt).toBeTruthy();
    });

    it("returns 400 for a malformed ID", async () => {
      const res = await putAnswer("not-an-id", { answerText: "x" });
      expect(res.status).toBe(400);
      expect(res.body.message).toBe("Invalid answer ID");
    });

    it("returns 404 for an unknown ID", async () => {
      const res = await putAnswer(new mongoose.Types.ObjectId(), { answerText: "x" });
      expect(res.status).toBe(404);
    });

    it("returns 401 without a token", async () => {
      const answer = await createAnswer();
      const res = await request(app)
        .put(`/api/answers/${answer._id}`)
        .send({ answerText: "x" });
      expect(res.status).toBe(401);
    });

    it("returns 403 for a non-author and for an admin", async () => {
      const answer = await createAnswer();

      const asOther = await putAnswer(answer._id, { answerText: "Hacked" }, other.token);
      const asAdmin = await putAnswer(answer._id, { answerText: "Admin" }, admin.token);

      expect(asOther.status).toBe(403);
      expect(asAdmin.status).toBe(403);
      const stored = await Answer.findById(answer._id);
      expect(stored.answerText).toBe("Original answer");
      expect(stored.editedAt).toBeNull();
    });

    it.each([
      ["blank", ""],
      ["whitespace", "   \n  "],
    ])("returns 400 for %s text", async (_label, answerText) => {
      const answer = await createAnswer();
      const res = await putAnswer(answer._id, { answerText });

      expect(res.status).toBe(400);
      expect(res.body.message).toBe("Answer text is required");
      expect((await Answer.findById(answer._id)).answerText).toBe("Original answer");
    });

    it("leaves editedAt null on a no-op save", async () => {
      const answer = await createAnswer();
      const res = await putAnswer(answer._id, { answerText: " Original answer " });

      expect(res.status).toBe(200);
      expect(res.body.data.editedAt).toBeNull();
    });

    it("never sets editedAt on a vote", async () => {
      const answer = await createAnswer();
      await request(app)
        .post(`/api/answers/${answer._id}/upvote`)
        .set("Authorization", `Bearer ${other.token}`);

      const stored = await Answer.findById(answer._id);
      expect(stored.voteCount).toBe(1);
      expect(stored.editedAt).toBeNull();
    });

    it("ignores questionId in the body", async () => {
      const answer = await createAnswer();
      const otherQuestion = await createQuestion();

      const res = await putAnswer(answer._id, {
        answerText: "Moved?",
        questionId: otherQuestion._id,
        voteCount: 50,
      });

      expect(res.status).toBe(200);
      const stored = await Answer.findById(answer._id);
      expect(stored.questionId.toString()).toBe(answer.questionId.toString());
      expect(stored.voteCount).toBe(0);
    });
  });
});
