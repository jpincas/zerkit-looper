// AudioWorklet: hands the main thread an audio input in chunks, stamped with the context frame
// they started at, plus the chunk's peak level (for "the take starts on the first sound").
const CHUNK = 1024;   // frames per message (~21 ms at 48 kHz)

class Capture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.l = new Float32Array(CHUNK);
    this.r = new Float32Array(CHUNK);
    this.n = 0;
    this.start = 0;
  }

  process(inputs) {
    const ch = inputs[0];
    const frames = ch.length ? ch[0].length : 128;
    if (this.n === 0) this.start = currentFrame;
    const L = ch[0], R = ch[1] || ch[0];
    for (let i = 0; i < frames; i++) {
      this.l[this.n + i] = L ? L[i] : 0;
      this.r[this.n + i] = R ? R[i] : 0;
    }
    this.n += frames;
    if (this.n >= CHUNK) {
      let peak = 0;
      for (let i = 0; i < this.n; i++) peak = Math.max(peak, Math.abs(this.l[i]), Math.abs(this.r[i]));
      this.port.postMessage({ frame: this.start, l: this.l, r: this.r, peak }, [this.l.buffer, this.r.buffer]);
      this.l = new Float32Array(CHUNK);
      this.r = new Float32Array(CHUNK);
      this.n = 0;
    }
    return true;
  }
}

registerProcessor('capture', Capture);
