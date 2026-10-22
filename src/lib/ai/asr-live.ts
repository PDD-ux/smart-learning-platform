import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { parseLocalTranscript, localAsrConfigured } from './asr-local';
import type { TranscriptSegmentInput } from './asr';

type Pending = { id: string; resolve: (value: string) => void; reject: (error: Error) => void };
class LiveAsrRuntime {
  private child: ChildProcessWithoutNullStreams | null = null;
  private pending: Pending | null = null;
  private tail: Promise<void> = Promise.resolve();
  private waiting = 0;
  async run(audioPath: string, durationSec: number): Promise<TranscriptSegmentInput[]> {
    if (!localAsrConfigured()) throw new Error('本地实时ASR尚未配置');
    if (this.waiting >= 8) throw new Error('实时转写队列已满，请暂停后重试');
    this.waiting++;
    const previous = this.tail;
    let release = (): void => undefined;
    this.tail = new Promise<void>((resolve): void => { release = resolve; });
    await previous;
    try {
      if (!this.child) this.start();
      const id = randomUUID();
      const data = await new Promise<string>((resolve, reject): void => {
        const timer = setTimeout((): void => { this.child?.kill(); this.child = null; this.pending = null; reject(new Error('实时转写超时，请手动重试')); }, 60_000);
        this.pending = { id, resolve: (value): void => { clearTimeout(timer); resolve(value); }, reject: (error): void => { clearTimeout(timer); reject(error); } };
        this.child!.stdin.write(JSON.stringify({ id, audioPath }) + '\n');
      });
      return parseLocalTranscript(data, durationSec);
    } finally { this.waiting--; release(); }
  }
  private start(): void {
    const env: NodeJS.ProcessEnv = { NODE_ENV: process.env.NODE_ENV ?? 'development', PYTHONIOENCODING: 'utf-8' };
    for (const name of ['SystemRoot', 'WINDIR', 'PATH', 'TEMP', 'TMP', 'HOME', 'USERPROFILE']) if (process.env[name]) env[name] = process.env[name];
    const child = spawn(process.env.ASR_LOCAL_PYTHON!.trim(), [path.resolve('services/local-asr/live_worker.py'), '--model-root', path.resolve(process.env.ASR_LOCAL_MODEL_DIR!.trim())], { env, windowsHide: true, stdio: 'pipe' });
    this.child = child;
    child.stdout.setEncoding('utf8');
    let buffer = '';
    child.stdout.on('data', (bytes: string): void => {
      buffer += bytes;
      if (buffer.length > 200_000) { child.kill(); return; }
      let newline: number;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
        try {
          const data = JSON.parse(line) as { id?: unknown; error?: unknown; result?: unknown };
          if (data.id !== this.pending?.id || !this.pending) continue;
          const pending = this.pending; this.pending = null;
          if (data.error) pending.reject(new Error('本地实时转写失败，请手动重试'));
          else pending.resolve(JSON.stringify(data.result));
        } catch { this.pending?.reject(new Error('本地转写响应无效')); this.pending = null; }
      }
    });
    // Model stderr can contain audio text or filesystem details; never relay it to product logs.
    child.stderr.resume();
    const fail = (): void => {
      if (this.child === child) { this.child = null; this.pending?.reject(new Error('本地实时ASR服务已停止')); this.pending = null; }
    };
    child.on('error', fail); child.on('exit', fail);
    child.stdin.on('error', fail);
    process.once('exit', (): void => { child.kill(); });
  }
  stop(): void { this.child?.kill(); this.child = null; this.pending?.reject(new Error('转写服务已停止')); this.pending = null; }
}
const runtimeGlobal = globalThis as unknown as { liveAsrRuntime?: LiveAsrRuntime };
export function liveAsrRuntime(): LiveAsrRuntime { return runtimeGlobal.liveAsrRuntime ??= new LiveAsrRuntime(); }
