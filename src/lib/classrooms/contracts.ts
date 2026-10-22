import { z } from 'zod';
import { classTitleSchema, classBodySchema, revisionSchema } from './rules';
export const classId = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/u);
const request = { requestId: z.string().uuid() };
const base = { ...request, expectedRevision: revisionSchema };
export const createClassSchema = z.object({ ...request, title: classTitleSchema, description: z.string().max(2000) }).strict();
export const joinClassSchema = z.object({ ...request, code: z.string().regex(/^[A-Za-z0-9_-]{22}$/u), confirmed: z.literal(true) }).strict();
const entity = { id: classId.optional(), entityRevision: revisionSchema.optional() };
export const classCommandSchema = z.discriminatedUnion('action', [
  z.object({ ...base, action: z.literal('class'), title: classTitleSchema, description: z.string().max(2000) }).strict(),
  z.object({ ...base, action: z.literal('archive'), state: z.enum(['ACTIVE', 'ARCHIVED']), confirmed: z.literal(true) }).strict(),
  z.object({ ...base, action: z.literal('invite'), days: z.number().int().min(1).max(30), maxUses: z.number().int().min(1).max(5000), confirmed: z.literal(true) }).strict(),
  z.object({ ...base, action: z.literal('revoke'), inviteId: classId }).strict(),
  z.object({ ...base, action: z.literal('member'), studentId: classId, memberRevision: revisionSchema, state: z.enum(['ACTIVE', 'REMOVED']), confirmed: z.literal(true) }).strict(),
  z.object({ ...base, action: z.literal('leave'), confirmed: z.literal(true) }).strict(),
  z.object({ ...base, ...entity, action: z.literal('chapter'), title: classTitleSchema, body: classBodySchema, sequence: z.number().int().min(0).max(9999), state: z.enum(['DRAFT', 'PUBLISHED', 'WITHDRAWN']), sharedCourseId: classId.nullable(), publishConfirmed: z.boolean() }).strict(),
  z.object({ ...base, ...entity, action: z.literal('assignment'), title: classTitleSchema, instructions: classBodySchema, chapterId: classId.nullable(), state: z.enum(['DRAFT', 'PUBLISHED', 'CLOSED', 'WITHDRAWN']), dueAt: z.string().datetime({ offset: true }).nullable(), publishConfirmed: z.boolean() }).strict(),
]);
export type CreateClass = z.infer<typeof createClassSchema>;
export type JoinClass = z.infer<typeof joinClassSchema>;
export type ClassCommand = z.infer<typeof classCommandSchema>;
export type ClassResult = { classroomId: string; resultId: string; replayed: boolean; code?: string };
export type ClassSummary = { id: string; title: string; description: string; state: 'ACTIVE' | 'ARCHIVED'; revision: number };
export type ClassChapterView = { id: string; title: string; body: string; sequence: number; state: 'DRAFT' | 'PUBLISHED' | 'CLOSED' | 'WITHDRAWN'; revision: number; sharedCourseId: string | null; sourceAvailable: boolean };
export type ClassTaskView = { id: string; chapterId: string | null; title: string; instructions: string; state: 'DRAFT' | 'PUBLISHED' | 'CLOSED' | 'WITHDRAWN'; dueAt: string | null; revision: number };
export type ClassList = { canCreate: boolean; items: ClassSummary[]; page: number; hasMore: boolean };
export type ClassDetail = { classroom: ClassSummary; canManage: boolean; memberCount: number; chapters: ClassChapterView[]; assignments: ClassTaskView[]; members: Array<{ studentId: string; nickname: string; state: 'ACTIVE' | 'LEFT' | 'REMOVED'; revision: number }>; invites: Array<{ id: string; expiresAt: string; maxUses: number; usedCount: number; revokedAt: string | null }> };
export type ClassSources = { items: Array<{ id: string; title: string }>; page: number; hasMore: boolean };
