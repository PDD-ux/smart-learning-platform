import { createHash, randomBytes } from 'node:crypto';
import type { AssignmentSubmissionState } from '@prisma/client';
import { z } from 'zod';
import { ApiError } from '@/lib/auth/ownership';
import { ErrorCode } from '@/lib/api/errors';

export const CLASS_LIMITS = { fileBytes: 20 * 1024 * 1024, totalFileBytes: 50 * 1024 * 1024, files: 5, uploadHours: 24, inviteDays: 7, maxInviteDays: 30 } as const;
export const classTitleSchema = z.string().trim().min(1).max(100);
export const classBodySchema = z.string().max(20_000);
export const submissionBodySchema = z.string().max(50_000);
export const revisionSchema = z.number().int().min(1);
export const classOperationSchema = z.enum(['CREATE_CLASS', 'EDIT_CLASS', 'ARCHIVE_CLASS', 'INVITE', 'JOIN', 'MEMBER', 'CHAPTER', 'ASSIGNMENT', 'DRAFT', 'SUBMIT', 'REVIEW', 'ATTACHMENT']);
const idSchema = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/u);
const MIME_EXTENSIONS: Record<string, readonly string[]> = {
  'application/pdf': ['pdf'], 'text/plain': ['txt'], 'text/markdown': ['md'], 'image/png': ['png'], 'image/jpeg': ['jpg', 'jpeg'],
};
export const attachmentSchema = z.object({
  fileName: z.string().trim().min(1).max(180).refine((value) => !/[\\/\u0000-\u001f\u007f]/u.test(value)),
  mimeType: z.enum(['application/pdf', 'text/plain', 'text/markdown', 'image/png', 'image/jpeg']),
  sizeBytes: z.number().int().min(1).max(CLASS_LIMITS.fileBytes),
}).strict().superRefine((value, ctx): void => {
  const extension = value.fileName.split('.').at(-1)?.toLowerCase() ?? '';
  if (!value.fileName.includes('.') || !MIME_EXTENSIONS[value.mimeType].includes(extension)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: '附件扩展名与类型不一致' });
});

export const attachmentBatchSchema = z.array(attachmentSchema).max(CLASS_LIMITS.files).refine((files) => files.reduce((sum, file) => sum + file.sizeBytes, 0) <= CLASS_LIMITS.totalFileBytes, '附件总大小超限');

export function attachmentStorageKey(classroomId: string, studentId: string, attachmentId: string, mimeType: string): string {
  if (![classroomId, studentId, attachmentId].every((id) => idSchema.safeParse(id).success) || !Object.hasOwn(MIME_EXTENSIONS, mimeType)) throw new ApiError(ErrorCode.VALIDATION_FAILED, '附件归属或类型不合法');
  return `class-assignments/${classroomId}/${studentId}/${attachmentId}/source.${MIME_EXTENSIONS[mimeType][0]}`;
}

export function createInviteCode(): { code: string; codeHash: string } {
  const code = randomBytes(16).toString('base64url');
  return { code, codeHash: hashInviteCode(code) };
}

export function hashInviteCode(code: string): string {
  if (!/^[A-Za-z0-9_-]{22}$/u.test(code)) throw new ApiError(ErrorCode.VALIDATION_FAILED, '邀请码格式不合法');
  return createHash('sha256').update(code).digest('hex');
}

export function isInviteUsable(invite: { expiresAt: Date; revokedAt: Date | null; usedCount: number; maxUses: number }, classroomState: string, now: Date): boolean {
  return classroomState === 'ACTIVE' && invite.revokedAt === null && Number.isFinite(now.getTime()) && invite.expiresAt.getTime() > now.getTime()
    && Number.isInteger(invite.maxUses) && invite.maxUses >= 1 && invite.maxUses <= 5000 && Number.isInteger(invite.usedCount) && invite.usedCount >= 0 && invite.usedCount < invite.maxUses;
}

export function assertRevision(actual: number, expected: number): void {
  if (!revisionSchema.safeParse(expected).success || actual !== expected) throw new ApiError(ErrorCode.CLASSROOM_CONFLICT, '内容已更新，请重新读取后操作');
}

export function assertSubmissionTransition(current: AssignmentSubmissionState, next: AssignmentSubmissionState): void {
  const allowed: Record<AssignmentSubmissionState, readonly AssignmentSubmissionState[]> = { DRAFT: ['SUBMITTED'], SUBMITTED: ['RETURNED', 'GRADED'], RETURNED: ['SUBMITTED'], GRADED: [] };
  if (!allowed[current]?.includes(next)) throw new ApiError(ErrorCode.CLASSROOM_CONFLICT, '当前作业状态不允许此操作');
}

export function assertCanSubmit(input: { classroomState: string; memberState: string; assignmentState: string; chapterState: string | null; dueAt: Date | null }, now: Date): void {
  if (input.classroomState !== 'ACTIVE' || input.memberState !== 'ACTIVE' || input.assignmentState !== 'PUBLISHED' || (input.chapterState !== null && input.chapterState !== 'PUBLISHED') || !input.dueAt || !Number.isFinite(now.getTime()) || !(now.getTime() < input.dueAt.getTime())) throw new ApiError(ErrorCode.CLASSROOM_CONFLICT, '当前任务不可提交，请核对成员状态、发布状态和截止时间');
}

function canonicalJson(value: unknown, depth = 0): string {
  if (depth > 10) throw new ApiError(ErrorCode.VALIDATION_FAILED, '请求层级超限');
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) return JSON.stringify(value);
  if (Array.isArray(value) && value.length <= 1000) return `[${value.map((item: unknown) => canonicalJson(item, depth + 1)).join(',')}]`;
  if (typeof value === 'object' && value !== null && Object.getPrototypeOf(value) === Object.prototype) {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key], depth + 1)}`).join(',')}}`;
  }
  throw new ApiError(ErrorCode.VALIDATION_FAILED, '请求必须为有限JSON值');
}

/** 摘要覆盖动作和完整已校验输入；不持久化正文或邀请码。 */
export function classRequestDigest(action: z.infer<typeof classOperationSchema>, input: unknown): string {
  classOperationSchema.parse(action);
  const value = canonicalJson(input);
  if (Buffer.byteLength(value, 'utf8') > 256 * 1024) throw new ApiError(ErrorCode.VALIDATION_FAILED, '请求大小超限');
  return createHash('sha256').update(`${action}\n${value}`).digest('hex');
}
