export function encodePcm(samples: Int16Array): string {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  samples.forEach((value, index): void => { view.setInt16(index * 2, value, true); });
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 16384) binary += String.fromCharCode(...bytes.subarray(offset, offset + 16384));
  return btoa(binary);
}
export class LiveRecorder {
  private constructor(private stream: MediaStream, private context: AudioContext, private node: AudioWorkletNode) {}
  static async start(onChunk: (samples: Int16Array) => void): Promise<LiveRecorder> {
    if (!navigator.mediaDevices?.getUserMedia || !window.AudioContext) throw new Error('此浏览器无法录音，请使用本机Edge/Chrome或HTTPS网站');
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    let context: AudioContext | null = null;
    try {
      context = new AudioContext();
      if (context.sampleRate < 16000) throw new Error('Unsupported capture sample rate');
      await context.audioWorklet.addModule('/audio/live-pcm-worklet.js');
      const node = new AudioWorkletNode(context, 'live-pcm');
      node.port.onmessage = (event: MessageEvent<{ type: string; samples?: Int16Array }>): void => { if (event.data.type === 'chunk' && event.data.samples) onChunk(event.data.samples); };
      const gain = context.createGain(); gain.gain.value = 0;
      context.createMediaStreamSource(stream).connect(node); node.connect(gain); gain.connect(context.destination);
      await context.resume(); return new LiveRecorder(stream, context, node);
    } catch {
      stream.getTracks().forEach((track): void => { track.stop(); }); await context?.close();
      throw new Error('录音初始化失败，麦克风已释放，请重试');
    }
  }
  pause(): void { this.node.port.postMessage('pause'); this.stream.getTracks().forEach((track): void => { track.enabled = false; }); }
  resume(): void { this.stream.getTracks().forEach((track): void => { track.enabled = true; }); this.node.port.postMessage('resume'); }
  async stop(): Promise<void> {
    if (this.context.state === 'closed') return;
    try { await new Promise<void>((resolve, reject): void => {
      const done = (event: MessageEvent<{ type: string }>): void => {
        if (event.data.type !== 'flushed') return;
        clearTimeout(timer); this.node.port.removeEventListener('message', done); resolve();
      };
      const timer = setTimeout((): void => { this.node.port.removeEventListener('message', done); reject(new Error('录音末段未确认，麦克风已停止；请仅保存成功转写')); }, 3000);
      this.node.port.addEventListener('message', done); this.node.port.postMessage('stop');
    }); } finally {
      this.stream.getTracks().forEach((track): void => { track.stop(); }); this.node.disconnect(); await this.context.close();
    }
  }
}
