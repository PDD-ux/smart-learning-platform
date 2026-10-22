import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const apiRoot = join(root, 'src', 'app', 'api');

function projectFile(relativePath: string): string {
  return readFileSync(join(root, relativePath), 'utf8');
}

function routeFiles(directory = apiRoot): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return routeFiles(path);
    return entry.name === 'route.ts' ? [path] : [];
  });
}

describe('P0 architecture contract', () => {
  it('keeps TypeScript source free of explicit any casts and annotations', () => {
    const sourceFiles = readdirSync(join(root, 'src'), { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile() && /\.(ts|tsx)$/.test(entry.name))
      .map((entry) => join(entry.parentPath, entry.name));

    for (const path of sourceFiles) {
      const source = readFileSync(path, 'utf8');
      expect(source, relative(root, path)).not.toMatch(/\b(?:as|:|<)\s*any\b/);
    }
  });

  it('uses the standard response and authentication wrappers on API routes', () => {
    const anonymousRoutes = new Set([
      'src/app/api/auth/login/route.ts',
      'src/app/api/auth/face/challenge/route.ts',
      'src/app/api/auth/face/login/route.ts',
      'src/app/api/auth/register/route.ts',
      'src/app/api/auth/send-code/route.ts',
      'src/app/api/auth/refresh/route.ts',
      'src/app/api/auth/logout/route.ts',
      'src/app/api/storage/object/route.ts',
      'src/app/api/storage/upload/route.ts',
      'src/app/api/metrics/route.ts',
    ]);

    for (const path of routeFiles()) {
      const relativePath = relative(root, path).replaceAll('\\', '/');
      const source = readFileSync(path, 'utf8');
      if (/^src\/app\/api\/homework\/(?:mistakes|\[id\]\/grading)(?:\/|$)/u.test(relativePath)) {
        expect(source, relativePath).toContain('@/lib/homework/grading-routes');
        expect(source, relativePath).toContain('homeworkGradingHandlers()');
        const wrapper = projectFile('src/lib/homework/grading-routes.ts');
        expect(wrapper).toContain('@/lib/api/response'); expect(wrapper).toContain('withAuth(handler)'); expect(wrapper).toContain('privateResponse(');
        continue;
      }
      if (/^src\/app\/api\/homework(?:\/|$)/u.test(relativePath)) {
        expect(source, relativePath).toContain('@/lib/homework/routes');
        expect(source, relativePath).toContain('homeworkHandlers()');
        const wrapper = projectFile('src/lib/homework/routes.ts');
        expect(wrapper).toContain('@/lib/api/response'); expect(wrapper).toContain('withAuth(handler)'); expect(wrapper).toContain('privateResponse(');
        continue;
      }
      if (/^src\/app\/api\/class-(?:assignments|submissions|attachments)(?:\/|$)/u.test(relativePath)) {
        expect(source, relativePath).toContain('@/lib/classrooms/assignment-routes');
        expect(source, relativePath).toContain('assignmentHandlers()');
        const wrapper = projectFile('src/lib/classrooms/assignment-routes.ts');
        expect(wrapper).toContain('@/lib/api/response'); expect(wrapper).toContain('withAuth(handler)'); expect(wrapper).toContain('privateResponse(');
        continue;
      }
      if (/^src\/app\/api\/classes(?:\/|$)/u.test(relativePath)) {
        expect(source, relativePath).toContain('@/lib/classrooms/routes');
        expect(source, relativePath).toContain('classHandlers()');
        const wrapper = projectFile('src/lib/classrooms/routes.ts');
        expect(wrapper).toContain('@/lib/api/response');
        expect(wrapper).toContain('withAuth(handler)');
        expect(wrapper).toContain('privateResponse(');
        continue;
      }
      if (/^src\/app\/api\/live-notes(?:\/|$)/u.test(relativePath)) {
        expect(source, relativePath).toContain('@/lib/live-notes/retired');
        expect(source, relativePath).not.toMatch(/prisma|withAuth|fetch\(/u);
        for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) expect(source, relativePath).toContain(`export const ${method} = liveNotesRetiredResponse;`);
        expect(source, relativePath).toContain('export const HEAD = liveNotesRetiredHead;');
        const retired = projectFile('src/lib/live-notes/retired.ts');
        expect(retired).toContain('ErrorCode.LIVE_NOTES_RETIRED');
        expect(retired).not.toMatch(/prisma|withAuth|fetch\(/u);
        continue;
      }
      if (/^src\/app\/api\/(?:admin\/)?(?:exams|exam-[^/]+)(?:\/|$)/u.test(relativePath)) {
        // Public tombstones return no record information and must never reach authenticated business I/O.
        expect(source, relativePath).toContain("@/lib/exams/retired");
        expect(source, relativePath).not.toMatch(/prisma|sharedRoute|withAuth|fetch\(/u);
        for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) expect(source, relativePath).toContain(`export const ${method} = examRetiredResponse;`);
        expect(source, relativePath).toContain('export const HEAD = examRetiredHead;');
        const retired = projectFile('src/lib/exams/retired.ts');
        expect(retired).toContain("@/lib/api/response");
        expect(retired).toContain("fail('EXAM_RETIRED'");
        expect(retired).not.toMatch(/prisma|withAuth|fetch\(/u);
        continue;
      }
      if (/^src\/app\/api\/((admin\/)?(courses|discussions|discussion-replies|discussion-reports|notifications)|admin\/exam-(subjects|questions|import|papers|attempts)|exams|exam-attempts|exam-generation-jobs|exam-generation-options)(\/|\/route\.ts)/.test(relativePath)) {
        // Course routes delegate to a single authenticated no-store response adapter.
        expect(source, relativePath).toContain("@/lib/courses/routes");
        expect(source, relativePath).toMatch(/export const (GET|POST|PUT|PATCH|DELETE)\s*=\s*sharedRoute/);
        const wrapper = projectFile('src/lib/courses/routes.ts');
        expect(wrapper).toContain('@/lib/api/response');
        expect(wrapper).toContain('const authed = withAuth(handler)');
        expect(wrapper).toContain("response.headers.set('Cache-Control', 'private, no-store')");
        continue;
      }
      expect(source, relativePath).toContain("@/lib/api/response");
      if (relativePath === 'src/app/api/auth/refresh/route.ts' || relativePath === 'src/app/api/auth/logout/route.ts') expect(source, relativePath).toContain('isSessionRequest(request)');
      if (!anonymousRoutes.has(relativePath)) {
        expect(source, relativePath).toContain('withAuth');
      }
    }
  });

  it('keeps client-side HTTP calls inside the service layer', () => {
    const importPage = projectFile('src/app/import/page.tsx');
    const appShell = projectFile('src/components/app/AppShell.tsx');
    const service = projectFile('src/services/api.ts');

    expect(importPage).not.toContain('fetch(');
    expect(appShell).not.toContain('fetch(');
    expect(service).toContain('export async function uploadToPresignedUrl');
    expect(service).toContain("logout: (): Promise<{ loggedOut: boolean }> => apiRequest('/api/auth/logout'");
  });

  it('contains every P0 API route required by the task list', () => {
    const relativeRoutes = new Set(routeFiles().map((path) => relative(apiRoot, path).replaceAll('\\', '/')));
    const required = [
      'contents/route.ts',
      'contents/upload-intent/route.ts',
      'contents/[id]/route.ts',
      'contents/[id]/complete/route.ts',
      'contents/[id]/resource/route.ts',
      'contents/[id]/notes/route.ts',
      'contents/[id]/progress/route.ts',
      'contents/[id]/understanding/route.ts',
      'contents/[id]/understanding/status/route.ts',
      'flashcards/route.ts',
      'flashcards/[id]/review/route.ts',
      'mastery/weak-points/route.ts',
    ];

    for (const route of required) expect(relativeRoutes).toContain(route);
  });
});
