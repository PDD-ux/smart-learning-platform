import { createHash, createHmac } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import { taskLogger } from '@/lib/jobs/task-logger';
import { LocalTranscriptionProvider, localAsrConfigured } from './asr-local';

/**
 * ASR 语音转写网关（tasks.md §6.1）
 * ------------------------------------------------------------
 * 抽象 `TranscriptionProvider` 接口；已接入讯飞录音文件转写（Long Form ASR），
 * 输出时间对齐的 `TranscriptSegment` 原材料（seq / startMs / endMs / text）。
 *
 * 降级约定（spec/03-ARCHITECTURE.md §3.4）：
 *   - `ASR_PROVIDER` 留空 / 未实现 / `FEATURE_ASR=false` → 返回显式「不可用」标记
 *     （`available:false` + `segments:[]` + `reason`），语义功能置灰但不阻塞播放/笔记；
 *   - `ASR_PROVIDER=xunfei` + `ASR_APP_ID` + `ASR_API_KEY` → 真实讯飞录音文件转写；
 *   - `ASR_PROVIDER=mock` → 仅用于本地/测试的显式占位转写，绝不代表真实识别结果。
 */

export type TranscriptSegmentInput = {
  seq: number;
  startMs: number;
  endMs: number;
  text: string;
};

export type TranscribeAudioInput = {
  /** 音轨本地路径（local 驱动抽取）或对象存储键 */
  audioPath?: string;
  /** 音轨可访问地址（s3 驱动预签名） */
  audioUrl?: string;
  durationSec?: number | null;
};

export type TranscribeInput = {
  contentId: string;
  traceId?: string;
  audio: TranscribeAudioInput;
};

export type TranscribeResult = {
  available: boolean;
  provider: string;
  segments: TranscriptSegmentInput[];
  /** 不可用原因（available=false 时给出，供 UI 提示） */
  reason?: string;
};

export type AsrStatus = {
  available: boolean;
  provider: string;
  reason?: string;
};

export interface TranscriptionProvider {
  readonly name: string;
  /** 是否已配置且可用 */
  isAvailable(): boolean;
  transcribe(input: TranscribeInput): Promise<TranscribeResult>;
}

// ---------------------------------------------------------------------------
// 时间对齐工具
// ---------------------------------------------------------------------------

/** 按 startMs 升序排序、丢弃空文本、重排 seq，保证 `TranscriptSegment` 有序入库 */
export function alignSegments(segments: TranscriptSegmentInput[]): TranscriptSegmentInput[] {
  return segments
    .filter((s) => s.text.trim().length > 0)
    .sort((a, b) => a.startMs - b.startMs)
    .map((s, index) => ({ ...s, seq: index }));
}

// ---------------------------------------------------------------------------
// mock 适配器（MVP）
// ---------------------------------------------------------------------------

const MOCK_STEP_SEC = 6;

function buildMockSegments(durationSec: number | null | undefined): TranscriptSegmentInput[] {
  const total = durationSec && durationSec > 0 ? durationSec : 30;
  const segments: TranscriptSegmentInput[] = [];
  for (let start = 0; start < total; start += MOCK_STEP_SEC) {
    const end = Math.min(start + MOCK_STEP_SEC, total);
    segments.push({
      seq: 0,
      startMs: Math.round(start * 1_000),
      endMs: Math.round(end * 1_000),
      text: `【mock 转写】第 ${segments.length + 1} 段：端云协同流水线占位转写文本。`,
    });
  }
  return alignSegments(segments);
}

export class MockTranscriptionProvider implements TranscriptionProvider {
  readonly name = 'mock';

  isAvailable(): boolean {
    return true;
  }

  async transcribe(input: TranscribeInput): Promise<TranscribeResult> {
    return {
      available: true,
      provider: this.name,
      segments: buildMockSegments(input.audio.durationSec),
    };
  }
}

// ---------------------------------------------------------------------------
// 不可用适配器
// ---------------------------------------------------------------------------

export class UnavailableTranscriptionProvider implements TranscriptionProvider {
  readonly name: string;
  readonly reason: string;

  constructor(name: string, reason: string) {
    this.name = name;
    this.reason = reason;
  }

  isAvailable(): boolean {
    return false;
  }

  async transcribe(): Promise<TranscribeResult> {
    return { available: false, provider: this.name, segments: [], reason: this.reason };
  }
}

type XunfeiConfig = {
  appId: string;
  apiSecret: string;
  baseUrl: string;
  language: string;
  pollIntervalMs: number;
  pollMaxAttempts: number;
  requestTimeoutMs: number;
};

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function positiveIntFromEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function xunfeiConfig(): XunfeiConfig | null {
  const appId = process.env.ASR_APP_ID?.trim();
  const apiSecret = process.env.ASR_API_KEY?.trim();
  if (!appId || !apiSecret) return null;

  const baseUrl = (process.env.ASR_BASE_URL?.trim() || 'https://raasr.xfyun.cn/v2/api').replace(/\/+$/, '');
  return {
    appId,
    apiSecret,
    baseUrl,
    language: process.env.ASR_LANGUAGE?.trim() || 'cn',
    pollIntervalMs: positiveIntFromEnv('ASR_POLL_INTERVAL_MS', 10_000),
    // 讯飞限制每单最多查询 100 次；保留余量，避免超限。
    pollMaxAttempts: Math.min(positiveIntFromEnv('ASR_POLL_MAX_ATTEMPTS', 90), 99),
    requestTimeoutMs: positiveIntFromEnv('ASR_REQUEST_TIMEOUT_MS', 60_000),
  };
}

