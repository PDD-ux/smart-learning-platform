import { z } from 'zod';

import { taskLogger } from '@/lib/jobs/task-logger';
import { recordCounter, recordLatency } from '@/lib/observability/metrics';

/**
 * 平台侧推理网关 InferenceGateway（tasks.md §5.4）
 * ------------------------------------------------------------
 * 封装 `services/mindspore-infer` 的 `/classify /detect_text /select_frames /health`：
 *   - 携带服务级共享密钥 X-Infer-Token 与 traceId 透传头；
 *   - AbortController 超时控制（ASCEND_INFER_TIMEOUT_MS，默认 8000ms）；
 *   - 服务不可达 / 超时 / 响应非法时**自动切换本地 mock**
 *     （unknown 分类 + 空文本 + 均匀抽帧），保证理解流水线继续；
 *   - 每次降级上报 `infer_unavailable` 指标（getInferMetrics）。
 *
 * 契约见 spec/03-ARCHITECTURE.md §2.2.2-(8)。
 */

export const FRAME_CATEGORIES = [
  'blackboard',
  'screen',
  'invalid',
  'unknown',
] as const;

export type FrameCategory = (typeof FRAME_CATEGORIES)[number];

export type FrameInput = {
  frameIndex: number;
  timestampMs?: number;
  imageUrl?: string;
  imageBase64?: string;
};

export type ClassifyItem = { frameIndex: number; category: FrameCategory };
export type ClassifyResp = { items: ClassifyItem[] };

export type TextBlock = { bbox: [number, number, number, number]; text: string; confidence: number };
export type DetectTextItem = { frameIndex: number; blocks: TextBlock[] };
export type DetectTextResp = { items: DetectTextItem[] };

export type SelectedFrame = {
  frameIndex: number;
  timestampMs: number;
  score: number;
  keep: boolean;
  reason: string;
};
export type SelectFramesResp = { frames: SelectedFrame[] };

export type HealthStatus = {
  status: string;
  device: string;
  modelsLoaded: boolean;
  mock: boolean;
  version?: string;
};

export type InferErrorCode = 'INFER_UNAVAILABLE' | 'TIMEOUT' | 'UPSTREAM_ERROR' | 'SCHEMA_INVALID';

export class InferError extends Error {
  constructor(
    message: string,
    public readonly code: InferErrorCode,
    public readonly status = 502,
  ) {
    super(message);
    this.name = 'InferError';
  }
}

export type CallOptions = {
  traceId?: string;
  timeoutMs?: number;
  /** 告知调用方本次响应来自降级结果，而非真实推理服务。 */
  onFallback?: (reason: InferErrorCode | 'MOCK_FORCED' | 'UNKNOWN') => void;
  /** 跳过真实调用，直接用 mock（测试 / 功能开关） */
  forceMock?: boolean;
};

// ---------------------------------------------------------------------------
// 环境
// ---------------------------------------------------------------------------

function baseUrl(): string {
  return (process.env.ASCEND_INFER_URL ?? '').replace(/\/+$/, '');
}

function inferToken(): string {
  return process.env.ASCEND_INFER_TOKEN ?? 'dev-infer-token';
}

function defaultTimeoutMs(): number {
  const n = Number(process.env.ASCEND_INFER_TIMEOUT_MS);
  return Number.isFinite(n) && n > 0 ? n : 8_000;
}

/** 功能开关关闭 / 未配置 URL 时，直接走 mock */
function mockForced(): boolean {
  return process.env.FEATURE_MINDSPORE_INFER === 'false' || !baseUrl();
}

// ---------------------------------------------------------------------------
// 指标
// ---------------------------------------------------------------------------

type InferMetrics = { inferUnavailable: number };

const globalForMetrics = globalThis as unknown as { __slpInferMetrics?: InferMetrics };

function metrics(): InferMetrics {
  if (!globalForMetrics.__slpInferMetrics) {
    globalForMetrics.__slpInferMetrics = { inferUnavailable: 0 };
  }
  return globalForMetrics.__slpInferMetrics;
}

