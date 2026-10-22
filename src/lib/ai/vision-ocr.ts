import { z } from 'zod';

import { recordCounter, recordLatency } from '@/lib/observability/metrics';

/**
 * 云端视觉大模型 OCR 兜底（仅服务端调用）
 * ------------------------------------------------------------
 * 用途：本地 OCR（RapidOCR / PP-OCRv4）在手写体、复杂公式、严重模糊或
 * 低置信场景下仍有盲区。这里在**本地结果不够好时**才把原图交给云端视觉
 * 大模型重认一次，用「本地快 + 云端准」换整体最强效果。
 *
 * 设计边界（刻意与既有 LLM 网关解耦）：
 *   - 不复用 `spark.ts`：那份网关是纯文本契约，强行塞图片会破坏其校验链；
 *   - 独立环境变量，未配置时 `visionOcrEnabled()` 返回 false，全流程跳过、
 *     不报错、不改变本地行为；
 *   - 凭据只从服务端环境变量读取，绝不进入前端与日志。
 *
 * 配置（.env）：
 *   VISION_OCR_BASE_URL  OpenAI 兼容根地址，如 https://spark-api-open.xf-yun.com/v1
 *   VISION_OCR_API_KEY   对应服务的 API Key（服务侧凭据）
 *   VISION_OCR_MODEL     视觉模型名，如 generalv3.5 / 4.0Ultra / glm-4v
 *   VISION_OCR_TIMEOUT_MS 单次超时，默认 30000
 */

/** 触发云端兜底的置信度门槛：低于它说明本地结果不可靠。 */
export const VISION_OCR_LOW_CONFIDENCE = 0.85;

const DEFAULT_TIMEOUT_MS = 30_000;

export type VisionOcrResult = {
  text: string;
  model: string;
};

type VisionOcrConfig = {
  endpoint: URL;
  apiKey: string;
  model: string;
  timeoutMs: number;
};

/** 读取并校验配置；未配置或配置非法时返回 null（= 功能关闭）。 */
function readConfig(): VisionOcrConfig | null {
  const apiKey = process.env.VISION_OCR_API_KEY?.trim();
  const model = process.env.VISION_OCR_MODEL?.trim();
  const rawUrl = process.env.VISION_OCR_BASE_URL?.trim();
  if (!apiKey || !model || !rawUrl) return null;

  let endpoint: URL;
  try {
    endpoint = new URL(rawUrl);
  } catch {
    return null;
  }
  // 与既有网关一致：只接受无凭据参数的 HTTPS 地址，避免把请求发到明文通道。
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password) return null;

  const configured = Number(process.env.VISION_OCR_TIMEOUT_MS);
  const timeoutMs = Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_TIMEOUT_MS;
  return { endpoint, apiKey, model, timeoutMs };
}

/** 云端视觉兜底是否已开启。调用方据此决定是否值得发起请求。 */
export function visionOcrEnabled(): boolean {
  return readConfig() !== null;
}

const responseSchema = z.object({
  choices: z.array(
    z.object({
      message: z.object({ content: z.unknown().optional() }),
      finish_reason: z.string().nullable().optional(),
    }),
  ),
});

/** 要求模型忠实转录，不做任何解释或改写——作业识别需要原文。 */
const SYSTEM_PROMPT = [
  '你是OCR文字转录引擎。',
  '请逐行输出图片中出现的全部文字，保留题号、公式、符号与原始顺序。',
  '只输出转录结果本身，不要翻译、不要解释、不要补充、不要Markdown围栏。',
  '无法辨认的部分原样留空，禁止猜测。',
].join('');

/**
 * 用云端视觉大模型识别一张图片。
 * 未配置 / 超时 / 返回异常一律返回 null，由调用方继续使用本地结果，绝不抛错。
 */
export async function recognizeByVisionModel(
  imageBase64: string,
  mimeType: string,
  opts: { traceId?: string } = {},
): Promise<VisionOcrResult | null> {
  const config = readConfig();
  if (!config) return null;

  const startedAt = Date.now();
  let outcome = 'failure';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const response = await fetch(`${config.endpoint.href.replace(/\/$/u, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
        ...(opts.traceId ? { 'X-Trace-Id': opts.traceId } : {}),
      },
      body: JSON.stringify({
        model: config.model,
        stream: false,
        temperature: 0,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: [
              { type: 'text', text: '请转录这张图片中的全部文字。' },
              { type: 'image_url', image_url: { url: `data:${mimeType};base64,${imageBase64}` } },
            ],
          },
        ],
      }),
      redirect: 'error',
      signal: controller.signal,
    });

    const json: unknown = await response.json().catch((): null => null);
    if (!response.ok || json === null) return null;

    const parsed = responseSchema.safeParse(json);
    if (!parsed.success) return null;
    const content = parsed.data.choices[0]?.message.content;
    if (typeof content !== 'string' || !content.trim()) return null;

    outcome = 'success';
    return { text: content.trim(), model: config.model };
  } catch {
    // 网络异常 / 超时：静默放弃，本地结果继续生效。
    return null;
  } finally {
    clearTimeout(timer);
    recordCounter('slp_vision_ocr_requests_total', { model: config.model, outcome });
    recordLatency('slp_vision_ocr_duration_seconds', Date.now() - startedAt, { model: config.model, outcome });
  }
}
