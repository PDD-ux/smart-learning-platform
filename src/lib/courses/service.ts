import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Prisma, type SharedCourse } from '@prisma/client';
import { z } from 'zod';
import { ErrorCode } from '@/lib/api/errors';
import { ApiError } from '@/lib/auth/ownership';
import type { AuthUser } from '@/lib/auth/middleware';
import { prisma } from '@/lib/prisma';
import { getStorage, type StorageClient } from '@/lib/storage';
import { materializeObject } from '@/lib/media/materialize';
import { renderPdfPages } from '@/lib/media/pdf-render';
import { isRefInRange, type ContentRef } from '@/lib/domain/content-ref';
import { includeSchema, snapshotSchema, type PrepareCourse, type CourseSnapshot, type CourseDetail, type CourseSummary, type AdminCourse } from './contracts';
import { discussionReleased } from '@/lib/discussions/contracts';

export function coursePrefix(id: string): string {
  if (!z.string().uuid().safeParse(id).success) throw new ApiError(ErrorCode.NOT_FOUND, '课程不存在');
  return `shared-courses/${id}/`;
}
export async function courseAccount(user: AuthUser, admin = false, tx: Prisma.TransactionClient = prisma, lock = false): Promise<string> {
  const current = lock ? (await tx.$queryRaw<Array<{ role: string }>>`SELECT role FROM "User" WHERE id = ${user.id} FOR SHARE`)[0] : await tx.user.findUnique({ where: { id: user.id }, select: { role: true } });
  if (!current) throw new ApiError(ErrorCode.UNAUTHENTICATED, '账号已失效，请重新登录');
  if (admin && current.role !== 'admin' && current.role !== 'teacher') throw new ApiError(ErrorCode.FORBIDDEN, '仅课程负责人可以执行此操作');
  return current.role;
}
export function validateSnapshot(input: unknown, bounds: { contentType: 'VIDEO' | 'DOCUMENT'; durationSec: number | null; pageCount: number | null }): CourseSnapshot {
  const parsed = snapshotSchema.safeParse(input);
  if (!parsed.success || Buffer.byteLength(JSON.stringify(parsed.success ? parsed.data : {})) > 10 * 1024 * 1024) throw new ApiError(ErrorCode.VALIDATION_FAILED, '所选解析内容超限或格式无效');
  const data = parsed.data;
  const validRef = (ref: ContentRef): boolean => (ref.type === 'video') === (bounds.contentType === 'VIDEO') && isRefInRange(ref, bounds);
  if (data.textBlocks.some((block): boolean => !validRef(block.ref)) || data.knowledgePoints.some((point): boolean => point.refs.some((ref): boolean => !validRef(ref))) || data.transcripts.some((segment): boolean => bounds.contentType !== 'VIDEO' || bounds.durationSec === null || segment.endMs <= segment.startMs || segment.endMs > bounds.durationSec * 1000)) {
    throw new ApiError(ErrorCode.REF_OUT_OF_RANGE, '所选解析内容存在无效来源定位');
  }
  return data;
}
export function courseSummary(course: SharedCourse): CourseSummary {
  return { courseId: course.id, title: course.title, description: course.description, contentType: course.contentType === 'VIDEO' ? 'video' : 'document', format: course.format, durationSec: course.durationSec, pageCount: course.pageCount, discussionEnabled: course.discussionEnabled && discussionReleased(), version: course.version, publishedAt: course.publishedAt?.toISOString() ?? null };
}
export function courseDetail(course: SharedCourse, admin = false): CourseDetail {
  return { ...courseSummary(course), discussionAvailable: discussionReleased(), resourceUrl: `/api/${admin ? 'admin/' : ''}courses/${course.id}/media`, snapshot: snapshotSchema.parse(course.snapshot) };
}
export function adminCourse(course: SharedCourse, userId: string): AdminCourse {
  return { ...courseDetail(course, true), discussionEnabled: course.discussionEnabled, canPublish: course.publisherId === userId, state: course.state, prepared: course.preparedAt !== null, include: includeSchema.parse(course.include), rightsConfirmed: course.rightsConfirmed, rightsStatement: course.rightsStatement };
}
export async function readableCourse(user: AuthUser, id: string, admin = false): Promise<SharedCourse> {
  const role = await courseAccount(user, admin); coursePrefix(id);
  const course = await prisma.sharedCourse.findFirst({ where: { id, ...(admin ? { ...(role === 'teacher' ? { publisherId: user.id } : { OR: [{ publisherId: user.id }, { publishedAt: { not: null } }] }), preparedAt: { not: null } } : { state: 'PUBLISHED', preparedAt: { not: null } }) } });
  if (!course) throw new ApiError(ErrorCode.NOT_FOUND, '课程不存在或暂不可用');
  return course;
}
function conflict(): ApiError { return new ApiError(ErrorCode.SHARED_COURSE_CONFLICT, '课程状态已变化或正在准备，请刷新核对后手动重试'); }
async function replay(user: AuthUser, input: PrepareCourse, digest: string): Promise<SharedCourse | null> {
  const existing = await prisma.sharedCourse.findUnique({ where: { publisherId_requestId: { publisherId: user.id, requestId: input.requestId } } });
  if (!existing) return null;
  if (existing.requestDigest !== digest || !existing.preparedAt) throw conflict();
  return existing;
}
export async function prepareCourse(user: AuthUser, input: PrepareCourse, storage: StorageClient = getStorage()): Promise<SharedCourse> {
  if (await courseAccount(user, true) !== 'teacher') throw new ApiError(ErrorCode.FORBIDDEN, '共享课程只能由教师准备和发布');
  // Fixed property order avoids semantically identical JSON creating conflicting retries.
  const normalized = { sourceContentId: input.sourceContentId, title: input.title, description: input.description, rightsConfirmed: input.rightsConfirmed, rightsStatement: input.rightsStatement, include: { transcripts: input.include.transcripts, textBlocks: input.include.textBlocks, knowledgePoints: input.include.knowledgePoints, generatedNote: input.include.generatedNote } };
  const digest = createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
  const previous = await replay(user, input, digest); if (previous) return previous;
  const source = await prisma.learningContent.findFirst({ where: { id: input.sourceContentId, ownerId: user.id, status: 'READY' }, include: {
    transcripts: input.include.transcripts ? { orderBy: { seq: 'asc' }, take: 10001 } : false,
    textBlocks: input.include.textBlocks ? { orderBy: { sequence: 'asc' }, take: 20001 } : false,
    knowledgePoints: input.include.knowledgePoints ? { where: { ownerId: user.id }, orderBy: { id: 'asc' }, take: 2001 } : false,
    generatedNote: input.include.generatedNote,
  } });
  if (!source) throw new ApiError(ErrorCode.CONTENT_NOT_FOUND, '仅可选择本人已就绪且获授权的资料');
  const format = source.format.toLowerCase();
  const formats = source.contentType === 'VIDEO' ? ['mp4', 'mov', 'webm', 'mkv'] : ['pdf', 'md', 'txt', 'png', 'jpg', 'jpeg'];
  if (!formats.includes(format) || source.fileSizeBytes <= 0n || source.fileSizeBytes > BigInt(source.contentType === 'VIDEO' ? 8 * 1024 ** 3 : 50 * 1024 ** 2) || (source.contentType === 'VIDEO' ? !source.durationSec || source.durationSec < 1 : !source.pageCount || source.pageCount < 1 || source.pageCount > 500)) throw new ApiError(ErrorCode.VALIDATION_FAILED, '资料格式、大小或时间/页数不支持共享');
  const snapshot = validateSnapshot({
    transcripts: input.include.transcripts ? source.transcripts.map((item) => ({ startMs: item.startMs, endMs: item.endMs, text: item.text })) : [],
    textBlocks: input.include.textBlocks ? source.textBlocks.map((item) => ({ ref: item.ref, text: item.text })) : [],
    knowledgePoints: input.include.knowledgePoints ? source.knowledgePoints.map((item) => ({ title: item.title, summary: item.summary, tags: item.tags, importance: item.importance, refs: item.refs })) : [],
    generatedNote: input.include.generatedNote && source.generatedNote ? { markdown: source.generatedNote.markdown, sourceCount: source.generatedNote.sourceCount, generatedAt: source.generatedNote.generatedAt.toISOString() } : null,
  }, source);
  const id = randomUUID(), prefix = coursePrefix(id), mediaKey = `${prefix}media.${format}`;
  try {
    await prisma.$transaction(async (tx): Promise<void> => {
      if (await courseAccount(user, true, tx, true) !== 'teacher') throw new ApiError(ErrorCode.FORBIDDEN, '共享课程只能由教师准备和发布');
      await tx.sharedCourse.create({ data: { id, publisherId: user.id, sourceContentId: source.id, title: input.title, description: input.description, contentType: source.contentType, format, durationSec: source.durationSec, pageCount: source.pageCount, fileSizeBytes: source.fileSizeBytes, mediaKey, snapshot, include: normalized.include, rightsStatement: input.rightsStatement, rightsConfirmed: true, requestId: input.requestId, requestDigest: digest } });
    });
  } catch (cause: unknown) {
    if (cause instanceof Prisma.PrismaClientKnownRequestError && cause.code === 'P2002') { const repeated = await replay(user, input, digest); if (repeated) return repeated; }
    if (cause instanceof ApiError) throw cause;
    throw conflict();
  }
  try {
    const original = await storage.getObject(source.storageKey);
    if (BigInt(original.contentLength) !== source.fileSizeBytes) { original.stream.destroy(); throw new Error('size mismatch'); }
    try { await storage.putObject(mediaKey, original.stream, { contentType: original.contentType, contentLength: original.contentLength }); } finally { original.stream.destroy(); }
    const pageKeys: Record<string, string> = {};
    if (format === 'pdf') {
      const file = await materializeObject(storage, mediaKey), output = path.join(tmpdir(), `slp-shared-${id}`);
      try {
        const pages = await renderPdfPages(file.filePath, Array.from({ length: source.pageCount ?? 0 }, (_, index): number => index + 1), output);
        if (pages.length !== source.pageCount) throw new Error('incomplete pages');
        for (const page of pages) { const key = `${prefix}pages/${page.page}.png`; await storage.putObject(key, createReadStream(page.filePath), { contentType: 'image/png', contentLength: (await stat(page.filePath)).size }); pageKeys[String(page.page)] = key; }
      } finally { await rm(output, { recursive: true, force: true }); await file.cleanup(); }
    }
    return await prisma.$transaction(async (tx): Promise<SharedCourse> => {
      await courseAccount(user, true, tx, true);
      const prepared = await tx.sharedCourse.update({ where: { id }, data: { pageKeys, preparedAt: new Date() } });
      await tx.auditLog.create({ data: { actorId: user.id, objectId: id, action: 'course.prepare', result: 'success' } });
      return prepared;
    });
  } catch (cause: unknown) {
    // The UUID prefix belongs exclusively to this reserved row; never delete a source key.
    await storage.deletePrefix(prefix).catch((): void => { console.error('[shared-course] temporary copy cleanup failed', { courseId: id }); });
    await prisma.sharedCourse.deleteMany({ where: { id, publisherId: user.id, state: 'DRAFT', preparedAt: null } });
    if (cause instanceof ApiError) throw cause;
    throw new ApiError(ErrorCode.STORAGE_UNAVAILABLE, '共享副本准备失败，请检查媒体与PDF渲染服务后手动重试');
  }
}
export async function changeCourse(user: AuthUser, id: string, expectedVersion: number, action: 'publish' | 'withdraw', storage: StorageClient = getStorage()): Promise<SharedCourse> {
  const current = await readableCourse(user, id, true);
  const currentRole = await courseAccount(user, true);
  if (action === 'publish' && currentRole !== 'teacher') throw new ApiError(ErrorCode.FORBIDDEN, '共享课程只能由教师发布');
  if (action === 'withdraw' && currentRole === 'admin' && current.state !== 'PUBLISHED') throw new ApiError(ErrorCode.FORBIDDEN, '平台管理员只能下架已发布课程');
  const moderatorWithdraw = action === 'withdraw' && currentRole === 'admin' && current.state === 'PUBLISHED' && current.publishedAt !== null;
  if (current.publisherId !== user.id && !moderatorWithdraw) throw new ApiError(ErrorCode.FORBIDDEN, '仅原发布者可以修改本人课程');
  if (current.version !== expectedVersion) throw conflict();
  if (action === 'publish') {
    if (current.publisherId !== user.id) throw new ApiError(ErrorCode.FORBIDDEN, '仅原发布者可以首次发布或重新发布');
    validateSnapshot(current.snapshot, current);
    if (!current.rightsConfirmed || !current.rightsStatement.trim() || !current.preparedAt || current.mediaKey !== `${coursePrefix(id)}media.${current.format}`) throw conflict();
    const media = await storage.statObject(current.mediaKey);
    if (!media || BigInt(media.size) !== current.fileSizeBytes) throw new ApiError(ErrorCode.STORAGE_UNAVAILABLE, '共享媒体不完整，不能发布');
    if (current.format === 'pdf') {
      const keys = z.record(z.string()).parse(current.pageKeys);
      for (let page = 1; page <= (current.pageCount ?? 0); page++) {
        const key = `${coursePrefix(id)}pages/${page}.png`;
        if (keys[String(page)] !== key || !await storage.statObject(key)) throw new ApiError(ErrorCode.STORAGE_UNAVAILABLE, '共享PDF页图不完整，不能发布');
      }
    }
  }
  return prisma.$transaction(async (tx): Promise<SharedCourse> => {
    const role = await courseAccount(user, true, tx, true);
    if (action === 'publish' && role !== 'teacher') throw new ApiError(ErrorCode.FORBIDDEN, '共享课程只能由教师发布');
    const adminModeration = action === 'withdraw' && role === 'admin';
    const changed = await tx.sharedCourse.updateMany({ where: { id, ...(adminModeration ? { state: 'PUBLISHED', publishedAt: { not: null } } : { publisherId: user.id }), version: expectedVersion, preparedAt: { not: null } }, data: { state: action === 'publish' ? 'PUBLISHED' : 'WITHDRAWN', publishedAt: action === 'publish' ? new Date() : current.publishedAt, version: { increment: 1 } } });
    if (changed.count !== 1) throw conflict();
    await tx.auditLog.create({ data: { actorId: user.id, objectId: id, action: `course.${action}`, result: 'success' } });
    return tx.sharedCourse.findUniqueOrThrow({ where: { id } });
  });
}
