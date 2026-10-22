import { afterEach, describe, expect, it, vi } from 'vitest';
import { getTranscriptionProvider, transcribe } from '@/lib/ai/asr';
import { parseLocalTranscript } from '@/lib/ai/asr-local';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

afterEach((): void => { vi.unstubAllEnvs(); });
const payload = { durationMs: 30000, segments: [{ seq: 0, startMs: 2170, endMs: 22180, text: '课堂文字' }] };
describe('local ASR contract', (): void => {
  it('keeps window-relative times; the pipeline owns source offset', (): void => {
    expect(parseLocalTranscript(JSON.stringify(payload), 30)[0].startMs).toBe(2170);
  });
  it('allows actual silence without fabricating text', (): void => {
    expect(parseLocalTranscript(JSON.stringify({ durationMs: 30000, segments: [] }), 30)).toEqual([]);
  });
  it.each([{ startMs: -1 }, { endMs: 30001 }, { endMs: 0 }, { seq: 5 }, { text: '' }, { startMs: 0.5 }])
  ('rejects malformed segment %j', (patch): void => {
    expect((): unknown => parseLocalTranscript(JSON.stringify({ ...payload, segments: [{ ...payload.segments[0], ...patch }] }))).toThrow();
  });
  it('rejects mismatched audio and overlapping intervals', (): void => {
    expect((): unknown => parseLocalTranscript(JSON.stringify(payload), 300)).toThrow();
    expect((): unknown => parseLocalTranscript(JSON.stringify({ ...payload, segments: [...payload.segments,
      { seq: 1, startMs: 20000, endMs: 23000, text: '另一段' }] }))).toThrow();
  });
  it('missing local config fails even with paid credentials', async (): Promise<void> => {
    vi.stubEnv('ASR_PROVIDER', 'funasr-local'); vi.stubEnv('FEATURE_ASR', 'true');
    vi.stubEnv('ASR_LOCAL_PYTHON', ''); vi.stubEnv('ASR_LOCAL_MODEL_DIR', '');
    vi.stubEnv('ASR_APP_ID', 'configured'); vi.stubEnv('ASR_API_KEY', 'configured');
    const spy = vi.spyOn(globalThis, 'fetch');
    try {
      expect(getTranscriptionProvider().isAvailable()).toBe(false);
      expect((await transcribe({ contentId: 'local', audio: {} })).available).toBe(false);
      expect(spy).not.toHaveBeenCalled();
    } finally { spy.mockRestore(); }
  });
  it('child failure releases the queue, returns no partial text and never leaks paths', async (): Promise<void> => {
    const directory = await mkdtemp(path.join(tmpdir(), 'local-asr-test-'));
    const audioPath = path.join(directory, 'audio.wav');
    await writeFile(audioPath, Buffer.from('invalid PCM'));
    vi.stubEnv('ASR_PROVIDER', 'funasr-local'); vi.stubEnv('FEATURE_ASR', 'true');
    vi.stubEnv('ASR_LOCAL_PYTHON', path.join(directory, 'missing-python'));
    vi.stubEnv('ASR_LOCAL_MODEL_DIR', directory);
    const spy = vi.spyOn(globalThis, 'fetch');
    try {
      const results = await Promise.all([transcribe({ contentId: 'test1', audio: { audioPath } }),
        transcribe({ contentId: 'test2', audio: { audioPath } })]);
      for (const result of results) {
        expect(result.available).toBe(false); expect(result.segments).toEqual([]);
        expect(result.reason).not.toContain(directory);
      }
      expect(spy).not.toHaveBeenCalled();
    } finally { spy.mockRestore(); await rm(directory, { recursive: true, force: true }); }
  });
});
