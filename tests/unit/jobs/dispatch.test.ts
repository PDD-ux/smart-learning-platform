import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ enqueue: vi.fn(), lock: vi.fn(), latest: vi.fn(), cancel: vi.fn(), update: vi.fn(), warn: vi.fn() }));
vi.mock('@/lib/queue', () => ({ enqueue: mocks.enqueue, QueueName: { CONTENT_PARSE: 'CONTENT_PARSE', UNDERSTANDING: 'UNDERSTANDING' } }));
vi.mock('@/lib/prisma', () => ({ prisma: { $transaction: (fn: (tx: unknown) => Promise<unknown>): Promise<unknown> => fn({
  $queryRaw: mocks.lock, asyncJob: { findFirst: mocks.latest, updateMany: mocks.cancel }, learningContent: { updateMany: mocks.update },
}) } }));
vi.mock('@/lib/jobs/task-logger', () => ({ taskLogger: { warn: mocks.warn } }));
import { dispatchPendingJob, QueueDispatchError } from '@/lib/jobs/dispatch';

const payload = { contentId: 'c1', traceId: 't1', asyncJobId: 'j1' };
describe('queue delivery compensation', (): void => {
  beforeEach((): void => {
    vi.resetAllMocks();
    mocks.enqueue.mockRejectedValue(new Error('private redis credentials must not be exposed'));
    mocks.latest.mockResolvedValue({ id: 'j1' });
    mocks.cancel.mockResolvedValue({ count: 1 });
  });
  it('marks an unclaimed parse failed while keeping its source and returning a safe 503', async (): Promise<void> => {
    await expect(dispatchPendingJob('CONTENT_PARSE', payload)).rejects.toMatchObject({ code: 'QUEUE_UNAVAILABLE', status: 503 });
    expect(mocks.update).toHaveBeenCalledWith({ where: { id: 'c1', status: 'PARSING' }, data: { status: 'FAILED', failReason: expect.any(String) } });
    expect(JSON.stringify(mocks.warn.mock.calls)).not.toContain('credentials');
  });
  it('only fails understanding, without changing READY content or notes', async (): Promise<void> => {
    await expect(dispatchPendingJob('UNDERSTANDING', payload)).rejects.toBeInstanceOf(QueueDispatchError);
    expect(mocks.update).toHaveBeenCalledWith({ where: { id: 'c1', understandingStatus: 'RUNNING' }, data: { understandingStatus: 'FAILED' } });
  });
  it('does not roll back a claimed or completed job when queue acknowledgement is lost', async (): Promise<void> => {
    mocks.cancel.mockResolvedValue({ count: 0 });
    await expect(dispatchPendingJob('CONTENT_PARSE', payload)).resolves.toBeUndefined();
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it('does not overwrite a newer job status when an older enqueue fails late', async (): Promise<void> => {
    mocks.latest.mockResolvedValue({ id: 'new-job' });
    await expect(dispatchPendingJob('CONTENT_PARSE', payload)).rejects.toBeInstanceOf(QueueDispatchError);
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it('does not claim compensation succeeded when the database cannot persist it', async (): Promise<void> => {
    mocks.lock.mockRejectedValue(new Error('database offline'));
    await expect(dispatchPendingJob('CONTENT_PARSE', payload)).rejects.toThrow('database offline');
    expect(mocks.cancel).not.toHaveBeenCalled();
  });
  it('does not touch the database on normal enqueue', async (): Promise<void> => {
    mocks.enqueue.mockResolvedValue('queue-1');
    await dispatchPendingJob('CONTENT_PARSE', payload);
    expect(mocks.lock).not.toHaveBeenCalled();
  });
});
