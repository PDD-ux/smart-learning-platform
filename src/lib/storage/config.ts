import path from 'node:path';

import { StorageError } from './types';
import type { StorageDriver } from './types';

export const DEFAULT_CONTENT_TYPE = 'application/octet-stream';

function intEnv(key: string, fallback: number): number {
  const n = Number(process.env[key]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export function boolEnv(key: string, fallback: boolean): boolean {
  const raw = (process.env[key] ?? '').trim().toLowerCase();
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return fallback;
}

/** 解析驱动：STORAGE_DRIVER 显式指定优先，否则默认 local */
export function getStorageDriver(): StorageDriver {
  return (process.env.STORAGE_DRIVER ?? '').trim().toLowerCase() === 's3' ? 's3' : 'local';
}

export function presignedExpiresSec(): number {
  return intEnv('S3_PRESIGNED_EXPIRES', 3_600);
}

export function appUrl(): string {
  return (process.env.APP_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
}

export function localRoot(): string {
  return path.resolve(process.env.UPLOAD_DIR ?? path.join(process.cwd(), 'uploads'));
}

export function signSecret(): string {
  const secret = process.env.STORAGE_SIGN_SECRET?.trim() || process.env.JWT_SECRET?.trim();
  if (process.env.NODE_ENV === 'production' && (!secret || secret.length < 32)) {
    throw new Error('生产环境必须配置长度不少于 32 字符的 STORAGE_SIGN_SECRET 或 JWT_SECRET');
  }
  return secret || 'dev-storage-sign-secret';
}

export function s3Bucket(): string {
  const bucket = process.env.S3_BUCKET ?? '';
  if (!bucket) throw new StorageError('UNAVAILABLE', 'S3_BUCKET is not configured');
  return bucket;
}
