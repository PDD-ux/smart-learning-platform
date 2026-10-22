/**
 * 更新云端推理（Ascend / ModelArts）连接端口。
 *
 * ModelArts 笔记本每次停止再启动，远程 SSH 端口可能变化。端口变了以后，
 * 「启动云端推理演示.cmd」会一直连不上，这里提供一条命令改好：
 *
 *   npm run demo:ascend-port -- 32000
 *
 * 只改 connection.local.json 里的 port，不动其它字段、不做任何网络连接。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const CONFIG = resolve(process.cwd(), '.taskbook-working/ascend-demo/connection.local.json');

function main(): void {
  const raw = process.argv[2];
  const port = Number(raw);
  if (!raw || !Number.isInteger(port) || port < 1 || port > 65535) {
    console.log('用法：npm run demo:ascend-port -- <新的 SSH 端口号>');
    console.log('示例：npm run demo:ascend-port -- 32000');
    process.exitCode = 1;
    return;
  }

  let config: Record<string, unknown>;
  try {
    config = JSON.parse(readFileSync(CONFIG, 'utf8').replace(/^\uFEFF/, '')) as Record<string, unknown>;
  } catch {
    console.log('读不到连接配置：' + CONFIG);
    console.log('请先按 scripts/demo/ascend-connection.example.json 创建它。');
    process.exitCode = 1;
    return;
  }

  const before = config['port'];
  config['port'] = port;
  writeFileSync(CONFIG, JSON.stringify(config, null, 2) + '\n', 'utf8');
  console.log(`SSH 端口已更新：${String(before)} -> ${port}`);
  console.log('现在可以重新运行「启动云端推理演示.cmd」。');
}

main();
