import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ databaseCall: vi.fn() }));

vi.mock('@/lib/prisma', () => ({
  prisma: new Proxy({}, {
    get: (_target, modelName): object => new Proxy({}, {
      get: (_model, methodName): ((...args: unknown[]) => unknown) => (...args: unknown[]): unknown => mocks.databaseCall(String(modelName), String(methodName), ...args),
    }),
  }),
}));

type Method = 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS';
type Route = Record<Method, () => Response | Promise<Response>>;
const modules = import.meta.glob<Route>('../../../src/app/api/live-notes/**/route.ts');
const paths = Object.keys(modules).sort();
const methods: Method[] = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];

describe('retired microphone note APIs', (): void => {
  it('keeps a tombstone for every former endpoint', (): void => {
    expect(paths).toHaveLength(5);
    for (const suffix of ['/api/live-notes/route.ts', '/api/live-notes/[id]/route.ts', '/chunks/route.ts', '/highlights/route.ts', '/finish/route.ts']) {
      expect(paths.some((path): boolean => path.endsWith(suffix))).toBe(true);
    }
  });

  describe.each(paths)('%s', (path): void => {
    it.each(methods)('%s returns a private 410 without reading or writing records', async (method): Promise<void> => {
      const route = await modules[path]();
      const response = await route[method]();
      expect(response.status).toBe(410);
      expect(response.headers.get('Cache-Control')).toBe('private, no-store');
      expect(response.headers.get('Vary')).toBe('Cookie, Authorization');
      if (method === 'HEAD') expect(await response.text()).toBe('');
      else {
        const body = await response.json() as { success: boolean; error: { code: string; message: string }; data?: unknown };
        expect(body.success).toBe(false);
        expect(body.error.code).toBe('LIVE_NOTES_RETIRED');
        expect(body.error.message).toContain('已下线');
        expect(body.data).toBeUndefined();
        expect(Object.keys(body.error).sort()).toEqual(['code', 'message']);
      }
      expect(mocks.databaseCall).not.toHaveBeenCalled();
    });
  });
});
