import { createHash, randomUUID } from 'node:crypto';
import { Prisma, type AsyncJob } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import type { AuthUser } from '@/lib/auth/middleware';
import { ApiError } from '@/lib/auth/ownership';
import { ErrorCode } from '@/lib/api/errors';
import { rateLimit } from '@/lib/api/rate-limit';
import { courseAccount } from '@/lib/courses/service';
import { getStorage } from '@/lib/storage';
import { enqueue, QueueName } from '@/lib/queue';
import { registerAllProcessors } from '@/lib/jobs/workers';
import { normalizedPublicUrl, UrlImportError } from '@/lib/url-imports/fetch';
import { expireUrlDrafts, readUrlDraft, smallBody } from '@/lib/url-imports/service';
import type { UrlDraftView } from '@/lib/url-imports/contracts';
import { downloadVideoSnapshot } from './source';

const conflict = (): ApiError => new ApiError(ErrorCode.NOTE_CONFLICT, '导入编号已被使用或状态已变化，请重新读取状态。');
async function lockOwner(tx: Prisma.TransactionClient, userId: string): Promise<void> {
  const rows = await tx.$queryRawUnsafe<{ id: string }[]>('SELECT id FROM "User" WHERE id = $1 FOR UPDATE', userId);
  if (!rows.length) throw new ApiError(ErrorCode.UNAUTHENTICATED, '账号已失效，请重新登录');
}
async function discardUncommitted(userId: string, draftId: string): Promise<void> {
  await prisma.$transaction(async (tx): Promise<void> => {
    // A deleted account has no row to lock, but its late upload must still be removed.
    await tx.$queryRawUnsafe('SELECT id FROM "User" WHERE id = $1 FOR UPDATE', userId);
    if (await tx.learningContent.findUnique({ where: { id: 'url-' + draftId }, select: { id: true } })) return;
    for (const format of ['mp4', 'webm']) await getStorage().deleteObject(`contents/url-${draftId}/source.${format}`);
  }, { timeout: 45000 });
}

export async function importVideoUrl(request: Request, user: AuthUser): Promise<UrlDraftView> {
  await courseAccount(user);
  await expireUrlDrafts(user.id);
  const input = z.object({ requestId: z.string().uuid(), url: z.string().trim().min(1).max(2048), confirmed: z.literal(true) }).strict().safeParse(await smallBody(request));
  if (!input.success) throw new ApiError(ErrorCode.VALIDATION_FAILED, '请输入视频直链，并明确确认使用授权与解析服务额度。');
  let url: string;
  try { url = normalizedPublicUrl(input.data.url).href; } catch { throw new ApiError(ErrorCode.VALIDATION_FAILED, '请输入公开MP4/WebM文件直链；不支持视频网站、网盘、登录或内网地址。'); }
  const digest = createHash('sha256').update('video:' + url).digest('hex');
  const reservation = await prisma.$transaction(async (tx): Promise<{ id: string; created: boolean }> => {
    await lockOwner(tx, user.id);
    const previous = await tx.urlImportDraft.findUnique({ where: { ownerId_requestId: { ownerId: user.id, requestId: input.data.requestId } } });
    if (previous) { if (previous.requestDigest !== digest) throw conflict(); return { id: previous.id, created: false }; }
    if (request.signal.aborted) throw new ApiError(ErrorCode.VALIDATION_FAILED, '本次导入已取消。');
    if (await tx.urlImportDraft.count({ where: { ownerId: user.id, state: { in: ['FETCHING', 'PREVIEW'] }, expiresAt: { gt: new Date() } } }) >= 3) throw new ApiError(ErrorCode.VALIDATION_FAILED, '最多保留3份处理中链接，请先保存或取消。');
    if (!(await rateLimit('video-url:' + user.id, 2, 60000)).allowed) throw new ApiError(ErrorCode.RATE_LIMITED, '本分钟视频链接导入次数已达上限，请稍后再试。');
    const row = await tx.urlImportDraft.create({ data: { ownerId: user.id, requestId: input.data.requestId, requestDigest: digest, requestedUrl: url, prepared: { kind: 'video' }, expiresAt: new Date(Date.now() + 1800000) } });
    return { id: row.id, created: true };
  });
  if (!reservation.created) return readUrlDraft(user, input.data.requestId);
  try {
    const video = await downloadVideoSnapshot(url, reservation.id, request.signal);
    const job = await prisma.$transaction(async (tx): Promise<AsyncJob> => {
      await lockOwner(tx, user.id);
      const draft = await tx.urlImportDraft.findUniqueOrThrow({ where: { id: reservation.id } });
      if (draft.state !== 'FETCHING' || draft.expiresAt <= new Date() || request.signal.aborted) throw new UrlImportError('CANCELLED');
      const contentId = 'url-' + draft.id;
      await tx.learningContent.create({ data: { id: contentId, ownerId: user.id, contentType: 'VIDEO', title: video.source.title, fileName: 'source.' + video.format.toLowerCase(), format: video.format, fileSizeBytes: BigInt(video.fileSize), storageKey: video.storageKey, durationSec: video.durationSec, status: 'PENDING', understandingStatus: 'NONE', urlSource: video.source as unknown as Prisma.InputJsonValue } });
      const queued = await tx.asyncJob.create({ data: { contentId, jobType: 'CONTENT_PARSE', traceId: randomUUID(), state: 'PENDING', attempts: 0 } });
      await tx.urlImportDraft.update({ where: { id: draft.id }, data: { state: 'COMMITTED', contentId, requestedUrl: '', prepared: Prisma.DbNull, snapshot: null, errorCode: null } });
      return queued;
    }, { timeout: 45000 });
    try {
      registerAllProcessors();
      await enqueue(QueueName.CONTENT_PARSE, { contentId: job.contentId, traceId: job.traceId, asyncJobId: job.id, stage: 'content-parse' });
      await prisma.learningContent.updateMany({ where: { id: job.contentId, status: 'PENDING' }, data: { status: 'PARSING' } });
    } catch {
      await prisma.$transaction(async (tx): Promise<void> => {
        const failed = await tx.asyncJob.updateMany({ where: { id: job.id, state: 'PENDING' }, data: { state: 'FAILED', errorReason: '视频已保存，但解析队列暂不可用。' } });
        if (failed.count) {
          await tx.learningContent.updateMany({ where: { id: job.contentId, status: 'PENDING' }, data: { status: 'FAILED', failReason: '视频已保存，解析任务未启动，请在学习中心重试解析。' } });
          await tx.urlImportDraft.update({ where: { id: reservation.id }, data: { errorCode: 'VIDEO_QUEUE_FAILED' } });
        }
      });
    }
  } catch (error: unknown) {
    const code = error instanceof UrlImportError ? error.reason : 'FETCH_FAILED';
    await prisma.urlImportDraft.updateMany({ where: { id: reservation.id, state: 'FETCHING' }, data: { state: code === 'CANCELLED' ? 'CANCELLED' : 'FAILED', errorCode: 'VIDEO_' + code, requestedUrl: '', prepared: Prisma.DbNull, snapshot: null } });
  } finally {
    await discardUncommitted(user.id, reservation.id);
  }
  return readUrlDraft(user, input.data.requestId);
}
