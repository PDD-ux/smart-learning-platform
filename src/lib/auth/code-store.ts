import { getRedis } from '@/lib/redis';

/**
 * 账号验证码存储（tasks.md §1.4 / §1.6）
 * ------------------------------------------------------------
 * 首选 Redis（`SET auth:code:{account} <code> EX 300`），
 * Redis 不可用时降级为进程内 Map，保证本地无 Redis 环境仍可跑通注册链路。
 * account 可为邮箱或手机号（调用方先用 parseAccount 归一化）。
 *
 * 安全约定：
 *   - 验证码只在服务端存储，绝不写入日志；
 *   - 校验采用「一次性消费」：无论成功 / 失败 / 过期，取出后立即删除，避免爆破。
 */

const CODE_TTL_SEC = 300;
const KEY_PREFIX = 'auth:code:';

export type CodeVerifyResult = 'ok' | 'not_sent' | 'expired' | 'mismatch';

type MemoryRecord = { code: string; expiresAt: number };

const globalForCode = globalThis as unknown as { __slpCodeStore?: Map<string, MemoryRecord> };
const memoryStore = globalForCode.__slpCodeStore ?? new Map<string, MemoryRecord>();
globalForCode.__slpCodeStore = memoryStore;

/** 生成 6 位数字验证码 */
export function generateCode(): string {
  return String(Math.floor(100_000 + Math.random() * 900_000));
}

function keyOf(account: string): string {
  return KEY_PREFIX + account.trim().toLowerCase();
}

/** 写入验证码（覆盖旧值并重置 TTL） */
export async function saveCode(account: string, code: string, ttlSec = CODE_TTL_SEC): Promise<void> {
  const key = keyOf(account);
  try {
    await getRedis().set(key, code, 'EX', ttlSec);
  } catch {
    memoryStore.set(key, { code, expiresAt: Date.now() + ttlSec * 1_000 });
  }
}

/**
 * 校验并一次性消费验证码
 * @returns 'ok' 通过 / 'not_sent' 未发送或已被消费 / 'expired' 已过期 / 'mismatch' 不匹配
 */
export async function verifyAndConsumeCode(account: string, input: string): Promise<CodeVerifyResult> {
  const key = keyOf(account);
  let stored: string | null = null;
  let expired = false;

  try {
    stored = await getRedis().get(key);
    if (stored !== null) {
      await getRedis().del(key);
    }
  } catch {
    const record = memoryStore.get(key);
    if (record) {
      expired = Date.now() > record.expiresAt;
      stored = expired ? null : record.code;
      memoryStore.delete(key);
    }
  }

  if (stored === null) return expired ? 'expired' : 'not_sent';
  return stored === input ? 'ok' : 'mismatch';
}

export { CODE_TTL_SEC };
