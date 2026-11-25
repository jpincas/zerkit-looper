// Kits: 16 samples on the 16 kit pads. A kit plays like the built-in Drums (same pads, same GM
// notes), so a drum part can move between kits.
//
// Kits live in the projects folder, in "Kits", one folder each, with the samples copied in:
//
//   Kits/My Kit.zkit/
//     kit.json          { format, version, name, pads: [{ file, label } | null] x 16 }
//     samples/*         the original files' bytes (WAV, AIFF, MP3, M4A, FLAC ...)
//
// Each kit loaded becomes an instrument, "kit:<name>", in INSTRUMENTS.
import { INSTRUMENTS, KIT, kitPad } from './instruments.js';

const FOLDER = 'Kits', EXT = '.zkit', FORMAT = 'zerkit-kit', VERSION = 1;
export const PADS = KIT.length;
const COLORS = ['#e8795a', '#5ab8e8', '#d9b84a', '#9a7ef0', '#5fd39a', '#e86fb0', '#7fd0d6', '#c7d46a'];

export const kitKey = name => `kit:${name}`;
export const isKitKey = key => key.startsWith('kit:');
const colorFor = name => COLORS[[...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % COLORS.length];

// One-shot sample voice: the pad's sample, scaled by velocity. Empty pads are silent.
function sampleVoice(buffers) {
  return (ctx, dest, note, vel, t, onEnd) => {
    const buffer = buffers[kitPad(note)];
    if (!buffer) { queueMicrotask(onEnd); return { release() {}, kill() {} }; }
    const src = new AudioBufferSourceNode(ctx, { buffer });
    const g = new GainNode(ctx, { gain: vel / 127 });
    src.connect(g).connect(dest);
    src.onended = () => { g.disconnect(); onEnd(); };
    src.start(t);
    return { release() {}, kill(now) { try { src.stop(now); } catch {} } };
  };
}

// Make (or replace) the instrument for a kit: { name, pads: [{ label, buffer } | null], builtIn? }.
export function registerKit(kit) {
  INSTRUMENTS[kitKey(kit.name)] = {
    name: kit.name,
    color: colorFor(kit.name),
    drums: true,
    kit: true,
    builtIn: !!kit.builtIn,
    padNames: kit.pads.map(p => p?.label ?? ''),
    padShort: kit.pads.map(p => (p ? abbreviate(p.label) : '')),
    voice: sampleVoice(kit.pads.map(p => p?.buffer ?? null)),
  };
}

// Short names for the piano roll's labels: "Low Tom Muted" -> "LT Mut", "Closed HH" -> "CH",
// "Ride Bell" -> "Rd Bl". Known drum words get their usual abbreviation; one-letter parts run
// together (L + T -> LT); other words keep their first four letters.
const ABBR = {
  kick: 'K', snare: 'Sn', clap: 'Clp', rim: 'Rim', rimshot: 'Rim', sidestick: 'XS', cross: 'X', stick: 'S',
  closed: 'C', open: 'O', pedal: 'P', foot: 'F', hh: 'H', hat: 'H', hihat: 'HH', tom: 'T', floor: 'F',
  low: 'L', high: 'H', mid: 'M', crash: 'Cr', ride: 'Rd', bell: 'Bl', flat: 'Fl', splash: 'Spl', china: 'Chn',
  tambourine: 'Tamb', cowbell: 'Cowb', shaker: 'Shk', muted: 'Mut', edge: 'Edg', brush: 'Br', stir: 'Stir',
  dig: 'Dig', conga: 'Cga', tumba: 'Tmb', bongo: 'Bgo', timbale: 'Timb', woodblock: 'WBlk', claves: 'Clv',
  agogo: 'Agg', guiro: 'Gro', cabasa: 'Cab', triangle: 'Tri', darbuka: 'Darb', cajon: 'Caj', snap: 'Snp',
};
export function abbreviate(label) {
  const parts = label.split(/[\s_-]+/).filter(Boolean).map(w => ABBR[w.toLowerCase()] ?? (/^\d+$/.test(w) ? w : w.slice(0, 4)));
  let out = '';
  parts.forEach((p, i) => {
    const glue = i > 0 && p.length === 1 && parts[i - 1].length === 1;
    const num = i > 0 && /^\d/.test(p) && parts[i - 1].length <= 2;
    out += i === 0 || glue || num ? p : ` ${p}`;
  });
  return out.length > 1 ? out.slice(0, 8) : label.slice(0, 4);      // never a lone letter: "Kick", not "K"
}

// A pad's label from its file name: "03 Snare Tight.wav" -> "Snare Tight".
export const labelFor = fileName => fileName.replace(/\.[^.]+$/, '').replace(/^[\d\s._-]+(?=\D)/, '').slice(0, 40) || fileName;

// Built-in kits: shipped with the app in kits/ (see tools/build_kits.py), listed in kits/index.json.
// Their pads keep the sample bytes, so editing one and saving makes your own copy.
export async function loadBuiltInKits(ctx, base = 'kits/') {
  const names = await (await fetch(base + 'index.json')).json();
  return Promise.all(names.map(async name => {
    const dir = `${base}${encodeURIComponent(name)}${EXT}/`;
    const json = await (await fetch(dir + 'kit.json')).json();
    const pads = await Promise.all(json.pads.map(async p => {
      if (!p) return null;
      try {
        const bytes = await (await fetch(dir + 'samples/' + encodeURIComponent(p.file))).arrayBuffer();
        return { label: p.label, bytes, ext: p.file.split('.').pop(), buffer: await ctx.decodeAudioData(bytes.slice(0)) };
      } catch { return null; }
    }));
    while (pads.length < PADS) pads.push(null);
    return { name: json.name ?? name, pads, builtIn: true };
  }));
}

export class KitStore {
  constructor(projects) { this.projects = projects; }

  async folder(create = false) {
    try { return await this.projects.root.getDirectoryHandle(FOLDER, { create }); } catch { return null; }
  }

  async names() {
    const dir = await this.folder();
    if (!dir) return [];
    const out = [];
    for await (const [entry, h] of dir.entries()) if (h.kind === 'directory' && entry.endsWith(EXT)) out.push(entry.slice(0, -EXT.length));
    return out.sort((a, b) => a.localeCompare(b));
  }

  async exists(name) {
    const dir = await this.folder();
    try { await dir?.getDirectoryHandle(name + EXT); return !!dir; } catch { return false; }
  }

  // { name, pads: [{ label, file, ext, bytes, buffer } | null] }
  async load(name, ctx) {
    const dir = await (await this.folder()).getDirectoryHandle(name + EXT);
    const json = JSON.parse(await (await (await dir.getFileHandle('kit.json')).getFile()).text());
    if (json.format !== FORMAT) throw new Error(`“${name}” is not a kit`);
    const samples = await dir.getDirectoryHandle('samples', { create: true });
    const pads = await Promise.all(json.pads.map(async p => {
      if (!p) return null;
      try {
        const bytes = await (await (await samples.getFileHandle(p.file)).getFile()).arrayBuffer();
        return { label: p.label, file: p.file, buffer: await ctx.decodeAudioData(bytes.slice(0)) };
      } catch { return null; }                 // a missing or unreadable sample: an empty pad
    }));
    while (pads.length < PADS) pads.push(null);
    return { name: json.name ?? name, pads };
  }

  // Pads with `bytes` are new samples to copy in; ones with `file` are already in this kit's folder
  // (or, when saving under a new name, in `from`'s folder).
  async save(kit, from = null) {
    const dir = await (await this.folder(true)).getDirectoryHandle(kit.name + EXT, { create: true });
    const samples = await dir.getDirectoryHandle('samples', { create: true });
    const fromSamples = from && from !== kit.name
      ? await (await (await this.folder()).getDirectoryHandle(from + EXT)).getDirectoryHandle('samples') : null;
    const pads = [];
    for (const p of kit.pads) {
      if (!p) { pads.push(null); continue; }
      let file = p.file;
      if (p.bytes) {
        file = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}.${p.ext || 'wav'}`;
        await write(await samples.getFileHandle(file, { create: true }), p.bytes);
      } else if (fromSamples) {
        const bytes = await (await (await fromSamples.getFileHandle(file)).getFile()).arrayBuffer();
        await write(await samples.getFileHandle(file, { create: true }), bytes);
      }
      p.file = file;
      delete p.bytes;
      pads.push({ file, label: p.label });
    }
    const keep = new Set(pads.filter(Boolean).map(p => p.file));
    for await (const [f] of samples.entries()) if (!keep.has(f)) await samples.removeEntry(f);
    await write(await dir.getFileHandle('kit.json', { create: true }), JSON.stringify({ format: FORMAT, version: VERSION, name: kit.name, pads }, null, 1));
  }
}

async function write(fileHandle, data) {
  const w = await fileHandle.createWritable();
  await w.write(data);
  await w.close();
}
