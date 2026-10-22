import { AttendanceStatus, type Prisma } from '@prisma/client';
import { ErrorCode } from '@/lib/api/errors';
import { ApiError } from '@/lib/auth/ownership';
import { shanghaiDayRange } from '@/lib/domain/admin-overview';
import { prisma } from '@/lib/prisma';

export type DailyCheckIn = {
  date: string;
  checkedIn: boolean;
  method: 'manual' | 'face' | null;
  signedAt: string | null;
};

function result(date: string, record: { status: AttendanceStatus; signedAt: Date } | null): DailyCheckIn {
  return { date, checkedIn: Boolean(record), method: record ? record.status === AttendanceStatus.SELF_CHECK_IN ? 'manual' : 'face' : null, signedAt: record?.signedAt.toISOString() ?? null };
}

export async function assertFaceEnabledUser(userId: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
  if (!user || (user.role !== 'student' && user.role !== 'teacher')) throw new ApiError(ErrorCode.FORBIDDEN, '仅教师和学生可使用人脸登录与个人打卡');
}

export async function getDailyCheckIn(userId: string, now: Date = new Date()): Promise<DailyCheckIn> {
  const { date } = shanghaiDayRange(now);
  const record = await prisma.attendanceRecord.findUnique({ where: { userId_checkInDay: { userId, checkInDay: date } } });
  return result(date, record);
}

/** 数据库 upsert 保留当天第一条记录的方式与时间；调用方先完成身份验证。 */
export async function writeDailyCheckIn(
  userId: string,
  method: 'manual' | 'face',
  version: string,
  db?: Prisma.TransactionClient,
  now: Date = new Date(),
): Promise<DailyCheckIn> {
  if (!db) return prisma.$transaction(async (tx): Promise<DailyCheckIn> => {
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
    const currentUser = await tx.user.findUnique({ where: { id: userId }, select: { role: true } });
    if (!currentUser || (currentUser.role !== 'student' && currentUser.role !== 'teacher')) throw new ApiError(ErrorCode.FORBIDDEN, '仅教师和学生可使用人脸登录与个人打卡');
    return writeDailyCheckIn(userId, method, version, tx, now);
  });
  const { date } = shanghaiDayRange(now);
  const record = await db.attendanceRecord.upsert({
    where: { userId_checkInDay: { userId, checkInDay: date } },
    create: { userId, checkInDay: date, status: method === 'manual' ? AttendanceStatus.SELF_CHECK_IN : AttendanceStatus.SIGNED_IN, verificationVersion: version, signedAt: now },
    update: {},
  });
  return result(date, record);
}
