// Sound sources, all synthesised with Web Audio.
// A voice is made with (ctx, dest, note, vel, time, onEnd, noiseBuffer) and returns
// { release(at), kill(now) }; it calls onEnd() once all its nodes have finished.

const hz = note => 440 * 2 ** ((note - 69) / 12);

// Shared amp-envelope handling. Release never cuts into the attack, so short
// taps on slow-attack sounds (pads) still bloom and then fade.
function handle(t, attack, g, sources, r, onEnd) {
  sources[0].onended = () => { g.disconnect(); onEnd(); };
  return {
    release(at) {
      at = Math.max(at, t + attack + 0.005);
      g.gain.setTargetAtTime(0, at, r);
      for (const s of sources) s.stop(at + r * 8);
    },
    kill(now) {
      if (now < t) { for (const s of sources) s.stop(now); return; }
      g.gain.cancelScheduledValues(now);
      g.gain.setValueAtTime(g.gain.value, now);
      g.gain.linearRampToValueAtTime(0, now + 0.02);
      for (const s of sources) s.stop(now + 0.03);
    },
  };
}

// Oscillators -> lowpass (with its own envelope) -> amp envelope.
//   oscs:   [{ type, ratio (x pitch), detune (cents), gain }]
//   filter: cutoff goes from `from` to `to` (multiples of pitch) with time-constant `time`
//   env:    attack, decay time-constant, sustain level, release time-constant
function subtractive({ oscs, filter, env, level }) {
  return (ctx, dest, note, vel, t, onEnd) => {
    const f0 = hz(note);
    const peak = level * (vel / 127);
    const g = new GainNode(ctx, { gain: 0 });
    const flt = new BiquadFilterNode(ctx, { type: 'lowpass', Q: filter.Q });
    const sources = oscs.map(o => {
      const osc = new OscillatorNode(ctx, { type: o.type, frequency: f0 * (o.ratio ?? 1), detune: o.detune ?? 0 });
      osc.connect(new GainNode(ctx, { gain: o.gain ?? 1 })).connect(flt);
      return osc;
    });
    flt.connect(g).connect(dest);
    flt.frequency.setValueAtTime(Math.min(f0 * filter.from, 16000), t);
    flt.frequency.setTargetAtTime(Math.min(f0 * filter.to, 16000), t, filter.time);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + env.a);
    g.gain.setTargetAtTime(peak * env.s, t + env.a, env.d);
    for (const s of sources) s.start(t);
    return handle(t, env.a, g, sources, env.r, onEnd);
  };
}

// Two-operator FM: a sine modulator at `ratio` x pitch bends a sine carrier.
// The modulation index decays, so the tone starts bright and mellows.
function fm({ ratio, index, indexTime, env, level }) {
  return (ctx, dest, note, vel, t, onEnd) => {
    const f0 = hz(note);
    const peak = level * (vel / 127);
    const car = new OscillatorNode(ctx, { type: 'sine', frequency: f0 });
    const mod = new OscillatorNode(ctx, { type: 'sine', frequency: f0 * ratio });
    const depth = new GainNode(ctx, { gain: 0 });
    mod.connect(depth).connect(car.frequency);
    depth.gain.setValueAtTime(f0 * index * (0.5 + vel / 254), t);
    depth.gain.setTargetAtTime(f0 * index * 0.08, t, indexTime);
    const g = new GainNode(ctx, { gain: 0 });
    car.connect(g).connect(dest);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + env.a);
    g.gain.setTargetAtTime(peak * env.s, t + env.a, env.d);
    car.start(t);
    mod.start(t);
    return handle(t, env.a, g, [car, mod], env.r, onEnd);
  };
}

const saw = (detune = 0, ratio = 1, gain = 1) => ({ type: 'sawtooth', detune, ratio, gain });

// ---- instrument registry -------------------------------------------------------
// `octave` is where the keyboard starts when a track switches to this instrument.

export const INSTRUMENTS = {
  synth: {
    name: 'Synth', color: '#f2b33d', octave: 4,
    voice: subtractive({
      oscs: [saw(-7), saw(7)],
      filter: { Q: 2, from: 10, to: 3, time: 0.25 },
      env: { a: 0.005, d: 0.15, s: 0.55, r: 0.06 }, level: 0.2,
    }),
  },
  bass: {
    name: 'Bass', color: '#f07a5a', octave: 2,
    voice: subtractive({
      oscs: [saw(), { type: 'square', ratio: 0.5, gain: 0.6 }],
      filter: { Q: 6, from: 8, to: 1.5, time: 0.08 },
      env: { a: 0.003, d: 0.25, s: 0.6, r: 0.04 }, level: 0.3,
    }),
  },
  pluck: {
    name: 'Pluck', color: '#6fc3f2', octave: 4,
    voice: subtractive({
      oscs: [{ type: 'square' }, saw(5)],
      filter: { Q: 3, from: 14, to: 1, time: 0.07 },
      env: { a: 0.002, d: 0.2, s: 0, r: 0.1 }, level: 0.22,
    }),
  },
  pad: {
    name: 'Pad', color: '#a08cf5', octave: 4,
    voice: subtractive({
      oscs: [saw(-12), saw(12), saw(3, 0.5, 0.5)],
      filter: { Q: 1, from: 3, to: 3, time: 1 },
      env: { a: 0.35, d: 0.5, s: 0.8, r: 0.7 }, level: 0.1,
    }),
  },
  keys: {
    name: 'Keys', color: '#8fd16a', octave: 4,
    voice: fm({ ratio: 1, index: 2.5, indexTime: 0.4, env: { a: 0.002, d: 1.2, s: 0, r: 0.2 }, level: 0.3 }),
  },
  organ: {
    name: 'Organ', color: '#e58fd3', octave: 4,
    voice: subtractive({
      oscs: [0.5, 1, 2, 3, 4].map((ratio, i) => ({ type: 'sine', ratio, gain: [0.6, 1, 0.5, 0.25, 0.2][i] })),
      filter: { Q: 0.5, from: 40, to: 40, time: 1 },
      env: { a: 0.005, d: 0.1, s: 1, r: 0.03 }, level: 0.08,
    }),
  },
  bell: {
    name: 'Bell', color: '#e8c3a0', octave: 5,
    voice: fm({ ratio: 3.5, index: 4, indexTime: 0.8, env: { a: 0.002, d: 1.5, s: 0, r: 1 }, level: 0.2 }),
  },
  drums: {
    name: 'Drums', color: '#4cc9b0', drums: true,
    voice: (...args) => drumVoice(...args),
  },
  // Audio: records an audio input (chosen per track) instead of playing notes.
  audio: { name: 'Audio', color: '#c9d46a', audio: true },
};

