/**
 * 只读演练脚本（用户端 + 管理员端）
 * ------------------------------------------------------------
 * 目的：演示前检查主要只读入口，提前暴露 500 / 校验失败 / 空数据等问题。
 * 用法：npx tsx scripts/demo/e2e-walkthrough.ts
 *
 * 输出：每个检查项打印 PASS / FAIL / WARN，末尾汇总。退出码 0 表示本脚本无 FAIL，不代表完整交互通过。
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

// 环境变量加载说明（很关键，别改成 process.loadEnvFile）：
//   1. tsx 脚本不会自动加载 .env.local，必须手动加载；
//   2. 但 @prisma/client 在 import 时会自行 dotenv 读取根目录 `.env`，
//      而 Next.js 的优先级是 .env.local > .env —— 两者相反；
//   3. process.loadEnvFile() 不会覆盖已存在的环境变量（Prisma 先写入的 .env 值会残留），
//      导致签发的 JWT 密钥与应用不一致 → 全部接口 401。
// 因此这里手写解析器，用 .env.local 的值**强制覆盖**。
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
    // 引号包裹的值：取到闭合引号为止（允许后面跟行内注释）
    const quote = value[0];
    if (quote === '"' || quote === "'") {
      const end = value.indexOf(quote, 1);
      value = end > 0 ? value.slice(1, end) : value.slice(1);
    } else {
      // 无引号：去掉行内注释
      const hash = value.indexOf(' #');
      if (hash >= 0) value = value.slice(0, hash).trim();
    }
    process.env[key] = value;
  }
}

// 只需覆盖 .env.local：.env 已由 Prisma 的 dotenv 载入，重复解析反而会破坏带行内注释的 DATABASE_URL
loadEnvOverride('.env.local');

import { PrismaClient } from '@prisma/client';
import { issueSession, toPublicUser, passwordVersion } from '../../src/lib/auth/session';

const prisma = new PrismaClient();

const BASE = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3000';
const STUDENT = { account: 'demo@wenhao.local', password: 'demo12345' };
const ADMIN = { account: 'demo-admin@wenhao.local', password: 'demo12345' };

type Result = { name: string; status: 'PASS' | 'FAIL' | 'WARN'; detail: string };
const results: Result[] = [];

function record(name: string, status: Result['status'], detail: string): void {
  results.push({ name, status, detail });
  const tag = status === 'PASS' ? '✔' : status === 'WARN' ? '!' : '�’✘';
  console.log(`${tag} [${status}] ${name} — ${detail}`);
}

type Json = Record<string, unknown>;

async function call(
  method: string,
  path: string,
  options: { token?: string; body?: unknown; timeoutMs?: number } = {},
): Promise<{ status: number; json: Json | null; text: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 30_000);
  try {
    const response = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal,
    });
    const text = await response.text();
    let json: Json | null = null;
    try {
      json = JSON.parse(text) as Json;
    } catch {
      json = null;
    }
    return { status: response.status, json, text: text.slice(0, 300) };
  } catch (error) {
    return { status: 0, json: null, text: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timer);
  }
}

/** 直接为数据库中某个用户签发 token（用于演练有数据的账号，绕过登录限流） */
async function mintToken(userId: string): Promise<string> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  return issueSession(toPublicUser(user), passwordVersion(user.passwordHash), true).accessToken;
}

/** 找出内容最多的学员，作为「有数据学员」演练对象 */
async function pickRichStudent(): Promise<{ id: string; nickname: string; count: number } | null> {
  const grouped = await prisma.learningContent.groupBy({
    by: ['ownerId'],
    _count: { _all: true },
    orderBy: { _count: { ownerId: 'desc' } },
    take: 10,
  });
  for (const row of grouped) {
    const user = await prisma.user.findUnique({ where: { id: row.ownerId } });
    if (user && user.role !== 'admin') {
      return { id: user.id, nickname: user.nickname, count: row._count._all };
    }
  }
  return null;
}

