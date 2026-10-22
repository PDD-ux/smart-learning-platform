const assert = require('node:assert/strict');
const fs = require('node:fs');
const { loadEnvConfig } = require('@next/env');
loadEnvConfig(process.cwd(), true);

async function main() {
  const base = process.env.FACE_INFER_URL;
  assert.equal(base, 'http://127.0.0.1:8002');
  const headers = { authorization: `Bearer ${process.env.FACE_INFER_TOKEN}`, 'content-type': 'application/json' };
  assert.equal((await fetch(base + '/health')).status, 401);
  const check = async (body, status) => {
    const response = await fetch(base + '/v1/face/enroll', { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(4000) });
    assert.equal(response.status, status);
    const text = await response.text();
    assert.ok(!text.includes('dataBase64') && !text.includes('secret-input-canary'));
  };
  await check({ captures: [{ mimeType: 'image/jpeg', dataBase64: 'secret-input-canary' }] }, 422);
  await check({ captures: [{ mimeType: 'text/plain', dataBase64: 'secret-input-canary' }] }, 422);
  await check({ captures: [] }, 422);
  await check({ captures: Array.from({ length: 13 }, () => ({ mimeType: 'image/jpeg', dataBase64: 'AA==' })) }, 422);
  await check({ padding: 'x'.repeat(17 * 1024 * 1024) }, 413);
  const evidence = { time: new Date().toISOString(), unauthorizedRejected: true, malformedAndOversizedRejected: true, validationDoesNotEchoInput: true };
  fs.writeFileSync('docs/acceptance/face-service-boundary-20261009.json', JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify(evidence));
}

main().catch(() => { console.error('Face service boundary acceptance failed; input and credentials omitted'); process.exitCode = 1; });
