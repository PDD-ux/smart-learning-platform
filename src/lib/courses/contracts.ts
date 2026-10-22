import { z } from 'zod';
import { contentRefSchema } from '@/lib/domain/content-ref';

export const includeSchema = z.object({ transcripts: z.boolean(), textBlocks: z.boolean(), knowledgePoints: z.boolean(), generatedNote: z.boolean() }).strict();
export const prepareCourseSchema = z.object({
  sourceContentId: z.string().min(1).max(128), title: z.string().trim().min(1).max(120), description: z.string().trim().max(2000),
  rightsConfirmed: z.literal(true), rightsStatement: z.string().trim().min(1).max(500), include: includeSchema, requestId: z.string().uuid(),
}).strict();
export const courseActionSchema = z.object({ expectedVersion: z.number().int().min(1), action: z.enum(['publish', 'withdraw']) }).strict();
export const snapshotSchema = z.object({
  transcripts: z.array(z.object({ startMs: z.number().int().nonnegative(), endMs: z.number().int().nonnegative(), text: z.string().max(50000) }).strict()).max(10000),
  textBlocks: z.array(z.object({ ref: contentRefSchema, text: z.string().max(100000) }).strict()).max(20000),
  knowledgePoints: z.array(z.object({ title: z.string().max(500), summary: z.string().max(100000), tags: z.array(z.string().max(100)).max(100), importance: z.number().int().min(1).max(5), refs: z.array(contentRefSchema).max(500) }).strict()).max(2000),
  generatedNote: z.object({ markdown: z.string().max(1000000), sourceCount: z.number().int().nonnegative(), generatedAt: z.string().datetime() }).strict().nullable(),
}).strict();
export type CourseSnapshot = z.infer<typeof snapshotSchema>;
export type PrepareCourse = z.infer<typeof prepareCourseSchema>;
export type CourseSummary = { courseId: string; title: string; description: string; contentType: 'video' | 'document'; format: string; durationSec: number | null; pageCount: number | null; discussionEnabled: boolean; version: number; publishedAt: string | null };
export type CourseDetail = CourseSummary & { resourceUrl: string; snapshot: CourseSnapshot; discussionAvailable?: boolean };
export type AdminCourse = CourseDetail & { canPublish: boolean; state: 'DRAFT' | 'PUBLISHED' | 'WITHDRAWN'; prepared: boolean; include: PrepareCourse['include']; rightsConfirmed: boolean; rightsStatement: string };
export type AdminCourseSummary = CourseSummary & { state: AdminCourse['state']; prepared: boolean };
export type CourseList<T = CourseSummary> = { page: number; pageSize: number; total: number; items: T[] };
