// The instrument registry. Every sound is added at run time, keyed by kind:
//   "smp:<name>"    sampled instruments (sampler.js): built-in ones and your own
//   "kit:<name>"    16-pad sample kits (kits.js)
//   "audio:<name>"  audio instruments, an audio input (audioinst.js)
//   "midi:<name>"   MIDI instruments, played over MIDI (midiinst.js)
// A definition has { name, color, octave?, voice?(ctx, dest, note, vel, time, onEnd) } plus its kind's
// flag (sampled / kit / audio / midi). `octave` is where the keyboard starts for it.

export const INSTRUMENTS = {};

// What the retired synthesised sounds became (for projects that used them).
export const RETIRED = {
  synth: 'smp:Grand Piano', keys: 'smp:Grand Piano', organ: 'smp:Grand Piano', bass: 'smp:Upright Bass',
  pad: 'smp:Cello', pluck: 'smp:Harp', bell: 'smp:Vibraphone',
};

// ---- drum kit ---------------------------------------------------------------
// 16 pads, in playing order: pads 1-8 are the bottom row (on the Circuit and on screen), 9-16 the
// row above. Each plays its General MIDI drum note, so parts played in from a MIDI kit land on
// the right sound. Notes outside the kit fold onto the GM octave from C1 (36), any octave.

export const KIT = [
  { note: 36, name: 'Kick' }, { note: 38, name: 'Snare' }, { note: 39, name: 'Clap' }, { note: 37, name: 'Rim' },
  { note: 42, name: 'Closed HH', short: 'CH' }, { note: 44, name: 'Pedal HH', short: 'Pedal' },
  { note: 46, name: 'Open HH', short: 'OH' }, { note: 40, name: 'Snare 2', short: 'Snr 2' },
  { note: 41, name: 'Tom 1' }, { note: 43, name: 'Tom 2' }, { note: 45, name: 'Tom 3' }, { note: 47, name: 'Tom 4' },
  { note: 49, name: 'Crash' }, { note: 51, name: 'Ride' }, { note: 54, name: 'Tambourine', short: 'Tamb' },
  { note: 56, name: 'Cowbell', short: 'Bell' },
];
for (const p of KIT) p.short ??= p.name;
// The kit pad (0-15) a note plays.
export function kitPad(note) {
  const i = KIT.findIndex(p => p.note === note);
  if (i >= 0) return i;
  const gm = 36 + ((((note - 36) % 12) + 12) % 12);           // fold onto 36-47
  return KIT.findIndex(p => p.note === gm);
}
