// Synth tracks: a subtractive synth on each track (its own settings per track), made of Web Audio
// nodes like the FX. Laid out like the FX page, one column per Circuit pad column:
//   Saw · Square · Sine · Noise | Filter | Filter env · Amp env | LFO
// Each column has a main knob (its level, the cutoff, the env amount...), three controls (hold pad
// 1, 2 or 3 of the column and turn its knob) and an on/off switch (the column's bottom pad).
// Every control is 0-1. Settings are plain objects, saved with the project:
//   { preset, edited, mode: 'poly' | 'mono' | 'legato', glide, velocity, volume,
//     cols: { saw: { on, main, p: [a, b, c] }, square: ..., ... } }
// A note is one voice: the oscillators that are on -> filter -> amp, with its own envelopes; the
// LFO is shared by the track's voices. Turning a control changes the notes already sounding.
import { INSTRUMENTS } from './instruments.js';

export const SYNTH_KEY = 'synth';
export const SYNTH_COLOR = '#f07acb';

const logMap = (lo, hi) => v => lo * (hi / lo) ** v;
const step = (list, v) => list[Math.round(v * (list.length - 1))];
const pct = v => `${Math.round(v * 100)}%`;
const secs = s => (s < 1 ? `${Math.round(s * 1000)}ms` : `${s.toFixed(1)}s`);
const hzFmt = hz => (hz >= 1000 ? `${(hz / 1000).toFixed(1)}k` : `${Math.round(hz)}`);

const attackT = logMap(0.001, 5), decayT = logMap(0.005, 8), releaseT = logMap(0.01, 10);
const cutoffHz = logMap(30, 18000), colourHz = logMap(200, 16000), noiseDecayT = logMap(0.01, 2), glideT = logMap(0.01, 1.5);
const octaveOf = v => Math.round(v * 4) - 2;              // -2 .. +2
const centsOf = v => (v - 0.5) * 100;                     // ±50 cents
const dutyOf = v => 0.5 - v * 0.45;                       // square's pulse width: 50% .. 5%
const fmIndex = v => 8 * v * v;
const resDb = v => -3 + 24 * v ** 1.5;                     // lowpass / highpass resonance (dB)
const RATIOS = [0.5, 1, 2, 3, 3.5, 4, 5, 7];
const FILTERS = ['LP 24', 'LP 12', 'BP', 'HP'];
const SHAPES = ['Sine', 'Triangle', 'Square', 'Saw'];
const LFO_TYPES = ['sine', 'triangle', 'square', 'sawtooth'];
const DESTS = ['Pitch', 'Filter', 'Amp'];
export const LFO_RATES = [
  { label: '1/32', beats: 0.125 }, { label: '1/16T', beats: 1 / 6 }, { label: '1/16', beats: 0.25 }, { label: '1/8T', beats: 1 / 3 },
  { label: '1/8', beats: 0.5 }, { label: '1/4T', beats: 2 / 3 }, { label: '1/4', beats: 1 }, { label: '1/2', beats: 2 },
  { label: '1 bar', beats: 4 }, { label: '2 bars', beats: 8 },
];

const OCT = { name: 'Octave', fmt: v => { const o = octaveOf(v); return o > 0 ? `+${o}` : `${o}`; }, steps: 5 };
const DETUNE = { name: 'Detune', fmt: v => { const c = Math.round(centsOf(v)); return `${c > 0 ? '+' : ''}${c}c`; } };

// Sections (the screen's headings and the Circuit's knob and pad colours).
export const SECTIONS = {
  osc: { name: 'Oscillators', color: '#f2b33d', code: 0x2B },
  filter: { name: 'Filter', color: '#f06a5a', code: 0x53 },
  env: { name: 'Envelopes', color: '#6fc3f2', code: 0x13 },
  mod: { name: 'Modulation', color: '#a58af5', code: 0x49 },
};

