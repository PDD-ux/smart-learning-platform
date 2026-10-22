/* Build and inspect a local production snapshot without replacing the running dev build. */
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const net = require('node:net');
const { loadEnvConfig } = require('@next/env');
const bcrypt = require('bcryptjs');

const root = process.cwd();
if (process.argv.some(value => ['--student-exams', '--exam-papers'].includes(value))) {
  throw new Error('Exam acceptance modes are retired. Use scripts/acceptance/exam-retirement.cjs for read-only checks.');
}
const outputIndex = process.argv.indexOf('--output-dir');
const outputDirectory = outputIndex >= 0 ? path.resolve(process.argv[outputIndex + 1] || '') : null;
if (outputDirectory) assert.ok(outputDirectory.startsWith(path.resolve(root, '.taskbook-working') + path.sep), 'Output must be a new ignored directory');
const logPath = outputDirectory ? path.join(outputDirectory, 'build.log') : path.join(root, '.taskbook-working/production-demo-smoke.log');
const evidencePath = outputDirectory ? path.join(outputDirectory, 'production.json') : path.join(root, 'docs/acceptance/production-demo-smoke-20261009.json');
loadEnvConfig(root);
const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient();
const insecure = new Set(['dev-secret-change-me', 'dev-jwt-secret-change-me', 'please-change-me-in-production', 'change-me-in-production', 'local-development-only-jwt-secret-not-for-production']);
const strong = (value) => typeof value === 'string' && value.trim().length >= 32 && !insecure.has(value.trim());
let server;
let fixtureId;
let log;
let snapshot;
let stage = 'configuration';
let evidenceWritten = false;

async function watchedNoteSmoke(standalone, base, headers, env) {
  stage = 'watched-credentials-and-route';
  assert.equal(env.SPARK_API_PASSWORD, '');
  assert.ok((await fs.stat(path.join(standalone, '.next/server/app/api/contents/[id]/ai/watched-note/route.js'))).size > 0);
  const original = await db.learningContent.findUniqueOrThrow({ where: { id: 'cmuqhyf7h00027q29tijy4uer' }, include: { transcripts: { orderBy: { startMs: 'asc' }, take: 1 } } });
  stage = 'watched-fixture';
  const fixture = await db.learningContent.create({ data: { ownerId: fixtureId, contentType: 'VIDEO', title: '随看生产隔离验收', fileName: original.fileName, format: original.format, fileSizeBytes: original.fileSizeBytes, storageKey: original.storageKey, durationSec: original.durationSec, status: 'READY', transcripts: { create: original.transcripts.map(({ seq, startMs, endMs, text }) => ({ seq, startMs, endMs, text })) } }, include: { transcripts: true } });
  assert.ok(fixture.transcripts.length);
  const source = fixture.transcripts[0];
  const body = { segmentIds: [source.id], throughSec: source.endMs / 1000 };
  const route = base + '/api/contents/' + fixture.id + '/ai/watched-note';
  const post = (url, payload, authenticated = true) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...(authenticated ? headers : {}) }, body: JSON.stringify(payload), signal: AbortSignal.timeout(10000) });
  stage = 'watched-anonymous';
  assert.equal((await post(route, body, false)).status, 401);
  stage = 'watched-foreign-content';
  assert.equal((await post(base + '/api/contents/' + original.id + '/ai/watched-note', body)).status, 403);
  stage = 'watched-future-source';
  assert.equal((await post(route, { ...body, throughSec: 0 })).status, 400);
  stage = 'watched-foreign-source';
  assert.equal((await post(route, { ...body, segmentIds: [original.transcripts[0].id] })).status, 400);
  stage = 'watched-missing-model';
  const unavailable = await post(route, body);
  assert.equal(unavailable.status, 503);
  assert.equal((await unavailable.json()).error.code, 'AI_UNAVAILABLE');
  assert.equal(await db.note.count({ where: { contentId: fixture.id } }), 0);
  assert.equal(await db.generatedNote.count({ where: { contentId: fixture.id } }), 0);
  stage = 'watched-study-page';
  assert.equal((await fetch(base + '/study/' + fixture.id)).status, 200);
  const retired = await fetch(base + '/live-notes', { redirect: 'manual' });
  stage = 'watched-retired-entry';
  const location = retired.headers.get('location');
  const target = location ? new URL(location, base) : null;
  const expectedOrigins = new Set([new URL(base).origin, new URL(env.APP_URL).origin]);
  const expectedImport = Boolean(target && expectedOrigins.has(target.origin) && ['/import', '/import/'].includes(target.pathname) && !target.search);
  await fs.writeFile(path.join(outputDirectory ?? path.dirname(evidencePath), 'retired-entry.json'), JSON.stringify({ status: retired.status, protocol: target?.protocol, hostname: target?.hostname, port: target?.port, pathname: target?.pathname, hasSearch: Boolean(target?.search), expectedImport }, null, 2));
  assert.ok([307, 308].includes(retired.status), 'Retired route must redirect');
  assert.ok(expectedImport);
  return { compiledRoutePresent: true, anonymousRejected: true, foreignContentRejected: true, futureSourceRejected: true, foreignSourceRejected: true, missingModelReturns503: true, failureDidNotWriteNotes: true, studyPageLoads: true, retiredEntryRedirects: true, modelCredentialsDisabled: true, actualModelGenerationTested: false, actualProductionBrowserPlaybackTested: false };
}

