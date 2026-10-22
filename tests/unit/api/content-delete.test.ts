import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  deleteContent: vi.fn(),
  auditCreate: vi.fn(),
  scheduleCleanup: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    learningContent: { findUnique: mocks.findUnique },
    $transaction: (fn: (tx: unknown) => unknown) =>
      fn({
        learningContent: { delete: mocks.deleteContent },
        auditLog: { create: mocks.auditCreate },
      }),
  },
}));

vi.mock('@/lib/jobs/cleanup', () => ({
  scheduleContentCleanup: mocks.scheduleCleanup,
}));

import { signAccessToken } from '@/lib/auth/jwt';
import { DELETE } from '@/app/api/contents/[id]/route';

/**
 * DELETE /api/contents/:id 单测（tasks.md §3.2）
 */

const token = signAccessToken({ sub: 'u1', email: 'a@b.com', role: 'student' });

function makeRequest(withAuth = true): NextRequest {
  const headers = new Headers();
  if (withAuth) headers.set('authorization', `Bearer ${token}`);
  return new NextRequest('http://localhost/api/contents/c1', { method: 'DELETE', headers });
}

describe('DELETE /api/contents/:id', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findUnique.mockResolvedValue({ id: 'c1', ownerId: 'u1' });
    mocks.deleteContent.mockResolvedValue({});
    mocks.auditCreate.mockResolvedValue({});
  });

  it('rejects unauthenticated requests with 401', async () => {
    const res = await DELETE(makeRequest(false), { params: { id: 'c1' } });
    expect(res.status).toBe(401);
  });

  it('returns 404 when the content does not exist', async () => {
    mocks.findUnique.mockResolvedValueOnce(null);
    const res = await DELETE(makeRequest(), { params: { id: 'c1' } });
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe('CONTENT_NOT_FOUND');
  });

  it('returns 403 for a non-owner', async () => {
    mocks.findUnique.mockResolvedValueOnce({ id: 'c1', ownerId: 'other' });
    const res = await DELETE(makeRequest(), { params: { id: 'c1' } });
    expect(res.status).toBe(403);
    expect(mocks.deleteContent).not.toHaveBeenCalled();
  });

  it('cascades deletion, writes an audit log and schedules storage cleanup', async () => {
    const res = await DELETE(makeRequest(), { params: { id: 'c1' } });
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ contentId: 'c1', deleted: true });

    expect(mocks.deleteContent).toHaveBeenCalledWith({ where: { id: 'c1' } });
    expect(mocks.auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          actorId: 'u1',
          objectId: 'c1',
          action: 'content.delete',
          result: 'success',
        }),
      }),
    );
    expect(mocks.scheduleCleanup).toHaveBeenCalledWith('c1');
  });
});
