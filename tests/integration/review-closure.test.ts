import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type TestCard = {
  id: string;
  ownerId: string;
  pointId: string;
  contentId: string;
  status: 'NEW' | 'LEARNING' | 'REVIEW' | 'GRADUATED';
  easeFactor: number;
  intervalDays: number;
  repetitions: number;
  nextReviewAt: Date;
};
type TestReviewLog = { flashcardId: string; rating: number; reviewedAt: Date; streakAfter: number };
type TestExercise = {
  id: string;
  contentId: string;
  pointId: string;
  type: 'SINGLE_CHOICE';
  question: string;
  options: string[];
  correctAnswer: string;
  explanation: string;
};
type TestExerciseRecord = { id: string; exerciseId: string; learnerId: string; correct: boolean; masteryDelta: number };

const mocks = vi.hoisted(() => ({
  cardFindUnique: vi.fn(),
  cardFindMany: vi.fn(),
  cardUpdate: vi.fn(),
  reviewLogFindFirst: vi.fn(),
  reviewLogFindMany: vi.fn(),
  reviewLogCreate: vi.fn(),
  masteryFindUnique: vi.fn(),
  masteryFindMany: vi.fn(),
  masteryUpsert: vi.fn(),
  exerciseRecordFindMany: vi.fn(),
  exerciseRecordCreate: vi.fn(),
  exerciseRecordUpdate: vi.fn(),
  userFindUnique: vi.fn(),
  userUpdate: vi.fn(),
  achievementFindMany: vi.fn(),
  achievementCreateMany: vi.fn(),
  pointFindMany: vi.fn(),
  exerciseCreate: vi.fn(),
  exerciseFindUnique: vi.fn(),
  transaction: vi.fn(),
  extractJson: vi.fn(),
  rateLimit: vi.fn(),
}));

const store: {
  card: TestCard;
  reviewLogs: TestReviewLog[];
  exercises: TestExercise[];
  exerciseRecords: TestExerciseRecord[];
  mastery: { score: number; isWeak: boolean; reviewCount: number; correctRate: number | null };
  xpTotal: number;
} = {
  card: {
    id: 'f1', ownerId: 'u1', pointId: 'p1', contentId: 'c1', status: 'NEW',
    easeFactor: 2.5, intervalDays: 0, repetitions: 0, nextReviewAt: new Date('2026-10-01T00:00:00.000Z'),
  },
  reviewLogs: [],
  exercises: [],
  exerciseRecords: [],
  mastery: { score: 0.5, isWeak: true, reviewCount: 0, correctRate: null },
  xpTotal: 0,
};

const transactionClient = {
  flashcard: { findMany: mocks.cardFindMany, update: mocks.cardUpdate },
  reviewLog: { findFirst: mocks.reviewLogFindFirst, findMany: mocks.reviewLogFindMany, create: mocks.reviewLogCreate },
  mastery: { findUnique: mocks.masteryFindUnique, upsert: mocks.masteryUpsert },
  exerciseRecord: { findMany: mocks.exerciseRecordFindMany, create: mocks.exerciseRecordCreate, update: mocks.exerciseRecordUpdate },
  user: { findUnique: mocks.userFindUnique, update: mocks.userUpdate },
  userAchievement: { findMany: mocks.achievementFindMany, createMany: mocks.achievementCreateMany },
};

vi.mock('@/lib/prisma', () => ({
  prisma: {
    flashcard: { findUnique: mocks.cardFindUnique, findMany: mocks.cardFindMany, update: mocks.cardUpdate },
    reviewLog: { findFirst: mocks.reviewLogFindFirst, findMany: mocks.reviewLogFindMany, create: mocks.reviewLogCreate },
    mastery: { findUnique: mocks.masteryFindUnique, findMany: mocks.masteryFindMany, upsert: mocks.masteryUpsert },
    exerciseRecord: { findMany: mocks.exerciseRecordFindMany, create: mocks.exerciseRecordCreate, update: mocks.exerciseRecordUpdate },
    user: { findUnique: mocks.userFindUnique, update: mocks.userUpdate },
    userAchievement: { findMany: mocks.achievementFindMany, createMany: mocks.achievementCreateMany },
    knowledgePoint: { findMany: mocks.pointFindMany },
    exercise: { create: mocks.exerciseCreate, findUnique: mocks.exerciseFindUnique },
    $transaction: mocks.transaction,
  },
}));

