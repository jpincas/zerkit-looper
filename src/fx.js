// Per-track FX: a pedalboard of 8 pedals in a row on every track, between its volume and its
// stereo position. One pedal per Circuit pad column; each has a Mix (the column's knob on its own)
// and three controls (hold pad 1, 2 or 3 of the column and turn the knob), and a footswitch (the
// column's bottom pad). Every control is 0-1. Settings are plain objects, saved with the project:
//   { on, preset, edited, pedals: { comp: { on, mix, p: [a, b, c] }, drive: ..., ... } }
// A pedal's nodes are only made the first time it's switched on.

export const DIVISIONS = [
  { label: '1/16', beats: 0.25 }, { label: '1/8T', beats: 1 / 3 }, { label: '1/8', beats: 0.5 }, { label: '1/8.', beats: 0.75 },
  { label: '1/4T', beats: 2 / 3 }, { label: '1/4', beats: 1 }, { label: '1/4.', beats: 1.5 }, { label: '1/2', beats: 2 },
];
const RATES = [{ label: '1/32', beats: 0.125 }, { label: '1/16T', beats: 1 / 6 }, ...DIVISIONS.slice(0, 6), { label: '1/2', beats: 2 }, { label: '1 bar', beats: 4 }];
const step = (list, v) => list[Math.round(v * (list.length - 1))];
const pct = v => `${Math.round(v * 100)}%`;
const logMap = (lo, hi) => v => lo * (hi / lo) ** v;
const hzFmt = hz => (hz >= 1000 ? `${(hz / 1000).toFixed(1)}k` : `${Math.round(hz)}`);

const decaySecs = logMap(0.2, 10);
const lfoHz = logMap(0.05, 8);
const cutoffHz = logMap(80, 18000);
const delayToneHz = logMap(600, 14000);

// The pedals, left to right (the Circuit's pad columns 1-8). `color`: screen; `code`: Circuit light.
export const PEDALS = [
  { id: 'comp', name: 'Comp', color: '#6fc3f2', code: 0x13, params: [
    { name: 'Threshold', fmt: v => `${Math.round(-50 * v)}dB` }, { name: 'Ratio', fmt: v => `${(1 + 19 * v ** 2).toFixed(1)}:1` },
    { name: 'Makeup', fmt: v => `+${Math.round(18 * v)}dB` }] },
  { id: 'drive', name: 'Drive', color: '#f06a5a', code: 0x53, params: [
    { name: 'Drive', fmt: pct }, { name: 'Tone', fmt: v => hzFmt(logMap(800, 12000)(v)) }, { name: 'Level', fmt: pct }] },
  { id: 'filter', name: 'Filter', color: '#f0a05a', code: 0x45, params: [
    { name: 'Cutoff', fmt: v => hzFmt(cutoffHz(v)) }, { name: 'Resonance', fmt: pct }, { name: 'Sweep', fmt: pct }] },
  { id: 'chorus', name: 'Chorus', color: '#4cc9b0', code: 0x4D, params: [
    { name: 'Rate', fmt: v => `${lfoHz(v * 0.75).toFixed(2)}Hz` }, { name: 'Depth', fmt: pct }, { name: 'Feedback', fmt: pct }] },
  { id: 'phaser', name: 'Phaser', color: '#e58fd3', code: 0x32, params: [
    { name: 'Rate', fmt: v => `${lfoHz(v * 0.75).toFixed(2)}Hz` }, { name: 'Depth', fmt: pct }, { name: 'Feedback', fmt: pct }] },
  { id: 'trem', name: 'Tremolo', color: '#e8d45a', code: 0x2D, params: [
    { name: 'Rate', fmt: v => step(RATES, v).label, steps: RATES.length }, { name: 'Depth', fmt: pct }, { name: 'Shape', fmt: v => (v < 0.5 ? 'Sine' : 'Square') }] },
  { id: 'delay', name: 'Delay', color: '#5a8af0', code: 0x09, params: [
    { name: 'Time', fmt: v => step(DIVISIONS, v).label, steps: DIVISIONS.length }, { name: 'Feedback', fmt: pct },
    { name: 'Tone', fmt: v => hzFmt(delayToneHz(v)) }] },
  { id: 'reverb', name: 'Reverb', color: '#a58af5', code: 0x49, params: [
    { name: 'Decay', fmt: v => `${decaySecs(v).toFixed(1)}s` }, { name: 'Tone', fmt: pct }, { name: 'Pre-delay', fmt: v => `${Math.round(v * 150)}ms` }] },
];

