import { NextRequest } from 'next/server';
import { z } from 'zod';

import { ErrorCode } from '@/lib/api/errors';
import { getClientIp } from '@/lib/api/rate-limit';
import { fail, HttpStatus, ok } from '@/lib/api/response';
import { withAuth } from '@/lib/auth/middleware';
import { assertOwnership } from '@/lib/auth/ownership';
import { recordAudit } from '@/lib/audit/audit-service';
import { toContentSummaryAsync } from '@/lib/domain/content-mapper';
import { scheduleContentCleanup } from '@/lib/jobs/cleanup';
import { prisma } from '@/lib/prisma';

/**
 * 内容详情 / 编辑（tasks.md §3.2）
 * ------------------------------------------------------------
 * GET   /api/contents/:id —— 返回 ContentSummary
 * PATCH /api/contents/:id —— 编辑标题(1~100)/描述，仅所有者可改
 * 契约见 spec/03-ARCHITECTURE.md §2.2.2。
 */

const patchSchema = z
  .object({
    title: z.string().min(1, '标题不能为空').max(100, '标题最多 100 字').optional(),
    description: z.string().max(2000, '描述最多 2000 字').optional(),
  })
  .refine((v) => v.title !== undefined || v.description !== undefined, {
    message: '至少提供一个待更新字段',
  });

export const GET = withAuth<{ params: { id: string } }>(async (_request, { user, params }) => {
  const content = await prisma.learningContent.findUnique({ where: { id: params.id } });
  if (!content) {
    return fail(ErrorCode.CONTENT_NOT_FOUND, '内容不存在', HttpStatus.NOT_FOUND);
  }
  assertOwnership(content.ownerId, user);
  return ok(await toContentSummaryAsync(content));
});

export const PATCH = withAuth<{ params: { id: string } }>(async (request: NextRequest, { user, params }) => {
  const content = await prisma.learningContent.findUnique({ where: { id: params.id } });
  if (!content) {
    return fail(ErrorCode.CONTENT_NOT_FOUND, '内容不存在', HttpStatus.NOT_FOUND);
  }
  assertOwnership(content.ownerId, user);

  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return fail(
      ErrorCode.VALIDATION_FAILED,
      '参数校验未通过',
      HttpStatus.BAD_REQUEST,
      parsed.error.flatten().fieldErrors,
    );
  }

  const updated = await prisma.learningContent.update({
    where: { id: params.id },
    data: {
      ...(parsed.data.title !== undefined ? { title: parsed.data.title } : {}),
      ...(parsed.data.description !== undefined ? { description: parsed.data.description } : {}),
    },
  });

  return ok(await toContentSummaryAsync(updated), '已保存');
});

export const DELETE = withAuth<{ params: { id: string } }>(async (request: NextRequest, { user, params }) => {
  const content = await prisma.learningContent.findUnique({ where: { id: params.id } });
  if (!content) {
    return fail(ErrorCode.CONTENT_NOT_FOUND, '内容不存在', HttpStatus.NOT_FOUND);
  }
  assertOwnership(content.ownerId, user);

  // 事务内级联删除（笔记/转写/文本块/知识点/闪卡/图谱关联/学习进度/异步任务，
  // 由 schema 的 onDelete: Cascade 保证）并写审计日志，保持原子性
  await prisma.$transaction(async (tx) => {
    await tx.learningContent.delete({ where: { id: params.id } });
    await recordAudit(
      {
        actorId: user.id,
        objectId: params.id,
        action: 'content.delete',
        result: 'success',
        ip: getClientIp(request),
      },
      tx,
    );
  });

  // 异步清理对象存储文件（源文件 + 关键帧 + 封面），不阻塞响应
  void scheduleContentCleanup(params.id);

  return ok({ contentId: params.id, deleted: true }, '已删除');
});
