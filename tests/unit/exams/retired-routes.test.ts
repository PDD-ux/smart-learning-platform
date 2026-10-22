import { describe, expect, it } from 'vitest';

type Route = Record<string, () => Response>;
const modules = import.meta.glob<Route>('../../../src/app/api/**/route.ts');
const paths = Object.keys(modules).filter((path): boolean => /\/api\/(?:admin\/)?(?:exams|exam-[^/]+)(?:\/|$)/u.test(path)).sort();
const methods = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] as const;

describe('all legacy exam endpoints are permanently retired', (): void => {
  it('covers every student, generation and admin route, including late publish and grading', (): void => {
    expect(paths).toHaveLength(19);
    for (const suffix of ['exams/[id]/attempts/route.ts', 'exam-attempts/[id]/submit/route.ts', 'exam-attempts/[id]/result/route.ts', 'exam-generation-jobs/[id]/paper/route.ts', 'exam-generation-jobs/[id]/preview/route.ts', 'admin/exam-attempts/[id]/grades/route.ts']) {
      expect(paths.some((path): boolean => path.endsWith(suffix))).toBe(true);
    }
  });
  describe.each(paths)('%s', (path): void => {
    it.each(methods)('%s returns no record data, even on repeated old requests', async (method): Promise<void> => {
      const route = await modules[path]();
      for (let repeat = 0; repeat < 2; repeat++) {
        const response = route[method]();
        expect(response.status).toBe(410);
        expect(response.headers.get('Cache-Control')).toBe('private, no-store');
        if (method === 'HEAD') expect(await response.text()).toBe('');
        else {
          const body = await response.json() as { success: boolean; error: { code: string; message: string }; data?: unknown };
          expect(body.success).toBe(false);
          expect(body.error.code).toBe('EXAM_RETIRED');
          expect(body.error.message).toContain('已下线');
          expect(body.data).toBeUndefined();
          expect(Object.keys(body.error).sort()).toEqual(['code', 'message']);
        }
      }
    });
  });
});

