import type { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { ApiError } from '@/lib/auth/ownership';
import { ErrorCode } from '@/lib/api/errors';
import { requireClassroomAccess, requireClassroomManager, readClassAssignment, readAssignmentSubmission, authorizeAssignmentReview } from './access';
import { account, lockClass, transaction, parse, replay, record } from './service';
import { assertRevision, assertCanSubmit, classRequestDigest } from './rules';
import { assignmentCommandSchema, reviewSchema, type AssignmentResult, type AssignmentView, type SubmissionDetail, type SubmissionHistory } from './assignment-contracts';
type Tx = Prisma.TransactionClient;
export function assignmentConflict(message: string): never { throw new ApiError(ErrorCode.CLASSROOM_CONFLICT, message); }
export function assignmentMissing(): never { throw new ApiError(ErrorCode.NOT_FOUND, '作业不存在或不可访问'); }
export async function assignmentScope(tx: Tx, actorId: string, assignmentId: string, write = false): Promise<{ task: Awaited<ReturnType<typeof readClassAssignment>>; scope: Awaited<ReturnType<typeof requireClassroomAccess>> }> {
 const identity = await tx.classAssignment.findUnique({ where: { id: assignmentId }, select: { classroomId: true } }); if (!identity) return assignmentMissing();
 await account(tx, actorId, true); await lockClass(tx, identity.classroomId);
 const scope = await requireClassroomAccess(tx, actorId, identity.classroomId, write);
 const task = await readClassAssignment(tx, actorId, assignmentId); return { task, scope };
}
export async function lockSubmission(tx: Tx, id: string): Promise<void> { await tx.$queryRaw`SELECT id FROM "AssignmentSubmission" WHERE id=${id} FOR UPDATE`; }
export async function writableSubmission(tx: Tx, actorId: string, id: string): Promise<Prisma.AssignmentSubmissionGetPayload<Record<string, never>>> {
 const row = await tx.assignmentSubmission.findUnique({ where: { id }, select: { assignmentId: true, studentId: true } }); if (!row || row.studentId !== actorId) return assignmentMissing();
 const { scope } = await assignmentScope(tx, actorId, row.assignmentId, true); if (!scope.activeMember || scope.responsible) return assignmentMissing();
 await lockSubmission(tx, id);
 const fresh = await tx.assignmentSubmission.findUniqueOrThrow({ where: { id } });
 if (!['DRAFT', 'RETURNED'].includes(fresh.state)) assignmentConflict('仅未提交或退回修改的草稿可编辑'); return fresh;
}
export async function submissionDetail(tx: Tx, actorId: string, id: string): Promise<SubmissionDetail> {
 const identity = await tx.assignmentSubmission.findUnique({ where: { id }, select: { classroomId: true, assignmentId: true } }); if (!identity) return assignmentMissing();
 await account(tx, actorId, true); await lockClass(tx, identity.classroomId);
 const result = await readAssignmentSubmission(tx, actorId, id);
 const room = await tx.classroom.findUniqueOrThrow({ where: { id: result.classroomId }, select: { title: true, state: true, responsibleId: true } });
 const role = (await account(tx, actorId)).role;
 let canEditDraft = false;
 if (actorId === result.studentId && role === 'student' && 'draftText' in result) {
  try { await readClassAssignment(tx, actorId, identity.assignmentId); canEditDraft = room.state === 'ACTIVE'; } catch (reason) { if (!(reason instanceof ApiError)) throw reason; }
 }
 const attachments = canEditDraft ? await tx.assignmentAttachment.findMany({ where: { submissionId: id, versionId: null, state: { in: ['UPLOADING', 'READY'] }, expiresAt: { gt: new Date() } }, take: 5, orderBy: { createdAt: 'asc' }, select: { id: true, fileName: true, mimeType: true, sizeBytes: true, state: true, expiresAt: true } }) : [];
 return { ...result, classroomTitle: room.title, canEditDraft, canReview: (role === 'admin' || role === 'teacher') && room.responsibleId === actorId && room.state === 'ACTIVE' && result.state === 'SUBMITTED' && !!result.versions[0] && result.versions[0].review === null, draftAttachments: attachments.map((file): SubmissionDetail['draftAttachments'][number] => ({ ...file, sizeBytes: Number(file.sizeBytes), state: file.state as 'UPLOADING' | 'READY', expiresAt: file.expiresAt.toISOString() })) };
}
export async function readSubmission(actorId: string, id: string, db: PrismaClient = prisma): Promise<SubmissionDetail> { return transaction(db, (tx): Promise<SubmissionDetail> => submissionDetail(tx, actorId, id)); }
export async function assignmentView(actorId: string, id: string, page = 1, db: PrismaClient = prisma): Promise<AssignmentView> {
 return transaction(db, async (tx): Promise<AssignmentView> => {
  const { task, scope } = await assignmentScope(tx, actorId, id);
  const base = { assignment: task, classroomTitle: scope.classroom.title, classroomState: scope.classroom.state, canManage: scope.responsible };
  if (!scope.responsible) {
   const own = await tx.assignmentSubmission.findUnique({ where: { assignmentId_studentId: { assignmentId: id, studentId: actorId } }, select: { id: true, state: true } });
   const canEditDraft = scope.classroom.state === 'ACTIVE' && (!own || ['DRAFT', 'RETURNED'].includes(own.state));
   return { ...base, canEditDraft, canSubmit: canEditDraft && task.state === 'PUBLISHED' && !!task.dueAt && Date.parse(task.dueAt) > Date.now(), submission: own ? await submissionDetail(tx, actorId, own.id) : null, board: null };
  }
  const members = await tx.classMember.findMany({ where: { classroomId: task.classroomId }, take: 200, orderBy: [{ joinedAt: 'asc' }, { studentId: 'asc' }], select: { studentId: true, state: true, student: { select: { nickname: true } }, submissions: { where: { assignmentId: id, versions: { some: {} } }, select: { id: true, state: true, revision: true, versions: { orderBy: { versionNo: 'desc' }, take: 1, select: { versionNo: true, submittedAt: true } } } } } });
  const submitted = members.filter((m): boolean => m.submissions.length > 0);
  const rows = members.slice((page - 1) * 20, page * 20).map((member): NonNullable<AssignmentView['board']>['rows'][number] => { const s = member.submissions[0]; return { studentId: member.studentId, nickname: member.student.nickname, memberState: member.state, submission: s ? { id: s.id, state: s.state, revision: s.revision, versionNo: s.versions[0].versionNo, submittedAt: s.versions[0].submittedAt.toISOString() } : null }; });
  return { ...base, canEditDraft: false, canSubmit: false, submission: null, board: { page, hasMore: members.length > page * 20, activeMembers: members.filter((m): boolean => m.state === 'ACTIVE').length, submittedStudents: submitted.length, pending: submitted.filter((m): boolean => m.submissions[0].state === 'SUBMITTED').length, returned: submitted.filter((m): boolean => m.submissions[0].state === 'RETURNED').length, graded: submitted.filter((m): boolean => m.submissions[0].state === 'GRADED').length, neverSubmittedActive: members.filter((m): boolean => m.state === 'ACTIVE' && !m.submissions.length).length, rows } };
 });
}
export async function assignmentCommand(actorId: string, id: string, raw: unknown, db: PrismaClient = prisma): Promise<AssignmentResult> {
 const input = parse(assignmentCommandSchema, raw), action = input.action === 'draft' ? 'DRAFT' : 'SUBMIT';
 const digest = classRequestDigest(action, { assignmentId: id, ...input });
 return transaction(db, async (tx): Promise<AssignmentResult> => {
  const { task, scope } = await assignmentScope(tx, actorId, id, true); if (!scope.activeMember || scope.responsible) return assignmentMissing();
  let row = await tx.assignmentSubmission.findUnique({ where: { assignmentId_studentId: { assignmentId: id, studentId: actorId } } });
  const old = await replay(tx, actorId, input.requestId, task.classroomId, action, digest); if (old && row) return { submissionId: row.id, resultId: old.resultId, replayed: true };
  if (row) await lockSubmission(tx, row.id);
  if (!row && input.action === 'draft') { assertRevision(1, input.expectedRevision + 1); row = await tx.assignmentSubmission.create({ data: { classroomId: task.classroomId, assignmentId: id, studentId: actorId, draftText: input.bodyText } }); }
  else {
   if (!row) return assignmentMissing(); assertRevision(row.revision, input.expectedRevision);
   if (!['DRAFT', 'RETURNED'].includes(row.state)) assignmentConflict('当前版本已提交或已批阅，不能覆盖');
   if (input.action === 'draft') row = await tx.assignmentSubmission.update({ where: { id: row.id }, data: { draftText: input.bodyText, revision: { increment: 1 } } });
   else {
    assertRevision(task.revision, input.assignmentRevision);
    assertCanSubmit({ classroomState: scope.classroom.state, memberState: 'ACTIVE', assignmentState: task.state, chapterState: task.chapterId ? 'PUBLISHED' : null, dueAt: task.dueAt ? new Date(task.dueAt) : null }, new Date());
    const files = await tx.assignmentAttachment.findMany({ where: { submissionId: row.id, versionId: null, state: { in: ['READY', 'UPLOADING'] }, expiresAt: { gt: new Date() } }, orderBy: { id: 'asc' } });
    if (files.some((f): boolean => f.state === 'UPLOADING') || files.some((f): boolean => f.expiresAt <= new Date()) || files.length !== input.attachmentIds.length || files.some((f): boolean => !input.attachmentIds.includes(f.id))) assignmentConflict('附件尚未完成、已过期或已变化，请移除无效附件并重新核对');
    if (!row.draftText.trim() && !files.length) throw new ApiError(ErrorCode.VALIDATION_FAILED, '请保存正文或上传至少一个有效附件');
    const latest = await tx.submissionVersion.findFirst({ where: { submissionId: row.id }, orderBy: { versionNo: 'desc' }, select: { versionNo: true } }); if ((latest?.versionNo ?? 0) >= 50) assignmentConflict('已达50个正式版本上限');
    const submittedAt = new Date();
    assertCanSubmit({ classroomState: scope.classroom.state, memberState: 'ACTIVE', assignmentState: task.state, chapterState: task.chapterId ? 'PUBLISHED' : null, dueAt: task.dueAt ? new Date(task.dueAt) : null }, submittedAt);
    if (files.some((f): boolean => f.expiresAt <= submittedAt)) assignmentConflict('附件已过期，请重新上传后提交');
    const version = await tx.submissionVersion.create({ data: { submissionId: row.id, classroomId: task.classroomId, studentId: actorId, versionNo: (latest?.versionNo ?? 0) + 1, bodyText: row.draftText, assignmentTitle: task.title, instructionsSnapshot: task.instructions, dueAtSnapshot: new Date(task.dueAt!), assignmentRevision: task.revision, submittedAt } });
    for (const file of files) await tx.assignmentAttachment.update({ where: { id: file.id }, data: { state: 'ATTACHED', versionId: version.id } });
    row = await tx.assignmentSubmission.update({ where: { id: row.id }, data: { state: 'SUBMITTED', draftText: '', revision: { increment: 1 } } });
    const result = await record(tx, actorId, input.requestId, task.classroomId, action, digest, version.id); return { submissionId: row.id, resultId: result.resultId, replayed: false };
   }
  }
  const result = await record(tx, actorId, input.requestId, task.classroomId, action, digest, row.id); return { submissionId: row.id, resultId: result.resultId, replayed: false };
 });
}
export async function reviewSubmission(actorId: string, id: string, raw: unknown, db: PrismaClient = prisma): Promise<AssignmentResult> {
 const input = parse(reviewSchema, raw), digest = classRequestDigest('REVIEW', { submissionId: id, ...input });
 return transaction(db, async (tx): Promise<AssignmentResult> => {
  const row = await tx.assignmentSubmission.findUnique({ where: { id }, select: { classroomId: true } }); if (!row) return assignmentMissing();
  await account(tx, actorId, true); await lockClass(tx, row.classroomId); await requireClassroomManager(tx, actorId, row.classroomId);
  await lockSubmission(tx, id); const old = await replay(tx, actorId, input.requestId, row.classroomId, 'REVIEW', digest); if (old) return { submissionId: id, resultId: old.resultId, replayed: true };
  const access = await authorizeAssignmentReview(tx, actorId, input.versionId); if (access.submissionId !== id) return assignmentMissing(); assertRevision(access.revision, input.expectedRevision);
  const review = await tx.assignmentReview.create({ data: { versionId: input.versionId, classroomId: row.classroomId, reviewerId: actorId, state: input.state, score: input.score, feedback: input.feedback } });
  const latest = await tx.submissionVersion.findUniqueOrThrow({ where: { id: input.versionId }, select: { bodyText: true } });
  await tx.assignmentSubmission.update({ where: { id }, data: { state: input.state, draftText: input.state === 'RETURNED' ? latest.bodyText : '', revision: { increment: 1 } } });
  await record(tx, actorId, input.requestId, row.classroomId, 'REVIEW', digest, review.id); return { submissionId: id, resultId: review.id, replayed: false };
 });
}
export async function submissionHistory(actorId: string, page = 1, db: PrismaClient = prisma): Promise<SubmissionHistory> {
 return transaction(db, async (tx): Promise<SubmissionHistory> => {
  if ((await account(tx, actorId)).role !== 'student') return assignmentMissing();
  const rows = await tx.assignmentSubmission.findMany({ where: { studentId: actorId, versions: { some: {} } }, orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }], skip: (page - 1) * 20, take: 21, select: { id: true, state: true, versions: { orderBy: { versionNo: 'desc' }, take: 1, select: { assignmentTitle: true, submittedAt: true, versionNo: true } } } });
  return { page, hasMore: rows.length > 20, items: rows.slice(0, 20).map((row): SubmissionHistory['items'][number] => ({ id: row.id, state: row.state, title: row.versions[0].assignmentTitle, submittedAt: row.versions[0].submittedAt.toISOString(), versionNo: row.versions[0].versionNo })) };
 });
}


