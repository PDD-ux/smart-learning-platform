import { createHash, randomUUID } from 'node:crypto';
import { Prisma, type DiscussionThread, type DiscussionReply } from '@prisma/client';
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { ApiError } from '@/lib/auth/ownership';
import type { AuthUser } from '@/lib/auth/middleware';
import { ErrorCode } from '@/lib/api/errors';
import { ok } from '@/lib/api/response';
import { rateLimit } from '@/lib/api/rate-limit';
import { courseAccount } from '@/lib/courses/service';
import { isRefInRange } from '@/lib/domain/content-ref';
import { discussionReleased, threadCreate, threadPatch, replyCreate, replyPatch, deleteSchema, refSchema, type DiscussionThreadDto, type DiscussionReplyDto, type PublicAuthor } from './contracts';
import { emitNotification } from './notifications';

type Tx = Prisma.TransactionClient;
type Author = { author: PublicAuthor };
const authorSelect = { nickname: true, role: true } as const;
const visible = { hiddenAt: null, deletedAt: null };
function notFound(): ApiError { return new ApiError(ErrorCode.NOT_FOUND, '讨论不存在或当前不可用'); }
function conflict(): ApiError { return new ApiError(ErrorCode.DISCUSSION_CONFLICT, '讨论已关闭或版本已变化，请刷新核对后重试'); }
function digest(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
async function limit(user: AuthUser, courseId: string): Promise<void> {
  const allowed = await rateLimit(`discussion:${user.id}:${courseId}`, 10, 60000);
  if (!allowed.allowed) throw new ApiError(ErrorCode.RATE_LIMITED, '提交过于频繁，请一分钟后重试');
}
export function threadDto(row: DiscussionThread & Author & { _count: { replies: number } }, userId: string): DiscussionThreadDto {
  return { id: row.id, courseId: row.courseId, kind: row.kind === 'QUESTION' ? 'question' : 'discussion', title: row.title, body: row.body, ref: row.ref === null ? null : refSchema.parse(row.ref), solvedAt: row.solvedAt?.toISOString() ?? null, pinnedAt: row.pinnedAt?.toISOString() ?? null, version: row.version, author: row.author, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(), canEdit: row.authorId === userId, replyCount: row._count.replies };
}
export function replyDto(row: DiscussionReply & Author, userId: string): DiscussionReplyDto {
  const deleted = row.deletedAt !== null || row.authorId === null;
  return { id: row.id, threadId: row.threadId, author: deleted ? null : row.author, body: deleted ? null : row.body, deleted, version: row.version, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(), canEdit: !deleted && row.authorId === userId };
}
const threadInclude = { author: { select: authorSelect }, _count: { select: { replies: { where: { ...visible, authorId: { not: null } } } } } };
async function scope(tx: Tx, user: AuthUser, courseId: string, write = false): Promise<import('@prisma/client').SharedCourse> {
  if (!discussionReleased()) throw notFound();
  await courseAccount(user, false, tx, true);
  if (write) await tx.$queryRaw`SELECT id FROM "SharedCourse" WHERE id=${courseId} FOR UPDATE`;
  else await tx.$queryRaw`SELECT id FROM "SharedCourse" WHERE id=${courseId} FOR SHARE`;
  const course = await tx.sharedCourse.findFirst({ where: { id: courseId, state: 'PUBLISHED', preparedAt: { not: null } } });
  if (!course) throw notFound(); return course;
}
async function parent(tx: Tx, id: string, write = false): Promise<DiscussionThread> {
  await tx.$queryRaw(Prisma.sql`SELECT id FROM "DiscussionThread" WHERE id=${id} ${write ? Prisma.sql`FOR UPDATE` : Prisma.sql`FOR SHARE`}`);
  const row = await tx.discussionThread.findFirst({ where: { id, ...visible, authorId: { not: null } } });
  if (!row) throw notFound(); return row;
}
async function threadCourse(id: string): Promise<string> {
  if (!discussionReleased()) throw notFound();
  const row = await prisma.discussionThread.findUnique({ where: { id }, select: { courseId: true } });
  if (!row) throw notFound(); return row.courseId;
}
function paging(request: NextRequest): { page: number; pageSize: number; mine: boolean; sort: 'newest' | 'oldest' } {
  const query = new URL(request.url).searchParams;
  const parsed = z.object({ page: z.coerce.number().int().min(1).max(100000).default(1), pageSize: z.coerce.number().int().min(1).max(50).default(20), mine: z.enum(['true','false']).default('false'), sort: z.enum(['newest','oldest']).default('newest') }).safeParse(Object.fromEntries(['page','pageSize','mine','sort'].map((key): [string,string|undefined] => [key, query.get(key) ?? undefined])));
  if (!parsed.success || ['page','pageSize','mine','sort'].some((key): boolean => query.getAll(key).length > 1)) throw new ApiError(ErrorCode.VALIDATION_FAILED, '讨论分页筛选无效');
  return { ...parsed.data, mine: parsed.data.mine === 'true' };
}
export async function listThreads(request: NextRequest, user: AuthUser, courseId: string): Promise<Response> {
  if (!discussionReleased()) throw notFound();
  const { page, pageSize, mine, sort } = paging(request);
  return prisma.$transaction(async (tx): Promise<Response> => {
    const course = await scope(tx,user,courseId);
    const where = { courseId, ...visible, authorId: mine ? user.id : { not: null } };
    const [total, rows] = await Promise.all([tx.discussionThread.count({where}),tx.discussionThread.findMany({where,include:threadInclude,skip:(page-1)*pageSize,take:pageSize,orderBy:[{pinnedAt:{sort:'desc',nulls:'last'}},{createdAt:sort==='newest'?'desc':'asc'},{id:'asc'}]})]);
    return ok({ page,pageSize,total,discussionEnabled:course.discussionEnabled,items:rows.map((row):DiscussionThreadDto=>threadDto(row,user.id)) });
  });
}
export async function readThread(user: AuthUser,id: string): Promise<Response> {
  const courseId=await threadCourse(id);
  return prisma.$transaction(async(tx):Promise<Response>=>{await scope(tx,user,courseId);await parent(tx,id);return ok(threadDto(await tx.discussionThread.findUniqueOrThrow({where:{id},include:threadInclude}),user.id));});
}
export async function createThread(request: NextRequest,user: AuthUser,courseId: string): Promise<Response> {
  if (!discussionReleased()) throw notFound();const parsed=threadCreate.safeParse(await request.json().catch(():null=>null));if(!parsed.success)throw new ApiError(ErrorCode.VALIDATION_FAILED,'标题、纯文本正文或引用无效');const input=parsed.data,hash=digest(input);
  return prisma.$transaction(async(tx):Promise<Response>=>{
    const course=await scope(tx,user,courseId,true);if(!course.discussionEnabled)throw conflict();
    if(input.ref && ((input.ref.type==='video')!==(course.contentType==='VIDEO') || !isRefInRange(input.ref,course)))throw new ApiError(ErrorCode.REF_OUT_OF_RANGE,'引用不在当前共享课程范围内');
    const existing=await tx.discussionThread.findUnique({where:{authorId_courseId_createRequestId:{authorId:user.id,courseId,createRequestId:input.requestId}},include:threadInclude});
    if(existing){if(existing.requestDigest!==hash || existing.hiddenAt || existing.deletedAt)throw conflict();return ok(threadDto(existing,user.id));}
    await limit(user,courseId);
    const row=await tx.discussionThread.create({data:{id:randomUUID(),courseId,authorId:user.id,kind:input.kind==='question'?'QUESTION':'DISCUSSION',title:input.title,body:input.body,ref:input.ref??Prisma.DbNull,createRequestId:input.requestId,requestDigest:hash},include:threadInclude});
    await tx.auditLog.create({data:{actorId:user.id,objectId:row.id,action:'discussion.create',result:'success'}});return ok(threadDto(row,user.id));
  });
}
export async function changeThread(request: NextRequest,user: AuthUser,id: string,remove: boolean): Promise<Response> {
  if (!discussionReleased()) throw notFound();const parsed=(remove?deleteSchema:threadPatch).safeParse(await request.json().catch(():null=>null));if(!parsed.success)throw new ApiError(ErrorCode.VALIDATION_FAILED,'讨论版本或修改正文无效');const input=parsed.data,courseId=await threadCourse(id);
  return prisma.$transaction(async(tx):Promise<Response>=>{const course=await scope(tx,user,courseId,true),row=await parent(tx,id,true);if(row.authorId!==user.id)throw new ApiError(ErrorCode.FORBIDDEN,'仅作者可修改或删除');if(!remove&&!course.discussionEnabled)throw conflict();if(row.version!==input.expectedVersion)throw conflict();await limit(user,courseId);
    const patch=threadPatch.safeParse(input);const data:Prisma.DiscussionThreadUpdateManyMutationInput=remove?{deletedAt:new Date(),title:'',body:'',ref:Prisma.DbNull,version:{increment:1}}:patch.success?{title:patch.data.title,body:patch.data.body,...(patch.data.solved===undefined?{}:{solvedAt:patch.data.solved?new Date():null}),version:{increment:1}}:{};
    const changed=await tx.discussionThread.updateMany({where:{id,version:input.expectedVersion,...visible},data});if(changed.count!==1)throw conflict();await tx.auditLog.create({data:{actorId:user.id,objectId:id,action:remove?'discussion.delete':'discussion.update',result:'success'}});
    return remove?ok({id,deleted:true}):ok(threadDto(await tx.discussionThread.findUniqueOrThrow({where:{id},include:threadInclude}),user.id));});
}
export async function listReplies(request:NextRequest,user:AuthUser,threadId:string):Promise<Response>{if (!discussionReleased()) throw notFound();const{page,pageSize}=paging(request),courseId=await threadCourse(threadId);return prisma.$transaction(async(tx):Promise<Response>=>{const course=await scope(tx,user,courseId);await parent(tx,threadId);const where={threadId,hiddenAt:null};const[total,rows]=await Promise.all([tx.discussionReply.count({where}),tx.discussionReply.findMany({where,include:{author:{select:authorSelect}},skip:(page-1)*pageSize,take:pageSize,orderBy:[{createdAt:'asc'},{id:'asc'}]})]);return ok({page,pageSize,total,discussionEnabled:course.discussionEnabled,items:rows.map((row):DiscussionReplyDto=>replyDto(row,user.id))});});}
export async function createReply(request:NextRequest,user:AuthUser,threadId:string):Promise<Response>{if (!discussionReleased()) throw notFound();const parsed=replyCreate.safeParse(await request.json().catch(():null=>null));if(!parsed.success)throw new ApiError(ErrorCode.VALIDATION_FAILED,'请输入有效纯文本回复');const input=parsed.data,courseId=await threadCourse(threadId),hash=digest(input);return prisma.$transaction(async(tx):Promise<Response>=>{await courseAccount(user,false,tx,true);const candidate=await tx.discussionThread.findUnique({where:{id:threadId},select:{authorId:true}});if(candidate?.authorId&&candidate.authorId!==user.id)await tx.$queryRaw`SELECT id FROM "User" WHERE id=${candidate.authorId} FOR SHARE`;const course=await scope(tx,user,courseId,true);const topic=await parent(tx,threadId,true);if(!course.discussionEnabled)throw conflict();const previous=await tx.discussionReply.findUnique({where:{authorId_threadId_createRequestId:{authorId:user.id,threadId,createRequestId:input.requestId}},include:{author:{select:authorSelect}}});if(previous){if(previous.requestDigest!==hash||previous.hiddenAt||previous.deletedAt)throw conflict();return ok(replyDto(previous,user.id));}await limit(user,courseId);const row=await tx.discussionReply.create({data:{id:randomUUID(),threadId,authorId:user.id,body:input.body,createRequestId:input.requestId,requestDigest:hash},include:{author:{select:authorSelect}}});if(topic.authorId&&topic.authorId!==user.id)await emitNotification(tx,{recipientId:topic.authorId,kind:'REPLY',eventKey:'reply.created:'+row.id,courseId,threadId,replyId:row.id});await tx.auditLog.create({data:{actorId:user.id,objectId:row.id,action:'reply.create',result:'success'}});return ok(replyDto(row,user.id));});}
export async function changeReply(request:NextRequest,user:AuthUser,id:string,remove:boolean):Promise<Response>{if (!discussionReleased()) throw notFound();const parsed=(remove?deleteSchema:replyPatch).safeParse(await request.json().catch(():null=>null));if(!parsed.success)throw new ApiError(ErrorCode.VALIDATION_FAILED,'回复版本或正文无效');if(!discussionReleased())throw notFound();const found=await prisma.discussionReply.findUnique({where:{id},select:{threadId:true}});if(!found)throw notFound();const courseId=await threadCourse(found.threadId);return prisma.$transaction(async(tx):Promise<Response>=>{const course=await scope(tx,user,courseId,true);await parent(tx,found.threadId,true);const row=await tx.discussionReply.findFirst({where:{id,...visible}});if(!row)throw notFound();if(row.authorId!==user.id)throw new ApiError(ErrorCode.FORBIDDEN,'仅作者可修改或删除回复');if(!remove&&!course.discussionEnabled)throw conflict();if(row.version!==parsed.data.expectedVersion)throw conflict();await limit(user,courseId);const patch=replyPatch.safeParse(parsed.data);const result=await tx.discussionReply.updateMany({where:{id,version:row.version,...visible},data:remove?{body:'',deletedAt:new Date(),version:{increment:1}}:{body:patch.success?patch.data.body:row.body,version:{increment:1}}});if(result.count!==1)throw conflict();await tx.auditLog.create({data:{actorId:user.id,objectId:id,action:remove?'reply.delete':'reply.update',result:'success'}});return remove?ok({id,deleted:true}):ok(replyDto(await tx.discussionReply.findUniqueOrThrow({where:{id},include:{author:{select:authorSelect}}}),user.id));});}
