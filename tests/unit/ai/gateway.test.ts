import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  InferError,
  InferenceGateway,
  getInferMetrics,
  mockSelectFrames,
  __resetInferenceGatewayForTest,
} from '@/lib/ai/gateway';

/**
 * InferenceGateway 单测（tasks.md §5.4）
 */

const fetchMock = vi.fn();

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const frames = [
  { frameIndex: 0, timestampMs: 0, imageBase64: 'AAAA' },
  { frameIndex: 1, timestampMs: 2000, imageUrl: 'http://example.com/f1.jpg' },
];

describe('InferenceGateway', () => {
  let gateway: InferenceGateway;

  beforeEach(() => {
    vi.clearAllMocks();
    __resetInferenceGatewayForTest();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('ASCEND_INFER_URL', 'http://localhost:8000');
    vi.stubEnv('ASCEND_INFER_TOKEN', 'unit-token');
    vi.stubEnv('ASCEND_INFER_TIMEOUT_MS', '8000');
    vi.stubEnv('FEATURE_MINDSPORE_INFER', 'true');
    gateway = new InferenceGateway();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('calls /classify with token and traceId headers', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ items: [{ frameIndex: 0, category: 'blackboard' }] }),
    );

    const res = await gateway.classify(frames, { traceId: 'trace-1' });
    expect(res.items).toEqual([{ frameIndex: 0, category: 'blackboard' }]);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://localhost:8000/classify');
    expect(init.headers['X-Infer-Token']).toBe('unit-token');
    expect(init.headers['X-Trace-Id']).toBe('trace-1');
  });

  it('falls back to mock classify and records infer_unavailable on failure', async () => {
    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const onFallback = vi.fn();
    const res = await gateway.classify(frames, { onFallback });
    expect(res.items.map((i) => i.category)).toEqual(['unknown', 'unknown']);
    expect(getInferMetrics().inferUnavailable).toBe(1);
    expect(onFallback).toHaveBeenCalledWith('INFER_UNAVAILABLE');
  });

  it('falls back when the service returns a non-2xx status', async () => {
    fetchMock.mockResolvedValueOnce(new Response('boom', { status: 500 }));
    const res = await gateway.classify(frames);
    expect(res.items).toHaveLength(2);
    expect(getInferMetrics().inferUnavailable).toBe(1);
  });

  it('falls back when the response violates the contract', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ wrong: true }));
    const res = await gateway.detectText(frames);
    expect(res.items[0].blocks).toEqual([]);
    expect(getInferMetrics().inferUnavailable).toBe(1);
  });

  it('returns detect_text items on success', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        items: [
          {
            frameIndex: 0,
            blocks: [{ bbox: [1, 2, 3, 4], text: 'hello', confidence: 0.9 }],
          },
        ],
      }),
    );
    const res = await gateway.detectText([frames[0]]);
    expect(res.items[0].blocks[0]).toEqual({ bbox: [1, 2, 3, 4], text: 'hello', confidence: 0.9 });
  });

  it('splits OCR sequentially and preserves original indices, timestamps and response order', async () => {
    const input = Array.from({ length: 9 }, (_, index): typeof frames[number] => ({
      frameIndex: 100 + index, timestampMs: 9000 + index * 2000, imageBase64: 'AAAA',
    }));
    let active = 0;
    let peak = 0;
    fetchMock.mockImplementation(async (_url: string, init: RequestInit): Promise<Response> => {
      active += 1;
      peak = Math.max(peak, active);
      const body = JSON.parse(String(init.body)) as { frames: typeof input };
      await Promise.resolve();
      active -= 1;
      return jsonResponse({ items: [...body.frames].reverse().map((frame) => ({
        frameIndex: frame.frameIndex, blocks: [{ bbox: [1, 2, 3, 4], text: String(frame.timestampMs), confidence: 0.9 }],
      })) });
    });
    const result = await gateway.detectText(input, { traceId: 'ocr-batch', timeoutMs: 8000 });
    expect(peak).toBe(1);
    expect(fetchMock.mock.calls.map((call): number => JSON.parse(String(call[1].body)).frames.length)).toEqual([4, 4, 1]);
    expect(result.items.map((item): number => item.frameIndex)).toEqual(input.map((frame): number => frame.frameIndex));
    expect(result.items.map((item): string => item.blocks[0].text)).toEqual(input.map((frame): string => String(frame.timestampMs)));
    expect(fetchMock.mock.calls.every((call): boolean => call[1].headers['X-Trace-Id'] === 'ocr-batch')).toBe(true);
  });

  it('stops after a later OCR failure and reports whole-call fallback once', async () => {
    const input = Array.from({ length: 9 }, (_, frameIndex) => ({ frameIndex, imageBase64: 'AAAA' }));
    fetchMock.mockResolvedValueOnce(jsonResponse({ items: input.slice(0, 4).map((frame) => ({
      frameIndex: frame.frameIndex, blocks: [{ bbox: [1, 2, 3, 4], text: 'real', confidence: 0.9 }],
    })) }));
    fetchMock.mockRejectedValueOnce(new DOMException('timeout', 'AbortError'));
    const onFallback = vi.fn();
    const result = await gateway.detectText(input, { onFallback });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.items.map((item): number => item.frameIndex)).toEqual(input.map((frame): number => frame.frameIndex));
    expect(result.items.every((item): boolean => item.blocks.length === 0)).toBe(true);
    expect(onFallback).toHaveBeenCalledTimes(1);
    expect(onFallback).toHaveBeenCalledWith('TIMEOUT');
    expect(getInferMetrics().inferUnavailable).toBe(1);
  });

  it.each([
    [{ frameIndex: 0, blocks: [] }],
    [{ frameIndex: 0, blocks: [] }, { frameIndex: 0, blocks: [] }],
    [{ frameIndex: 0, blocks: [] }, { frameIndex: 99, blocks: [] }],
  ])('rejects incomplete, duplicated or unexpected OCR frame indices: %j', async (...items) => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ items }));
    const onFallback = vi.fn();
    const result = await gateway.detectText(frames, { onFallback });
    expect(result.items.every((item): boolean => item.blocks.length === 0)).toBe(true);
    expect(onFallback).toHaveBeenCalledWith('SCHEMA_INVALID');
  });

  it('returns select_frames results on success', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        frames: [
          { frameIndex: 0, timestampMs: 0, score: 0.8, keep: true, reason: 'sharp' },
          { frameIndex: 1, timestampMs: 2000, score: 0.1, keep: false, reason: 'blur' },
        ],
      }),
    );
    const res = await gateway.selectFrames(frames);
    expect(res.frames[1].keep).toBe(false);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/select_frames'),
      expect.objectContaining({ body: JSON.stringify({ frames, strategy: 'quality' }) }),
    );
  });

  it('uses the uniform mock for select_frames on failure', async () => {
    fetchMock.mockRejectedValueOnce(new Error('down'));
    const res = await gateway.selectFrames(frames);
    expect(res.frames).toEqual(mockSelectFrames(frames).frames);
    // 默认步长 1：均匀保底保留全部帧
    expect(res.frames.every((f) => f.keep)).toBe(true);
  });

  it('skips fetch when forceMock is set', async () => {
    const onFallback = vi.fn();
    const res = await gateway.classify(frames, { forceMock: true, onFallback });
    expect(res.items[0].category).toBe('unknown');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(onFallback).toHaveBeenCalledWith('MOCK_FORCED');
  });

  it('skips fetch when the feature flag is disabled', async () => {
    vi.stubEnv('FEATURE_MINDSPORE_INFER', 'false');
    await gateway.classify(frames);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('health returns the service status', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ status: 'ok', device: 'cpu', modelsLoaded: false, mock: true, version: '0.1.0' }),
    );
    const health = await gateway.health();
    expect(health).toMatchObject({ status: 'ok', device: 'cpu', mock: true });
  });

  it('health throws InferError when unreachable', async () => {
    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    await expect(gateway.health()).rejects.toBeInstanceOf(InferError);
  });
});
