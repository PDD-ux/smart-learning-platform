import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  buildContext: vi.fn(),
  extractJson: vi.fn(),
  rateLimit: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: { learningContent: { findUnique: mocks.findUnique } },
}));

vi.mock('@/lib/jobs/pipeline/context-builder', () => ({ buildStructuredContext: mocks.buildContext }));

vi.mock('@/lib/ai/spark', async () => {
  const actual = await vi.importActual<typeof import('@/lib/ai/spark')>('@/lib/ai/spark');
  return { ...actual, extractJson: mocks.extractJson };
});

vi.mock('@/lib/api/rate-limit', () => ({
  rateLimit: mocks.rateLimit,
  RateLimitPolicy: { ai: { limit: 10, windowMs: 60_000 } },
}));

import { signAccessToken } from '@/lib/auth/jwt';
import { POST } from '@/app/api/contents/[id]/ai/qa/route';
import { AiError } from '@/lib/ai/spark';
import { taskLogger } from '@/lib/jobs/task-logger';

/**
 * POST /api/contents/:id/ai/qa 单测（tasks.md §6.5）
 */

const token = signAccessToken({ sub: 'u1', email: 'a@b.com', role: 'student' });

function makeRequest(body: unknown, withAuth = true): NextRequest {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (withAuth) headers.set('authorization', `Bearer ${token}`);
  return new NextRequest('http://localhost/api/contents/c1/ai/qa', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

describe('POST ai/qa', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findUnique.mockResolvedValue({ id: 'c1', ownerId: 'u1', contentType: 'VIDEO', durationSec: 60, pageCount: null });
    mocks.buildContext.mockResolvedValue({
      text: '上下文内容',
      stats: { transcriptCount: 1, textBlockCount: 0, noteCount: 0 },
      truncated: false,
      sourceSegments: [{ ref: { type: 'video', timestampSec: 12 }, text: '真实片段原文' }],
    });
    mocks.extractJson.mockResolvedValue({
      data: {
        answer: '答案是……',
        sourceIds: [1],
      },
    });
    mocks.rateLimit.mockResolvedValue({ allowed: true, remaining: 9, retryAfter: 0 });
  });

  it('answers with citations', async () => {
    const res = await POST(makeRequest({ question: '这是什么？' }), { params: { id: 'c1' } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.answer).toBe('答案是……');
    expect(body.data.citations[0].ref).toEqual({ type: 'video', timestampSec: 12 });
    expect(body.data.qaId).toBeTruthy();
    expect(body.data.citations[0].excerpt).toBe('真实片段原文');
  });

  it('reads paired source text and location on the server and deduplicates selections', async () => {
    mocks.extractJson.mockResolvedValueOnce({ data: { answer: '答案', sourceIds: [1, 1] } });
    const response = await POST(makeRequest({ question: 'Q' }), { params: { id: 'c1' } });
    expect(response.status).toBe(200);
    expect((await response.json()).data.citations).toEqual([{ ref: { type: 'video', timestampSec: 12 }, excerpt: '真实片段原文' }]);
  });

  it('rejects invented source ids and placeholder answers without rejecting an honest insufficient answer', async () => {
    await POST(makeRequest({ question: 'Q' }), { params: { id: 'c1' } });
    const schema = mocks.extractJson.mock.calls[0][1];
    expect(schema.safeParse({ answer: '回答', sourceIds: [2] }).success).toBe(false);
    expect(schema.safeParse({ answer: '回答', sourceIds: [0] }).success).toBe(false);
    expect(schema.safeParse({ answer: '资料不足', sourceIds: [] }).success).toBe(true);
    expect(schema.safeParse({ answer: '依据资料的回答', sourceIds: [] }).success).toBe(false);
  });

  it('returns 429 before reading content when the AI rate limit is exceeded', async () => {
    mocks.rateLimit.mockResolvedValueOnce({ allowed: false, remaining: 0, retryAfter: 42 });
    const res = await POST(makeRequest({ question: '这是什么？' }), { params: { id: 'c1' } });
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('42');
    expect((await res.json()).error.code).toBe('RATE_LIMITED');
    expect(mocks.findUnique).not.toHaveBeenCalled();
  });

  it('returns 400 QUESTION_EMPTY for a blank question', async () => {
    const res = await POST(makeRequest({ question: '   ' }), { params: { id: 'c1' } });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('QUESTION_EMPTY');
  });

  it('returns 409 NO_UNDERSTANDING when there is no context', async () => {
    mocks.buildContext.mockResolvedValueOnce({
      text: '',
      stats: { transcriptCount: 0, textBlockCount: 0, noteCount: 0 },
      truncated: false,
    });
    const res = await POST(makeRequest({ question: 'Q' }), { params: { id: 'c1' } });
    expect(res.status).toBe(409);
  });

  it('returns 503 AI_UNAVAILABLE when the model fails', async () => {
    mocks.extractJson.mockRejectedValueOnce(new Error('TIMEOUT'));
    const res = await POST(makeRequest({ question: 'Q' }), { params: { id: 'c1' } });
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe('AI_UNAVAILABLE');
  });
  it('records only a safe failure code and the upstream trace, without raw messages', async () => {
    const log = vi.spyOn(taskLogger, 'warn').mockImplementation(() => undefined);
    mocks.extractJson.mockRejectedValueOnce(new AiError('private credential must not be logged', 'SCHEMA_INVALID', 502));
    const response = await POST(makeRequest({ question: 'Q' }), { params: { id: 'c1' } });
    expect(response.status).toBe(503);
    expect(log).toHaveBeenCalledWith('qa: AI request failed', { contentId: 'c1', traceId: expect.any(String), code: 'SCHEMA_INVALID' });
    expect(JSON.stringify(log.mock.calls)).not.toContain('private credential');
    expect(mocks.extractJson.mock.calls[0][2].traceId).toBe(log.mock.calls[0][1]?.traceId);
    log.mockRestore();
  });
});