export function getInferMetrics(): InferMetrics {
  return { ...metrics() };
}

function recordInferUnavailable(reason: string): void {
  metrics().inferUnavailable += 1;
  taskLogger.warn('infer_unavailable', { reason, count: metrics().inferUnavailable });
}

// ---------------------------------------------------------------------------
// 响应 schema
// ---------------------------------------------------------------------------

const bboxSchema = z.tuple([z.number(), z.number(), z.number(), z.number()]);

const classifyRespSchema = z.object({
  items: z.array(z.object({ frameIndex: z.number(), category: z.enum(FRAME_CATEGORIES) })),
});

const detectTextRespSchema = z.object({
  items: z.array(
    z.object({
      frameIndex: z.number(),
      blocks: z.array(
        z.object({ bbox: bboxSchema, text: z.string(), confidence: z.number() }),
      ),
    }),
  ),
});

// Real Ascend OCR of 16 frames takes ~14.6s; four-frame requests leave room
// for transport within the default 8s per-request timeout. Send sequentially.
const OCR_REQUEST_MAX_FRAMES = 4;

const selectFramesRespSchema = z.object({
  frames: z.array(
    z.object({
      frameIndex: z.number(),
      timestampMs: z.number(),
      score: z.number(),
      keep: z.boolean(),
      reason: z.string(),
    }),
  ),
});

const healthSchema = z
  .object({
    status: z.string(),
    device: z.string(),
    modelsLoaded: z.boolean(),
    mock: z.boolean(),
    version: z.string().optional(),
  })
  .passthrough();

// ---------------------------------------------------------------------------
// 本地 mock（降级）
// ---------------------------------------------------------------------------

export function mockClassify(frames: FrameInput[]): ClassifyResp {
  return {
    items: frames.map((f) => ({ frameIndex: f.frameIndex, category: 'unknown' as FrameCategory })),
  };
}

export function mockDetectText(frames: FrameInput[]): DetectTextResp {
  return { items: frames.map((f) => ({ frameIndex: f.frameIndex, blocks: [] })) };
}

