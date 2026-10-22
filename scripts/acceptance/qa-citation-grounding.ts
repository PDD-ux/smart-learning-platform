import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { loadEnvConfig } from '@next/env';
import { PrismaClient } from '@prisma/client';
import { signAccessToken } from '../../src/lib/auth/jwt';
import { groundQaCitations, type QaCitation } from '../../src/lib/domain/qa-citations';
import { buildStructuredContext } from '../../src/lib/jobs/pipeline/context-builder';

loadEnvConfig(process.cwd());
const db = new PrismaClient();
async function main(): Promise<void> {
  const runId = process.argv[2];
  if (!/^[a-z0-9-]{8,80}$/.test(runId ?? '')) throw new Error('Invalid runId');
  const probe = process.argv[3] ?? '';
  if (probe && !/^[a-z0-9-]{1,40}$/.test(probe)) throw new Error('Invalid probe label');
  const reportId = runId + (probe ? `-${probe}` : '');
  const state = JSON.parse(await readFile(`.taskbook-working/real-playback-${runId}.json`, 'utf8')) as { cloneId: string; ownerId: string; sourceId: string };
  assert.notEqual(state.cloneId, state.sourceId);
  try {
    const user = await db.user.findUniqueOrThrow({ where: { id: state.ownerId } });
    const content = await db.learningContent.findUniqueOrThrow({ where: { id: state.cloneId } });
    const context = await buildStructuredContext(state.cloneId);
    const source = context.sourceSegments.find((segment) => segment.ref.type === 'video' && segment.ref.timestampSec === 293);
    assert.ok(source, 'Real source at 293 seconds must remain in context');
    const previousExcerpt = '后面说可再生能源发电，比如风力啊太阳能，它会因为天气的季节的地理的位置不。不同存在不同时间尺度的不同存在不同时间尺度的间歇性';
    const repaired = groundQaCitations([{ ref: source.ref, excerpt: previousExcerpt }], context.sourceSegments, { contentType: 'video', durationSec: content.durationSec, pageCount: null });
    assert.equal(repaired[0]?.excerpt, source.text.trim().slice(0, 500));
    const token = signAccessToken({ sub: user.id, email: user.email ?? '', role: 'student' });
    const response = await fetch(`${process.env.ACCEPTANCE_BASE_URL ?? 'http://localhost:3000'}/api/contents/${state.cloneId}/ai/qa`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ question: '资料中为什么说可再生能源发电具有波动性？请引用转写原文说明。' }), signal: AbortSignal.timeout(90000),
    });
    const envelope = await response.json() as { data?: { answer: string; citations: QaCitation[] }; error?: { code: string } };
    if (response.status !== 200) {
      await writeFile(`docs/acceptance/qa-grounding-20261009-${reportId}-failure-${Date.now()}.json`, JSON.stringify({ recordedAt: new Date().toISOString(), status: 'blocked', httpStatus: response.status, code: envelope.error?.code ?? 'INVALID_RESPONSE', sourceId: state.sourceId, fixtureId: state.cloneId }, null, 2));
    }
    assert.equal(response.status, 200, envelope.error?.code);
    assert.ok(envelope.data?.answer);
    assert.notEqual(envelope.data.answer.trim(), '依据资料的回答', 'Format placeholder cannot count as an answer');
    assert.ok(envelope.data.citations.length > 0, 'Real AI must provide at least one grounded citation');
    for (const citation of envelope.data.citations) {
      assert.ok(context.sourceSegments.some((segment) => JSON.stringify(segment.ref) === JSON.stringify(citation.ref) && segment.text.includes(citation.excerpt)), 'Every returned excerpt must be a verbatim source substring');
    }
    await writeFile(`docs/acceptance/qa-grounding-20261009-${reportId}.json`, JSON.stringify({ recordedAt: new Date().toISOString(), provider: 'spark', sourceId: state.sourceId, fixtureId: state.cloneId, originalRepetitionRepair: { previousExcerpt, repaired }, qa: envelope.data, allExcerptsVerbatim: true }, null, 2));
    console.log('Real AI citations match retained original text; previous repeated excerpt repaired');
  } finally { await db.$disconnect(); }
}
void main().catch(() => { console.error('Citation acceptance failed; clean database fixture while preserving shared media'); process.exitCode = 1; });
