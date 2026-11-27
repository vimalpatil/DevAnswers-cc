import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import request from 'supertest';
import '../setup.js';
import app from '../../src/app.js';
import User from '../../src/models/User.js';
import Question from '../../src/models/Question.js';
import Answer from '../../src/models/Answer.js';
import Tag from '../../src/models/Tag.js';
import Bookmark from '../../src/models/Bookmark.js';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

// Users are created once (register + login) to stay well under the global
// rate limit of 100 requests per 15 minutes; everything else is reset per test.
let userA;
let userB;

async function createUserAndLogin(name) {
  const email = `${name.toLowerCase()}+${Date.now()}@example.com`;
  const password = 'password123';

  const userRes = await request(app)
    .post('/api/auth/register')
    .send({ name, email, password, isAdmin: false });

  const loginRes = await request(app)
    .post('/api/auth/login')
    .send({ email, password });

  return { user: userRes.body.data, token: loginRes.body.data.token };
}

async function createQuestion(questionData = {}) {
  const tag = await Tag.create({ name: `tag-${new mongoose.Types.ObjectId()}` });
  return Question.create({
    title: 'How to use async/await?',
    description: 'I am trying to understand async/await in JavaScript',
    tags: [tag._id],
    author: userA.user._id,
    ...questionData,
  });
}

const auth = (token) => ({ Authorization: `Bearer ${token}` });

