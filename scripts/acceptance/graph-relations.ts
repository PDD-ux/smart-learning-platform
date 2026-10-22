import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PrismaClient, type Prisma, type KnowledgePoint } from '@prisma/client';
import { loadEnvConfig } from '@next/env';
import { hashPassword } from '../../src/lib/auth/password';
import { signAccessToken } from '../../src/lib/auth/jwt';
import { buildGraphStage } from '../../src/lib/jobs/pipeline/graph-build.stage';
loadEnvConfig(process.cwd());
const prisma = new PrismaClient();
type SourcePoint = { title: string; summary: string; tags: string[]; importance: number; refs: Prisma.InputJsonValue };
async function main(): Promise<void> {
  const [mode, runId, scenario = 'example'] = process.argv.slice(2);
  assert.ok(['setup', 'cleanup'].includes(mode) && /^[a-z0-9-]{8,60}$/.test(runId ?? ''), '需要 setup|cleanup 和独立 runId');
  assert.ok(['example', 'relation-types'].includes(scenario), '仅支持 example 或 relation-types 场景');
  const ownerId = 'graph-acceptance-' + runId;
  const destination = 'docs/acceptance/graph-relations-' + runId + '.json';
  try {
    if (mode === 'cleanup') {
      const contents = await prisma.learningContent.findMany({ where: { ownerId }, select: { id: true } });
      await prisma.user.deleteMany({ where: { id: ownerId } });
      const remaining = await prisma.learningContent.count({ where: { ownerId } });
      const evidence = JSON.parse(await readFile(destination, 'utf8')) as Record<string, unknown>;
      evidence.cleanup = { finishedAt: new Date().toISOString(), contentsRemoved: contents.length, remaining, sharedMedia: false, storageObjectsCreated: false };
      await writeFile(destination, JSON.stringify(evidence, null, 2) + '\n');
      assert.equal(remaining, 0); console.log('临时图谱账号及资料已清理'); return;
    }
    const password = process.env.UI_ACCEPTANCE_PASSWORD;
    assert.ok(password && password.length >= 12, '仅从环境变量提供临时 UI 密码');
    const sourceFile = 'docs/acceptance/real-ai-flow-20261009-a290c048-362f-4c5d-b0ad-66ca1bad8356.json';
    const source = JSON.parse(await readFile(sourceFile, 'utf8')) as { products: { knowledgePoints: SourcePoint[] } };
    const relationPoints: SourcePoint[] = [
      { title: '梯度', summary: '梯度由损失函数对参数的偏导数组成，指向函数值增长最快的方向。学习梯度下降参数更新公式前，必须先理解梯度的定义与方向。', tags: ['优化'], importance: 0.9, refs: [{ page: 1 }] },
      { title: '梯度下降参数更新公式', summary: '参数按新参数 = 旧参数 - 学习率 × 梯度更新。该公式以梯度定义为前置知识；它和学习率选择是同一梯度下降步骤中的两个相关知识点，分别说明更新计算和步长设置。', tags: ['优化'], importance: 0.9, refs: [{ page: 1 }] },
      { title: '学习率选择', summary: '学习率是梯度下降更新公式中的步长参数。学习率过大会越过最小值，过小则收敛缓慢。它与参数更新公式是同一主题的相关知识，不是该公式的前置定义。', tags: ['优化'], importance: 0.8, refs: [{ page: 1 }] },
    ];
    const selectedPoints = scenario === 'relation-types' ? relationPoints : source.products.knowledgePoints;
    const evidence: Record<string, unknown> = { startedAt: new Date().toISOString(), scenario, sourceFile: scenario === 'example' ? sourceFile : null, scope: scenario === 'example' ? '复用已验收的真实 AI 知识点，仅关系重新调用星火；临时 DB 资料，无上传对象' : '人工撰写三个知识点摘要作为关系类型定向样本；真实星火生成关系，非全链路导入或知识点抽取；临时 DB 资料，无上传对象', status: 'running' };
    await mkdir('docs/acceptance', { recursive: true });
    try {
      await prisma.user.create({ data: { id: ownerId, email: ownerId + '@example.com', nickname: '图谱隔离验收', passwordHash: await hashPassword(password) } });
      const content = await prisma.learningContent.create({ data: { ownerId, contentType: 'DOCUMENT', title: scenario === 'example' ? '图谱验收 · 梯度下降' : '图谱关系类型验收 · 梯度下降', fileName: 'graph-acceptance.md', format: 'MD', fileSizeBytes: BigInt(0), storageKey: 'acceptance-no-object/' + randomUUID(), status: 'READY', understandingStatus: 'COMPLETED', pageCount: 1 } });
      evidence.contentId = content.id;
      const points: KnowledgePoint[] = [];
      for (const point of selectedPoints) {
        points.push(await prisma.knowledgePoint.create({ data: { title: point.title, summary: point.summary, tags: point.tags, importance: point.importance, refs: point.refs, contentId: content.id, ownerId } }));
      }
      evidence.points = points.map(({ id, title, summary }) => ({ id, title, summary }));
      await buildGraphStage({ contentId: content.id, traceId: randomUUID(), degraded: { infer: false, asr: false } });
      const token = signAccessToken({ sub: ownerId, email: ownerId + '@example.com', role: 'student' });
      const response = await fetch('http://localhost:3000/api/contents/' + content.id + '/graph', { headers: { authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(30000) });
      const body = await response.json() as { success: boolean; data: { nodes: { pointId: string }[]; edges: { source: string; target: string; relation: string }[] } };
      evidence.httpStatus = response.status; evidence.graph = body.data;
      assert.equal(response.status, 200); assert.equal(body.success, true);
      assert.equal(body.data.nodes.length, 3, '三个不同知识点不应合并');
      assert.ok(body.data.edges.length > 0, '应有实际 AI 关系');
      if (scenario === 'example') {
        assert.ok(body.data.edges.some((edge) => edge.source === points[2].id && edge.target === points[1].id && edge.relation === 'example_of'), '算例是公式的例子，方向必须准确');
      } else {
        assert.ok(body.data.edges.some((edge) => edge.source === points[0].id && edge.target === points[1].id && edge.relation === 'prerequisite'), '梯度定义应为更新公式的前置知识');
        assert.ok(body.data.edges.some((edge) => [edge.source, edge.target].includes(points[1].id) && [edge.source, edge.target].includes(points[2].id) && edge.relation === 'related'), '更新公式与学习率选择应为同层相关知识');
      }
      evidence.status = 'passed';
      console.log(JSON.stringify({ status: 'ready', contentId: content.id, account: ownerId + '@example.com', nodes: body.data.nodes.length, edges: body.data.edges.length }));
    } catch (error) {
      evidence.status = 'blocked'; evidence.failure = error instanceof Error ? error.message : '验收失败';
      process.exitCode = 1; console.log('图谱验收未通过：' + evidence.failure);
    } finally {
      evidence.finishedAt = new Date().toISOString();
      await writeFile(destination, JSON.stringify(evidence, null, 2) + '\n');
    }
  } finally { await prisma.$disconnect(); }
}
void main().catch((error: unknown): void => { console.log(error instanceof Error ? error.message : '图谱入口失败'); process.exitCode = 1; });
