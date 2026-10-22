import { redisIncrWithTtl } from '@/lib/redis';

/**
 * 限流（Redis + Lua 原子计数）
 * ------------------------------------------------------------
 * 保持 `rateLimit(key, limit, windowMs)` 同形接口（tasks.md 1.5），
 * 底层由内存 Map 切换为 Redis；普通接口与 AI/推理接口分别配置独立阈值（AI 更严格）。
 */

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  retryAfter: number; // 秒
};

const KEY_PREFIX = 'rl:';
const memoryBuckets = new Map<string, { count: number; resetAt: number }>();

function positiveIntegerEnv(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function memoryRateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  const current = memoryBuckets.get(key);
  const bucket = !current || current.resetAt <= now
    ? { count: 0, resetAt: now + windowMs }
    : current;
  bucket.count += 1;
  memoryBuckets.set(key, bucket);

  const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1_000));
  return bucket.count > limit
    ? { allowed: false, remaining: 0, retryAfter }
    : { allowed: true, remaining: Math.max(0, limit - bucket.count), retryAfter: 0 };
}

export async function rateLimit(
  key: string,
  limit = 10,
  windowMs = 60_000,
): Promise<RateLimitResult> {
  const windowSec = Math.max(1, Math.ceil(windowMs / 1000));
  const redisKey = KEY_PREFIX + key;

  let count: number;
  try {
    count = await redisIncrWithTtl(redisKey, windowSec);
  } catch {
    // Redis 不可用时进程内兜底，避免认证和 AI 接口在故障窗口完全失去防护。
    return memoryRateLimit(redisKey, limit, windowMs);
  }

  if (count > limit) {
    const ttl = await getTtl(redisKey, windowSec);
    return { allowed: false, remaining: 0, retryAfter: ttl };
  }
  return { allowed: true, remaining: Math.max(0, limit - count), retryAfter: 0 };
}

async function getTtl(key: string, fallbackSec: number): Promise<number> {
  try {
    const { getRedis } = await import('@/lib/redis');
    const ttl = await getRedis().ttl(key);
    return ttl > 0 ? ttl : fallbackSec;
  } catch {
    return fallbackSec;
  }
}

/**
 * 读取真实客户端 IP（用于按 IP 限流）。
 * 平台部署在可信反向代理（nginx 等）之后，由代理负责剥离 / 覆盖客户端伪造的
 * X-Forwarded-For 并写入真实连接 IP。这里取 XFF / X-Real-IP 中**最右（最接近服务端）**
 * 的 IP 作为客户端标识，避免读取首跳伪造 IP；这样未配置 TRUST_PROXY 时也能按真实 IP
 * 限流，杜绝单用户把全站认证 / 人脸接口共享到同一个限额桶。生产部署请确保反向代理
 * 正确设置 X-Forwarded-For（见 DEPLOY.md）。
 */
export function getClientIp(request: Request): string {
  const xff = request.headers.get('x-forwarded-for');
  if (xff) {
    const ips = xff.split(',').map((part) => part.trim()).filter(Boolean);
    if (ips.length > 0) return ips[ips.length - 1];
  }
  const realIp = request.headers.get('x-real-ip');
  if (realIp) return realIp.trim();
  return 'unknown';
}

/** 限流阈值配置（普通 / AI 分档） */
export const RateLimitPolicy = {
  /** 普通接口：默认 60 次/分钟/用户 */
  default: { limit: positiveIntegerEnv('RATE_LIMIT_DEFAULT_PER_MIN', 60), windowMs: 60_000 },
  /** 认证接口：默认 5 次/分钟/IP（PRD §7.2） */
  auth: { limit: positiveIntegerEnv('RATE_LIMIT_AUTH_PER_MIN', 5), windowMs: 60_000 },
  /** AI/推理接口：默认 10 次/分钟/用户 */
  ai: { limit: positiveIntegerEnv('RATE_LIMIT_AI_PER_MIN', 10), windowMs: 60_000 },
  /** 人脸录入/验证：默认 5 次/分钟/用户，防止暴力试探 */
  face: { limit: positiveIntegerEnv('RATE_LIMIT_FACE_PER_MIN', 5), windowMs: 60_000 },
} as const;