async function login(cred: { account: string; password: string }): Promise<string | null> {
  const res = await call('POST', '/api/auth/login', { body: cred });
  if (res.status !== 200) {
    console.log(`   login failed: ${res.status} ${res.text}`);
    return null;
  }
  const data = (res.json?.data ?? {}) as Json;
  return typeof data.accessToken === 'string' ? data.accessToken : null;
}

/** 统一判定：2xx 记 PASS；401/403 记 FAIL（鉴权问题）；404 记 WARN（可能无数据）；5xx 记 FAIL */
function check(name: string, res: { status: number; json: Json | null; text: string }, expect?: (json: Json) => string | null): void {
  if (res.status >= 500) {
    record(name, 'FAIL', `HTTP ${res.status} ${res.text}`);
    return;
  }
  if (res.status === 401 || res.status === 403) {
    record(name, 'FAIL', `HTTP ${res.status} 鉴权异常 ${res.text}`);
    return;
  }
  if (res.status === 404) {
    record(name, 'WARN', `HTTP 404 ${res.text}`);
    return;
  }
  if (res.status >= 400) {
    record(name, 'FAIL', `HTTP ${res.status} ${res.text}`);
    return;
  }
  if (expect && res.json) {
    const problem = expect(res.json);
    if (problem) {
      record(name, 'WARN', problem);
      return;
    }
  }
  record(name, 'PASS', `HTTP ${res.status}`);
}

function isOk(json: Json): boolean {
  return json.success === true || json.ok === true;
}

