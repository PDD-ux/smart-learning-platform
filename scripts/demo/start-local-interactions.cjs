const { spawn } = require('node:child_process');
const { createConnection } = require('node:net');
const { existsSync, mkdirSync, copyFileSync, cpSync, symlinkSync, rmSync, writeFileSync } = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { tmpdir } = require('node:os');
const { loadEnvConfig, updateInitialEnv } = require('@next/env');

const HOST = '127.0.0.1';
const PORT = 3100;
const root = process.cwd();
const tempRoot = path.resolve(tmpdir());
const appRoot = path.join(tempRoot, `slp-local-interactions-${process.pid}-${Date.now()}`);
let child;
let stopping = false;

function localOnly() {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error('DATABASE_URL 未配置。');
  const database = new URL(raw);
  if (!['localhost', '127.0.0.1', '::1'].includes(database.hostname)) throw new Error('数据库不是本机回环地址，拒绝启动互动演示。');
  if ((process.env.STORAGE_DRIVER ?? 'local').toLowerCase() !== 'local') throw new Error('对象存储不是 local，拒绝启动互动演示。');
}

function portAvailable() {
  return new Promise((resolve) => {
    const socket = createConnection({ host: HOST, port: PORT });
    socket.once('connect', () => { socket.destroy(); resolve(false); });
    socket.once('error', (error) => { socket.destroy(); resolve(error.code === 'ECONNREFUSED'); });
    socket.setTimeout(1000, () => { socket.destroy(); resolve(false); });
  });
}

function linkDirectory(name) {
  const target = path.join(root, name);
  if (existsSync(target)) symlinkSync(target, path.join(appRoot, name), 'junction');
}

async function buildIsolatedApp() {
  mkdirSync(appRoot, { recursive: true });
  for (const name of ['package.json', 'tsconfig.json', 'next-env.d.ts', 'postcss.config.mjs', 'tailwind.config.ts', 'eslint.config.mjs']) {
    const source = path.join(root, name);
    if (existsSync(source)) copyFileSync(source, path.join(appRoot, name));
  }
  for (const name of ['src', 'public']) {
    const source = path.join(root, name);
    if (existsSync(source)) cpSync(source, path.join(appRoot, name), { recursive: true, dereference: false });
  }
  for (const name of ['node_modules', 'services']) linkDirectory(name);
  const originalConfig = pathToFileURL(path.join(root, 'next.config.mjs')).href;
  const isolatedConfig = [
    `import baseConfig from ${JSON.stringify(originalConfig)};`,
    `export default { ...baseConfig, distDir: '.next' };`,
    '',
  ].join('\n');
  writeFileSync(path.join(appRoot, 'next.config.mjs'), isolatedConfig, 'utf8');
}

function stop(signal) {
  if (stopping) return;
  stopping = true;
  if (child && child.exitCode === null) child.kill(signal);
}

async function main() {
  loadEnvConfig(root, true);
  updateInitialEnv(process.env);
  localOnly();
  if (!(await portAvailable())) throw new Error(`127.0.0.1:${PORT} 已被占用；不会终止占用进程。`);
  await buildIsolatedApp();
  process.env.UPLOAD_DIR = path.resolve(root, process.env.UPLOAD_DIR?.trim() || 'uploads');
  process.env.DISCUSSION_RELEASE_READY = 'true';
  process.env.NEXT_TELEMETRY_DISABLED = '1';
  const nextCli = path.join(root, 'node_modules', 'next', 'dist', 'bin', 'next');
  if (!existsSync(nextCli)) throw new Error('当前目录没有本机Next.js安装。');
  child = spawn(process.execPath, [nextCli, 'dev', '--webpack', '-H', HOST, '-p', String(PORT)], {
    cwd: appRoot,
    env: process.env,
    stdio: 'inherit',
    windowsHide: false,
  });
  process.on('SIGINT', () => stop('SIGINT'));
  process.on('SIGTERM', () => stop('SIGTERM'));
  child.once('error', () => { console.error('互动演示网页启动失败；原3000端口服务未被操作。'); process.exitCode = 1; });
  child.once('exit', (code, signal) => {
    child = undefined;
    try {
      const relative = path.relative(tempRoot, appRoot);
      if (path.dirname(appRoot) !== tempRoot || !path.basename(appRoot).startsWith(`slp-local-interactions-${process.pid}-`) || path.isAbsolute(relative) || relative.startsWith('..')) throw new Error('临时目录安全校验失败');
      rmSync(appRoot, { recursive: true, force: true });
    } catch {
      console.error('临时独立构建目录未自动清理；请检查系统Temp下本次slp-local-interactions目录。');
      process.exitCode = 1;
    }
    if (!stopping && code !== 0) process.exitCode = code ?? 1;
    if (signal && !stopping) console.error(`互动演示服务收到 ${signal} 并已退出。`);
  });
  console.log(`互动演示服务仅监听 http://${HOST}:${PORT}；环境开关仅对子进程生效，按 Ctrl+C 关闭。`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : '互动演示服务启动失败。');
  if (existsSync(appRoot)) {
    const relative = path.relative(tempRoot, appRoot);
    if (path.dirname(appRoot) === tempRoot && path.basename(appRoot).startsWith(`slp-local-interactions-${process.pid}-`) && !path.isAbsolute(relative) && !relative.startsWith('..')) rmSync(appRoot, { recursive: true, force: true });
  }
  process.exitCode = 1;
});