function xunfeiSignature(appId: string, apiSecret: string, timestamp: string): string {
  const digest = createHash('md5').update(`${appId}${timestamp}`, 'utf8').digest('hex');
  return createHmac('sha1', apiSecret).update(digest, 'utf8').digest('base64');
}

function xunfeiUrl(config: XunfeiConfig, action: 'upload' | 'getResult', params: Record<string, string>): URL {
  const timestamp = Math.floor(Date.now() / 1_000).toString();
  const url = new URL(`${config.baseUrl}/${action}`);
  url.searchParams.set('appId', config.appId);
  url.searchParams.set('ts', timestamp);
  url.searchParams.set('signa', xunfeiSignature(config.appId, config.apiSecret, timestamp));
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url;
}

async function xunfeiRequest(url: URL, init: RequestInit, timeoutMs: number): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (!response.ok) throw new Error(`讯飞 ASR HTTP ${response.status}`);
    return await response.json() as unknown;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw new Error('讯飞 ASR 请求超时');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function serviceErrorCode(payload: unknown): string | null {
  if (!isRecord(payload)) return null;
  const code = payload.code;
  return typeof code === 'string' || typeof code === 'number' ? String(code) : null;
}

function isPendingResult(payload: unknown): boolean {
  if (!isRecord(payload)) return false;
  if (serviceErrorCode(payload) === '26605') return true;
  if (!isRecord(payload.content) || !isRecord(payload.content.orderInfo)) return false;
  const status = payload.content.orderInfo.status;
  return status === 0 || status === 3 || status === '0' || status === '3';
}

function recognizedWords(value: unknown): string {
  if (!Array.isArray(value)) return '';
  const tokens: string[] = [];
  for (const word of value) {
    if (!isRecord(word) || !Array.isArray(word.cw)) continue;
    const candidate = word.cw[0];
    if (isRecord(candidate) && typeof candidate.w === 'string') tokens.push(candidate.w);
  }
  return tokens.reduce((text, token) => {
    if (!text) return token;
    const needsSpace = /[A-Za-z0-9]$/.test(text) && /^[A-Za-z0-9]/.test(token);
    return `${text}${needsSpace ? ' ' : ''}${token}`;
  }, '');
}

function parseXunfeiSegments(payload: unknown): TranscriptSegmentInput[] {
  if (!isRecord(payload) || !isRecord(payload.content) || typeof payload.content.orderResult !== 'string') {
    throw new Error('讯飞 ASR 返回缺少转写结果');
  }
  let orderResult: unknown;
  try {
    orderResult = JSON.parse(payload.content.orderResult) as unknown;
  } catch {
    throw new Error('讯飞 ASR 返回了无效转写 JSON');
  }
  if (!isRecord(orderResult) || !Array.isArray(orderResult.lattice)) return [];

  const segments: TranscriptSegmentInput[] = [];
  for (const item of orderResult.lattice) {
    if (!isRecord(item)) continue;
    let best: unknown = item.json_1best;
    if (typeof best === 'string') {
      try {
        best = JSON.parse(best) as unknown;
      } catch {
        continue;
      }
    }
    if (!isRecord(best) || !isRecord(best.st)) continue;
    const startMs = Number(best.st.bg);
    const endMs = Number(best.st.ed);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) continue;
    const text = Array.isArray(best.st.rt)
      ? best.st.rt.map((result) => isRecord(result) ? recognizedWords(result.ws) : '').join('')
      : '';
    if (!text.trim()) continue;
    segments.push({ seq: segments.length, startMs: Math.round(startMs), endMs: Math.round(endMs), text: text.trim() });
  }
  return alignSegments(segments);
}

async function sleep(ms: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
}

export class XunfeiTranscriptionProvider implements TranscriptionProvider {
  readonly name = 'xunfei';

  isAvailable(): boolean {
    return xunfeiConfig() !== null;
  }

