import { z } from 'zod';

import { TIMEOUTS } from '@/lib/config';
import type { FaceCapture } from './capture';
import type { LivenessAction } from './liveness-challenge';

export type FaceEnrollmentAnalysis = {
  faceCount: number;
  embedding: Buffer;
  modelVersion: string;
};

export type FaceVerificationAnalysis = {
  verificationMode?: 'action' | 'scan';
  faceCount: number;
  matched: boolean;
  livenessPassed: boolean;
  modelVersion: string;
};

export interface FaceVerificationProvider {
  enroll(captures: readonly FaceCapture[]): Promise<FaceEnrollmentAnalysis>;
  verify(input: {
    captures: readonly FaceCapture[];
    templateEmbedding: Buffer;
    challengeId: string;
    challengeAction: LivenessAction;
    verificationMode?: 'action' | 'scan';
  }): Promise<FaceVerificationAnalysis>;
}

export class FaceProviderUnavailableError extends Error {
  constructor() {
    super('没有可用的、已授权的人脸识别模型服务');
    this.name = 'FaceProviderUnavailableError';
  }
}

const enrollmentResponseSchema = z.object({
  faceCount: z.number().int().min(0).max(10),
  embeddingBase64: z.string().min(1).max(32_768),
  modelVersion: z.string().min(1).max(120),
});

const verificationResponseSchema = z.object({
  verificationMode: z.enum(['action', 'scan']).default('action'),
  faceCount: z.number().int().min(0).max(10),
  matched: z.boolean(),
  livenessPassed: z.boolean(),
  modelVersion: z.string().min(1).max(120),
});

function configuredModelVersion(): string {
  const value = process.env.FACE_INFER_MODEL_VERSION?.trim();
  if (!value) throw new FaceProviderUnavailableError();
  return value;
}

function providerUrl(): string {
  const raw = process.env.FACE_INFER_URL?.trim();
  if (!raw || process.env.FACE_VERIFICATION_PROVIDER !== 'licensed-http') {
    throw new FaceProviderUnavailableError();
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new FaceProviderUnavailableError();
  }
  if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:') {
    throw new FaceProviderUnavailableError();
  }
  return url.toString().replace(/\/$/, '');
}

function providerHeaders(): HeadersInit {
  const headers: HeadersInit = { 'content-type': 'application/json' };
  const token = process.env.FACE_INFER_TOKEN?.trim();
  if (token) headers.authorization = `Bearer ${token}`;
  return headers;
}

function toPayloadCaptures(captures: readonly FaceCapture[]): { mimeType: string; dataBase64: string }[] {
  return captures.map((capture) => ({ mimeType: capture.mimeType, dataBase64: capture.bytes.toString('base64') }));
}

async function postJson(path: string, body: unknown): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout((): void => controller.abort(), TIMEOUTS.FACE_VERIFY_MS);
  try {
    const response = await fetch(`${providerUrl()}${path}`, {
      method: 'POST',
      headers: providerHeaders(),
      body: JSON.stringify(body),
      cache: 'no-store',
      signal: controller.signal,
    }).catch(() => {
      throw new FaceProviderUnavailableError();
    });
    if (!response.ok) throw new FaceProviderUnavailableError();
    return await response.json().catch(() => {
      throw new FaceProviderUnavailableError();
    });
  } finally { clearTimeout(timeout); }
}

/** 仅验证配置，不查询账号，也不以配置齐全冒充模型在线。 */
export function assertFaceLoginConfigured(): void {
  providerUrl();
  configuredModelVersion();
  if (!process.env.FACE_CHALLENGE_SECRET || process.env.FACE_CHALLENGE_SECRET.trim().length < 32) throw new FaceProviderUnavailableError();
}

class LicensedHttpFaceProvider implements FaceVerificationProvider {
  async enroll(captures: readonly FaceCapture[]): Promise<FaceEnrollmentAnalysis> {
    const parsed = enrollmentResponseSchema.safeParse(await postJson('/v1/face/enroll', {
      captures: toPayloadCaptures(captures),
    }));
    if (!parsed.success || parsed.data.modelVersion !== configuredModelVersion()) {
      throw new FaceProviderUnavailableError();
    }
    const embedding = Buffer.from(parsed.data.embeddingBase64, 'base64');
    if (!embedding.length || embedding.toString('base64') !== parsed.data.embeddingBase64) {
      embedding.fill(0);
      throw new FaceProviderUnavailableError();
    }
    return { faceCount: parsed.data.faceCount, embedding, modelVersion: parsed.data.modelVersion };
  }

  async verify(input: {
    captures: readonly FaceCapture[];
    templateEmbedding: Buffer;
    challengeId: string;
    challengeAction: LivenessAction;
    verificationMode?: 'action' | 'scan';
  }): Promise<FaceVerificationAnalysis> {
    const parsed = verificationResponseSchema.safeParse(await postJson('/v1/face/verify', {
      captures: toPayloadCaptures(input.captures),
      templateEmbeddingBase64: input.templateEmbedding.toString('base64'),
      challengeId: input.challengeId,
      challengeAction: input.challengeAction,
      verificationMode: input.verificationMode ?? 'action',
    }));
    if (!parsed.success || parsed.data.modelVersion !== configuredModelVersion()) {
      throw new FaceProviderUnavailableError();
    }
    return parsed.data;
  }
}

let testProvider: FaceVerificationProvider | null = null;

export function getFaceVerificationProvider(): FaceVerificationProvider {
  return testProvider ?? new LicensedHttpFaceProvider();
}

/** 仅供单测注入确定性、无网络的模型替身；生产环境不提供 mock 识别。 */
export function __setFaceVerificationProviderForTest(provider: FaceVerificationProvider | null): void {
  testProvider = provider;
}
