import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  transcriptFindMany: vi.fn(),
  textBlockFindMany: vi.fn(),
  pointFindMany: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    learningContent: { findUnique: mocks.findUnique },
    transcriptSegment: { findMany: mocks.transcriptFindMany },
    textBlock: { findMany: mocks.textBlockFindMany },
    knowledgePoint: { findMany: mocks.pointFindMany },
  },
}));

import { signAccessToken } from '@/lib/auth/jwt';
import { GET } from '@/app/api/contents/[id]/understanding/route';

/**
 * GET /api/contents/:id/understanding 单测（tasks.md §6.5）
 */

const token = signAccessToken({ sub: 'u1', email: 'a@b.com', role: 'student' });

function makeRequest(withAuth = true): NextRequest {
  const headers = new Headers();
  if (withAuth) headers.set('authorization', `Bearer ${token}`);
  return new NextRequest('http://localhost/api/contents/c1/understanding', { headers });
}

describe('GET understanding products', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findUnique.mockResolvedValue({ id: 'c1', ownerId: 'u1', understandingStatus: 'COMPLETED' });
    mocks.transcriptFindMany.mockResolvedValue([
      { id: 's1', contentId: 'c1', seq: 0, startMs: 0, endMs: 6000, text: '转写' },
    ]);
    mocks.textBlockFindMany.mockResolvedValue([
      { id: 'b1', contentId: 'c1', source: 'OCR', sequence: 0, ref: { type: 'document', page: 1 }, text: '板书' },
    ]);
    mocks.pointFindMany.mockResolvedValue([
      {
        id: 'p1',
        contentId: 'c1',
        ownerId: 'u1',
        title: 'T',
        summary: 'S',
        tags: [],
        importance: 3,
        refs: [],
        createdAt: new Date(),
      },
    ]);
  });

  it('returns products with status', async () => {
    const res = await GET(makeRequest(), { params: { id: 'c1' } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.status).toBe('completed');
    expect(body.data.transcriptSegments[0]).toMatchObject({ segmentId: 's1', text: '转写' });
    expect(body.data.textBlocks[0]).toMatchObject({ blockId: 'b1', source: 'ocr' });
    expect(body.data.knowledgePoints[0]).toMatchObject({ pointId: 'p1', title: 'T' });
    expect(body.data.degradation).toBeUndefined();
  });

  it('returns empty products with a degradation hint', async () => {
    mocks.transcriptFindMany.mockResolvedValueOnce([]);
    mocks.textBlockFindMany.mockResolvedValueOnce([]);
    mocks.pointFindMany.mockResolvedValueOnce([]);
    const body = await (await GET(makeRequest(), { params: { id: 'c1' } })).json();
    expect(body.data.knowledgePoints).toEqual([]);
    expect(body.data.degradation).toBeTruthy();
  });

  it('returns 404 when missing', async () => {
    mocks.findUnique.mockResolvedValueOnce(null);
    expect((await GET(makeRequest(), { params: { id: 'c1' } })).status).toBe(404);
  });

  it('returns 403 for a non-owner', async () => {
    mocks.findUnique.mockResolvedValueOnce({ id: 'c1', ownerId: 'other', understandingStatus: 'COMPLETED' });
    expect((await GET(makeRequest(), { params: { id: 'c1' } })).status).toBe(403);
  });
});
