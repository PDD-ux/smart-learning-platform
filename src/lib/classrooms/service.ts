import { Prisma, type PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { ApiError } from '@/lib/auth/ownership';
import { ErrorCode } from '@/lib/api/errors';
import { checkContent } from '@/lib/ai/content-guard';
import { recordAudit } from '@/lib/audit/audit-service';
import { requireClassroomAccess, requireClassroomManager } from './access';
import { assertRevision, classRequestDigest, createInviteCode, hashInviteCode, isInviteUsable } from './rules';
import { createClassSchema, joinClassSchema, classCommandSchema, type ClassCommand, type ClassResult, type ClassList, type ClassDetail, type ClassSources } from './contracts';

type Tx = Prisma.TransactionClient;
const summary = { id: true, title: true, description: true, state: true, revision: true } as const;
const sourceWhere = { state: 'PUBLISHED', rightsConfirmed: true, rightsStatement: { not: '' }, preparedAt: { not: null } } as const;
function conflict(message = '内容已变化，请重新读取后操作'): never { throw new ApiError(ErrorCode.CLASSROOM_CONFLICT, message); }
function invalid(message: string): never { throw new ApiError(ErrorCode.VALIDATION_FAILED, message); }
function missing(): never { throw new ApiError(ErrorCode.NOT_FOUND, '班级资源不存在或不可访问'); }
export function parse<T>(schema: { safeParse: (input: unknown) => { success: true; data: T } | { success: false } }, input: unknown): T {
  const result = schema.safeParse(input); if (!result.success) return invalid('班级请求字段不合法'); return result.data;
}
function guard(...values: string[]): void { if (values.some((value): boolean => !checkContent(value).safe)) invalid('内容未通过安全检查，请调整后再保存'); }
export async function account(tx: Tx, actorId: string, lock = false): Promise<{ role: string }> {
  if (lock) await tx.$queryRaw`SELECT id FROM "User" WHERE id=${actorId} FOR UPDATE`;
  const actor = await tx.user.findUnique({ where: { id: actorId }, select: { role: true } }); if (!actor) return missing(); return actor;
}
export async function lockClass(tx: Tx, id: string, write = true): Promise<void> {
  if (write) await tx.$queryRaw`SELECT id FROM "Classroom" WHERE id=${id} FOR UPDATE`;
  else await tx.$queryRaw`SELECT id FROM "Classroom" WHERE id=${id} FOR SHARE`;
}
export async function transaction<T>(db: PrismaClient, work: (tx: Tx) => Promise<T>): Promise<T> {
  try { return await db.$transaction(work, { maxWait: 10000, timeout: 15000 }); }
  catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError && ['P2002', 'P2003', 'P2034', 'P2025'].includes(error.code)) conflict('记录或顺序已变化，请重新读取后操作');
    throw new ApiError(ErrorCode.INTERNAL, '班级操作暂未完成，请保留输入并核对状态');
  }
}
export async function replay(tx: Tx, actorId: string, requestId: string, classroomId: string | null, action: string, inputDigest: string): Promise<ClassResult | null> {
  const old = await tx.classroomOperation.findUnique({ where: { actorId_requestId: { actorId, requestId } } });
  if (!old) return null;
  if ((classroomId !== null && old.classroomId !== classroomId) || old.action !== action || old.inputDigest !== inputDigest) conflict('该请求编号已用于其它操作');
  return { classroomId: old.classroomId, resultId: old.resultId, replayed: true };
}
export async function record(tx: Tx, actorId: string, requestId: string, classroomId: string, action: string, inputDigest: string, resultId: string): Promise<ClassResult> {
  await tx.classroomOperation.create({ data: { actorId, requestId, classroomId, action, inputDigest, resultId } });
  await recordAudit({ actorId, objectId: classroomId, action: 'classroom.' + action.toLowerCase() }, tx);
  return { classroomId, resultId, replayed: false };
}
async function capacity(tx: Tx, classroomId: string): Promise<void> {
  if (await tx.classMember.count({ where: { classroomId, state: 'ACTIVE' } }) >= 200) conflict('班级已达200名有效成员上限');
}
async function budget(tx: Tx, classroomId: string, replaceId: string | undefined, kind: 'chapter' | 'assignment', text: string): Promise<void> {
  const [chapters, tasks] = await Promise.all([
    tx.classChapter.findMany({ where: { classroomId }, select: { id: true, body: true } }),
    tx.classAssignment.findMany({ where: { classroomId }, select: { id: true, instructions: true } }),
  ]);
  if (!replaceId && (kind === 'chapter' ? chapters : tasks).length >= 100) conflict('每班章节和任务各最多100条');
  const size = chapters.reduce((n, c): number => n + (kind === 'chapter' && c.id === replaceId ? 0 : c.body.length), 0) + tasks.reduce((n, t): number => n + (kind === 'assignment' && t.id === replaceId ? 0 : t.instructions.length), 0) + text.length;
  if (size > 150000) invalid('班级章节与任务正文总量超过150000字符，请精简');
}
export async function createClass(actorId: string, raw: unknown, db: PrismaClient = prisma): Promise<ClassResult> {
  const input = parse(createClassSchema, raw); guard(input.title, input.description);
  const digest = classRequestDigest('CREATE_CLASS', input);
  return transaction(db, async (tx): Promise<ClassResult> => {
    if ((await account(tx, actorId, true)).role !== 'teacher') return missing();
    const old = await replay(tx, actorId, input.requestId, null, 'CREATE_CLASS', digest); if (old) { await requireClassroomManager(tx, actorId, old.classroomId, false); return old; }
    if (await tx.classroom.count({ where: { responsibleId: actorId } }) >= 20) conflict('每位负责人最多创建20个班级');
    const row = await tx.classroom.create({ data: { responsibleId: actorId, title: input.title, description: input.description } });
    return record(tx, actorId, input.requestId, row.id, 'CREATE_CLASS', digest, row.id);
  });
}
export async function joinClass(actorId: string, raw: unknown, db: PrismaClient = prisma): Promise<ClassResult> {
  const input = parse(joinClassSchema, raw), digest = classRequestDigest('JOIN', input);
  return transaction(db, async (tx): Promise<ClassResult> => {
    if ((await account(tx, actorId, true)).role !== 'student') return missing();
    const old = await replay(tx, actorId, input.requestId, null, 'JOIN', digest);
    if (old) { await lockClass(tx, old.classroomId); await requireClassroomAccess(tx, actorId, old.classroomId); return old; }
    const first = await tx.classInvite.findUnique({ where: { codeHash: hashInviteCode(input.code) }, select: { classroomId: true, id: true } });
    if (!first) invalid('邀请码无效或当前不可加入，请联系负责人');
    await lockClass(tx, first.classroomId);
    const invite = await tx.classInvite.findUnique({ where: { id: first.id } });
    const room = await tx.classroom.findUnique({ where: { id: first.classroomId } });
    if (!invite || !room || !isInviteUsable(invite, room.state, new Date())) invalid('邀请码无效或当前不可加入，请联系负责人');
    const key = { classroomId: room.id, studentId: actorId };
    const member = await tx.classMember.findUnique({ where: { classroomId_studentId: key } });
    if (member?.state === 'REMOVED') invalid('邀请码无效或当前不可加入，请联系负责人');
    if (member?.state !== 'ACTIVE') {
      if (!member && await tx.classMember.count({ where: { classroomId: room.id } }) >= 200) conflict('每班最多保留200名成员（含退出历史）');
      await capacity(tx, room.id);
      await tx.classMember.upsert({ where: { classroomId_studentId: key }, create: key, update: { state: 'ACTIVE', joinedAt: new Date(), revision: { increment: 1 } } });
      await tx.classInvite.update({ where: { id: invite.id }, data: { usedCount: { increment: 1 }, revision: { increment: 1 } } });
      await tx.classroom.update({ where: { id: room.id }, data: { revision: { increment: 1 } } });
    }
    return record(tx, actorId, input.requestId, room.id, 'JOIN', digest, actorId);
  });
}
const actions = { class: 'EDIT_CLASS', archive: 'ARCHIVE_CLASS', invite: 'INVITE', revoke: 'INVITE', member: 'MEMBER', leave: 'MEMBER', chapter: 'CHAPTER', assignment: 'ASSIGNMENT' } as const;
export async function commandClass(actorId: string, classroomId: string, raw: unknown, db: PrismaClient = prisma): Promise<ClassResult> {
  const input = parse(classCommandSchema, raw), action = actions[input.action];
  const digest = classRequestDigest(action, { classroomId, ...input });
  return transaction(db, async (tx): Promise<ClassResult> => {
    await account(tx, actorId, true); await lockClass(tx, classroomId);
    const scope = await requireClassroomAccess(tx, actorId, classroomId);
    if (input.action === 'leave' ? !scope.activeMember : !scope.responsible) return missing();
    const old = await replay(tx, actorId, input.requestId, classroomId, action, digest); if (old) return old;
    assertRevision(scope.classroom.revision, input.expectedRevision);
    if (scope.classroom.state !== 'ACTIVE' && !['archive', 'leave'].includes(input.action)) conflict('班级已归档，只能查看');
    let resultId = classroomId; let code: string | undefined;
    if (input.action === 'class') {
      guard(input.title, input.description); await tx.classroom.update({ where: { id: classroomId }, data: { title: input.title, description: input.description } });
    } else if (input.action === 'archive') {
      await tx.classroom.update({ where: { id: classroomId }, data: { state: input.state } });
      if (input.state === 'ARCHIVED') await tx.classInvite.updateMany({ where: { classroomId, revokedAt: null }, data: { revokedAt: new Date(), revision: { increment: 1 } } });
    } else if (input.action === 'invite') {
      if (await tx.classInvite.count({ where: { classroomId } }) >= 100) conflict('邀请码历史已达100条上限');
      await tx.classInvite.updateMany({ where: { classroomId, revokedAt: null }, data: { revokedAt: new Date(), revision: { increment: 1 } } });
      const generated = createInviteCode(); code = generated.code;
      const invite = await tx.classInvite.create({ data: { classroomId, codeHash: generated.codeHash, maxUses: input.maxUses, expiresAt: new Date(Date.now() + input.days * 86400000) } }); resultId = invite.id;
    } else if (input.action === 'revoke') {
      if (!(await tx.classInvite.updateMany({ where: { id: input.inviteId, classroomId }, data: { revokedAt: new Date(), revision: { increment: 1 } } })).count) return missing(); resultId = input.inviteId;
    } else if (input.action === 'member' || input.action === 'leave') {
      const studentId = input.action === 'leave' ? actorId : input.studentId;
      const member = await tx.classMember.findUnique({ where: { classroomId_studentId: { classroomId, studentId } } }); if (!member) return missing();
      if (input.action === 'member') {
        assertRevision(member.revision, input.memberRevision);
        if (input.state === 'ACTIVE') {
          if ((await tx.user.findUnique({ where: { id: studentId }, select: { role: true } }))?.role !== 'student') conflict('该账号当前不能作为学生成员');
          if (member.state !== 'ACTIVE') await capacity(tx, classroomId);
        }
      }
      await tx.classMember.update({ where: { classroomId_studentId: { classroomId, studentId } }, data: { state: input.action === 'leave' ? 'LEFT' : input.state, revision: { increment: 1 } } }); resultId = studentId;
    } else if (input.action === 'chapter') {
      guard(input.title, input.body); await budget(tx, classroomId, input.id, 'chapter', input.body);
      const current = input.id ? await tx.classChapter.findFirst({ where: { id: input.id, classroomId } }) : null;
      if (input.id && !current) return missing(); if (current) assertRevision(current.revision, input.entityRevision ?? 0);
      if ((input.state === 'PUBLISHED' || current?.state === 'PUBLISHED') && !input.publishConfirmed) invalid('发布或修改已发布章节需要明确确认');
      if (input.sharedCourseId) {
        await tx.$queryRaw`SELECT id FROM "SharedCourse" WHERE id=${input.sharedCourseId} FOR SHARE`;
        const source = await tx.sharedCourse.findFirst({ where: { id: input.sharedCourseId, ...sourceWhere }, select: { rightsStatement: true } });
        if (!source || !source.rightsStatement.trim()) invalid('只能绑定当前已发布、已准备且明确授权的共享课程');
      }
      const data = { title: input.title, body: input.body, sequence: input.sequence, state: input.state, sharedCourseId: input.sharedCourseId };
      const row = current ? await tx.classChapter.update({ where: { id: current.id }, data: { ...data, revision: { increment: 1 } } }) : await tx.classChapter.create({ data: { ...data, classroomId } }); resultId = row.id;
    } else {
      guard(input.title, input.instructions); await budget(tx, classroomId, input.id, 'assignment', input.instructions);
      const current = input.id ? await tx.classAssignment.findFirst({ where: { id: input.id, classroomId } }) : null;
      if (input.id && !current) return missing(); if (current) assertRevision(current.revision, input.entityRevision ?? 0);
      if ((input.state === 'PUBLISHED' || current?.state === 'PUBLISHED' || current?.state === 'CLOSED') && !input.publishConfirmed) invalid('发布或修改已发布任务需要明确确认');
      if (input.chapterId && !await tx.classChapter.findFirst({ where: { id: input.chapterId, classroomId }, select: { id: true } })) return missing();
      const dueAt = input.dueAt ? new Date(input.dueAt) : null;
      if (['PUBLISHED', 'CLOSED'].includes(input.state) && !dueAt) invalid('发布或关闭任务必须有截止时间');
      if (input.state === 'PUBLISHED' && dueAt && dueAt.getTime() <= Date.now()) invalid('发布任务的截止时间必须在未来；过期任务可明确关闭');
      const data = { title: input.title, instructions: input.instructions, chapterId: input.chapterId, state: input.state, dueAt };
      const row = current ? await tx.classAssignment.update({ where: { id: current.id }, data: { ...data, revision: { increment: 1 } } }) : await tx.classAssignment.create({ data: { ...data, classroomId } }); resultId = row.id;
    }
    await tx.classroom.update({ where: { id: classroomId }, data: { revision: { increment: 1 } } });
    return { ...await record(tx, actorId, input.requestId, classroomId, action, digest, resultId), ...(code ? { code } : {}) };
  });
}
export async function listClasses(actorId: string, page: number, db: PrismaClient = prisma): Promise<ClassList> {
  return transaction(db, async (tx): Promise<ClassList> => {
    const actor = await account(tx, actorId);
    if (!['admin', 'teacher', 'student'].includes(actor.role)) return missing();
    const items = await tx.classroom.findMany({ where: actor.role === 'admin' || actor.role === 'teacher' ? { responsibleId: actorId } : { members: { some: { studentId: actorId, state: 'ACTIVE' } } }, select: summary, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], skip: (page - 1) * 20, take: 21 });
    return { canCreate: actor.role === 'teacher', items: items.slice(0, 20), page, hasMore: items.length > 20 };
  });
}
export async function readClass(actorId: string, id: string, db: PrismaClient = prisma): Promise<ClassDetail> {
  return transaction(db, async (tx): Promise<ClassDetail> => {
    // Identity lock precedes class lock consistently with writes; withdrawal cannot race this DTO.
    await tx.$queryRaw`SELECT id FROM "User" WHERE id=${actorId} FOR SHARE`; await lockClass(tx, id, false);
    const scope = await requireClassroomAccess(tx, actorId, id), manager = scope.responsible;
    const chapters = await tx.classChapter.findMany({ where: { classroomId: id, ...(manager ? {} : { state: 'PUBLISHED' }) }, orderBy: [{ sequence: 'asc' }, { id: 'asc' }], take: 100, select: { id: true, title: true, body: true, sequence: true, state: true, revision: true, sharedCourseId: true, sharedCourse: { select: { state: true, rightsConfirmed: true, rightsStatement: true, preparedAt: true } } } });
    const tasks = await tx.classAssignment.findMany({ where: { classroomId: id, ...(manager ? {} : { state: { in: ['PUBLISHED', 'CLOSED'] }, OR: [{ chapterId: null }, { chapter: { state: 'PUBLISHED' } }] }) }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: 100, select: { id: true, chapterId: true, title: true, instructions: true, state: true, dueAt: true, revision: true } });
    const members = manager ? await tx.classMember.findMany({ where: { classroomId: id }, take: 201, orderBy: { joinedAt: 'desc' }, select: { studentId: true, state: true, revision: true, student: { select: { nickname: true } } } }) : [];
    const invites = manager ? await tx.classInvite.findMany({ where: { classroomId: id }, take: 100, orderBy: { createdAt: 'desc' }, select: { id: true, expiresAt: true, maxUses: true, usedCount: true, revokedAt: true } }) : [];
    const { responsibleId: _owner, ...classroom } = scope.classroom;
    return { classroom, canManage: manager, memberCount: await tx.classMember.count({ where: { classroomId: id, state: 'ACTIVE' } }), chapters: chapters.map(({ sharedCourse, sharedCourseId, ...row }): ClassDetail['chapters'][number] => { const sourceAvailable = sharedCourse?.state === 'PUBLISHED' && sharedCourse.rightsConfirmed && !!sharedCourse.rightsStatement.trim() && sharedCourse.preparedAt !== null; return { ...row, sharedCourseId: sourceAvailable ? sharedCourseId : null, sourceAvailable }; }), assignments: tasks.map((row): ClassDetail['assignments'][number] => ({ ...row, dueAt: row.dueAt?.toISOString() ?? null })), members: members.map(({ student, ...row }): ClassDetail['members'][number] => ({ ...row, nickname: student.nickname })), invites: invites.map((row): ClassDetail['invites'][number] => ({ ...row, expiresAt: row.expiresAt.toISOString(), revokedAt: row.revokedAt?.toISOString() ?? null })) };
  });
}
export async function classSources(actorId: string, id: string, page: number, db: PrismaClient = prisma): Promise<ClassSources> {
  return transaction(db, async (tx): Promise<ClassSources> => {
    await requireClassroomManager(tx, actorId, id, false);
    const items = await tx.sharedCourse.findMany({ where: sourceWhere, select: { id: true, title: true, rightsStatement: true }, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], skip: (page - 1) * 50, take: 51 });
    return { items: items.slice(0, 50).filter((row): boolean => row.rightsStatement.trim().length > 0).map(({ id: sourceId, title }): ClassSources['items'][number] => ({ id: sourceId, title })), page, hasMore: items.length > 50 };
  });
}