export function mockSelectFrames(frames: FrameInput[], sampleEvery = 1): SelectFramesResp {
  const step = Math.max(1, sampleEvery);
  return {
    frames: frames.map((f, index) => {
      const keep = index % step === 0;
      return {
        frameIndex: f.frameIndex,
        timestampMs: f.timestampMs ?? 0,
        score: keep ? 0.6 : 0.3,
        keep,
        reason: keep ? 'uniform' : 'uniform-dropped',
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// 底层请求
// ---------------------------------------------------------------------------

async function requestJson<T>(
  path: string,
  schema: z.ZodType<T>,
  init: { method: 'GET' | 'POST'; body?: unknown; opts: CallOptions },
): Promise<T> {
  const startedAt = Date.now();
  const operation = path.replace(/^\//, '');
  let outcome = 'success';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), init.opts.timeoutMs ?? defaultTimeoutMs());

  const headers: Record<string, string> = {
    'X-Infer-Token': inferToken(),
  };
  if (init.opts.traceId) headers['X-Trace-Id'] = init.opts.traceId;
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';

  try {
    const res = await fetch(`${baseUrl()}${path}`, {
      method: init.method,
      headers,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new InferError(
        `推理服务调用失败（HTTP ${res.status}）：${text.slice(0, 200)}`,
        'UPSTREAM_ERROR',
        502,
      );
    }

    const parsed = schema.safeParse(await res.json());
    if (!parsed.success) {
      throw new InferError(
        `推理服务响应不符合契约：${parsed.error.issues.map((i) => i.path.join('.')).join(', ')}`,
        'SCHEMA_INVALID',
        502,
      );
    }
    return parsed.data;
  } catch (err) {
    outcome = 'failure';
    if (err instanceof InferError) throw err;
    if (err instanceof Error && err.name === 'AbortError') {
      throw new InferError('推理服务调用超时', 'TIMEOUT', 504);
    }
    throw new InferError(
      '推理服务不可达：' + (err instanceof Error ? err.message : String(err)),
      'INFER_UNAVAILABLE',
      503,
    );
  } finally {
    clearTimeout(timer);
    recordCounter('slp_mindspore_requests_total', { operation, outcome });
    recordLatency('slp_mindspore_request_duration_seconds', Date.now() - startedAt, { operation, outcome });
  }
}

// ---------------------------------------------------------------------------
// Gateway
// ---------------------------------------------------------------------------

export class InferenceGateway {
  /** 健康检查（失败抛 InferError，不降级） */
  async health(opts: CallOptions = {}): Promise<HealthStatus> {
    return requestJson('/health', healthSchema, { method: 'GET', opts });
  }

  async classify(frames: FrameInput[], opts: CallOptions = {}): Promise<ClassifyResp> {
    if (opts.forceMock || mockForced()) {
      opts.onFallback?.('MOCK_FORCED');
      return mockClassify(frames);
    }
    try {
      return await requestJson('/classify', classifyRespSchema, {
        method: 'POST',
        body: { frames },
        opts,
      });
    } catch (err) {
      const reason = err instanceof InferError ? err.code : 'UNKNOWN';
      recordInferUnavailable(reason);
      opts.onFallback?.(reason);
      return mockClassify(frames);
    }
  }

  async detectText(frames: FrameInput[], opts: CallOptions = {}): Promise<DetectTextResp> {
    if (opts.forceMock || mockForced()) {
      opts.onFallback?.('MOCK_FORCED');
      return mockDetectText(frames);
    }
    try {
      const items: DetectTextItem[] = [];
      for (let offset = 0; offset < frames.length; offset += OCR_REQUEST_MAX_FRAMES) {
        const batch = frames.slice(offset, offset + OCR_REQUEST_MAX_FRAMES);
        const response = await requestJson('/detect_text', detectTextRespSchema, {
          method: 'POST', body: { frames: batch }, opts,
        });
        const byIndex = new Map(response.items.map((item): [number, DetectTextItem] => [item.frameIndex, item]));
        if (response.items.length !== batch.length || byIndex.size !== batch.length ||
            new Set(batch.map((frame): number => frame.frameIndex)).size !== batch.length ||
            batch.some((frame): boolean => !byIndex.has(frame.frameIndex))) {
          throw new InferError('OCR 响应帧序号或数量不匹配', 'SCHEMA_INVALID');
        }
        for (const frame of batch) {
          const item = byIndex.get(frame.frameIndex);
          if (item) items.push(item);
        }
      }
      return { items };
    } catch (err) {
      const reason = err instanceof InferError ? err.code : 'UNKNOWN';
      recordInferUnavailable(reason);
      opts.onFallback?.(reason);
      return mockDetectText(frames);
    }
  }

  async selectFrames(frames: FrameInput[], opts: CallOptions = {}): Promise<SelectFramesResp> {
    if (opts.forceMock || mockForced()) {
      opts.onFallback?.('MOCK_FORCED');
      return mockSelectFrames(frames);
    }
    try {
      return await requestJson('/select_frames', selectFramesRespSchema, {
        method: 'POST',
        body: { frames, strategy: 'quality' },
        opts,
      });
    } catch (err) {
      const reason = err instanceof InferError ? err.code : 'UNKNOWN';
      recordInferUnavailable(reason);
      opts.onFallback?.(reason);
      return mockSelectFrames(frames);
    }
  }
}

const globalForGateway = globalThis as unknown as { __slpInferGateway?: InferenceGateway };

export function getInferenceGateway(): InferenceGateway {
  if (!globalForGateway.__slpInferGateway) {
    globalForGateway.__slpInferGateway = new InferenceGateway();
  }
  return globalForGateway.__slpInferGateway;
}

/** 测试辅助：重置单例与指标 */
export function __resetInferenceGatewayForTest(): void {
  globalForGateway.__slpInferGateway = undefined;
  globalForMetrics.__slpInferMetrics = { inferUnavailable: 0 };
}
