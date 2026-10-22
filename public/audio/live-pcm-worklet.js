/* global AudioWorkletProcessor, sampleRate, registerProcessor */
class LivePcmProcessor extends AudioWorkletProcessor {
  constructor() {
    super(); this.active = false; this.buffer = new Int16Array(80000); this.length = 0;
    this.phase = 0; this.sum = 0; this.count = 0;
    this.port.onmessage = (event) => {
      if (event.data === 'pause' || event.data === 'stop') {
        this.active = false; this.flush(); this.port.postMessage({ type: 'flushed' });
      } else if (event.data === 'resume') this.active = true;
    };
  }
  flush() {
    if (!this.length) return;
    // Preserve the final speech fragment; pad with less than 100ms silence when needed.
    const samples = this.buffer.slice(0, Math.max(1600, this.length));
    this.port.postMessage({ type: 'chunk', samples }, [samples.buffer]);
    this.buffer = new Int16Array(80000); this.length = 0;
  }
  process(inputs) {
    const input = inputs[0]?.[0];
    if (!this.active || !input) return true;
    for (const sample of input) {
      this.sum += sample; this.count++; this.phase += 16000;
      if (this.phase >= sampleRate) {
        this.phase -= sampleRate;
        const value = Math.max(-1, Math.min(1, this.sum / this.count));
        this.sum = 0; this.count = 0;
        this.buffer[this.length++] = Math.round(value * (value < 0 ? 32768 : 32767));
        if (this.length === this.buffer.length) this.flush();
      }
    }
    return true;
  }
}
registerProcessor('live-pcm', LivePcmProcessor);
