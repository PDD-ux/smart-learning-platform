// Local-only setup/start/stop. Secrets stay in .env.local and child environment.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const { loadEnvConfig } = require('@next/env');
const root = path.resolve(__dirname, '../..');
const runtime = path.join(root, '.taskbook-working/face-infer');
const python = path.join(runtime, 'venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const version = 'yunet2023-sface2021-mp1-c045-action-v1';
const statePath = path.join(runtime, 'service.json');
process.chdir(root);

function run(executable, args) {
  const result = spawnSync(executable, args, { cwd: root, stdio: 'inherit', windowsHide: true });
  if (result.error || result.status !== 0) throw new Error('Face service setup command failed');
}

function configure() {
  const file = path.join(root, '.env.local');
  let text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const values = {
    FACE_VERIFICATION_PROVIDER: 'licensed-http', FACE_INFER_URL: 'http://127.0.0.1:8002',
    FACE_INFER_MODEL_VERSION: version, FACE_INFER_TOKEN: crypto.randomBytes(32).toString('hex'),
    FACE_CHALLENGE_SECRET: crypto.randomBytes(32).toString('hex'),
    FACE_TEMPLATE_ENCRYPTION_KEY: crypto.randomBytes(32).toString('base64'),
    FACE_TEMPLATE_ENCRYPTION_KEY_ID: 'local-face-template-20261009',
    FACE_ENROLLMENT_PHOTO_ENCRYPTION_KEY: crypto.randomBytes(32).toString('base64'),
    FACE_ENROLLMENT_PHOTO_ENCRYPTION_KEY_ID: 'local-face-photo-20261009',
  };
  for (const [key, value] of Object.entries(values)) {
    const expression = new RegExp(`^${key}=([^\\r\\n]*)`, 'm');
    const old = text.match(expression);
    if (old && !/^\s*(?:""|'')?\s*(?:#.*)?$/.test(old[1])) continue;
    const line = `${key}="${value}"`;
    text = old ? text.replace(expression, line) : `${text.trimEnd()}\n${line}\n`;
  }
  fs.writeFileSync(file, text, { mode: 0o600 });
  console.log('Local face configuration ready; existing nonempty values preserved. Restart Next.js to load it.');
}

async function health() {
  const response = await fetch(`${process.env.FACE_INFER_URL}/health`, {
    headers: { authorization: `Bearer ${process.env.FACE_INFER_TOKEN}` }, signal: AbortSignal.timeout(2000),
  });
  if (!response.ok) throw new Error('Face service unavailable');
  const result = await response.json();
  if (!result.modelsLoaded || result.modelVersion !== version) throw new Error('Face model not ready or incompatible');
  return result;
}

async function main() {
  fs.mkdirSync(runtime, { recursive: true });
  const action = process.argv[2] || 'status';
  if (action === 'setup') {
    if (!fs.existsSync(python)) run(process.env.FACE_SETUP_PYTHON || 'python', ['-m', 'venv', path.join(runtime, 'venv')]);
    const requirements = process.platform === 'win32' ? 'requirements-windows.lock.txt' : 'requirements.txt';
    run(python, ['-m', 'pip', 'install', '--disable-pip-version-check', '-r', `services/face-infer/${requirements}`]);
    run(python, ['services/face-infer/download_models.py', path.join(runtime, 'models')]);
    configure();
    return;
  }
  loadEnvConfig(root, true);
  if (process.env.FACE_INFER_URL !== 'http://127.0.0.1:8002' || process.env.FACE_INFER_MODEL_VERSION !== version || !process.env.FACE_INFER_TOKEN) {
    throw new Error('Run face:setup first; this launcher only manages the local loopback service');
  }
  if (action === 'status') {
    const result = await health();
    console.log(JSON.stringify(result));
    return;
  }
  if (action === 'stop') {
    if (!fs.existsSync(statePath)) throw new Error('No managed face service');
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    const result = await health();
    if (state.instanceId !== result.instanceId) throw new Error('Refusing to stop a different process');
    // Windows venv python.exe can spawn the interpreter; authenticated instance owns its reported PID.
    process.kill(result.pid);
    fs.unlinkSync(statePath);
    console.log('Local face service stopped');
    return;
  }
  if (action !== 'start') throw new Error('Use setup/start/status/stop');
  try { await health(); console.log('Local face service already ready'); return; } catch { /* spawn and check */ }
  const out = fs.openSync(path.join(runtime, 'service.out.log'), 'a');
  const err = fs.openSync(path.join(runtime, 'service.err.log'), 'a');
  const instanceId = crypto.randomUUID();
  // Pass only this service's secrets; do not inherit database/AI/JWT credentials.
  const env = { PATH: process.env.PATH, SYSTEMROOT: process.env.SYSTEMROOT, TEMP: process.env.TEMP,
    FACE_INFER_TOKEN: process.env.FACE_INFER_TOKEN, FACE_MODEL_DIR: path.join(runtime, 'models'), FACE_SERVICE_INSTANCE: instanceId,
    FACE_LOGIN_MODE: process.env.FACE_LOGIN_MODE || 'action',
    PYTHONUNBUFFERED: '1', GLOG_minloglevel: '2', TF_CPP_MIN_LOG_LEVEL: '2' };
  const child = spawn(python, ['-m', 'uvicorn', 'server:app', '--app-dir', 'services/face-infer', '--host', '127.0.0.1', '--port', '8002', '--no-access-log', '--log-level', 'warning'], {
    cwd: root, env, detached: true, windowsHide: true, stdio: ['ignore', out, err],
  });
  fs.closeSync(out); fs.closeSync(err);
  await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
  child.unref();
  fs.writeFileSync(statePath, JSON.stringify({ pid: child.pid, instanceId }) + '\n');
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    try {
      const result = await health();
      if (result.instanceId !== instanceId) throw new Error('Port belongs to another service');
      fs.writeFileSync(statePath, JSON.stringify({ pid: result.pid, launcherPid: child.pid, instanceId }) + '\n');
      console.log('Real face models ready on loopback port 8002 (CPU)');
      return;
    } catch { /* wait for initialization */ }
  }
  // Stop only the child created by this invocation on unsuccessful startup.
  try { process.kill(child.pid); } catch { /* already exited */ }
  throw new Error('Face startup failed; inspect .taskbook-working/face-infer/service.err.log');
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