// The columns, left to right (the Circuit's pad columns 1-8).
export const SYNTH_COLS = [
  { id: 'saw', name: 'Saw', section: 'osc', main: { name: 'Level', fmt: pct }, params: [OCT, DETUNE, { name: 'Spread', fmt: pct }] },
  { id: 'square', name: 'Square', section: 'osc', main: { name: 'Level', fmt: pct }, params: [OCT, DETUNE, { name: 'Width', fmt: v => `${Math.round(dutyOf(v) * 100)}%` }] },
  { id: 'sine', name: 'Sine', section: 'osc', main: { name: 'Level', fmt: pct }, params: [OCT, { name: 'FM', fmt: pct }, { name: 'FM ratio', fmt: v => `×${step(RATIOS, v)}`, steps: RATIOS.length }] },
  { id: 'noise', name: 'Noise', section: 'osc', main: { name: 'Level', fmt: pct }, params: [
    { name: 'Colour', fmt: v => hzFmt(colourHz(v)) }, { name: 'Decay', fmt: v => (v >= 0.98 ? 'Hold' : secs(noiseDecayT(v))) }, { name: 'Res', fmt: pct }] },
  { id: 'filter', name: 'Filter', section: 'filter', main: { name: 'Cutoff', fmt: v => hzFmt(cutoffHz(v)) }, params: [
    { name: 'Resonance', fmt: pct }, { name: 'Type', fmt: v => step(FILTERS, v), steps: FILTERS.length }, { name: 'Key track', fmt: pct }] },
  { id: 'fenv', name: 'Filter env', section: 'env', main: { name: 'Amount', fmt: pct }, params: [
    { name: 'Attack', fmt: v => secs(attackT(v)) }, { name: 'Decay', fmt: v => secs(decayT(v)) }, { name: 'Sustain', fmt: pct }] },
  { id: 'amp', name: 'Amp env', section: 'env', main: { name: 'Attack', fmt: v => secs(attackT(v)) }, params: [
    { name: 'Decay', fmt: v => secs(decayT(v)) }, { name: 'Sustain', fmt: pct }, { name: 'Release', fmt: v => secs(releaseT(v)) }] },
  { id: 'lfo', name: 'LFO', section: 'mod', main: { name: 'Depth', fmt: pct }, params: [
    { name: 'Rate', fmt: v => step(LFO_RATES, v).label, steps: LFO_RATES.length }, { name: 'Shape', fmt: v => step(SHAPES, v), steps: SHAPES.length },
    { name: 'To', fmt: v => step(DESTS, v), steps: DESTS.length }] },
];
for (const c of SYNTH_COLS) Object.assign(c, { color: SECTIONS[c.section].color, code: SECTIONS[c.section].code });

// The voice settings, in the page's header (screen only).
export const MODES = ['poly', 'mono', 'legato'];
export const VOICE_KNOBS = [
  { id: 'glide', name: 'Glide', fmt: v => (v < 0.01 ? 'Off' : secs(glideT(v))), dflt: 0 },
  { id: 'velocity', name: 'Velocity', fmt: pct, dflt: 0.6 },
  { id: 'volume', name: 'Volume', fmt: pct, dflt: 0.7 },
];

