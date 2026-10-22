import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadEnvConfig } from '@next/env';

loadEnvConfig(process.cwd(), true);

async function main(): Promise<void> {
  const output = path.resolve(process.argv[2] ?? '');
  const input = path.resolve(process.argv[3] ?? '');
  const working = path.resolve('.taskbook-working') + path.sep;
  assert.ok(output.startsWith(working) && input.startsWith(working), 'Ignored input and new output required');
  await mkdir(output, { recursive: false });
  const { prisma } = await import('../../src/lib/prisma');
  const { hashPassword } = await import('../../src/lib/auth/password');
  const { getStorage } = await import('../../src/lib/storage');
  const ownerId = `pdf-positive-${randomUUID()}`;
  const password = randomUUID() + '!Aa9';
  const base = 'http://localhost:3000';
  let token = '';
  let passed = false;
  let reason = '';
  let storageKey = '';
  let products: unknown = null;
  const started = Date.now();
  async function api(route: string, body?: unknown): Promise<Record<string, unknown>> {
    const response = await fetch(`${base}/api/${route}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30_000),
    });
    assert.equal(response.status, 200, `Unexpected status: ${route}`);
    return (await response.json() as { data: Record<string, unknown> }).data;
  }
  try {
    await prisma.user.create({ data: { id: ownerId, email: `${ownerId}@example.test`, passwordHash: await hashPassword(password), nickname: '三页PDF隔离验收' } });
    token = String((await api('auth/login', { account: `${ownerId}@example.test`, password })).accessToken);
    const bytes = await readFile(input);
    const intent = await api('contents/upload-intent', { contentType: 'document', fileName: 'three-pages.pdf', fileSize: bytes.length, mimeType: 'application/pdf' });
    const contentId = String(intent.contentId);
    const owned = await prisma.learningContent.findUniqueOrThrow({ where: { id: contentId } });
    assert.equal(owned.ownerId, ownerId);
    storageKey = owned.storageKey;
    const upload = await fetch(new URL(String(intent.uploadUrl), base), { method: 'PUT', headers: { 'content-type': 'application/pdf' }, body: bytes });
    assert.equal(upload.status, 200);
    await api(`contents/${contentId}/complete`, { size: bytes.length });
    let completed = false;
    for (let attempt = 0; attempt < 180; attempt += 1) {
      const row = await prisma.learningContent.findUniqueOrThrow({ where: { id: contentId }, include: { asyncJobs: true } });
      if (row.asyncJobs.length >= 2 && row.asyncJobs.every((job): boolean => ['SUCCEEDED', 'FAILED'].includes(job.state))) {
        assert.equal(row.status, 'READY');
        assert.equal(row.understandingStatus, 'COMPLETED', row.asyncJobs.find((job): boolean => Boolean(job.errorReason))?.errorReason ?? 'Understanding did not complete');
        completed = true;
        break;
      }
      await new Promise((resolve): void => { setTimeout(resolve, 1000); });
    }
    assert.ok(completed, 'Bounded pipeline timeout');
    const row = await prisma.learningContent.findUniqueOrThrow({ where: { id: contentId }, include: { textBlocks: true, knowledgePoints: true, flashcards: true, generatedNote: true } });
    assert.equal(row.pageCount, 3);
    assert.equal(row.textBlocks.length, 3);
    assert.ok(row.knowledgePoints.length > 0);
    assert.equal(row.flashcards.length, row.knowledgePoints.length);
    assert.equal(row.generatedNote?.sourceCount, row.knowledgePoints.length);
    for (const point of row.knowledgePoints) {
      assert.ok(Array.isArray(point.refs) && point.refs.length > 0);
      for (const ref of point.refs as Array<{ type: string; page: number }>) assert.ok(ref.type === 'document' && ref.page >= 1 && ref.page <= 3);
    }
    const noteDto = (await api(`contents/${contentId}/generated-note`)).note as { sourceCount: number; markdown: string };
    assert.equal(noteDto.sourceCount, row.knowledgePoints.length);
    assert.equal(noteDto.markdown, row.generatedNote?.markdown);
    const understanding = await api(`contents/${contentId}/understanding`);
    assert.equal((understanding.knowledgePoints as unknown[]).length, row.knowledgePoints.length);
    const cards = await api(`flashcards?contentId=${contentId}`);
    assert.equal(cards.total, row.flashcards.length);
    const resource = await api(`contents/${contentId}/resource`);
    const original = await fetch(new URL(String(resource.url), base));
    assert.equal(original.status, 200);
    assert.ok(Buffer.from(await original.arrayBuffer()).equals(bytes));
    assert.equal((await fetch(`${base}/api/contents/${contentId}/understanding`)).status, 401);
    products = { parsedPages: row.pageCount, textBlocks: row.textBlocks.length, points: row.knowledgePoints, cards: row.flashcards, note: row.generatedNote };
    await writeFile(path.join(output, 'products.json'), JSON.stringify(products, null, 2));
    passed = true;
  } catch (error) {
    reason = error instanceof Error ? error.message.slice(0, 300) : 'UNKNOWN';
  } finally {
    if (storageKey) await getStorage().deleteObject(storageKey);
    await prisma.user.deleteMany({ where: { id: ownerId } });
    const cleaned = !await prisma.user.findUnique({ where: { id: ownerId } });
    await writeFile(path.join(output, 'report.json'), JSON.stringify({ passed, reason, durationMs: Date.now() - started, realHttpImport: true, realSparkConfigured: true,
      generatedNoteAndCardsVerified: passed, resourceBytesAndAnonymousAuthVerified: passed, temporaryFixtureCleaned: cleaned,
      temporaryUploadDeleted: storageKey ? !await getStorage().statObject(storageKey) : true, full222PageAcceptance: false, semanticAccuracyAccepted: false }, null, 2));
    await prisma.$disconnect();
    console.log(JSON.stringify({ passed, reason, cleaned }));
    if (!passed) process.exitCode = 1;
  }
}

void main().catch((): void => { console.error('PDF acceptance did not finish (no raw error)'); process.exitCode = 1; });
