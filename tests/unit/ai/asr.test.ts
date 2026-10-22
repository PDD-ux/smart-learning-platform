import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  MockTranscriptionProvider,
  UnavailableTranscriptionProvider,
  XunfeiTranscriptionProvider,
  alignSegments,
  getAsrStatus,
  getTranscriptionProvider,
  transcribe,
} from '@/lib/ai/asr';

/**
 * ASR 网关 单测（tasks.md §6.1）
 */

describe('alignSegments', () => {
  it('sorts by startMs, drops empty text and reassigns seq', () => {
    const aligned = alignSegments([
      { seq: 9, startMs: 6_000, endMs: 12_000, text: 'B' },
      { seq: 5, startMs: 0, endMs: 6_000, text: 'A' },
      { seq: 7, startMs: 3_000, endMs: 4_000, text: '   ' },
    ]);
    expect(aligned.map((s) => s.text)).toEqual(['A', 'B']);
    expect(aligned.map((s) => s.seq)).toEqual([0, 1]);
    expect(aligned[0].startMs).toBe(0);
  });
});

describe('getTranscriptionProvider', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('returns the mock provider when ASR_PROVIDER=mock', () => {
    vi.stubEnv('FEATURE_ASR', 'true');
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('ASR_PROVIDER', 'mock');
    expect(getTranscriptionProvider()).toBeInstanceOf(MockTranscriptionProvider);
  });

  it('never enables mock ASR in production', () => {
    vi.stubEnv('FEATURE_ASR', 'true');
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('ASR_PROVIDER', 'mock');
    const provider = getTranscriptionProvider();
    expect(provider).toBeInstanceOf(UnavailableTranscriptionProvider);
    expect(provider.isAvailable()).toBe(false);
  });

  it('returns unavailable when ASR_PROVIDER is empty', () => {
    vi.stubEnv('FEATURE_ASR', 'true');
    vi.stubEnv('ASR_PROVIDER', '');
    const provider = getTranscriptionProvider();
    expect(provider).toBeInstanceOf(UnavailableTranscriptionProvider);
    expect(provider.isAvailable()).toBe(false);
  });

  it('returns unavailable for a not-yet-implemented vendor', () => {
    vi.stubEnv('FEATURE_ASR', 'true');
    vi.stubEnv('ASR_PROVIDER', 'ali');
    const provider = getTranscriptionProvider();
    expect(provider.isAvailable()).toBe(false);
    expect((provider as UnavailableTranscriptionProvider).reason).toContain('未实现');
  });

  it('selects Xunfei only when both server credentials are configured', () => {
    vi.stubEnv('FEATURE_ASR', 'true');
    vi.stubEnv('ASR_PROVIDER', 'xunfei');
    vi.stubEnv('ASR_APP_ID', 'app-id');
    vi.stubEnv('ASR_API_KEY', 'server-secret');
    expect(getTranscriptionProvider()).toBeInstanceOf(XunfeiTranscriptionProvider);

    vi.stubEnv('ASR_API_KEY', '');
    expect(getTranscriptionProvider()).toBeInstanceOf(UnavailableTranscriptionProvider);
  });

  it('returns unavailable when the feature flag is off', () => {
    vi.stubEnv('FEATURE_ASR', 'false');
    vi.stubEnv('ASR_PROVIDER', 'mock');
    expect(getTranscriptionProvider().isAvailable()).toBe(false);
  });
});

