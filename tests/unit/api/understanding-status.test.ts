import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  jobFindFirst: vi.fn(),
  transcriptCount: vi.fn(),
  textBlockCount: vi.fn(),
  pointCount: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    learningContent: { findUnique: mocks.findUnique },
    asyncJob: { findFirst: mocks.jobFindFirst },
    transcriptSegment: { count: mocks.transcriptCount },
    textBlock: { count: mocks.textBlockCount },
    knowledgePoint: { count: mocks.pointCount },
  },
}));

import { signAccessToken } from '@/lib/auth/jwt';
import { GET } from '@/app/api/contents/[id]/understanding/status/route';

/**
 * GET /api/contents/:id/understanding/status 单测（tasks.md §6.5）
 */

const token = signAccessToken({ sub: 'u1', email: 'a@b.com', role: 'student' });

function makeRequest(withAuth = true): NextRequest {
  const headers = new Headers();
  if (withAuth) headers.set('authorization', `Bearer ${token}`);
  return new NextRequest('http://localhost/api/contents/c1/understanding/status', { headers });
}

function makeContent(overrides: Record<string, unknown> = {}) {
  return { id: 'c1', ownerId: 'u1', understandingStatus: 'RUNNING', ...overrides };
}

describe('GET understanding status', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findUnique.mockResolvedValue(makeContent());
    mocks.jobFindFirst.mockResolvedValue({ stage: 'deep-extract', errorReason: null });
    mocks.transcriptCount.mockResolvedValue(0);
    mocks.textBlockCount.mockResolvedValue(0);
    mocks.pointCount.mockResolvedValue(0);
  });

  it('returns 404 when content is missing', async () => {
    mocks.findUnique.mockResolvedValueOnce(null);
    const res = await GET(makeRequest(), { params: { id: 'c1' } });
    expect(res.status).toBe(404);
  });

  it('maps RUNNING + job stage to the current phase', async () => {
    const res = await GET(makeRequest(), { params: { id: 'c1' } });
    const body = await res.json();
    expect(body.data.phase).toBe('deep-extract');
  });

  it('maps NONE to phase none', async () => {
    mocks.findUnique.mockResolvedValueOnce(makeContent({ understandingStatus: 'NONE' }));
    const body = await (await GET(makeRequest(), { params: { id: 'c1' } })).json();
    expect(body.data.phase).toBe('none');
  });

  it('maps COMPLETED to completed', async () => {
    mocks.findUnique.mockResolvedValueOnce(makeContent({ understandingStatus: 'COMPLETED' }));
    const body = await (await GET(makeRequest(), { params: { id: 'c1' } })).json();
    expect(body.data.phase).toBe('completed');
  });

  it('maps FAILED and surfaces the failure reason', async () => {
    mocks.findUnique.mockResolvedValueOnce(makeContent({ understandingStatus: 'FAILED' }));
    mocks.jobFindFirst.mockResolvedValueOnce({ stage: 'light-filter', errorReason: 'boom' });
    const body = await (await GET(makeRequest(), { params: { id: 'c1' } })).json();
    expect(body.data.phase).toBe('failed');
    expect(body.data.failureReason).toBe('boom');
  });

  it('derives stageDetail from produced artifacts', async () => {
    mocks.transcriptCount.mockResolvedValueOnce(3);
    mocks.textBlockCount.mockResolvedValueOnce(2);
    mocks.pointCount.mockResolvedValueOnce(5);
    const body = await (await GET(makeRequest(), { params: { id: 'c1' } })).json();
    expect(body.data.stageDetail).toEqual({
      classify: 'done',
      selectFrames: 'done',
      asr: 'done',
      extract: 'done',
    });
  });
});
