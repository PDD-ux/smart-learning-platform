import { AttendanceStatus } from '@prisma/client';
import { NextRequest } from 'next/server';

import { ok } from '@/lib/api/response';
import { assertAdmin } from '@/lib/auth/admin';
import { withAuth } from '@/lib/auth/middleware';
import { shanghaiDayRange } from '@/lib/domain/admin-overview';
import { prisma } from '@/lib/prisma';

function toAdminRole(role: string): 'admin' | 'teacher' | 'student' {
  if (role === 'admin' || role === 'teacher' || role === 'student') return role;
  throw new Error('Unsupported user role in administrator overview');
}

export const GET = withAuth(async (_request: NextRequest, { user }) => {
  await assertAdmin(user);

  const now = new Date();
  const { date, start, end } = shanghaiDayRange(now);
  const [totalUsers, students, teachers, admins, attendanceTotal, signedIn, selfCheckIn, manualConfirmation, recentUsers] =
    await prisma.$transaction([
      prisma.user.count(),
      prisma.user.count({ where: { role: 'student' } }),
      prisma.user.count({ where: { role: 'teacher' } }),
      prisma.user.count({ where: { role: 'admin' } }),
      prisma.attendanceRecord.count({ where: { signedAt: { gte: start, lt: end } } }),
      prisma.attendanceRecord.count({ where: { signedAt: { gte: start, lt: end }, status: AttendanceStatus.SIGNED_IN } }),
      prisma.attendanceRecord.count({ where: { signedAt: { gte: start, lt: end }, status: AttendanceStatus.SELF_CHECK_IN } }),
      prisma.attendanceRecord.count({ where: { signedAt: { gte: start, lt: end }, status: AttendanceStatus.MANUAL_CONFIRMATION } }),
      prisma.user.findMany({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 5,
        select: { id: true, nickname: true, role: true, createdAt: true },
      }),
    ]);

  return ok({
    date,
    generatedAt: now.toISOString(),
    users: {
      total: totalUsers,
      students,
      teachers,
      admins,
      recent: recentUsers.map((account) => ({
        id: account.id,
        nickname: account.nickname,
        role: toAdminRole(account.role),
        createdAt: account.createdAt.toISOString(),
      })),
    },
    attendance: { total: attendanceTotal, signedIn, selfCheckIn, manualConfirmation },
  });
});
