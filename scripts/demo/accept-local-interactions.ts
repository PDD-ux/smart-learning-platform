import { randomBytes, randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { loadEnvConfig } from '@next/env';
import { prisma } from '@/lib/prisma';

const BASE_URL = 'http://127.0.0.1:3100';
const DEMO_REQUEST_ID = '76f32bcc-e3db-4d4c-9e8a-bf64aeaa9094';
const COURSE_TITLE = '演示课程：错题复盘的三步法（虚构）';
const THREAD_TITLE = '演示提问：怎样判断复盘方法已经掌握？';
type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown, stage: string): JsonRecord {
  if (!isRecord(value)) throw new Error(`${stage}：响应格式无效`);
  return value;
}

function assertLocalDatabase(): void {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error('DATABASE_URL 未配置');
  const database = new URL(raw);
  if (!['localhost', '127.0.0.1', '::1'].includes(database.hostname)) throw new Error('数据库不是本机回环地址，拒绝执行互动验收');
  if ((process.env.STORAGE_DRIVER ?? 'local').toLowerCase() !== 'local') throw new Error('对象存储不是local，拒绝执行互动验收');
}

async function api(token: string, method: 'GET' | 'POST', route: string, body?: JsonRecord): Promise<JsonRecord> {
  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${route}`, {
      method,
      headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(15000),
      redirect: 'error',
    });
  } catch {
    throw new Error(`无法连接本机演示服务：${method} ${route}`);
  }
  const payload: unknown = await response.json().catch((): null => null);
  if (!response.ok || !isRecord(payload) || payload.success !== true) {
    const apiError = isRecord(payload) && isRecord(payload.error) ? payload.error : null;
    const code = apiError && typeof apiError.code === 'string' ? apiError.code : 'NO_CODE';
    const message = apiError && typeof apiError.message === 'string' ? apiError.message : '无公开错误说明';
    throw new Error(`${method} ${route} 失败：HTTP ${response.status} (${code}) ${message}`);
  }
  return requireRecord(payload.data, `${method} ${route}`);
}

async function temporaryStudent(nickname: string): Promise<{ id: string; account: string; password: string }> {
  const account = `interaction-demo-${randomUUID()}@example.test`;
  const password = randomBytes(32).toString('base64url');
  const row = await prisma.user.create({ data: { email: account, phone: null, passwordHash: await bcrypt.hash(password, 12), nickname, role: 'student' }, select: { id: true } });
  return { id: row.id, account, password };
}

async function login(account: string, password: string): Promise<string> {
  let response: Response;
  try {
    response = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ account, password, remember: false }),
      signal: AbortSignal.timeout(15000), redirect: 'error',
    });
  } catch {
    throw new Error('临时学习者无法通过本机登录接口登录');
  }
  const payload: unknown = await response.json().catch((): null => null);
  if (!response.ok || !isRecord(payload) || payload.success !== true || !isRecord(payload.data) || typeof payload.data.accessToken !== 'string') {
    const apiError = isRecord(payload) && isRecord(payload.error) ? payload.error : null;
    const code = apiError && typeof apiError.code === 'string' ? apiError.code : 'NO_CODE';
    throw new Error(`临时学习者登录失败：HTTP ${response.status} (${code})`);
  }
  return payload.data.accessToken;
}

async function cleanup(userIds: string[], courseId: string): Promise<void> {
  if (userIds.length === 0) return;
  await prisma.$transaction(async (tx): Promise<void> => {
    const threads = await tx.discussionThread.findMany({ where: { courseId, authorId: { in: userIds } }, select: { id: true } });
    const threadIds = threads.map((thread): string => thread.id);
    await tx.notification.deleteMany({ where: { OR: [{ recipientId: { in: userIds } }, ...(threadIds.length ? [{ threadId: { in: threadIds } }] : [])] } });
    await tx.discussionEvent.deleteMany({ where: { recipientId: { in: userIds } } });
    await tx.discussionReport.deleteMany({ where: { reporterId: { in: userIds } } });
    if (threadIds.length) await tx.discussionReply.deleteMany({ where: { threadId: { in: threadIds } } });
    if (threadIds.length) await tx.discussionThread.deleteMany({ where: { id: { in: threadIds } } });
    await tx.auditLog.deleteMany({ where: { actorId: { in: userIds } } });
    await tx.user.deleteMany({ where: { id: { in: userIds } } });
  });
}

async function main(): Promise<void> {
  loadEnvConfig(process.cwd(), true);
  assertLocalDatabase();
  const response = await fetch(`${BASE_URL}/login`, { signal: AbortSignal.timeout(4000), redirect: 'error' }).catch((): null => null);
  if (!response?.ok) throw new Error('3100端口的互动演示网页未就绪；先运行 start-local-interactions.cjs');
  const course = await prisma.sharedCourse.findUnique({ where: { publisherId_requestId: { publisherId: (await prisma.user.findFirstOrThrow({ where: { role: 'admin' }, select: { id: true } })).id, requestId: DEMO_REQUEST_ID } } });
  if (!course || course.title !== COURSE_TITLE || course.state !== 'PUBLISHED' || !course.discussionEnabled || course.sourceContentId !== null) throw new Error('本机虚构课程未按预期发布或讨论未开启');

  const users: string[] = [];
  try {
    const learnerA = await temporaryStudent('临时互动验收学习者甲'); users.push(learnerA.id);
    const learnerB = await temporaryStudent('临时互动验收学习者乙'); users.push(learnerB.id);
    const learnerAToken = await login(learnerA.account, learnerA.password);
    const learnerBToken = await login(learnerB.account, learnerB.password);

    const courseList = await api(learnerAToken, 'GET', '/api/courses?page=1&pageSize=20');
    const listed = Array.isArray(courseList.items) ? courseList.items : [];
    if (!listed.some((item: unknown): boolean => isRecord(item) && item.courseId === course.id && item.discussionEnabled === true)) throw new Error('学习者课程列表未显示已开启讨论的课程');

    const thread = await api(learnerAToken, 'POST', `/api/courses/${course.id}/discussions`, {
      kind: 'question', title: THREAD_TITLE, body: '请结合这门虚构课件，交流一个可验证的复盘标准。', ref: null, requestId: randomUUID(),
    });
    if (typeof thread.id !== 'string' || thread.title !== THREAD_TITLE) throw new Error('学习者甲提问未成功');
    const threadId = thread.id;

    const reply = await api(learnerBToken, 'POST', `/api/discussions/${threadId}/replies`, {
      body: '可以稍后遮住笔记独立重做，并检查能否说明每一步的依据。', requestId: randomUUID(),
    });
    if (reply.threadId !== threadId || typeof reply.id !== 'string') throw new Error('学习者乙回复未关联到正确主题');

    const visible = await api(learnerBToken, 'GET', `/api/courses/${course.id}/discussions?page=1&pageSize=20`);
    if (visible.total !== 1 || !Array.isArray(visible.items) || !visible.items.some((item: unknown): boolean => isRecord(item) && item.id === threadId)) throw new Error('另一位学习者看不到新主题');
    const replies = await api(learnerBToken, 'GET', `/api/discussions/${threadId}/replies?page=1&pageSize=20`);
    if (replies.total !== 1) throw new Error('主题回复列表数量不正确');

    const messages = await api(learnerAToken, 'GET', '/api/notifications?page=1&pageSize=20');
    const messageItems = Array.isArray(messages.items) ? messages.items : [];
    if (messages.total !== 1 || messages.unreadCount !== 1 || !messageItems.some((item: unknown): boolean => isRecord(item) && item.kind === 'reply' && typeof item.targetUrl === 'string' && item.targetUrl.includes(threadId))) throw new Error('主题作者没有收到指向本主题的未读回复消息');
    const ownMessages = await api(learnerBToken, 'GET', '/api/notifications?page=1&pageSize=20');
    if (ownMessages.total !== 0) throw new Error('回复者不应收到自己的回复通知');

    const participation = await api(learnerBToken, 'GET', '/api/discussions/participated?page=1&pageSize=20');
    if (participation.total !== 1 || !Array.isArray(participation.items) || !participation.items.some((item: unknown): boolean => isRecord(item) && item.id === threadId && item.courseTitle === COURSE_TITLE)) throw new Error('回复者的参与记录没有显示真实主题');
    console.log(JSON.stringify({ status: 'passed', courseTitle: COURSE_TITLE, checks: ['课程列表可见', '学习者甲提问', '学习者乙可见并回复', '甲收到未读消息及回看地址', '乙收到参与记录', '乙没有自回复通知'], temporaryAccounts: 2, temporaryDataRemoved: true }));
  } finally {
    await cleanup(users, course.id);
    const [remainingUsers, remainingThreads, remainingReplies, remainingNotifications] = await Promise.all([
      prisma.user.count({ where: { id: { in: users } } }),
      prisma.discussionThread.count({ where: { courseId: course.id, authorId: { in: users } } }),
      prisma.discussionReply.count({ where: { thread: { courseId: course.id, authorId: { in: users } } } }),
      prisma.notification.count({ where: { recipientId: { in: users } } }),
    ]);
    if (remainingUsers + remainingThreads + remainingReplies + remainingNotifications !== 0) throw new Error('临时互动验收数据未完全清理');
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : '本机互动验收失败');
  process.exitCode = 1;
}).finally(async (): Promise<void> => { await prisma.$disconnect(); });
