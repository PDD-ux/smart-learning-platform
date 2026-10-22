import { AttendanceStatus, Prisma } from '@prisma/client';
import { NextRequest } from 'next/server';
import { z } from 'zod';

import { ErrorCode } from '@/lib/api/errors';
import { recordAudit } from '@/lib/audit/audit-service';
import { assertAdmin } from '@/lib/auth/admin';
import { withAuth } from '@/lib/auth/middleware';
import { fail, HttpStatus, ok } from '@/lib/api/response';
import { prisma } from '@/lib/prisma';

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(10),
  userId: z.string().trim().min(1).max(64).optional(),
  status: z.enum(['signed_in', 'self_check_in', 'manual_confirmation']).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

function mapStatus(status: AttendanceStatus): 'signed_in' | 'self_check_in' | 'manual_confirmation' {
  return status === AttendanceStatus.SIGNED_IN ? 'signed_in' : status === AttendanceStatus.SELF_CHECK_IN ? 'self_check_in' : 'manual_confirmation';
}

export const GET = withAuth(async (request: NextRequest, { user }) => {
  await assertAdmin(user);
  const { searchParams } = new URL(request.url);
  const parsed = querySchema.safeParse({
    page: searchParams.get('page') ?? undefined,
    pageSize: searchParams.get('pageSize') ?? undefined,
    userId: searchParams.get('userId') ?? undefined,
    status: searchParams.get('status') ?? undefined,
    from: searchParams.get('from') ?? undefined,
    to: searchParams.get('to') ?? undefined,
  });
  if (!parsed.success || (parsed.success && parsed.data.from && parsed.data.to && parsed.data.from > parsed.data.to)) {
    return fail(ErrorCode.VALIDATION_FAILED, '查询参数校验未通过', HttpStatus.BAD_REQUEST);
  }
  const { page, pageSize, userId, status, from, to } = parsed.data;
  const where: Prisma.AttendanceRecordWhereInput = {};
  if (userId) where.userId = userId;
  if (status) where.status = status === 'signed_in' ? AttendanceStatus.SIGNED_IN : status === 'self_check_in' ? AttendanceStatus.SELF_CHECK_IN : AttendanceStatus.MANUAL_CONFIRMATION;
  if (from || to) where.signedAt = { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) };

  const [total, records] = await prisma.$transaction([
    prisma.attendanceRecord.count({ where }),
    prisma.attendanceRecord.findMany({
      where,
      select: {
        id: true,
        userId: true,
        status: true,
        verificationVersion: true,
        signedAt: true,
        user: { select: { nickname: true } },
      },
      orderBy: { signedAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);
  await recordAudit({ actorId: user.id, objectId: 'attendance-records', action: 'attendance.admin.list', result: 'success', detail: null });
  return ok({
    page,
    pageSize,
    total,
    items: records.map((record) => ({
      id: record.id,
      userId: record.userId,
      nickname: record.user.nickname,
      status: mapStatus(record.status),
      verificationVersion: record.verificationVersion,
      signedAt: record.signedAt.toISOString(),
    })),
  });
});
