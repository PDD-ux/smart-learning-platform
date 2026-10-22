import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, realpath, stat, writeFile } from 'node:fs/promises';
import { createConnection } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { loadEnvConfig } from '@next/env';
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';

type Check = { status: 'ready' | 'blocked' | 'offline' | 'configured'; message: string };
export type DemoReport = { mode: 'display' | 'import'; checkedAt: string; ready: boolean; checks: Record<string, Check>; modelCalled: false; databaseWrites: false };
const DEMO_IDS = ['cmuqhyf7h00027q29tijy4uer', 'cmuwe49fx0002ado07gypipxl', 'cmunzyqdv0002t6x87pauda0k'];
const REQUIRED = ['node', 'database', 'materials', 'auth', 'queue', 'storage'];
const IMPORT_REQUIRED = ['asr', 'generation', 'ascend', 'ascendAuth', 'mediaTools'];
const check = (status: Check['status'], message: string): Check => ({ status, message });

export function assetPath(root: string, key: string): string | null {
  if (!key) return null;
  const target = path.resolve(root, key);
  const relative = path.relative(root, target);
  return !relative || path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`) ? null : target;
}

export function readyFor(report: DemoReport, starting = false): boolean {
  const names = [...REQUIRED, ...(report.mode === 'import' ? IMPORT_REQUIRED : [])];
  const prerequisites = names.every((name) => ['ready', 'configured'].includes(report.checks[name]?.status ?? 'missing'));
  return prerequisites && (report.checks.web?.status === 'ready' || (starting && report.checks.web?.status === 'offline'));
}

async function portOpen(): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port: 3000 });
    const finish = (value: boolean): void => { socket.destroy(); resolve(value); };
    socket.setTimeout(1_000); socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false)); socket.once('timeout', () => finish(true));
  });
}

async function webCheck(): Promise<Check> {
  if (!await portOpen()) return check('offline', '网页未启动，可运行 npm run demo:start。');
  try {
    const response = await fetch('http://127.0.0.1:3000/login', { signal: AbortSignal.timeout(8_000), redirect: 'error' });
    const html = await response.text();
    if (response.ok && /<title>文豪/.test(html)) return check('ready', '检测到文豪网页，启动入口会复用；品牌检查不验证进程配置是否最新。');
  } catch { /* Never print upstream URLs or exception text. */ }
  return check('blocked', '3000已占用但未确认是本项目；不会停止占用者，请核对原终端。');
}

async function databaseCheck(): Promise<{ database: Check; materials: Check }> {
  const failed = { database: check('blocked', '数据库连接或表结构不可用；检查本机数据库服务。'), materials: check('blocked', '数据库未就绪，无法核对演示资料。') };
  let client: PrismaClient | undefined;
  let databaseRead = false;
  try {
    const { PrismaClient } = await import('@prisma/client');
    const url = new URL(process.env.DATABASE_URL ?? '');
    url.searchParams.set('connect_timeout', '3'); url.searchParams.set('pool_timeout', '3');
    client = new PrismaClient({ datasources: { db: { url: url.toString() } }, log: [] });
    const rows = await client.$transaction((tx) => tx.learningContent.findMany({ where: { id: { in: DEMO_IDS } }, select: { status: true, understandingStatus: true, storageKey: true, fileSizeBytes: true } }), { timeout: 4_000, maxWait: 3_000 });
    databaseRead = true;
    const database = check('ready', '数据库及资料表可读取（只读）。');
    if (rows.length !== 3 || rows.some((row) => row.status !== 'READY' || row.understandingStatus !== 'COMPLETED')) return { database, materials: check('blocked', '固定三份演示资料缺失或尚未解析完成。') };
    if ((process.env.STORAGE_DRIVER ?? 'local') !== 'local') return { database, materials: check('blocked', '本入口只验证本地媒体；S3资料请另行核验。') };
    const root = await realpath(path.resolve(process.env.UPLOAD_DIR ?? 'uploads'));
    for (const row of rows) {
      const candidate = assetPath(root, row.storageKey);
      if (!candidate) return { database, materials: check('blocked', '媒体路径无效。') };
      const file = await realpath(candidate);
      if (!assetPath(root, path.relative(root, file))) return { database, materials: check('blocked', '媒体路径超出演示存储目录。') };
      const info = await stat(file);
      if (!info.isFile() || info.size <= 0 || BigInt(info.size) !== row.fileSizeBytes) return { database, materials: check('blocked', '媒体缺失或大小不匹配，不能宣称可播放。') };
    }
    return { database, materials: check('ready', '三份已解析资料及原媒体文件大小匹配；实际播放仍需网页核对。') };
  } catch { return databaseRead ? { database: check('ready', '数据库及资料表可读取（只读）。'), materials: check('blocked', '媒体文件检查失败，原数据未改动。') } : failed; }
  finally { if (client) await client.$disconnect().catch((): void => undefined); }
}

export async function serviceHealth(kind: 'face' | 'ascend'): Promise<Check> {
  const base = kind === 'face' ? process.env.FACE_INFER_URL : process.env.ASCEND_INFER_URL;
  if (!base) return check('blocked', kind === 'face' ? '未配置人脸服务；仍可用密码登录。' : '未配置云端推理；已有资料仍可展示。');
  try {
    const response = await fetch(new URL('/health', base), {
      headers: kind === 'face' && process.env.FACE_INFER_TOKEN ? { authorization: `Bearer ${process.env.FACE_INFER_TOKEN}` } : undefined,
      signal: AbortSignal.timeout(4_000), redirect: 'error',
    });
    const schema = kind === 'face'
      ? z.object({ status: z.literal('ok'), modelsLoaded: z.literal(true), modelVersion: z.literal(process.env.FACE_INFER_MODEL_VERSION ?? '') })
      : z.object({ status: z.literal('ok'), device: z.literal('ascend'), mindsporeAvailable: z.literal(true), modelsLoaded: z.literal(true), mock: z.literal(false), ocrFallbackAvailable: z.literal(false) });
    if (response.ok && schema.safeParse(await response.json()).success) return check('ready', kind === 'face' ? '真实人脸模型健康；未验证本人模板/扫描登录。' : '真实Ascend模型健康；未验证推理鉴权或新导入。');
    return check('blocked', '服务未返回符合演示要求的模型健康状态。');
  } catch { return check('blocked', kind === 'face' ? '人脸服务当前不可达；请用密码登录或手动启动 face:start。' : '云端推理当前不可达；现场新导入需按DEPLOY恢复连接。'); }
}

async function mediaTools(): Promise<Check> {
  try {
    const execute = promisify(execFile);
    await Promise.all([
      execute(process.env.FFMPEG_PATH ?? 'ffmpeg', ['-version'], { timeout: 3_000, windowsHide: true }),
      execute(process.env.FFPROBE_PATH ?? 'ffprobe', ['-version'], { timeout: 3_000, windowsHide: true }),
    ]);
    return check('ready', 'ffmpeg/ffprobe可运行，未抽帧或创建ASR订单。');
  } catch { return check('blocked', '媒体工具不可用，请核对ffmpeg/ffprobe路径。'); }
}

async function authCheck(): Promise<Check> {
  try {
    const { signAccessToken, verifyToken } = await import('../../src/lib/auth/jwt');
    const token = signAccessToken({ sub: 'local-preflight', email: null, role: 'student' }, 60);
    if (verifyToken(token).sub !== 'local-preflight') return check('blocked', '本地认证工具校验失败。');
    return check('ready', '本地JWT可签发与校验；不是生产密钥安全验收，不修改现有配置。');
  } catch { return check('blocked', '认证工具配置不可用；不会自动修改签名密钥。'); }
}

export async function inspectDemo(mode: DemoReport['mode']): Promise<DemoReport> {
  const [web, data, face, ascend, tools, auth] = await Promise.all([webCheck(), databaseCheck(), serviceHealth('face'), mode === 'import' ? serviceHealth('ascend') : Promise.resolve(check('offline', '展示已有资料不检查或启动云端推理。')), mode === 'import' ? mediaTools() : Promise.resolve(check('offline', '展示已有资料不运行媒体工具。')), authCheck()]);
  const major = Number(process.versions.node.split('.')[0]);
  const keys = (names: string[]): boolean => names.every((name) => Boolean(process.env[name]?.trim()));
  const provider = process.env.LLM_PROVIDER?.trim() || 'spark';
  const agentConfigured = provider === 'spark' && keys(['SPARK_API_PASSWORD']) && /^[\x21-\x7e]+$/u.test(process.env.SPARK_API_PASSWORD?.trim() || '');
  const report: DemoReport = { mode, checkedAt: new Date().toISOString(), ready: false, modelCalled: false, databaseWrites: false, checks: {
    node: check(major === 24 || major >= 26 || major === 22 && Number(process.versions.node.split('.')[1]) >= 13 ? 'ready' : 'blocked', '需要Node 22.13（22系）、24系或26+，推荐24 LTS。'),
    web, ...data,
    auth,
    queue: check((process.env.QUEUE_DRIVER ?? 'memory') === 'memory' ? 'ready' : 'blocked', (process.env.QUEUE_DRIVER ?? 'memory') === 'memory' ? '本地memory队列无需Docker/Redis 7。' : 'BullMQ需独立worker预检，本启动入口不启动消费者。'),
    storage: check((process.env.STORAGE_DRIVER ?? 'local') === 'local' ? 'ready' : 'blocked', '本地存储演示；S3需另行检查。'),
    agent: check(agentConfigured ? 'configured' : 'blocked', agentConfigured ? '统一大模型凭据已配置，未调用API或查询云端余额。' : 'Agent配置不完整，已有笔记/题目仍可展示。'),
    generation: check(agentConfigured ? 'configured' : 'blocked', '统一大模型配置检查，不代表在线、模型权限或剩余额度已验证。'),
    asr: check(process.env.FEATURE_ASR !== 'false' && ((process.env.ASR_PROVIDER ?? '').trim().toLowerCase() === 'xunfei' && keys(['ASR_APP_ID', 'ASR_API_KEY']) || (process.env.ASR_PROVIDER ?? '').trim().toLowerCase() === 'funasr-local' && keys(['ASR_LOCAL_PYTHON', 'ASR_LOCAL_MODEL_DIR'])) ? 'configured' : 'blocked', '检查讯飞或本地ASR配置；未运行转写，配置不代表服务/模型可用，mock不算就绪。'),
    face, ascend,
    ascendAuth: check(keys(['ASCEND_INFER_TOKEN']) && process.env.FEATURE_MINDSPORE_INFER !== 'false' ? 'configured' : 'blocked', '检查推理功能开关与Token配置；health不证明鉴权有效。'),
    mediaTools: tools,
  } };
  report.ready = readyFor(report); return report;
}

async function main(): Promise<void> {
  const [action, flag, ...extra] = process.argv.slice(2);
  if (!['check', 'start'].includes(action) || (flag !== undefined && flag !== '--import') || extra.length || (action === 'start' && flag)) throw new Error('usage');
  loadEnvConfig(process.cwd(), true);
  const report = await inspectDemo(flag ? 'import' : 'display');
  const directory = path.resolve('.taskbook-working/local-demo', `${Date.now()}-${randomUUID()}`);
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, 'report.json'), JSON.stringify(report, null, 2), { flag: 'wx' });
  const required = [...REQUIRED, ...(report.mode === 'import' ? IMPORT_REQUIRED : []) , 'web'];
  for (const [name, value] of Object.entries(report.checks)) console.log(`[${required.includes(name) ? '必须' : '单独功能'}] ${name}: ${value.status} · ${value.message}`);
  const startupReady = action === 'start' && readyFor(report, true);
  console.log(`${action === 'start' ? '网页启动前提' : report.mode === 'display' ? '已有资料展示' : '现场新导入前提'}预检：${report.ready || startupReady ? '通过' : '未通过'}${startupReady && !report.ready ? '（网页将在本次启动）' : ''}；配置检查不代表外部API实际可用。`);
  console.log(`脱敏预检报告：${path.relative(process.cwd(), directory)}/report.json`);
  if (action === 'check') { process.exitCode = report.ready ? 0 : 1; return; }
  if (!readyFor(report, true)) { console.error('启动前提未通过；不会改配置、安装服务或停止其它进程。'); process.exitCode = 1; return; }
  if (report.checks.web.status === 'ready') { console.log('已复用现有网页：http://localhost:3000/login'); return; }
  console.log('启动本地网页：http://localhost:3000/login；保留此终端，Ctrl+C停止本次启动的网页。');
  const child = spawn(process.execPath, [path.resolve('node_modules/next/dist/bin/next'), 'dev', '--webpack', '-H', '127.0.0.1', '-p', '3000'], { cwd: process.cwd(), stdio: 'inherit', windowsHide: true });
  const stop = (): void => { child.kill('SIGTERM'); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  child.once('error', (): void => { console.error('网页进程启动失败，请核对本机依赖。'); process.exitCode = 1; });
  child.once('exit', (code): void => { process.off('SIGINT', stop); process.off('SIGTERM', stop); process.exitCode = code ?? 1; });
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  void main().catch((): void => { console.error('预检未完成；请核对启动参数、运行目录及本机服务，未修改配置或学习数据。'); process.exitCode = 1; });
}
