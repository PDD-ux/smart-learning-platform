import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { ContentStatus } from '@prisma/client';
import { NextRequest } from 'next/server';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

type StoredRow = Record<string, unknown>;

const db = vi.hoisted(() => {
  const contents = new Map<string, StoredRow>();
  const jobs: StoredRow[] = [];
  const audits: StoredRow[] = [];
  let contentSequence = 0;
  let jobSequence = 0;

  const updateContent = async ({
    where,
    data,
  }: {
    where: { id: string };
    data: StoredRow;
  }): Promise<StoredRow> => {
    const existing = contents.get(where.id);
    if (!existing) throw new Error(`content missing: ${where.id}`);
    const updated = { ...existing, ...data };
    contents.set(where.id, updated);
    return updated;
  };

  const tx = {
    learningContent: {
      create: async ({ data }: { data: StoredRow }): Promise<StoredRow> => {
        const id = `content_${++contentSequence}`;
        const row = { id, ...data };
        contents.set(id, row);
        return row;
      },
      update: updateContent,
      updateMany: async ({ where, data }: { where: { id: string; status?: { in: string[] } }; data: StoredRow }): Promise<{ count: number }> => {
        const row = contents.get(where.id);
        if (!row || (where.status && !where.status.in.includes(String(row.status)))) return { count: 0 };
        await updateContent({ where, data });
        return { count: 1 };
      },
      delete: async ({ where }: { where: { id: string } }): Promise<StoredRow> => {
        const existing = contents.get(where.id);
        if (!existing) throw new Error(`content missing: ${where.id}`);
        contents.delete(where.id);
        return existing;
      },
    },
    asyncJob: {
      create: async ({ data }: { data: StoredRow }): Promise<StoredRow> => {
        const row = { id: `job_${++jobSequence}`, ...data };
        jobs.push(row);
        return row;
      },
    },
    auditLog: {
      create: async ({ data }: { data: StoredRow }): Promise<StoredRow> => {
        audits.push(data);
        return data;
      },
    },
  };

  return {
    contents,
    jobs,
    audits,
    reset(): void {
      contents.clear();
      jobs.length = 0;
      audits.length = 0;
      contentSequence = 0;
      jobSequence = 0;
    },
    prisma: {
      learningContent: {
        findUnique: async ({ where }: { where: { id: string } }): Promise<StoredRow | null> =>
          contents.get(where.id) ?? null,
        findFirst: async ({ where }: { where: { storageKey: string } }): Promise<StoredRow | null> => {
          for (const content of contents.values()) {
            if (content.storageKey === where.storageKey) return content;
          }
          return null;
        },
        update: updateContent,
        delete: tx.learningContent.delete,
      },
      asyncJob: {
        create: tx.asyncJob.create,
        updateMany: async ({ where, data }: { where: { id: string; state: string }; data: StoredRow }): Promise<{ count: number }> => {
          const row = jobs.find((job) => job.id === where.id && job.state === where.state);
          if (!row) return { count: 0 };
          for (const [key, value] of Object.entries(data)) {
            row[key] = key === 'attempts' ? Number(row[key] ?? 0) + Number((value as { increment: number }).increment) : value;
          }
          return { count: 1 };
        },
        update: async ({ where, data }: { where: { id: string }; data: StoredRow }): Promise<StoredRow> => {
          const job = jobs.find((item) => item.id === where.id);
          if (!job) throw new Error(`job missing: ${where.id}`);
          Object.assign(job, data);
          return job;
        },
      },
      $transaction: async (callback: (client: typeof tx) => Promise<unknown>): Promise<unknown> => callback(tx),
    },
  };
});

const queue = vi.hoisted(() => ({
  enqueue: vi.fn(async () => 'queue_1'),
  registerAllProcessors: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ prisma: db.prisma }));

vi.mock('@/lib/queue', () => ({
  QueueName: {
    CONTENT_PARSE: 'CONTENT_PARSE',
    UNDERSTANDING: 'UNDERSTANDING',
    PRODUCT_GEN: 'PRODUCT_GEN',
  },
  enqueue: queue.enqueue,
}));

vi.mock('@/lib/jobs/workers', () => ({ registerAllProcessors: queue.registerAllProcessors }));

vi.mock('@/lib/api/rate-limit', () => ({
  rateLimit: vi.fn(async () => ({ allowed: true, remaining: 59, retryAfter: 0 })),
  RateLimitPolicy: { default: { limit: 60, windowMs: 60_000 } },
  getClientIp: () => 'integration-test',
}));

vi.mock('@/lib/media/ffmpeg', () => ({
  isFfprobeAvailable: vi.fn(async () => false),
  probeVideo: vi.fn(),
  extractCover: vi.fn(),
}));

