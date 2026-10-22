import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const mocks = vi.hoisted(() => ({
  randomInt: vi.fn(),
  masteryFindMany: vi.fn(),
  pointFindMany: vi.fn(),
  flashcardFindMany: vi.fn(),
  reviewLogFindMany: vi.fn(),
  exerciseFindUnique: vi.fn(),
  exerciseCreate: vi.fn(),
  exerciseRecordCreate: vi.fn(),
  exerciseRecordUpdate: vi.fn(),
  transaction: vi.fn(),
  extractJson: vi.fn(),
  recalculateMastery: vi.fn(),
  rateLimit: vi.fn(),
}));

vi.mock('node:crypto', async () => ({
  ...await vi.importActual<typeof import('node:crypto')>('node:crypto'),
  randomInt: mocks.randomInt,
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    mastery: { findMany: mocks.masteryFindMany },
    knowledgePoint: { findMany: mocks.pointFindMany },
    flashcard: { findMany: mocks.flashcardFindMany },
    reviewLog: { findMany: mocks.reviewLogFindMany },
    exercise: { findUnique: mocks.exerciseFindUnique, create: mocks.exerciseCreate },
    $transaction: mocks.transaction,
  },
}));

vi.mock('@/lib/ai/spark', async () => {
  const actual = await vi.importActual<typeof import('@/lib/ai/spark')>('@/lib/ai/spark');
  return { ...actual, extractJson: mocks.extractJson };
});

vi.mock('@/lib/domain/mastery', () => ({
  recalculateMastery: mocks.recalculateMastery,
}));

vi.mock('@/lib/api/rate-limit', () => ({
  rateLimit: mocks.rateLimit,
  RateLimitPolicy: { ai: { limit: 10, windowMs: 60_000 } },
}));

import { signAccessToken } from '@/lib/auth/jwt';
import { AiError } from '@/lib/ai/spark';
import { POST as answerExercise } from '@/app/api/exercises/[id]/answer/route';
import { POST as generateExercises } from '@/app/api/exercises/generate/route';
import { GET as getMastery } from '@/app/api/mastery/route';
import { GET as getWeakPoints } from '@/app/api/mastery/weak-points/route';

const token = signAccessToken({ sub: 'u1', email: 'a@b.com', role: 'student' });

function req(url: string, init: RequestInit = {}): NextRequest {
  const headers = new Headers(init.headers);
  headers.set('authorization', `Bearer ${token}`);
  return new NextRequest(url, {
    method: init.method,
    body: init.body ?? undefined,
    headers,
  });
}

function jsonInit(body: unknown): RequestInit {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

describe('GET /api/mastery', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the current learner mastery summary', async () => {
    mocks.masteryFindMany.mockResolvedValue([
      {
        pointId: 'p1',
        score: 0.4,
        isWeak: true,
        reviewCount: 2,
        correctRate: null,
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        point: { title: '函数' },
      },
    ]);

    const res = await getMastery(req('http://localhost/api/mastery'), {});
    expect(res.status).toBe(200);
    expect((await res.json()).data.items).toEqual([
      {
        pointId: 'p1',
        title: '函数',
        score: 0.4,
        isWeak: true,
        reviewCount: 2,
        correctRate: null,
      },
    ]);
    expect(mocks.masteryFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { learnerId: 'u1' } }));
  });
});

describe('GET /api/mastery/weak-points', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.masteryFindMany.mockResolvedValue([
      {
        pointId: 'p1',
        score: 0.3,
        point: { title: '函数', tags: ['数学'], contentId: 'c1', content: { title: '高等数学' } },
      },
    ]);
    mocks.flashcardFindMany.mockResolvedValue([{ id: 'f1', pointId: 'p1' }]);
    mocks.reviewLogFindMany.mockResolvedValue([
      { flashcardId: 'f1', reviewedAt: new Date('2026-01-01T00:00:00.000Z') },
    ]);
  });

  it('returns weak point context and review metadata', async () => {
    const res = await getWeakPoints(req('http://localhost/api/mastery/weak-points'), {});
    expect(res.status).toBe(200);
    expect((await res.json()).data.items[0]).toEqual({
      pointId: 'p1',
      title: '函数',
      tags: ['数学'],
      score: 0.3,
      contentId: 'c1',
      contentTitle: '高等数学',
      relatedFlashcardCount: 1,
      lastReviewAt: '2026-01-01T00:00:00.000Z',
    });
  });

  it('returns an empty list when the learner has no weak points', async () => {
    mocks.masteryFindMany.mockResolvedValueOnce([]);
    const res = await getWeakPoints(req('http://localhost/api/mastery/weak-points'), {});
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ items: [] });
    expect(mocks.flashcardFindMany).not.toHaveBeenCalled();
  });
});