// ---- presets: 32, a row each of leads, bass, pads and plucks, lying on the pads -------------
// Stepped values: Octave -2..+2 = 0, .25, .5, .75, 1; FM ratio i/7; LFO rate i/9, shape i/3,
// destination i/2; filter type i/3. Oscillators not listed are off; the rest start from BASE.
const BASE = {
  mode: 'poly', glide: 0, velocity: 0.6, volume: 0.7,
  cols: {
    saw: { on: false, main: 0.8, p: [0.5, 0.5, 0] },
    square: { on: false, main: 0.6, p: [0.5, 0.5, 0] },
    sine: { on: false, main: 0.7, p: [0.5, 0, 1 / 7] },
    noise: { on: false, main: 0.3, p: [0.6, 1, 0] },
    filter: { on: true, main: 0.55, p: [0.2, 0, 0.3] },
    fenv: { on: true, main: 0.35, p: [0, 0.45, 0.3] },
    amp: { on: true, main: 0, p: [0.5, 0.8, 0.35] },
    lfo: { on: false, main: 0.2, p: [3 / 9, 0, 0] },
  },
};
const S = (name, o = {}) => ({ name, ...o });
export const PRESET_ROWS = [
  { kind: 'Leads', color: '#f2b33d', code: 0x2B, presets: [
    S('Classic', { cols: { saw: { main: 0.8 }, square: { main: 0.45, p: [0.5, 0.56, 0] }, filter: { main: 0.5, p: [0.25, 0, 0.3] }, fenv: { main: 0.4, p: [0, 0.5, 0.35] }, amp: { main: 0, p: [0.5, 0.8, 0.35] } } }),
    S('Supersaw', { volume: 0.52, velocity: 0.4, cols: { saw: { main: 0.9, p: [0.5, 0.5, 0.7] }, sine: { main: 0.35, p: [0.25, 0, 1 / 7] }, filter: { main: 0.75, p: [0.1, 0, 0.2] }, fenv: { main: 0.15, p: [0, 0.5, 0.5] }, amp: { main: 0.3, p: [0.6, 0.85, 0.5] } } }),
    S('Square Lead', { mode: 'legato', glide: 0.3, cols: { square: { main: 0.8, p: [0.5, 0.5, 0.25] }, saw: { main: 0.3, p: [0.75, 0.52, 0] }, filter: { main: 0.6, p: [0.3, 0, 0.3] }, fenv: { main: 0.3, p: [0, 0.45, 0.5] }, amp: { main: 0.15, p: [0.5, 0.9, 0.3] }, lfo: { main: 0.18, p: [3 / 9, 0, 0] } } }),
    S('Brass', { velocity: 0.8, cols: { saw: { main: 0.8, p: [0.5, 0.5, 0.25] }, square: { main: 0.5, p: [0.5, 0.53, 0.1] }, filter: { main: 0.38, p: [0.15, 0, 0.5] }, fenv: { main: 0.5, p: [0.55, 0.55, 0.45] }, amp: { main: 0.45, p: [0.5, 0.85, 0.35] } } }),
    S('Whistle', { mode: 'legato', glide: 0.25, volume: 0.38, cols: { sine: { main: 0.9, p: [0.75, 0, 1 / 7] }, noise: { main: 0.08, p: [0.9, 1, 0] }, filter: { on: false }, fenv: { on: false }, amp: { main: 0.3, p: [0.5, 1, 0.4] }, lfo: { main: 0.2, p: [3 / 9, 0, 0] } } }),
    S('Screamer', { volume: 0.47, mode: 'mono', glide: 0.15, velocity: 0.5, cols: { saw: { main: 0.9, p: [0.5, 0.5, 0.2] }, square: { main: 0.4, p: [0.75, 0.5, 0.3] }, filter: { main: 0.45, p: [0.7, 0, 0.4] }, fenv: { main: 0.45, p: [0, 0.6, 0.4] }, amp: { main: 0.1, p: [0.5, 0.9, 0.35] } } }),
    S('Chip', { mode: 'mono', velocity: 0.3, volume: 0.8, cols: { square: { main: 0.8, p: [0.5, 0.5, 0.6] }, filter: { on: false }, fenv: { on: false }, amp: { on: false }, lfo: { main: 0.15, p: [3 / 9, 0, 0] } } }),
    S('Fat Lead', { mode: 'mono', glide: 0.2, volume: 0.38, cols: { saw: { main: 0.8, p: [0.5, 0.47, 0.25] }, square: { main: 0.7, p: [0.5, 0.54, 0.1] }, sine: { main: 0.4, p: [0.25, 0, 1 / 7] }, filter: { main: 0.55, p: [0.25, 0, 0.3] }, fenv: { main: 0.3, p: [0, 0.55, 0.5] }, amp: { main: 0.05, p: [0.5, 0.9, 0.35] } } }),
  ] },
  { kind: 'Bass', color: '#f06a5a', code: 0x53, presets: [
    S('Sub Bass', { mode: 'mono', glide: 0.2, volume: 0.45, cols: { sine: { main: 0.9, p: [0.25, 0.08, 1 / 7] }, filter: { main: 0.45, p: [0, 0, 0] }, fenv: { main: 0.1, p: [0, 0.4, 0.3] }, amp: { main: 0, p: [0.5, 0.9, 0.25] } } }),
    S('Saw Bass', { volume: 0.5, mode: 'mono', cols: { saw: { main: 0.8, p: [0.25, 0.5, 0.15] }, square: { main: 0.5, p: [0, 0.5, 0] }, filter: { main: 0.3, p: [0.3, 0, 0.3] }, fenv: { main: 0.45, p: [0, 0.45, 0.2] }, amp: { main: 0, p: [0.5, 0.8, 0.25] } } }),
    S('Acid', { mode: 'legato', glide: 0.35, cols: { saw: { main: 0.9, p: [0.25, 0.5, 0] }, filter: { main: 0.3, p: [0.75, 0, 0.2] }, fenv: { main: 0.6, p: [0, 0.4, 0] }, amp: { main: 0, p: [0.5, 0.7, 0.2] } } }),
    S('Reese', { mode: 'mono', volume: 0.33, cols: { saw: { main: 0.8, p: [0.25, 0.45, 0.45] }, sine: { main: 0.5, p: [0.25, 0, 1 / 7] }, filter: { main: 0.4, p: [0.2, 0, 0.2] }, fenv: { main: 0.1, p: [0, 0.5, 0.5] }, amp: { main: 0.1, p: [0.5, 1, 0.3] }, lfo: { main: 0.15, p: [8 / 9, 0, 0.5] } } }),
    S('Pulse Bass', { volume: 1, mode: 'mono', cols: { square: { main: 0.8, p: [0.25, 0.5, 0.55] }, filter: { main: 0.4, p: [0.35, 0, 0.3] }, fenv: { main: 0.55, p: [0, 0.42, 0.1] }, amp: { main: 0, p: [0.5, 0.7, 0.2] } } }),
    S('Wobble', { mode: 'mono', volume: 0.4, cols: { saw: { main: 0.8, p: [0.25, 0.5, 0.3] }, square: { main: 0.5, p: [0, 0.5, 0] }, filter: { main: 0.3, p: [0.55, 0, 0] }, fenv: { on: false }, amp: { main: 0, p: [0.5, 1, 0.2] }, lfo: { main: 0.55, p: [5 / 9, 0, 0.5] } } }),
    S('FM Bass', { mode: 'mono', cols: { sine: { main: 0.9, p: [0.25, 0.45, 1 / 7] }, filter: { main: 0.5, p: [0.1, 0, 0.3] }, fenv: { main: 0.35, p: [0, 0.45, 0.1] }, amp: { main: 0, p: [0.6, 0.6, 0.2] } } }),
    S('Fat Bass', { mode: 'mono', glide: 0.1, volume: 0.44, cols: { saw: { main: 0.8, p: [0.25, 0.5, 0] }, square: { main: 0.6, p: [0.25, 0.53, 0] }, sine: { main: 0.5, p: [0, 0, 1 / 7] }, filter: { main: 0.35, p: [0.3, 0, 0.3] }, fenv: { main: 0.4, p: [0, 0.5, 0.25] }, amp: { main: 0, p: [0.5, 0.85, 0.25] } } }),
  ] },
  { kind: 'Pads', color: '#a58af5', code: 0x49, presets: [
    S('Warm Pad', { volume: 0.62, cols: { saw: { main: 0.6, p: [0.5, 0.5, 0.35] }, square: { main: 0.5, p: [0.5, 0.45, 0.2] }, sine: { main: 0.4, p: [0.25, 0, 1 / 7] }, filter: { main: 0.42, p: [0.15, 0, 0.3] }, fenv: { main: 0.25, p: [0.75, 0.7, 0.6] }, amp: { main: 0.75, p: [0.6, 0.9, 0.72] }, lfo: { main: 0.12, p: [1, 0, 0.5] } } }),
    S('Dream Pad', { volume: 0.62, cols: { saw: { main: 0.5, p: [0.75, 0.5, 0.6] }, sine: { main: 0.6, p: [0.5, 0.15, 2 / 7] }, noise: { main: 0.12, p: [0.75, 1, 0.3] }, filter: { main: 0.6, p: [0.3, 1 / 3, 0.3] }, fenv: { main: 0.2, p: [0.8, 0.8, 0.5] }, amp: { main: 0.82, p: [0.7, 0.85, 0.82] }, lfo: { main: 0.2, p: [8 / 9, 0, 0.5] } } }),
    S('Strings', { volume: 0.6, cols: { saw: { main: 0.8, p: [0.5, 0.5, 0.45] }, square: { main: 0.25, p: [0.75, 0.52, 0.3] }, filter: { main: 0.55, p: [0.05, 1 / 3, 0.3] }, fenv: { main: 0.15, p: [0.6, 0.6, 0.7] }, amp: { main: 0.65, p: [0.6, 0.9, 0.6] }, lfo: { main: 0.12, p: [3 / 9, 0, 0] } } }),
    S('Organ', { velocity: 0.2, volume: 0.42, cols: { sine: { main: 0.7, p: [0.5, 0, 1 / 7] }, square: { main: 0.3, p: [0.75, 0.5, 0] }, filter: { main: 0.7, p: [0, 1 / 3, 0.3] }, fenv: { on: false }, amp: { on: false }, lfo: { main: 0.1, p: [3 / 9, 0, 0] } } }),
    S('Choir', { volume: 1, cols: { saw: { main: 0.9, p: [0.5, 0.5, 0.4] }, noise: { main: 0.2, p: [0.65, 1, 0.5] }, filter: { main: 0.62, p: [0.15, 2 / 3, 0.3] }, fenv: { on: false }, amp: { main: 0.7, p: [0.6, 0.9, 0.7] }, lfo: { main: 0.1, p: [3 / 9, 0, 0] } } }),
    S('Glass Pad', { volume: 0.42, cols: { sine: { main: 0.8, p: [0.75, 0.3, 3 / 7] }, square: { main: 0.3, p: [0.5, 0.5, 0.4] }, filter: { main: 0.65, p: [0.2, 1 / 3, 0.3] }, fenv: { main: 0.15, p: [0.7, 0.7, 0.5] }, amp: { main: 0.75, p: [0.6, 0.9, 0.75] }, lfo: { main: 0.15, p: [8 / 9, 0, 0.5] } } }),
    S('Dark Pad', { volume: 0.62, cols: { saw: { main: 0.7, p: [0.25, 0.5, 0.5] }, square: { main: 0.5, p: [0.5, 0.47, 0.3] }, filter: { main: 0.32, p: [0.3, 0, 0.2] }, fenv: { main: 0.1, p: [0.8, 0.8, 0.5] }, amp: { main: 0.8, p: [0.6, 0.9, 0.8] }, lfo: { main: 0.2, p: [1, 1 / 3, 0.5] } } }),
    S('Sweep', { volume: 1, cols: { noise: { main: 1, p: [0.85, 1, 0.2] }, saw: { main: 0.4, p: [0.5, 0.5, 0.5] }, filter: { main: 0.55, p: [0.3, 2 / 3, 0] }, fenv: { on: false }, amp: { main: 0.7, p: [0.6, 1, 0.7] }, lfo: { main: 0.45, p: [1, 1 / 3, 0.5] } } }),
  ] },
  { kind: 'Plucks', color: '#6fc3f2', code: 0x13, presets: [
    S('Pluck', { velocity: 0.7, volume: 1, cols: { saw: { main: 0.9 }, square: { main: 0.5, p: [0.75, 0.5, 0] }, filter: { main: 0.55, p: [0.3, 0, 0.4] }, fenv: { main: 0.5, p: [0, 0.55, 0] }, amp: { main: 0, p: [0.7, 0, 0.45] } } }),
    S('E-Piano', { volume: 0.55, velocity: 0.8, cols: { sine: { main: 0.9, p: [0.5, 0.25, 1 / 7] }, filter: { main: 0.55, p: [0, 1 / 3, 0.4] }, fenv: { main: 0.35, p: [0, 0.55, 0.2] }, amp: { main: 0, p: [0.8, 0.15, 0.45] } } }),
    S('Bell', { volume: 0.47, velocity: 0.7, cols: { sine: { main: 0.9, p: [0.75, 0.55, 4 / 7] }, filter: { on: false }, fenv: { on: false }, amp: { main: 0, p: [0.9, 0, 0.75] } } }),
    S('Marimba', { volume: 1, velocity: 0.8, cols: { sine: { main: 0.9, p: [0.5, 0.25, 5 / 7] }, filter: { on: false }, fenv: { on: false }, amp: { main: 0, p: [0.55, 0, 0.35] } } }),
    S('Harp', { velocity: 0.8, cols: { saw: { main: 0.5, p: [0.5, 0.5, 0] }, sine: { main: 0.6, p: [0.5, 0, 1 / 7] }, filter: { main: 0.45, p: [0.1, 1 / 3, 0.5] }, fenv: { main: 0.4, p: [0, 0.6, 0] }, amp: { main: 0, p: [0.75, 0, 0.6] } } }),
    S('Clav', { volume: 1, velocity: 0.9, cols: { square: { main: 1, p: [0.5, 0.5, 0.75] }, filter: { main: 0.72, p: [0.4, 1 / 3, 0.4] }, fenv: { main: 0.45, p: [0, 0.45, 0.1] }, amp: { main: 0, p: [0.6, 0.35, 0.2] } } }),
    S('Kalimba', { volume: 1, velocity: 0.8, cols: { sine: { main: 0.9, p: [0.75, 0.15, 1] }, filter: { on: false }, fenv: { on: false }, amp: { main: 0, p: [0.62, 0, 0.45] } } }),
    S('Stab', { volume: 1, cols: { saw: { main: 0.9, p: [0.5, 0.5, 0.6] }, square: { main: 0.4, p: [0.75, 0.5, 0.2] }, filter: { main: 0.55, p: [0.25, 0, 0.3] }, fenv: { main: 0.5, p: [0, 0.5, 0] }, amp: { main: 0, p: [0.65, 0, 0.35] } } }),
  ] },
];
export const PRESETS = PRESET_ROWS.flatMap(r => r.presets);

