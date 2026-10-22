import type { Prisma } from '@prisma/client';
import { z } from 'zod';

import { taskLogger } from '@/lib/jobs/task-logger';
import { prisma } from '@/lib/prisma';
import { getRedis } from '@/lib/redis';

/**
 * 学习进度记忆（tasks.md §4.3）
 * ------------------------------------------------------------
 * PUT /api/contents/:id/progress（幂等）：写 Redis（TTL 短期缓存）+ 异步刷 PostgreSQL；
 * GET /api/contents/:id/progress：优先读 Redis，未命中回源 PostgreSQL。
 *
 * 降级：Redis 不可用时直接同步落库，保证进度不丢（spec/03-ARCHITECTURE.md §3.4）。
 * 契约见 spec/03-ARCHITECTURE.md §2.2.2。
 */

export const progressRefSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('video'), positionSec: z.number().min(0) }),
  z.object({
    type: z.literal('document'),
    page: z.number().int().min(1),
    scrollRatio: z.number().min(0).max(1),
  }),
]);

export const progressRequestSchema = z.discriminatedUnion('contentType', [
  z.object({ contentType: z.literal('video'), positionSec: z.number().min(0) }),
  z.object({
    contentType: z.literal('document'),
    page: z.number().int().min(1),
    scrollRatio: z.number().min(0).max(1),
  }),
]);

export type ProgressRef = z.infer<typeof progressRefSchema>;
export type ProgressRequest = z.infer<typeof progressRequestSchema>;

export type ProgressSnapshot = {
  ref: ProgressRef;
  lastStudiedAt: string;
};

const PROGRESS_TTL_SEC = 300;
const REDIS_TIMEOUT_MS = 500;

function cacheKey(learnerId: string, contentId: string): string {
  return `progress:${learnerId}:${contentId}`;
}

/** Redis 操作超时保护：无 Redis 时快速失败并降级到 PostgreSQL */
async function redisWithTimeout<T>(op: Promise<T>, ms = REDIS_TIMEOUT_MS): Promise<T> {
  return Promise.race([
    op,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('redis timeout')), ms)),
  ]);
}

export function requestToRef(request: ProgressRequest): ProgressRef {
  return request.contentType === 'video'
    ? { type: 'video', positionSec: request.positionSec }
    : { type: 'document', page: request.page, scrollRatio: request.scrollRatio };
}

export function refToResult(
  ref: ProgressRef,
  lastStudiedAt: string | null,
): {
  contentType: 'video' | 'document';
  positionSec?: number;
  page?: number;
  scrollRatio?: number;
  lastStudiedAt: string | null;
} {
  return ref.type === 'video'
    ? { contentType: 'video', positionSec: ref.positionSec, lastStudiedAt }
    : { contentType: 'document', page: ref.page, scrollRatio: ref.scrollRatio, lastStudiedAt };
}

/** 校验进度定位是否在内容范围内（视频在时长内、文档在页数内） */
export function isProgressInRange(
  ref: ProgressRef,
  bounds: { durationSec?: number | null; pageCount?: number | null },
): boolean {
  if (ref.type === 'video') {
    return bounds.durationSec != null && ref.positionSec <= bounds.durationSec;
  }
  return bounds.pageCount != null && ref.page >= 1 && ref.page <= bounds.pageCount;
}

async function flushToDb(
  learnerId: string,
  contentId: string,
  ref: ProgressRef,
  lastStudiedAt: Date,
): Promise<void> {
  await prisma.learningProgress.upsert({
    where: { learnerId_contentId: { learnerId, contentId } },
    update: { ref: ref as Prisma.InputJsonValue, lastStudiedAt },
    create: {
      learnerId,
      contentId,
      ref: ref as Prisma.InputJsonValue,
      lastStudiedAt,
    },
  });
}

/** 保存进度（幂等）：写缓存并刷库；缓存不可用时同步落库 */
export async function saveProgress(
  learnerId: string,
  contentId: string,
  ref: ProgressRef,
): Promise<ProgressSnapshot> {
  const lastStudiedAt = new Date();
  const snapshot: ProgressSnapshot = { ref, lastStudiedAt: lastStudiedAt.toISOString() };

  let cached = false;
  try {
    await redisWithTimeout(
      getRedis().set(cacheKey(learnerId, contentId), JSON.stringify(snapshot), 'EX', PROGRESS_TTL_SEC),
    );
    cached = true;
  } catch {
    cached = false;
  }

  if (cached) {
    // 异步刷库，不阻塞响应
    void flushToDb(learnerId, contentId, ref, lastStudiedAt).catch((err: unknown) => {
      taskLogger.error('progress: db flush failed', {
        learnerId,
        contentId,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  } else {
    await flushToDb(learnerId, contentId, ref, lastStudiedAt);
  }

  return snapshot;
}

/** 读取进度：Redis 优先，未命中回源 PostgreSQL */
export async function loadProgress(
  learnerId: string,
  contentId: string,
): Promise<ProgressSnapshot | null> {
  try {
    const raw = await redisWithTimeout(getRedis().get(cacheKey(learnerId, contentId)));
    if (raw) {
      const parsed = JSON.parse(raw) as { ref: unknown; lastStudiedAt: string };
      return { ref: progressRefSchema.parse(parsed.ref), lastStudiedAt: parsed.lastStudiedAt };
    }
  } catch {
    // 回源数据库
  }

  const row = await prisma.learningProgress.findUnique({
    where: { learnerId_contentId: { learnerId, contentId } },
  });
  if (!row) return null;
  return {
    ref: progressRefSchema.parse(row.ref),
    lastStudiedAt: row.lastStudiedAt.toISOString(),
  };
}
