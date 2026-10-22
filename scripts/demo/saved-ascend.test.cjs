const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { validateConnection, buildArgs } = require('./saved-ascend.cjs');
const config = { host: 'ma-user@server.example', hostname: 'server.example', port: 31637, keyPath: path.resolve('fixture-key.pem'), localPython: process.execPath, remotePython: '/home/ma-user/venv/bin/python', modelDir: '/home/ma-user/work', knownHostsPath: '.taskbook-working/test/known_hosts', durationSeconds: 3600 };
test('builds an argument array using saved port and always supplies isolated host-key protection', () => {
  const args = buildArgs(validateConnection(config));
  assert.equal(args[args.indexOf('--ssh-port') + 1], '31637');
  assert.equal(args[args.indexOf('--duration-seconds') + 1], '3600');
  assert.equal(args[args.indexOf('--known-hosts') + 1], path.resolve(config.knownHostsPath));
});
for (const [label, patch] of Object.entries({ secret: { token: 'do-not-save' }, port: { port: 0 }, stringPort: { port: '22' }, host: { hostname: '-oProxyCommand=x' }, newline: { remotePython: '/x\ncommand' }, escape: { knownHostsPath: '../known_hosts' }, remoteTraversal: { modelDir: '/home/../etc' }, duration: { durationSeconds: 99999 } })) {
  test('rejects ' + label, () => assert.throws(() => validateConnection({ ...config, ...patch })));
}