export function fromPreset(i) {
  const p = PRESETS[i];
  const cols = {};
  for (const { id } of SYNTH_COLS) {
    const b = BASE.cols[id], o = p.cols?.[id];
    cols[id] = { on: o ? o.on !== false : b.on, main: o?.main ?? b.main, p: [...(o?.p ?? b.p)] };
  }
  return { preset: p.name, edited: false, mode: p.mode ?? BASE.mode, glide: p.glide ?? BASE.glide, velocity: p.velocity ?? BASE.velocity, volume: p.volume ?? BASE.volume, cols };
}
export const defaultSynth = () => fromPreset(0);

// Settings from a project (anything missing gets its default).
export function readSynth(s) {
  const out = defaultSynth();
  if (!s || typeof s !== 'object') return out;
  for (const k of ['preset', 'edited', 'mode', 'glide', 'velocity', 'volume']) if (s[k] != null) out[k] = s[k];
  if (!MODES.includes(out.mode)) out.mode = 'poly';
  for (const { id } of SYNTH_COLS) {
    const c = s.cols?.[id];
    if (c) out.cols[id] = { on: !!c.on, main: c.main ?? out.cols[id].main, p: [0, 1, 2].map(i => c.p?.[i] ?? out.cols[id].p[i]) };
  }
  return out;
}

