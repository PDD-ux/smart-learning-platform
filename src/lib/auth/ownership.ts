import { ErrorCode } from '@/lib/api/errors';
import { ErrorHttpStatus } from '@/lib/api/errors';

/**
 * 资源归属校验器（tasks.md §1.4）
 * ------------------------------------------------------------
 * 用途：在私人资源的读写接口顶部调用，
 *      校验「当前请求用户」是否为「资源的 owner」，防止越权访问。
 *
 * 设计：
 *   - 不匹配抛 ApiError，由 withAuth（或外层 catch）统一转换为 fail() 响应
 *   - 不静默失败：避免「前端误以为操作成功，实际未生效」的隐藏 bug
 *   - 所有角色均须匹配 owner；管理权限由专用管理接口单独校验
 *
 * 用法：
 *   // Note 接口
 *   export const DELETE = withAuth(async (req, { user, params }) => {
 *     const note = await prisma.note.findUnique({ where: { id: params.id } });
 *     assertOwnership(note.ownerId, user);
 *     await prisma.note.delete({ where: { id: params.id } });
 *     return ok({ deleted: true });
 *   });
 */

export class ApiError extends Error {
  /** 业务错误码（与 ErrorCode 枚举一致） */
  public readonly code: string;
  /** HTTP 状态码（由 ErrorHttpStatus 自动推导） */
  public readonly status: number;
  /** 附加上下文（用于前端调试） */
  public readonly details?: unknown;

  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = ErrorHttpStatus[code as keyof typeof ErrorHttpStatus] ?? 500;
    this.details = details;
  }
}

/**
 * 当前请求用户（与 middleware.ts 的 AuthUser 一致；这里重新定义避免循环依赖）
 */
export type OwnerUser = {
  id: string;
  email?: string | null;
  role?: string;
};

/**
 * 校验资源归属：owner === user 不通过则抛 ApiError(FORBIDDEN)
 *
 * @param resourceOwnerId 资源所有者的 userId（从数据库查出来）
 * @param user 当前请求用户（来自 withAuth 注入的 context.user）
 * @throws ApiError('FORBIDDEN', '无权访问该资源') 当资源不归属当前用户
 */
export function assertOwnership(resourceOwnerId: string, user: OwnerUser): void {
  // 资源没有 owner 或 user 没有 id —— 视为系统错误（不暴露给前端）
  if (!resourceOwnerId || !user?.id) {
    throw new ApiError(
      ErrorCode.INTERNAL,
      '资源归属校验失败：缺少 ownerId 或 userId',
    );
  }
  // 私人资源不提供管理员角色豁免。
  if (resourceOwnerId !== user.id) {
    throw new ApiError(
      ErrorCode.FORBIDDEN,
      '无权访问该资源',
    );
  }
}

/**
 * 批量校验：适用于「资源列表」场景
 * @returns 返回不归属当前用户的资源 ID 列表（通常应该为空）
 */
export function findForeignResources<T extends { id: string; ownerId: string }>(
  resources: T[],
  user: OwnerUser,
): string[] {
  if (!user?.id) {
    throw new ApiError(ErrorCode.INTERNAL, '资源归属校验失败：缺少 userId');
  }
  return resources.filter((r) => r.ownerId !== user.id).map((r) => r.id);
}
