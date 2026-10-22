import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// 无 Redis 环境下验证进程内驱动；同时避免真实 ioredis 连接
vi.mock('@/lib/redis', () => ({
  getRedis: () => {
    throw new Error('redis unavailable (test)');
  },
}));

import {
  QueueName,
  enqueue,
  registerProcessor,
  drainQueue,
  getQueueDriver,
  __resetQueueForTest,
} from '@/lib/queue';

/**
 * 队列脚手架 单测（tasks.md §2.2）
 * ------------------------------------------------------------
 * 覆盖：驱动选择、处理器消费、失败重试、重试耗尽、无处理器兜底。
 */

describe('queue (memory driver)', () => {
  beforeEach(() => {
    __resetQueueForTest();
    vi.stubEnv('QUEUE_DRIVER', 'memory');
    vi.stubEnv('QUEUE_CONCURRENCY', '2');
    vi.stubEnv('QUEUE_RETRY_MAX', '2');
    vi.stubEnv('QUEUE_RETRY_BACKOFF_MS', '0');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('selects memory driver by default outside production', () => {
    expect(getQueueDriver()).toBe('memory');
  });

  it('runs a registered processor with JobContext', async () => {
    const seen: Array<{ contentId: string; traceId: string; attempts: number }> = [];
    registerProcessor(QueueName.CONTENT_PARSE, async (payload, ctx) => {
      seen.push({ contentId: payload.contentId, traceId: ctx.traceId, attempts: ctx.attempts });
    });

    await enqueue(QueueName.CONTENT_PARSE, { contentId: 'c1', traceId: 't1' });
    await drainQueue();

    expect(seen).toEqual([{ contentId: 'c1', traceId: 't1', attempts: 1 }]);
  });

  it('retries a failing job and succeeds on a later attempt', async () => {
    let lastAttempt = 0;
    registerProcessor(QueueName.UNDERSTANDING, async (_payload, ctx) => {
      lastAttempt = ctx.attempts;
      if (ctx.attempts < 2) throw new Error('transient');
    });

    await enqueue(QueueName.UNDERSTANDING, { contentId: 'c2', traceId: 't2' });
    await drainQueue();

    expect(lastAttempt).toBe(2);
  });

  it('stops after max attempts (retries=2 → 3 attempts)', async () => {
    let calls = 0;
    registerProcessor(QueueName.PRODUCT_GEN, async () => {
      calls += 1;
      throw new Error('always fails');
    });

    await enqueue(QueueName.PRODUCT_GEN, { contentId: 'c3', traceId: 't3' });
    await drainQueue();

    expect(calls).toBe(3);
  });

  it('does not throw when no processor is registered', async () => {
    await enqueue(QueueName.CONTENT_PARSE, { contentId: 'c4', traceId: 't4' });
    await expect(drainQueue()).resolves.toBeUndefined();
  });

  it('processes multiple jobs concurrently up to concurrency', async () => {
    let active = 0;
    let peak = 0;
    registerProcessor(QueueName.CONTENT_PARSE, async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
    });

    await enqueue(QueueName.CONTENT_PARSE, { contentId: 'c5', traceId: 't5' });
    await enqueue(QueueName.CONTENT_PARSE, { contentId: 'c6', traceId: 't6' });
    await enqueue(QueueName.CONTENT_PARSE, { contentId: 'c7', traceId: 't7' });
    await drainQueue();

    expect(peak).toBe(2);
  });
});
