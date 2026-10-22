/* Read-only HTTP acceptance. No credentials, fixture creation, model calls or database writes. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const base = process.env.EXAM_RETIREMENT_BASE_URL || 'http://127.0.0.1:3000';
const origin = new URL(base);
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname), 'Local demo only');
const reportPath = path.join(root, '.taskbook-working/exam-retirement-20261018/http.json');

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)]);
}
const routes = walk(path.join(root, 'src/app/api')).filter(file => file.endsWith('route.ts') && /\/api\/(?:admin\/)?(?:exams|exam-[^/]+)(?:\/|$)/u.test(file.replaceAll('\\', '/'))).map(file => '/' + path.relative(path.join(root, 'src/app'), path.dirname(file)).replaceAll('\\', '/').replaceAll('[id]', 'retired-nonexistent-id'));
const pages = ['/exams', '/exams/create?job=retired-old-job', '/exams/retired-nonexistent-id', '/exam-attempts/retired-nonexistent-id', '/exam-attempts/retired-nonexistent-id/result', '/admin/exam-bank', '/admin/exam-papers', '/admin/exam-attempts/retired-nonexistent-id'];

async function main() {
  assert.equal(routes.length, 19);
  const checks = [];
  for (const route of routes) {
    for (const method of ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
      const response = await fetch(base + route, { method, redirect: 'manual', headers: { authorization: 'Bearer invalid-retired-fixture', 'content-type': 'application/json' }, ...(!['GET', 'HEAD'].includes(method) ? { body: '{invalid-json' } : {}), signal: AbortSignal.timeout(60000) });
      assert.equal(response.status, 410, `${method} ${route}`);
      assert.equal(response.headers.get('cache-control'), 'private, no-store');
      if (method === 'HEAD') assert.equal(await response.text(), '');
      else { const body = await response.json(); assert.equal(body.success, false); assert.equal(body.error.code, 'EXAM_RETIRED'); assert.equal(body.data, undefined); assert.deepEqual(Object.keys(body.error).sort(), ['code', 'message']); }
      checks.push({ route, method, status: response.status });
    }
  }
  for (const route of pages) {
    const response = await fetch(base + route, { redirect: 'manual', signal: AbortSignal.timeout(60000) });
    assert.equal(response.status, 200, route);
    assert.ok((await response.text()).includes('试卷功能已下线'));
    checks.push({ route, method: 'GET', status: response.status, retirementNotice: true });
  }
  const anonymous = await fetch(base + '/api/exam-generation-jobs/retired-nonexistent-id/paper', { method: 'POST', body: '{}', signal: AbortSignal.timeout(60000) });
  assert.equal(anonymous.status, 410);
  const protectedApi = await fetch(base + '/api/exercises', { signal: AbortSignal.timeout(60000) });
  assert.equal(protectedApi.status, 401, 'Unrelated private practice API must still authenticate');
  const report = { time: new Date().toISOString(), apiRouteCount: routes.length, apiMethodChecks: 133, legacyPagesChecked: pages.length, anonymousReplayRetired: true, unrelatedPracticeAuthPreserved: true, actualModelTested: false, credentialsUsed: false, databaseWritesRequested: false, checks };
  fs.mkdirSync(path.dirname(reportPath), { recursive: true }); fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ apiRoutes: routes.length, apiMethodChecks: 133, oldPages: pages.length, anonymousReplayRetired: true, unrelatedPracticeAuthPreserved: true }));
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'HTTP retirement acceptance failed'); process.exitCode = 1; });
