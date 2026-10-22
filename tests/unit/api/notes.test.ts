import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  contentFindUnique: vi.fn(),
  noteFindMany: vi.fn(),
  noteFindUnique: vi.fn(),
  noteCreate: vi.fn(),
  noteUpdate: vi.fn(),
  noteDelete: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    learningContent: { findUnique: mocks.contentFindUnique },
    note: {
      findMany: mocks.noteFindMany,
      findUnique: mocks.noteFindUnique,
      create: mocks.noteCreate,
      update: mocks.noteUpdate,
      delete: mocks.noteDelete,
    },
  },
}));

import { signAccessToken } from '@/lib/auth/jwt';
import { GET as listNotes, POST as createNote } from '@/app/api/contents/[id]/notes/route';
import { DELETE, PATCH } from '@/app/api/notes/[id]/route';

/**
 * 实时笔记接口 单测（tasks.md §4.2）
 */

const token = signAccessToken({ sub: 'u1', email: 'a@b.com', role: 'student' });

function req(url: string, init: RequestInit = {}, withAuth = true): NextRequest {
  const headers = new Headers(init.headers);
  if (withAuth) headers.set('authorization', `Bearer ${token}`);
  return new NextRequest(url, { method: init.method, body: init.body ?? undefined, headers });
}

function jsonInit(body: unknown, method = 'POST'): RequestInit {
  return { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
}

function makeContent(overrides: Record<string, unknown> = {}) {
  return {
    id: 'c1',
    ownerId: 'u1',
    contentType: 'VIDEO',
    status: 'READY',
    durationSec: 120,
    pageCount: null,
    ...overrides,
  };
}

function makeNote(overrides: Record<string, unknown> = {}) {
  return {
    id: 'n1',
    ownerId: 'u1',
    contentId: 'c1',
    content: 'hello',
    ref: { type: 'video', timestampSec: 10 },
    version: 1,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('GET /api/contents/:id/notes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.contentFindUnique.mockResolvedValue(makeContent());
  });

  it('returns notes sorted by ref', async () => {
    mocks.noteFindMany.mockResolvedValue([
      makeNote({ id: 'n30', ref: { type: 'video', timestampSec: 30 } }),
      makeNote({ id: 'n10', ref: { type: 'video', timestampSec: 10 } }),
    ]);
    const res = await listNotes(req('http://localhost/api/contents/c1/notes'), { params: { id: 'c1' } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.items.map((n: { noteId: string }) => n.noteId)).toEqual(['n10', 'n30']);
  });

  it('returns 404 when the content is missing', async () => {
    mocks.contentFindUnique.mockResolvedValueOnce(null);
    const res = await listNotes(req('http://localhost/api/contents/c1/notes'), { params: { id: 'c1' } });
    expect(res.status).toBe(404);
  });
});

describe('POST /api/contents/:id/notes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.contentFindUnique.mockResolvedValue(makeContent());
    mocks.noteCreate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) =>
      makeNote({ content: data.content, ref: data.ref }),
    );
  });

  it('creates a note for ready content', async () => {
    const res = await createNote(
      req('http://localhost/api/contents/c1/notes', jsonInit({ content: '要点', ref: { type: 'video', timestampSec: 15 } })),
      { params: { id: 'c1' } },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toMatchObject({ noteId: 'n1', content: '要点', version: 1 });
    expect(mocks.noteCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ ownerId: 'u1', contentId: 'c1', version: 1 }) }),
    );
  });

  it('rejects notes on non-ready content with 409', async () => {
    mocks.contentFindUnique.mockResolvedValueOnce(makeContent({ status: 'PARSING' }));
    const res = await createNote(
      req('http://localhost/api/contents/c1/notes', jsonInit({ content: 'x', ref: { type: 'video', timestampSec: 1 } })),
      { params: { id: 'c1' } },
    );
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('CONTENT_NOT_READY');
  });

  it('rejects whitespace-only content with NOTE_EMPTY', async () => {
    const res = await createNote(
      req('http://localhost/api/contents/c1/notes', jsonInit({ content: '   ', ref: { type: 'video', timestampSec: 1 } })),
      { params: { id: 'c1' } },
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('NOTE_EMPTY');
  });

  it('rejects a ref outside the content duration', async () => {
    const res = await createNote(
      req('http://localhost/api/contents/c1/notes', jsonInit({ content: 'x', ref: { type: 'video', timestampSec: 999 } })),
      { params: { id: 'c1' } },
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('REF_OUT_OF_RANGE');
  });

  it('rejects a ref type that does not match the content', async () => {
    const res = await createNote(
      req('http://localhost/api/contents/c1/notes', jsonInit({ content: 'x', ref: { type: 'document', page: 1 } })),
      { params: { id: 'c1' } },
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('REF_OUT_OF_RANGE');
  });
});

describe('PATCH /api/notes/:id', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.noteFindUnique.mockResolvedValue(makeNote());
    mocks.contentFindUnique.mockResolvedValue(makeContent());
  });

  it('returns isOverwritten=true when expectedVersion is stale', async () => {
    mocks.noteUpdate.mockResolvedValue(makeNote({ content: 'new', version: 2 }));
    const res = await PATCH(
      req('http://localhost/api/notes/n1', jsonInit({ content: 'new', expectedVersion: 2 }, 'PATCH')),
      { params: { id: 'n1' } },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.isOverwritten).toBe(true);
    expect(mocks.noteUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ content: 'new', version: 2 }) }),
    );
  });

  it('returns isOverwritten=false when expectedVersion matches', async () => {
    mocks.noteUpdate.mockResolvedValue(makeNote({ content: 'new', version: 2 }));
    const res = await PATCH(
      req('http://localhost/api/notes/n1', jsonInit({ content: 'new', expectedVersion: 1 }, 'PATCH')),
      { params: { id: 'n1' } },
    );
    expect((await res.json()).data.isOverwritten).toBe(false);
  });

  it('returns 404 when the note is missing', async () => {
    mocks.noteFindUnique.mockResolvedValueOnce(null);
    const res = await PATCH(
      req('http://localhost/api/notes/n1', jsonInit({ content: 'x', expectedVersion: 1 }, 'PATCH')),
      { params: { id: 'n1' } },
    );
    expect(res.status).toBe(404);
  });

  it('returns 403 for a non-owner', async () => {
    mocks.noteFindUnique.mockResolvedValueOnce(makeNote({ ownerId: 'other' }));
    const res = await PATCH(
      req('http://localhost/api/notes/n1', jsonInit({ content: 'x', expectedVersion: 1 }, 'PATCH')),
      { params: { id: 'n1' } },
    );
    expect(res.status).toBe(403);
  });
});

describe('DELETE /api/notes/:id', () => {
  beforeEach(() => vi.clearAllMocks());

  it('deletes an owned note', async () => {
    mocks.noteFindUnique.mockResolvedValue(makeNote());
    mocks.noteDelete.mockResolvedValue({});
    const res = await DELETE(req('http://localhost/api/notes/n1', { method: 'DELETE' }), { params: { id: 'n1' } });
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ noteId: 'n1', deleted: true });
    expect(mocks.noteDelete).toHaveBeenCalledWith({ where: { id: 'n1' } });
  });

  it('returns 403 for a non-owner', async () => {
    mocks.noteFindUnique.mockResolvedValue(makeNote({ ownerId: 'other' }));
    const res = await DELETE(req('http://localhost/api/notes/n1', { method: 'DELETE' }), { params: { id: 'n1' } });
    expect(res.status).toBe(403);
    expect(mocks.noteDelete).not.toHaveBeenCalled();
  });
});
