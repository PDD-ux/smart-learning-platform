import { Prisma } from '@prisma/client';
import { NextRequest } from 'next/server';
import { z } from 'zod';

import { ErrorCode } from '@/lib/api/errors';
import { assertAdmin } from '@/lib/auth/admin';
import { ApiError } from '@/lib/auth/ownership';
import { hashPassword } from '@/lib/auth/password';
import { withAuth } from '@/lib/auth/middleware';
import { fail, HttpStatus, ok } from '@/lib/api/response';
import { deleteEnrollmentPhoto } from '@/lib/face/enrollment-photo';
import { scheduleContentCleanup } from '@/lib/jobs/cleanup';
import { prisma } from '@/lib/prisma';

const updateSchema = z.object({
  nickname: z.string().min(2, '昵称至少 2 个字').max(20, '昵称最多 20 个字').optional(),
  password: z.string().min(8, '密码至少 8 位').max(72, '密码最多 72 位').optional(),
  role: z.enum(['admin', 'teacher', 'student']).optional(),
}).refine((value) => Object.values(value).some((item) => item !== undefined), { message: '至少修改一项' });

type RouteContext = { params: { id: string } };
type UserRecord = { id: string; email: string | null; phone: string | null; nickname: string; role: string; createdAt: Date; updatedAt: Date };

function toAdminUser(user: UserRecord, currentUserId: string) {
  return { ...user, createdAt: user.createdAt.toISOString(), updatedAt: user.updatedAt.toISOString(), isCurrent: user.id === currentUserId };
}

export const PATCH = withAuth<RouteContext>(async (request: NextRequest, { user, params }) => {
  await assertAdmin(user);
  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail(ErrorCode.VALIDATION_FAILED, '用户信息校验未通过', HttpStatus.BAD_REQUEST, parsed.error.flatten().fieldErrors);
  if (params.id === user.id && parsed.data.role !== undefined && parsed.data.role !== 'admin') return fail(ErrorCode.FORBIDDEN, '不能更改当前管理员的角色', HttpStatus.FORBIDDEN);

  const data: Prisma.UserUpdateInput = {};
  if (parsed.data.nickname !== undefined) data.nickname = parsed.data.nickname;
  if (parsed.data.role !== undefined) data.role = parsed.data.role;
  if (parsed.data.password !== undefined) data.passwordHash = await hashPassword(parsed.data.password);
  try {
    const updated = await prisma.$transaction(async (tx): Promise<UserRecord> => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${params.id} FOR UPDATE`;
      const target = await tx.user.findUnique({ where: { id: params.id }, select: { role: true, _count: { select: { responsibleClassrooms: true, sharedCourses: true } } } });
      if (!target) throw new ApiError(ErrorCode.NOT_FOUND, '用户不存在');
      if (parsed.data.role !== undefined && parsed.data.role !== target.role && (target._count.responsibleClassrooms > 0 || target._count.sharedCourses > 0)) {
        throw new ApiError(ErrorCode.CLASSROOM_CONFLICT, '账号仍负责班级或发布课程，请先明确处理归属，再调整角色');
      }
      return tx.user.update({ where: { id: params.id }, data, select: { id: true, email: true, phone: true, nickname: true, role: true, createdAt: true, updatedAt: true } });
    });
    return ok({ user: toAdminUser(updated, user.id) }, '用户信息已更新');
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') return fail(ErrorCode.NOT_FOUND, '用户不存在', HttpStatus.NOT_FOUND);
    throw error;
  }
});

export const DELETE = withAuth<RouteContext>(async (_request: NextRequest, { user, params }) => {
  await assertAdmin(user);
  if (params.id === user.id) return fail(ErrorCode.FORBIDDEN, '不能删除当前登录的管理员账号', HttpStatus.FORBIDDEN);
  try {
    const contents = await prisma.$transaction(async (tx): Promise<Array<{ id: string }>> => {
      // FK写入也需要目标User行锁；先锁再查，防止新班级关系在照片清理期间插入。
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${params.id} FOR UPDATE`;
      const target = await tx.user.findUnique({
        where: { id: params.id },
        select: {
          contents: { select: { id: true } },
          faceTemplate: { select: { enrollmentPhotoKey: true } },
          _count: { select: { responsibleClassrooms: true, classMemberships: true, classroomOperations: true, sharedCourses: true } },
        },
      });
      if (!target) throw new ApiError(ErrorCode.NOT_FOUND, '用户不存在');
      if (Object.values(target._count).some((count) => count > 0)) throw new ApiError(ErrorCode.CLASSROOM_CONFLICT, '账号仍关联班级或作业历史，暂不能删除；归档不会清除历史关联');

      // 生物照片属于敏感对象；清理失败时保留账号，避免失去唯一的对象定位信息。
      if (target.faceTemplate?.enrollmentPhotoKey) {
        try {
          await deleteEnrollmentPhoto(target.faceTemplate.enrollmentPhotoKey);
        } catch {
          throw new ApiError(ErrorCode.STORAGE_UNAVAILABLE, '私有照片清理失败，用户未删除，请稍后重试');
        }
      }
      await tx.user.delete({ where: { id: params.id } });
      return target.contents;
    }, { maxWait: 5000, timeout: 15000 });
    // 与内容单独删除一致：数据库级联后清理源文件、封面和抽帧对象。
    for (const content of contents) void scheduleContentCleanup(content.id);
    return ok({ id: params.id, deleted: true }, '用户已删除');
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') return fail(ErrorCode.NOT_FOUND, '用户不存在', HttpStatus.NOT_FOUND);
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') return fail(ErrorCode.CLASSROOM_CONFLICT, '账号存在需要保留的关联记录，暂不能删除', HttpStatus.CONFLICT);
    throw error;
  }
});
