import jwt, { type SignOptions } from 'jsonwebtoken';

/**
 * JWT 签发 / 校验工具
 * ------------------------------------------------------------
 * 替换历史分支中仅用于演示的 session（tasks.md 1.4）。
 * API Key / 密钥只从环境变量读取，绝不写入日志或响应。
 */

const ACCESS_TTL = process.env.JWT_ACCESS_TTL ?? '15m';
const REFRESH_TTL = process.env.JWT_REFRESH_TTL ?? '30d';
const DEVELOPMENT_SECRET = 'local-development-only-jwt-secret-not-for-production';
const KNOWN_INSECURE_SECRETS = new Set([
  DEVELOPMENT_SECRET,
  'dev-secret-change-me',
  'dev-jwt-secret-change-me',
  'please-change-me-in-production',
  'change-me-in-production',
]);

function getJwtSecret(): string {
  const configured = process.env.JWT_SECRET?.trim();
  const production = process.env.NODE_ENV === 'production';
  if (production && (!configured || configured.length < 32 || KNOWN_INSECURE_SECRETS.has(configured))) {
    throw new Error('生产环境必须配置长度不少于 32 字符且非默认值的 JWT_SECRET');
  }
  return configured || DEVELOPMENT_SECRET;
}

export type TokenPayload = {
  sub: string; // userId
  email: string | null; // 邮箱或手机号注册时可能为空
  role: string;
  tokenUse?: 'access' | 'refresh';
  iat?: number;
  exp?: number;
};

export function signAccessToken(payload: TokenPayload, lifetimeSec = accessTtlSec()): string {
  const opts: SignOptions = { algorithm: 'HS256', expiresIn: lifetimeSec };
  return jwt.sign({ sub: payload.sub, email: payload.email, role: payload.role, tokenUse: 'access' }, getJwtSecret(), opts);
}

export function signRefreshToken(payload: TokenPayload, credentialVersion: string, lifetimeSec = refreshTtlSec()): string {
  const opts: SignOptions = { algorithm: 'HS256', expiresIn: lifetimeSec };
  return jwt.sign({ sub: payload.sub, email: payload.email, role: payload.role, tokenUse: 'refresh', credentialVersion }, getJwtSecret(), opts);
}

export function verifyToken<T extends TokenPayload = TokenPayload>(token: string): T {
  return jwt.verify(token, getJwtSecret(), { algorithms: ['HS256'] }) as T;
}

export type RefreshPayload = TokenPayload & { tokenUse: 'refresh'; credentialVersion: string; exp: number };

function validPayload(payload: TokenPayload): payload is TokenPayload & { iat: number; exp: number } {
  return typeof payload.sub === 'string' && payload.sub.length > 0 &&
    (payload.email === null || typeof payload.email === 'string') &&
    (payload.role === 'student' || payload.role === 'teacher' || payload.role === 'admin') &&
    typeof payload.iat === 'number' && Number.isFinite(payload.iat) &&
    typeof payload.exp === 'number' && Number.isFinite(payload.exp) && payload.exp > payload.iat;
}

export function verifyRefreshToken(token: string): RefreshPayload {
  const payload = verifyToken<RefreshPayload>(token);
  if (!validPayload(payload) || payload.tokenUse !== 'refresh' || !/^[a-f0-9]{64}$/.test(payload.credentialVersion ?? '')) throw new Error('Invalid refresh token');
  return payload;
}

/**
 * 解析 "15m" / "30d" / "3600" 形式的时长字符串为秒
 * 用于 Cookie maxAge 等需要数值的场景；无法解析时回退到 fallbackSec。
 */
export function parseDurationSec(value: string, fallbackSec: number): number {
  const m = /^(\d+)\s*([smhd])?$/i.exec(value.trim());
  if (!m) return fallbackSec;
  const n = Number(m[1]);
  const unit = (m[2] ?? 's').toLowerCase();
  const multiplier = unit === 'd' ? 86_400 : unit === 'h' ? 3_600 : unit === 'm' ? 60 : 1;
  return n * multiplier;
}

/** access token 有效期（秒） */
export function accessTtlSec(): number {
  return parseDurationSec(ACCESS_TTL, 900);
}

/** refresh token 有效期（秒） */
export function refreshTtlSec(): number {
  return parseDurationSec(REFRESH_TTL, 2_592_000);
}

/** 从 Authorization: Bearer <token> 提取并校验，失败返回 null（调用方决定行为） */
export function parseBearer(authHeader: string | null): TokenPayload | null {
  if (!authHeader) return null;
  const m = /^Bearer\s+(.+)$/i.exec(authHeader);
  if (!m) return null;
  try {
    const payload = verifyToken(m[1]);
    if (!validPayload(payload) || payload.tokenUse === 'refresh') return null;
    if (payload.tokenUse !== 'access' && (payload.tokenUse !== undefined || payload.exp - payload.iat > accessTtlSec())) return null;
    return payload;
  } catch {
    return null;
  }
}
