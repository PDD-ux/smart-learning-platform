import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const queue = vi.hoisted(() => ({ enqueue: vi.fn() }));
vi.mock('@/lib/queue', async () => ({ ...await vi.importActual<typeof import('@/lib/queue')>('@/lib/queue'), enqueue: queue.enqueue }));
vi.mock('@/lib/jobs/workers', () => ({ registerAllProcessors: vi.fn() }));
// No real file upload, worker pipeline or AI calls: only storage metadata is stubbed.
vi.mock('@/lib/storage', () => ({ getStorage: (): object => ({ statObject: async (): Promise<object> => ({ size: 100 }) }) }));

import { prisma } from '@/lib/prisma';
import { signAccessToken } from '@/lib/auth/jwt';
import { POST } from '@/app/api/contents/[id]/complete/route';
import { POST as retryUnderstanding } from '@/app/api/contents/[id]/understanding/retry/route';
import { dispatchPendingJob } from '@/lib/jobs/dispatch';
import { enqueueUnderstanding } from '@/lib/jobs/pipeline/understanding-pipeline';
import { runStage } from '@/lib/jobs/workers/lifecycle';
import { startJob } from '@/lib/jobs/async-job';
import type { JobPayload } from '@/lib/queue';

const ownerId = 'queue-audit-' + randomUUID();
let token = '';
async function content(status: 'PENDING' | 'READY' = 'PENDING'): Promise<string> {
  const row = await prisma.learningContent.create({ data: {
    ownerId, contentType: 'VIDEO', title: '隔离队列验收', fileName: 'not-uploaded.mp4', format: 'MP4', fileSizeBytes: 100n,
    storageKey: `audit-only/${ownerId}/${randomUUID()}.mp4`, status,
  } });
  return row.id;
}
function request(id: string): NextRequest {
  return new NextRequest(`http://localhost:3000/api/contents/${id}/complete`, {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: '{}',
  });
}
async function pending(id: string): Promise<string> {
  return (await prisma.asyncJob.create({ data: { contentId: id, jobType: 'CONTENT_PARSE', traceId: randomUUID() } })).id;
}
function ctx(id: string, attempt = 1): { name: 'CONTENT_PARSE'; contentId: string; traceId: string; attempts: number; maxAttempts: number } {
  return { name: 'CONTENT_PARSE', contentId: id, traceId: 'audit-trace', attempts: attempt, maxAttempts: 2 };
}

beforeAll(async (): Promise<void> => {
  await prisma.user.create({ data: { id: ownerId, email: `${ownerId}@example.invalid`, nickname: '隔离队列验收', passwordHash: 'unusable-test-only' } });
  token = signAccessToken({ sub: ownerId, role: 'student', email: null });
});
beforeEach((): void => { queue.enqueue.mockReset(); queue.enqueue.mockResolvedValue('held-test-queue'); });
afterAll(async (): Promise<void> => {
  await prisma.user.deleteMany({ where: { id: ownerId } });
  expect(await prisma.learningContent.count({ where: { ownerId } })).toBe(0);
  expect(await prisma.user.count({ where: { id: ownerId } })).toBe(0);
  await prisma.$disconnect();
});

