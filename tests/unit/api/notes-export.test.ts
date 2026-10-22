import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  contentFindUnique: vi.fn(),
  noteFindMany: vi.fn(),
  putObject: vi.fn(),
  createReadUrl: vi.fn(),
  deleteObject: vi.fn(),
  recordAudit: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: { learningContent: { findUnique: mocks.contentFindUnique }, note: { findMany: mocks.noteFindMany } },
}));

vi.mock('@/lib/storage', async () => {
  const actual = await vi.importActual<typeof import('@/lib/storage')>('@/lib/storage');
  return {
    ...actual,
    getStorage: () => ({ putObject: mocks.putObject, createReadUrl: mocks.createReadUrl, deleteObject: mocks.deleteObject }),
  };
});

vi.mock('@/lib/audit/audit-service', () => ({ recordAudit: mocks.recordAudit }));

import { signAccessToken } from '@/lib/auth/jwt';
import { POST } from '@/app/api/contents/[id]/notes/export/route';

const token = signAccessToken({ sub: 'u1', email: 'a@b.com', role: 'student' });

function request(body: unknown, authenticated = true): NextRequest {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (authenticated) headers.set('authorization', `Bearer ${token}`);
  return new NextRequest('http://localhost/api/contents/c1/notes/export', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

const videoNote = {
  id: 'n1', ownerId: 'u1', contentId: 'c1', content: '核心结论',
  ref: { type: 'video', timestampSec: 65 }, version: 1,
  createdAt: new Date('2026-10-01T08:00:00.000Z'), updatedAt: new Date('2026-10-01T08:00:00.000Z'),
};

describe('POST /api/contents/:id/notes/export', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.contentFindUnique.mockResolvedValue({ id: 'c1', ownerId: 'u1', title: '测试课程' });
    mocks.noteFindMany.mockResolvedValue([videoNote]);
    mocks.putObject.mockResolvedValue(undefined);
    mocks.createReadUrl.mockResolvedValue({ url: 'https://storage.test/signed', method: 'GET', expiresInSec: 900, headers: {} });
    mocks.deleteObject.mockResolvedValue(undefined);
    mocks.recordAudit.mockResolvedValue(undefined);
  });

  it('exports sorted markdown notes with time anchors, presigns the file and records metadata only', async () => {
    const response = await POST(request({ format: 'markdown' }), { params: { id: 'c1' } });

    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual({
      downloadUrl: 'https://storage.test/signed', expiresInSec: 900, fileName: 'learning-notes.md',
    });
    const [key, body, options] = mocks.putObject.mock.calls[0] as [string, Buffer, { contentType: string }];
    expect(key).toMatch(/^contents\/c1\/exports\/.+\.md$/);
    expect(body.toString('utf8')).toContain('# 测试课程\n\n## 00:01:05\n\n核心结论');
    expect(options.contentType).toBe('text/markdown; charset=utf-8');
    expect(mocks.createReadUrl).toHaveBeenCalledWith(key, { expiresInSec: 900, downloadFileName: 'learning-notes.md' });
    expect(mocks.recordAudit).toHaveBeenCalledWith(expect.objectContaining({
      actorId: 'u1', objectId: 'c1', action: 'note.export', result: 'success',
      detail: JSON.stringify({ format: 'markdown', noteCount: 1 }),
    }));
    expect(mocks.recordAudit.mock.calls[0]?.[0].detail).not.toContain('核心结论');
  });

  it('exports document page references as plain text', async () => {
    mocks.noteFindMany.mockResolvedValueOnce([{
      ...videoNote,
      ref: { type: 'document', page: 4, blockIndex: 2 },
      content: '定义与性质',
    }]);

    const response = await POST(request({ format: 'txt' }), { params: { id: 'c1' } });
    const [, body, options] = mocks.putObject.mock.calls[0] as [string, Buffer, { contentType: string }];
    expect(response.status).toBe(200);
    expect(body.toString('utf8')).toContain('[第 4 页 · 段落 3]\n定义与性质');
    expect(options.contentType).toBe('text/plain; charset=utf-8');
  });

  it('rejects unauthenticated requests and resources not owned by the learner', async () => {
    const unauthenticated = await POST(request({ format: 'txt' }, false), { params: { id: 'c1' } });
    expect(unauthenticated.status).toBe(401);

    mocks.contentFindUnique.mockResolvedValueOnce({ id: 'c1', ownerId: 'other', title: 'other' });
    const forbidden = await POST(request({ format: 'txt' }), { params: { id: 'c1' } });
    expect(forbidden.status).toBe(403);
    expect(mocks.putObject).not.toHaveBeenCalled();
  });

  it('rejects unsupported formats and removes a partial object when export fails', async () => {
    const invalid = await POST(request({ format: 'pdf' }), { params: { id: 'c1' } });
    expect(invalid.status).toBe(400);

    mocks.createReadUrl.mockRejectedValueOnce(new Error('presign failed'));
    const failed = await POST(request({ format: 'txt' }), { params: { id: 'c1' } });
    expect(failed.status).toBe(500);
    expect((await failed.json()).error.code).toBe('EXPORT_FAILED');
    expect(mocks.deleteObject).toHaveBeenCalledWith(expect.stringMatching(/^contents\/c1\/exports\/.+\.txt$/));
  });
});