async function runtimeAssets(standalone, base, headers, env) {
  const required = ['node_modules/pdfjs-dist/legacy/build/pdf.mjs', 'node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs', 'node_modules/pdfjs-dist/cmaps/UniGB-UCS2-H.bcmap', 'node_modules/pdfjs-dist/standard_fonts/LiberationSans-Regular.ttf', 'services/local-asr/transcribe.py', 'services/local-asr/assets.py', 'services/local-asr/timing.py'];
  for (const relative of required) assert.ok((await fs.stat(path.join(standalone, relative))).size > 0, 'Missing standalone asset: ' + relative);
  const cryptoHash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
  for (const relative of required) assert.equal(cryptoHash(await fs.readFile(path.join(standalone,relative))), cryptoHash(await fs.readFile(path.join(root,relative))), 'Packaged asset differs');
  const pdf = await db.learningContent.findUniqueOrThrow({where:{id:'cmv50hdl7001lzh2svs7pjypg'},select:{storageKey:true,pageCount:true}});
  const sourceRoot = path.resolve(process.env.UPLOAD_DIR || 'uploads');
  const sourcePdf = path.resolve(sourceRoot,pdf.storageKey);
  assert.ok(path.relative(sourceRoot,sourcePdf) && !path.relative(sourceRoot,sourcePdf).startsWith('..'));
  const bytes = await fs.readFile(sourcePdf);
  async function post(route, body) { const response=await fetch(base+'/api/'+route,{method:'POST',headers:{...headers,'content-type':'application/json'},body:JSON.stringify(body)});assert.equal(response.status,200,route+' failed');return (await response.json()).data; }
  async function importFile(file, fileName, contentType, mimeType) {
    const intent=await post('contents/upload-intent',{contentType,fileName,fileSize:file.length,mimeType});
    const uploaded=await fetch(new URL(intent.uploadUrl,base),{method:'PUT',headers:{'content-type':mimeType},body:file});assert.equal(uploaded.status,200);
    await post('contents/'+intent.contentId+'/complete',{size:file.length});return intent.contentId;
  }
  async function terminal(id) {
    for(let attempt=0;attempt<90;attempt++) {
      const row=await db.learningContent.findUniqueOrThrow({where:{id},include:{asyncJobs:{orderBy:{createdAt:'desc'}},transcripts:true,textBlocks:true,knowledgePoints:true}});
      if(row.status==='FAILED' || row.understandingStatus==='FAILED' || row.understandingStatus==='COMPLETED') return row;
      await new Promise(resolve=>setTimeout(resolve,1000));
    }
    throw new Error('Bounded runtime acceptance timeout');
  }
  const pdfId=await importFile(bytes,'runtime-acceptance.pdf','document','application/pdf');
  const pdfResult=await terminal(pdfId); assert.equal(pdfResult.status,'READY');assert.equal(pdfResult.pageCount,pdf.pageCount);
  assert.ok(pdfResult.textBlocks.some(block=>/[一-鿿]{5}/.test(block.text)), 'No real Chinese PDF text');
  const {execFile}=require('node:child_process'); const execute=require('node:util').promisify(execFile);
  const videoPath=path.join(snapshot,'asr-fixture.mp4');
  await execute(process.env.FFMPEG_PATH || 'ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=black:s=320x240:r=2','-i',path.join(root,'.taskbook-working/local-asr/sample-535-565.wav'),'-t','30','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-shortest',videoPath],{timeout:30000,windowsHide:true});
  const videoId=await importFile(await fs.readFile(videoPath),'runtime-asr.mp4','video','video/mp4');
  const videoResult=await terminal(videoId); assert.equal(videoResult.status,'READY');assert.ok(videoResult.transcripts.length>0,'Standalone local ASR returned no segments');
  assert.ok(videoResult.transcripts.every(segment=>segment.startMs>=0 && segment.endMs<=31000 && segment.endMs>segment.startMs && segment.text.trim()),'Invalid ASR timing');
  assert.equal(env.SPARK_API_PASSWORD,'');
  assert.equal(pdfResult.knowledgePoints.length,0); assert.equal(videoResult.knowledgePoints.length,0);
  for (const result of [pdfResult, videoResult]) {
    assert.equal(result.understandingStatus,'FAILED','Missing model must fail understanding');
    assert.ok(result.asyncJobs.some(job=>typeof job.errorReason==='string' && job.errorReason.trim()),'Failure reason must be persisted');
  }
  return {assetsPresentAndHashesMatched:true,pdfPageCount:pdfResult.pageCount,pdfTextBlocks:pdfResult.textBlocks.length,realChinesePdfParsed:true,localAsrSegments:videoResult.transcripts.length,localAsrExecuted:true,externalPythonAndModelsUsed:true,videoUsesSyntheticFramesAndRealSampleAudio:true,realAscendTested:false,paidModelCredentialsDisabled:true,modelUnderstandingNotAccepted:true,pdfUnderstandingStatus:pdfResult.understandingStatus,videoUnderstandingStatus:videoResult.understandingStatus,generatedKnowledgePoints:0};
}

