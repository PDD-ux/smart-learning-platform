import Redis from 'ioredis';

/**
 * Redis 客户端单例
 * ------------------------------------------------------------
 * 供限流计数、进度缓存 TTL、BullMQ 连接复用（tasks.md 2.2）。
 */

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
const useBullMq = process.env.QUEUE_DRIVER === 'bullmq';

const globalForRedis = globalThis as unknown as { __slpRedis?: Redis };

export function getRedis(): Redis {
  if (!globalForRedis.__slpRedis) {
    const client = new Redis(REDIS_URL, {
      // BullMQ 需要允许请求一直排队；普通本地开发则必须快速失败，
      // 让限流和验证码逻辑及时切换到进程内兜底，而不是让请求永久卡住。
      maxRetriesPerRequest: useBullMq ? null : 1,
      enableReadyCheck: false,
      enableOfflineQueue: useBullMq,
      connectTimeout: 1_000,
      retryStrategy: useBullMq ? (times) => Math.min(times * 200, 2_000) : null,
    });
    client.on('error', (err) => {
      // 不抛异常终止进程，由调用方感知不可用
      // eslint-disable-next-line no-console
      console.error('[redis]', err.message);
    });
    globalForRedis.__slpRedis = client;
  }
  return globalForRedis.__slpRedis;
}

/** 固定窗口限流 Lua 脚本：原子 INCR + EXPIRE */
const FIXED_WINDOW_LUA = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
return current
`;

export async function redisIncrWithTtl(key: string, windowSec: number): Promise<number> {
  const redis = getRedis();
  return Number(await redis.eval(FIXED_WINDOW_LUA, 1, key, windowSec));
}