// ---- the sound --------------------------------------------------------------------------

const MAX_VOICES = 16;                 // per track (poly); the oldest note makes way
const LEVEL = { saw: 0.42, square: 0.4, sine: 0.6, noise: 0.5 };
const OUT = 0.9;                       // the synth's volume at 100%

// Shared per audio context: the square's pulse waves (by width) and a noise loop.
const shared = new WeakMap();
function sharedFor(ctx) {
  let s = shared.get(ctx);
  if (!s) {
    const len = ctx.sampleRate * 2, noise = new AudioBuffer({ numberOfChannels: 2, length: len, sampleRate: ctx.sampleRate });
    for (let ch = 0; ch < 2; ch++) { const d = noise.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1; }
    shared.set(ctx, (s = { waves: new Map(), noise }));
  }
  return s;
}
// A pulse wave of the given duty (0.05-0.5): a saw minus the same saw shifted by the duty.
function pulseWave(ctx, duty) {
  const d = Math.round(duty * 100) / 100, { waves } = sharedFor(ctx);
  if (!waves.has(d)) {
    const N = 256, re = new Float32Array(N), im = new Float32Array(N);
    for (let n = 1; n < N; n++) { const a = 2 / (n * Math.PI); re[n] = a * Math.sin(2 * Math.PI * n * d); im[n] = a * (1 - Math.cos(2 * Math.PI * n * d)); }
    waves.set(d, new PeriodicWave(ctx, { real: re, imag: im }));
  }
  return waves.get(d);
}

// An ADSR on a param, from its current value (so a retrigger doesn't click).
function attack(param, t, a, d, s, peak) {
  param.cancelAndHoldAtTime(t);
  param.linearRampToValueAtTime(peak, t + a);
  param.setTargetAtTime(s * peak, t + a, d / 3);
}

