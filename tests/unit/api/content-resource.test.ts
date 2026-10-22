import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  createReadUrl: vi.fn(),
  driver: 'local',
}));

vi.mock('@/lib/prisma', () => ({
  prisma: { learningContent: { findUnique: mocks.findUnique } },
}));

vi.mock('@/lib/storage', async () => {
  const actual = await vi.importActual<typeof import('@/lib/storage')>('@/lib/storage');
  return { ...actual, getStorage: () => ({ driver: mocks.driver, createReadUrl: mocks.createReadUrl }) };
});

import { signAccessToken } from '@/lib/auth/jwt';
import { GET } from '@/app/api/contents/[id]/resource/route';

/**
 * GET /api/contents/:id/resource 单测（tasks.md §4.1）
 */

const token = signAccessToken({ sub: 'u1', email: 'a@b.com', role: 'student' });

function makeRequest(withAuth = true): NextRequest {
  const headers = new Headers();
  if (withAuth) headers.set('authorization', `Bearer ${token}`);
  return new NextRequest('http://localhost/api/contents/c1/resource', { headers });
}

function makeContent(overrides: Record<string, unknown> = {}) {
  return {
    id: 'c1',
    ownerId: 'u1',
    contentType: 'VIDEO',
    status: 'READY',
    storageKey: 'contents/c1/lesson.mp4',
    durationSec: 120,
    pageCount: null,
    format: 'MP4',
    ...overrides,
  };
}

describe('GET /api/contents/:id/resource', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.driver = 'local';
    mocks.findUnique.mockResolvedValue(makeContent());
    mocks.createReadUrl.mockResolvedValue({
      url: 'http://localhost:3000/api/storage/object?key=contents%2Fc1%2Flesson.mp4&sig=x',
      method: 'GET',
      expiresInSec: 3600,
      headers: {},
    });
  });

  it('rejects unauthenticated requests with 401', async () => {
    const res = await GET(makeRequest(false), { params: Promise.resolve({ id: 'c1' }) });
    expect(res.status).toBe(401);
  });

  it('returns 404 when the content does not exist', async () => {
    mocks.findUnique.mockResolvedValueOnce(null);
    const res = await GET(makeRequest(), { params: Promise.resolve({ id: 'c1' }) });
    expect(res.status).toBe(404);
  });

  it('returns 403 for a non-owner', async () => {
    mocks.findUnique.mockResolvedValueOnce(makeContent({ ownerId: 'other' }));
    const res = await GET(makeRequest(), { params: Promise.resolve({ id: 'c1' }) });
    expect(res.status).toBe(403);
  });

  it('returns 409 CONTENT_NOT_READY when the content is not ready', async () => {
    mocks.findUnique.mockResolvedValueOnce(makeContent({ status: 'PARSING' }));
    const res = await GET(makeRequest(), { params: Promise.resolve({ id: 'c1' }) });
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('CONTENT_NOT_READY');
    expect(mocks.createReadUrl).not.toHaveBeenCalled();
  });

  it('returns a presigned read url for ready content', async () => {
    const res = await GET(makeRequest(), { params: Promise.resolve({ id: 'c1' }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toMatchObject({
      contentId: 'c1',
      contentType: 'video',
      durationSec: 120,
      expiresInSec: 3600,
    });
    expect(body.data.url).toContain('/api/storage/object');
    expect(mocks.createReadUrl).toHaveBeenCalledWith('contents/c1/lesson.mp4');
  });

  it('keeps local resources on the current browser origin', async () => {
    const res = await GET(makeRequest(), { params: Promise.resolve({ id: 'c1' }) });
    expect((await res.json()).data.url).toBe('/api/storage/object?key=contents%2Fc1%2Flesson.mp4&sig=x');
  });

  it('does not rewrite an external object storage signature', async () => {
    mocks.driver = 's3';
    const url = 'https://bucket.example.invalid/lesson.pdf?signature=unchanged';
    mocks.createReadUrl.mockResolvedValueOnce({ url, expiresInSec: 3600 });
    const res = await GET(makeRequest(), { params: Promise.resolve({ id: 'c1' }) });
    expect((await res.json()).data.url).toBe(url);
  });
  it('only returns public paste attribution and marks responses private',async():Promise<void>=>{mocks.findUnique.mockResolvedValueOnce(makeContent({bookState:{pastedSource:{version:1,kind:'PASTE',label:'本人整理',author:null,importedAt:'2026-10-19',bodyDigest:'a'.repeat(64),requestId:'internal-request',inputDigest:'private-hash'}}}));const res=await GET(makeRequest(),{params:Promise.resolve({id:'c1'})});expect(res.headers.get('cache-control')).toBe('private, no-store');const body=await res.json();expect(body.data.pasteSource.label).toBe('本人整理');expect(body.data.pasteSource).not.toHaveProperty('requestId');expect(body.data.pasteSource).not.toHaveProperty('inputDigest');});

});