async function main(): Promise<void> {
  console.log('=== 1. 认证链路 ===');
  const studentToken = await login(STUDENT);
  record('学员登录 /api/auth/login', studentToken ? 'PASS' : 'FAIL', studentToken ? '取得 accessToken' : '登录失败');
  const adminToken = await login(ADMIN);
  record('管理员登录 /api/auth/login', adminToken ? 'PASS' : 'FAIL', adminToken ? '取得 accessToken' : '登录失败');

  if (!studentToken || !adminToken) {
    console.log('登录失败，后续演练中止');
    return;
  }

  const guard = await call('GET', '/api/contents', {});
  record('无 token 访问受保护接口应 401', guard.status === 401 ? 'PASS' : 'FAIL', `HTTP ${guard.status}`);

  // 用数据最丰富的学员演练，才能真正验证功能（新建演示账号数据为空）
  const rich = await pickRichStudent();
  let learnerToken = studentToken;
  if (rich) {
    learnerToken = await mintToken(rich.id);
    console.log(`   （有数据学员：${rich.nickname}，${rich.count} 份内容）`);
  }

  console.log('\n=== 2. 用户端 · 内容/学习 ===');
  const contents = await call('GET', '/api/contents?page=1&pageSize=20', { token: learnerToken });
  check('内容列表 /api/contents', contents, (json) => {
    const list = (json.data as Json)?.items ?? (json.data as Json)?.list ?? json.data;
    return Array.isArray(list) && list.length > 0 ? null : '内容列表为空';
  });
  const firstContentId = (() => {
    const data = contents.json?.data as Json | undefined;
    const list = (data?.items ?? data?.list ?? data) as unknown;
    if (!Array.isArray(list) || list.length === 0) return null;
    const first = list[0] as Json;
    return String(first.contentId ?? first.id ?? '');
  })();

  const courses = await call('GET', '/api/courses?page=1&pageSize=20', { token: learnerToken });
  check('课程列表 /api/courses', courses, (json) => {
    const data = json.data as Json | undefined;
    const list = (data?.items ?? data?.list ?? data) as unknown;
    return Array.isArray(list) && list.length > 0 ? null : '课程列表为空（可后续在管理员端发布）';
  });

  if (firstContentId) {
    const detail = await call('GET', `/api/contents/${firstContentId}`, { token: learnerToken });
    check(`内容详情 /api/contents/${firstContentId}`, detail);

    const progress = await call('GET', `/api/contents/${firstContentId}/progress`, { token: learnerToken });
    check('学习进度读取', progress);

    const notes = await call('GET', `/api/contents/${firstContentId}/notes`, { token: learnerToken });
    check('内容笔记列表', notes);

    const graph = await call('GET', `/api/contents/${firstContentId}/graph`, { token: learnerToken });
    check('内容知识图谱', graph, (json) => {
      const data = json.data as Json | undefined;
      const nodes = (data?.nodes ?? data) as unknown;
      return Array.isArray(nodes) && nodes.length > 0 ? null : '图谱节点为空';
    });

    const resource = await call('GET', `/api/contents/${firstContentId}/resource`, { token: learnerToken });
    check('内容资源（播放地址）', resource);
  } else {
    record('内容相关子接口', 'WARN', '无内容，跳过');
  }
  if (rich) {
    const book = (await prisma.learningContent.findMany({ where: { ownerId: rich.id, contentType: 'DOCUMENT', status: 'READY' }, select: { id: true, bookState: true } })).find((item): boolean => item.bookState !== null);
    if (book?.bookState) {
      check('书籍目录与阅读状态', await call('GET', `/api/contents/${book.id}/book`, { token: learnerToken }));
      check('章节原文笔记', await call('GET', `/api/contents/${book.id}/reading-notes`, { token: learnerToken }));
    } else record('书籍目录与章节笔记', 'WARN', '现有演示账号没有已建立目录的书籍；需使用隔离资料演练');
  }

  console.log('\n=== 3. 用户端 · 笔记 / 复习 / 图谱 / 掌握度 ===');
  check('笔记列表 /api/notes', await call('GET', '/api/notes?page=1&pageSize=20', { token: learnerToken }));
  check('笔记搜索 /api/notes/search?q=笔记', await call('GET', '/api/notes/search?q=%E7%AC%94%E8%AE%B0', { token: learnerToken }));
  check('复习卡片 /api/flashcards', await call('GET', '/api/flashcards', { token: learnerToken }), (json) => {
    const list = (json.data as Json)?.items ?? json.data;
    return Array.isArray(list) && list.length > 0 ? null : '暂无复习卡片';
  });
  check('知识图谱总览 /api/graph/overview', await call('GET', '/api/graph/overview', { token: learnerToken }), (json) => {
    const data = json.data as Json | undefined;
    const nodes = (data?.nodes ?? data) as unknown;
    return Array.isArray(nodes) && nodes.length > 0 ? null : '图谱为空';
  });
  check('掌握度 /api/mastery', await call('GET', '/api/mastery', { token: learnerToken }));
  check('薄弱点 /api/mastery/weak-points', await call('GET', '/api/mastery/weak-points', { token: learnerToken }));
  check('游戏化档案 /api/gamification/profile', await call('GET', '/api/gamification/profile', { token: learnerToken }));
  check('通知列表 /api/notifications', await call('GET', '/api/notifications', { token: learnerToken }));
  check('学习计划 /api/study-plans', await call('GET', '/api/study-plans', { token: learnerToken }));

  console.log('\n=== 4. 三条核心主线的本人只读入口 ===');
  check('专题学习 /api/study-topics', await call('GET', '/api/study-topics', { token: learnerToken }));
  check('班级课程 /api/classes', await call('GET', '/api/classes', { token: learnerToken }));
  check('管理员负责的班级 /api/classes', await call('GET', '/api/classes', { token: adminToken }));
  check('本人作业校对 /api/homework', await call('GET', '/api/homework', { token: learnerToken }));
  check('本人作业错因 /api/homework/mistakes', await call('GET', '/api/homework/mistakes', { token: learnerToken }));
  const otherHomework = await call('GET', '/api/homework', { token: adminToken });
  record('管理员不能读取学员个人校对列表', otherHomework.status === 404 ? 'PASS' : 'FAIL', `HTTP ${otherHomework.status}`);
  const retiredExam = await call('GET', '/api/exams', { token: learnerToken });
  record('旧试卷 API 已下线', retiredExam.status === 410 ? 'PASS' : 'FAIL', `HTTP ${retiredExam.status}`);

  console.log('\n=== 5. 用户端 · 出勤 ===');
  check('今日出勤 /api/attendance/today', await call('GET', '/api/attendance/today', { token: learnerToken }));
  check('人脸模板状态 /api/face/template', await call('GET', '/api/face/template', { token: learnerToken }));

  console.log('\n=== 6. 管理员端 ===');
  check('总览 /api/admin/overview', await call('GET', '/api/admin/overview', { token: adminToken }));
  check('用户管理 /api/admin/users', await call('GET', '/api/admin/users?page=1&pageSize=20', { token: adminToken }), (json) => {
    const list = (json.data as Json)?.items ?? json.data;
    return Array.isArray(list) && list.length > 0 ? null : '用户列表为空';
  });
  check('课程管理 /api/admin/courses', await call('GET', '/api/admin/courses?page=1&pageSize=20', { token: adminToken }));
  check('讨论管理 /api/admin/discussions', await call('GET', '/api/admin/discussions?page=1&pageSize=20', { token: adminToken }));
  check('举报处理 /api/admin/discussion-reports', await call('GET', '/api/admin/discussion-reports', { token: adminToken }));
  check('出勤管理 /api/admin/attendance', await call('GET', '/api/admin/attendance', { token: adminToken }));

  console.log('\n=== 7. 越权防护（学员访问管理员接口）===');
  const cross = await call('GET', '/api/admin/users', { token: studentToken });
  record('学员访问 /api/admin/users 应被拒绝', cross.status === 403 ? 'PASS' : 'FAIL', `HTTP ${cross.status}`);

  console.log('\n=== 8. 页面可访问性（未登录跳转 / 已登录 200）===');
  const pages = [
    '/', '/login', '/register', '/dashboard', '/import', '/notes', '/review', '/graph',
    '/assistant', '/attendance', '/study-plans', '/classes', '/homework',
    '/messages', '/question-bank', '/help',
    '/admin', '/admin/users', '/admin/courses', '/admin/classes',
    '/admin/discussions', '/admin/attendance',
  ];
  for (const page of pages) {
    const res = await fetch(`${BASE}${page}`, {
      headers: { Authorization: `Bearer ${page.startsWith('/admin') ? adminToken : studentToken}` },
    });
    const html = await res.text();
    const isErrorPage = html.includes('Application error') || html.includes('__NEXT_ERROR');
    record(`页面 ${page}`, res.status === 200 && !isErrorPage ? 'PASS' : 'FAIL', `HTTP ${res.status}${isErrorPage ? ' 服务端渲染报错' : ''}`);
    // 页面较多，串行但控制总量
  }

  const failed = results.filter((r) => r.status === 'FAIL');
  const warned = results.filter((r) => r.status === 'WARN');
  console.log(`\n=== 汇总：${results.length} 项，PASS ${results.length - failed.length - warned.length}，WARN ${warned.length}，FAIL ${failed.length} ===`);
  if (failed.length > 0) {
    console.log('\n失败项：');
    for (const f of failed) console.log(`  - ${f.name}: ${f.detail}`);
  }
  if (warned.length > 0) {
    console.log('\n告警项（不影响演示但需留意）：');
    for (const w of warned) console.log(`  - ${w.name}: ${w.detail}`);
  }

  const reportDir = '.taskbook-working/local-demo';
  mkdirSync(reportDir, { recursive: true });
  writeFileSync(`${reportDir}/e2e-walkthrough-report.json`, JSON.stringify(results, null, 2), 'utf8');
  process.exitCode = failed.length > 0 ? 1 : 0;
  await prisma.$disconnect();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
