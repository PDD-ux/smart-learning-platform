import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { JobContext, JobPayload } from '@/lib/queue';

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(), startJob: vi.fn(), retryJob: vi.fn(), updateJobStage: vi.fn(), succeedJob: vi.fn(), failJob: vi.fn(),
  info: vi.fn(), error: vi.fn(), counter: vi.fn(),
}));
vi.mock('@/lib/prisma', () => ({ prisma: { asyncJob: { findUnique: mocks.findUnique } } }));
vi.mock('@/lib/jobs/async-job', () => ({ startJob: mocks.startJob, retryJob: mocks.retryJob, updateJobStage: mocks.updateJobStage, succeedJob: mocks.succeedJob, failJob: mocks.failJob }));
vi.mock('@/lib/jobs/task-logger', () => ({ taskLogger: { info: mocks.info, error: mocks.error } }));
vi.mock('@/lib/observability/metrics', () => ({ recordCounter: mocks.counter }));

import { runStage } from '@/lib/jobs/workers/lifecycle';

const payload: JobPayload = { contentId: 'c1', traceId: 't1', asyncJobId: 'j1' };
const context: JobContext = { name: 'UNDERSTANDING', contentId: 'c1', traceId: 't1', attempts: 1, maxAttempts: 1 };

describe('worker failure stage diagnostics', () => {
  beforeEach((): void => { vi.resetAllMocks(); mocks.startJob.mockResolvedValue(true); });

  it.each(['deep-extract', 'product-gen'])('reports the persisted failure phase %s, preserving the original error', async (stage): Promise<void> => {
    mocks.findUnique.mockResolvedValueOnce({ stage });
    const error = new Error('controlled failure');
    await expect(runStage(payload, context, 'light-filter', async (): Promise<void> => { throw error; })).rejects.toBe(error);
    expect(mocks.error).toHaveBeenCalledWith('job stage failed', expect.objectContaining({ stage, exhausted: true, error: 'controlled failure' }));
    expect(mocks.counter).toHaveBeenCalledWith('slp_pipeline_stages_total', { queue: 'UNDERSTANDING', stage, outcome: 'failure' });
    expect(mocks.failJob).toHaveBeenCalledWith('j1', 'controlled failure', expect.any(Number));
    expect(mocks.findUnique).toHaveBeenLastCalledWith({ where: { id: 'j1' }, select: { stage: true } });
  });

  it.each([null, { stage: null }, { stage: 'unbounded arbitrary label' }])('falls back when a persisted stage is unusable: %j', async (row): Promise<void> => {
    mocks.findUnique.mockResolvedValueOnce(row);
    await expect(runStage(payload, context, 'light-filter', async (): Promise<void> => { throw new Error('failure'); })).rejects.toThrow('failure');
    expect(mocks.error).toHaveBeenCalledWith('job stage failed', expect.objectContaining({ stage: 'light-filter' }));
  });

  it('falls back on database failure without exhausting an eligible retry', async (): Promise<void> => {
    mocks.findUnique.mockRejectedValueOnce(new Error('database offline'));
    await expect(runStage(payload, { ...context, maxAttempts: 3 }, 'light-filter', async (): Promise<void> => { throw new Error('original failure'); })).rejects.toThrow('original failure');
    expect(mocks.failJob).not.toHaveBeenCalled();
    expect(mocks.retryJob).toHaveBeenCalledWith('j1', 'original failure');
    expect(mocks.error).toHaveBeenCalledWith('job stage failed', expect.objectContaining({ stage: 'light-filter', exhausted: false }));
  });

  it('does not add stage lookup for content parsing', async (): Promise<void> => {
    await expect(runStage(payload, { ...context, name: 'CONTENT_PARSE' }, 'parse', async (): Promise<void> => { throw new Error('parse failure'); })).rejects.toThrow('parse failure');
    expect(mocks.findUnique).not.toHaveBeenCalled();
    expect(mocks.error).toHaveBeenCalledWith('job stage failed', expect.objectContaining({ stage: 'parse' }));
  });

  it('does not add lookup without a job ID', async (): Promise<void> => {
    await expect(runStage({ ...payload, asyncJobId: undefined }, context, 'light-filter', async (): Promise<void> => { throw new Error('failure'); })).rejects.toThrow();
    expect(mocks.findUnique).not.toHaveBeenCalled();
  });

  it('preserves successful and terminal duplicate handling', async (): Promise<void> => {
    const handler = vi.fn(async (): Promise<void> => undefined);
    await runStage(payload, context, 'light-filter', handler);
    expect(mocks.findUnique).not.toHaveBeenCalled();
    expect(mocks.succeedJob).toHaveBeenCalledTimes(1);
    mocks.startJob.mockResolvedValueOnce(false);
    await runStage(payload, context, 'light-filter', handler);
    expect(handler).toHaveBeenCalledTimes(1);
  });
  it('does not execute when the atomic claim is rejected or the database is unavailable', async (): Promise<void> => {
    const handler = vi.fn(async (): Promise<void> => undefined);
    mocks.startJob.mockResolvedValueOnce(false);
    await runStage(payload, context, 'parse', handler);
    expect(handler).not.toHaveBeenCalled();
    mocks.startJob.mockRejectedValueOnce(new Error('claim unavailable'));
    await expect(runStage(payload, context, 'parse', handler)).rejects.toThrow('claim unavailable');
    expect(handler).not.toHaveBeenCalled();
  });
  it('releases a claimed job for retry if stage persistence fails before business execution', async (): Promise<void> => {
    mocks.updateJobStage.mockRejectedValueOnce(new Error('stage offline'));
    const handler = vi.fn(async (): Promise<void> => undefined);
    await expect(runStage(payload, { ...context, maxAttempts: 2 }, 'parse', handler)).rejects.toThrow('stage offline');
    expect(handler).not.toHaveBeenCalled();
    expect(mocks.retryJob).toHaveBeenCalledWith('j1', 'stage offline');
  });
});