class Voice {
  constructor(syn, note, vel, t, from = null) {
    const ctx = syn.ctx, n = syn.nodes, c = syn.settings.cols;
    Object.assign(this, { syn, ctx, note, vel, t0: t, srcs: [], mods: [], timer: 0, dead: false });
    this.hz = 440 * 2 ** ((note - 69) / 12);
    this.pitch = new ConstantSourceNode(ctx, { offset: from == null ? 0 : (from - note) * 100 });   // cents from `note`
    this.fenv = new ConstantSourceNode(ctx, { offset: 0 });                     // the filter envelope, 0-1
    this.fenvAmt = new GainNode(ctx, { gain: 0 });
    this.f1 = new BiquadFilterNode(ctx);
    this.f2 = new BiquadFilterNode(ctx);
    this.amp = new GainNode(ctx, { gain: 0 });
    this.f1.connect(this.f2).connect(this.amp).connect(n.out);
    this.fenv.connect(this.fenvAmt);
    for (const f of [this.f1, this.f2]) { this.fenvAmt.connect(f.detune); this.mod(n.filterLfo, f.detune); }
    this.start(this.pitch, t);
    this.start(this.fenv, t);
    const osc = (type, gainNode) => {
      const o = new OscillatorNode(ctx, { type, frequency: this.hz });
      this.pitch.connect(o.detune);
      this.mod(n.pitchLfo, o.detune);
      if (gainNode) o.connect(gainNode);
      this.start(o, t);
      return o;
    };
    // Oscillators: each into its own level, then the filter. Only the ones on when the note starts.
    this.o = {};
    if (c.saw.on) {
      const g = new GainNode(ctx, { gain: 0 }), side = new GainNode(ctx, { gain: 0 });
      side.connect(g);
      this.o.saw = { g, side, oscs: [osc('sawtooth', g), osc('sawtooth', side), osc('sawtooth', side)] };
    }
    if (c.square.on) {
      const g = new GainNode(ctx, { gain: 0 }), o = osc('sine', g);
      this.o.square = { g, o, duty: null };
    }
    if (c.sine.on) {
      const g = new GainNode(ctx, { gain: 0 }), car = osc('sine', g), mod = osc('sine'), fm = new GainNode(ctx, { gain: 0 });
      mod.connect(fm).connect(car.frequency);
      this.o.sine = { g, car, mod, fm };
    }
    if (c.noise.on) {
      const g = new GainNode(ctx, { gain: 0 }), env = new GainNode(ctx, { gain: 1 }), f = new BiquadFilterNode(ctx, { type: 'lowpass' });
      const src = new AudioBufferSourceNode(ctx, { buffer: sharedFor(ctx).noise, loop: true });
      src.connect(f).connect(env).connect(g);
      src.start(t, Math.random() * 1.9);
      this.srcs.push(src);
      const [, dv] = c.noise.p;
      if (dv < 0.98) { env.gain.setValueAtTime(1, t); env.gain.setTargetAtTime(0, t, noiseDecayT(dv) / 3); }
      this.o.noise = { g, f };
    }
    for (const k in this.o) this.o[k].g.connect(this.f1);
    this.apply(true);
    if (from != null) this.glideTo(note, t);
    this.trigger(t, vel);
  }

  start(node, t) { node.start(t); this.srcs.push(node); }
  mod(src, param) { src.connect(param); this.mods.push([src, param]); }

  // Everything but the envelopes, from the settings: when the note starts (`first`: set at once)
  // and whenever a control is turned (a short glide, so turning doesn't zip).
  apply(first = false) {
    const s = this.syn.settings, c = s.cols, now = this.ctx.currentTime;
    const set = first ? (p, v) => { p.value = v; } : (p, v) => p.setTargetAtTime(v, now, 0.02);
    const lvl = id => (c[id].on ? c[id].main : 0) * LEVEL[id];
    const { saw, square, sine, noise } = this.o;
    if (saw) {
      const [o, d, spread] = c.saw.p, hz = this.hz * 2 ** octaveOf(o), cents = centsOf(d);
      set(saw.g.gain, lvl('saw'));
      set(saw.side.gain, Math.min(1, spread * 6) * 0.75);
      saw.oscs.forEach((x, i) => { set(x.frequency, hz); set(x.detune, cents + [0, -1, 1][i] * spread * 35); });
    }
    if (square) {
      const [o, d, w] = c.square.p, duty = Math.round(dutyOf(w) * 100) / 100;
      set(square.g.gain, lvl('square'));
      set(square.o.frequency, this.hz * 2 ** octaveOf(o));
      set(square.o.detune, centsOf(d));
      if (duty !== square.duty) { square.o.setPeriodicWave(pulseWave(this.ctx, duty)); square.duty = duty; }
    }
    if (sine) {
      const [o, fm, r] = c.sine.p, hz = this.hz * 2 ** octaveOf(o), mhz = hz * step(RATIOS, r);
      set(sine.g.gain, lvl('sine'));
      set(sine.car.frequency, hz);
      set(sine.mod.frequency, mhz);
      set(sine.fm.gain, fmIndex(fm) * mhz);
    }
    if (noise) {
      const [col, , res] = c.noise.p;
      set(noise.g.gain, lvl('noise'));
      set(noise.f.frequency, colourHz(col));
      set(noise.f.Q, resDb(res * 0.8));
    }
    // Filter: LP 24 is two lowpasses (the second resonant); the others use the first and leave
    // the second flat (an allpass). Off: both flat.
    const f = c.filter, [res, typeV, key] = f.p, type = Math.round(typeV * 3);
    const t1 = !f.on ? 'allpass' : ['lowpass', 'lowpass', 'bandpass', 'highpass'][type], t2 = f.on && type === 0 ? 'lowpass' : 'allpass';
    if (this.f1.type !== t1) this.f1.type = t1;
    if (this.f2.type !== t2) this.f2.type = t2;
    const hz = f.on ? cutoffHz(f.main) : 20000, track = f.on ? key * (this.note - 60) * 100 : 0;
    set(this.f1.frequency, hz);
    set(this.f2.frequency, hz);
    set(this.f1.detune, track);
    set(this.f2.detune, track);
    set(this.f1.Q, type === 0 ? -3 : type === 2 ? 0.5 + 12 * res * res : resDb(res));
    set(this.f2.Q, resDb(res));
    const velScale = 1 - s.velocity + s.velocity * (this.vel / 127);
    set(this.fenvAmt.gain, f.on && c.fenv.on ? c.fenv.main * 7200 * velScale : 0);
  }

