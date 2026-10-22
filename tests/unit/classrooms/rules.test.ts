import { expect, it } from 'vitest';
import type { AssignmentSubmissionState } from '@prisma/client';
import { assertCanSubmit, assertRevision, assertSubmissionTransition, attachmentBatchSchema, attachmentSchema, attachmentStorageKey, classRequestDigest, classTitleSchema, createInviteCode, hashInviteCode, isInviteUsable } from '@/lib/classrooms/rules';

it('creates a random 128-bit invite and persists only a stable digest', (): void => {
  const first = createInviteCode(), second = createInviteCode();
  expect(first.code).toMatch(/^[A-Za-z0-9_-]{22}$/u); expect(first.codeHash).toMatch(/^[a-f0-9]{64}$/u);
  expect(hashInviteCode(first.code)).toBe(first.codeHash); expect(second.codeHash).not.toBe(first.codeHash);
  expect(() => hashInviteCode('../not-an-invite')).toThrow();
});
const now = new Date('2026-10-19T05:00:00Z');
it.each([
  { expiresAt: now, revokedAt: null, usedCount: 0, maxUses: 5 },
  { expiresAt: new Date(now.getTime() - 1), revokedAt: null, usedCount: 0, maxUses: 5 },
  { expiresAt: new Date(now.getTime() + 1), revokedAt: now, usedCount: 0, maxUses: 5 },
  { expiresAt: new Date(now.getTime() + 1), revokedAt: null, usedCount: 5, maxUses: 5 },
  { expiresAt: new Date(now.getTime() + 1), revokedAt: null, usedCount: -1, maxUses: 5 },
  { expiresAt: new Date(now.getTime() + 1), revokedAt: null, usedCount: 0, maxUses: 5001 },
])('rejects expired, revoked, exhausted or malformed invite %#', (invite): void => { expect(isInviteUsable(invite, 'ACTIVE', now)).toBe(false); });
it('only accepts active, unexpired invitations for active classrooms', (): void => {
  const invite = { expiresAt: new Date(now.getTime() + 1), revokedAt: null, usedCount: 0, maxUses: 1 };
  expect(isInviteUsable(invite, 'ACTIVE', now)).toBe(true); expect(isInviteUsable(invite, 'ARCHIVED', now)).toBe(false);
});
it.each(['DRAFT', 'SUBMITTED', 'RETURNED', 'GRADED'] as AssignmentSubmissionState[])('allows only documented transitions from %s', (current): void => {
  const allowed = { DRAFT: ['SUBMITTED'], SUBMITTED: ['RETURNED', 'GRADED'], RETURNED: ['SUBMITTED'], GRADED: [] };
  for (const next of ['DRAFT', 'SUBMITTED', 'RETURNED', 'GRADED'] as AssignmentSubmissionState[]) {
    if ((allowed[current] as string[]).includes(next)) expect(() => assertSubmissionTransition(current, next)).not.toThrow();
    else expect(() => assertSubmissionTransition(current, next)).toThrow();
  }
});
const ready = { classroomState: 'ACTIVE', memberState: 'ACTIVE', assignmentState: 'PUBLISHED', chapterState: 'PUBLISHED', dueAt: new Date(now.getTime() + 1) };
it('permits submission strictly before the server deadline', (): void => { expect(() => assertCanSubmit(ready, now)).not.toThrow(); expect(() => assertCanSubmit({ ...ready, chapterState: null }, now)).not.toThrow(); });
it.each([{ dueAt: now }, { dueAt: null }, { dueAt: new Date(NaN) }, { classroomState: 'ARCHIVED' }, { memberState: 'LEFT' }, { memberState: 'REMOVED' }, { assignmentState: 'CLOSED' }, { assignmentState: 'DRAFT' }, { chapterState: 'WITHDRAWN' }])('rejects non-submittable context %#', (change): void => { expect(() => assertCanSubmit({ ...ready, ...change }, now)).toThrow(); });
it.each(['', ' ', '文'.repeat(101)])('rejects invalid class titles %#', (title): void => { expect(classTitleSchema.safeParse(title).success).toBe(false); });
it('checks CAS revisions and canonicalizes complete idempotency input', (): void => {
  expect(() => assertRevision(1, 1)).not.toThrow(); expect(() => assertRevision(2, 1)).toThrow(); expect(() => assertRevision(0, 0)).toThrow();
  expect(classRequestDigest('SUBMIT', { a: '甲', b: [1, 2] })).toBe(classRequestDigest('SUBMIT', { b: [1, 2], a: '甲' }));
  expect(classRequestDigest('SUBMIT', { a: '甲' })).not.toBe(classRequestDigest('SUBMIT', { a: '乙' }));
  expect(classRequestDigest('SUBMIT', {})).not.toBe(classRequestDigest('DRAFT', {}));
  expect(() => classRequestDigest('SUBMIT', { n: NaN })).toThrow(); expect(() => classRequestDigest('SUBMIT', { n: undefined })).toThrow();
  expect(() => classRequestDigest('SUBMIT', { bodyText: '文'.repeat(50_000) })).not.toThrow();
  expect(() => classRequestDigest('SUBMIT', '文'.repeat(100_000))).toThrow();
});
it.each([
  { fileName: '../work.pdf', mimeType: 'application/pdf', sizeBytes: 20 },
  { fileName: 'C:\\work.pdf', mimeType: 'application/pdf', sizeBytes: 20 },
  { fileName: 'script.svg', mimeType: 'image/svg+xml', sizeBytes: 20 },
  { fileName: 'work.pdf', mimeType: 'image/png', sizeBytes: 20 },
  { fileName: 'work.pdf', mimeType: 'application/pdf', sizeBytes: 0 },
  { fileName: 'work.pdf', mimeType: 'application/pdf', sizeBytes: 20 * 1024 * 1024 + 1 },
])('rejects unsafe or inconsistent attachment metadata %#', (file): void => { expect(attachmentSchema.safeParse(file).success).toBe(false); });
it('uses account/class scoped deterministic storage keys for allowed files', (): void => {
  expect(attachmentSchema.safeParse({ fileName: '作业.JPEG', mimeType: 'image/jpeg', sizeBytes: 20 * 1024 * 1024 }).success).toBe(true);
  expect(attachmentStorageKey('c1', 'u1', 'a1', 'image/jpeg')).toBe('class-assignments/c1/u1/a1/source.jpg');
  expect(() => attachmentStorageKey('../c', 'u1', 'a1', 'image/jpeg')).toThrow();
  expect(() => attachmentStorageKey('c1', 'u1', 'a1', 'text/html')).toThrow();
});
it('bounds attachment batch count and combined bytes separately', (): void => {
  const file = { fileName: '作业.pdf', mimeType: 'application/pdf', sizeBytes: 20 * 1024 * 1024 };
  expect(attachmentBatchSchema.safeParse([file, file]).success).toBe(true);
  expect(attachmentBatchSchema.safeParse([file, file, file]).success).toBe(false);
  expect(attachmentBatchSchema.safeParse(Array.from({ length: 6 }, () => ({ ...file, sizeBytes: 1 }))).success).toBe(false);
});
