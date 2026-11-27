import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import '../setup.js';
import app from '../../src/app.js';
import User from '../../src/models/User.js';
import Question from '../../src/models/Question.js';
import Answer from '../../src/models/Answer.js';

async function createUser(name) {
  return User.create({
    name,
    email: `${name.toLowerCase()}-${Date.now()}@example.com`,
    password: 'hashed',
  });
}

describe('GET /api/auth/stats/:userId', () => {
  let author;
  let voterA;
  let voterB;

  beforeEach(async () => {
    await Promise.all([
      User.deleteMany({}),
      Question.deleteMany({}),
      Answer.deleteMany({}),
    ]);
    [author, voterA, voterB] = await Promise.all([
      createUser('Author'),
      createUser('VoterA'),
      createUser('VoterB'),
    ]);
  });

  it('returns zeroed stats for a user with no activity', async () => {
    const res = await request(app).get(`/api/auth/stats/${author._id}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual({
      totalQuestions: 0,
      totalAnswers: 0,
      totalVotesReceived: 0,
      reputation: 0,
    });
  });

  it('counts questions, answers and upvotes received, and computes reputation', async () => {
    const q1 = await Question.create({
      title: 'Q1',
      description: 'd',
      author: author._id,
      upvotes: [voterA._id, voterB._id],
      downvotes: [],
    });
    await Question.create({
      title: 'Q2',
      description: 'd',
      author: author._id,
      downvotes: [voterA._id], // downvotes are not counted
    });
    await Answer.create({
      questionId: q1._id,
      answerText: 'a',
      author: author._id,
      upvotes: [voterA._id],
    });
    // Activity by another user must not be counted
    await Question.create({
      title: 'Other',
      description: 'd',
      author: voterA._id,
      upvotes: [author._id],
    });

    const res = await request(app).get(`/api/auth/stats/${author._id}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      totalQuestions: 2,
      totalAnswers: 1,
      totalVotesReceived: 3,
      // 2 * 5 + 1 * 10 + 3 * 10
      reputation: 50,
    });
  });

  it('does not require authentication', async () => {
    const res = await request(app).get(`/api/auth/stats/${author._id}`);
    expect(res.status).toBe(200);
  });

  it('returns 400 for an invalid user ID', async () => {
    const res = await request(app).get('/api/auth/stats/not-an-id');

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toBe('Invalid user ID');
  });

  it('returns 404 for a user that does not exist', async () => {
    const res = await request(app).get(
      `/api/auth/stats/${new mongoose.Types.ObjectId()}`,
    );

    expect(res.status).toBe(404);
    expect(res.body.message).toBe('User not found');
  });
});
