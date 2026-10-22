import type { Prisma } from '@prisma/client';
import { ApiError } from '@/lib/auth/ownership';
import { ErrorCode } from '@/lib/api/errors';
import { attachmentSchema, attachmentStorageKey } from './rules';

export type ClassroomDb = Pick<Prisma.TransactionClient, 'user' | 'classroom' | 'classMember' | 'classChapter' | 'classAssignment' | 'assignmentSubmission' | 'submissionVersion' | 'assignmentAttachment'>;
const classroomSelect = { id: true, responsibleId: true, title: true, description: true, state: true, revision: true } as const;
type ClassroomView = Prisma.ClassroomGetPayload<{ select: typeof classroomSelect }>;
type Scope = { classroom: ClassroomView; responsible: boolean; student: boolean; activeMember: boolean };
function inaccessible(): never { throw new ApiError(ErrorCode.NOT_FOUND, '班级资源不存在或不可访问'); }

async function loadScope(db: ClassroomDb, actorId: string, classroomId: string): Promise<Scope> {
  const [actor, classroom] = await Promise.all([
    db.user.findUnique({ where: { id: actorId }, select: { role: true } }),
    db.classroom.findUnique({ where: { id: classroomId }, select: classroomSelect }),
  ]);
  if (!actor || !classroom) return inaccessible();
  const student = actor.role === 'student';
  const member = student ? await db.classMember.findUnique({ where: { classroomId_studentId: { classroomId, studentId: actorId } }, select: { state: true } }) : null;
  return { classroom, responsible: (actor.role === 'teacher' || actor.role === 'admin') && classroom.responsibleId === actorId, student, activeMember: student && member?.state === 'ACTIVE' };
}

export async function requireClassroomAccess(db: ClassroomDb, actorId: string, classroomId: string, write = false): Promise<Scope> {
  const scope = await loadScope(db, actorId, classroomId);
  if (!scope.responsible && !scope.activeMember) return inaccessible();
  if (write && scope.classroom.state !== 'ACTIVE') throw new ApiError(ErrorCode.CLASSROOM_CONFLICT, '班级已归档，只能查看');
  return scope;
}

export async function readClassroom(db: ClassroomDb, actorId: string, classroomId: string): Promise<ClassroomView> {
  return (await requireClassroomAccess(db, actorId, classroomId)).classroom;
}

export async function requireClassroomManager(db: ClassroomDb, actorId: string, classroomId: string, write = true): Promise<ClassroomView> {
  const scope = await requireClassroomAccess(db, actorId, classroomId, write);
  if (!scope.responsible) return inaccessible();
  return scope.classroom;
}

export async function readClassChapter(db: ClassroomDb, actorId: string, id: string): Promise<{ id: string; classroomId: string; title: string; body: string; sequence: number; state: string; revision: number; sharedCourseId: string | null; sourceAvailable: boolean }> {
  const chapter = await db.classChapter.findUnique({ where: { id }, select: { id: true, classroomId: true, title: true, body: true, sequence: true, state: true, revision: true, sharedCourseId: true, sharedCourse: { select: { state: true, rightsConfirmed: true, rightsStatement: true, preparedAt: true } } } });
  if (!chapter) return inaccessible();
  const scope = await requireClassroomAccess(db, actorId, chapter.classroomId);
  if (!scope.responsible && chapter.state !== 'PUBLISHED') return inaccessible();
  const sourceAvailable = chapter.sharedCourse?.state === 'PUBLISHED' && chapter.sharedCourse.rightsConfirmed && chapter.sharedCourse.preparedAt !== null && chapter.sharedCourse.rightsStatement.trim().length > 0;
  const { sharedCourse: _source, sharedCourseId, ...view } = chapter;
  return { ...view, sharedCourseId: sourceAvailable ? sharedCourseId : null, sourceAvailable };
}

export async function readClassAssignment(db: ClassroomDb, actorId: string, id: string): Promise<{ id: string; classroomId: string; chapterId: string | null; title: string; instructions: string; state: string; dueAt: string | null; revision: number }> {
  const assignment = await db.classAssignment.findUnique({ where: { id }, select: { id: true, classroomId: true, chapterId: true, title: true, instructions: true, state: true, dueAt: true, revision: true, chapter: { select: { state: true } } } });
  if (!assignment) return inaccessible();
  const scope = await requireClassroomAccess(db, actorId, assignment.classroomId);
  if (!scope.responsible && (!['PUBLISHED', 'CLOSED'].includes(assignment.state) || (assignment.chapter && assignment.chapter.state !== 'PUBLISHED'))) return inaccessible();
  const { chapter: _chapter, dueAt, ...view } = assignment;
  return { ...view, dueAt: dueAt?.toISOString() ?? null };
}

