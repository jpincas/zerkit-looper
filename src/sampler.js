// Sampled instruments: recorded notes ("zones") played across the keyboard. A note plays the zone
// that covers it in its velocity layer, re-pitched from the zone's root note, with a short fade-in
// and the instrument's release when let go. Each one is an instrument "smp:<name>" in INSTRUMENTS.
// Samples load the first time an instrument is used (or chosen for a track).
//
// Built-in ones ship in instruments/ (tools/build_instruments.py); your own live in the projects
// folder, in Instruments/<name>.zinst (instrument.json + samples/*.wav), made by the sampler or from
// dropped files.
import { INSTRUMENTS } from './instruments.js';

const EXT = '.zinst', FOLDER = 'Instruments', FORMAT = 'zerkit-instrument';
export const samplerKey = name => `smp:${name}`;
const COLORS = ['#e8c26a', '#d0805a', '#7fc4e0', '#c7b7f0', '#9ad06a', '#f08ad0'];
const colorFor = name => COLORS[[...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 11) % COLORS.length];
const LEVEL = 1.4;                                  // against the kits (samples peak at -1 dBFS)

function pickZone(zones, note, vel) {
  const inVel = zones.filter(z => vel >= z.velLo && vel <= z.velHi);
  const pool = inVel.length ? inVel : zones;
  return pool.find(z => note >= z.lo && note <= z.hi)
    ?? pool.reduce((best, z) => (!best || Math.abs(z.root - note) < Math.abs(best.root - note) ? z : best), null);
}

function samplerVoice(def) {
  return (ctx, dest, note, vel, t, onEnd) => {
    def.load();
    const z = pickZone(def.zones, note, vel);
    if (!z?.buffer) { queueMicrotask(onEnd); return { release() {}, kill() {} }; }
    const src = new AudioBufferSourceNode(ctx, { buffer: z.buffer, playbackRate: 2 ** ((note - z.root) / 12) });
    const g = new GainNode(ctx, { gain: 0 });
    const peak = LEVEL * (0.25 + 0.75 * (vel / 127) ** 1.5);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.004);
    src.connect(g).connect(dest);
    src.start(t);
    src.onended = () => { g.disconnect(); onEnd(); };
    const fade = (at, r) => {
      g.gain.cancelScheduledValues(at);
      g.gain.setValueAtTime(g.gain.value || peak, at);
      g.gain.setTargetAtTime(0, at, r / 4);
      try { src.stop(at + r * 1.5); } catch {}
    };
    return { release: at => fade(Math.max(at, t + 0.01), def.release), kill: now => fade(now, 0.02) };
  };
}

// Make (or replace) the instrument. zones: [{ root, lo, hi, velLo, velHi, buffer?, fetch?() -> bytes }]
export function registerSampler({ name, color, octave = 4, release = 0.5, zones, builtIn = false, decode }) {
  const def = {
    name, color: color ?? colorFor(name), octave, release, zones, builtIn, sampled: true,
    loaded: null,
    load() {
      return (def.loaded ??= Promise.all(zones.map(async z => {
        if (z.buffer || !z.fetch) return;
        try { z.bytes = await z.fetch(); z.buffer = await decode(z.bytes.slice(0)); } catch (err) { console.warn('sample', name, err); }
      })));
    },
  };
  def.voice = samplerVoice(def);
  INSTRUMENTS[samplerKey(name)] = def;
  return def;
}

// The built-in ones: their descriptions now, their samples when first used.
export async function registerBuiltInInstruments(ctx, base = 'instruments/') {
  const names = await (await fetch(base + 'index.json')).json();
  const dirs = names.map(name => `${base}${encodeURIComponent(name)}${EXT}/`);
  const jsons = await Promise.all(dirs.map(async dir => (await fetch(dir + 'instrument.json')).json()));
  jsons.forEach((json, i) => registerSampler({          // in index order, so menus keep it
    ...json, builtIn: true, decode: b => ctx.decodeAudioData(b),
    zones: json.zones.map(z => ({ ...z, fetch: async () => (await fetch(dirs[i] + 'samples/' + encodeURIComponent(z.file))).arrayBuffer() })),
  }));
}

