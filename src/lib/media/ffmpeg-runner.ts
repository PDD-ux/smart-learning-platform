import { execFile } from 'node:child_process';

export function runText(bin: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      bin,
      args,
      { timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024, windowsHide: true },
      (err, stdout) => {
        if (err) reject(err);
        else resolve(stdout);
      },
    );
  });
}

export function runBuffer(bin: string, args: string[], timeoutMs: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    execFile(
      bin,
      args,
      { timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024, encoding: 'buffer', windowsHide: true },
      (err, stdout) => {
        if (err) reject(err);
        else resolve(stdout as unknown as Buffer);
      },
    );
  });
}
