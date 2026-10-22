import { randomUUID } from 'node:crypto';
import { loadEnvConfig } from '@next/env';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getRedis } from '@/lib/redis';
import { getStorage, getStorageDriver } from '@/lib/storage';
import { prepareCourse, changeCourse } from '@/lib/courses/service';
import { toggleDiscussion } from '@/lib/discussions/moderation';
import type { AuthUser } from '@/lib/auth/middleware';

const DEMO_REQUEST_ID = '76f32bcc-e3db-4d4c-9e8a-bf64aeaa9094';
const TITLE = '演示课程：错题复盘的三步法（虚构）';
const DESCRIPTION = '虚构课堂资料，用于展示课程分享、提问、回复和站内消息；不含真实用户或第三方学习资料。';
const RIGHTS = '平台本机演示专用的原创虚构Markdown内容；不包含第三方或用户资料，仅在本机毕设演示。';
const MARKDOWN = `# 错题复盘的三步法（虚构课堂）

这份短课件是为本机演示原创的虚构示例。

## 第一步：还原当时的想法
先写下题目条件、自己的解法和卡住的位置，不急着看答案。

## 第二步：找出一个具体差异
比较自己的步骤与正确依据，指出一个可以验证的差异，例如漏看条件或跳过了推理。

## 第三步：安排一次回练
用自己的话写出修正后的方法，并安排稍后独立重做。复盘的目标是找到下一步行动，不是给自己贴标签。

## 讨论提示
在不写个人隐私的前提下，交流哪一步最有帮助，以及怎样判断自己已经会独立完成。
`;

function assertLoopbackDatabase(): void {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error('DATABASE_URL 未配置');
  const url = new URL(raw);
  if (!['localhost', '127.0.0.1', '::1'].includes(url.hostname)) throw new Error('数据库不是本机回环地址，拒绝写入演示数据');
  if (getStorageDriver() !== 'local') throw new Error('当前对象存储不是 local，拒绝写入演示数据');
}

async function deleteTemporarySource(ownerId: string, sourceId: string | null, storageKey: string | null): Promise<void> {
  if (sourceId) await prisma.learningContent.deleteMany({ where: { id: sourceId, ownerId } });
  if (storageKey) await getStorage().deleteObject(storageKey);
}

async function ensureCourse(admin: AuthUser): Promise<string> {
  const existing = await prisma.sharedCourse.findUnique({
    where: { publisherId_requestId: { publisherId: admin.id, requestId: DEMO_REQUEST_ID } },
  });
  let courseId = existing?.id;
  if (existing) {
    if (existing.title !== TITLE || existing.description !== DESCRIPTION || existing.rightsStatement !== RIGHTS || !existing.rightsConfirmed || existing.contentType !== 'DOCUMENT' || existing.format !== 'md' || existing.fileSizeBytes !== BigInt(Buffer.byteLength(MARKDOWN))) {
      throw new Error('固定演示请求键已对应其他内容，拒绝覆盖');
    }
    if (existing.sourceContentId) {
      const source = await prisma.learningContent.findFirst({ where: { id: existing.sourceContentId, ownerId: admin.id } });
      if (!source || !source.storageKey.startsWith('demo-interactions/source/') || source.title !== TITLE || source.format.toLowerCase() !== 'md') throw new Error('发现非演示来源，拒绝清理或覆盖');
      await deleteTemporarySource(admin.id, source.id, source.storageKey);
    }
  } else {
    if (await prisma.sharedCourse.findFirst({ where: { title: TITLE } })) throw new Error('同名课程已存在，拒绝创建重复演示课程');
    const sourceId: string | null = null;
    let temporarySourceId: string | null = sourceId;
    let sourceKey: string | null = `demo-interactions/source/${randomUUID()}.md`;
    try {
      await getStorage().putObject(sourceKey, Buffer.from(MARKDOWN, 'utf8'), { contentType: 'text/markdown; charset=utf-8', contentLength: Buffer.byteLength(MARKDOWN) });
      const source = await prisma.learningContent.create({ data: {
        ownerId: admin.id, contentType: 'DOCUMENT', title: TITLE, description: DESCRIPTION, fileName: 'fictional-review-method.md', format: 'md',
        pageCount: 1, fileSizeBytes: BigInt(Buffer.byteLength(MARKDOWN)), storageKey: sourceKey, status: 'READY', understandingStatus: 'COMPLETED',
      } });
      temporarySourceId = source.id;
      const prepared = await prepareCourse(admin, {
        sourceContentId: source.id, title: TITLE, description: DESCRIPTION, rightsConfirmed: true, rightsStatement: RIGHTS,
        include: { transcripts: false, textBlocks: false, knowledgePoints: false, generatedNote: false }, requestId: DEMO_REQUEST_ID,
      });
      courseId = prepared.id;
    } finally {
      await deleteTemporarySource(admin.id, temporarySourceId, sourceKey);
      temporarySourceId = null;
      sourceKey = null;
    }
  }
  if (!courseId) throw new Error('演示课程创建失败');
  return courseId;
}