  // The envelopes' shapes now (amp off = a plain gate).
  envs() {
    const s = this.syn.settings, c = s.cols;
    const a = c.amp.on ? { a: attackT(c.amp.main), d: decayT(c.amp.p[0]), s: c.amp.p[1], r: releaseT(c.amp.p[2]) } : { a: 0.003, d: 1, s: 1, r: 0.03 };
    const f = { a: attackT(c.fenv.p[0]), d: decayT(c.fenv.p[1]), s: c.fenv.p[2] };
    return { a, f };
  }

  // Start (or restart, in mono) the envelopes at t.
  trigger(t, vel) {
    clearTimeout(this.timer);
    this.released = false;
    this.vel = vel;
    const s = this.syn.settings, { a, f } = this.envs();
    const peak = 1 - s.velocity + s.velocity * (vel / 127) ** 1.2;
    attack(this.amp.gain, t, a.a, a.d, a.s, peak);
    attack(this.fenv.offset, t, f.a, f.d, f.s, 1);
    this.apply();                                        // velocity sets the filter env's depth
  }

  // Mono: carry on holding (a newer note took over before this one was let go).
  hold(t) {
    clearTimeout(this.timer);
    this.released = false;
    const { a, f } = this.envs(), peak = this.amp.gain.value || 1;
    this.amp.gain.cancelAndHoldAtTime(t);
    this.amp.gain.setTargetAtTime(Math.max(a.s * peak, 0.0001), t, a.d / 3);
    this.fenv.offset.cancelAndHoldAtTime(t);
    this.fenv.offset.setTargetAtTime(f.s, t, f.d / 3);
  }

  // Slide (or jump, without glide) to another note.
  glideTo(note, t) {
    const g = this.syn.settings.glide, cents = (note - this.note) * 100;
    this.pitch.offset.cancelAndHoldAtTime(t);
    if (g < 0.01) this.pitch.offset.setValueAtTime(cents, t);
    else this.pitch.offset.setTargetAtTime(cents, t, glideT(g) / 3);
  }

  release(at) {
    if (this.dead) return;
    const r = this.envs().a.r;
    this.released = true;
    this.amp.gain.cancelAndHoldAtTime(at);
    this.amp.gain.setTargetAtTime(0, at, r / 4);
    this.fenv.offset.cancelAndHoldAtTime(at);
    this.fenv.offset.setTargetAtTime(0, at, r / 4);
    this.endAt(at + r * 1.4 + 0.05);
  }

  kill(now) {
    if (this.dead) return;
    this.amp.gain.cancelAndHoldAtTime(now);
    this.amp.gain.setTargetAtTime(0, now, 0.008);
    this.endAt(now + 0.06);
  }

  endAt(t) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.end(), Math.max(0, (t - this.ctx.currentTime) * 1000));
  }

  end() {
    if (this.dead) return;
    this.dead = true;
    for (const s of this.srcs) { try { s.stop(); } catch {} }
    for (const [src, param] of this.mods) { try { src.disconnect(param); } catch {} }
    this.amp.disconnect();
    this.onDone?.();
  }
}

// One track's synth: its settings, the LFO its voices share, and the notes sounding.
export class TrackSynth {
  constructor(ctx, dest) {
    Object.assign(this, { ctx, dest, bpm: 120, nodes: null, voices: new Set(), mono: null, held: [], current: null, lastNote: null });
    this.settings = defaultSynth();
  }

