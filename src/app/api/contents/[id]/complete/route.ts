import { randomUUID } from 'node:crypto';

import { ContentStatus, JobType } from '@prisma/client';
import { NextRequest } from 'next/server';
import { z } from 'zod';

import { ErrorCode } from '@/lib/api/errors';
import { fail, HttpStatus, ok } from '@/lib/api/response';
import { ApiError, assertOwnership } from '@/lib/auth/ownership';
import { withAuth } from '@/lib/auth/middleware';
import { contentStatusLabel } from '@/lib/domain/content-status';
import { canTransition } from '@/lib/domain/content-state-machine';
import { registerAllProcessors } from '@/lib/jobs/workers';
import { dispatchPendingJob } from '@/lib/jobs/dispatch';
import { prisma } from '@/lib/prisma';
import { QueueName } from '@/lib/queue';
import { getStorage } from '@/lib/storage';

/**
 * 确认上传完成并触发解析（tasks.md §3.2）
 * ------------------------------------------------------------
 * POST /api/contents/:id/complete
 *   1. 校验内容存在与归属
 *   2. 幂等保护：解析中 / 已就绪 直接拒绝（IMPORT_IN_PROGRESS）
 *   3. 校验上传字节数与申报一致（以对象存储实际大小为准）
 *   4. 事务内驱动状态 待导入/失败 → 解析中，并创建 AsyncJob(CONTENT_PARSE)
 *   5. 入队解析任务（解析完成后再自动入队端云理解流水线，见 §6.2）
 *
 * 异常映射：CONTENT_NOT_FOUND(404) / UPLOAD_SIZE_MISMATCH(409) / IMPORT_IN_PROGRESS(409)
 * 契约见 spec/03-ARCHITECTURE.md §2.2.2。
 */

const schema = z.object({
  size: z.number().int().nonnegative().optional(),
});

export const POST = withAuth<{ params: { id: string } }>(async (request, { user, params }) => {
  const contentId = params.id;

  const content = await prisma.learningContent.findUnique({ where: { id: contentId } });
  if (!content) {
    return fail(ErrorCode.CONTENT_NOT_FOUND, '内容不存在', HttpStatus.NOT_FOUND);
  }
  assertOwnership(content.ownerId, user);

  // 状态机校验：非法迁移（解析中/已就绪等）由服务层统一拒绝
  if (!canTransition(content.status, ContentStatus.PARSING)) {
    return fail(
      ErrorCode.IMPORT_IN_PROGRESS,
      '内容正在导入或已就绪，请勿重复提交',
      HttpStatus.CONFLICT,
      { status: contentStatusLabel(content.status) },
    );
  }

  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  const declaredSize = parsed.success ? parsed.data.size : undefined;

  // 以对象存储实际大小为准，校验与 upload-intent 申报一致
  const storage = getStorage();
  const stored = await storage.statObject(content.storageKey);
  const expected = Number(content.fileSizeBytes);
  if (!stored) {
    return fail(
      ErrorCode.UPLOAD_SIZE_MISMATCH,
      '上传未完成或文件缺失，请重试',
      HttpStatus.CONFLICT,
      { expected },
    );
  }
  if (stored.size !== expected || (declaredSize !== undefined && declaredSize !== expected)) {
    await storage.deleteObject(content.storageKey).catch(() => undefined);
    return fail(
      ErrorCode.UPLOAD_SIZE_MISMATCH,
      '上传字节数与申报不一致，请重新上传',
      HttpStatus.CONFLICT,
      { expected, actual: stored.size, declared: declaredSize },
    );
  }

  const traceId = randomUUID();
  registerAllProcessors();
  const job = await prisma.$transaction(async (tx) => {
    const claimed = await tx.learningContent.updateMany({
      where: { id: contentId, ownerId: user.id, status: { in: [ContentStatus.PENDING, ContentStatus.UPLOADING, ContentStatus.FAILED] } },
      data: { status: ContentStatus.PARSING, failReason: null },
    });
    if (!claimed.count) {
      throw new ApiError(ErrorCode.IMPORT_IN_PROGRESS, '内容正在导入或已就绪，请勿重复提交');
    }
    return tx.asyncJob.create({
      data: {
        jobType: JobType.CONTENT_PARSE,
        contentId,
        traceId,
        state: 'PENDING',
        attempts: 0,
      },
    });
  });

  await dispatchPendingJob(QueueName.CONTENT_PARSE, {
    contentId,
    traceId,
    asyncJobId: job.id,
    stage: 'content-parse',
  });

  return ok(
    { contentId, status: contentStatusLabel(ContentStatus.PARSING) },
    '已开始解析',
  );
});
