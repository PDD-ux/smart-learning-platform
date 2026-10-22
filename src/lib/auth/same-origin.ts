import type { NextRequest } from 'next/server';

function allowedOrigins(request: NextRequest): Set<string> {
  const configured = process.env.APP_URL?.trim();
  if (!configured && process.env.NODE_ENV === 'production') return new Set();
  try {
    const url = new URL(configured || request.url);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return new Set();
    const origins = new Set([url.origin]);
    // Exact loopback aliases only: never accept arbitrary hosts or forwarded headers.
    if (configured && ['localhost', '127.0.0.1'].includes(url.hostname)) {
      const alias = new URL(url.origin);
      alias.hostname = url.hostname === 'localhost' ? '127.0.0.1' : 'localhost';
      origins.add(alias.origin);
    }
    return origins;
  } catch { return new Set(); }
}

/** Cookie 续期/退出只接受可信公开源；自定义头与 Fetch Metadata 阻止跨站请求。 */
export function isSessionRequest(request: NextRequest): boolean {
  if (request.headers.get('x-session-refresh') !== '1' || request.headers.get('sec-fetch-site') === 'cross-site') return false;
  const origin = request.headers.get('origin');
  if (!origin) return false;
  try {
    // Origin must be an origin, not a URL with credentials, path, query or fragment.
    if (new URL(origin).origin !== origin) return false;
    return allowedOrigins(request).has(origin);
  } catch { return false; }
}