const DEFAULTS = {
  comp: { mix: 1, p: [0.4, 0.3, 0.3] }, drive: { mix: 1, p: [0.4, 0.6, 0.6] }, filter: { mix: 1, p: [0.6, 0.2, 0] },
  chorus: { mix: 0.5, p: [0.3, 0.5, 0.1] }, phaser: { mix: 0.5, p: [0.3, 0.7, 0.4] }, trem: { mix: 1, p: [5 / 9, 0.5, 0] },
  delay: { mix: 0.3, p: [2 / 7, 0.3, 0.6] }, reverb: { mix: 0.3, p: [0.4, 0.6, 0.1] },
};
const pedalsWith = changes => Object.fromEntries(PEDALS.map(({ id }) => {
  const c = changes[id];
  return [id, { on: !!c, mix: c?.mix ?? DEFAULTS[id].mix, p: [...(c?.p ?? DEFAULTS[id].p)] }];
}));

// Presets: a 4 x 8 grid, shown (on screen and on the Circuit's pads) while Shift is held. One row
// per kind, lit in a matching pedal colour. Trem rates are RATES indexes / 9, delay times DIVISIONS / 7.
const P = (name, pedals) => ({ name, pedals });
export const PRESET_ROWS = [
  { kind: 'Spaces', code: 0x49, color: '#a58af5', presets: [
    P('Dry', {}),
    P('Room', { reverb: { mix: 0.25, p: [0.25, 0.55, 0.05] } }),
    P('Studio', { reverb: { mix: 0.3, p: [0.38, 0.65, 0.08] } }),
    P('Plate', { reverb: { mix: 0.32, p: [0.5, 0.85, 0.12] } }),
    P('Hall', { reverb: { mix: 0.38, p: [0.68, 0.5, 0.22] } }),
    P('Cathedral', { reverb: { mix: 0.5, p: [0.92, 0.45, 0.35] } }),
    P('Shimmer', { chorus: { mix: 0.4, p: [0.25, 0.6, 0.2] }, reverb: { mix: 0.5, p: [0.85, 0.85, 0.3] } }),
    P('Ambient', { chorus: { mix: 0.35, p: [0.2, 0.5, 0] }, delay: { mix: 0.3, p: [6 / 7, 0.55, 0.45] }, reverb: { mix: 0.45, p: [0.9, 0.55, 0.3] } }),
  ] },
  { kind: 'Echoes', code: 0x09, color: '#5a8af0', presets: [
    P('Slapback', { delay: { mix: 0.35, p: [0, 0.12, 0.7] } }),
    P('16ths', { delay: { mix: 0.3, p: [0, 0.45, 0.6] } }),
    P('8ths', { delay: { mix: 0.3, p: [2 / 7, 0.4, 0.6] } }),
    P('Dotted', { delay: { mix: 0.32, p: [3 / 7, 0.42, 0.6] }, reverb: { mix: 0.15, p: [0.3, 0.6, 0.05] } }),
    P('Quarters', { delay: { mix: 0.3, p: [5 / 7, 0.45, 0.55] } }),
    P('Dub', { delay: { mix: 0.38, p: [5 / 7, 0.66, 0.3] }, reverb: { mix: 0.22, p: [0.5, 0.4, 0.1] } }),
    P('Tape Echo', { drive: { mix: 1, p: [0.2, 0.45, 0.75] }, delay: { mix: 0.35, p: [3 / 7, 0.55, 0.3] } }),
    P('Ping-pong', { delay: { mix: 0.4, p: [1 / 7, 0.6, 0.7] } }),
  ] },
  { kind: 'Colour', code: 0x53, color: '#f06a5a', presets: [
    P('Glue', { comp: { mix: 1, p: [0.35, 0.2, 0.25] } }),
    P('Punch', { comp: { mix: 1, p: [0.6, 0.6, 0.5] } }),
    P('Warm', { drive: { mix: 1, p: [0.15, 0.45, 0.75] } }),
    P('Crunch', { drive: { mix: 1, p: [0.5, 0.55, 0.55] }, reverb: { mix: 0.15, p: [0.25, 0.5, 0.05] } }),
    P('Fuzz', { drive: { mix: 1, p: [0.95, 0.6, 0.4] } }),
    P('Lo-fi', { drive: { mix: 1, p: [0.35, 0.4, 0.6] }, filter: { mix: 1, p: [0.35, 0.15, 0] } }),
    P('Radio', { drive: { mix: 1, p: [0.55, 0.75, 0.45] }, filter: { mix: 1, p: [0.5, 0.6, 0] } }),
    P('Muffled', { filter: { mix: 1, p: [0.3, 0.1, 0] }, reverb: { mix: 0.2, p: [0.4, 0.3, 0.1] } }),
  ] },
  { kind: 'Movement', code: 0x32, color: '#e58fd3', presets: [
    P('Chorus', { chorus: { mix: 0.5, p: [0.3, 0.5, 0.1] } }),
    P('Ensemble', { chorus: { mix: 0.6, p: [0.15, 0.85, 0.25] } }),
    P('Slow Phase', { phaser: { mix: 0.5, p: [0.15, 0.7, 0.4] } }),
    P('Fast Phase', { phaser: { mix: 0.5, p: [0.65, 0.6, 0.5] } }),
    P('Wobble', { filter: { mix: 1, p: [0.45, 0.55, 0.7] }, delay: { mix: 0.2, p: [2 / 7, 0.3, 0.5] } }),
    P('Tremolo', { trem: { mix: 1, p: [4 / 9, 0.6, 0] } }),
    P('Stutter', { trem: { mix: 1, p: [2 / 9, 1, 1] } }),
    P('Swirl', { phaser: { mix: 0.45, p: [0.25, 0.7, 0.5] }, chorus: { mix: 0.3, p: [0.2, 0.4, 0] }, reverb: { mix: 0.35, p: [0.7, 0.6, 0.2] } }),
  ] },
];
export const PRESETS = PRESET_ROWS.flatMap(r => r.presets);

