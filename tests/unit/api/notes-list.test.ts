import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ count: vi.fn(), findMany: vi.fn(), findFirst: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ prisma: { note: { count: m.count, findMany: m.findMany }, learningContent: { findFirst: m.findFirst } } }));
import { signAccessToken } from '@/lib/auth/jwt';
import { GET } from '@/app/api/notes/route';
function req(query = '', role: 'student' | 'admin' = 'student', auth = true): NextRequest {
  return new NextRequest('http://localhost/api/notes' + query, { headers: auth ? { authorization: `Bearer ${signAccessToken({ sub: 'u1', email: 'a@b.com', role })}` } : {} });
}
beforeEach((): void => { vi.clearAllMocks(); m.count.mockResolvedValue(1); m.findFirst.mockResolvedValue({ id: 'c1' }); m.findMany.mockResolvedValue([{ id: 'n1', ownerId: 'u1', contentId: 'c1', content: '链式法则', ref: { type: 'document', page: 7 }, version: 3, createdAt: new Date('2026-10-01'), updatedAt: new Date('2026-10-02'), lesson: { title: '讲义' } }]); });
describe('personal note list', (): void => {
  it('allows no keyword and preserves source, version and dates', async (): Promise<void> => {
    const r = await GET(req()); expect(r.status).toBe(200);
    expect((await r.json()).data).toMatchObject({ page: 1, pageSize: 20, total: 1, items: [{ version: 3, contentTitle: '讲义', ref: { type: 'document', page: 7 }, updatedAt: '2026-10-02T00:00:00.000Z' }] });
    expect(m.count).toHaveBeenCalledWith({ where: { ownerId: 'u1', lesson: { ownerId: 'u1' } } });
  });
  it('filters and pages only within owned notes and materials', async (): Promise<void> => {
    await GET(req('?q=%20链式%20&contentId=c1&page=2&pageSize=5'));
    expect(m.findFirst).toHaveBeenCalledWith({ where: { id: 'c1', ownerId: 'u1' }, select: { id: true } });
    expect(m.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { ownerId: 'u1', lesson: { ownerId: 'u1' }, contentId: 'c1', content: { contains: '链式', mode: 'insensitive' } }, skip: 5, take: 5, orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }] }));
  });
  it('keeps admins within their own note list', async (): Promise<void> => { await GET(req('', 'admin')); expect(m.count).toHaveBeenCalledWith({ where: { ownerId: 'u1', lesson: { ownerId: 'u1' } } }); });
  it('does not query notes for an unavailable or foreign resource', async (): Promise<void> => { m.findFirst.mockResolvedValue(null); const r = await GET(req('?contentId=foreign')); expect(r.status).toBe(404); expect(m.findMany).not.toHaveBeenCalled(); });
  it.each(['?page=0', '?page=100001', '?pageSize=51', '?contentId=', '?q=' + 'x'.repeat(201), '?q=a&q=b'])('rejects invalid parameters %s', async (query): Promise<void> => { expect((await GET(req(query))).status).toBe(400); expect(m.count).not.toHaveBeenCalled(); });
  it('requires authentication', async (): Promise<void> => { expect((await GET(req('', 'student', false))).status).toBe(401); expect(m.count).not.toHaveBeenCalled(); });
});
