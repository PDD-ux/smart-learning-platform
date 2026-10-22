/* Saved local connection only; the existing controller owns remote lifecycle and tokens. */
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const configPath = path.join(root, '.taskbook-working/ascend-demo/connection.local.json');
const fields = ['host', 'hostname', 'port', 'keyPath', 'localPython', 'remotePython', 'modelDir', 'knownHostsPath', 'durationSeconds'];

function validateConnection(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !fields.includes(key))) throw new Error('Unsupported configuration fields; do not store passwords, tokens or private key contents.');
  for (const key of fields.filter(key => !['port', 'durationSeconds'].includes(key))) if (typeof value[key] !== 'string' || !value[key] || /[\r\n\0]/.test(value[key])) throw new Error('Missing or invalid field: ' + key);
  if (!/^[a-zA-Z_][\w.-]*@[a-zA-Z0-9][\w.-]*$/.test(value.host) || !/^[a-zA-Z0-9][\w.-]*$/.test(value.hostname)) throw new Error('Invalid SSH host.');
  if (!Number.isInteger(value.port) || value.port < 1 || value.port > 65535) throw new Error('Invalid SSH port.');
  if (!Number.isInteger(value.durationSeconds) || value.durationSeconds < 60 || value.durationSeconds > 7200) throw new Error('Duration must be 60 to 7200 seconds.');
  for (const key of ['remotePython', 'modelDir']) if (!value[key].startsWith('/') || value[key].split('/').includes('..') || /\s/.test(value[key])) throw new Error('Invalid remote path: ' + key);
  if (!path.isAbsolute(value.keyPath) || !path.isAbsolute(value.localPython)) throw new Error('Local key and Python paths must be absolute.');
  const known = path.resolve(root, value.knownHostsPath);
  if (!known.startsWith(path.join(root, '.taskbook-working') + path.sep)) throw new Error('Host-key record must stay in the ignored directory.');
  return value;
}

function buildArgs(config) {
  return [path.join(root, 'scripts/demo/run-ascend-demo.py'), '--host', config.host, '--ip', config.hostname, '--ssh-port', String(config.port), '--key', config.keyPath, '--remote-python', config.remotePython, '--model-dir', config.modelDir, '--known-hosts', path.resolve(root, config.knownHostsPath), '--duration-seconds', String(config.durationSeconds)];
}

async function checkPort(port) {
  await new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', () => reject(new Error('Port ' + port + ' is occupied. Stop the existing demo in its terminal first; no process was stopped.')));
    probe.listen(port, '127.0.0.1', () => probe.close(resolve));
  });
}

async function main() {
  const mode = process.argv[2];
  if (!['check', 'start'].includes(mode)) throw new Error('Use check or start.');
  if (!fs.existsSync(configPath)) throw new Error('Create .taskbook-working/ascend-demo/connection.local.json using scripts/demo/ascend-connection.example.json.');
  const config = validateConnection(JSON.parse(fs.readFileSync(configPath, 'utf8').replace(/^\uFEFF/, '')));
  for (const key of ['keyPath', 'localPython']) if (!fs.statSync(config[key], { throwIfNoEntry: false })?.isFile()) throw new Error('Configured local file is missing: ' + key);
  if (mode === 'check') {
    console.log(JSON.stringify({ localConfigurationValid: true, host: config.host, port: config.port, keyFilePresent: true, localPythonPresent: true, cloudConnectionTested: false, remoteEnvironmentTested: false, notebookStarted: false }));
    return;
  }
  await checkPort(3000);
  await checkPort(8001);
  console.log('Connecting using saved settings. Notebook must already be running. Keep this terminal open; wait for status=ready before uploading.');
  await new Promise((resolve, reject) => {
    const child = spawn(config.localPython, buildArgs(config), { cwd: root, shell: false, windowsHide: true, stdio: 'inherit' });
    child.once('error', () => reject(new Error('Could not start the existing Ascend controller.')));
    child.once('exit', code => code === 0 ? resolve() : reject(new Error('Ascend controller stopped without success. Check its private state/logs; saved SSH settings may need updating.')));
  });
}
if (require.main === module) main().catch(error => { console.error(error instanceof SyntaxError ? 'Invalid local connection JSON.' : error.message); process.exitCode = 1; });
module.exports = { validateConnection, buildArgs };
