import { timingSafeEqual } from 'node:crypto';

import { ErrorCode } from '@/lib/api/errors';
import { fail, HttpStatus } from '@/lib/api/response';
import { renderPrometheusMetrics } from '@/lib/observability/metrics';

export const dynamic = 'force-dynamic';

function hasMetricsAccess(request: Request, token: string): boolean {
  const provided = request.headers.get('authorization');
  const expected = `Bearer ${token}`;
  if (!provided || provided.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
}

/** Prometheus 抓取端点；仅接受独立的 METRICS_TOKEN。 */
export async function GET(request: Request): Promise<Response> {
  const token = process.env.METRICS_TOKEN;
  if (!token) {
    return fail(ErrorCode.METRICS_DISABLED, '监控端点尚未配置', HttpStatus.SERVICE_UNAVAILABLE);
  }
  if (!hasMetricsAccess(request, token)) {
    return fail(ErrorCode.UNAUTHENTICATED, '监控端点鉴权失败', HttpStatus.UNAUTHORIZED);
  }
  return new Response(renderPrometheusMetrics(), {
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'text/plain; version=0.0.4; charset=utf-8',
    },
  });
}
