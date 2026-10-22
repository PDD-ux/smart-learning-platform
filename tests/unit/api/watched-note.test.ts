import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ content: vi.fn(), sources: vi.fn(), extract: vi.fn(), limit: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ prisma: { learningContent: { findUnique: mocks.content }, transcriptSegment: { findMany: mocks.sources } } }));
vi.mock('@/lib/ai/spark', async (original) => ({ ...await original<typeof import('@/lib/ai/spark')>(), extractJson: mocks.extract }));
vi.mock('@/lib/api/rate-limit', () => ({ rateLimit: mocks.limit }));
import { signAccessToken } from '@/lib/auth/jwt';
import { POST } from '@/app/api/contents/[id]/ai/watched-note/route';
import { AiError } from '@/lib/ai/spark';
const token = signAccessToken({ sub: 'u1', email: 'u1@example.test', role: 'student' });
function request(body: unknown = { segmentIds: ['s1'], throughSec: 10 }, auth = true): NextRequest { return new NextRequest('http://localhost/api/contents/c1/ai/watched-note', { method: 'POST', headers: { 'content-type': 'application/json', ...(auth ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) }); }
const source = { id: 's1', startMs: 0, endMs: 10000, text: '数据库实际转写原文' };
describe('watched-note API', (): void => {
  beforeEach((): void => { vi.resetAllMocks(); mocks.content.mockResolvedValue({ ownerId: 'u1', contentType: 'VIDEO', status: 'READY', durationSec: 60 }); mocks.sources.mockResolvedValue([source]); mocks.limit.mockResolvedValue({ allowed: true }); mocks.extract.mockResolvedValue({ data: { points: [{ sourceNumbers: [0] }] } }); });
  it('rejects anonymous and foreign owners before model call', async (): Promise<void> => {
    expect((await POST(request(undefined, false), { params: { id: 'c1' } })).status).toBe(401);
    mocks.content.mockResolvedValue({ ownerId: 'other' }); expect((await POST(request(), { params: { id: 'c1' } })).status).toBe(403); expect(mocks.extract).not.toHaveBeenCalled();
  });
  it('rejects unfinished sources and missing IDs before model call', async (): Promise<void> => {
    expect((await POST(request({ segmentIds: ['s1'], throughSec: 9 }), { params: { id: 'c1' } })).status).toBe(400);
    mocks.sources.mockResolvedValue([]); expect((await POST(request(), { params: { id: 'c1' } })).status).toBe(400); expect(mocks.extract).not.toHaveBeenCalled();
  });
  it('rejects duplicate IDs and beyond-video positions', async (): Promise<void> => {
    expect((await POST(request({ segmentIds: ['s1', 's1'], throughSec: 10 }), { params: { id: 'c1' } })).status).toBe(400);
    expect((await POST(request({ segmentIds: ['s1'], throughSec: 90 }), { params: { id: 'c1' } })).status).toBe(400); expect(mocks.extract).not.toHaveBeenCalled();
  });
  it('returns canonical source text and safe model failure without persistence', async (): Promise<void> => {
    const response = await POST(request(), { params: { id: 'c1' } }); expect(response.status).toBe(200);
    const body = await response.json() as { data: { markdown: string; sources: Array<{ text: string; segmentId: string }> } }; expect(body.data.sources).toEqual([{ segmentId: 's1', startMs: 0, endMs: 10000, text: source.text }]); expect(body.data.markdown).toContain('0:00');
    mocks.extract.mockRejectedValue(new Error('sensitive upstream text')); const failure = await POST(request(), { params: { id: 'c1' } }); expect(failure.status).toBe(503); expect(await failure.text()).not.toContain('sensitive upstream text');
  });
  it('returns throttling without another model call', async (): Promise<void> => {
    mocks.limit.mockResolvedValue({ allowed: false, retryAfter: 30 }); const response = await POST(request(), { params: { id: 'c1' } }); expect(response.status).toBe(429); expect(response.headers.get('retry-after')).toBe('30'); expect(mocks.extract).not.toHaveBeenCalled();
  });
  it('hides model schema internals behind a fixed Chinese retry message', async (): Promise<void> => {
    mocks.extract.mockRejectedValue(new AiError('points.1.keyword: String must contain at most 30 character(s)', 'SCHEMA_INVALID', 502));
    const response = await POST(request(), { params: { id: 'c1' } });
    expect(response.status).toBe(503);
    const text = await response.text(); expect(text).toContain('随看要点未通过原文摘录校验'); expect(text).not.toContain('points.1'); expect(text).not.toContain('String must');
  });
  it('rejects model paraphrase changing cannot store to no need to store', async (): Promise<void> => {
    mocks.sources.mockResolvedValue([{ ...source, text: '储能系统可以突破即发即用不能存储的瓶颈。' }]);
    mocks.extract.mockResolvedValue({ data: { points: [{ title: '储能系统', summary: '储能系统无需存储。', sourceNumbers: [0] }] } });
    expect((await POST(request(), { params: { id: 'c1' } })).status).toBe(503);
  });
  it('returns extract mode with exact original negation and nearby context', async (): Promise<void> => {
    mocks.sources.mockResolvedValue([{ ...source, text: '储能系统可以突破即发即用不能存储的瓶颈。' }]);
    mocks.extract.mockResolvedValue({ data: { points: [{ sourceNumbers: [0] }] } });
    const response = await POST(request(), { params: { id: 'c1' } }); expect(response.status).toBe(200);
    const body = await response.json() as { data: { mode: string; markdown: string } };
    expect(body.data.mode).toBe('source-extract'); expect(body.data.markdown).toContain('不能存储'); expect(body.data.markdown).not.toContain('无需存储');
  });
});
