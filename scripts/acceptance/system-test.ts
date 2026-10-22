/** Local system acceptance: real HTTP/DB, disposable accounts, no original writes. */
import { randomUUID, createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadEnvConfig } from '@next/env';
import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../../src/lib/auth/password';

loadEnvConfig(process.cwd());
const db = new PrismaClient();
const base = 'http://127.0.0.1:3000';
const output = path.resolve(process.argv[2] ?? '.taskbook-working/system-test-20261012/http');
type Check = { name: string; passed: boolean; status?: number; durationMs?: number };
const checks: Check[] = [];
const failures: string[] = [];
const run = randomUUID();
const testIp = '127.0.0.' + (50 + Number.parseInt(run.slice(0, 2), 16) % 150);
const ids: string[] = [];
const keys: string[] = [];
let originalIds: string[] = [];
let before = '';
let token = '';
let otherToken = '';
let adminToken = '';
let refreshCookie = '';
let lessonId = '';
let pointId = '';
let activeImportId = '';
let accountCleaned = false;

function check(name: string, passed: boolean, status?: number, durationMs?: number): void {
  checks.push({ name, passed, status, durationMs });
  if (!passed) throw new Error(name);
}
async function scenario(name: string, action: () => Promise<void>): Promise<void> {
  try { await action(); } catch { failures.push(name); }
  await writeFile(path.join(output, 'progress.json'), JSON.stringify({ checks, failures, fixtureAccounts: ids.length }, null, 2));
  console.log(JSON.stringify({ scenario: name, passed: !failures.includes(name) }));
}
async function call(route: string, method = 'GET', body?: unknown, credential = token, expected = 200): Promise<Record<string, unknown>> {
  const started = Date.now();
  const response = await fetch(base + '/api/' + route, { method,
    headers: { ...(credential ? { Authorization: `Bearer ${credential}` } : {}), 'Content-Type': 'application/json', 'X-Forwarded-For': testIp },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(100_000) });
  check(`${method} ${route}`, response.status === expected, response.status, Date.now() - started);
  const envelope = await response.json() as { data?: Record<string, unknown>; success?: boolean };
  if (expected >= 400) return {};
  check(`${method} ${route} envelope`, envelope.success === true);
  return envelope.data ?? {};
}
async function fingerprint(): Promise<string> {
  const rows = await db.learningContent.findMany({ where: { id: { in: originalIds } }, orderBy: { id: 'asc' },
    include: { textBlocks: { orderBy: { id: 'asc' } }, transcripts: { orderBy: { id: 'asc' } },
      knowledgePoints: { orderBy: { id: 'asc' } }, generatedNote: true, notes: { orderBy: { id: 'asc' } },
      flashcards: { orderBy: { id: 'asc' } }, exercises: { orderBy: { id: 'asc' }, include: { records: { orderBy: { id: 'asc' } } } } } });
  return createHash('sha256').update(JSON.stringify(rows, (_key, value: unknown): unknown => typeof value === 'bigint' ? String(value) : value)).digest('hex');
}
async function main(): Promise<void> {
  await mkdir(output, { recursive: false });
  originalIds = (await db.learningContent.findMany({ select: { id: true } })).map((row): string => row.id);
  before = await fingerprint();
  const password = `System-${randomUUID()}!Aa9`;
  const hash = await hashPassword(password);
  try {
    const tokens: string[] = [];
    for (const [index, role] of ['student', 'student', 'admin'].entries()) {
      const account = `system-${run}-${index}@example.test`;
      const user = await db.user.create({ data: { email: account, nickname: '系统测试隔离账号', passwordHash: hash, role } });
      ids.push(user.id);
      const response = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': testIp }, body: JSON.stringify({ account, password, remember: false }), signal: AbortSignal.timeout(20000) });
      check(`password_login_${role}_${index}`, response.status === 200, response.status);
      const envelope = await response.json() as { data: { accessToken: string; user: Record<string, unknown> } };
      check(`login_private_fields_${index}`, !('passwordHash' in envelope.data.user));
      tokens.push(envelope.data.accessToken);
      if (index === 0) {
        refreshCookie = response.headers.getSetCookie().find((cookie): boolean => cookie.startsWith('refresh_token='))?.split(';')[0] ?? '';
        check('refresh_cookie_received', refreshCookie.length > 0);
      }
    }
    [token, otherToken, adminToken] = tokens;
    await scenario('session_origins', async (): Promise<void> => {
      const { verifyRefreshToken } = await import('../../src/lib/auth/jwt');
      let localVerifierAccepted = false;
      let localVerifierErrorType = '';
      try { verifyRefreshToken(refreshCookie.slice('refresh_token='.length)); localVerifierAccepted = true; }
      catch (error) { localVerifierErrorType = error instanceof Error ? error.name : 'Unknown'; }
      await writeFile(path.join(output, 'session-verifier.json'), JSON.stringify({ localVerifierAccepted, localVerifierErrorType }, null, 2));
      for (const origin of ['http://localhost:3000', base]) {
        const response = await fetch(origin + '/api/auth/refresh', { method: 'POST', headers: { Cookie: refreshCookie, Origin: origin, 'X-Session-Refresh': '1', 'X-Forwarded-For': testIp }, signal: AbortSignal.timeout(20000) });
        // Record both independently: localhost failure must not skip the active 127 origin.
        checks.push({ name: `same_origin_refresh_${origin}`, passed: response.status === 200, status: response.status });
        if (response.status !== 200) failures.push(`refresh_${origin}`);
      }
      const response = await fetch(base + '/api/auth/refresh', { method: 'POST', headers: { Cookie: refreshCookie, Origin: 'https://foreign.example.invalid', 'X-Session-Refresh': '1', 'X-Forwarded-For': testIp } });
      check('foreign_origin_refresh_rejected', response.status === 403, response.status);
    });
    const lesson = await db.learningContent.create({ data: { ownerId: ids[0], title: '人工链式法则验收资料', contentType: 'DOCUMENT', format: 'TXT', fileName: 'system.txt', storageKey: `system-fixtures/${run}/lesson.txt`, fileSizeBytes: 90n, pageCount: 1, status: 'READY', understandingStatus: 'COMPLETED' } });
    lessonId = lesson.id;
    const point = await db.knowledgePoint.create({ data: { contentId: lessonId, ownerId: ids[0], title: '链式法则', importance: 3, summary: '复合函数导数等于外层导数乘以内层导数。', refs: [{ type: 'document', page: 1 }] } });
    pointId = point.id;
    await db.textBlock.create({ data: { contentId: lessonId, source: 'MD', sequence: 0, ref: { type: 'document', page: 1 }, text: '链式法则：复合函数导数等于外层导数乘以内层导数。若 y=(3x+1)²，则 y 的导数是 6(3x+1)。' } });
    await scenario('permissions_and_graph', async (): Promise<void> => {
      await call('contents/' + lessonId, 'GET', undefined, otherToken, 403);
      await call('admin/overview', 'GET', undefined, token, 403);
      await call('gamification/profile', 'GET', undefined, '', 401);
      await call('contents/' + lessonId + '/graph');
      await call('graph/overview'); await call('mastery');
      await call('admin/overview', 'GET', undefined, adminToken);
    });
    await scenario('notes_crud_and_conflict', async (): Promise<void> => {
      const note = await call(`contents/${lessonId}/notes`, 'POST', { content: '链式法则学习笔记', ref: { type: 'document', page: 1 } });
      const noteId = String(note.noteId);
      await call('notes/' + noteId, 'PATCH', { content: '越权', expectedVersion: 1 }, otherToken, 403);
      const updated = await call('notes/' + noteId, 'PATCH', { content: '已修改的学习笔记', expectedVersion: note.version });
      check('note_version_increased', Number(updated.version) > Number(note.version));
      const conflict = await call('notes/' + noteId, 'PATCH', { content: '旧版本覆盖', expectedVersion: note.version });
      check('note_conflict_flag', conflict.isOverwritten === true);
      await call('notes/' + noteId, 'DELETE');
      check('note_deleted', await db.note.count({ where: { id: noteId } }) === 0);
    });
    await scenario('attendance_idempotence', async (): Promise<void> => {
      await call('attendance/today');
      const first = await call('attendance/today', 'POST');
      await call('attendance/today', 'POST');
      check('single_daily_attendance', await db.attendanceRecord.count({ where: { userId: ids[0] } }) === 1);
      check('attendance_result', first.checkedIn === true);
    });
    await scenario('review_and_mastery', async (): Promise<void> => {
      const card = await db.flashcard.create({ data: { ownerId: ids[0], contentId: lessonId, pointId, front: '导数法则', back: '链式法则', nextReviewAt: new Date(Date.now() - 1000) } });
      await call(`flashcards/${card.id}/review`, 'POST', { rating: 3 }, otherToken, 403);
      const reviewed = await call(`flashcards/${card.id}/review`, 'POST', { rating: 3 });
      check('review_xp_gained', Number(reviewed.xpGain) > 0);
      check('review_schedule_saved', (await db.flashcard.findUniqueOrThrow({ where: { id: card.id } })).nextReviewAt > new Date());
      await call(`flashcards/${card.id}/review`, 'POST', { rating: 9 }, token, 400);
    });
    await scenario('admin_crud', async (): Promise<void> => {
      const account = `system-admin-created-${run}@example.test`;
      const created = await call('admin/users', 'POST', { account, nickname: '管理员创建测试', password, role: 'student' }, adminToken, 201);
      const user = created.user as Record<string, unknown>; const createdId = String(user.id); ids.push(createdId);
      check('admin_response_no_password', !('passwordHash' in user));
      await call(`admin/users?query=${encodeURIComponent(account)}`, 'GET', undefined, adminToken);
      await call('admin/users/' + createdId, 'PATCH', { nickname: '修改后的测试用户' }, adminToken);
      await call('admin/users/' + ids[2], 'PATCH', { role: 'student' }, adminToken, 403);
      await call('admin/users/' + ids[2], 'DELETE', undefined, adminToken, 403);
      await call('admin/users/' + createdId, 'DELETE', undefined, adminToken);
      check('admin_created_user_deleted', await db.user.count({ where: { id: createdId } }) === 0);
    });
    await scenario('real_document_upload_pipeline', async (): Promise<void> => {
      const bytes = Buffer.from('# 链式法则\n\n复合函数导数等于外层导数乘以内层导数。例如y=(3x+1)²，导数为6(3x+1)。\n\n学习时应区分外层函数平方和内层函数3x+1，避免遗漏内层导数3。');
      const intent = await call('contents/upload-intent', 'POST', { contentType: 'document', fileName: 'system-chain-rule.md', fileSize: bytes.length, mimeType: 'text/markdown' });
      activeImportId = String(intent.contentId);
      const content = await db.learningContent.findUniqueOrThrow({ where: { id: activeImportId } }); keys.push(content.storageKey);
      const upload = await fetch(new URL(String(intent.uploadUrl), base), { method: 'PUT', headers: { 'Content-Type': 'text/markdown' }, body: bytes, signal: AbortSignal.timeout(20000) });
      check('real_upload', upload.status === 200, upload.status);
      await call(`contents/${activeImportId}/complete`, 'POST', { size: bytes.length });
      const deadline = Date.now() + 180000;
      let ready = false;
      while (Date.now() < deadline) {
        const current = await db.learningContent.findUniqueOrThrow({ where: { id: activeImportId } });
        if (['COMPLETED', 'FAILED'].includes(current.understandingStatus)) { ready = current.understandingStatus === 'COMPLETED'; break; }
        await new Promise<void>((resolve): void => { setTimeout(resolve, 1000); });
      }
      check('real_document_understanding_complete', ready);
      check('real_document_points', await db.knowledgePoint.count({ where: { contentId: activeImportId } }) > 0);
      check('real_document_note', await db.generatedNote.count({ where: { contentId: activeImportId } }) === 1);
      const resource = await call(`contents/${activeImportId}/resource`);
      const media = await fetch(new URL(String(resource.url), base));
      check('real_document_resource_bytes', media.ok && Buffer.from(await media.arrayBuffer()).equals(bytes), media.status);
    });
    await scenario('real_agent_explain', async (): Promise<void> => {
      const result = await call('assistant/agent', 'POST', { contentId: lessonId, message: '请用资料原文解释链式法则，说明y=(3x+1)²的导数，并引用来源。', minutes: 10, history: [] });
      check('agent_nonempty_answer', typeof result.answer === 'string' && result.answer.length > 20);
      check('agent_has_citations', Array.isArray(result.citations) && result.citations.length > 0);
      await writeFile(path.join(output, 'agent.json'), JSON.stringify({ answer: result.answer, citations: result.citations, steps: result.steps }, null, 2));
    });
    await scenario('page_http', async (): Promise<void> => {
      for (const route of ['/login', '/dashboard', '/import', '/question-bank', '/review', '/study-plans', '/assistant', '/graph', '/attendance', '/admin', '/admin/users', '/admin/attendance']) {
        const response = await fetch(base + route, { signal: AbortSignal.timeout(20000) });
        checks.push({ name: `page_${route}`, passed: response.status === 200, status: response.status });
        if (response.status !== 200) failures.push(`page_${route}`);
      }
    });
  } finally {
    // Only disposable accounts created by this run; retain evidence of any running job.
    if (activeImportId) {
      const pending = await db.asyncJob.count({ where: { contentId: activeImportId, state: { in: ['PENDING', 'RUNNING'] } } });
      if (pending > 0) failures.push('background_job_still_running_before_cleanup');
    }
    const after = await fingerprint();
    const unchanged = before === after;
    if (!unchanged) failures.push('original_data_changed_during_test');
    const { getStorage } = await import('../../src/lib/storage');
    for (const key of keys) await getStorage().deleteObject(key);
    // A create response can differ from its expected status before its ID is received.
    // This exact disposable email belongs only to this run and must still be cleaned.
    await db.user.deleteMany({ where: { email: `system-admin-created-${run}@example.test` } });
    await db.user.deleteMany({ where: { id: { in: ids } } });
    accountCleaned = await db.user.count({ where: { id: { in: ids } } }) === 0;
    await writeFile(path.join(output, 'report.json'), JSON.stringify({ checkedAt: new Date().toISOString(), target: base,
      checks, failures, passed: checks.filter((row): boolean => row.passed).length, total: checks.length,
      accountCleaned, originalDataUnchanged: unchanged, originalBefore: before, originalAfter: after,
      artificialFixtures: true, scope: 'Real HTTP/DB; page HTTP is not authenticated browser acceptance' }, null, 2));
    if (failures.length > 0 || !accountCleaned) process.exitCode = 1;
    await db.$disconnect();
  }
}
main().catch((): void => { console.error('System acceptance stopped; inspect sanitized evidence'); process.exitCode = 1; });
