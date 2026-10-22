import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { loadEnvConfig } from '@next/env';
import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../../src/lib/auth/password';

loadEnvConfig(process.cwd());
const db = new PrismaClient();
const fixturePath = '.taskbook-working/graph-page-ui.json';
async function main(): Promise<void> {
  if (process.argv.includes('--cleanup-ui')) {
    const fixture = JSON.parse(await readFile(fixturePath, 'utf8')) as { id: string };
    assert.match(fixture.id, /^graph-page-audit-[a-f0-9-]{36}$/);
    await db.user.deleteMany({ where: { id: fixture.id } });
    await unlink(fixturePath);
    console.log(JSON.stringify({ temporaryFixtureCleaned: true }));
    return;
  }
  const base = process.env.ACCEPTANCE_BASE_URL ?? 'http://localhost:3000';
  assert.match(base, /^http:\/\/(localhost|127\.0\.0\.1):\d+$/);
  const id = 'graph-page-audit-' + randomUUID();
  const account = id + '@example.com';
  const password = randomUUID() + '!Aa9';
  let keep = false;
  try {
    await db.user.create({ data: { id, email: account, nickname: '图谱隔离验收', passwordHash: await hashPassword(password) } });
    const content = await db.learningContent.create({ data: { ownerId: id, contentType: 'DOCUMENT', title: '图谱页面人工验收讲义', fileName: 'fixture.txt', format: 'TXT', fileSizeBytes: BigInt(0), storageKey: 'graph-audit-no-object/' + id, status: 'READY', pageCount: 1 } });
    const point = await db.knowledgePoint.create({ data: { ownerId: id, contentId: content.id, title: '人工验收知识点', summary: '只用于页面验证，非AI生成', importance: 3, refs: [] } });
    await db.graphNode.create({ data: { pointId: point.id, nodeType: 'CONCEPT', aliases: [] } });
    await db.mastery.create({ data: { learnerId: id, pointId: point.id, score: 0.75, isWeak: false, reviewCount: 1 } });
    const login = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ account, password }) });
    assert.equal(login.status, 200);
    const token = (await login.json() as { data: { accessToken: string } }).data.accessToken;
    const graph = await fetch(base + '/api/contents/' + content.id + '/graph', { headers: { authorization: 'Bearer ' + token } });
    assert.equal(graph.status, 200);
    const result = await graph.json() as { data: { nodes: { pointId: string }[] } };
    assert.equal(result.data.nodes.length, 1);
    assert.equal(result.data.nodes[0].pointId, point.id);
    await mkdir('docs/acceptance', { recursive: true });
    await writeFile('docs/acceptance/graph-page-reliability-20261009.json', JSON.stringify({ time: new Date().toISOString(), realHttpPostgresql: true, localGraphNodePassed: true, artificialFixture: true, externalAiCalls: 0, realUserDataChanged: false }, null, 2) + '\n');
    if (process.argv.includes('--keep-ui')) {
      await mkdir('.taskbook-working', { recursive: true });
      await writeFile(fixturePath, JSON.stringify({ id, account, password, contentId: content.id }));
      keep = true;
    }
    console.log(JSON.stringify({ realHttpLocalGraphPassed: true, fixtureKeptForBrowser: keep }));
  } finally {
    if (!keep) await db.user.deleteMany({ where: { id } });
  }
}
void main().catch((): void => { console.error('图谱隔离验收失败，不输出凭据或原始响应'); process.exitCode = 1; }).finally(async (): Promise<void> => { await db.$disconnect(); });
