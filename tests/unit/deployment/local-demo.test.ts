import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { assetPath, readyFor, serviceHealth, type DemoReport } from '../../../scripts/demo/local-demo';
afterEach((): void => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
it('authenticates the private face health endpoint and still rejects a mismatched model', async (): Promise<void> => {
  vi.stubEnv('FACE_INFER_URL', 'http://127.0.0.1:8002');
  vi.stubEnv('FACE_INFER_TOKEN', 'isolated-test-token');
  vi.stubEnv('FACE_INFER_MODEL_VERSION', 'test-version');
  const request = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ status: 'ok', modelsLoaded: true, modelVersion: 'test-version' }))).mockResolvedValueOnce(new Response(JSON.stringify({ status: 'ok', modelsLoaded: true, modelVersion: 'wrong-version' })));
  vi.stubGlobal('fetch', request);
  expect((await serviceHealth('face')).status).toBe('ready');
  expect(request.mock.calls[0][1].headers).toEqual({ authorization: 'Bearer isolated-test-token' });
  expect((await serviceHealth('face')).status).toBe('blocked');
});

function report(): DemoReport {
  return { mode: 'display', checkedAt: '', ready: false, modelCalled: false, databaseWrites: false, checks: {
    node: { status: 'ready', message: '' }, database: { status: 'ready', message: '' }, materials: { status: 'ready', message: '' }, auth: { status: 'ready', message: '' }, web: { status: 'ready', message: '' },
    agent: { status: 'blocked', message: '' }, face: { status: 'blocked', message: '' }, ascend: { status: 'blocked', message: '' },
    queue: { status: 'ready', message: '' }, storage: { status: 'ready', message: '' },
  } };
}

it('allows existing-material display without cloud, face or AI calls', (): void => {
  expect(readyFor(report())).toBe(true);
});
it.each(['node', 'database', 'materials', 'auth', 'queue', 'storage'])('blocks startup when required %s fails', (name): void => {
  const value = report(); value.checks[name].status = 'blocked';
  expect(readyFor(value, true)).toBe(false);
});
it('distinguishes a free web port from an occupied unverified service', (): void => {
  const value = report(); value.checks.web.status = 'offline';
  expect(readyFor(value)).toBe(false); expect(readyFor(value, true)).toBe(true);
  value.checks.web.status = 'blocked'; expect(readyFor(value, true)).toBe(false);
});
it('requires separate fresh-import prerequisites rather than copying display readiness', (): void => {
  const value = report(); value.mode = 'import';
  expect(readyFor(value)).toBe(false);
  for (const name of ['queue', 'storage', 'asr', 'generation', 'ascend', 'ascendAuth', 'mediaTools']) value.checks[name] = { status: 'ready', message: '' };
  expect(readyFor(value)).toBe(true);
  value.checks.ascendAuth.status = 'blocked'; expect(readyFor(value)).toBe(false);
});
it('rejects path traversal and root directories when resolving media', (): void => {
  const root = path.resolve('uploads');
  expect(assetPath(root, '../outside.mp4')).toBeNull(); expect(assetPath(root, '')).toBeNull(); expect(assetPath(root, '.')).toBeNull();
  expect(assetPath(root, 'course/video.mp4')).toBe(path.join(root, 'course', 'video.mp4'));
});
