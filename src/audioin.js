// Audio inputs for audio tracks: any input the computer has (an instrument's USB audio, an
// interface, the built-in mic). Each open input is captured continuously into a rolling
// history on the AudioContext's clock, so a take can be cut out of it afterwards, from the
// bar line before the first sound to the bar line where it closed.

const KEEP = 120;              // seconds of history kept per input
const THRESHOLD = 0.02;        // peak level (about -34 dBFS) that counts as "the first sound"

export class AudioInputs {
  constructor(ctx) {
    this.ctx = ctx;
    this.inputs = new Map();   // deviceId -> Input
    this.devices = [];         // [{ deviceId, label }]
    this.ready = ctx.audioWorklet.addModule(new URL('./capture-worklet.js', import.meta.url));
    this.onDevices = null;
    navigator.mediaDevices?.addEventListener?.('devicechange', () => this.list());
  }

  // Device names only appear once the browser has been allowed to use audio input.
  async list() {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    const all = await navigator.mediaDevices.enumerateDevices();
    this.devices = all.filter(d => d.kind === 'audioinput' && d.deviceId !== 'communications')
      .map(d => ({ deviceId: d.deviceId, label: d.label || 'Audio input' }));
    this.onDevices?.(this.devices);
    return this.devices;
  }

  // Ask once for permission (opens the default input briefly), then list the devices by name.
  async permit() {
    const s = await navigator.mediaDevices.getUserMedia({ audio: true });
    s.getTracks().forEach(t => t.stop());
    return this.list();
  }

  async open(deviceId) {
    if (this.inputs.has(deviceId)) return this.inputs.get(deviceId);
    const input = new Input(this.ctx, deviceId);
    this.inputs.set(deviceId, input);
    try {
      await this.ready;
      await input.start();
    } catch (err) {
      this.inputs.delete(deviceId);
      throw err;
    }
    this.list();
    return input;
  }
}

class Input {
  constructor(ctx, deviceId) {
    this.ctx = ctx;
    this.deviceId = deviceId;
    this.chunks = [];          // { t (context seconds), l, r }
    this.peak = 0;             // latest chunk's peak
    this.onLevel = null;       // (peak, time) for every chunk
  }

  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: { exact: this.deviceId },
        echoCancellation: false, noiseSuppression: false, autoGainControl: false,
        channelCount: { ideal: 2 },
      },
    });
    const ctx = this.ctx;
    this.source = new MediaStreamAudioSourceNode(ctx, { mediaStream: this.stream });
    this.node = new AudioWorkletNode(ctx, 'capture', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 2, channelCountMode: 'explicit' });
    this.sink = new GainNode(ctx, { gain: 0 });                     // keeps the worklet running, silently
    this.source.connect(this.node).connect(this.sink).connect(ctx.destination);
    this.node.port.onmessage = ({ data }) => {
      const t = data.frame / ctx.sampleRate;
      this.chunks.push({ t, l: data.l, r: data.r });
      while (this.chunks.length && this.chunks[0].t < t - KEEP) this.chunks.shift();
      this.peak = data.peak;
      this.onLevel?.(data.peak, t);
    };
    const settings = this.stream.getAudioTracks()[0]?.getSettings?.() ?? {};
    this.inLatency = typeof settings.latency === 'number' ? settings.latency : 0.01;
    this.label = this.stream.getAudioTracks()[0]?.label ?? '';
  }

  // How late the sound of something played in time with what you hear lands in our history:
  // the output delay (you hear the beat late) plus the input delay.
  get latency() {
    return (this.ctx.outputLatency || 0) + (this.ctx.baseLatency || 0) + this.inLatency;
  }

  loud(peak) { return peak >= THRESHOLD; }

  // Copy [t0, t0 + dur) context-seconds into a new stereo AudioBuffer. Anything not captured
  // yet is left silent; `complete` says whether the whole range was there.
  extract(t0, dur) {
    const sr = this.ctx.sampleRate;
    const len = Math.max(1, Math.round(dur * sr));
    const buf = new AudioBuffer({ numberOfChannels: 2, length: len, sampleRate: sr });
    const L = buf.getChannelData(0), R = buf.getChannelData(1);
    const first = Math.round(t0 * sr);
    let last = -Infinity;
    for (const c of this.chunks) {
      const cf = Math.round(c.t * sr);
      const from = Math.max(0, first - cf), to = Math.min(c.l.length, first + len - cf);
      if (to <= from) continue;
      L.set(c.l.subarray(from, to), cf + from - first);
      R.set(c.r.subarray(from, to), cf + from - first);
      last = Math.max(last, cf + to - first);
    }
    return { buffer: buf, complete: last >= len };
  }
}