export function fromPreset(i) {
  const p = PRESETS[i];
  return { on: true, preset: p.name, edited: false, pedals: pedalsWith(p.pedals) };
}
export const defaultFx = () => fromPreset(0);

// Settings from a project: this shape, or the earlier delay + reverb one.
export function readFx(s) {
  if (!s) return defaultFx();
  if (s.pedals) {
    const out = { on: s.on !== false, preset: s.preset ?? 'Custom', edited: !!s.edited, pedals: pedalsWith({}) };
    for (const { id } of PEDALS) if (s.pedals[id]) Object.assign(out.pedals[id], structuredClone(s.pedals[id]));
    return out;
  }
  const out = { on: s.on !== false, preset: s.preset ?? 'Custom', edited: !!s.edited, pedals: pedalsWith({}) };
  if (s.delay) out.pedals.delay = { on: !!s.delay.on, mix: s.delay.mix, p: [s.delay.time, s.delay.feedback, s.delay.tone] };
  if (s.reverb) out.pedals.reverb = { on: !!s.reverb.on, mix: s.reverb.mix, p: [s.reverb.decay, s.reverb.tone, s.reverb.predelay] };
  return out;
}

// ---- the pedals' sound ----------------------------------------------------------------
// Each pedal: input -> dry -> output, and input -> effect -> wet -> output (equal-power mix).

function driveCurve(amount) {
  const k = 1 + amount * 60, n = 1024, c = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(k * x) / Math.tanh(k); }
  return c;
}

function makeRoom(ctx, secs, tone) {
  const sr = ctx.sampleRate, len = Math.max(1, Math.round(sr * secs));
  const ir = new AudioBuffer({ numberOfChannels: 2, length: len, sampleRate: sr });
  const a0 = 0.12 + 0.8 * tone;
  for (let ch = 0; ch < 2; ch++) {
    const out = ir.getChannelData(ch);
    let y = 0;
    for (let n = 0; n < len; n++) {
      const t = n / len;
      y += a0 * (1 - 0.8 * t) * ((Math.random() * 2 - 1) - y);
      out[n] = y * Math.exp(-6.9 * t);
    }
  }
  return ir;
}

