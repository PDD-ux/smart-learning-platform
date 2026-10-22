/** Explicit acceptance only: uses temporary database accounts and the real storage/ffprobe. */
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { loadEnvConfig } from '@next/env';
import { randomUUID, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { PrismaClient } from '@prisma/client';
import type { JobPayload } from '@/lib/queue';
const control = vi.hoisted(() => ({ realNetwork: false, fixturePath: '', cancel: null as null | (() => Promise<void>), queueFailure: false, payloads: [] as JobPayload[] }));
vi.mock('@/lib/queue', () => ({ QueueName: { CONTENT_PARSE: 'CONTENT_PARSE' }, enqueue: async (_name: string, payload: JobPayload): Promise<string> => { if (control.queueFailure) throw Error('acceptance queue failure'); control.payloads.push(payload); return 'acceptance-held'; } }));
vi.mock('@/lib/jobs/workers', () => ({ registerAllProcessors: (): void => undefined }));
vi.mock('@/lib/api/rate-limit', async (original) => ({ ...await original<object>(), rateLimit: async (): Promise<object> => ({ allowed: true }) }));
vi.mock('@/lib/url-imports/fetch', async (original) => {
  const actual = await original<typeof import('@/lib/url-imports/fetch')>();
  const fs = await import('node:fs/promises'), crypto = await import('node:crypto');
  return { ...actual, fetchPublicVideo: async (url: string, file: string, signal?: AbortSignal): Promise<import('@/lib/url-imports/fetch').DownloadedVideo> => {
    if (control.realNetwork) return actual.fetchPublicVideo(url, file, signal);
    if (control.cancel) { const cancel = control.cancel; control.cancel = null; await cancel(); }
    const bytes = await fs.readFile(control.fixturePath); await fs.writeFile(file, bytes);
    return { format: 'MP4', fileSize: bytes.length, sourceDigest: crypto.createHash('sha256').update(bytes).digest('hex'), finalUrl: url, contentType: 'video/mp4', fetchedAt: new Date().toISOString() };
  } };
});
import { importVideoUrl } from '@/lib/video-imports/service';
import { cancelUrlDraft, expireUrlDrafts, readUrlDraft } from '@/lib/url-imports/service';
import { getStorage } from '@/lib/storage';
import { ffmpegPath } from '@/lib/media/ffmpeg';
import { runText } from '@/lib/media/ffmpeg-runner';

loadEnvConfig(process.cwd(), true, { info: (): void => undefined, error: (): void => undefined });
Object.assign(process.env, parseEnv(readFileSync('.env.local', 'utf8')));
const db = new PrismaClient(), prefix = 'video-url-acceptance-' + randomUUID(), users = [prefix + '-owner', prefix + '-other'];
const owner = { id: users[0], email: null, role: 'student' }, other = { id: users[1], email: null, role: 'student' };
const checks: string[] = [];
let firstRequest = '', firstContent = '', originalHash = '', fixtureSize = 0;
let network: object = {};
function input(id: string, url = 'https://example.org/original-classroom.mp4'): Request { return new Request('http://localhost/api/video-imports', { method: 'POST', body: JSON.stringify({ requestId: id, url, confirmed: true }) }); }
beforeAll(async (): Promise<void> => {
  await mkdir('.taskbook-working/video-url-20261021', { recursive: true });
  control.fixturePath = '.taskbook-working/video-url-20261021/fixture-' + randomUUID() + '.mp4';
  await runText(ffmpegPath(), ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=4', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=16000', '-t', '2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', control.fixturePath], 30000);
  const fixture = readFileSync(control.fixturePath); fixtureSize = fixture.length;
  originalHash = createHash('sha256').update(fixture).digest('hex');
  for (const id of users) await db.user.create({ data: { id, role: 'student', nickname: '视频链接隔离验收', passwordHash: 'unusable-acceptance-login-' + randomUUID() } });
});
afterAll(async (): Promise<void> => {
  const drafts = await db.urlImportDraft.findMany({ where: { ownerId: { in: users } }, select: { id: true } });
  await db.auditLog.deleteMany({ where: { actorId: { in: users } } });
  await db.user.deleteMany({ where: { id: { in: users } } });
  for (const draft of drafts) for (const format of ['mp4', 'webm']) await getStorage().deleteObject(`contents/url-${draft.id}/source.${format}`);
  const cleanup = { users: await db.user.count({ where: { id: { in: users } } }), contents: await db.learningContent.count({ where: { ownerId: { in: users } } }), drafts: await db.urlImportDraft.count({ where: { ownerId: { in: users } } }), originalFileUnchanged: Boolean(originalHash) && createHash('sha256').update(readFileSync(control.fixturePath)).digest('hex') === originalHash };
  await writeFile('.taskbook-working/video-url-20261021/database.json', JSON.stringify({ time: new Date().toISOString(), checks, network, heldParseJobs: control.payloads.length, realModelCalled: false, cleanup }, null, 2));
  await rm(control.fixturePath, { force: true });
  await db.$disconnect(); expect(cleanup).toEqual({ users: 0, contents: 0, drafts: 0, originalFileUnchanged: true });
});
it('imports an original actual MP4 through real ffprobe, PostgreSQL and local storage', async (): Promise<void> => {
  firstRequest = randomUUID(); const result = await importVideoUrl(input(firstRequest), owner); expect(result.state).toBe('COMMITTED'); firstContent = result.contentId!;
  const row = await db.learningContent.findUniqueOrThrow({ where: { id: firstContent } }); expect(row.status).toBe('PARSING'); expect(row.contentType).toBe('VIDEO'); expect(row.durationSec).toBe(2); expect(Number(row.fileSizeBytes)).toBe(fixtureSize);
  expect((await getStorage().statObject(row.storageKey))?.size).toBe(fixtureSize); expect(await db.asyncJob.count({ where: { contentId: row.id, jobType: 'CONTENT_PARSE', state: 'PENDING' } })).toBe(1);
  const draft = await db.urlImportDraft.findUniqueOrThrow({ where: { ownerId_requestId: { ownerId: owner.id, requestId: firstRequest } } }); expect(draft.snapshot).toBeNull(); expect(control.payloads).toHaveLength(1); checks.push('real-media-db-storage-single-job');
});
it('replays without a second download/job and refuses another URL for the same request', async (): Promise<void> => {
  expect((await importVideoUrl(input(firstRequest), owner)).contentId).toBe(firstContent); expect(control.payloads).toHaveLength(1);
  await expect(importVideoUrl(input(firstRequest, 'https://example.org/changed.mp4'), owner)).rejects.toMatchObject({ code: 'NOTE_CONFLICT' }); checks.push('idempotency-and-mismatch');
});
it('refuses another student reading or cancelling the private import', async (): Promise<void> => {
  await expect(readUrlDraft(other, firstRequest)).rejects.toMatchObject({ code: 'NOT_FOUND' }); await expect(cancelUrlDraft(other, firstRequest)).rejects.toMatchObject({ code: 'NOT_FOUND' }); checks.push('foreign-read-cancel-rejected');
});
it('rejects a late download after a real cancellation and removes its source', async (): Promise<void> => {
  const id = randomUUID(); control.cancel = async (): Promise<void> => { expect((await cancelUrlDraft(owner, id)).state).toBe('CANCELLED'); };
  expect((await importVideoUrl(input(id), owner)).state).toBe('CANCELLED');
  const draft = await db.urlImportDraft.findUniqueOrThrow({ where: { ownerId_requestId: { ownerId: owner.id, requestId: id } } }); expect(await getStorage().statObject(`contents/url-${draft.id}/source.mp4`)).toBeNull(); expect(await db.learningContent.count({ where: { id: 'url-' + draft.id } })).toBe(0); checks.push('cancel-late-write-cleaned');
});
it('retains the source with a retryable failure if queue dispatch fails', async (): Promise<void> => {
  control.queueFailure = true;
  try {
    const result = await importVideoUrl(input(randomUUID()), owner); expect(result.state).toBe('COMMITTED'); expect(result.error).toContain('解析队列'); const row = await db.learningContent.findUniqueOrThrow({ where: { id: result.contentId! } }); expect(row.status).toBe('FAILED'); expect(await getStorage().statObject(row.storageKey)).not.toBeNull(); checks.push('queue-failure-retryable-source-retained');
  } finally { control.queueFailure = false; }
});
it('cleans an expired video draft even when its download finishes late', async (): Promise<void> => {
  const id = randomUUID(); control.cancel = async (): Promise<void> => { await db.urlImportDraft.update({ where: { ownerId_requestId: { ownerId: owner.id, requestId: id } }, data: { expiresAt: new Date(Date.now() - 1000) } }); await expireUrlDrafts(owner.id); };
  expect((await importVideoUrl(input(id), owner)).state).toBe('EXPIRED');
  const draft = await db.urlImportDraft.findUniqueOrThrow({ where: { ownerId_requestId: { ownerId: owner.id, requestId: id } } }); expect(await getStorage().statObject(`contents/url-${draft.id}/source.mp4`)).toBeNull(); checks.push('expired-late-write-cleaned');
});
it('probes the licensed public video without disabling public-address validation', async (): Promise<void> => {
  control.realNetwork = true;
  try {
    const result = await importVideoUrl(input(randomUUID(), 'https://upload.wikimedia.org/wikipedia/commons/2/2a/Calculus_1_video_1.webm'), owner);
    network = { state: result.state, error: result.error, contentCreated: Boolean(result.contentId), realNetwork: true };
    expect(['COMMITTED', 'FAILED']).toContain(result.state); if (result.state === 'FAILED') expect(result.error).toBeTruthy(); checks.push('public-video-probe-recorded-separately');
  } finally { control.realNetwork = false; }
}, 180000);
