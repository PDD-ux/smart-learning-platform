import { readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { HomeworkView } from '../../src/lib/homework/contracts';

const root = '.taskbook-working/homework-recognition-20261019';
const base = 'http://127.0.0.1:3000';
type Envelope<T> = { success: boolean; data?: T; error?: { code: string } };
async function main(): Promise<void> {
  const login = await fetch(base + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account: 'qa-homework-student-20261019@example.com', password: 'Classroom-UI-test-20261019!' }),
    signal: AbortSignal.timeout(30000),
  });
  if (!login.ok) throw Error('Temporary fixture login failed: ' + login.status);
  const session = await login.json() as Envelope<{ accessToken: string }>;
  if (!session.success || !session.data?.accessToken) throw Error('Fixture login response invalid');
  const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + session.data.accessToken };
  const input = { id: randomUUID(), title: '原创中文图片·真实昇腾OCR验收', source: {
    kind: 'file', fileName: '原创作业.png', mimeType: 'image/png', base64: readFileSync(root + '/ocr-original.png').toString('base64'),
  } };
  const started = Date.now();
  const created = await fetch(base + '/api/homework', { method: 'POST', headers, body: JSON.stringify(input), signal: AbortSignal.timeout(60000) });
  const result = await created.json() as Envelope<HomeworkView>;
  const data = result.data;
  const passed = created.ok && result.success && data?.state === 'DRAFT' && data.source.method === 'ocr' && data.rawText.includes('函数') && data.rawText.includes('唯一');
  const report = { at: new Date().toISOString(), state: passed ? 'PIPELINE_PASSED_MANUAL_REVIEW_REQUIRED' : 'FAILED', httpStatus: created.status,
    elapsedMs: Date.now() - started, realOcr: data?.source.method === 'ocr', modelApiCalled: false,
    id: data?.id, draftState: data?.state, recognizedText: data?.rawText, issues: data?.issues, errorCode: result.error?.code,
    noAutomaticQuestions: data?.questions.length === 0,
    quality: { fullAccuracyVerified: false, originalQuestionNumberPreserved: /^1[.、．]/u.test(data?.rawText ?? ''),
      lowConfidenceWarningShown: data?.issues.some((issue): boolean => issue.includes('低置信')) ?? false,
      limitation: '只验证正文关键词和真实识别链路；题号、断行、符号须对照原件逐项核对，不代表完整准确率。' } };
  writeFileSync(root + '/ocr-http.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  if (!passed || !data) { process.exitCode = 1; return; }
  const repeat = await fetch(base + '/api/homework', { method: 'POST', headers, body: JSON.stringify(input), signal: AbortSignal.timeout(15000) });
  const replay = await repeat.json() as Envelope<HomeworkView>;
  const unchanged = replay.success && replay.data?.id === data.id && replay.data.revision === data.revision && replay.data.rawText === data.rawText;
  writeFileSync(root + '/ocr-http-replay.json', JSON.stringify({ passed: unchanged, httpStatus: repeat.status, sameId: replay.data?.id === data.id, sameRevision: replay.data?.revision === data.revision }));
  if (!unchanged) throw Error('OCR replay changed original record');
}
main().catch((error: unknown): void => { console.error(error instanceof Error ? error.message : 'OCR HTTP acceptance failed'); process.exitCode = 1; });