vi.mock('@/lib/ai/spark', () => ({
  modelProvider: (): 'spark' => 'spark',
  AiError: class AiError extends Error { readonly code = 'UPSTREAM_ERROR'; },
  extractJson: mocks.extractJson,
}));

vi.mock('@/lib/api/rate-limit', () => ({
  rateLimit: mocks.rateLimit,
  RateLimitPolicy: { ai: { limit: 10, windowMs: 60_000 } },
}));

import { signAccessToken } from '@/lib/auth/jwt';
import { POST as reviewCard } from '@/app/api/flashcards/[id]/review/route';
import { POST as generateExercises } from '@/app/api/exercises/generate/route';
import { POST as answerExercise } from '@/app/api/exercises/[id]/answer/route';

const token = signAccessToken({ sub: 'u1', email: 'a@b.com', role: 'student' });

function request(url: string, body: unknown): NextRequest {
  return new NextRequest(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('review-to-exercise mastery closure', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store.card = {
      id: 'f1', ownerId: 'u1', pointId: 'p1', contentId: 'c1', status: 'NEW',
      easeFactor: 2.5, intervalDays: 0, repetitions: 0, nextReviewAt: new Date('2026-10-01T00:00:00.000Z'),
    };
    store.reviewLogs = [];
    store.exercises = [];
    store.exerciseRecords = [];
    store.mastery = { score: 0.5, isWeak: true, reviewCount: 0, correctRate: null };
    store.xpTotal = 0;

    mocks.transaction.mockImplementation(async (operation: unknown): Promise<unknown> => {
      if (typeof operation === 'function') {
        return await (operation as (tx: typeof transactionClient) => Promise<unknown>)(transactionClient);
      }
      if (Array.isArray(operation)) return await Promise.all(operation);
      return operation;
    });
    mocks.cardFindUnique.mockImplementation(async () => ({ ...store.card }));
    mocks.cardFindMany.mockImplementation(async () => [{ id: store.card.id }]);
    mocks.cardUpdate.mockImplementation(async ({ data }: { data: Partial<TestCard> }) => {
      store.card = { ...store.card, ...data };
      return store.card;
    });
    mocks.reviewLogFindFirst.mockImplementation(async () => {
      const latest = store.reviewLogs.at(-1);
      return latest ? { streakAfter: latest.streakAfter } : null;
    });
    mocks.reviewLogFindMany.mockImplementation(async () => store.reviewLogs.map(({ flashcardId, rating, reviewedAt }) => ({ flashcardId, rating, reviewedAt })));
    mocks.reviewLogCreate.mockImplementation(async ({ data }: { data: TestReviewLog }) => {
      store.reviewLogs.push(data);
      return data;
    });
    mocks.masteryFindUnique.mockImplementation(async () => ({ score: store.mastery.score }));
    mocks.masteryFindMany.mockImplementation(async () => [{
      pointId: 'p1', score: store.mastery.score, isWeak: store.mastery.isWeak,
      reviewCount: store.mastery.reviewCount, correctRate: store.mastery.correctRate,
      updatedAt: new Date(), point: { title: '函数', tags: ['数学'], contentId: 'c1', content: { title: '高等数学' } },
    }]);
    mocks.masteryUpsert.mockImplementation(async ({ create, update }: { create: typeof store.mastery; update: typeof store.mastery }) => {
      store.mastery = { ...(store.mastery.score === 0.5 && store.mastery.reviewCount === 0 ? create : update) };
      return store.mastery;
    });
    mocks.exerciseRecordFindMany.mockImplementation(async () => store.exerciseRecords.map(({ correct }) => ({ correct })));
    mocks.exerciseRecordCreate.mockImplementation(async ({ data }: { data: Omit<TestExerciseRecord, 'id'> }) => {
      const record = { ...data, id: `record_${store.exerciseRecords.length + 1}` };
      store.exerciseRecords.push(record);
      return record;
    });
    mocks.exerciseRecordUpdate.mockImplementation(async ({ where, data }: { where: { id: string }; data: { masteryDelta: number } }) => {
      const record = store.exerciseRecords.find((item) => item.id === where.id);
      if (record) record.masteryDelta = data.masteryDelta;
      return record;
    });
    mocks.userFindUnique.mockImplementation(async () => ({ xpTotal: store.xpTotal }));
    mocks.userUpdate.mockImplementation(async ({ data }: { data: { xpTotal: { increment: number } } }) => {
      store.xpTotal += data.xpTotal.increment;
      return { xpTotal: store.xpTotal };
    });
    mocks.achievementFindMany.mockResolvedValue([]);
    mocks.achievementCreateMany.mockResolvedValue({ count: 0 });
    mocks.pointFindMany.mockImplementation(async () => store.mastery.isWeak ? [{
      id: 'p1', contentId: 'c1', title: '函数', summary: '函数的定义域与值域', createdAt: new Date(),
    }] : []);
    mocks.exerciseCreate.mockImplementation(async ({ data }: { data: Omit<TestExercise, 'id'> }) => {
      const exercise = { ...data, id: `e${store.exercises.length + 1}` };
      store.exercises.push(exercise);
      return exercise;
    });
    mocks.exerciseFindUnique.mockImplementation(async ({ where }: { where: { id: string } }) => {
      const exercise = store.exercises.find((item) => item.id === where.id);
      return exercise ? { ...exercise, point: { ownerId: 'u1' } } : null;
    });
    mocks.extractJson.mockResolvedValue({ data: { questions: [{
      pointIndex: 0,
      type: 'single_choice',
      question: '函数的定义域是什么？',
      options: ['输入集合', '输出集合'],
      correctAnswer: '输入集合',
      explanation: '定义域是自变量允许取值的集合。',
    }] } });
    mocks.rateLimit.mockResolvedValue({ allowed: true, remaining: 9, retryAfter: 0 });
  });

  it('carries a low flashcard rating into weak mastery, creates practice and writes its answer back', async () => {
    const reviewResponse = await reviewCard(
      request('http://localhost/api/flashcards/f1/review', { rating: 0 }),
      { params: { id: 'f1' } },
    );
    expect(reviewResponse.status).toBe(200);
    expect(store.mastery).toMatchObject({ score: 0, isWeak: true, reviewCount: 1, correctRate: null });
    expect((await reviewResponse.json()).data.masteryDelta).toBe(-0.5);

    const generateResponse = await generateExercises(
      request('http://localhost/api/exercises/generate', { count: 1, type: 'single_choice' }),
      {},
    );
    expect(generateResponse.status).toBe(200);
    expect(mocks.pointFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { ownerId: 'u1', masteries: { some: { learnerId: 'u1', isWeak: true } } },
    }));
    expect(store.exercises).toHaveLength(1);

    const answerResponse = await answerExercise(
      request('http://localhost/api/exercises/e1/answer', { userAnswer: '输入集合' }),
      { params: { id: 'e1' } },
    );
    expect(answerResponse.status).toBe(200);
    expect((await answerResponse.json()).data).toMatchObject({ correct: true, masteryDelta: 0.3 });
    expect(store.mastery).toMatchObject({ score: 0.3, isWeak: true, reviewCount: 1, correctRate: 1 });
    expect(store.exerciseRecords).toEqual([expect.objectContaining({ correct: true, masteryDelta: 0.3 })]);
  });
});
