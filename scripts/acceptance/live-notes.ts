import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadEnvConfig } from '@next/env';
import type { LiveSessionDto } from '../../src/lib/domain/live-notes';
loadEnvConfig(process.cwd(), true);

async function main(): Promise<void> {
  const output = path.resolve(process.argv[2] ?? '');
  assert.ok(output.startsWith(path.resolve('.taskbook-working') + path.sep), 'New ignored output directory required');
  await mkdir(output, { recursive: false });
  const { prisma } = await import('../../src/lib/prisma');
  const { hashPassword } = await import('../../src/lib/auth/password');
  const owner = `live-test-${randomUUID()}`; const other = `live-other-${randomUUID()}`;
  const password = `${randomUUID()}!Aa9`; const base = 'http://localhost:3000';
  let token = ''; let otherToken = ''; let checks = 0;
  const times: number[] = [];
  async function call(route: string, body?: unknown, expected = 200, foreign = false): Promise<unknown> {
    const response = await fetch(base + '/api/live-notes' + route, { method: body === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${foreign ? otherToken : token}` }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(90_000) });
    const payload = await response.json() as { data: unknown; error?: { code: string; message: string } };
    if (response.status !== expected) await writeFile(path.join(output, 'failure.json'), JSON.stringify({ endpoint: route.split('/').slice(2).join('/'), httpStatus: response.status, expected, error: payload.error }, null, 2));
    assert.equal(response.status, expected, 'Unexpected live API status'); checks++;
    return payload.data;
  }
  try {
    const hash = await hashPassword(password);
    for (const id of [owner, other]) await prisma.user.create({ data: { id, email: `${id}@example.test`, nickname: '实时记录隔离验收', passwordHash: hash } });
    for (const [index, id] of [owner, other].entries()) {
      const response = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ account: `${id}@example.test`, password }) }); assert.equal(response.status, 200);
      const result = await response.json() as { data: { accessToken: string } }; if (index) otherToken = result.data.accessToken; else token = result.data.accessToken;
    }
    assert.equal((await fetch(base + '/api/live-notes')).status, 401); checks++;
    const session = await call('', { title: '真实30秒课堂音频分片' }) as LiveSessionDto;
    await call('/' + session.id, undefined, 403, true);
    const file = await readFile('.taskbook-working/local-asr/sample-535-565.wav');
    let pcm: Buffer | null = null;
    for (let offset = 12; offset + 8 <= file.length;) {
      const size = file.readUInt32LE(offset + 4);
      if (file.toString('ascii', offset, offset + 4) === 'data') { pcm = file.subarray(offset + 8, offset + 8 + size); break; }
      offset += size + 8 + size % 2;
    }
    assert.ok(pcm && pcm.length >= 6 * 160000);
    const payloads = Array.from({ length: 6 }, (_, sequence) => ({ sequence, pcmBase64: pcm!.subarray(sequence * 160000, (sequence + 1) * 160000).toString('base64') }));
    await call('/' + session.id + '/chunks', payloads[0], 403, true);
    await call('/' + session.id + '/chunks', payloads[1], 409);
    await call('/' + session.id + '/chunks', { sequence: 0, pcmBase64: 'bad' }, 400);
    for (const payload of payloads) {
      const started = Date.now(); const data = await call('/' + session.id + '/chunks', payload) as LiveSessionDto;
      times.push(Date.now() - started); assert.equal(data.nextSequence, payload.sequence + 1);
      assert.equal(data.totalSamples, (payload.sequence + 1) * 80000);
    }
    const duplicate = await call('/' + session.id + '/chunks', payloads[0]) as LiveSessionDto;
    assert.equal(duplicate.nextSequence, 6); assert.equal(duplicate.chunks.length, 6);
    await call('/' + session.id + '/chunks', { sequence: 0, pcmBase64: Buffer.alloc(160000).toString('base64') }, 409);
    const highlighted = await call('/' + session.id + '/highlights', {}) as LiveSessionDto;
    assert.ok(highlighted.highlights.length > 0);
    for (const highlight of highlighted.highlights) for (const [index, sequence] of highlight.sourceSequences.entries()) assert.equal(highlight.quotes[index], highlighted.chunks.find((chunk) => chunk.sequence === sequence)?.text);
    const done = await call('/' + session.id + '/finish', {}) as LiveSessionDto;
    assert.equal(done.state, 'FINISHED'); assert.ok(done.summaryMarkdown?.includes('完整转写'));
    assert.ok(done.chunks.map((chunk) => chunk.text).join('').length > 10);
    for (const chunk of done.chunks) if (chunk.text) assert.ok(done.summaryMarkdown?.includes(chunk.text));
    const repeated = await call('/' + session.id + '/finish', {}) as LiveSessionDto; assert.equal(repeated.summaryMarkdown, done.summaryMarkdown);
    await call('/' + session.id + '/chunks', { sequence: 6, pcmBase64: Buffer.alloc(3200).toString('base64') }, 409);
    assert.equal((await call('', undefined, 200, true) as unknown[]).length, 0);
    await writeFile(path.join(output, 'products.json'), JSON.stringify(done, null, 2));
    const silence = await call('', { title: '静音分片验收' }) as LiveSessionDto;
    const quiet = await call('/' + silence.id + '/chunks', { sequence: 0, pcmBase64: Buffer.alloc(3200).toString('base64') }) as LiveSessionDto;
    assert.equal(quiet.chunks[0].text, ''); await call('/' + silence.id + '/finish', {});
    await writeFile(path.join(output, 'report.json'), JSON.stringify({ passed: true, checks, audioSeconds: 30, actualLocalAsrSlices: 6, perSliceMs: times,
      warmMeanMs: Math.round(times.slice(1).reduce((a, b) => a + b, 0) / 5), actualSparkHighlights: true, quotesMatchedActualAsr: true,
      microphoneCaptured: false, browserCaptureStillRequiresHuman: true, fileSlicesSentSequentiallyNotPaced: true, completeTranscriptSaved: true,
      temporaryAccountsCleaned: false }, null, 2));
    console.log(JSON.stringify({ passed: true, checks, perSliceMs: times }));
  } finally {
    await prisma.user.deleteMany({ where: { id: { in: [owner, other] } } });
    const reportPath = path.join(output, 'report.json');
    try { const report = JSON.parse(await readFile(reportPath, 'utf8')) as Record<string, unknown>; report.temporaryAccountsCleaned = true; await writeFile(reportPath, JSON.stringify(report, null, 2)); } catch { /* Preserve original failure. */ }
    await prisma.$disconnect();
  }
}
void main().catch((): void => { console.error('Live API acceptance failed; no raw error or credentials logged'); process.exitCode = 1; });
