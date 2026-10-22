import { createHash } from 'node:crypto';

import { getRedis } from '@/lib/redis';

const FAILURE_WINDOW_SEC = 5 * 60;
const FAILURE_LIMIT = 3;
const memoryCooldown = new Map<string, { failures: number; expiresAt: number; cooldownUntil: number }>();

function subjectHash(userId: string): string {
  return createHash('sha256').update(userId).digest('hex');
}

function keys(userId: string): { failures: string; cooldown: string; memory: string } {
  const value = subjectHash(userId);
  return {
    failures: `face:verify:failures:${value}`,
    cooldown: `face:verify:cooldown:${value}`,
    memory: value,
  };
}

export async function isFaceVerificationCoolingDown(userId: string, now: number = Date.now()): Promise<boolean> {
  const key = keys(userId);
  try {
    return (await getRedis().ttl(key.cooldown)) > 0;
  } catch {
    const state = memoryCooldown.get(key.memory);
    return Boolean(state && state.cooldownUntil > now);
  }
}

export async function recordFaceVerificationFailure(userId: string, now: number = Date.now()): Promise<void> {
  const key = keys(userId);
  try {
    const redis = getRedis();
    const failures = await redis.incr(key.failures);
    if (failures === 1) await redis.expire(key.failures, FAILURE_WINDOW_SEC);
    if (failures >= FAILURE_LIMIT) await redis.set(key.cooldown, '1', 'EX', FAILURE_WINDOW_SEC);
  } catch {
    const previous = memoryCooldown.get(key.memory);
    const state = !previous || previous.expiresAt <= now
      ? { failures: 0, expiresAt: now + FAILURE_WINDOW_SEC * 1_000, cooldownUntil: 0 }
      : previous;
    state.failures += 1;
    if (state.failures >= FAILURE_LIMIT) state.cooldownUntil = now + FAILURE_WINDOW_SEC * 1_000;
    memoryCooldown.set(key.memory, state);
  }
}

export async function clearFaceVerificationFailures(userId: string): Promise<void> {
  const key = keys(userId);
  memoryCooldown.delete(key.memory);
  try {
    await getRedis().del(key.failures, key.cooldown);
  } catch {
    // Redis 不可用时，内存状态已经清理；不记录用户标识或失败原因。
  }
}

export function __resetFaceCooldownForTest(): void {
  memoryCooldown.clear();
}