async function main() {
  const repaired = [];
  if (process.argv.includes('--repair-local-secrets')) {
    const envPath = path.join(root, '.env.local');
    let source = await fs.readFile(envPath, 'utf8');
    for (const key of ['JWT_SECRET', 'STORAGE_SIGN_SECRET']) {
      const matchesKey = (line) => line.match(/^[ \t]*([A-Z_]+)[ \t]*=/)?.[1] === key;
      const lines = source.split(/\r?\n/);
      const invalid = !strong(process.env[key]);
      if (!invalid && lines.filter(matchesKey).length <= 1) continue;
      const value = invalid ? crypto.randomBytes(48).toString('base64url') : process.env[key];
      source = lines.filter((line) => !matchesKey(line)).join('\n').trimEnd() + '\n' + key + '=' + value + '\n';
      process.env[key] = value;
      repaired.push(key);
    }
    if (repaired.length) await fs.writeFile(envPath, source);
  }
  assert.ok(strong(process.env.JWT_SECRET), 'JWT_SECRET must meet existing production rules');
  assert.ok(strong(process.env.STORAGE_SIGN_SECRET || process.env.JWT_SECRET), 'storage signing secret must meet production rules');
  stage = 'port-preflight';
  await new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(3100, '127.0.0.1', () => probe.close(resolve));
  });
  snapshot = await fs.mkdtemp(path.join(os.tmpdir(), 'smart-learning-production-'));
  stage = 'copy-snapshot';
  await fs.mkdir(path.join(root, '.taskbook-working'), { recursive: true });
  if (outputDirectory) await fs.mkdir(outputDirectory, { recursive: false });
  log = await fs.open(logPath, 'w');
  for (const name of ['src', 'public', 'prisma', 'services/local-asr', 'package.json', 'package-lock.json', 'next.config.mjs', 'tsconfig.json', 'tailwind.config.ts', 'postcss.config.mjs', 'eslint.config.mjs']) {
    try { await fs.cp(path.join(root, name), path.join(snapshot, name), { recursive: true }); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  // Real copied dependencies avoid Windows standalone tracing trying to recreate a junction as a symlink.
  await fs.cp(path.join(root, 'node_modules'), path.join(snapshot, 'node_modules'), { recursive: true, dereference: true });
  const runtime = process.argv.includes('--runtime-assets');
  const watched = process.argv.includes('--watched-notes');
  const env = { ...process.env, SPARK_API_PASSWORD: '', LLM_PROVIDER: 'spark', ...(runtime ? { SPARK_API_PASSWORD: '', LLM_PROVIDER: 'spark', FEATURE_MINDSPORE_INFER: 'false', FEATURE_ASR: 'true', ASR_PROVIDER: 'funasr-local', QUEUE_RETRY_MAX: '0' } : {}), ...(watched ? { SPARK_API_PASSWORD: '', LLM_PROVIDER: 'spark' } : {}), NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1', APP_URL: 'http://localhost:3100', UPLOAD_DIR: path.join(snapshot, 'uploads'), QUEUE_DRIVER: 'memory' };
  const nextBin = path.join(snapshot, 'node_modules/next/dist/bin/next');
  function start(args) {
    const child = spawn(process.execPath, [nextBin, ...args], { cwd: snapshot, env, windowsHide: true, stdio: ['ignore', log.fd, log.fd] });
    return child;
  }
  console.log(JSON.stringify({ stage: 'isolated-production-build', repairedLocalSecretNames: repaired }));
  stage = 'production-build';
  await new Promise((resolve, reject) => {
    const build = start(['build', '--webpack']);
    build.once('error', reject);
    build.once('exit', (code) => code === 0 ? resolve() : reject(new Error('Production build failed; inspect ignored build log')));
  });
  assert.ok(!(await fs.readFile(logPath, 'utf8')).includes('Failed to copy traced files'), 'standalone tracing must finish without missing files');
  const standalone = path.join(snapshot, '.next/standalone');
  stage = 'standalone-assets';
  await fs.mkdir(path.join(standalone, 'public'), { recursive: true });
  try { await fs.cp(path.join(snapshot, 'public'), path.join(standalone, 'public'), { recursive: true }); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  await fs.cp(path.join(snapshot, '.next/static'), path.join(standalone, '.next/static'), { recursive: true });
  const liveAssets = ['services/local-asr/live_worker.py', 'services/local-asr/transcribe.py', 'services/local-asr/assets.py', 'services/local-asr/timing.py', 'public/audio/live-pcm-worklet.js', 'node_modules/pdfjs-dist/legacy/build/pdf.mjs', 'node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs', 'node_modules/pdfjs-dist/cmaps/UniGB-UCS2-H.bcmap', 'node_modules/pdfjs-dist/standard_fonts/LiberationSans-Regular.ttf'];
  for (const relative of liveAssets) {
    assert.equal(crypto.createHash('sha256').update(await fs.readFile(path.join(standalone, relative))).digest('hex'), crypto.createHash('sha256').update(await fs.readFile(path.join(root, relative))).digest('hex'), 'Live note runtime asset differs: ' + relative);
  }
  console.log(JSON.stringify({ stage: 'production-http-smoke' }));
  stage = 'production-http-smoke';
  server = spawn(process.execPath, [path.join(standalone, 'server.js')], { cwd: standalone, env: { ...env, PORT: '3100', HOSTNAME: '127.0.0.1' }, windowsHide: true, stdio: ['ignore', log.fd, log.fd] });
  let startError;
  server.once('error', (error) => { startError = error; });
  let ready = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    if (startError || server.exitCode !== null) throw new Error('Isolated production server did not start');
    try { ready = (await fetch('http://127.0.0.1:3100', { signal: AbortSignal.timeout(1500) })).status === 200; } catch { /* startup */ }
    if (ready) break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  assert.ok(ready, 'production homepage must be ready');
  fixtureId = 'production-smoke-' + crypto.randomUUID();
  const password = crypto.randomUUID() + '!Aa9';
  await db.user.create({ data: { id: fixtureId, email: fixtureId + '@example.com', nickname: '生产隔离验收', passwordHash: await bcrypt.hash(password, 12) } });
  const base = 'http://127.0.0.1:3100';
  const login = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ account: fixtureId + '@example.com', password }) });
  assert.equal(login.status, 200);
  const token = (await login.json()).data.accessToken;
  const cookies = login.headers.get('set-cookie');
  assert.ok(cookies?.includes('HttpOnly') && cookies?.includes('Secure'));
  const headers = { authorization: 'Bearer ' + token };
  assert.equal((await fetch(base + '/api/contents', { headers })).status, 200);
  assert.equal((await fetch(base + '/api/contents')).status, 401);
  assert.equal((await fetch(base + '/api/admin/overview', { headers })).status, 403);
  const assets = runtime ? await runtimeAssets(standalone, base, headers, env) : null;
  const watchedNotes = watched ? await watchedNoteSmoke(standalone, base, headers, env) : null;
  const logout = await fetch(base + '/api/auth/logout', { method: 'POST', headers: { ...headers, Origin: base, 'X-Session-Refresh': '1' } });
  assert.equal(logout.status, 200);
  const evidence = { time: new Date().toISOString(), runtimeAssets: assets, watchedNotes, liveNoteRuntimeAssetsMatched: true, isolatedProductionBuildPassed: true, standaloneServerPassed: true, realHttpPostgresql: true, productionLoginPassed: true, productionSecureHttpOnlyCookies: true, authorizedContentsPassed: true, anonymousRejected: true, studentAdminRejected: true, logoutPassed: true, repairedLocalSecretNames: repaired, originalDevBuildReplaced: false, realUserDataChanged: false, publicHttpsTested: false };
  await fs.mkdir(path.join(root, 'docs/acceptance'), { recursive: true });
  await fs.writeFile(evidencePath, JSON.stringify(evidence, null, 2) + '\n');
  evidenceWritten = true;
  console.log(JSON.stringify(evidence));
}

main().catch((error) => { console.error(JSON.stringify({ failed: true, stage, errorType: error.name, errorCode: error.code ?? null })); process.exitCode = 1; }).finally(async () => {
  if (server && server.exitCode === null) {
    server.kill();
    await new Promise((resolve) => { if (server.exitCode !== null) resolve(); else server.once('exit', resolve); });
  }
  if (fixtureId) await db.user.deleteMany({ where: { id: fixtureId } });
  await db.$disconnect();
  if (log) await log.close();
  if (snapshot) {
    const tempRoot = path.resolve(os.tmpdir());
    const target = path.resolve(snapshot);
    assert.ok(path.dirname(target) === tempRoot && path.basename(target).startsWith('smart-learning-production-'));
    await fs.rm(target, { recursive: true, force: true });
  }
  if (evidenceWritten) {

    const evidence = JSON.parse(await fs.readFile(evidencePath, 'utf8'));
    evidence.temporaryFixtureCleaned = true;
    evidence.temporarySnapshotCleaned = true;
    evidence.temporaryServerStopped = true;
    await fs.writeFile(evidencePath, JSON.stringify(evidence, null, 2) + '\n');
  }
});
