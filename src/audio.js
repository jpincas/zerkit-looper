// Web Audio output: routes each track to its instrument (synth or drum rack)
// and plays the metronome. Implements the `out` interface the Engine expects.
import { INSTRUMENTS, makeNoise } from './instruments.js';
import { TrackFX } from './fx.js';

export class AudioOut {
  constructor(trackCount) {
    this.ctx = new AudioContext({ latencyHint: 'interactive' });
    // Everything leaves through `out` (the master volume). Browser sounds go through `master`
    // (their level, see setSynthLevel) and a compressor first; audio tracks go straight to `out`.
    this.out = new GainNode(this.ctx, { gain: 1 });
    this.out.connect(this.ctx.destination);
    this.master = new GainNode(this.ctx, { gain: 0.6 });
    const comp = new DynamicsCompressorNode(this.ctx, { threshold: -14, ratio: 4 });
    this.master.connect(comp).connect(this.out);
    this.noise = makeNoise(this.ctx);
    this.instruments = Array(trackCount).fill('synth'); // keys of INSTRUMENTS
    // Mixer: each track plays into its own gain, set from volume, mute and solo.
    this.vol = Array(trackCount).fill(0.8);   // 0-1, 0.8 = unity
    this.mute = Array(trackCount).fill(false);
    this.solo = Array(trackCount).fill(false);
    this.bus = this.vol.map(() => new GainNode(this.ctx, { gain: 1 }));
    // Then a stereo position per track (-1 left .. 1 right; a balance control for stereo audio).
    this.pan = Array(trackCount).fill(0);
    this.panner = this.vol.map(() => new StereoPannerNode(this.ctx, { pan: 0 }));
    // Between them, each track's FX (delay and reverb, see fx.js).
    this.fx = this.vol.map(() => new TrackFX(this.ctx));
    this.bus.forEach((g, t) => {
      g.connect(this.fx[t].input);
      this.fx[t].output.connect(this.panner[t]).connect(this.master);
    });
    this.live = new Map();      // "track:note" -> voice (keys held right now)
    this.scheduled = new Set(); // voices/clicks scheduled by the engine
  }

  now() { return this.ctx.currentTime; }

  // Browsers only start audio after a user gesture.
  resume() { if (this.ctx.state !== 'running') this.ctx.resume(); }

  // A track is heard unless it's muted, or another track is soloed and it isn't.
  audible(t) { return !this.mute[t] && (this.solo[t] || !this.solo.some(Boolean)); }

  mix() {
    const now = this.now();
    this.bus.forEach((g, t) => {
      const v = this.vol[t];
      g.gain.setTargetAtTime(this.audible(t) ? (v * v) / 0.64 : 0, now, 0.015);
    });
  }

  setPan(t, v) {
    this.pan[t] = Math.max(-1, Math.min(1, v));
    this.panner[t].pan.setTargetAtTime(this.pan[t], this.now(), 0.015);
  }

  // Level of the browser sounds (synths, drums, click), 0-1. Audio tracks don't pass through it.
  setSynthLevel(level) { this.master.gain.setTargetAtTime(1.2 * level * level, this.now(), 0.02); }

  // Overall output level, 0-1, same curve as the track volumes (0.8 = unity).
  setMasterVolume(v) { this.out.gain.setTargetAtTime((v * v) / 0.64, this.now(), 0.02); }

  // Synth tracks share the master stage (level and compressor, tuned for the browser sounds).
  // Audio tracks skip it and go straight out, so a loop plays back at the level it was recorded.
  route(track) {
    const p = this.panner[track];
    p.disconnect();
    p.connect(INSTRUMENTS[this.instruments[track]].audio ? this.out : this.master);
  }

  setInstrument(track, name) {
    this.instruments[track] = name;
    this.route(track);
    for (const [key, v] of this.live) {
      if (key.startsWith(`${track}:`)) { v.kill(this.now()); this.live.delete(key); }
    }
  }

  voice(track, note, vel, t, onEnd) {
    return INSTRUMENTS[this.instruments[track]].voice(this.ctx, this.bus[track], note, vel, t, onEnd, this.noise);
  }

  noteOn(track, note, vel) {
    this.resume();
    this.noteOff(track, note);
    if (!INSTRUMENTS[this.instruments[track]].voice) return;      // audio tracks don't play notes
    this.live.set(`${track}:${note}`, this.voice(track, note, vel, this.now(), () => {}));
  }

  noteOff(track, note) {
    const key = `${track}:${note}`;
    const v = this.live.get(key);
    if (!v) return;
    this.live.delete(key);
    v.release(this.now());
  }

  // Audio tracks: play one pass of a recorded clip into the track's mixer channel.
  playClip(track, clip, when, offset) {
    const buffer = clip.buffer();
    if (!buffer) return;
    const now = this.now();
    if (when < now) { offset += now - when; when = now; }
    if (offset >= clip.seconds) return;
    const src = new AudioBufferSourceNode(this.ctx, { buffer });
    src.connect(this.bus[track]);
    src.start(when, offset, clip.seconds - offset);
    const v = { kill: t => { try { src.stop(t); } catch {} } };
    src.onended = () => { src.disconnect(); this.scheduled.delete(v); };
    this.scheduled.add(v);
  }

  playNote(track, note, vel, on, off) {
    if (!INSTRUMENTS[this.instruments[track]].voice) return;
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
