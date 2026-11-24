// Web Audio output: routes each track to its instrument (synth or drum rack)
// and plays the metronome. Implements the `out` interface the Engine expects.
import { INSTRUMENTS, makeNoise } from './instruments.js';

export class AudioOut {
  constructor(trackCount) {
    this.ctx = new AudioContext({ latencyHint: 'interactive' });
    this.master = new GainNode(this.ctx, { gain: 0.6 });
    const comp = new DynamicsCompressorNode(this.ctx, { threshold: -14, ratio: 4 });
    this.master.connect(comp).connect(this.ctx.destination);
    this.noise = makeNoise(this.ctx);
    this.instruments = Array(trackCount).fill('synth'); // keys of INSTRUMENTS
    this.live = new Map();      // "track:note" -> voice (keys held right now)
    this.scheduled = new Set(); // voices/clicks scheduled by the engine
  }

  now() { return this.ctx.currentTime; }

  // Browsers only start audio after a user gesture.
  resume() { if (this.ctx.state !== 'running') this.ctx.resume(); }

  setInstrument(track, name) {
    this.instruments[track] = name;
    for (const [key, v] of this.live) {
      if (key.startsWith(`${track}:`)) { v.kill(this.now()); this.live.delete(key); }
    }
  }

  voice(track, note, vel, t, onEnd) {
    return INSTRUMENTS[this.instruments[track]].voice(this.ctx, this.master, note, vel, t, onEnd, this.noise);
  }

  noteOn(track, note, vel) {
    this.resume();
    this.noteOff(track, note);
    this.live.set(`${track}:${note}`, this.voice(track, note, vel, this.now(), () => {}));
  }

  noteOff(track, note) {
    const key = `${track}:${note}`;
    const v = this.live.get(key);
    if (!v) return;
    this.live.delete(key);
    v.release(this.now());
  }

  playNote(track, note, vel, on, off) {
    const v = this.voice(track, note, vel, Math.max(on, this.now()), () => this.scheduled.delete(v));
    v.release(off);
    this.scheduled.add(v);
  }

  click(t, accent) {
    const ctx = this.ctx;
    const o = new OscillatorNode(ctx, { type: 'sine', frequency: accent ? 1760 : 1175 });
    const g = new GainNode(ctx, { gain: 0 });
    o.connect(g).connect(this.master);
    g.gain.setValueAtTime(accent ? 0.5 : 0.28, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    o.start(t);
    o.stop(t + 0.06);
    const v = { kill: now => o.stop(now) };
    o.onended = () => { g.disconnect(); this.scheduled.delete(v); };
    this.scheduled.add(v);
  }

  cancelScheduled() {
    const now = this.now();
    for (const v of this.scheduled) v.kill(now);
    this.scheduled.clear();
  }
}
