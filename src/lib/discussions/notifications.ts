import { randomUUID } from 'node:crypto';
import { Prisma, type NotificationKind } from '@prisma/client';
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { courseAccount } from '@/lib/courses/service';
import type { AuthUser } from '@/lib/auth/middleware';
import { ApiError } from '@/lib/auth/ownership';
import { ErrorCode } from '@/lib/api/errors';
import { ok } from '@/lib/api/response';
import { discussionReleased, refSchema } from './contracts';

type Tx = Prisma.TransactionClient;
export type MessageDto = { id: string; kind: 'reply' | 'report_result'; summary: string; createdAt: string; readAt: string | null; targetUrl: string | null; resolution: string | null };
export type MessageList = { page: number; pageSize: number; total: number; unreadCount: number; asOf: string; items: MessageDto[] };
export type Participation = { id: string; title: string; courseTitle: string; targetUrl: string; createdAt: string };
export type ParticipationList = { page: number; pageSize: number; total: number; items: Participation[] };
export const readMessageSchema = z.object({ read: z.literal(true) }).strict();
export const readAllSchema = z.object({ before: z.string().datetime() }).strict();
const paging = z.object({ page: z.coerce.number().int().min(1).max(100000).default(1), pageSize: z.coerce.number().int().min(1).max(50).default(20) }).strict();
const visible = { hiddenAt: null, deletedAt: null, authorId: { not: null } };
const published = { state: 'PUBLISHED' as const, preparedAt: { not: null } };
function absent(): ApiError { return new ApiError(ErrorCode.NOT_FOUND, '消息或讨论当前不可用'); }
function gate(): void { if (!discussionReleased()) throw absent(); }
function page(request: NextRequest): z.output<typeof paging> {
  const search = new URL(request.url).searchParams;
  const parsed = paging.safeParse(Object.fromEntries(search));
  if (!parsed.success || [...search.keys()].some((key): boolean => search.getAll(key).length > 1)) throw new ApiError(ErrorCode.VALIDATION_FAILED, '消息分页参数无效');
  return parsed.data;
}
async function account(tx: Tx, user: AuthUser): Promise<void> {
  // Serialize reads/read-all with notification writers' recipient SHARE lock.
  await tx.$queryRaw`SELECT id FROM "User" WHERE id=${user.id} FOR UPDATE`;
  await courseAccount(user, false, tx);
}
export async function emitNotification(tx: Tx, input: { recipientId: string; kind: NotificationKind; eventKey: string; courseId: string; threadId: string; replyId?: string | null; reportId?: string | null }): Promise<void> {
  // A later writer in the same millisecond must remain beyond the last read cutoff.
  const [time] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() + interval '1 millisecond' AS now`;
  await tx.notification.create({ data: { id: randomUUID(), ...input, createdAt: time.now } });
}
export function discussionTarget(courseId: string, threadId: string, ref: unknown): string {
  const params = new URLSearchParams({ thread: threadId });
  const parsed = refSchema.safeParse(ref);
  if (parsed.success) { if (parsed.data.type === 'video') params.set('t', String(parsed.data.timestampSec)); else params.set('page', String(parsed.data.page)); }
  return `/courses/${encodeURIComponent(courseId)}?${params}`;
}
export async function messageList(request: NextRequest, user: AuthUser): Promise<Response> {
  gate(); const input = page(request);
  return prisma.$transaction(async (tx): Promise<Response> => {
    await account(tx, user);
    const [time] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
    const where = { recipientId: user.id, createdAt: { lte: time.now } };
    const [total, unreadCount, rows] = await Promise.all([tx.notification.count({ where }), tx.notification.count({ where: { ...where, readAt: null } }), tx.notification.findMany({ where, include: { course: true, thread: true, reply: true, report: true }, skip: (input.page - 1) * input.pageSize, take: input.pageSize, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }] })]);
    const items = rows.map((row): MessageDto => {
      const parent = row.thread;
      const accessible = row.course.state === 'PUBLISHED' && row.course.preparedAt !== null && parent.courseId === row.courseId && !parent.hiddenAt && !parent.deletedAt && parent.authorId !== null && (!row.replyId || (row.reply?.threadId === parent.id && !row.reply.hiddenAt && !row.reply.deletedAt && row.reply.authorId !== null));
      return { id: row.id, kind: row.kind === 'REPLY' ? 'reply' : 'report_result', summary: row.kind === 'REPLY' ? '你的主题收到一条新回复' : '你提交的举报已有处理结果', createdAt: row.createdAt.toISOString(), readAt: row.readAt?.toISOString() ?? null, targetUrl: accessible ? discussionTarget(row.courseId, parent.id, parent.ref) : null, resolution: row.kind === 'REPORT_RESULT' && row.report?.reporterId === user.id && row.report.state === 'HANDLED' ? row.report.resolution : null };
    });
    return ok({ ...input, total, unreadCount, asOf: time.now.toISOString(), items });
  });
}
export async function markMessage(request: NextRequest, user: AuthUser, id: string): Promise<Response> {
  gate(); if (!readMessageSchema.safeParse(await request.json().catch((): null => null)).success) throw new ApiError(ErrorCode.VALIDATION_FAILED, '仅支持标为已读');
  return prisma.$transaction(async (tx): Promise<Response> => {
    await account(tx, user);
    if (!await tx.notification.findFirst({ where: { id, recipientId: user.id } })) throw absent();
    await tx.notification.updateMany({ where: { id, recipientId: user.id, readAt: null }, data: { readAt: new Date() } });
    const row = await tx.notification.findUniqueOrThrow({ where: { id } }); return ok({ id, readAt: row.readAt!.toISOString() });
  });
}
export async function markAllMessages(request: NextRequest, user: AuthUser): Promise<Response> {
  gate(); const parsed = readAllSchema.safeParse(await request.json().catch((): null => null));
  if (!parsed.success) throw new ApiError(ErrorCode.VALIDATION_FAILED, '请使用读取消息时的时间范围');
  return prisma.$transaction(async (tx): Promise<Response> => {
    await account(tx, user); const [time] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
    const before = new Date(parsed.data.before); if (before > time.now) throw new ApiError(ErrorCode.VALIDATION_FAILED, '不能标记未来消息');
    const result = await tx.notification.updateMany({ where: { recipientId: user.id, readAt: null, createdAt: { lte: before } }, data: { readAt: time.now } }); return ok({ updated: result.count });
  });
}
export async function participated(request: NextRequest, user: AuthUser): Promise<Response> {
  gate(); const input = page(request);
  return prisma.$transaction(async (tx): Promise<Response> => {
    await courseAccount(user, false, tx, true);
    const where: Prisma.DiscussionThreadWhereInput = { ...visible, course: published, OR: [{ authorId: user.id }, { replies: { some: { ...visible, authorId: user.id } } }] };
    const [total, rows] = await Promise.all([tx.discussionThread.count({ where }), tx.discussionThread.findMany({ where, include: { course: true }, skip: (input.page - 1) * input.pageSize, take: input.pageSize, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }] })]);
    return ok({ ...input, total, items: rows.map((row): Participation => ({ id: row.id, title: row.title, courseTitle: row.course.title, targetUrl: discussionTarget(row.courseId, row.id, row.ref), createdAt: row.createdAt.toISOString() })) });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}
