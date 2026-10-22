import { ContentStatus } from '@prisma/client';

import { ErrorCode } from '@/lib/api/errors';
import { ApiError } from '@/lib/auth/ownership';

/**
 * 内容导入状态机（tasks.md §3.2）
 * ------------------------------------------------------------
 * 单一事实来源：非法状态迁移由服务层统一拒绝，避免各接口散落判断。
 * 迁移图见 spec/03-ARCHITECTURE.md §2.1.3 ①。
 */

const ALLOWED_TRANSITIONS: Record<ContentStatus, readonly ContentStatus[]> = {
  [ContentStatus.PENDING]: [
    ContentStatus.UPLOADING,
    ContentStatus.PARSING,
    ContentStatus.FAILED,
  ],
  [ContentStatus.UPLOADING]: [
    ContentStatus.PARSING,
    ContentStatus.FAILED,
    ContentStatus.PENDING, // 上传失败 → 待导入（重试）
  ],
  [ContentStatus.PARSING]: [ContentStatus.READY, ContentStatus.FAILED],
  [ContentStatus.READY]: [],
  [ContentStatus.FAILED]: [
    ContentStatus.PENDING, // 重新导入
    ContentStatus.PARSING, // 保留源文件时重试解析
  ],
};

export function canTransition(from: ContentStatus, to: ContentStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function isTerminal(status: ContentStatus): boolean {
  return status === ContentStatus.READY;
}

/**
 * 校验状态迁移，非法时抛 ApiError(IMPORT_IN_PROGRESS, 409)。
 * 供写接口在事务前置校验，由 withAuth 统一转为 fail() 响应。
 */
export function assertContentTransition(from: ContentStatus, to: ContentStatus): void {
  if (!canTransition(from, to)) {
    throw new ApiError(ErrorCode.IMPORT_IN_PROGRESS, '内容状态不允许该操作', { from, to });
  }
}