describe('Bookmarks API', () => {
  beforeAll(async () => {
    await User.deleteMany({});
    userA = await createUserAndLogin('Alice');
    userB = await createUserAndLogin('Bob');
  });

  beforeEach(async () => {
    await Promise.all([
      Question.deleteMany({}),
      Answer.deleteMany({}),
      Tag.deleteMany({}),
      Bookmark.deleteMany({}),
    ]);
  });

  // -------------------
  // Auth (AC-10)
  // -------------------
  it('should return 401 on every endpoint without a token or with an invalid token', async () => {
    const id = new mongoose.Types.ObjectId();
    const calls = [
      () => request(app).get('/api/bookmarks'),
      () => request(app).get('/api/bookmarks/ids'),
      () => request(app).put(`/api/bookmarks/${id}`),
      () => request(app).delete(`/api/bookmarks/${id}`),
    ];

    for (const call of calls) {
      const noToken = await call();
      expect(noToken.status).toBe(401);
      expect(noToken.body.success).toBe(false);

      const badToken = await call().set('Authorization', 'Bearer not-a-real-token');
      expect(badToken.status).toBe(401);
      expect(badToken.body.success).toBe(false);
    }
  });

  // -------------------
  // PUT /api/bookmarks/:questionId (AC-1)
  // -------------------
  it('PUT -> bookmarked question appears in both lists with populated fields', async () => {
    const question = await createQuestion({ title: 'Saved question' });
    await Answer.create({ answerText: 'An answer', questionId: question._id, author: userB.user._id });

    const putRes = await request(app)
      .put(`/api/bookmarks/${question._id}`)
      .set(auth(userA.token));

    expect(putRes.status).toBe(200);
    expect(putRes.body).toMatchObject({
      success: true,
      message: 'Question bookmarked',
      data: { questionId: question._id.toString(), bookmarked: true },
    });
    expect(putRes.body.data.bookmarkedAt).toBeDefined();

    const listRes = await request(app).get('/api/bookmarks').set(auth(userA.token));
    expect(listRes.status).toBe(200);
    expect(listRes.body.message).toBe('Bookmarks fetched successfully');
    expect(listRes.body.data).toHaveLength(1);
    const [item] = listRes.body.data;
    expect(item._id).toBe(question._id.toString());
    expect(item.title).toBe('Saved question');
    expect(item.author.name).toBe('Alice');
    expect(item.tags[0].name).toMatch(/^tag-/);
    expect(item.answerCount).toBe(1);
    expect(item.bookmarkedAt).toBe(putRes.body.data.bookmarkedAt);

    const idsRes = await request(app).get('/api/bookmarks/ids').set(auth(userA.token));
    expect(idsRes.status).toBe(200);
    expect(idsRes.body.message).toBe('Bookmark IDs fetched successfully');
    expect(idsRes.body.data).toEqual([question._id.toString()]);
  });

  it('PUT twice -> idempotent, one bookmark document', async () => {
    const question = await createQuestion();

    const first = await request(app).put(`/api/bookmarks/${question._id}`).set(auth(userA.token));
    const second = await request(app).put(`/api/bookmarks/${question._id}`).set(auth(userA.token));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body.data.bookmarkedAt).toBe(first.body.data.bookmarkedAt);
    expect(await Bookmark.countDocuments({ user: userA.user._id, question: question._id })).toBe(1);
  });

  it('PUT -> user can bookmark their own question', async () => {
    const question = await createQuestion({ author: userA.user._id });

    const res = await request(app).put(`/api/bookmarks/${question._id}`).set(auth(userA.token));

    expect(res.status).toBe(200);
    expect(res.body.data.bookmarked).toBe(true);
  });

  it('PUT -> 400 for an invalid question ID', async () => {
    const res = await request(app).put('/api/bookmarks/not-an-id').set(auth(userA.token));

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ success: false, message: 'Invalid question ID' });
  });

  it('PUT -> 404 when the question does not exist', async () => {
    const res = await request(app)
      .put(`/api/bookmarks/${new mongoose.Types.ObjectId()}`)
      .set(auth(userA.token));

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ success: false, message: 'Question not found' });
    expect(await Bookmark.countDocuments({})).toBe(0);
  });

  // -------------------
  // DELETE /api/bookmarks/:questionId (AC-2)
  // -------------------
  it('DELETE -> removes the question from both lists', async () => {
    const question = await createQuestion();
    await request(app).put(`/api/bookmarks/${question._id}`).set(auth(userA.token));

    const delRes = await request(app).delete(`/api/bookmarks/${question._id}`).set(auth(userA.token));
    expect(delRes.status).toBe(200);
    expect(delRes.body).toEqual({
      success: true,
      message: 'Bookmark removed',
      data: { questionId: question._id.toString(), bookmarked: false },
    });

    const listRes = await request(app).get('/api/bookmarks').set(auth(userA.token));
    const idsRes = await request(app).get('/api/bookmarks/ids').set(auth(userA.token));
    expect(listRes.body.data).toEqual([]);
    expect(idsRes.body.data).toEqual([]);
  });

  it('DELETE twice -> idempotent, both 200 (question need not exist)', async () => {
    const missingId = new mongoose.Types.ObjectId();

    const first = await request(app).delete(`/api/bookmarks/${missingId}`).set(auth(userA.token));
    const second = await request(app).delete(`/api/bookmarks/${missingId}`).set(auth(userA.token));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
  });

  it('DELETE -> 400 for an invalid question ID', async () => {
    const res = await request(app).delete('/api/bookmarks/not-an-id').set(auth(userA.token));

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ success: false, message: 'Invalid question ID' });
  });

  // -------------------
  // GET /api/bookmarks (AC-8)
  // -------------------
  it('GET -> empty list returns 200 with []', async () => {
    const listRes = await request(app).get('/api/bookmarks').set(auth(userA.token));
    const idsRes = await request(app).get('/api/bookmarks/ids').set(auth(userA.token));

    expect(listRes.status).toBe(200);
    expect(listRes.body.data).toEqual([]);
    expect(idsRes.status).toBe(200);
    expect(idsRes.body.data).toEqual([]);
  });

  it('GET -> most recently saved first', async () => {
    // Explicit timestamps: separate inserts can share a millisecond, which
    // would make a wall-clock based ordering nondeterministic.
    const q1 = await createQuestion({ title: 'First saved' });
    const q2 = await createQuestion({ title: 'Third saved' });
    const q3 = await createQuestion({ title: 'Second saved' });
    await Bookmark.create([
      { user: userA.user._id, question: q1._id, createdAt: new Date('2026-01-01T00:00:00Z') },
      { user: userA.user._id, question: q2._id, createdAt: new Date('2026-01-03T00:00:00Z') },
      { user: userA.user._id, question: q3._id, createdAt: new Date('2026-01-02T00:00:00Z') },
    ]);

    const res = await request(app).get('/api/bookmarks').set(auth(userA.token));

    expect(res.status).toBe(200);
    expect(res.body.data.map((q) => q.title)).toEqual(['Third saved', 'Second saved', 'First saved']);
    expect(res.body.data[0].bookmarkedAt).toBe('2026-01-03T00:00:00.000Z');
  });

  it('GET -> leaves out bookmarks whose question no longer exists', async () => {
    const kept = await createQuestion({ title: 'Kept' });
    const orphanId = new mongoose.Types.ObjectId();
    await Bookmark.create([
      { user: userA.user._id, question: kept._id },
      { user: userA.user._id, question: orphanId },
    ]);

    const res = await request(app).get('/api/bookmarks').set(auth(userA.token));

    expect(res.status).toBe(200);
    expect(res.body.data.map((q) => q.title)).toEqual(['Kept']);
  });

  // -------------------
  // Privacy (AC-7)
  // -------------------
  it("should keep bookmarks private between users", async () => {
    const question = await createQuestion();
    await request(app).put(`/api/bookmarks/${question._id}`).set(auth(userA.token));

    const bList = await request(app).get('/api/bookmarks').set(auth(userB.token));
    const bIds = await request(app).get('/api/bookmarks/ids').set(auth(userB.token));
    expect(bList.body.data).toEqual([]);
    expect(bIds.body.data).toEqual([]);

    // B "removing" the same question must not touch A's bookmark
    const bDelete = await request(app).delete(`/api/bookmarks/${question._id}`).set(auth(userB.token));
    expect(bDelete.status).toBe(200);

    const aIds = await request(app).get('/api/bookmarks/ids').set(auth(userA.token));
    expect(aIds.body.data).toEqual([question._id.toString()]);
  });
});