const submissionSelect = { id: true, classroomId: true, assignmentId: true, studentId: true, state: true, revision: true } as const;
type SubmissionIdentity = Prisma.AssignmentSubmissionGetPayload<{ select: typeof submissionSelect }>;
async function submissionAccess(db: ClassroomDb, actorId: string, id: string): Promise<{ identity: SubmissionIdentity; scope: Scope; own: boolean; canReadDraft: boolean }> {
  const identity = await db.assignmentSubmission.findUnique({ where: { id }, select: submissionSelect });
  if (!identity) return inaccessible();
  const scope = await loadScope(db, actorId, identity.classroomId);
  const own = scope.student && identity.studentId === actorId;
  if (!scope.responsible && !own) return inaccessible();
  return { identity, scope, own, canReadDraft: own && scope.activeMember && scope.classroom.state === 'ACTIVE' && ['DRAFT', 'RETURNED'].includes(identity.state) };
}

export type SubmissionView = SubmissionIdentity & {
  draftText?: string; historyTruncated: boolean;
  versions: Array<{ id: string; versionNo: number; bodyText: string; assignmentTitle: string; instructionsSnapshot: string; dueAtSnapshot: string; assignmentRevision: number; submittedAt: string; review: { state: string; score: number | null; feedback: string; reviewerId: string; createdAt: string } | null; attachments: Array<{ id: string; fileName: string; mimeType: string; sizeBytes: number }> }>;
};
export async function readAssignmentSubmission(db: ClassroomDb, actorId: string, id: string): Promise<SubmissionView> {
  const access = await submissionAccess(db, actorId, id);
  const versions = await db.submissionVersion.findMany({ where: { submissionId: id }, orderBy: { versionNo: 'desc' }, take: 51, select: {
    id: true, versionNo: true, bodyText: true, assignmentTitle: true, instructionsSnapshot: true, dueAtSnapshot: true, assignmentRevision: true, submittedAt: true,
    review: { select: { state: true, score: true, feedback: true, reviewerId: true, createdAt: true } },
    attachments: { where: { state: 'ATTACHED' }, take: 5, select: { id: true, fileName: true, mimeType: true, sizeBytes: true } },
  } });
  if (!access.canReadDraft && !versions.length) return inaccessible();
  // 负责人分支从不读取draftText，避免以隐藏字段代替数据最小化。
  const draft = access.canReadDraft ? await db.assignmentSubmission.findUnique({ where: { id }, select: { draftText: true } }) : null;
  return { ...access.identity, ...(draft ? { draftText: draft.draftText } : {}), historyTruncated: versions.length > 50, versions: versions.slice(0, 50).map((version) => ({
    ...version, dueAtSnapshot: version.dueAtSnapshot.toISOString(), submittedAt: version.submittedAt.toISOString(),
    review: version.review ? { ...version.review, createdAt: version.review.createdAt.toISOString() } : null,
    attachments: version.attachments.map((attachment) => ({ ...attachment, sizeBytes: Number(attachment.sizeBytes) })),
  })) };
}

/** 后续批阅写事务内调用，随后仍须CAS；这里不写评语或成绩。 */
export async function authorizeAssignmentReview(db: ClassroomDb, actorId: string, versionId: string): Promise<{ versionId: string; submissionId: string; classroomId: string; revision: number }> {
  const version = await db.submissionVersion.findUnique({ where: { id: versionId }, select: { id: true, classroomId: true, submissionId: true, review: { select: { id: true } } } });
  if (!version) return inaccessible();
  await requireClassroomManager(db, actorId, version.classroomId);
  const submission = await db.assignmentSubmission.findUnique({ where: { id: version.submissionId }, select: { state: true, revision: true } });
  const latest = await db.submissionVersion.findFirst({ where: { submissionId: version.submissionId }, orderBy: { versionNo: 'desc' }, select: { id: true } });
  if (submission?.state !== 'SUBMITTED' || latest?.id !== versionId || version.review) throw new ApiError(ErrorCode.CLASSROOM_CONFLICT, '仅可批阅当前尚未批阅的待批阅版本');
  return { versionId, submissionId: version.submissionId, classroomId: version.classroomId, revision: submission.revision };
}

/** 仅供后续服务端签名下载使用；不把对象键混入公开提交DTO。 */
export async function authorizeAssignmentAttachment(db: ClassroomDb, actorId: string, id: string, now = new Date()): Promise<{ storageKey: string; fileName: string; mimeType: string; sizeBytes: number }> {
  const attachment = await db.assignmentAttachment.findUnique({ where: { id }, select: { id: true, submissionId: true, classroomId: true, studentId: true, versionId: true, state: true, fileName: true, mimeType: true, sizeBytes: true, sha256: true, storageKey: true, expiresAt: true } });
  if (!attachment) return inaccessible();
  const access = await submissionAccess(db, actorId, attachment.submissionId);
  const frozen = attachment.state === 'ATTACHED' && attachment.versionId !== null;
  if (!frozen && !(attachment.state === 'READY' && access.canReadDraft && attachment.expiresAt > now)) return inaccessible();
  const metadata = attachmentSchema.safeParse({ fileName: attachment.fileName, mimeType: attachment.mimeType, sizeBytes: Number(attachment.sizeBytes) });
  if (!metadata.success || !attachment.sha256 || !/^[a-f0-9]{64}$/u.test(attachment.sha256) || attachment.storageKey !== attachmentStorageKey(attachment.classroomId, attachment.studentId, attachment.id, attachment.mimeType)) return inaccessible();
  return { storageKey: attachment.storageKey, ...metadata.data };
}
