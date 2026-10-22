import { z } from 'zod';
import type { SubmissionView } from './access';
import { classId } from './contracts';
import { revisionSchema, submissionBodySchema, attachmentSchema } from './rules';
const request = { requestId: z.string().uuid() };
export const assignmentCommandSchema = z.discriminatedUnion('action', [
 z.object({ ...request, action: z.literal('draft'), expectedRevision: z.number().int().min(0), bodyText: submissionBodySchema }).strict(),
 z.object({ ...request, action: z.literal('submit'), expectedRevision: revisionSchema, assignmentRevision: revisionSchema, attachmentIds: z.array(classId).max(5).refine((ids): boolean => new Set(ids).size === ids.length), confirmed: z.literal(true) }).strict(),
]);
export const reviewSchema = z.object({ ...request, action: z.literal('review'), expectedRevision: revisionSchema, versionId: classId, state: z.enum(['RETURNED', 'GRADED']), score: z.number().int().min(0).max(100).nullable(), feedback: z.string().trim().min(1).max(10000), confirmed: z.literal(true) }).strict().refine((value): boolean => value.state === 'RETURNED' ? value.score === null : value.score !== null, '退回不得评分，批阅必须给分');
export const attachmentIntentSchema = attachmentSchema.innerType().extend({ ...request, expectedRevision: revisionSchema }).strict().superRefine((value, context): void => { const result = attachmentSchema.safeParse({ fileName: value.fileName, mimeType: value.mimeType, sizeBytes: value.sizeBytes }); if (!result.success) context.addIssue({ code: z.ZodIssueCode.custom, message: '附件名称/格式/大小不合法' }); });
export const removeAttachmentSchema = z.object({ ...request, action: z.literal('remove'), expectedRevision: revisionSchema }).strict();
export type AssignmentCommand = z.infer<typeof assignmentCommandSchema>;
export type ReviewCommand = z.infer<typeof reviewSchema>;
export type AttachmentIntent = z.infer<typeof attachmentIntentSchema>;
export type AttachmentRemove = z.infer<typeof removeAttachmentSchema>;
export type AssignmentResult = { submissionId: string; resultId: string; replayed: boolean };
export type DraftAttachment = { id: string; fileName: string; mimeType: string; sizeBytes: number; state: 'UPLOADING' | 'READY'; expiresAt: string };
export type SubmissionDetail = SubmissionView & { classroomTitle: string; canReview: boolean; canEditDraft: boolean; draftAttachments: DraftAttachment[] };
export type AssignmentView = { assignment: { id: string; classroomId: string; title: string; instructions: string; state: string; dueAt: string | null; revision: number }; classroomTitle: string; classroomState: string; canManage: boolean; canEditDraft: boolean; canSubmit: boolean; submission: SubmissionDetail | null; board: { page: number; hasMore: boolean; activeMembers: number; submittedStudents: number; pending: number; returned: number; graded: number; neverSubmittedActive: number; rows: Array<{ studentId: string; nickname: string; memberState: string; submission: { id: string; state: string; revision: number; versionNo: number; submittedAt: string } | null }> } | null };
export type SubmissionHistory = { page: number; hasMore: boolean; items: Array<{ id: string; title: string; state: string; submittedAt: string; versionNo: number }> };