describe('POST /api/exercises/generate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.randomInt.mockReturnValue(0);
    mocks.pointFindMany.mockResolvedValue([
      { id: 'p1', contentId: 'c1', title: '函数', summary: '函数的定义与性质', createdAt: new Date() },
    ]);
    mocks.extractJson.mockResolvedValue({
      data: {
        questions: [{
          pointIndex: 0,
          type: 'single_choice',
          question: '函数的定义域是什么？',
          options: ['输入集合', '输出集合'],
          correctAnswer: '输入集合',
          explanation: '定义域是允许输入的自变量集合。',
        }],
      },
    });
    mocks.exerciseCreate.mockResolvedValue({
      id: 'e1',
      pointId: 'p1',
      contentId: 'c1',
      type: 'SINGLE_CHOICE',
      question: '函数的定义域是什么？',
      options: ['输入集合', '输出集合'],
      correctAnswer: '输入集合',
      explanation: '定义域是允许输入的自变量集合。',
    });
    mocks.transaction.mockImplementation((queries: Promise<unknown>[]) => Promise.all(queries));
    mocks.rateLimit.mockResolvedValue({ allowed: true, remaining: 9, retryAfter: 0 });
  });

  it('maps concrete named choices to either answer position without weakening option checks', async (): Promise<void> => {
    const pair = { question: '定义域是什么？', correctOption: '输入集合', wrongOption: '输出集合', explanation: '定义域是允许输入的集合。' };
    for (const position of [0, 1]) {
      mocks.randomInt.mockReturnValue(position);
      await generateExercises(req('http://localhost/api/exercises/generate', jsonInit({ count: 1 })), {});
      const schema = mocks.extractJson.mock.lastCall?.[1] as z.ZodType<{ questions: Array<{ options: string[]; correctAnswer: string }> }>;
      const result = schema.parse(pair).questions[0];
      expect(result.options[position]).toBe(pair.correctOption);
      expect(result.correctAnswer).toBe(pair.correctOption);
      for (const wrongOption of [' 输入集合 ', 'A、 输 入 集 合', '选项B', '表述错误，与规则不符']) {
        expect(schema.safeParse({ ...pair, wrongOption }).success).toBe(false);
      }
      expect(schema.safeParse({ ...pair, answerIndex: 1 }).success).toBe(false);
    }
  });

  it('corrects duplicate named choices through the real bounded retry before an atomic save', async (): Promise<void> => {
    const actual = await vi.importActual<typeof import('@/lib/ai/spark')>('@/lib/ai/spark');
    const pair = { question: '定义域是什么？', correctOption: '输入集合', wrongOption: '输入集合', explanation: '定义域是允许输入的集合。' };
    const respond = (value: unknown): Response => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(value) }, finish_reason: 'stop' }] }), { status: 200 });
    const fetchMock = vi.fn().mockResolvedValueOnce(respond(pair)).mockResolvedValueOnce(respond({ ...pair, wrongOption: '输出集合' }));
    const previousKey = process.env.SPARK_API_PASSWORD;
    process.env.SPARK_API_PASSWORD = 'test-only-key';
    vi.stubGlobal('fetch', fetchMock); mocks.extractJson.mockImplementation(actual.extractJson);
    try {
      const response = await generateExercises(req('http://localhost/api/exercises/generate', jsonInit({ count: 1 })), {});
      expect(response.status).toBe(200);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(String(fetchMock.mock.calls[1][1]?.body)).toContain('互不重复');
      expect(mocks.exerciseCreate).toHaveBeenCalledTimes(1);
      expect(mocks.exerciseCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ correctAnswer: '输入集合', options: ['输入集合', '输出集合'] }) }));
      expect((await response.json()).data.questions[0]).not.toHaveProperty('correctAnswer');
    } finally { vi.unstubAllGlobals(); if (previousKey === undefined) delete process.env.SPARK_API_PASSWORD; else process.env.SPARK_API_PASSWORD = previousKey; }
  });

  it('generates and persists validated questions', async () => {
    const res = await generateExercises(
      req('http://localhost/api/exercises/generate', jsonInit({ count: 1, type: 'single_choice' })),
      {},
    );
    expect(res.status).toBe(200);
    const question = (await res.json()).data.questions[0];
    expect(question).not.toHaveProperty('correctAnswer');
    expect(question).not.toHaveProperty('explanation');
    expect(question).toMatchObject({
      exerciseId: 'e1',
      pointId: 'p1',
      type: 'single_choice',
    });
    expect(mocks.exerciseCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ pointId: 'p1', type: 'SINGLE_CHOICE' }),
    }));
  });
  it('rejects malformed choice options and answers through the model response schema', async () => {
    await generateExercises(req('http://localhost/api/exercises/generate', jsonInit({ count: 1, type: 'single_choice' })), {});
    const schema = mocks.extractJson.mock.calls[0][1] as z.ZodType<unknown>;
    const question = { pointIndex: 0, type: 'single_choice', question: '定义域是什么？', options: ['输入集合', '输出集合'], correctAnswer: '输入集合', explanation: '定义域表示输入集合。' };
    expect(schema.safeParse({ questions: [question] }).success).toBe(true);
    for (const change of [{ options: ['输入集合'] }, { options: ['输入集合', ' 输入集合 '] }, { correctAnswer: '不存在的选项' }]) {
      expect(schema.safeParse({ questions: [{ ...question, ...change }] }).success).toBe(false);
    }
  });
  it('rejects whitespace-only model questions, options and explanations', async () => {
    await generateExercises(req('http://localhost/api/exercises/generate', jsonInit({ count: 1, type: 'single_choice' })), {});
    const schema = mocks.extractJson.mock.calls[0][1] as z.ZodType<unknown>;
    const valid = { pointIndex: 0, type: 'single_choice', question: '定义域是什么？', options: ['输入集合', '输出集合'], correctAnswer: '输入集合', explanation: '定义域是输入集合。' };
    for (const change of [{ question: ' ' }, { options: ['输入集合', ' '] }, { correctAnswer: ' ' }, { explanation: ' ' }]) {
      expect(schema.safeParse({ questions: [{ ...valid, ...change }] }).success).toBe(false);
    }
  });

  it('rejects the observed label-only options in both model formats, retaining actual short answers', async (): Promise<void> => {
    await generateExercises(req('http://localhost/api/exercises/generate', jsonInit({ count: 1, type: 'single_choice' })), {});
    const schema = mocks.extractJson.mock.calls[0][1] as z.ZodType<unknown>;
    const question = { question: '链式法则内容是什么？', options: ['实际内容', '另一内容'], answerIndex: 0, explanation: '依据资料。' };
    for (const options of [['A', 'B', 'C', 'D'], ['Ａ．', 'Ｂ．'], ['(A)', '[B]'], ['字母A', '字母B'], ['选项A', '实际内容'], ['待补充', '实际内容']]) {
      expect(schema.safeParse({ ...question, options }).success).toBe(false);
      expect(schema.safeParse({ questions: [{ ...question, pointIndex: 0, type: 'single_choice', options, correctAnswer: options[0] }] }).success).toBe(false);
    }
    for (const options of [['1', '2'], ['x', 'y'], ['A型血', 'B型血'], ['+', '-']]) {
      expect(schema.safeParse({ ...question, options }).success).toBe(true);
    }
    expect(schema.safeParse({ ...question, options: ['实际内容', 'A、 实 际 内 容'] }).success).toBe(false);
  });

  it('uses the real schema retry to correct placeholder options before persisting', async (): Promise<void> => {
    const actual = await vi.importActual<typeof import('@/lib/ai/spark')>('@/lib/ai/spark');
    const previousKey = process.env.SPARK_API_PASSWORD;
    process.env.SPARK_API_PASSWORD = 'unit-test-only';
    const bad = { question: '定义域是什么？', options: ['A', 'B'], answerIndex: 0, explanation: '依据定义。' };
    const good = { ...bad, options: ['输入集合', '输出集合'] };
    const respond = (content: unknown): Response => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) }, finish_reason: 'stop' }] }));
    const fetchMock = vi.fn().mockResolvedValueOnce(respond(bad)).mockResolvedValueOnce(respond(good));
    vi.stubGlobal('fetch', fetchMock); mocks.extractJson.mockImplementation(actual.extractJson);
    try {
      const response = await generateExercises(req('http://localhost/api/exercises/generate', jsonInit({ count: 1, type: 'single_choice' })), {});
      expect(response.status).toBe(200); expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(String(fetchMock.mock.calls[1][1].body)).toContain('选项必须有实际答案内容');
      expect(mocks.exerciseCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ options: good.options, correctAnswer: '输入集合' }) }));
    } finally {
      vi.unstubAllGlobals(); if (previousKey === undefined) delete process.env.SPARK_API_PASSWORD; else process.env.SPARK_API_PASSWORD = previousKey;
    }
  });
  it('rejects observed meta-only option judgements while allowing substantive technical answers', async (): Promise<void> => {
    await generateExercises(req('http://localhost/api/exercises/generate', jsonInit({ count: 1 })), {});
    const schema = mocks.extractJson.mock.calls[0][1] as z.ZodType<unknown>;
    const question = { question: '请选择具体结论。', options: ['具体内容', '另一具体内容'], answerIndex: 0, explanation: '依据资料。' };
    for (const option of ['表述错误，与映射判定规则不符', '表述混淆满射与单射判定规则，与满射判定规则不符', '描述有误，与规则不一致']) {
      expect(schema.safeParse({ ...question, options: [option, '具体内容'] }).success).toBe(false);
    }
    for (const option of ['混淆矩阵记录分类结果', '不存在逆映射', '错误处理包括记录异常', '不同输入可以对应相同输出']) {
      expect(schema.safeParse({ ...question, options: [option, '另一具体内容'] }).success).toBe(true);
    }
    expect(schema.safeParse({ insufficientEvidence: true }).success).toBe(true);
    expect(schema.safeParse({ ...question, insufficientEvidence: true }).success).toBe(false);
  });
  it('honors model abstention without retrying it or saving earlier validated questions', async (): Promise<void> => {
    const actual = await vi.importActual<typeof import('@/lib/ai/spark')>('@/lib/ai/spark');
    const previousKey = process.env.SPARK_API_PASSWORD; process.env.SPARK_API_PASSWORD = 'unit-test-only';
    const good = { question: '定义域是什么？', options: ['输入集合', '输出集合'], answerIndex: 0, explanation: '依据定义。' };
    const respond = (content: unknown): Response => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) }, finish_reason: 'stop' }] }));
    const fetchMock = vi.fn().mockResolvedValueOnce(respond(good)).mockResolvedValueOnce(respond({ insufficientEvidence: true }));
    vi.stubGlobal('fetch', fetchMock); mocks.extractJson.mockImplementation(actual.extractJson);
    try {
      const response = await generateExercises(req('http://localhost/api/exercises/generate', jsonInit({ count: 5 })), {});
      const body = await response.json(); expect(response.status).toBe(503);
      expect(body.error.details.reason).toBe('INSUFFICIENT_EVIDENCE'); expect(body.error.message).toContain('本批题目未保存');
      expect(fetchMock).toHaveBeenCalledTimes(2); expect(mocks.exerciseCreate).not.toHaveBeenCalled(); expect(mocks.transaction).not.toHaveBeenCalled();
      expect(String(fetchMock.mock.calls[1][1]?.body)).toContain('输入集合');
    } finally { vi.unstubAllGlobals(); if (previousKey === undefined) delete process.env.SPARK_API_PASSWORD; else process.env.SPARK_API_PASSWORD = previousKey; }
  });

  it('rejects a paraphrased repeat of an extracted answer fact after bounded correction without saving earlier questions', async (): Promise<void> => {
    const actual = await vi.importActual<typeof import('@/lib/ai/spark')>('@/lib/ai/spark');
    mocks.pointFindMany.mockResolvedValue([{ id: 'p1', contentId: 'c1', title: '原文精选', summary: '输入集合称为定义域，输出集合称为值域。', tags: ['原文精选'] }]);
    const first = { question: '定义域指什么？', correctOption: '输入集合。', wrongOption: '输出集合', explanation: '原文定义域是输入集合。' };
    const second = { ...first, question: '值域指什么？', correctOption: '输出集合', wrongOption: '输入集合', explanation: '原文值域是输出集合。' };
    const repeated = { ...first, question: '下列哪个是定义域？', correctOption: ' 输 入 集 合 ' };
    const respond = (value: unknown): Response => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(value) }, finish_reason: 'stop' }] }));
    const fetchMock = vi.fn().mockResolvedValueOnce(respond(first)).mockResolvedValueOnce(respond(second)).mockResolvedValueOnce(respond(repeated)).mockResolvedValueOnce(respond(repeated));
    const previousKey = process.env.SPARK_API_PASSWORD; process.env.SPARK_API_PASSWORD = 'test-only-key';
    vi.stubGlobal('fetch', fetchMock); mocks.extractJson.mockImplementation(actual.extractJson);
    try {
      const response = await generateExercises(req('http://localhost/api/exercises/generate', jsonInit({ count: 3 })), {});
      const body = await response.json();
      expect(response.status).toBe(503);
      expect(body.error.details.reason).toBe('DUPLICATE_FACT');
      expect(JSON.stringify(body)).not.toContain('输入集合');
      expect(fetchMock).toHaveBeenCalledTimes(4);
      expect(mocks.exerciseCreate).not.toHaveBeenCalled();
      expect(mocks.transaction).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); if (previousKey === undefined) delete process.env.SPARK_API_PASSWORD; else process.env.SPARK_API_PASSWORD = previousKey; }
  });

  it('rejects explicit explanation labels contradicting the stored answer', async (): Promise<void> => {
    await generateExercises(req('http://localhost/api/exercises/generate', jsonInit({ count: 1, type: 'single_choice' })), {});
    const schema = mocks.extractJson.mock.calls[0][1] as z.ZodType<unknown>;
    const question = { question: '定义域是什么？', options: ['输入集合', '输出集合'], answerIndex: 0, explanation: '输入集合是定义域。' };
    for (const explanation of ['选项A错误，选项B正确。', '正确选项为B。', '答案是B。', '选项A、B都正确。', 'A项不正确。', '选项一错误。', '第二项正确。']) {
      expect(schema.safeParse({ ...question, explanation }).success).toBe(false);
    }
    for (const explanation of ['选项A正确，选项B错误。', '正确答案为A。', '输入集合是定义域。', '第一项正确，选项二错误。']) {
      expect(schema.safeParse({ ...question, explanation }).success).toBe(true);
    }
    expect(schema.safeParse({ ...question, options: ['B型血', 'A型血'], explanation: '正确答案为B型血。' }).success).toBe(true);
  });

  it('does not persist even an earlier valid question when a later question exhausts quality retries', async (): Promise<void> => {
    const actual = await vi.importActual<typeof import('@/lib/ai/spark')>('@/lib/ai/spark');
    const previousKey = process.env.SPARK_API_PASSWORD; process.env.SPARK_API_PASSWORD = 'unit-test-only';
    const good = { question: '定义域是什么？', options: ['输入集合', '输出集合'], answerIndex: 0, explanation: '依据定义。' };
    const bad = { ...good, question: '值域是什么？', options: ['A', 'B'] };
    const respond = (content: unknown): Response => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) }, finish_reason: 'stop' }] }));
    const fetchMock = vi.fn().mockResolvedValueOnce(respond(good)).mockResolvedValueOnce(respond(bad)).mockResolvedValueOnce(respond(bad));
    vi.stubGlobal('fetch', fetchMock); mocks.extractJson.mockImplementation(actual.extractJson);
    try {
      const response = await generateExercises(req('http://localhost/api/exercises/generate', jsonInit({ count: 2, type: 'single_choice' })), {});
      expect(response.status).toBe(503); expect((await response.json()).error.message).toContain('本批题目未保存');
      expect(fetchMock).toHaveBeenCalledTimes(3); expect(mocks.exerciseCreate).not.toHaveBeenCalled(); expect(mocks.transaction).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals(); if (previousKey === undefined) delete process.env.SPARK_API_PASSWORD; else process.env.SPARK_API_PASSWORD = previousKey;
    }
  });
  it('returns and logs only whitelisted quality diagnostics without raw model messages', async (): Promise<void> => {
    const secret = 'private-model-secret-never-log';
    mocks.extractJson.mockRejectedValueOnce(new AiError(secret, 'SCHEMA_INVALID', 502, { kind: 'invalid_schema', attempts: 2, fields: ['options.[]'], issueCodes: ['custom'], rules: ['OPTION_CONTENT'] }));
    const warn = vi.spyOn(console, 'warn').mockImplementation((): void => undefined);
    try {
      const response = await generateExercises(req('http://localhost/api/exercises/generate', jsonInit({ count: 5 })), {});
      const body = await response.json();
      expect(response.status).toBe(503);
      expect(body.error.message).toContain('选项缺少实际内容'); expect(body.error.message).toContain('本批题目未保存');
      expect(body.error.details).toMatchObject({ reason: 'OPTION_CONTENT', failedQuestion: 1, requestedCount: 5 });
      expect(body.error.details.traceId).toMatch(/^tr_/);
      expect(JSON.stringify(body) + JSON.stringify(warn.mock.calls)).not.toContain(secret);
      expect(mocks.exerciseCreate).not.toHaveBeenCalled(); expect(mocks.transaction).not.toHaveBeenCalled();
    } finally { warn.mockRestore(); }
  });
  it('requires exactly one question in each model request', async () => {
    await generateExercises(req('http://localhost/api/exercises/generate', jsonInit({ count: 1, type: 'true_false' })), {});
    const schema = mocks.extractJson.mock.calls[0][1] as z.ZodType<unknown>;
    const first = { pointIndex: 0, type: 'true_false', question: '定义域是输入集合。', options: [], correctAnswer: 'true', explanation: '定义域是允许输入的集合。' };
    expect(schema.safeParse({ questions: [first, { ...first, question: '值域是输出集合？' }] }).success).toBe(false);
    expect(schema.safeParse({ questions: [first] }).success).toBe(true);
    expect(schema.safeParse({ questions: [first, { ...first, question: ' 定义域是输入集合？ ' }] }).success).toBe(false);
  });
  it('requires boolean questions to have no options and a canonical answer', async () => {
    await generateExercises(req('http://localhost/api/exercises/generate', jsonInit({ count: 1, type: 'true_false' })), {});
    const schema = mocks.extractJson.mock.calls[0][1] as z.ZodType<unknown>;
    const question = { pointIndex: 0, type: 'true_false', question: '定义域是输入集合。', options: [], correctAnswer: 'true', explanation: '成立。' };
    expect(schema.safeParse({ questions: [question] }).success).toBe(true);
    expect(schema.safeParse({ questions: [{ ...question, correctAnswer: '未知' }] }).success).toBe(false);
    expect(schema.safeParse({ questions: [{ ...question, options: ['true', 'false'] }] }).success).toBe(false);
    expect(schema.safeParse({ questions: [{ ...question, question: '定义域是什么？' }] }).success).toBe(false);
    expect(schema.safeParse({ questions: [{ ...question, explanation: '该论述错误，定义域是输入集合。' }] }).success).toBe(false);
  });

  it('returns 429 before selecting knowledge points when the AI rate limit is exceeded', async () => {
    mocks.rateLimit.mockResolvedValueOnce({ allowed: false, remaining: 0, retryAfter: 30 });
    const res = await generateExercises(
      req('http://localhost/api/exercises/generate', jsonInit({ count: 1 })),
      {},
    );
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('30');
    expect((await res.json()).error.code).toBe('RATE_LIMITED');
    expect(mocks.pointFindMany).not.toHaveBeenCalled();
  });

  it('collects five validated single-question batches before writing all questions', async () => {
    let index = 0;
    mocks.extractJson.mockImplementation(async (messages: unknown, schema: z.ZodType<unknown>) => {
      const batchCount = 1;
      const questions = Array.from({ length: batchCount }, () => ({
        pointIndex: 0, type: 'true_false', question: `第${++index}个定义判断。`, options: [], correctAnswer: 'true', explanation: '依据知识点定义。',
      }));
      expect(mocks.exerciseCreate).not.toHaveBeenCalled();
      return { data: schema.parse({ questions }) };
    });
    const response = await generateExercises(req('http://localhost/api/exercises/generate', jsonInit({ count: 5, type: 'true_false' })), {});
    expect(response.status).toBe(200);
    expect(mocks.extractJson).toHaveBeenCalledTimes(5);
    expect(mocks.exerciseCreate).toHaveBeenCalledTimes(5);
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
  });

  it('maps canonical boolean representations without accepting ambiguous answers', async () => {
    await generateExercises(req('http://localhost/api/exercises/generate', jsonInit({ count: 1, type: 'true_false' })), {});
    const schema = mocks.extractJson.mock.calls[0][1] as z.ZodType<unknown>;
    const question = { question: '定义域是输入集合。', answer: true, explanation: '定义域是输入集合。' };
    for (const answer of [true, false, 'true', 'false', [true], [false]]) {
      expect(schema.safeParse({ ...question, answer }).success).toBe(true);
    }
    for (const answer of [[], [true, false], 'unknown', 1]) {
      expect(schema.safeParse({ ...question, answer }).success).toBe(false);
    }
  });

  it('maps exactly one explicit answer index and rejects multiple or invalid indices', async () => {
    await generateExercises(req('http://localhost/api/exercises/generate', jsonInit({ count: 1, type: 'single_choice' })), {});
    const schema = mocks.extractJson.mock.calls[0][1] as z.ZodType<unknown>;
    const question = { question: '定义域是什么？', options: ['输入集合', '输出集合'], answerIndex: 0, explanation: '定义域是输入集合。' };
    expect(schema.safeParse(question).success).toBe(true);
    expect(schema.safeParse({ ...question, answerIndex: [0] }).success).toBe(true);
    for (const answerIndex of [[], [0, 1], 2, -1, '0']) {
      expect(schema.safeParse({ ...question, answerIndex }).success).toBe(false);
    }
    expect(schema.safeParse({ ...question, options: ['相同', '相同'] }).success).toBe(false);
  });

  it('rejects cross-batch duplicates and does not persist an incomplete request', async () => {
    const first = { pointIndex: 0, type: 'true_false', question: '定义域是输入集合。', options: [], correctAnswer: 'true', explanation: '依据定义。' };
    mocks.extractJson.mockResolvedValueOnce({ data: { questions: [first] } });
    mocks.extractJson.mockImplementationOnce(async (messages: unknown, schema: z.ZodType<unknown>) => {
      expect(schema.safeParse({ questions: [first] }).success).toBe(false);
      throw new Error('second batch invalid');
    });
    const response = await generateExercises(req('http://localhost/api/exercises/generate', jsonInit({ count: 3, type: 'true_false' })), {});
    expect(response.status).toBe(503);
    expect(mocks.exerciseCreate).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('returns NO_WEAK_POINT when no usable point exists', async () => {
    mocks.pointFindMany.mockResolvedValueOnce([]);
    const res = await generateExercises(
      req('http://localhost/api/exercises/generate', jsonInit({ count: 1 })),
      {},
    );
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('NO_WEAK_POINT');
  });

  it('uses only the explicitly selected provider and rejects invalid configuration', async (): Promise<void> => {
    const previous = process.env.LLM_PROVIDER;
    try {
      process.env.LLM_PROVIDER = 'spark';
      const response = await generateExercises(req('http://localhost/api/exercises/generate', jsonInit({ count: 1 })), {});
      expect(response.status).toBe(200);
      expect(mocks.extractJson.mock.calls[0][2].provider).toBe('spark');
      mocks.extractJson.mockClear(); mocks.exerciseCreate.mockClear();
      process.env.LLM_PROVIDER = 'invalid';
      expect((await generateExercises(req('http://localhost/api/exercises/generate', jsonInit({ count: 1 })), {})).status).toBe(503);
      expect(mocks.extractJson).not.toHaveBeenCalled(); expect(mocks.exerciseCreate).not.toHaveBeenCalled();
    } finally { if (previous === undefined) delete process.env.LLM_PROVIDER; else process.env.LLM_PROVIDER = previous; }
  });
});