async function publishAndOpen(admin: AuthUser, courseId: string): Promise<void> {
  let course = await prisma.sharedCourse.findUnique({ where: { id: courseId } });
  if (!course || course.publisherId !== admin.id || !course.preparedAt) throw new Error('演示课程不是本管理员准备的完整副本');
  if (course.state !== 'PUBLISHED') course = await changeCourse(admin, courseId, course.version, 'publish');
  if (!course.discussionEnabled) {
    const response = await toggleDiscussion(new NextRequest(`http://127.0.0.1:3100/api/admin/courses/${courseId}/discussion`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expectedVersion: course.version, enabled: true, reason: '本机虚构互动演示课程' }),
    }), admin, courseId);
    if (!response.ok) throw new Error('现有课程讨论开关服务拒绝开启');
  }
  const ready = await prisma.sharedCourse.findUnique({ where: { id: courseId }, select: { state: true, discussionEnabled: true, sourceContentId: true } });
  if (ready?.state !== 'PUBLISHED' || !ready.discussionEnabled || ready.sourceContentId !== null) throw new Error('课程未达到发布与讨论验收条件');
}

async function withdraw(admin: AuthUser): Promise<void> {
  const course = await prisma.sharedCourse.findUnique({ where: { publisherId_requestId: { publisherId: admin.id, requestId: DEMO_REQUEST_ID } } });
  if (!course) { console.log('本机虚构互动课程尚未创建。'); return; }
  if (course.title !== TITLE || course.rightsStatement !== RIGHTS) throw new Error('请求键对应内容不匹配，拒绝下架');
  let current = course;
  if (current.state === 'PUBLISHED' && current.discussionEnabled) {
    const response = await toggleDiscussion(new NextRequest(`http://127.0.0.1:3100/api/admin/courses/${current.id}/discussion`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expectedVersion: current.version, enabled: false, reason: '结束本机虚构互动演示' }),
    }), admin, current.id);
    if (!response.ok) throw new Error('现有课程讨论开关服务拒绝关闭');
    current = await prisma.sharedCourse.findUniqueOrThrow({ where: { id: current.id } });
  }
  if (current.state !== 'WITHDRAWN') await changeCourse(admin, current.id, current.version, 'withdraw');
  console.log('本机虚构互动课程已下架；课程媒体保留，可再次运行 seed 重新发布。');
}

async function main(): Promise<void> {
  loadEnvConfig(process.cwd(), true);
  assertLoopbackDatabase();
  const adminRow = await prisma.user.findFirst({ where: { role: 'admin' }, orderBy: { createdAt: 'asc' }, select: { id: true, email: true } });
  if (!adminRow) throw new Error('本机数据库没有管理员账号，无法通过现有发布服务');
  const admin: AuthUser = { ...adminRow, role: 'admin' };
  const action = process.argv[2] ?? 'seed';
  if (action === 'withdraw') { await withdraw(admin); return; }
  if (action !== 'seed') throw new Error('用法：npx tsx scripts/demo/local-interaction-course.ts [seed|withdraw]');
  const courseId = await ensureCourse(admin);
  await publishAndOpen(admin, courseId);
  console.log(JSON.stringify({ status: 'ready', title: TITLE, courseId, url: `http://127.0.0.1:3100/courses/${courseId}`, sourceContentRemoved: true, discussionEnabled: true }));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : '本机互动演示准备失败');
  process.exitCode = 1;
}).finally(async (): Promise<void> => { getRedis().disconnect(); await prisma.$disconnect(); });
