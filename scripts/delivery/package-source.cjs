/* Local source export only. Never reads uploads, changes a database or publishes files. */
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { loadEnvConfig } = require('@next/env');

const directories = new Set(['src', 'tests', 'scripts', 'services', 'prisma', 'public', 'spec', 'prototype', 'docs']);
const rootFiles = new Set(['.env.example', '.gitignore', '.dockerignore', 'AGENTS.md', 'README.md', 'DEPLOY.md', 'LEARNINGS.md', 'PROGRESS.md', 'Dockerfile', 'docker-compose.yml', 'package.json', 'package-lock.json', 'next.config.mjs', 'tsconfig.json', 'eslint.config.mjs', 'postcss.config.mjs', 'tailwind.config.ts', 'vitest.config.mts', 'vitest.setup.ts', '启动演示.cmd', '启动云端推理演示.cmd', '启动人脸服务.cmd']);
function allowed(relative) {
  const parts = relative.split('/');
  if (parts.some(p => !p || p === '..' || p.includes(':') || p.includes('\\'))) return false;
  if (parts.length === 1) return rootFiles.has(relative);
  if (!directories.has(parts[0])) return false;
  if (parts.some(p => p.startsWith('.') && p !== '.gitkeep')) return false;
  if (parts.some(p => /^(node_modules|uploads|venv|env|__pycache__|cache|coverage|dist|build|dataset|datasets|photos|templates|backups)$/i.test(p))) return false;
  if (/\.(pem|key|crt|p12|pfx|dump|bak|zip|7z|tar|gz|db|sqlite|sqlite3|onnx|mindir|ckpt|om|pt|pth|tflite|safetensors|bin|mp4|m4v|webm|wav|mp3|flac|pdf|log|pyc|tsbuildinfo)$/i.test(relative)) return false;
  if (/(^|\/)(private\.json|infer-token|credentials[^/]*|id_rsa|id_ed25519)$/i.test(relative)) return false;
  // Raw acceptance output can contain personal images, provider responses or credentials.
  if (parts[0] === 'docs' && path.extname(relative).toLowerCase() !== '.md') return false;
  if (parts.includes('models') && !/\.(md|json|txt)$/i.test(relative)) return false;
  return true;
}
async function fileInside(root, relative) {
  let current = root;
  for (const part of relative.split('/')) {
    current = path.join(current, part);
    if ((await fs.lstat(current)).isSymbolicLink()) throw new Error('Symbolic links are not exported');
  }
  return current;
}
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
let stage = 'inventory';