describe('POST /api/exercises/:id/answer', () => {
  it.each([['B', true], ['b. 一次只能应对一个目标，难以应对多个目标', true], ['一次只能应对一个目标，难以应对多个目标', true], ['A', false], ['命中单一目标就等于发动饱和袭击', false]])('grades the corrected non-first option consistently: %s', async (userAnswer: string, correct: boolean): Promise<void> => {
    const options = ['单枚防空导弹能同时命中所有来袭目标', '一次只能应对一个目标，难以应对多个目标', '饱和袭击每次只包含一个目标', '命中单一目标就等于发动饱和袭击'];
    mocks.exerciseFindUnique.mockResolvedValue({ id: 'e1', pointId: 'p1', type: 'SINGLE_CHOICE', options, correctAnswer: options[1], explanation: '防御方只能应对一个目标', point: { ownerId: 'u1' } });
    const response = await answerExercise(req('http://localhost/api/exercises/e1/answer', jsonInit({ userAnswer })), { params: { id: 'e1' } });
    expect(response.status).toBe(200); expect((await response.json()).data.correct).toBe(correct);
    expect(mocks.exerciseRecordCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ correct }) }));
  });
  it.each([
    ['  Gradient\t\n Descent  ', 'gradient descent', true],
    ['梯度下降', '梯度下降', true],
    ['输入集合', '自变量集合', false],
    ['梯度下降。', '梯度下降', false],
    ['梯度 下降', '梯度下降', false],
  ])('grades short answers by normalized text only: %s', async (userAnswer: string, correctAnswer: string, correct: boolean): Promise<void> => {
    mocks.exerciseFindUnique.mockResolvedValue({ id: 'e1', pointId: 'p1', type: 'SHORT_ANSWER', options: [], correctAnswer, explanation: '参考依据', point: { ownerId: 'u1' } });
    const response = await answerExercise(req('http://localhost/api/exercises/e1/answer', jsonInit({ userAnswer })), { params: { id: 'e1' } });
    expect(response.status).toBe(200);
    expect((await response.json()).data).toMatchObject({ correct, correctAnswer });
    expect(mocks.exerciseRecordCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ userAnswer: userAnswer.trim(), correct }) }));
    expect(mocks.extractJson).not.toHaveBeenCalled();
  });
  it('accepts equivalent Chinese and English boolean answers', async () => {
    mocks.exerciseFindUnique.mockResolvedValue({ id: 'e1', pointId: 'p1', type: 'TRUE_FALSE', options: [], correctAnswer: 'true', explanation: '成立', point: { ownerId: 'u1' } });
    const response = await answerExercise(req('http://localhost/api/exercises/e1/answer', jsonInit({ userAnswer: '正确' })), { params: { id: 'e1' } });
    expect((await response.json()).data.correct).toBe(true);
  });
  it('accepts an option letter when the stored answer is option text', async () => {
    mocks.exerciseFindUnique.mockResolvedValue({ id: 'e1', pointId: 'p1', type: 'SINGLE_CHOICE', options: ['输入集合', '输出集合'], correctAnswer: '输入集合', explanation: '定义域', point: { ownerId: 'u1' } });
    const response = await answerExercise(req('http://localhost/api/exercises/e1/answer', jsonInit({ userAnswer: 'A' })), { params: { id: 'e1' } });
    expect((await response.json()).data.correct).toBe(true);
  });
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.exerciseFindUnique.mockResolvedValue({
      id: 'e1',
      pointId: 'p1',
      correctAnswer: '输入集合',
      explanation: '定义域是允许输入的自变量集合。',
      point: { ownerId: 'u1' },
    });
    mocks.exerciseRecordCreate.mockResolvedValue({ id: 'r1' });
    mocks.exerciseRecordUpdate.mockResolvedValue({});
    mocks.recalculateMastery.mockResolvedValue({ masteryDelta: 0.12 });
    mocks.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({
        exerciseRecord: {
          create: mocks.exerciseRecordCreate,
          update: mocks.exerciseRecordUpdate,
        },
      }),
    );
  });

  it('judges the answer and writes mastery delta', async () => {
    const res = await answerExercise(
      req('http://localhost/api/exercises/e1/answer', jsonInit({ userAnswer: '输入集合' })),
      { params: { id: 'e1' } },
    );
    expect(res.status).toBe(200);
    expect((await res.json()).data).toMatchObject({
      exerciseId: 'e1',
      correct: true,
      correctAnswer: '输入集合',
      masteryDelta: 0.12,
    });
    expect(mocks.exerciseRecordCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ learnerId: 'u1', correct: true, masteryDelta: 0 }),
    }));
    expect(mocks.exerciseRecordUpdate).toHaveBeenCalledWith({
      where: { id: 'r1' },
      data: { masteryDelta: 0.12 },
    });
  });

  it('returns 404 for a missing exercise', async () => {
    mocks.exerciseFindUnique.mockResolvedValueOnce(null);
    const res = await answerExercise(
      req('http://localhost/api/exercises/missing/answer', jsonInit({ userAnswer: 'x' })),
      { params: { id: 'missing' } },
    );
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe('EXERCISE_NOT_FOUND');
  });
});
