// Web Audio output: routes each track to its instrument (sampled, kit, audio or MIDI)
// and plays the metronome. Implements the `out` interface the Engine expects.
import { INSTRUMENTS } from './instruments.js';
import { TrackFX } from './fx.js';
import { TrackSynth } from './synth.js';

export class AudioOut {
  constructor(trackCount) {
    this.ctx = new AudioContext({ latencyHint: 'interactive' });
    // Everything leaves through `out` (the master volume). The browser's own sounds (instruments,
    // kits) go through `master`, a fixed level that sits them against audio tracks, and a
    // compressor first; audio tracks skip that. Both then pass the master filter (low-pass one
    // way, high-pass the other); the click has its own level and isn't filtered.
    this.out = new GainNode(this.ctx, { gain: 1 });
    this.out.connect(this.ctx.destination);
    this.lowpass = new BiquadFilterNode(this.ctx, { type: 'lowpass', frequency: 20000, Q: 1 });
    this.highpass = new BiquadFilterNode(this.ctx, { type: 'highpass', frequency: 10, Q: 1 });
    this.music = new GainNode(this.ctx, { gain: 1 });
    this.music.connect(this.lowpass).connect(this.highpass).connect(this.out);
    this.master = new GainNode(this.ctx, { gain: 0.2 });
    this.clickBus = new GainNode(this.ctx, { gain: 0.1 });
    this.clickBus.connect(this.out);
    const comp = new DynamicsCompressorNode(this.ctx, { threshold: -14, ratio: 4 });
    this.master.connect(comp).connect(this.music);
    this.instruments = Array(trackCount).fill(null);   // keys of INSTRUMENTS (set by main.js)
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
    // Each track's synth (used while the track plays the Synth instrument).
    this.synth = this.bus.map(b => new TrackSynth(this.ctx, b));
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

  // The metronome click's level, 0-1, on a squared curve.
  setClickLevel(level) { this.clickBus.gain.setTargetAtTime(0.18 * level * level, this.now(), 0.02); }

  // Master filter, 0-1, like a DJ mixer's: 0.5 is open, below it a low-pass closes down to
  // 60 Hz, above it a high-pass opens up to 8 kHz (exponential, so it sweeps evenly by ear).
  setFilter(v) {
    const t = this.now(), d = v - 0.5;
    const lp = d < 0 ? 60 * (20000 / 60) ** (1 + d * 2) : 20000;
    const hp = d > 0 ? 10 * (8000 / 10) ** (d * 2) : 10;
    this.lowpass.frequency.setTargetAtTime(lp, t, 0.02);
    this.highpass.frequency.setTargetAtTime(hp, t, 0.02);
  }

  // Overall output level, 0-1, same curve as the track volumes (0.8 = unity).
  setMasterVolume(v) { this.out.gain.setTargetAtTime((v * v) / 0.64, this.now(), 0.02); }

  // Synth tracks share the master stage (level and compressor, tuned for the browser sounds).
  // Audio tracks skip it (only the master filter), so a loop plays back at the level it was recorded.
  route(track) {
    const p = this.panner[track];
    p.disconnect();
    p.connect(INSTRUMENTS[this.instruments[track]].audio ? this.music : this.master);
  }

  setInstrument(track, name) {
    this.instruments[track] = name;
    this.route(track);
    for (const [key, v] of this.live) {
      if (key.startsWith(`${track}:`)) { v.kill(this.now()); this.live.delete(key); }
    }
  }

  voice(track, note, vel, t, onEnd) {
    return INSTRUMENTS[this.instruments[track]].voice(this.ctx, this.bus[track], note, vel, t, onEnd);
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

  // A soft tick: a lowish sine with a 3 ms rise (no snap at its start), the bar's first beat higher.
  click(t, accent) {
    const ctx = this.ctx;
    const o = new OscillatorNode(ctx, { type: 'sine', frequency: accent ? 1320 : 880 });
    const g = new GainNode(ctx, { gain: 0 });
    o.connect(g).connect(this.clickBus);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(accent ? 1 : 0.6, t + 0.003);
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