describe('real PostgreSQL queue reliability; external queue and file metadata stubbed', (): void => {
  it('returns503 on enqueue failure, retains the source key and permits a successful retry', async (): Promise<void> => {
    const id = await content();
    const original = await prisma.learningContent.findUniqueOrThrow({ where: { id } });
    queue.enqueue.mockRejectedValueOnce(new Error('controlled queue offline'));
    const failed = await POST(request(id), { params: { id } });
    expect(failed.status).toBe(503);
    expect((await failed.json()).error.code).toBe('QUEUE_UNAVAILABLE');
    expect(await prisma.learningContent.findUnique({ where: { id } })).toMatchObject({ status: 'FAILED', storageKey: original.storageKey });
    expect(await prisma.asyncJob.findFirst({ where: { contentId: id } })).toMatchObject({ state: 'FAILED' });
    expect((await POST(request(id), { params: { id } })).status).toBe(200);
    expect(await prisma.asyncJob.count({ where: { contentId: id } })).toBe(2);
    expect(await prisma.learningContent.findUnique({ where: { id } })).toMatchObject({ status: 'PARSING' });
  });
  it('allows only one of two concurrent upload confirmations to create and queue a job', async (): Promise<void> => {
    const id = await content();
    const responses = await Promise.all([POST(request(id), { params: { id } }), POST(request(id), { params: { id } })]);
    expect(responses.map((r): number => r.status).sort()).toEqual([200, 409]);
    expect(await prisma.asyncJob.count({ where: { contentId: id } })).toBe(1);
    expect(queue.enqueue).toHaveBeenCalledTimes(1);
  });
  it('runs only one worker for two concurrent deliveries of the same job', async (): Promise<void> => {
    const id = await content(); const jobId = await pending(id);
    const handler = vi.fn(async (): Promise<void> => { await new Promise((resolve): void => { setTimeout(resolve, 30); }); });
    const payload = { contentId: id, traceId: 'audit-trace', asyncJobId: jobId };
    await Promise.all([runStage(payload, ctx(id), 'parse', handler), runStage(payload, ctx(id), 'parse', handler)]);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(await prisma.asyncJob.findUnique({ where: { id: jobId } })).toMatchObject({ state: 'SUCCEEDED', attempts: 1 });
  });
  it('releases a failed attempt and executes the normal queue retry', async (): Promise<void> => {
    const id = await content(); const jobId = await pending(id);
    const payload = { contentId: id, traceId: 'audit-trace', asyncJobId: jobId };
    await expect(runStage(payload, ctx(id), 'parse', async (): Promise<void> => { throw new Error('retryable'); })).rejects.toThrow('retryable');
    expect(await prisma.asyncJob.findUnique({ where: { id: jobId } })).toMatchObject({ state: 'PENDING', attempts: 1 });
    await runStage(payload, ctx(id, 2), 'parse', async (): Promise<void> => undefined);
    expect(await prisma.asyncJob.findUnique({ where: { id: jobId } })).toMatchObject({ state: 'SUCCEEDED', attempts: 2 });
  });
  it('does not undo a running worker when queue acknowledgement fails after acceptance', async (): Promise<void> => {
    const id = await content();
    queue.enqueue.mockImplementationOnce(async (_name: string, payload: JobPayload): Promise<never> => {
      expect(await startJob(payload.asyncJobId!)).toBe(true);
      throw new Error('lost acknowledgement');
    });
    expect((await POST(request(id), { params: { id } })).status).toBe(200);
    expect(await prisma.learningContent.findUnique({ where: { id } })).toMatchObject({ status: 'PARSING' });
    expect(await prisma.asyncJob.findFirst({ where: { contentId: id } })).toMatchObject({ state: 'RUNNING' });
  });
  it('does not undo completed content when acknowledgement fails after completion', async (): Promise<void> => {
    const id = await content();
    queue.enqueue.mockImplementationOnce(async (_name: string, payload: JobPayload): Promise<never> => {
      await runStage(payload, ctx(id), 'parse', async (): Promise<void> => {
        await prisma.learningContent.update({ where: { id }, data: { status: 'READY' } });
      });
      throw new Error('lost acknowledgement');
    });
    expect((await POST(request(id), { params: { id } })).status).toBe(200);
    expect(await prisma.learningContent.findUnique({ where: { id } })).toMatchObject({ status: 'READY' });
    expect(await prisma.asyncJob.findFirst({ where: { contentId: id } })).toMatchObject({ state: 'SUCCEEDED' });
  });
  it('keeps READY content when understanding enqueue fails and allows the existing retry endpoint', async (): Promise<void> => {
    const id = await content('READY');
    queue.enqueue.mockRejectedValueOnce(new Error('controlled queue offline'));
    await expect(enqueueUnderstanding(id)).rejects.toMatchObject({ code: 'QUEUE_UNAVAILABLE' });
    expect(await prisma.learningContent.findUnique({ where: { id } })).toMatchObject({ status: 'READY', understandingStatus: 'FAILED' });
    expect((await retryUnderstanding(request(id), { params: { id } })).status).toBe(200);
    expect(await prisma.asyncJob.count({ where: { contentId: id, jobType: 'UNDERSTANDING' } })).toBe(2);
  });
  it('does not roll back newer content state after a late older dispatch failure', async (): Promise<void> => {
    const id = await content();
    await prisma.learningContent.update({ where: { id }, data: { status: 'PARSING' } });
    const old = await prisma.asyncJob.create({ data: { contentId: id, jobType: 'CONTENT_PARSE', traceId: 'old', createdAt: new Date(0) } });
    const newer = await pending(id);
    queue.enqueue.mockRejectedValueOnce(new Error('late failure'));
    await expect(dispatchPendingJob('CONTENT_PARSE', { contentId: id, traceId: 'old', asyncJobId: old.id })).rejects.toMatchObject({ code: 'QUEUE_UNAVAILABLE' });
    expect(await prisma.learningContent.findUnique({ where: { id } })).toMatchObject({ status: 'PARSING' });
    expect(await prisma.asyncJob.findUnique({ where: { id: newer } })).toMatchObject({ state: 'PENDING' });
  });
});
