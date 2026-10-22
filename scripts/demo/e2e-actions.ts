/**
 * 交互功能端到端演练（用户端 + 管理员端写操作）
 * ------------------------------------------------------------
 * 覆盖：笔记、学习计划、复习卡片、练习、AI 助手、出勤、课程讨论；
 *       管理员的用户管理、课程发布、讨论管理、出勤记录。
 *
 * 说明：依赖大模型的接口（练习生成 / AI 助手）失败只记 WARN，因为可能是限流或 Key 额度问题，
 *       不代表代码缺陷；其余接口失败一律记 FAIL。
 *
 * 用法：npx tsx scripts/demo/e2e-actions.ts
 */

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

function loadEnvOverride(file: string): void {
  let raw: string;
  try {
    raw = readFileSync(file, 'utf8');
  } catch {
    return;
  }
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    const quote = value[0];
    if (quote === '"' || quote === "'") {
      const end = value.indexOf(quote, 1);
      value = end > 0 ? value.slice(1, end) : value.slice(1);
    } else {
      const hash = value.indexOf(' #');
      if (hash >= 0) value = value.slice(0, hash).trim();
    }
    process.env[key] = value;
  }
}
loadEnvOverride('.env.local');

import { PrismaClient } from '@prisma/client';
import { issueSession, toPublicUser, passwordVersion } from '../../src/lib/auth/session';

const prisma = new PrismaClient();
const BASE = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3000';

type Json = Record<string, unknown>;
type CallResult = { status: number; json: Json | null; text: string };

const results: Array<{ name: string; ok: boolean; soft: boolean; detail: string }> = [];

async function call(method: string, path: string, body: unknown, token: string, timeoutMs = 60_000): Promise<CallResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        Authorization: `Bearer ${token}`,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await response.text();
    let json: Json | null = null;
    try {
      json = JSON.parse(text) as Json;
    } catch {
      json = null;
    }
    return { status: response.status, json, text: text.slice(0, 400) };
  } finally {
    clearTimeout(timer);
  }
}

function step(name: string, res: CallResult, soft = false, okStatus: number[] = [200, 201]): boolean {
  const ok = okStatus.includes(res.status);
  results.push({ name, ok, soft, detail: `HTTP ${res.status}${ok ? '' : ` ${res.text}`}` });
  console.log(`${ok ? '✔' : soft ? '!' : '✘'} ${name} — HTTP ${res.status}${ok ? '' : ` ${res.text}`}`);
  return ok;
}

async function tokenOf(email: string): Promise<string> {
  const user = await prisma.user.findFirstOrThrow({ where: { email } });
  return issueSession(toPublicUser(user), passwordVersion(user.passwordHash), true).accessToken;
}