import { DELETE as deleteContent } from '@/app/api/contents/[id]/route';
import { POST as completeUpload } from '@/app/api/contents/[id]/complete/route';
import { POST as createUploadIntent } from '@/app/api/contents/upload-intent/route';
import { contentParseProcessor } from '@/lib/jobs/workers/content-parse.worker';
import { buildCoverKey, buildFrameKey, __resetStorageForTest, getStorage } from '@/lib/storage';
import { signAccessToken } from '@/lib/auth/jwt';

const token = signAccessToken({ sub: 'learner_1', email: 'learner@example.com', role: 'student' });
const fileBytes = new TextEncoder().encode('lesson-data');
let uploadRoot = '';

function authenticatedJsonRequest(url: string, body: unknown): NextRequest {
  return new NextRequest(url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

async function waitForObjectDeletion(keys: string[]): Promise<void> {
  const storage = getStorage();
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const objects = await Promise.all(keys.map((key) => storage.statObject(key)));
    if (objects.every((object) => object === null)) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(`objects were not deleted: ${keys.join(', ')}`);
}

describe('content import flow integration', () => {
  beforeEach(async () => {
    db.reset();
    queue.enqueue.mockClear();
    queue.registerAllProcessors.mockClear();
    if (uploadRoot) await rm(uploadRoot, { recursive: true, force: true });
    uploadRoot = await mkdtemp(path.join(tmpdir(), 'slp-import-flow-'));
    vi.stubEnv('STORAGE_DRIVER', 'local');
    vi.stubEnv('UPLOAD_DIR', uploadRoot);
    vi.stubEnv('APP_URL', 'http://localhost:3000');
    vi.stubEnv('STORAGE_SIGN_SECRET', 'integration-storage-secret-with-at-least-32-characters');
    __resetStorageForTest();
  });

  afterAll(async () => {
    if (uploadRoot) await rm(uploadRoot, { recursive: true, force: true });
    __resetStorageForTest();
  });

  it('runs upload intent → signed upload → complete → parse ready → cascade cleanup', async () => {
    const intent = await createUploadIntent(
      authenticatedJsonRequest('http://localhost/api/contents/upload-intent', {
        contentType: 'video',
        fileName: 'lesson.mp4',
        fileSize: fileBytes.byteLength,
        mimeType: 'video/mp4',
      }),
      undefined as never,
    );
    expect(intent.status).toBe(200);
    const intentBody = await intent.json();
    const { contentId, uploadUrl } = intentBody.data as { contentId: string; uploadUrl: string };

    const uploadRequest = new NextRequest(new URL(uploadUrl, 'http://localhost:3000'), {
      method: 'PUT',
      headers: { 'content-type': 'video/mp4' },
      body: fileBytes,
    });
    const { PUT: receiveUpload } = await import('@/app/api/storage/upload/route');
    const stored = await receiveUpload(uploadRequest);
    expect(stored.status).toBe(200);

    const completed = await completeUpload(
      authenticatedJsonRequest(`http://localhost/api/contents/${contentId}/complete`, { size: fileBytes.byteLength }),
      { params: { id: contentId } },
    );
    expect(completed.status).toBe(200);
    expect(db.contents.get(contentId)?.status).toBe(ContentStatus.PARSING);
    expect(queue.enqueue).toHaveBeenCalledWith('CONTENT_PARSE', expect.objectContaining({ contentId }));

    const parseJob = db.jobs[0];
    await contentParseProcessor(
      { contentId, traceId: String(parseJob.traceId), asyncJobId: String(parseJob.id) },
      { name: 'CONTENT_PARSE', attempts: 1, maxAttempts: 1, traceId: String(parseJob.traceId), contentId },
    );
    expect(db.contents.get(contentId)).toMatchObject({
      status: ContentStatus.READY,
      understandingStatus: 'RUNNING',
    });
    expect(queue.enqueue).toHaveBeenCalledWith('UNDERSTANDING', expect.objectContaining({ contentId }));

    const storage = getStorage();
    const storageKey = String(db.contents.get(contentId)?.storageKey);
    const frameKey = buildFrameKey(contentId, 1);
    const coverKey = buildCoverKey(contentId);
    await storage.putObject(frameKey, Buffer.from('frame'));
    await storage.putObject(coverKey, Buffer.from('cover'));
    const deletePrefix = vi.spyOn(storage, 'deletePrefix');

    const deleted = await deleteContent(
      new NextRequest(`http://localhost/api/contents/${contentId}`, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${token}` },
      }),
      { params: { id: contentId } },
    );
    expect(deleted.status).toBe(200);
    expect(db.contents.has(contentId)).toBe(false);
    expect(db.audits).toHaveLength(1);
    await waitForObjectDeletion([storageKey, frameKey, coverKey]);
    expect(deletePrefix).toHaveBeenCalledWith(`contents/${contentId}/`);
    expect(deletePrefix).toHaveBeenCalledWith(`frames/${contentId}/`);
    expect(deletePrefix).toHaveBeenCalledWith(`covers/${contentId}/`);
  });
});