const BUILD = {
  comp(ctx) {
    const comp = new DynamicsCompressorNode(ctx, { knee: 6, attack: 0.005, release: 0.15 });
    const makeup = new GainNode(ctx);
    comp.connect(makeup);
    return {
      in: comp, out: makeup,
      set(p, ramp) { ramp(comp.threshold, -50 * p[0]); ramp(comp.ratio, 1 + 19 * p[1] ** 2); ramp(makeup.gain, 10 ** ((18 * p[2]) / 20)); },
    };
  },
  drive(ctx) {
    const pre = new GainNode(ctx), shaper = new WaveShaperNode(ctx, { oversample: '4x' });
    const tone = new BiquadFilterNode(ctx, { type: 'lowpass', Q: 0.4 }), level = new GainNode(ctx);
    pre.connect(shaper).connect(tone).connect(level);
    let last = -1;
    return {
      in: pre, out: level,
      set(p, ramp) {
        if (Math.abs(p[0] - last) > 0.01) { shaper.curve = driveCurve(p[0]); last = p[0]; }
        ramp(pre.gain, 1 + p[0] * 3); ramp(tone.frequency, logMap(800, 12000)(p[1])); ramp(level.gain, 0.15 + p[2] * 0.9);
      },
    };
  },
  filter(ctx, fx) {
    const f = new BiquadFilterNode(ctx, { type: 'lowpass' });
    const lfo = new OscillatorNode(ctx, { type: 'sine' }), depth = new GainNode(ctx, { gain: 0 });
    lfo.connect(depth).connect(f.detune);
    lfo.start();
    return {
      in: f, out: f,
      set(p, ramp) {
        ramp(f.frequency, cutoffHz(p[0])); ramp(f.Q, 0.5 + 19 * p[1] ** 2);
        ramp(depth.gain, p[2] * 3600);                                  // up to 3 octaves either way
        ramp(lfo.frequency, fx.bpm / 60 / 2);                           // a sweep every half note
      },
    };
  },
  chorus(ctx) {
    // Two short modulated delays, one per side, their LFOs a quarter-cycle apart.
    const split = new GainNode(ctx), merge = new ChannelMergerNode(ctx, { numberOfInputs: 2 });
    const fb = new GainNode(ctx, { gain: 0 });
    const sides = [0, 1].map(ch => {
      const d = new DelayNode(ctx, { maxDelayTime: 0.05, delayTime: 0.015 });
      const lfo = new OscillatorNode(ctx), amt = new GainNode(ctx, { gain: 0 });
      lfo.connect(amt).connect(d.delayTime);
      lfo.start(ctx.currentTime + ch * 0.25);
      split.connect(d);
      d.connect(merge, 0, ch);
      d.connect(fb);
      return { lfo, amt };
    });
    fb.connect(split);
    return {
      in: split, out: merge,
      set(p, ramp) {
        for (const s of sides) { ramp(s.lfo.frequency, lfoHz(p[0] * 0.75)); ramp(s.amt.gain, 0.0005 + p[1] * 0.007); }
        ramp(fb.gain, p[2] * 0.35);
      },
    };
  },
  phaser(ctx) {
    const stages = [0, 1, 2, 3].map(() => new BiquadFilterNode(ctx, { type: 'allpass', Q: 0.7, frequency: 800 }));
    const lfo = new OscillatorNode(ctx), amt = new GainNode(ctx, { gain: 0 }), fb = new GainNode(ctx, { gain: 0 });
    stages.reduce((a, b) => a.connect(b));
    const loop = new DelayNode(ctx, { delayTime: 0.001 });             // a feedback loop needs a delay in it
    stages.at(-1).connect(fb).connect(loop).connect(stages[0]);
    lfo.connect(amt);
    for (const s of stages) amt.connect(s.detune);
    lfo.start();
    return {
      in: stages[0], out: stages.at(-1),
      set(p, ramp) { ramp(lfo.frequency, lfoHz(p[0] * 0.75)); ramp(amt.gain, 300 + p[1] * 2400); ramp(fb.gain, p[2] * 0.7); },
    };
  },
  trem(ctx, fx) {
    const vca = new GainNode(ctx, { gain: 1 }), lfo = new OscillatorNode(ctx, { type: 'sine' }), amt = new GainNode(ctx, { gain: 0 });
    lfo.connect(amt).connect(vca.gain);
    lfo.start();
    return {
      in: vca, out: vca,
      set(p, ramp) {
        const type = p[2] < 0.5 ? 'sine' : 'square';
        if (lfo.type !== type) lfo.type = type;
        ramp(lfo.frequency, fx.bpm / 60 / step(RATES, p[0]).beats);
        ramp(amt.gain, p[1] * 0.5); ramp(vca.gain, 1 - p[1] * 0.5);
      },
    };
  },
  delay(ctx, fx) {
    // Ping-pong: left and right delays feeding each other through a lowpass.
    const send = new GainNode(ctx), merge = new ChannelMergerNode(ctx, { numberOfInputs: 2 });
    const dl = new DelayNode(ctx, { maxDelayTime: 4 }), dr = new DelayNode(ctx, { maxDelayTime: 4 });
    const tl = new BiquadFilterNode(ctx, { type: 'lowpass', Q: 0.5 }), tr = new BiquadFilterNode(ctx, { type: 'lowpass', Q: 0.5 });
    const fl = new GainNode(ctx, { gain: 0 }), fr = new GainNode(ctx, { gain: 0 }), out = new GainNode(ctx, { gain: 1.4 });
    send.connect(dl);
    dl.connect(tl).connect(fl).connect(dr);
    dr.connect(tr).connect(fr).connect(dl);
    tl.connect(merge, 0, 0); tr.connect(merge, 0, 1);
    merge.connect(out);
    return {
      in: send, out,
      set(p, ramp) {
        const secs = Math.min(4, step(DIVISIONS, p[0]).beats * 60 / fx.bpm);
        ramp(dl.delayTime, secs); ramp(dr.delayTime, secs);
        const hz = delayToneHz(p[2]);
        ramp(tl.frequency, hz); ramp(tr.frequency, hz);
        ramp(fl.gain, p[1] * 0.92); ramp(fr.gain, p[1] * 0.92);
      },
    };
  },
  reverb(ctx) {
    const pre = new DelayNode(ctx, { maxDelayTime: 0.5 }), conv = new ConvolverNode(ctx, { normalize: true });
    pre.connect(conv);
    let room = '', timer = 0;
    return {
      in: pre, out: conv,
      set(p, ramp) {
        ramp(pre.delayTime, p[2] * 0.15);
        const key = `${p[0].toFixed(3)}:${p[1].toFixed(3)}`;
        if (key === room) return;
        room = key;
        clearTimeout(timer);
        const build = () => { conv.buffer = makeRoom(ctx, decaySecs(p[0]), p[1]); };
        if (!conv.buffer) build(); else timer = setTimeout(build, 120);
      },
    };
  },
};

