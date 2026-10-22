import { z } from 'zod';
import { videoRefSchema, documentRefSchema, type ContentRef } from '@/lib/domain/content-ref';
export const refSchema = z.discriminatedUnion('type', [videoRefSchema.strict(), documentRefSchema.strict()]);
export function plainText(max: number): z.ZodEffects<z.ZodString, string, string> {
  return z.string().trim().min(1).max(max).refine((value): boolean => !/<\/?[a-z][^>]*>/i.test(value) && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value), '请输入纯文本，不含HTML或控制字符');
}
export const threadCreate = z.object({ kind: z.enum(['question', 'discussion']), title: plainText(120), body: plainText(3000), ref: refSchema.nullable().default(null), requestId: z.string().uuid() }).strict();
export const threadPatch = z.object({ expectedVersion: z.number().int().min(1), title: plainText(120).optional(), body: plainText(3000).optional(), solved: z.boolean().optional() }).strict().refine((value): boolean => value.title !== undefined || value.body !== undefined || value.solved !== undefined);
export const replyCreate = z.object({ body: plainText(1500), requestId: z.string().uuid() }).strict();
export const replyPatch = z.object({ body: plainText(1500), expectedVersion: z.number().int().min(1) }).strict();
export const deleteSchema = z.object({ expectedVersion: z.number().int().min(1) }).strict();
export type PublicAuthor = { nickname: string; role: string } | null;
export type DiscussionThreadDto = { id: string; courseId: string; kind: 'question' | 'discussion'; title: string; body: string; ref: ContentRef | null; solvedAt: string | null; pinnedAt: string | null; version: number; author: PublicAuthor; createdAt: string; updatedAt: string; canEdit: boolean; replyCount: number };
export type DiscussionReplyDto = { id: string; threadId: string; author: PublicAuthor; body: string | null; deleted: boolean; version: number; createdAt: string; updatedAt: string; canEdit: boolean };
export type DiscussionList<T> = { items: T[]; page: number; pageSize: number; total: number; discussionEnabled: boolean };
export function discussionReleased(): boolean { return process.env.DISCUSSION_RELEASE_READY === 'true'; }
