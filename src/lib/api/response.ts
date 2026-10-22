import { NextResponse } from 'next/server';

/**
 * 统一 API 响应格式（PRD §9.3）
 * ------------------------------------------------------------
 * 成功：{ success: true,  data, message, timestamp }
 * 失败：{ success: false, error: { code, message, details }, timestamp }
 */

export type ApiSuccess<T> = {
  success: true;
  data: T;
  message: string;
  timestamp: string;
};

export type ApiFailure = {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
  timestamp: string;
};

export function ok<T>(data: T, message = 'ok', status = 200) {
  const body: ApiSuccess<T> = {
    success: true,
    data,
    message,
    timestamp: new Date().toISOString(),
  };
  return NextResponse.json(body, { status });
}

export function fail(
  code: string,
  message: string,
  status = 400,
  details?: unknown,
) {
  const body: ApiFailure = {
    success: false,
    error: { code, message, details },
    timestamp: new Date().toISOString(),
  };
  return NextResponse.json(body, { status });
}

/** HTTP 状态码语义映射（业务错误码 → 状态码） */
export const HttpStatus = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  GONE: 410,
  TOO_MANY_REQUESTS: 429,
  INTERNAL: 500,
  SERVICE_UNAVAILABLE: 503,
} as const;