describe('transcribe', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('returns time-aligned mock segments', async () => {
    vi.stubEnv('FEATURE_ASR', 'true');
    vi.stubEnv('ASR_PROVIDER', 'mock');
    const result = await transcribe({ contentId: 'c1', audio: { durationSec: 12 } });
    expect(result.available).toBe(true);
    expect(result.provider).toBe('mock');
    expect(result.segments).toHaveLength(2);
    expect(result.segments.map((s) => s.seq)).toEqual([0, 1]);
    expect(result.segments[0]).toMatchObject({ startMs: 0, endMs: 6_000 });
  });

  it('returns an explicit unavailable marker (no throw) when not configured', async () => {
    vi.stubEnv('FEATURE_ASR', 'true');
    vi.stubEnv('ASR_PROVIDER', '');
    const result = await transcribe({ contentId: 'c1', audio: {} });
    expect(result).toEqual({
      available: false,
      provider: 'none',
      segments: [],
      reason: '未配置 ASR_PROVIDER',
    });
  });

  it('defaults to a 30s mock transcript when duration is unknown', async () => {
    vi.stubEnv('FEATURE_ASR', 'true');
    vi.stubEnv('ASR_PROVIDER', 'mock');
    const result = await transcribe({ contentId: 'c1', audio: { durationSec: null } });
    expect(result.segments).toHaveLength(5);
  });

  it('uploads a local audio chunk to Xunfei and maps timestamped recognition results', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'slp-asr-test-'));
    const audioPath = path.join(directory, 'audio.wav');
    await writeFile(audioPath, Buffer.from('test audio bytes'));
    const lattice = [
      { json_1best: JSON.stringify({ st: { bg: '120', ed: '980', rt: [{ ws: [
        { cw: [{ w: '判断', wp: 'n' }] },
        { cw: [{ w: '推理', wp: 'n' }] },
        { cw: [{ w: '。', wp: 'p' }] },
      ] }] } }) },
    ];
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: '000000', content: { orderId: 'order-1' } })))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        code: '000000',
        content: { orderInfo: { status: 4 }, orderResult: JSON.stringify({ lattice }) },
      })));
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('FEATURE_ASR', 'true');
    vi.stubEnv('ASR_PROVIDER', 'xunfei');
    vi.stubEnv('ASR_APP_ID', 'app-id');
    vi.stubEnv('ASR_API_KEY', 'server-secret');
    vi.stubEnv('ASR_POLL_INTERVAL_MS', '1');

    try {
      const result = await transcribe({
        contentId: 'content-1',
        audio: { audioPath, durationSec: 5 },
      });

      expect(result).toEqual({
        available: true,
        provider: 'xunfei',
        segments: [{ seq: 0, startMs: 120, endMs: 980, text: '判断推理。' }],
      });
      expect(fetchMock).toHaveBeenCalledTimes(2);
      const uploadUrl = new URL(String(fetchMock.mock.calls[0]?.[0]));
      expect(uploadUrl.pathname).toBe('/v2/api/upload');
      expect(uploadUrl.searchParams.get('appId')).toBe('app-id');
      expect(uploadUrl.searchParams.get('signa')).toBeTruthy();
      expect(uploadUrl.searchParams.get('signa')).not.toContain('server-secret');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('polls while the Xunfei order is processing and returns a safe failure code', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'slp-asr-test-'));
    const audioPath = path.join(directory, 'audio.wav');
    await writeFile(audioPath, Buffer.from('test audio bytes'));
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: '000000', content: { orderId: 'order-2' } })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: '26605', descInfo: 'processing' })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: '26607', descInfo: 'not authorized' })));
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('FEATURE_ASR', 'true');
    vi.stubEnv('ASR_PROVIDER', 'xunfei');
    vi.stubEnv('ASR_APP_ID', 'app-id');
    vi.stubEnv('ASR_API_KEY', 'server-secret');
    vi.stubEnv('ASR_POLL_INTERVAL_MS', '1');

    try {
      const result = await transcribe({ contentId: 'content-2', audio: { audioPath, durationSec: 5 } });
      expect(result.available).toBe(false);
      expect(result.reason).toContain('26607');
      expect(result.reason).not.toContain('server-secret');
      expect(fetchMock).toHaveBeenCalledTimes(3);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe('getAsrStatus', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('reports available for mock', () => {
    vi.stubEnv('FEATURE_ASR', 'true');
    vi.stubEnv('ASR_PROVIDER', 'mock');
    expect(getAsrStatus()).toEqual({ available: true, provider: 'mock' });
  });

  it('reports the reason when unavailable', () => {
    vi.stubEnv('FEATURE_ASR', 'true');
    vi.stubEnv('ASR_PROVIDER', '');
    const status = getAsrStatus();
    expect(status.available).toBe(false);
    expect(status.reason).toBeTruthy();
  });
});
