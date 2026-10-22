import { Readable } from 'node:stream';
import { z } from 'zod';
import { NextRequest } from 'next/server';
import { ErrorCode } from '@/lib/api/errors';
import { fail, ok } from '@/lib/api/response';
import { withAuth, type AuthedHandler, type RouteHandler, type AuthUser } from '@/lib/auth/middleware';
import { ApiError } from '@/lib/auth/ownership';
import { prisma } from '@/lib/prisma';
import { getStorage, contentTypeFromKey, StorageError, type ByteRange } from '@/lib/storage';
import { parseRangeHeader } from '@/lib/storage-range';
import { rateLimit } from '@/lib/api/rate-limit';
import { prepareCourseSchema, courseActionSchema } from './contracts';
import { adminCourse, courseAccount, courseDetail, courseSummary, readableCourse, prepareCourse, changeCourse, coursePrefix } from './service';

export function sharedRoute<P = Record<string, never>>(handler: AuthedHandler<P>): RouteHandler<P> {
  const authed = withAuth(handler);
  return async (request, context): Promise<Response> => {
    const response = await authed(request, context);
    response.headers.set('Cache-Control', 'private, no-store'); response.headers.set('Vary', 'Cookie, Authorization'); response.headers.set('X-Content-Type-Options', 'nosniff');
    return response;
  };
}
const listSchema = z.object({ q: z.string().trim().max(120).default(''), page: z.coerce.number().int().min(1).max(100000).default(1), pageSize: z.coerce.number().int().min(1).max(50).default(20) });
export async function courseList(request: NextRequest, user: AuthUser, admin: boolean): Promise<Response> {
  const role = await courseAccount(user, admin);
  const search = new URL(request.url).searchParams, keys = ['q', 'page', 'pageSize'];
  const parsed = listSchema.safeParse(Object.fromEntries(keys.map((key): [string, string | undefined] => [key, search.get(key) ?? undefined])));
  if (!parsed.success || keys.some((key): boolean => search.getAll(key).length > 1)) return fail(ErrorCode.VALIDATION_FAILED, '课程筛选或分页参数无效');
  const { q, page, pageSize } = parsed.data;
  const where = { ...(admin ? role === 'teacher' ? { publisherId: user.id } : { OR: [{ publisherId: user.id }, { publishedAt: { not: null } }] } : { state: 'PUBLISHED' as const, preparedAt: { not: null } }), ...(q ? { title: { contains: q, mode: 'insensitive' as const } } : {}) };
  const [total, items] = await Promise.all([prisma.sharedCourse.count({ where }), prisma.sharedCourse.findMany({ where, skip: (page - 1) * pageSize, take: pageSize, orderBy: admin ? [{ createdAt: 'desc' }, { id: 'asc' }] : [{ publishedAt: 'desc' }, { id: 'asc' }] })]);
  return ok({ page, pageSize, total, items: items.map((item) => admin ? { ...courseSummary(item), discussionEnabled: item.discussionEnabled, state: item.state, prepared: item.preparedAt !== null } : courseSummary(item)) });
}
export async function courseRead(user: AuthUser, id: string, admin: boolean): Promise<Response> {
  const course = await readableCourse(user, id, admin);
  return ok(admin ? adminCourse(course, user.id) : courseDetail(course));
}
export async function coursePrepare(request: NextRequest, user: AuthUser): Promise<Response> {
  await courseAccount(user, true);
  const body = await request.json().catch((): null => null), parsed = prepareCourseSchema.safeParse(body);
  if (!parsed.success) return fail(ErrorCode.VALIDATION_FAILED, '请选择本人资料、公开内容并确认传播授权');
  const limit = await rateLimit('course-prepare:' + user.id, 10, 300000);
  if (!limit.allowed) return fail(ErrorCode.RATE_LIMITED, '准备副本过于频繁，请稍后重试', 429);
  return ok(adminCourse(await prepareCourse(user, parsed.data), user.id));
}
export async function courseChange(request: NextRequest, user: AuthUser, id: string): Promise<Response> {
  await courseAccount(user, true);
  const parsed = courseActionSchema.safeParse(await request.json().catch((): null => null));
  if (!parsed.success) return fail(ErrorCode.VALIDATION_FAILED, '课程动作或版本无效');
  return ok(adminCourse(await changeCourse(user, id, parsed.data.expectedVersion, parsed.data.action), user.id));
}
export function resolveSharedRange(header: string | null, size: number): ByteRange | null | false {
  if (header === null) return null;
  const range = parseRangeHeader(header);
  if (!range || !Number.isSafeInteger(size) || size <= 0) return false;
  if (range.suffix !== undefined) return Number.isSafeInteger(range.suffix) && range.suffix > 0 ? { start: Math.max(0, size - range.suffix), end: size - 1 } : false;
  const start = range.start, end = range.end ?? size - 1;
  if (start === undefined || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || end < start) return false;
  return { start, end: Math.min(end, size - 1) };
}
export async function courseMedia(request: NextRequest, user: AuthUser, id: string, admin: boolean, rawPage?: string): Promise<Response> {
  const course = await readableCourse(user, id, admin), prefix = coursePrefix(id);
  let key = `${prefix}media.${course.format}`;
  if (course.mediaKey !== key) throw new ApiError(ErrorCode.STORAGE_UNAVAILABLE, '共享媒体不可用');
  if (rawPage !== undefined) {
    const page = Number(rawPage);
    if (!/^\d+$/.test(rawPage) || !Number.isSafeInteger(page) || course.format !== 'pdf' || page < 1 || page > (course.pageCount ?? 0)) return fail(ErrorCode.REF_OUT_OF_RANGE, '文档页码无效');
    key = `${prefix}pages/${page}.png`;
    const keys = z.record(z.string()).safeParse(course.pageKeys);
    if (!keys.success || keys.data[String(page)] !== key) throw new ApiError(ErrorCode.STORAGE_UNAVAILABLE, '共享页图不可用');
  }
  const storage = getStorage(), info = await storage.statObject(key);
  if (!info) throw new ApiError(ErrorCode.STORAGE_UNAVAILABLE, '共享媒体暂时不可用');
  const range = resolveSharedRange(request.headers.get('range'), info.size);
  if (range === false) { const r = fail(ErrorCode.VALIDATION_FAILED, '请求范围不合法', 416); r.headers.set('Content-Range', `bytes */${info.size}`); return r; }
  const length = range ? (range.end ?? info.size - 1) - range.start + 1 : info.size;
  const headers = new Headers({ 'Content-Type': ['md', 'txt'].includes(course.format) && rawPage === undefined ? 'text/plain; charset=utf-8' : contentTypeFromKey(key), 'Content-Length': String(length), 'Accept-Ranges': 'bytes' });
  if (range) headers.set('Content-Range', `bytes ${range.start}-${range.end}/${info.size}`);
  if (request.method === 'HEAD') return new Response(null, { status: range ? 206 : 200, headers });
  try {
    const object = await storage.getObject(key, range ?? undefined);
    // Request cancellation propagates to the bounded Node storage stream.
    return new Response(Readable.toWeb(object.stream) as ReadableStream<Uint8Array>, { status: range ? 206 : 200, headers });
  } catch (cause: unknown) {
    if (cause instanceof StorageError) throw new ApiError(ErrorCode.STORAGE_UNAVAILABLE, '共享媒体读取失败，请重试');
    throw new ApiError(ErrorCode.STORAGE_UNAVAILABLE, '共享媒体读取失败，请重试');
  }
}