  // Made on the first note.
  build() {
    if (this.nodes) return;
    const ctx = this.ctx;
    const out = new GainNode(ctx, { gain: 0 }), trem = new GainNode(ctx, { gain: 1 });
    out.connect(trem).connect(this.dest);
    const lfo = new OscillatorNode(ctx, { frequency: 2 });
    const pitchLfo = new GainNode(ctx, { gain: 0 }), filterLfo = new GainNode(ctx, { gain: 0 }), ampLfo = new GainNode(ctx, { gain: 0 });
    lfo.connect(pitchLfo);
    lfo.connect(filterLfo);
    lfo.connect(ampLfo).connect(trem.gain);
    lfo.start();
    this.nodes = { out, trem, lfo, pitchLfo, filterLfo, ampLfo };
    this.apply();
  }

  set(settings) { this.settings = settings; this.apply(); }
  setTempo(bpm) { if (bpm !== this.bpm) { this.bpm = bpm; this.apply(); } }

  apply() {
    const n = this.nodes;
    if (!n) return;
    const s = this.settings, l = s.cols.lfo, now = this.ctx.currentTime;
    const ramp = (p, v) => p.setTargetAtTime(v, now, 0.02);
    ramp(n.out.gain, OUT * s.volume);
    const [rate, shape, destV] = l.p, dest = Math.round(destV * 2), depth = l.on ? l.main : 0;
    const type = LFO_TYPES[Math.round(shape * 3)];
    if (n.lfo.type !== type) n.lfo.type = type;
    ramp(n.lfo.frequency, this.bpm / 60 / step(LFO_RATES, rate).beats);
    ramp(n.pitchLfo.gain, dest === 0 ? 1200 * depth ** 3 : 0);            // vibrato: fine at the bottom of the knob
    ramp(n.filterLfo.gain, dest === 1 ? 4800 * depth : 0);
    ramp(n.ampLfo.gain, dest === 2 ? depth / 2 : 0);
    ramp(n.trem.gain, dest === 2 ? 1 - depth / 2 : 1);
    for (const v of this.voices) v.apply();
  }

  // A note: (ctx, dest, note, vel, t, onEnd) -> { release(at), kill(now) }, as the engine expects.
  voice(note, vel, t, onEnd) {
    this.build();
    if (this.settings.mode !== 'poly') return this.monoNote(note, vel, t, onEnd);
    if (this.mono) { this.mono.kill(t); this.mono = null; }
    if (this.voices.size >= MAX_VOICES) [...this.voices].reduce((a, b) => (a.t0 <= b.t0 ? a : b)).kill(t);
    const v = new Voice(this, note, vel, t);
    this.voices.add(v);
    v.onDone = () => { this.voices.delete(v); onEnd(); };
    return { release: at => v.release(Math.max(at, t + 0.005)), kill: now => v.kill(now) };
  }

  // Mono and legato: one voice. A new note takes it over (gliding there if Glide is up); in
  // legato, a note played while another is held doesn't restart the envelopes. Letting go of the
  // newest note goes back to one still held.
  monoNote(note, vel, t, onEnd) {
    const h = { note, vel, on: t, off: Infinity, onEnd, ended: false };
    const finish = x => { if (!x.ended) { x.ended = true; x.onEnd(); } };
    for (const x of this.held) if (x.off <= t && x !== this.current) finish(x);
    this.held = this.held.filter(x => !x.ended);
    const prev = this.current, overlap = !!prev && prev.off > t;
    let v = this.mono;
    if (v && !v.dead) {
      v.glideTo(note, t);
      if (this.settings.mode === 'legato' && overlap) v.hold(t); else v.trigger(t, vel);
    } else {
      for (const x of this.voices) x.kill(t);                   // poly notes from before a switch
      v = this.mono = new Voice(this, note, vel, t, this.settings.glide >= 0.01 ? this.lastNote : null);
      this.voices.add(v);
      v.onDone = () => {
        this.voices.delete(v);
        if (this.mono === v) { this.mono = null; this.current = null; this.held.forEach(finish); this.held = []; }
      };
    }
    this.held.push(h);
    this.current = h;
    this.lastNote = note;
    return { release: at => this.monoRelease(h, Math.max(at, t + 0.005)), kill: now => { finish(h); this.mono?.kill(now); } };
  }

  monoRelease(h, at) {
    h.off = at;
    if (this.current !== h || !this.mono) return;          // a newer note has the voice
    const back = this.held.filter(x => x !== h && x.on <= at && x.off > at).at(-1);
    if (back) {                                            // an older note is still down: back to it
      this.current = back;
      this.mono.glideTo(back.note, at);
      this.mono.hold(at);
      if (back.off !== Infinity) this.monoRelease(back, back.off);
      return;
    }
    this.mono.release(at);
  }
}

// The instrument: one for all tracks, each playing its own TrackSynth (audio.synth[track]).
export function registerSynth(audio) {
  INSTRUMENTS[SYNTH_KEY] = {
    name: 'Synth', color: SYNTH_COLOR, synth: true, octave: 3,
    voice: (ctx, dest, note, vel, t, onEnd) => audio.synth[audio.bus.indexOf(dest)].voice(note, vel, t, onEnd),
  };
}
