import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  pointFindMany: vi.fn(),
  buildContext: vi.fn(),
  chat: vi.fn(),
  rateLimit: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    learningContent: { findUnique: mocks.findUnique },
    knowledgePoint: { findMany: mocks.pointFindMany },
  },
}));

vi.mock('@/lib/jobs/pipeline/context-builder', () => ({ buildStructuredContext: mocks.buildContext }));

vi.mock('@/lib/ai/spark', () => ({ chat: mocks.chat }));

vi.mock('@/lib/api/rate-limit', () => ({
  rateLimit: mocks.rateLimit,
  RateLimitPolicy: { ai: { limit: 10, windowMs: 60_000 } },
}));

import { signAccessToken } from '@/lib/auth/jwt';
import { POST } from '@/app/api/contents/[id]/ai/summary/route';

/**
 * POST /api/contents/:id/ai/summary 单测（tasks.md §6.5）
 */

const token = signAccessToken({ sub: 'u1', email: 'a@b.com', role: 'student' });

function makeRequest(withAuth = true): NextRequest {
  const headers = new Headers();
  if (withAuth) headers.set('authorization', `Bearer ${token}`);
  return new NextRequest('http://localhost/api/contents/c1/ai/summary', { method: 'POST', headers });
}

describe('POST ai/summary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findUnique.mockResolvedValue({ id: 'c1', ownerId: 'u1' });
    mocks.pointFindMany.mockResolvedValue([{ title: 'T', summary: 'S', importance: 5 }]);
    mocks.buildContext.mockResolvedValue({
      text: '上下文内容',
      stats: { transcriptCount: 1, textBlockCount: 2, noteCount: 0 },
      truncated: false,
    });
    mocks.chat.mockResolvedValue({ content: '这是摘要。' });
    mocks.rateLimit.mockResolvedValue({ allowed: true, remaining: 9, retryAfter: 0 });
  });

  it('generates a summary with basedOn stats', async () => {
    const res = await POST(makeRequest(), { params: { id: 'c1' } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.summary).toBe('这是摘要。');
    expect(body.data.basedOn).toEqual({ transcriptCount: 1, textBlockCount: 2, noteCount: 0 });
    expect(body.data.summaryId).toBeTruthy();
  });

  it('returns 429 before reading content when the AI rate limit is exceeded', async () => {
    mocks.rateLimit.mockResolvedValueOnce({ allowed: false, remaining: 0, retryAfter: 24 });
    const res = await POST(makeRequest(), { params: { id: 'c1' } });
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('24');
    expect((await res.json()).error.code).toBe('RATE_LIMITED');
    expect(mocks.findUnique).not.toHaveBeenCalled();
  });

  it('returns 409 NO_UNDERSTANDING when there is no context', async () => {
    mocks.buildContext.mockResolvedValueOnce({
      text: '  ',
      stats: { transcriptCount: 0, textBlockCount: 0, noteCount: 0 },
      truncated: false,
    });
    const res = await POST(makeRequest(), { params: { id: 'c1' } });
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('NO_UNDERSTANDING');
  });

  it('returns 503 AI_UNAVAILABLE when the model fails', async () => {
    mocks.chat.mockRejectedValueOnce(new Error('MISSING_API_KEY'));
    const res = await POST(makeRequest(), { params: { id: 'c1' } });
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe('AI_UNAVAILABLE');
  });

  it('blocks unsafe output', async () => {
    mocks.chat.mockResolvedValueOnce({ content: '这里有赌博内容' });
    const res = await POST(makeRequest(), { params: { id: 'c1' } });
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe('CONTENT_BLOCKED');
  });

  it('returns 404 when missing', async () => {
    mocks.findUnique.mockResolvedValueOnce(null);
    expect((await POST(makeRequest(), { params: { id: 'c1' } })).status).toBe(404);
  });
});