async function main() {
  const root = await fs.realpath(process.cwd());
  const outputIndex = process.argv.indexOf('--output-dir');
  const relativeOutput = outputIndex < 0 ? '.taskbook-working/source-delivery/' + Date.now() + '-' + crypto.randomUUID() : process.argv[outputIndex + 1];
  if (!relativeOutput) throw new Error('Output directory is required');
  const output = path.resolve(root, relativeOutput);
  const privateRoot = path.join(root, '.taskbook-working');
  if (!output.startsWith(privateRoot + path.sep)) throw new Error('Output must be a new ignored directory');
  await fs.mkdir(privateRoot, { recursive: true });
  if (await fs.realpath(privateRoot) !== privateRoot) throw new Error('Linked output directory rejected');
  await fs.mkdir(output, { recursive: false });
  if (await fs.realpath(output) !== output) throw new Error('Linked output parent rejected');
  const sourceRoot = path.join(output, '智能学习平台');
  await fs.mkdir(sourceRoot);
  loadEnvConfig(root, true, { info() {}, error() {} });
  const secretValues = new Set(Object.entries(process.env).filter(([name, value]) => /API_KEY|API_PASSWORD|SECRET|TOKEN|PRIVATE_KEY|_PASSWORD$/.test(name) && value && value.length >= 16).map(([, value]) => value));
  for (const name of ['DATABASE_URL', 'REDIS_URL']) {
    try { const password = decodeURIComponent(new URL(process.env[name]).password); if (password.length >= 12) secretValues.add(password); } catch { /* Missing optional service is not needed for source export. */ }
  }
  const candidates = [...new Set(execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root, maxBuffer: 16 * 1024 * 1024 }).toString('utf8').split('\0').filter(Boolean))].sort();
  const tracked = new Set(execFileSync('git', ['ls-files', '-z', '--cached'], { cwd: root, maxBuffer: 16 * 1024 * 1024 }).toString('utf8').split('\0').filter(Boolean));
  const files = [];
  let excluded = 0;
  for (const relative of candidates) {
    if (!allowed(relative)) { excluded++; continue; }
    let source;
    try { source = await fileInside(root, relative); }
    catch (error) { if (error.code === 'ENOENT') { excluded++; continue; } throw error; }
    const stat = await fs.stat(source);
    if (!stat.isFile() || stat.size > 8 * 1024 * 1024) throw new Error('Unexpected source file: ' + relative);
    const bytes = await fs.readFile(source);
    const text = bytes.toString('utf8');
    if ([...secretValues].some(secret => text.includes(secret)) || /^-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/m.test(text)) throw new Error('Sensitive content blocked in: ' + relative);
    const target = path.join(sourceRoot, relative);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, bytes, { flag: 'wx' });
    files.push({ path: relative, bytes: bytes.length, sha256: hash(bytes) });
  }
  const included = new Set(files.map(file => file.path));
  for (const relative of ['package.json', 'package-lock.json', '.env.example', 'eslint.config.mjs', 'vitest.config.mts', 'src/app/layout.tsx', 'src/app/assistant/page.tsx', 'src/app/api/graph/overview/route.ts', 'prisma/schema.prisma', 'prisma/migrations/migration_lock.toml', 'README.md', 'DEPLOY.md', 'PROGRESS.md', 'docs/demo-source-delivery.md', 'scripts/delivery/package-source.cjs', 'scripts/delivery/verify-source-zip.ps1']) {
    if (!included.has(relative)) throw new Error('Required source missing: ' + relative);
  }
  const migrationNames = (await fs.readdir('prisma/migrations', { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => entry.name);
  for (const name of migrationNames) if (!included.has('prisma/migrations/' + name + '/migration.sql')) throw new Error('Migration missing');
  for (const directory of ['spec', 'prototype']) {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) if (entry.isFile() && !included.has(directory + '/' + entry.name)) throw new Error('Core design asset missing');
  }
  const manifest = { generatedAt: new Date().toISOString(), kind: 'source-only', modelCalls: false, databaseWrites: false, dependencyAuditNotExecutedByPackager: true, excludedFiles: excluded, migrations: migrationNames.length, files };
  const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2));
  await fs.writeFile(path.join(sourceRoot, 'DELIVERY-MANIFEST.json'), manifestBytes, { flag: 'wx' });
  const archive = path.join(output, '文豪智能学习平台-源码.zip');
  stage = 'archive-and-verify';
  const shellIndex = process.argv.indexOf('--powershell');
  const shell = shellIndex >= 0 ? process.argv[shellIndex + 1] : 'pwsh.exe';
  if (!shell) throw new Error('PowerShell executable is required');
  const args = ['-NoProfile', '-NonInteractive', '-File', path.join(root, 'scripts/delivery/verify-source-zip.ps1'), '-Source', sourceRoot, '-Archive', archive];
  const options = { cwd: root, encoding: 'utf8', timeout: 120000, windowsHide: true };
  let outputText;
  try { outputText = execFileSync(shell, args, options); }
  catch (error) {
    if (error.code !== 'ENOENT' || shellIndex >= 0) throw error;
    outputText = execFileSync('powershell.exe', args, options);
  }
  const result = JSON.parse(outputText.replace(/^\uFEFF/, ''));
  if (!result.verified || result.files !== files.length) throw new Error('Archive verification failed');
  const report = { archive: path.relative(root, archive), sourceFiles: files.length, archiveEntries: files.length + 1, excludedFiles: excluded, untrackedSourceFiles: files.filter(file => !tracked.has(file.path)).length, migrations: migrationNames.length, bytes: (await fs.stat(archive)).size, sha256: hash(await fs.readFile(archive)), manifestSha256: hash(manifestBytes), allEntriesDecompressedAndHashesMatched: true, actualEnvironmentSecretsChecked: secretValues.size > 0, noPrivateEnvironmentOrMedia: true, newMachineBuildTested: false };
  await fs.writeFile(path.join(output, 'delivery-report.json'), JSON.stringify(report, null, 2), { flag: 'wx' });
  console.log(JSON.stringify(report));
}
main().catch(error => { console.error(error.message?.startsWith('Sensitive content blocked in:') || error.message?.startsWith('Required source missing:') ? error.message : JSON.stringify({ failed: true, stage, errorType: error.name, errorCode: error.code ?? null, accepted: false })); process.exitCode = 1; });