export class TrackFX {
  constructor(ctx) {
    this.ctx = ctx;
    this.bpm = 120;
    this.input = new GainNode(ctx);
    this.output = new GainNode(ctx);
    // One stage per pedal: dry and (once built) wet, summed.
    this.stages = PEDALS.map(() => ({ sum: new GainNode(ctx), dry: new GainNode(ctx), wet: null, unit: null }));
    let prev = this.input;
    for (const st of this.stages) { prev.connect(st.dry).connect(st.sum); st.from = prev; prev = st.sum; }
    prev.connect(this.output);
    this.settings = defaultFx();
    this.apply();
  }

  setTempo(bpm) { if (bpm !== this.bpm) { this.bpm = bpm; this.apply(); } }
  set(settings) { this.settings = settings; this.apply(); }

  apply() {
    const { ctx } = this, now = ctx.currentTime, s = this.settings;
    const ramp = (param, v) => param.setTargetAtTime(v, now, 0.03);
    PEDALS.forEach(({ id }, i) => {
      const st = this.stages[i], ped = s.pedals[id], on = s.on && ped.on;
      if (on && !st.unit) {                                  // first time on: make it
        st.unit = BUILD[id](ctx, this);
        st.wet = new GainNode(ctx, { gain: 0 });
        st.unit.out.connect(st.wet).connect(st.sum);
      }
      // Feed a pedal only while it's on (switched off, it costs nothing once its tail has gone).
      if (on && !st.fed) { st.from.connect(st.unit.in); st.fed = true; }
      if (!on && st.fed) {
        clearTimeout(st.unfeed);
        st.unfeed = setTimeout(() => { if (st.fed && !(this.settings.on && this.settings.pedals[id].on)) { st.from.disconnect(st.unit.in); st.fed = false; } }, 150);
      }
      const m = ped.mix;
      ramp(st.dry.gain, on ? Math.cos(m * Math.PI / 2) : 1);
      if (st.wet) ramp(st.wet.gain, on ? Math.sin(m * Math.PI / 2) : 0);
      if (st.unit) st.unit.set(ped.p, ramp);
    });
  }
}
