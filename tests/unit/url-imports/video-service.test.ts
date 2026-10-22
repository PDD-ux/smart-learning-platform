import { beforeEach, expect, it, vi } from 'vitest';
import type { UrlDraftView } from '@/lib/url-imports/contracts';

type Row = Record<string, unknown>;
const mocks = vi.hoisted(() => {
  const drafts = new Map<string, Row>(), contents = new Map<string, Row>(), jobs = new Map<string, Row>(), objects = new Set<string>();
  const match = (row: Row, where: Row): boolean => Object.entries(where).every(([key, value]): boolean => row[key] === value);
  const updates = (table: Map<string, Row>, where: Row, data: Row): { count: number } => { let count = 0; for (const row of table.values()) if (match(row, where)) { Object.assign(row, data); count++; } return { count }; };
  const tx = {
    $queryRawUnsafe: vi.fn(async (_sql: string, id: string): Promise<Row[]> => [{ id }]),
    urlImportDraft: {
      findUnique: vi.fn(async ({ where }: { where: { id?: string; ownerId_requestId?: { ownerId: string; requestId: string } } }): Promise<Row | null> => [...drafts.values()].find((row): boolean => where.id ? row.id === where.id : row.ownerId === where.ownerId_requestId?.ownerId && row.requestId === where.ownerId_requestId?.requestId) ?? null),
      findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: string } }): Promise<Row> => { const row = drafts.get(where.id); if (!row) throw Error('missing'); return row; }),
      count: vi.fn(async (): Promise<number> => 0),
      create: vi.fn(async ({ data }: { data: Row }): Promise<Row> => { const id = 'draft-' + (drafts.size + 1), row = { id, state: 'FETCHING', errorCode: null, contentId: null, snapshot: null, ...data }; drafts.set(id, row); return row; }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Row }): Promise<Row> => { const row = drafts.get(where.id)!; Object.assign(row, data); return row; }),
      updateMany: vi.fn(async ({ where, data }: { where: Row; data: Row }): Promise<{ count: number }> => updates(drafts, where, data)),
    },
    learningContent: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }): Promise<Row | null> => contents.get(where.id) ?? null),
      create: vi.fn(async ({ data }: { data: Row }): Promise<Row> => { contents.set(String(data.id), { ...data }); return data; }),
      updateMany: vi.fn(async ({ where, data }: { where: Row; data: Row }): Promise<{ count: number }> => updates(contents, where, data)),
    },
    asyncJob: {
      create: vi.fn(async ({ data }: { data: Row }): Promise<Row> => { const row = { id: 'job-' + (jobs.size + 1), ...data }; jobs.set(String(row.id), row); return row; }),
      updateMany: vi.fn(async ({ where, data }: { where: Row; data: Row }): Promise<{ count: number }> => updates(jobs, where, data)),
    },
  };
  let tail: Promise<unknown> = Promise.resolve();
  async function transaction<T>(fn: (value: typeof tx) => Promise<T>): Promise<T> {
    const result = tail.then(async (): Promise<T> => {
      const backup = [drafts, contents, jobs].map((table): Map<string, Row> => new Map([...table].map(([id, row]): [string, Row] => [id, { ...row }])));
      try { return await fn(tx); } catch (error) { [drafts, contents, jobs].forEach((table, index): void => { table.clear(); for (const [id, row] of backup[index]) table.set(id, row); }); throw error; }
    }); tail = result.catch((): void => undefined); return result;
  }
  return { tx, drafts, contents, jobs, objects, prisma: { ...tx, $transaction: transaction }, download: vi.fn(), enqueue: vi.fn(), account: vi.fn(), rate: vi.fn(), remove: vi.fn(async (key: string): Promise<void> => { objects.delete(key); }) };
});
vi.mock('@/lib/prisma', () => ({ prisma: mocks.prisma }));
vi.mock('@/lib/courses/service', () => ({ courseAccount: mocks.account }));
vi.mock('@/lib/api/rate-limit', () => ({ rateLimit: mocks.rate }));
vi.mock('@/lib/storage', () => ({ getStorage: () => ({ deleteObject: mocks.remove }) }));
vi.mock('@/lib/queue', () => ({ QueueName: { CONTENT_PARSE: 'CONTENT_PARSE' }, enqueue: mocks.enqueue }));
vi.mock('@/lib/jobs/workers', () => ({ registerAllProcessors: vi.fn() }));
vi.mock('@/lib/video-imports/source', () => ({ downloadVideoSnapshot: mocks.download }));
vi.mock('@/lib/url-imports/service', () => ({ smallBody: async (request: Request): Promise<unknown> => request.json(), expireUrlDrafts: vi.fn(), readUrlDraft: async (user: { id: string }, id: string): Promise<UrlDraftView> => {
  const row = [...mocks.drafts.values()].find((value): boolean => value.ownerId === user.id && value.requestId === id)!;
  return { requestId: id, state: row.state as UrlDraftView['state'], error: row.errorCode as string | null, contentId: row.contentId as string | null, expiresAt: '', preview: null, existing: [] };
} }));
import { importVideoUrl } from '@/lib/video-imports/service';
const user = { id: 'student-one', email: null, role: 'student' as const }, id = '31d8819c-e754-43d2-b399-7d6193f81810';
const request = (body: object = {}, signal?: AbortSignal): Request => new Request('http://localhost/api/video-imports', { method: 'POST', body: JSON.stringify({ requestId: id, url: 'https://example.org/video.mp4', confirmed: true, ...body }), signal });
const snapshot = (draftId: string): object => ({ format: 'MP4', fileSize: 200, durationSec: 32, storageKey: `contents/url-${draftId}/source.mp4`, source: { version: 1, title: '课堂', requestedUrl: 'https://example.org/video.mp4', finalUrl: 'https://cdn.example.org/video.mp4', contentDigest: 'a'.repeat(64), sourceDigest: 'a'.repeat(64), author: null } });
beforeEach((): void => {
  vi.clearAllMocks(); mocks.drafts.clear(); mocks.contents.clear(); mocks.jobs.clear(); mocks.objects.clear();
  mocks.account.mockResolvedValue(undefined); mocks.rate.mockResolvedValue({ allowed: true }); mocks.enqueue.mockResolvedValue('queued'); mocks.tx.urlImportDraft.count.mockResolvedValue(0);
  mocks.tx.learningContent.create.mockImplementation(async ({ data }: { data: Row }): Promise<Row> => { mocks.contents.set(String(data.id), { ...data }); return data; });
  mocks.download.mockImplementation(async (_url: string, draftId: string): Promise<object> => { mocks.objects.add(`contents/url-${draftId}/source.mp4`); return snapshot(draftId); });
});
it('commits a source and a single parse job before dispatch, and retains the formal object', async (): Promise<void> => {
  const value = await importVideoUrl(request(), user); expect(value.state).toBe('COMMITTED'); expect(mocks.download).toHaveBeenCalledTimes(1); expect(mocks.enqueue).toHaveBeenCalledTimes(1);
  expect([...mocks.contents.values()][0]).toMatchObject({ contentType: 'VIDEO', status: 'PARSING', format: 'MP4', fileSizeBytes: 200n, durationSec: 32 });
  expect(mocks.jobs.size).toBe(1); expect(mocks.objects.size).toBe(1); expect(mocks.drafts.get('draft-1')?.snapshot).toBeNull();
});
it('replays the same request without downloading, writing or queuing twice', async (): Promise<void> => { const first = await importVideoUrl(request(), user); const second = await importVideoUrl(request(), user); expect(second.contentId).toBe(first.contentId); expect(mocks.enqueue).toHaveBeenCalledTimes(1); expect(mocks.download).toHaveBeenCalledTimes(1); });
it('serializes simultaneous replays and creates one content', async (): Promise<void> => { await Promise.all([importVideoUrl(request(), user), importVideoUrl(request(), user)]); expect(mocks.download).toHaveBeenCalledTimes(1); expect(mocks.contents.size).toBe(1); expect(mocks.jobs.size).toBe(1); });
it('rejects a changed URL for the same opaque request', async (): Promise<void> => { await importVideoUrl(request(), user); await expect(importVideoUrl(request({ url: 'https://example.org/other.mp4' }), user)).rejects.toMatchObject({ code: 'NOTE_CONFLICT' }); expect(mocks.download).toHaveBeenCalledTimes(1); });
it.each([{ confirmed: false }, { ownerId: 'other' }, { requestId: 'not-a-uuid' }])('requires explicit authorization and strict input', async (body): Promise<void> => { await expect(importVideoUrl(request(body), user)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' }); expect(mocks.download).not.toHaveBeenCalled(); });
it('rejects account access before any download', async (): Promise<void> => { mocks.account.mockRejectedValue(new Error('account rejected')); await expect(importVideoUrl(request(), user)).rejects.toThrow('account rejected'); expect(mocks.download).not.toHaveBeenCalled(); });
it('does not accept a late download after cancellation', async (): Promise<void> => { mocks.download.mockImplementation(async (_url: string, draftId: string): Promise<object> => { mocks.drafts.get(draftId)!.state = 'CANCELLED'; mocks.objects.add(`contents/url-${draftId}/source.mp4`); return snapshot(draftId); }); const result = await importVideoUrl(request(), user); expect(result.state).toBe('CANCELLED'); expect(mocks.objects.size).toBe(0); expect(mocks.contents.size).toBe(0); expect(mocks.enqueue).not.toHaveBeenCalled(); });
it('removes partial objects on failure without creating content', async (): Promise<void> => { mocks.download.mockImplementation(async (_url: string, draftId: string): Promise<never> => { mocks.objects.add(`contents/url-${draftId}/source.mp4`); throw Error('partial write'); }); const result = await importVideoUrl(request(), user); expect(result.state).toBe('FAILED'); expect(mocks.objects.size).toBe(0); expect(mocks.jobs.size).toBe(0); });
it('rolls back a failed database commit and cleans the staged source', async (): Promise<void> => { mocks.tx.learningContent.create.mockRejectedValue(new Error('database failure')); expect((await importVideoUrl(request(), user)).state).toBe('FAILED'); expect(mocks.objects.size).toBe(0); expect(mocks.jobs.size).toBe(0); });
it('keeps the formal source and a retryable failure when the queue rejects', async (): Promise<void> => { mocks.enqueue.mockRejectedValue(new Error('queue unavailable')); const result = await importVideoUrl(request(), user); expect(result.state).toBe('COMMITTED'); expect(result.error).toBe('VIDEO_QUEUE_FAILED'); expect([...mocks.contents.values()][0].status).toBe('FAILED'); expect([...mocks.jobs.values()][0].state).toBe('FAILED'); expect(mocks.objects.size).toBe(1); });
it('bounds active drafts and per-minute import requests', async (): Promise<void> => { mocks.tx.urlImportDraft.count.mockResolvedValueOnce(3); await expect(importVideoUrl(request(), user)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' }); mocks.rate.mockResolvedValue({ allowed: false }); await expect(importVideoUrl(request(), user)).rejects.toMatchObject({ code: 'RATE_LIMITED' }); expect(mocks.download).not.toHaveBeenCalled(); });
