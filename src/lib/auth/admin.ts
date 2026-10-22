import { ErrorCode } from '@/lib/api/errors';
import { prisma } from '@/lib/prisma';
import { ApiError, type OwnerUser } from './ownership';

/** 管理员接口以数据库中的当前角色为准，避免旧 JWT 在降级或删号后继续授权。 */
export async function assertAdmin(user: OwnerUser): Promise<void> {
  const current = await prisma.user.findUnique({ where: { id: user.id }, select: { role: true } });
  if (!current) {
    throw new ApiError(ErrorCode.UNAUTHENTICATED, '账号不存在，请重新登录');
  }
  if (current.role !== 'admin') {
    throw new ApiError(ErrorCode.FORBIDDEN, '仅管理员可以执行此操作');
  }
}