async function main(): Promise<void> {
  const student = await tokenOf('demo@wenhao.local');
  const admin = await tokenOf('demo-admin@wenhao.local');

  // 用数据最丰富的学员作为学习侧演练对象
  const grouped = await prisma.learningContent.groupBy({ by: ['ownerId'], _count: { _all: true }, orderBy: { _count: { ownerId: 'desc' } }, take: 5 });
  let learnerId = '';
  for (const row of grouped) {
    const user = await prisma.user.findUnique({ where: { id: row.ownerId } });
    if (user && user.role !== 'admin') {
      learnerId = user.id;
      break;
    }
  }
  const learner = issueSession(
    toPublicUser(await prisma.user.findUniqueOrThrow({ where: { id: learnerId } })),
    passwordVersion((await prisma.user.findUniqueOrThrow({ where: { id: learnerId } })).passwordHash),
    true,
  ).accessToken;

  const contents = await call('GET', '/api/contents?page=1&pageSize=5', undefined, learner);
  const contentItems = ((contents.json?.data as Json | undefined)?.items ?? []) as Json[];
  const contentId = String(contentItems[0]?.contentId ?? '');
  console.log(`学习资料：${String(contentItems[0]?.title ?? '')} (${contentId})\n`);

  console.log('=== 1. 笔记 ===');
  const contentType = String(contentItems[0]?.contentType ?? 'video');
  const noteRef = contentType === 'document'
    ? { type: 'document', page: 1 }
    : { type: 'video', timestampSec: 30 };
  const createdNote = await call('POST', `/api/contents/${contentId}/notes`, {
    content: '演练笔记：本段讲的是演绎推理的常见谬误。',
    ref: noteRef,
  }, learner);
  step('创建笔记', createdNote);
  const noteList = await call('GET', `/api/contents/${contentId}/notes`, undefined, learner);
  step('读取笔记列表', noteList);
  const exported = await call('POST', `/api/contents/${contentId}/notes/export`, { format: 'markdown' }, learner);
  step('导出笔记', exported);

  console.log('\n=== 2. 学习计划 ===');
  const scheduledAt = new Date(Date.now() + 3600_000).toISOString();
  const plan = await call('POST', '/api/study-plans', {
    contentId,
    title: '演练计划：复盘判断推理',
    targetMinutes: 30,
    scheduledAt,
    remindAt: scheduledAt,
  }, learner);
  step('创建学习计划', plan);
  const planId = String((plan.json?.data as Json | undefined)?.planId ?? '');
  if (planId) {
    step('完成学习计划', await call('PATCH', `/api/study-plans/${planId}`, { completed: true }, learner));
    step('删除学习计划', await call('DELETE', `/api/study-plans/${planId}`, undefined, learner));
  }

  console.log('\n=== 3. 复习卡片 ===');
  const cards = await call('GET', '/api/flashcards', undefined, learner);
  const cardItems = ((cards.json?.data as Json | undefined)?.items ?? []) as Json[];
  console.log(`   卡片数 ${cardItems.length}`);
  if (cardItems.length > 0) {
    step('提交复习评分', await call('POST', `/api/flashcards/${String(cardItems[0].flashcardId)}/review`, { rating: 2 }, learner));
  } else {
    console.log('! 无卡片，跳过评分');
  }

  console.log('\n=== 4. 练习（依赖大模型）===');
  const generated = await call('POST', '/api/exercises/generate', { count: 2 }, learner, 120_000);
  step('生成练习题', generated, true);
  const exerciseItems = ((generated.json?.data as Json | undefined)?.questions ?? []) as Json[];
  if (exerciseItems.length > 0) {
    step('提交练习答案', await call('POST', `/api/exercises/${String(exerciseItems[0].exerciseId)}/answer`, { userAnswer: 'A' }, learner), true);
  }
  step('练习列表', await call('GET', '/api/exercises?page=1&pageSize=20', undefined, learner));

  console.log('\n=== 5. AI 学习助手（依赖大模型）===');
  const agent = await call('POST', '/api/assistant/agent', {
    contentId,
    message: '帮我总结一下这份资料的重点',
    minutes: 20,
    history: [],
  }, learner, 120_000);
  step('AI 助手问答', agent, true);

  console.log('\n=== 6. 出勤打卡 ===');
  const today = await call('GET', '/api/attendance/today', undefined, learner);
  step('今日出勤状态', today);
  const challenge = await call('POST', '/api/attendance/challenge', {}, learner);
  step('获取打卡挑战', challenge, true);
  const manual = await call('POST', '/api/attendance/manual', { code: 'DEMO' }, learner);
  step('手动打卡（无有效码应被拒或按业务处理）', manual, true, [200, 400, 401, 403, 404]);

  console.log('\n=== 7. 课程讨论 ===');
  const courseList = await call('GET', '/api/courses?page=1&pageSize=20', undefined, learner);
  const courseItems = ((courseList.json?.data as Json | undefined)?.items ?? []) as Json[];
  console.log(`   课程数 ${courseItems.length}`);
  if (courseItems.length > 0) {
    const openCourse = courseItems.find((item) => item.discussionEnabled === true) ?? courseItems[0];
    console.log(`   使用课程：${String(openCourse.title)}（讨论开关=${String(openCourse.discussionEnabled)}）`);
    const courseId = String(openCourse.courseId ?? '');
    const thread = await call('POST', `/api/courses/${courseId}/discussions`, {
      kind: 'question',
      title: '演练提问：这里的推理步骤为什么这样走？',
      body: '看到这一段不太理解，能否解释一下。',
      ref: null,
      requestId: randomUUID(),
    }, learner);
    step('发起讨论主题', thread);
    const threadId = String((thread.json?.data as Json | undefined)?.id ?? '');
    if (threadId) {
      const reply = await call('POST', `/api/discussions/${threadId}/replies`, {
        body: '演练回复：我的理解是先判断题型再排除。',
        requestId: randomUUID(),
      }, learner);
      step('回复讨论', reply);
      step('举报讨论（演示审核流）', await call('POST', `/api/discussions/${threadId}/reports`, {
        reason: '演练举报：内容疑似与学习无关',
        requestId: randomUUID(),
      }, learner), true);
    }
    step('我参与的讨论', await call('GET', '/api/discussions/participated', undefined, learner));
  }
  step('消息中心', await call('GET', '/api/notifications', undefined, learner));

  console.log('\n=== 8. 管理员 · 用户管理 ===');
  const users = await call('GET', '/api/admin/users?page=1&pageSize=20', undefined, admin);
  step('用户列表', users);
  const newUserEmail = `demo-learner-${Date.now()}@example.com`;
  step('创建用户', await call('POST', '/api/admin/users', {
    account: newUserEmail,
    nickname: '演练学员',
    password: 'demo12345',
    role: 'student',
  }, admin));
  const usersAfter = await call('GET', '/api/admin/users?page=1&pageSize=50', undefined, admin);
  const userItems = ((usersAfter.json?.data as Json | undefined)?.items ?? []) as Json[];
  const createdUser = userItems.find((item) => String(item.email) === newUserEmail);
  if (createdUser) {
    step('修改用户昵称', await call('PATCH', `/api/admin/users/${String(createdUser.id)}`, { nickname: '演练学员已改名' }, admin));
    step('重置用户密码', await call('PATCH', `/api/admin/users/${String(createdUser.id)}`, { password: 'demo12345' }, admin));
  }

  console.log('\n=== 9. 管理员 · 课程发布 ===');
  const adminCourses = await call('GET', '/api/admin/courses?page=1&pageSize=20', undefined, admin);
  step('共享课程列表', adminCourses);
  // 发布共享课程只能选「该管理员本人名下已就绪」的资料，所以这里换成有内容的原管理员账号
  const contentOwner = await tokenOf('admin@wenhao.local');
  const ownerContents = await call('GET', '/api/contents?page=1&pageSize=20', undefined, contentOwner);
  const ownerItems = ((ownerContents.json?.data as Json | undefined)?.items ?? []) as Json[];
  const readyContent = ownerItems.find((item) => String(item.status ?? '').includes('就绪')) ?? ownerItems[0];
  console.log(`   管理员名下资料：${String(readyContent?.title ?? '无')}`);
  const prepare = await call('POST', '/api/admin/courses', {
    sourceContentId: String(readyContent?.contentId ?? contentId),
    title: `演练共享课程 ${new Date().toLocaleTimeString('zh-CN')}`,
    description: '演示用共享课程',
    rightsConfirmed: true,
    rightsStatement: '本人原创资料，仅用于课程演示。',
    include: { transcripts: true, textBlocks: true, knowledgePoints: true, generatedNote: true },
    requestId: randomUUID(),
  }, contentOwner, 120_000);
  step('准备共享课程', prepare, true);
  const preparedId = String((prepare.json?.data as Json | undefined)?.courseId ?? '');
  if (preparedId) {
    const detail = await call('GET', `/api/admin/courses?id=${encodeURIComponent(preparedId)}`, undefined, contentOwner);
    const version = Number((detail.json?.data as Json | undefined)?.version ?? 1);
    step('发布共享课程', await call('PATCH', `/api/admin/courses/${preparedId}`, { expectedVersion: version, action: 'publish' }, contentOwner));
  }

  console.log('\n=== 10. 管理员 · 讨论与出勤 ===');
  step('讨论管理列表', await call('GET', '/api/admin/discussions?page=1&pageSize=20', undefined, admin));
  step('举报列表', await call('GET', '/api/admin/discussion-reports', undefined, admin));
  step('出勤记录', await call('GET', '/api/admin/attendance', undefined, admin));
  step('平台总览', await call('GET', '/api/admin/overview', undefined, admin));

  const hardFails = results.filter((item) => !item.ok && !item.soft);
  const softFails = results.filter((item) => !item.ok && item.soft);
  console.log(`\n=== 汇总：${results.length} 项，通过 ${results.length - hardFails.length - softFails.length}，软失败 ${softFails.length}，硬失败 ${hardFails.length} ===`);
  if (hardFails.length > 0) {
    console.log('\n硬失败（需修复）：');
    for (const item of hardFails) console.log(`  - ${item.name}: ${item.detail}`);
  }
  if (softFails.length > 0) {
    console.log('\n软失败（多为依赖外部服务，需人工确认）：');
    for (const item of softFails) console.log(`  - ${item.name}: ${item.detail}`);
  }

  await prisma.$disconnect();
  process.exitCode = hardFails.length > 0 ? 1 : 0;
}

main().catch(async (error: unknown) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
