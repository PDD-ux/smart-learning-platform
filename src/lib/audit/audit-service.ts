import type { Prisma } from '@prisma/client';

import { prisma } from '@/lib/prisma';

/**
 * 审计日志服务（tasks.md §3.2 / §2.3）
 * ------------------------------------------------------------
 * 记录关键操作（内容删除、笔记导出等）：操作者、对象 ID、动作、结果、来源 IP。
 * 可传入事务客户端（`Prisma.TransactionClient`）以与业务操作保持原子性。
 *
 * 说明：§2.3 的完整 AuditService（查询/导出/埋点覆盖）仍待补，
 * 此处先提供写入能力，满足内容删除等关键操作的埋点要求。
 */

export type AuditResult = 'success' | 'failure';

export type AuditInput = {
  actorId: string;
  objectId: string;
  /** 动作标识，如 content.delete / note.export */
  action: string;
  result?: AuditResult;
  ip?: string | null;
  detail?: string | null;
};

export async function recordAudit(
  input: AuditInput,
  db: Prisma.TransactionClient = prisma,
): Promise<void> {
  await db.auditLog.create({
    data: {
      actorId: input.actorId,
      objectId: input.objectId,
      action: input.action,
      result: input.result ?? 'success',
      ip: input.ip ?? null,
      detail: input.detail ?? null,
    },
  });
}