  async transcribe(input: TranscribeInput): Promise<TranscribeResult> {
    const config = xunfeiConfig();
    if (!config) {
      return {
        available: false,
        provider: this.name,
        segments: [],
        reason: '讯飞 ASR 未配置 ASR_APP_ID 或 ASR_API_KEY',
      };
    }
    if (!input.audio.audioPath) {
      return { available: false, provider: this.name, segments: [], reason: '讯飞 ASR 需要本地音频分段文件' };
    }

    const audioStat = await stat(input.audio.audioPath);
    if (audioStat.size === 0 || audioStat.size > 500 * 1024 * 1024) {
      return { available: false, provider: this.name, segments: [], reason: '音频为空或超过讯飞 ASR 500MB 限制' };
    }
    const audioBytes = await readFile(input.audio.audioPath);
    const fileName = path.basename(input.audio.audioPath);
    const uploadPayload = await xunfeiRequest(xunfeiUrl(config, 'upload', {
      fileName,
      fileSize: String(audioBytes.byteLength),
      duration: String(Math.max(1, Math.ceil(input.audio.durationSec ?? 0))),
      language: config.language,
      audioMode: 'fileStream',
    }), {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', Chunked: 'false' },
      body: new Uint8Array(audioBytes),
    }, config.requestTimeoutMs);

    const uploadCode = serviceErrorCode(uploadPayload);
    const uploadContent = isRecord(uploadPayload) ? uploadPayload.content : undefined;
    const orderId = isRecord(uploadContent) && typeof uploadContent.orderId === 'string'
      ? uploadContent.orderId
      : null;
    if (uploadCode !== '000000' || !orderId) {
      return {
        available: false,
        provider: this.name,
        segments: [],
        reason: `讯飞 ASR 上传失败（错误码 ${uploadCode ?? 'INVALID_RESPONSE'}）`,
      };
    }

    for (let attempt = 0; attempt < config.pollMaxAttempts; attempt += 1) {
      if (attempt > 0) await sleep(config.pollIntervalMs);
      const resultPayload = await xunfeiRequest(xunfeiUrl(config, 'getResult', { orderId }), {
        method: 'POST',
        body: new FormData(),
      }, config.requestTimeoutMs);

      const resultCode = serviceErrorCode(resultPayload);
      if (isPendingResult(resultPayload)) continue;
      if (resultCode !== '000000') {
        return {
          available: false,
          provider: this.name,
          segments: [],
          reason: `讯飞 ASR 转写失败（错误码 ${resultCode ?? 'INVALID_RESPONSE'}）`,
        };
      }
      if (isRecord(resultPayload) && isRecord(resultPayload.content) && isRecord(resultPayload.content.orderInfo)) {
        const status = resultPayload.content.orderInfo.status;
        if (status === -1 || status === '-1') {
          return { available: false, provider: this.name, segments: [], reason: '讯飞 ASR 订单处理失败' };
        }
        if (status !== 4 && status !== '4') continue;
      }
      return { available: true, provider: this.name, segments: parseXunfeiSegments(resultPayload) };
    }

    return { available: false, provider: this.name, segments: [], reason: '讯飞 ASR 轮询超时，请稍后重试' };
  }
}

// ---------------------------------------------------------------------------
// 工厂
// ---------------------------------------------------------------------------

function unavailable(name: string, reason: string): TranscriptionProvider {
  return new UnavailableTranscriptionProvider(name, reason);
}

/**
 * 依据环境变量选择转写适配器。
 * 讯飞已接入 Long Form ASR；其他供应商仍保留可替换接口。
 */
export function getTranscriptionProvider(): TranscriptionProvider {
  if (process.env.FEATURE_ASR === 'false') {
    return unavailable('none', 'ASR 功能已关闭（FEATURE_ASR=false）');
  }
  const raw = (process.env.ASR_PROVIDER ?? '').trim().toLowerCase();
  if (raw === 'mock') {
    if (process.env.NODE_ENV === 'production') {
      return unavailable('mock', '生产环境禁止使用 mock ASR');
    }
    return new MockTranscriptionProvider();
  }
  if (raw === '') return unavailable('none', '未配置 ASR_PROVIDER');
  if (raw === 'funasr-local') {
    if (!localAsrConfigured()) return unavailable(raw, '本地ASR未配置ASR_LOCAL_PYTHON或ASR_LOCAL_MODEL_DIR');
    return new LocalTranscriptionProvider();
  }
  if (raw === 'xunfei') {
    if (!xunfeiConfig()) return unavailable('xunfei', '讯飞 ASR 未配置 ASR_APP_ID 或 ASR_API_KEY');
    return new XunfeiTranscriptionProvider();
  }
  return unavailable(raw, `ASR 适配器未实现：${raw}`);
}

export function getAsrStatus(): AsrStatus {
  const provider = getTranscriptionProvider();
  const status: AsrStatus = { available: provider.isAvailable(), provider: provider.name };
  if (provider instanceof UnavailableTranscriptionProvider) {
    status.reason = provider.reason;
  }
  return status;
}

/** 转写入口：任何异常都降级为「不可用」，绝不抛出（不阻塞主流程） */
export async function transcribe(input: TranscribeInput): Promise<TranscribeResult> {
  const provider = getTranscriptionProvider();
  try {
    return await provider.transcribe(input);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    taskLogger.warn('asr: transcription failed', {
      contentId: input.contentId,
      provider: provider.name,
      error: reason,
    });
    return { available: false, provider: provider.name, segments: [], reason };
  }
}