// Note names for the editor: 60 -> "C4".
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const noteName = n => `${NAMES[n % 12]}${Math.floor(n / 12) - 1}`;
// "Piano_A#3.wav", "moog-Bb2", "C4 soft" -> MIDI note, or null.
export function noteFromName(file) {
  const m = file.replace(/\.[^.]+$/, '').match(/(?:^|[^A-Za-z])([A-Ga-g])([#sb]?)(-?\d)(?!\d)/);
  if (!m) return null;
  const n = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 }[m[1].toLowerCase()] + ({ '#': 1, s: 1, b: -1 }[m[2]] ?? 0);
  return 12 * (Number(m[3]) + 1) + n;
}

// Spread zones across the keyboard: each covers from halfway to the root below to halfway to the
// next one, per velocity layer. zones: [{ root, layer }] (layer 0 = softest), with `layers` in all.
export function spreadZones(zones, layers) {
  for (let l = 0; l < layers; l++) {
    const zs = zones.filter(z => (z.layer ?? 0) === l).sort((a, b) => a.root - b.root);
    zs.forEach((z, i) => {
      z.lo = i === 0 ? 0 : Math.floor((zs[i - 1].root + z.root) / 2) + 1;
      z.hi = i === zs.length - 1 ? 127 : Math.floor((z.root + zs[i + 1].root) / 2);
      z.velLo = 1 + Math.floor((l * 127) / layers);
      z.velHi = Math.floor(((l + 1) * 127) / layers);
    });
  }
  return zones;
}

// 16-bit WAV (what the browser can write; our own instruments are kept as WAV).
export function wav16(buffer) {
  const ch = buffer.numberOfChannels, len = buffer.length, sr = buffer.sampleRate, bytes = 44 + len * ch * 2;
  const v = new DataView(new ArrayBuffer(bytes));
  const str = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF'); v.setUint32(4, bytes - 8, true); str(8, 'WAVE'); str(12, 'fmt '); v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); v.setUint16(22, ch, true); v.setUint32(24, sr, true); v.setUint32(28, sr * ch * 2, true);
  v.setUint16(32, ch * 2, true); v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, len * ch * 2, true);
  const chans = [...Array(ch)].map((_, c) => buffer.getChannelData(c));
  for (let i = 0, o = 44; i < len; i++) for (let c = 0; c < ch; c++, o += 2) v.setInt16(o, Math.max(-1, Math.min(1, chans[c][i])) * 0x7FFF, true);
  return v.buffer;
}

// Your own instruments, in the projects folder.
export class InstrumentStore {
  constructor(projects) { this.projects = projects; }
  async folder(create = false) { try { return await this.projects.root.getDirectoryHandle(FOLDER, { create }); } catch { return null; } }
  async names() {
    const dir = await this.folder();
    if (!dir) return [];
    const out = [];
    for await (const [entry, h] of dir.entries()) if (h.kind === 'directory' && entry.endsWith(EXT)) out.push(entry.slice(0, -EXT.length));
    return out.sort((a, b) => a.localeCompare(b));
  }
  async exists(name) { const d = await this.folder(); try { await d?.getDirectoryHandle(name + EXT); return !!d; } catch { return false; } }
  // Register one from its folder (samples load when it's first used).
  async register(name, ctx) {
    const dir = await (await this.folder()).getDirectoryHandle(name + EXT);
    const json = JSON.parse(await (await (await dir.getFileHandle('instrument.json')).getFile()).text());
    if (json.format !== FORMAT) throw new Error(`“${name}” is not an instrument`);
    const samples = await dir.getDirectoryHandle('samples');
    return registerSampler({
      ...json, decode: b => ctx.decodeAudioData(b),
      zones: json.zones.map(z => ({ ...z, fetch: async () => (await (await samples.getFileHandle(z.file)).getFile()).arrayBuffer() })),
    });
  }
  // zones: [{ root, lo, hi, velLo, velHi, buffer }]
  async save({ name, octave, release, zones }) {
    const dir = await (await this.folder(true)).getDirectoryHandle(name + EXT, { create: true });
    const samples = await dir.getDirectoryHandle('samples', { create: true });
    for await (const [f] of samples.entries()) await samples.removeEntry(f);
    const out = [];
    for (const [i, z] of zones.entries()) {
      const file = `${String(i + 1).padStart(2, '0')}-${noteName(z.root).replace('#', 's')}-v${z.velLo}.wav`;
      const w = await (await samples.getFileHandle(file, { create: true })).createWritable();
      await w.write(wav16(z.buffer));
      await w.close();
      out.push({ file, root: z.root, lo: z.lo, hi: z.hi, velLo: z.velLo, velHi: z.velHi });
    }
    const w = await (await dir.getFileHandle('instrument.json', { create: true })).createWritable();
    await w.write(JSON.stringify({ format: FORMAT, version: 1, name, octave, release, zones: out }, null, 1));
    await w.close();
  }
}
