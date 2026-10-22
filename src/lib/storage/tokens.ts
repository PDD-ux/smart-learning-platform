import { createHmac, timingSafeEqual } from 'node:crypto';

import { signSecret } from './config';

export type StorageTokenAction = 'put' | 'get';

function computeSignature(action: StorageTokenAction, key: string, expiresAtMs: number): string {
  return createHmac('sha256', signSecret())
    .update(`${action}\n${key}\n${expiresAtMs}`)
    .digest('base64url');
}

export function signStorageToken(
  action: StorageTokenAction,
  key: string,
  expiresAtMs: number,
): string {
  return computeSignature(action, key, expiresAtMs);
}

export function verifyStorageToken(
  action: StorageTokenAction,
  key: string,
  signature: string,
  expiresAtMs: number,
  nowMs: number = Date.now(),
): boolean {
  if (!Number.isFinite(expiresAtMs) || expiresAtMs < nowMs) return false;
  const expected = Buffer.from(computeSignature(action, key, expiresAtMs));
  const provided = Buffer.from(signature);
  return expected.length === provided.length && timingSafeEqual(expected, provided);
}