// ---- drum rack ------------------------------------------------------------
// General MIDI layout from C1 (36). Any octave maps onto the same 12 pads.

export const DRUM_BASE = 36;
export const DRUM_NAMES = ['Kick', 'Rim', 'Snare', 'Clap', 'Snare 2', 'Tom 1', 'Closed HH', 'Tom 2', 'Pedal HH', 'Tom 3', 'Open HH', 'Tom 4'];
export const DRUM_SHORT = ['Kick', 'Rim', 'Snare', 'Clap', 'Snr 2', 'Tom 1', 'CH', 'Tom 2', 'Pedal', 'Tom 3', 'OH', 'Tom 4'];
export const drumIndex = note => (((note - DRUM_BASE) % 12) + 12) % 12;

export function makeNoise(ctx) {
  const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

export function drumVoice(ctx, dest, note, vel, t, onEnd, noiseBuf) {
  const out = new GainNode(ctx, { gain: 0.9 * (vel / 127) });
  out.connect(dest);
  const sources = [];

  // Pitched body: frequency sweeps f0 -> f1, amplitude decays.
  const tone = (f0, f1, sweep, decay, level, type = 'sine') => {
    const o = new OscillatorNode(ctx, { type, frequency: f0 });
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + sweep);
    const g = new GainNode(ctx, { gain: 0 });
    g.gain.setValueAtTime(level, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + decay);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + decay + 0.02);
    sources.push(o);
  };

  // Filtered noise burst. `hits` > 1 gives a clap-style flam.
  const noise = (type, freq, decay, level, Q = 0.7, hits = 1) => {
    const s = new AudioBufferSourceNode(ctx, { buffer: noiseBuf });
    const f = new BiquadFilterNode(ctx, { type, frequency: freq, Q });
    const g = new GainNode(ctx, { gain: 0 });
    for (let i = 0; i < hits - 1; i++) {
      g.gain.setValueAtTime(level, t + i * 0.011);
      g.gain.exponentialRampToValueAtTime(0.05, t + i * 0.011 + 0.009);
    }
    const tail = t + (hits - 1) * 0.011;
    g.gain.setValueAtTime(level, tail);
    g.gain.exponentialRampToValueAtTime(0.001, tail + decay);
    s.connect(f).connect(g).connect(out);
    s.start(t, Math.random() * 0.5);
    s.stop(tail + decay + 0.02);
    sources.push(s);
  };

  const tom = f => tone(f * 1.6, f, 0.08, 0.35, 0.8);

  switch (drumIndex(note)) {
    case 0: tone(150, 42, 0.12, 0.45, 1.0); tone(900, 200, 0.01, 0.02, 0.25, 'triangle'); break; // kick
    case 1: tone(1700, 1600, 0.01, 0.03, 0.3, 'square'); noise('highpass', 2000, 0.02, 0.25); break; // rim
    case 2: tone(220, 160, 0.05, 0.12, 0.5, 'triangle'); noise('highpass', 1200, 0.2, 0.55); break; // snare
    case 3: noise('bandpass', 1400, 0.16, 0.8, 1.2, 3); break; // clap
    case 4: tone(260, 190, 0.04, 0.08, 0.45, 'triangle'); noise('highpass', 2500, 0.12, 0.5); break; // snare 2
    case 5: tom(82); break;
    case 6: noise('highpass', 7500, 0.05, 0.4); break; // closed hat
    case 7: tom(104); break;
    case 8: noise('highpass', 7000, 0.09, 0.25); break; // pedal hat
    case 9: tom(130); break;
    case 10: noise('highpass', 7000, 0.4, 0.35); break; // open hat
    case 11: tom(165); break;
  }

  let remaining = sources.length;
  for (const s of sources) s.onended = () => { if (--remaining === 0) { out.disconnect(); onEnd(); } };

  return {
    release() {}, // one-shot: note-off does nothing
    kill(now) { for (const s of sources) s.stop(now); },
  };
}
