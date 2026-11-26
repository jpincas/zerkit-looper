import { Engine } from './engine.js';
import { AudioOut } from './audio.js';
import { KEYS, NOTE_NAMES, isBlack, keyLetter } from './keys.js';
import { INSTRUMENTS, KIT, kitPad } from './instruments.js';
import { drawRoll } from './roll.js';
import { connectCircuit } from './circuit.js';
import { AudioInputs } from './audioin.js';
import { connectMidiKeyboards } from './midiin.js';
import { setupSession } from './session.js';
import { setupKitPage } from './kitpage.js';
import { registerBuiltInKits } from './kits.js';
import { registerBuiltInInstruments } from './sampler.js';
import { setupInstrumentPage } from './instpage.js';
import { setupAudioInstruments } from './audioinst.js';
import { setupMidiInstruments } from './midiinst.js';
import { cardPage, tracksUsing } from './cards.js';
import { setupFxPage } from './fxpage.js';
import { PEDALS } from './fx.js';
import { registerSynth, SYNTH_KEY } from './synth.js';
import { setupSynthPage } from './synthpage.js';
import { setupSettings } from './settings.js';
import { setupFirmware } from './firmware.js';
import { drawMini } from './mini.js';
import { setupMonitor } from './monitor.js';
import { setupTour } from './tour.js';

const TRACKS = 8;
const audio = new AudioOut(TRACKS);

// The built-in kits (their samples keep loading in the background).
let builtInKits = [];
try { builtInKits = (await registerBuiltInKits(audio.ctx)).kits; } catch (err) { console.warn('built-in kits', err); }
// The built-in sampled instruments (their samples load when first used).
try { await registerBuiltInInstruments(audio.ctx); } catch (err) { console.warn('built-in instruments', err); }

// One per track, laid out like the Circuit's track buttons: Synth 1-2, MIDI 1-2, Drum 1-4.
// Separate drum tracks let drum parts have their own loop lengths (1-bar kick, 2-bar hats...).
const DEFAULT_KIT = INSTRUMENTS['kit:Acoustic'] ? 'kit:Acoustic' : Object.keys(INSTRUMENTS).find(k => INSTRUMENTS[k].kit);
// Melodic tracks start on built-in sampled instruments (or the first there is, if one's missing).
const FIRST_INSTRUMENT = Object.keys(INSTRUMENTS).find(k => INSTRUMENTS[k].sampled);
const have = key => (INSTRUMENTS[key] ? key : FIRST_INSTRUMENT);
const DEFAULTS = [have('smp:Grand Piano'), have('smp:Upright Bass'), have('smp:Vibraphone'), have('smp:Cello'), DEFAULT_KIT, DEFAULT_KIT, DEFAULT_KIT, DEFAULT_KIT];
DEFAULTS.forEach((inst, t) => { audio.instruments[t] = inst; INSTRUMENTS[inst]?.load?.(); });
const engine = new Engine(audio, TRACKS);
setInterval(() => engine.tick(), 25);

const $ = id => document.getElementById(id);

// Pages: the pad area shows the Looper, or the Instruments or Kits page.
let page = 'looper';
// Instruments (melodic) the Instrument button cycles through (all to start with). Saved per project.
const presetOn = Object.fromEntries(Object.keys(INSTRUMENTS).filter(k => !INSTRUMENTS[k].kit && !INSTRUMENTS[k].audio && !INSTRUMENTS[k].midi).map(k => [k, true]));
// The synth: one instrument, each track with its own settings (audio.synth[t]). Not in Instrument's cycle.
registerSynth(audio);
// MIDI instruments the MIDI button cycles through ("midi:<name>" -> on/off). Saved per project.
const midiOn = {};
// Audio instruments the Audio button cycles through ("audio:<name>" -> on/off). Saved per project.
const audioOn = {};
// Kits the Kits button cycles through ("kit:<name>" -> on/off; kits start on). Saved per project.
const kitOn = {};
const clamp01 = v => Math.max(0, Math.min(1, v));
const inst = t => INSTRUMENTS[audio.instruments[t]];
const isDrums = t => !!inst(t).drums;
const isAudio = t => !!inst(t).audio;
const isMidi = t => !!inst(t).midi;
const isSynth = t => !!inst(t).synth;
// What a track button shows: the instrument, or on a synth track its preset.
const nameOf = t => (isSynth(t) ? audio.synth[t].settings.preset : inst(t).name);

// ---- keyboard octave (per track) ---------------------------------------------

const octaves = DEFAULTS.map(name => INSTRUMENTS[name].octave ?? 4);
const baseNote = t => (octaves[t] + 1) * 12; // octave 4 -> C4 = 60
// What key `s` plays on track t: on instrument and MIDI tracks the s-th semitone of the two-octave keyboard
// (0-23, from the track's octave); on drum tracks kit pad s (0-15).
const noteFor = (t, s) => (isDrums(t) ? KIT[s % KIT.length].note : baseNote(t) + s);
// The key (keyboard semitone or kit pad) that shows `note` on track t, or -1
const keyFor = (t, note) => {
  if (isDrums(t)) return kitPad(note);
  const s = note - baseNote(t);
  return s >= 0 && s < 24 ? s : -1;
};

// ---- actions (shared by keyboard shortcuts and on-screen controls) ------------
let jam = false;                                   // Jam: no track selected (Jam button)

const actions = {
  play() { audio.resume(); engine.playing ? engine.stop() : engine.start(); },
  record() { audio.resume(); engine.toggleRecord(); },
  undo() { engine.undo(); },
  redo() { engine.redo(); },
  clearTrack() { engine.clearTrack(engine.selected); },
  trimTrack() { engine.trimTrack(engine.selected); },
  clearAll() { engine.clearAll(); },
  click() { engine.click = !engine.click; },
  tempo(d) { engine.setTempo(engine.bpm + d); },
  swing(d) { engine.setSwing(engine.swing + d); },
  // Shift + Octave: move the selected track's recorded notes by an octave (instrument and MIDI tracks:
  // drums map every octave onto the same pads, and audio would need a pitch-shifter).
  transpose(d) {
    const t = engine.selected;
    if (!isDrums(t) && !isAudio(t)) engine.transpose(t, 12 * d);
  },
  octave(d) {
    const t = engine.selected;
    octaves[t] = Math.max(0, Math.min(7, octaves[t] + d));
  },
  select(t) {
    if (page === 'settings') return settings.selectPage(t);   // Settings: the track buttons pick its page
    if (page === 'synth' && t === engine.selected && !jam) page = 'looper';   // its own track button: back to the loops
    jam = false;
    engine.select(t);
  },
  // Jam: no track selected, so keyboards and pads play nothing in the looper and you can play
  // over the loop (on an instrument that makes its own sound). Picking a track ends it.
  jam() {
    jam = !jam;
    if (jam) for (const src of [...pressed.keys()]) release(src);
  },
  volume(t, d) { actions.setVolume(t, audio.vol[t] + d); },
  setVolume(t, v) { audio.vol[t] = clamp01(v); audio.mix(); },
  pan(t, d) { audio.setPan(t, audio.pan[t] + d); },
  setPan(t, v) { audio.setPan(t, v); },
  mute(t) { audio.mute[t] = !audio.mute[t]; audio.mix(); },
  solo(t) { audio.solo[t] = !audio.solo[t]; audio.mix(); },
  quant() { engine.cycleQuant(engine.selected); },          // the selected track's record quantise
  // Instrument: the selected track's next melodic instrument among those switched on in the
  // Instruments page.
  nextInstrument(dir) {
    const names = Object.keys(INSTRUMENTS), t = engine.selected, n = names.length;
    const i = names.indexOf(audio.instruments[t]);
    for (let k = 1; k < n; k++) {
      const name = names[(i + dir * k + n * k) % n];
      if (presetOn[name]) return actions.instrument(t, name);
    }
  },
  togglePreset(name) { presetOn[name] = !presetOn[name]; },
  // The playing panel on screen and the Circuit's Note mode: one switch.
  toggleNotes() { notePanel = !notePanel; },
  // Kits: the selected track's next kit among those switched on in the Kits page.
  nextKit() {
    const keys = Object.keys(INSTRUMENTS).filter(k => INSTRUMENTS[k].kit && kitOn[k] !== false).sort((a, b) => a.localeCompare(b));
    if (!keys.length) return session.toast('No kits switched on: Shift + Kits to make or choose some', 'warn');
    const t = engine.selected;
    actions.instrument(t, keys[(keys.indexOf(audio.instruments[t]) + 1) % keys.length]);
  },
  // Pages: Shift + Preset / Kits opens that page, and the same again goes back to the Looper.
  togglePage(name) { if (page === 'settings') settings.close(); page = page === name ? 'looper' : name; },
  // MIDI: the selected track's next MIDI instrument among those switched on in the MIDI page.
  nextMidi() {
    const keys = Object.keys(INSTRUMENTS).filter(k => INSTRUMENTS[k].midi && midiOn[k] !== false).sort((a, b) => a.localeCompare(b));
    if (!keys.length) return session.toast('No MIDI instruments switched on: Shift + MIDI to make one', 'warn');
    const t = engine.selected;
    actions.instrument(t, keys[(keys.indexOf(audio.instruments[t]) + 1) % keys.length]);
  },
  // Audio: the selected track's next audio instrument among those switched on in the Audio page.
  nextAudio() {
    const keys = Object.keys(INSTRUMENTS).filter(k => INSTRUMENTS[k].audio && audioOn[k] !== false).sort((a, b) => a.localeCompare(b));
    if (!keys.length) return session.toast('No audio instruments switched on: Shift + Audio to make one', 'warn');
    const t = engine.selected;
    actions.instrument(t, keys[(keys.indexOf(audio.instruments[t]) + 1) % keys.length]);
  },
  // Synth: make the selected track a synth track and show its synth; on a synth track, show or
  // hide the Synth page.
  synth() {
    const t = engine.selected;
    if (isSynth(t)) return actions.togglePage('synth');
    actions.instrument(t, SYNTH_KEY);
    page = 'synth';
  },
  // The click's level and the overall output. Both 0-1, remembered in this browser.
  clickLevel(v) { levels.click = clamp01(v); audio.setClickLevel(levels.click); saveLevels(); },
  // Master filter: 0.5 open (it snaps there near the middle), lower = low-pass, higher = high-pass.
  // Not remembered: the looper always starts unfiltered.
  filter(v) { v = clamp01(v); levels.filter = Math.abs(v - 0.5) < 0.025 ? 0.5 : v; audio.setFilter(levels.filter); },
  masterVolume(v) { levels.master = clamp01(v); audio.setMasterVolume(levels.master); saveLevels(); },
  instrument(t, name) {
    audio.setInstrument(t, name);
    INSTRUMENTS[name].load?.();                           // a sampled instrument's samples
    if (INSTRUMENTS[name].octave != null) octaves[t] = INSTRUMENTS[name].octave;
    if (INSTRUMENTS[name].audio) connectAudioInput(t);
  },
};
// While jamming no track is selected, so what works on the selected track does nothing (Record
// can still close a recording that's under way).
for (const k of ['record', 'clearTrack', 'trimTrack', 'transpose', 'octave', 'quant', 'nextInstrument', 'nextKit', 'nextMidi', 'nextAudio', 'synth']) {
  const f = actions[k];
  actions[k] = (...a) => (jam && !(k === 'record' && engine.rec !== 'idle') ? undefined : f(...a));
}

// ---- the panel (laid out like the Circuit Tracks) ------------------------------------

const levels = { click: 0.5, master: 0.8, filter: 0.5 };
try {
  const saved = JSON.parse(localStorage.getItem('levels') ?? 'null');
  if (saved) { levels.master = saved.master ?? levels.master; levels.click = saved.click ?? levels.click; }
} catch {}
function saveLevels() { try { localStorage.setItem('levels', JSON.stringify(levels)); } catch {} }
audio.setClickLevel(levels.click);
audio.setMasterVolume(levels.master);

// Shift: the Shift key, the Circuit's Shift, or the on-screen Shift button (which holds for the
// next press). While any is down, buttons show what Shift does on them.
let shiftLatch = false, shiftKey = false;
const shiftDown = () => shiftLatch || shiftKey || !!app.circuitShift;
const shifted = e => { const s = e.shiftKey || shiftDown(); shiftLatch = false; return s; };
window.addEventListener('keydown', e => { if (e.key === 'Shift') shiftKey = true; });
window.addEventListener('keyup', e => { if (e.key === 'Shift') shiftKey = false; });
window.addEventListener('blur', () => { shiftKey = false; });

function el(tag, cls, html = '') {
  const e = document.createElement(tag);
  e.className = cls;
  e.innerHTML = html;
  return e;
}

// A knob: drag up/down or scroll to turn it, double-click for its default.
// `shift` (optional): a second value the knob turns while Shift is down, -1..1, shown on a small
// left-right strip under the knob (track knobs: stereo position).
// `shift`: what it turns with Shift held, shown as a left-right bar under it (track pan), or,
// with `shift.label`, in place of its own value and label (the filter knob's click level).
function makeKnob(parent, { label, title, get, set, dflt, shift }) {
  const bar = shift && !shift.label;
  const k = el('div', 'knob', `<div class="dial"><i></i></div>`
    + (bar ? '<span class="pan"><i></i><b></b></span>' : `<span class="klabel">${label}</span>`));
  k.title = title;
  const dial = k.querySelector('.dial');
  const panned = e => shift && (e.shiftKey || shiftDown());
  dial.addEventListener('pointerdown', e => {
    e.preventDefault();
    const y0 = e.clientY;
    const [g, s, span] = panned(e) ? [shift.get, shift.set, 2] : [get, set, 1];
    const v0 = g();
    const move = ev => s(v0 + ((y0 - ev.clientY) / 150) * span);   // 150 px = the whole range
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  });
  dial.addEventListener('wheel', e => {
    e.preventDefault();
    const d = e.deltaY < 0 ? 1 : -1;
    if (panned(e)) shift.set(shift.get() + d * 0.05); else set(get() + d * 0.03);
  }, { passive: false });
  dial.addEventListener('dblclick', e => (panned(e) ? shift.set(shift.dflt) : set(dflt)));
  parent.appendChild(k);
  const pan = k.querySelector('.pan'), klabel = k.querySelector('.klabel');
  return {
    el: k, label: klabel,
    update(color) {
      const alt = shift?.label && shiftDown();
      dial.style.setProperty('--v', (alt ? shift.get() : get()).toFixed(3));
      if (shift?.label) setText(klabel, alt ? shift.label : label);
      if (pan) pan.style.setProperty('--p', shift.get().toFixed(3));
      if (color) k.style.setProperty('--c', color);
    },
  };
}

const masterKnob = makeKnob($('master-vol'), {
  label: 'Master', title: 'Master volume: everything the looper plays. The Circuit\'s master volume knob turns it. Drag or scroll; double-click to reset.',
  get: () => levels.master, set: actions.masterVolume, dflt: 0.8,
});
const clickKnob = makeKnob($('master-int'), {
  label: 'Filter', title: 'Master filter: left closes a low-pass, right opens a high-pass, the middle is off (double-click). With Shift: the click\'s level. The Circuit\'s master filter knob turns both. Drag or scroll',
  get: () => levels.filter, set: actions.filter, dflt: 0.5,
  shift: { label: 'Click', get: () => levels.click, set: actions.clickLevel, dflt: 0.5 },
});
const volKnobs = [];
for (let t = 0; t < TRACKS; t++) {
  volKnobs.push(makeKnob($('knobs'), {
    label: '', title: `Track ${t + 1}: volume (drag or scroll; double-click for unity). With Shift: left-right position (Shift + double-click centres it)`,
    get: () => audio.vol[t], set: v => actions.setVolume(t, v), dflt: 0.8,
    shift: { get: () => audio.pan[t], set: v => actions.setPan(t, v), dflt: 0 },
  }));
}

// A panel button. Each can have up to three actions, shown top to bottom: what Shift does
// (`shift`, small grey), what holding it does (`hold`, small blue), and what a tap does (`tap`,
// the main label), then an optional readout. `shiftHold` marks a Shift action that also needs
// the button held (both icons). `act(e)` runs on a click; buttons without one are
// placeholders for now (labelled with their Circuit name).
function makeButton(parent, { tap, shift = '', hold = '', shiftHold = false, title, act, cls = '' }) {
  const b = el('button', `pbtn ${cls}${act ? '' : ' idle'}${shift ? ' has-shift' : ''}${hold ? ' has-hold' : ''}`,
    `<span class="pfn">${shiftHold ? '<i class="ihold"></i>' : ''}${shift}</span><span class="phold">${hold}</span><span class="plabel">${tap}</span><span class="pval"></span>`);
  b.title = title ?? (act ? tap : `${tap} (not used yet)`);
  if (act) b.addEventListener('click', e => { audio.resume(); act(e); });
  parent.appendChild(b);
  return b;
}

// Every button except the track buttons, where it sits on the Circuit. Rows of the panel grid:
// 1 = logo, 2 = knobs, 3 = the row above the track buttons, 4 = the track buttons, 5-8 = the
// four pad rows. Columns: 1 = left of the tracks, 2-9 = the eight track columns, 10 = right.
const btn = {};
for (const [row, col, key, def] of [
  [3, 1, 'note', { tap: 'Play', act: () => actions.toggleNotes(),
    title: 'Show or hide the play controls under the looper: keyboard (instrument and MIDI tracks) or kit pads (kit tracks). On the Circuit: Note mode' }],
  [3, 2, 'octDown', { tap: 'Octave ▼', shift: 'Track ▼', act: e => (page === 'settings' ? settings.move(1) : shifted(e) ? actions.transpose(-1) : actions.octave(-1)),
    title: 'Tap: keyboard octave down (,). Shift: move the selected track\'s notes down an octave' }],
  [3, 3, 'octUp', { tap: 'Octave ▲', shift: 'Track ▲', act: e => (page === 'settings' ? settings.move(-1) : shifted(e) ? actions.transpose(1) : actions.octave(1)),
    title: 'Tap: keyboard octave up (.). Shift: move the selected track\'s notes up an octave' }],
  [3, 4, 'quant', { tap: 'Q', act: () => actions.quant(), title: 'Record quantise for the selected track: off → 32nds → 16ths (each track button shows its own)' }],
  [3, 5, 'tempo', { tap: 'Click', shift: 'Swing', shiftHold: true, hold: 'Tempo', act: () => actions.click(),
    title: 'Tap: the metronome (C). Hold + turn the master filter knob (or scroll over it): tempo (↑ ↓). Shift + hold + turn (or Shift + scroll): swing' }],
  // Clear track and Undo sit on the Circuit's Clear and Duplicate buttons.
  [3, 6, 'clearTrack', { tap: 'Clear track', shift: 'Trim', act: e => (page === 'settings' ? settings.del() : shifted(e) ? actions.trimTrack() : actions.clearTrack()),
    title: 'Tap: clear the selected track (⌫). Shift: trim the blank bars off the end of its loop. In Settings: delete the chosen item' }],
  [3, 7, 'undo', { tap: 'Undo', shift: 'Redo', act: e => (shifted(e) ? actions.redo() : actions.undo()),
    title: 'Tap: undo the last recording (Z). Shift: redo it (⇧Z)' }],
  [3, 8, 'save', { tap: 'Save', shift: 'Template', act: e => (shifted(e) ? session.saveTemplate() : session.save()),
    title: 'Tap: save the project (⌘S; the first time, name it; ⇧⌘S: save as). Shift: save the setup, without the loops, as a template' }],
  [3, 9, 'open', { tap: 'Open', shift: 'New', act: e => (shifted(e) ? session.openTemplate() : session.open()),
    title: 'Tap: open a recent project (⌘O). Shift: a new project (from your default setup, or pick another template)' }],
  [3, 10, 'shift', { tap: 'Shift', act: () => (shiftLatch = !shiftLatch), title: 'Shift: hold the Shift key, or click this for the next press' }],
  [4, 1, 'preset', { tap: 'Instrument', shift: 'List', act: e => (shifted(e) ? actions.togglePage('presets') : actions.nextInstrument(1)),
    title: 'Tap: the selected track\'s next instrument (of those switched on in the Instruments page). Shift: open the Instruments page, or go back to the Looper' }],
  // The sound sources, down the left: Instruments, Kits, Synth, Audio, MIDI.
  [5, 1, 'kits', { tap: 'Kits', shift: 'List', act: e => (shifted(e) ? actions.togglePage('kits') : actions.nextKit()),
    title: 'Tap: the selected track\'s next kit (of those switched on in the Kits page). Shift: open the Kits page, or go back to the Looper' }],
  [6, 1, 'synth', { tap: 'Synth', act: () => actions.synth(),
    title: 'Make the selected track a synth track and show its synth (each track has its own). On a synth track: show or hide the synth. Hold Shift there for its 32 presets' }],
  [7, 1, 'audio', { tap: 'Audio', shift: 'List', act: e => (shifted(e) ? actions.togglePage('audio') : actions.nextAudio()),
    title: 'Tap: the selected track\'s next audio instrument (of those switched on in the Audio page). Shift: open the Audio page, or go back to the Looper' }],
  [8, 1, 'midi', { tap: 'MIDI', shift: 'List', act: e => (shifted(e) ? actions.togglePage('midi') : actions.nextMidi()),
    title: 'Tap: the selected track\'s next MIDI instrument (of those switched on in the MIDI page). Shift: open the MIDI page, or go back to the Looper' }],
  [5, 10, 'settings', { tap: '', act: () => actions.togglePage('settings'),
    title: 'Settings (the cog): the track buttons pick its page; ▲ ▼ or the master filter knob choose, Play picks, Clear track deletes' }],
  [6, 10, 'fx', { tap: 'FX', shift: 'Bypass', act: e => (shifted(e) ? fxPage.bypass() : actions.togglePage('fx')),
    title: 'Tap: the selected track\'s FX, 8 pedals (on the Circuit: a column\'s knob turns its pedal\'s mix; hold pad 1-3 of the column and turn for its controls; the bottom pad is the footswitch). Shift: bypass its FX' }],
  [7, 10, 'record', { tap: 'Record', act: () => actions.record(), title: 'Record (X)' }],
  [8, 10, 'play', { tap: 'Play', act: () => (page === 'settings' ? settings.enter() : actions.play()), title: 'Play / Stop (Space). In Settings: do the chosen row\'s thing (Enter)' }],
]) {
  const b = makeButton(row === 3 && col > 1 && col < 10 ? $('aux') : $('device'), { ...def, cls: key });
  if (b.parentElement.id === 'device') { b.style.gridRow = row; b.style.gridColumn = col; }
  btn[key] = b;
}
// Jam sits to the right of the track buttons, as track "0".
btn.jam = el('button', 'tbtn jam', '<span class="tnum">0</span><span class="tinst"><i class="ticon"></i><span class="tname">Jam</span></span>');
btn.jam.title = 'Jam: deselect every track, so your keyboard plays only itself over the loop. Pick a track to come back (0)';
btn.jam.addEventListener('click', () => { audio.resume(); actions.jam(); });
Object.assign(btn.jam.style, { gridRow: 4, gridColumn: 10 });
$('device').appendChild(btn.jam);

btn.tempo.addEventListener('wheel', e => {
  e.preventDefault();
  const d = e.deltaY < 0 ? 1 : -1;
  e.shiftKey || shiftDown() ? actions.swing(d) : actions.tempo(d);
}, { passive: false });

// Track buttons, then mute and solo pads under each.
const tbtns = [];
for (let t = 0; t < TRACKS; t++) {
  const b = el('button', 'tbtn', `<span class="tnum">${t + 1}</span><i class="tdot"></i><canvas class="tmini"></canvas><span class="tinst"><i class="ticon"></i><span class="tname"></span></span><span class="tlen"></span><b class="tq"></b><b class="tfx">FX</b><span class="tpage"></span>`);
  b.title = `Track ${t + 1} (${t + 1})`;
  b.addEventListener('click', () => actions.select(t));
  $('trackbar').appendChild(b);
  const m = el('button', 'pad mute');
  m.title = `Mute track ${t + 1}`;
  m.setAttribute('aria-label', m.title);
  m.addEventListener('click', () => actions.mute(t));
  $('mute-row').appendChild(m);
  const so = el('button', 'pad solo');
  so.title = `Solo track ${t + 1}`;
  so.setAttribute('aria-label', so.title);
  so.addEventListener('click', () => actions.solo(t));
  $('solo-row').appendChild(so);
  tbtns.push({ el: b, mini: b.querySelector('.tmini'), name: b.querySelector('.tname'), len: b.querySelector('.tlen'), dot: b.querySelector('.tdot'), q: b.querySelector('.tq'), fx: b.querySelector('.tfx'), page: b.querySelector('.tpage'), m, s: so });
}

const instSelect = $('inst');
// The instrument menu: instruments, then kits. Rebuilt when kits are added.
function fillInstruments() {
  const opt = ([k, v]) => `<option value="${k}">${v.name.replace(/</g, '&lt;')}</option>`;
  const all = Object.entries(INSTRUMENTS), sorted = list => list.sort((a, b) => a[0].localeCompare(b[0]));
  const kits = sorted(all.filter(([, v]) => v.kit)), auds = sorted(all.filter(([, v]) => v.audio)), midis = sorted(all.filter(([, v]) => v.midi));
  instSelect.innerHTML = `<optgroup label="Synth">${all.filter(([, v]) => v.synth).map(opt).join('')}</optgroup>`
    + `<optgroup label="Instruments">${all.filter(([, v]) => !v.kit && !v.audio && !v.midi && !v.synth).map(opt).join('')}</optgroup>`
    + (kits.length ? `<optgroup label="Kits">${kits.map(opt).join('')}</optgroup>` : '')
    + (auds.length ? `<optgroup label="Audio">${auds.map(opt).join('')}</optgroup>` : '')
    + (midis.length ? `<optgroup label="MIDI">${midis.map(opt).join('')}</optgroup>` : '');
  instSelect.value = audio.instruments[engine.selected];
}
fillInstruments();
// Blur after choosing so Space/arrows go back to the looper, not the dropdown.
instSelect.addEventListener('change', () => { actions.instrument(engine.selected, instSelect.value); instSelect.blur(); });

// Browsers keep audio paused until the page gets a click or key press (input from the
// Circuit doesn't count), so any click or key anywhere turns sound on.
const soundBlocked = () => audio.ctx.state !== 'running';
for (const ev of ['pointerdown', 'keydown']) window.addEventListener(ev, () => audio.resume(), { capture: true });

// Keep focus off buttons so Space never "clicks" the last-pressed button.
for (const b of document.querySelectorAll('button')) b.addEventListener('mousedown', e => e.preventDefault());

// Vertical axis for a track's roll.
function rowsFor(t) {
  if (isDrums(t)) {
    const names = inst(t).padShort;           // a sample kit: its samples' short names
    return { count: KIT.length, rowOf: kitPad, label: i => names?.[i] || KIT[i].short, major: i => i === 0 || i === 8, black: i => i >= 8 };
  }
  // Pitched: whole octaves covering what's recorded, plus the keyboard's octave on the selected track.
  let lo = Infinity, hi = -Infinity;
  for (const n of engine.tracks[t].notes) { lo = Math.min(lo, n.note); hi = Math.max(hi, n.note); }
  if (t === engine.selected || lo === Infinity) { lo = Math.min(lo, baseNote(t)); hi = Math.max(hi, baseNote(t)); }
  lo = Math.floor(lo / 12) * 12;
  hi = Math.floor(hi / 12) * 12 + 11;
  return {
    count: hi - lo + 1,
    rowOf: n => (n >= lo && n <= hi ? n - lo : -1),
    label: i => NOTE_NAMES[(lo + i) % 12] + ((lo + i) % 12 === 0 ? (lo + i) / 12 - 1 : ''),
    major: i => (lo + i) % 12 === 0,
    black: i => isBlack((lo + i) % 12),
  };
}

// ---- piano ---------------------------------------------------------------

// What each input source is holding down, so key-up releases the note it started
// even if the octave or track changed in between.
const pressed = new Map(); // source id -> { track, note }

function press(src, s, vel = 100) {
  if (jam || pressed.has(src)) return;
  const track = engine.selected;
  if (isAudio(track)) return;                     // audio tracks record their input, not notes
  const note = noteFor(track, s);
  pressed.set(src, { track, note });
  engine.noteOn(track, note, vel);
}
function release(src) {
  const p = pressed.get(src);
  if (!p) return;
  pressed.delete(src);
  engine.noteOff(p.track, p.note);
}

// The playing panel under the looper (Note): a two-octave keyboard on instrument and MIDI tracks, the 16-pad
// kit on drum tracks. The computer keyboard plays its first octave / first 12 pads.
let notePanel = false;
const playable = (el, s) => {
  el.addEventListener('pointerdown', e => {
    e.preventDefault();
    try { el.setPointerCapture(e.pointerId); } catch {}       // keep the release on this key
    audio.resume();
    press(`ptr${e.pointerId}`, s);
  });
  el.addEventListener('pointerup', e => release(`ptr${e.pointerId}`));
  el.addEventListener('pointercancel', e => release(`ptr${e.pointerId}`));
};

const keyEls = [];
let white = 0;
for (let s = 0; s < 24; s++) {
  const black = isBlack(s % 12);
  const k = el('div', black ? 'key black' : 'key white', `<span class="letter">${s < 12 ? keyLetter(s) : ''}</span><span class="name"></span>`);
  if (black) k.style.left = `calc(${(white / 14) * 100}% - 2.2%)`;   // centred on the line between white keys (black keys are 4.4% wide)
  else white++;
  playable(k, s);
  $('keyboard').appendChild(k);
  keyEls.push({ el: k, name: k.querySelector('.name') });
}

// Kit pads: pads 1-8 along the bottom row, 9-16 above (as on the Circuit).
const kitEls = KIT.map((p, i) => {
  const d = el('div', 'kpad', `<span class="kname">${p.name}</span><span class="knum">${i + 1}</span>`);
  d.style.gridRow = i < 8 ? 2 : 1;
  d.style.gridColumn = (i % 8) + 1;
  playable(d, i);
  $('kit').appendChild(d);
  return d;
});

// ---- computer keyboard ----------------------------------------------------

window.addEventListener('keydown', e => {
  // Projects: ⌘S save, ⇧⌘S save as, ⌘O open (instead of the browser's own).
  if ((e.metaKey || e.ctrlKey) && !e.altKey && (e.code === 'KeyS' || e.code === 'KeyO')) {
    e.preventDefault();
    if (e.code === 'KeyO') session.open(); else if (e.shiftKey) session.saveAs(); else session.save();
    return;
  }
  if (session.dialogOpen()) { session.key(e); return; }      // a project screen is up: keys are for it
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (page === 'settings' && !(e.target instanceof HTMLInputElement)) {    // Settings: ▲ ▼ choose, Enter / Space pick, ⌫ deletes
    const k = { ArrowUp: () => settings.move(-1), ArrowDown: () => settings.move(1), Enter: () => settings.enter(), Space: () => settings.enter(),
      Backspace: () => settings.del(), Delete: () => settings.del(), Escape: () => actions.togglePage('settings') }[e.code];
    if (k) { e.preventDefault(); k(); return; }
  }
  if (e.target instanceof HTMLSelectElement || e.target instanceof HTMLInputElement) e.target.blur();
  if (e.code in KEYS) {
    e.preventDefault();
    if (!e.repeat) press(e.code, KEYS[e.code]);
    return;
  }
  const isArrow = e.code === 'ArrowUp' || e.code === 'ArrowDown';
  if (e.repeat && !isArrow) return;
  const digit = /^Digit([1-9])$/.exec(e.code);
  if (digit) { actions.select(Number(digit[1]) - 1); e.preventDefault(); return; }
  if (e.code === 'Digit0') { actions.jam(); e.preventDefault(); return; }
  switch (e.code) {
    case 'Space': actions.play(); break;
    case 'KeyX': actions.record(); break;
    case 'KeyZ': e.shiftKey ? actions.redo() : actions.undo(); break;
    case 'KeyC': actions.click(); break;
    case 'ArrowUp': actions.tempo(e.shiftKey ? 5 : 1); break;
    case 'ArrowDown': actions.tempo(e.shiftKey ? -5 : -1); break;
    case 'Comma': actions.octave(-1); break;
    case 'Period': actions.octave(1); break;
    case 'Backspace':
    case 'Delete': e.shiftKey ? actions.clearAll() : actions.clearTrack(); break;
    default: return;
  }
  e.preventDefault();
});
window.addEventListener('keyup', e => release(e.code));
window.addEventListener('blur', () => [...pressed.keys()].forEach(release));

// ---- audio tracks ----------------------------------------------------------------
// An audio track records one of the computer's audio inputs (chosen per track). The take
// starts on the first sound while armed and closes on a bar line like any other; the clip is
// cut from the input's history, shifted back by the input's latency so it sits on the beat.

const inputs = new AudioInputs(audio.ctx);
const trackInput = Array(TRACKS).fill(null);       // deviceId per audio track
const AUDIO_ROWS = { count: 1, rowOf: () => -1, label: () => '', major: () => false, black: () => false };

async function useInput(t, deviceId) {
  trackInput[t] = deviceId;
  if (!deviceId) return;
  try {
    const input = await inputs.open(deviceId);
    input.onLevel ??= (peak, time) => {
      const r = engine.recTrack;
      if (engine.rec === 'armed' && isAudio(r) && trackInput[r] === deviceId && input.loud(peak)) {
        engine.startTake(time - input.latency);
      }
    };
  } catch (err) {
    console.warn('audio input', err);
    trackInput[t] = null;
  }
}

// An audio track listens to its audio instrument's input, found by name.
async function connectAudioInput(t) {
  const label = inst(t).input;
  let list = inputs.devices.length && inputs.devices[0].label !== 'Audio input' ? inputs.devices : null;
  try { list ??= await inputs.permit(); } catch { list = []; }
  const match = label && list.find(d => d.label === label);
  if (match) return useInput(t, match.deviceId);
  trackInput[t] = null;
  session.toast(label ? `“${inst(t).name}”: its input “${label}” isn't connected` : `“${inst(t).name}” has no input: set one in the Audio page`, 'warn');
}

async function chooseDefaultInput(t) {
  let list = inputs.devices.length && inputs.devices[0].label !== 'Audio input' ? inputs.devices : null;
  try { list ??= await inputs.permit(); } catch { return; }
  const pick = list.find(d => d.deviceId === 'default') || list[0];
  if (pick) useInput(t, pick.deviceId);
}

// A clip: `getBuffer()` returns the audio (null while there's none yet); peaks for drawing
// are worked out once the audio is complete. `id` names its file in a saved project.
let clipCount = 0;
function makeClip(pass, seconds, getBuffer, id = `${Date.now().toString(36)}-${++clipCount}`) {
  let done = null, peaks = null;
  return {
    pass, seconds, id,
    buffer() { return done ?? getBuffer(b => (done = b)); },
    complete() { if (!done) this.buffer(); return done; },     // the whole audio, or null if not yet
    peaks(n) {
      if (!done) this.buffer();
      if (!done) return null;
      if (peaks && peaks.length === n) return peaks;
      const L = done.getChannelData(0), R = done.getChannelData(1), step = L.length / n;
      peaks = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        let m = 0;
        for (let j = Math.floor(i * step), e = Math.floor((i + 1) * step); j < e; j++) m = Math.max(m, Math.abs(L[j]), Math.abs(R[j]));
        peaks[i] = m;
      }
      return peaks;
    },
  };
}

// A take: cut from the input's history when first needed. Parts not captured yet are silent
// (only the last moments, on the very first repeat), so keep cutting until it's complete.
engine.onClose = (t, startBeat, endBeat, pass) => {
  const input = inputs.inputs.get(trackInput[t]);
  if (!isAudio(t) || !input) return;
  const t0 = engine.timeAt(startBeat) + input.latency;
  const seconds = (endBeat - startBeat) * 60 / engine.bpm;
  engine.tracks[t].clips.push(makeClip(pass, seconds, keep => {
    const { buffer, complete } = input.extract(t0, seconds);
    if (complete) keep(buffer);
    return buffer;
  }));
};

// An overdub: everything played from its start to its end, folded onto the loop (passes that
// went round more than once add up) as a new layer, which undo can take off again. Built once
// the input has caught up with the end.
engine.onDubEnd = (t, startBeat, endBeat, pass) => {
  const input = inputs.inputs.get(trackInput[t]);
  const loop = engine.tracks[t].loop;
  if (!isAudio(t) || !input || !loop) return;
  const spb = 60 / engine.bpm, sr = audio.ctx.sampleRate;
  const t0 = engine.timeAt(startBeat) + input.latency;
  const dur = (endBeat - startBeat) * spb;
  const posFrame = Math.round((((startBeat - loop.origin) % loop.length + loop.length) % loop.length) * spb * sr);
  const seconds = loop.length * spb;
  const build = () => {
    const { buffer: cap, complete } = input.extract(t0, dur);
    if (!complete) return setTimeout(build, 50);
    const len = Math.round(seconds * sr);
    const layer = new AudioBuffer({ numberOfChannels: 2, length: len, sampleRate: sr });
    for (let ch = 0; ch < 2; ch++) {
      const src = cap.getChannelData(ch), dst = layer.getChannelData(ch);
      for (let i = 0, j = posFrame % len; i < src.length; i++, j = j + 1 === len ? 0 : j + 1) dst[j] += src[i];
    }
    engine.addClip(t, makeClip(pass, seconds, keep => { keep(layer); return layer; }));   // complete as soon as it's built
  };
  build();
};

inputs.list();

// ---- MIDI keyboards ------------------------------------------------------------
// Play the selected track's sound (audio tracks ignore them: those record their input).
// The sustain pedal holds notes like a piano: a key let go while it's down keeps sounding
// until the pedal comes up, and is recorded that long.
// Ports the looper sends to (its MIDI instruments' outputs): never heard, or notes would loop back.
const ownOutput = name => Object.values(INSTRUMENTS).some(d => d.midi && d.output === name);
// A MIDI instrument's own keyboard plays its track whatever Settings › MIDI picks.
const ownInput = name => isMidi(engine.selected) && inst(engine.selected).input === name;
let sustain = false;
const sustained = new Set();                       // keyboard notes let go while the pedal was down
connectMidiKeyboards({
  onNote(note, vel, port) {
    const src = `midi:${note}`;
    if (!vel) {
      if (sustain && pressed.has(src)) sustained.add(src); else release(src);
      return;
    }
    sustained.delete(src);
    release(src);                                  // same key again: restart it
    if (jam) return;                               // jamming: the keyboard plays only itself
    const track = engine.selected;
    if (isAudio(track)) return;
    if (isMidi(track) && inst(track).input && inst(track).input !== port) return;   // only its own keyboard plays it
    pressed.set(src, { track, note });
    engine.noteOn(track, note, vel);
  },
  onSustain(down) {
    sustain = down;
    if (down) return;
    for (const src of sustained) release(src);
    sustained.clear();
  },
  onStatus: () => {},                    // MIDI in's state isn't shown for now
  isOwnOutput: ownOutput,
  ownInput,
});

// ---- pages ----------------------------------------------------------------------

// Instruments page: a card per melodic instrument (tap: in or out of Instrument's cycle).
// FX page: the selected track's pedalboard.
const fxPage = setupFxPage({ root: $('page-fx'), audio, engine, trackName: nameOf,
  shiftHeld: () => shiftDown(), consumeShift: () => { shiftLatch = false; } });
// The guide: a click-through of the panel. Each step opens its page (or the playing panel, or
// Jam); closing it puts back what was on screen. Its Synth step shows the synth of the selected
// track, or of a synth track, even when it isn't one (`guideSynth`): nothing is changed.
let guideSynth = false;
const tour = setupTour({
  snapshot: () => ({ page, notePanel, jam, sel: engine.selected, sp: settings.page() }),
  restore(s) {
    guideSynth = false;
    page = s.page; notePanel = s.notePanel; jam = s.jam;
    engine.select(s.sel);
    settings.selectPage(s.sp);
  },
  view(v) {
    session.close();
    page = v.page ?? 'looper';
    notePanel = !!v.keys;
    jam = !!v.jam;
    guideSynth = page === 'synth';
    if (guideSynth && !isSynth(engine.selected)) {
      const t = engine.tracks.findIndex((_, i) => isSynth(i));
      if (t >= 0) engine.select(t);
    }
  },
});
// Settings (the cog): templates, the MIDI input that plays the selected track, the Circuit's
// firmware, a MIDI monitor and the guide.
const settings = setupSettings({
  root: $('page-settings'), INSTRUMENTS, DEFAULTS, toast: (...a) => session.toast(...a),
  more: [setupFirmware({ onBusy: busy => { app.flashing = busy; } }), setupMonitor({ isOwnOutput: ownOutput, ownInput }), tour.page],
  onMidiChange: () => { for (const src of [...pressed.keys()]) if (src.startsWith('midi:')) release(src); },   // no stuck notes
  isOwnOutput: ownOutput });
// Synth page: the selected track's synth.
const synthPage = setupSynthPage({ root: $('page-synth'), audio, engine, isSynth,
  shiftHeld: () => shiftDown(), consumeShift: () => { shiftLatch = false; } });


// The open page's cards, for the Circuit's pads (null on the Looper, or while editing).
function pageCards() {
  switch (page) {
    case 'presets': return instPage.editing() ? null : instPage.cards;
    case 'kits': return kitPage.editing() ? null : kitPage.cards;
    case 'audio': return audioPage.editing() ? null : audioPage.cards;
    case 'midi': return midiPage.editing() ? null : midiPage.cards;
    case 'fx': return fxPage.cards;
    case 'synth': return synthPage.cards;
    case 'settings': return settings.cards;
  }
  return null;
}

function drawPage() {
  // The Synth page is only for synth tracks: picking another track, switching this one to another
  // sound, or jamming goes back to the Looper.
  if (page === 'synth' && !guideSynth && (jam || !isSynth(engine.selected))) page = 'looper';
  document.body.dataset.page = page;
  btn.preset.classList.toggle('page-on', page === 'presets');
  btn.kits.classList.toggle('page-on', page === 'kits');
  btn.audio.classList.toggle('page-on', page === 'audio');
  btn.midi.classList.toggle('page-on', page === 'midi');
  btn.fx.classList.toggle('page-on', page === 'fx');
  $('page-fx').hidden = page !== 'fx';
  if (page === 'fx') fxPage.update();
  btn.synth.classList.toggle('page-on', page === 'synth');
  $('page-synth').hidden = page !== 'synth';
  if (page === 'synth') synthPage.update();
  btn.settings.classList.toggle('page-on', page === 'settings');
  $('page-settings').hidden = page !== 'settings';
  if (page === 'settings') settings.update();
  const midiShown = !$('page-midi').hidden;
  $('page-midi').hidden = page !== 'midi';
  if (page === 'midi') { if (!midiShown) midiPage.show(); midiPage.update(); }
  const audioShown = !$('page-audio').hidden;
  $('page-audio').hidden = page !== 'audio';
  if (page === 'audio') { if (!audioShown) audioPage.show(); audioPage.update(); }
  for (const id of ['mute-row', 'solo-row', 'seq']) $(id).hidden = page !== 'looper';
  $('page-presets').hidden = page !== 'presets';
  const kitsShown = !$('page-kits').hidden;
  $('page-kits').hidden = page !== 'kits';
  if (page === 'kits') { if (!kitsShown) kitPage.show(); kitPage.update(); }
  const instShown = $('page-presets').dataset.shown === '1';
  $('page-presets').dataset.shown = page === 'presets' ? '1' : '';
  if (page === 'presets') { if (!instShown) instPage.show(); instPage.update(); }
}

// ---- render loop ------------------------------------------------------------

// The readout in the logo row: three seven-segment digits, unlit segments faintly showing.
const lcd = (() => {
  const SEGS = {                                       // a b c d e f g, in a 40 x 70 cell
    a: '6,3 9,0 31,0 34,3 31,6 9,6', b: '37,5 40,8 40,30 37,33 34,30 34,8', c: '37,37 40,40 40,62 37,65 34,62 34,40',
    d: '6,67 9,64 31,64 34,67 31,70 9,70', e: '3,37 6,40 6,62 3,65 0,62 0,40', f: '3,5 6,8 6,30 3,33 0,30 0,8',
    g: '6,35 9,32 31,32 34,35 31,38 9,38',
  };
  const DIGITS = ['abcdef', 'bc', 'abdeg', 'abcdg', 'bcfg', 'acdfg', 'acdefg', 'abc', 'abcdefg', 'abcdfg'];
  const root = $('lcd-digits');
  root.innerHTML = [0, 1, 2].map(() => `<svg viewBox="-1 -1 42 72">${Object.entries(SEGS).map(([k, p]) => `<polygon data-s="${k}" points="${p}"/>`).join('')}</svg>`).join('');
  const cells = [...root.children].map(svg => [...svg.children]);
  let shown = '';
  return {
    show(value, unit) {
      const text = String(Math.round(value)).slice(-3).padStart(3, ' ');
      if (text + unit === shown) return;
      shown = text + unit;
      cells.forEach((segs, i) => {
        const lit = text[i] === ' ' ? '' : DIGITS[Number(text[i])];
        segs.forEach(seg => seg.classList.toggle('on', lit.includes(seg.dataset.s)));
      });
      setText($('lcd-unit'), unit);
      $('lcd').classList.toggle('swing', unit !== 'BPM');
    },
  };
})();

const beatDots = [...document.querySelectorAll('#beats i')];

function status() {
  const bpb = engine.beatsPerBar;
  const track = `track ${engine.recTrack + 1}`;
  switch (engine.rec) {
    case 'armed':
      return `Armed · ${track} · starts on your first ${isAudio(engine.recTrack) ? 'sound' : 'note'}`;
    case 'recording':
      return `Recording ${track} · bar ${Math.floor((engine.beat() - engine.recStart) / bpb) + 1} · X to close`;
    case 'closing':
      return `Closing at end of bar ${(engine.recEnd - engine.recStart) / bpb}`;
    case 'overdub':
      return `Overdub · ${track} · X to stop`;
  }
  if (engine.loop) {
    const n = engine.loop.length / bpb;
    return `${engine.playing ? 'Looping' : 'Loop ready'} · ${n} bar${n > 1 ? 's' : ''}`;
  }
  return engine.playing ? 'Playing' : 'Stopped';
}

function setText(el, text) { if (el.textContent !== text) el.textContent = text; }

function frame() {
  const bpb = engine.beatsPerBar;
  const sel = engine.selected;
  const b = engine.beat();

  // Sound off (and the last project waiting for a click): a notice floating at the bottom.
  const reopening = session.reopening();
  $('sound-gate').hidden = !soundBlocked() && !reopening;
  document.body.classList.toggle('gated', !$('sound-gate').hidden);
  setText($('sound-gate'), reopening ? `Click anywhere to reopen “${reopening}”` : 'Click anywhere to turn the sound on');
  saveView();
  setText($('status'), status());
  for (const f of audio.fx) f.setTempo(engine.bpm);        // delays follow the tempo
  for (const s of audio.synth) s.setTempo(engine.bpm);     // so do synth LFOs
  document.body.dataset.rec = engine.rec;
  const beatIdx = engine.playing && b >= 0 ? Math.floor(b % bpb) : -1;
  beatDots.forEach((d, i) => d.classList.toggle('on', i === beatIdx));

  // Panel buttons
  btn.play.classList.toggle('on', engine.playing);
  setText(btn.play.querySelector('.pval'), engine.playing ? '■' : '▶');
  btn.record.dataset.state = engine.rec;
  btn.record.classList.toggle('has-loop', !!engine.tracks[sel].loop);
  btn.tempo.classList.toggle('on', engine.click);
  btn.tempo.classList.toggle('beat', engine.click && engine.playing && b >= 0 && b % 1 < 0.15);
  lcd.show(shiftDown() ? engine.swing : engine.bpm, shiftDown() ? 'SWING' : 'BPM');
  btn.undo.classList.toggle('on', !engine.isEmpty() || engine.canRedo());
  btn.clearTrack.classList.toggle('on', shiftDown() ? engine.trimLength(sel) > 0 : engine.tracks[sel].notes.length + engine.tracks[sel].clips.length > 0);
  btn.shift.classList.toggle('on', shiftDown());
  document.body.classList.toggle('shift', shiftDown());
  btn.tempo.classList.toggle('holding', app.holding === 'tempo');        // held on the Circuit
  const drums = isDrums(sel);
  // With Shift down they transpose the track instead, which needs recorded notes on an instrument or MIDI track.
  const canMove = app.canTranspose();
  btn.octUp.disabled = shiftDown() ? !canMove : drums || octaves[sel] >= 7;
  btn.octDown.disabled = shiftDown() ? !canMove : drums || octaves[sel] <= 0;
  drawPage();

  // Knobs
  masterKnob.update();
  clickKnob.update();
  volKnobs.forEach((k, t) => k.update(inst(t).color));

  // Track buttons
  const recTrack = engine.rec !== 'idle' ? engine.recTrack : -1;
  tbtns.forEach((tb, t) => {
    const len = engine.tracks[t].loop ? engine.tracks[t].loop.length / bpb : 0;
    const sounding = engine.loopSounding(t).size > 0 || [...pressed.values()].some(p => p.track === t);
    tb.el.style.setProperty('--c', inst(t).color);
    tb.el.classList.toggle('selected', t === sel && !jam);
    tb.el.classList.toggle('rec', t === recTrack);
    tb.el.classList.toggle('empty', !engine.tracks[t].notes.length);
    tb.dot.classList.toggle('on', sounding && audio.audible(t));
    tb.el.classList.toggle('silent', !audio.audible(t));
    tb.m.classList.toggle('on', audio.mute[t]);
    tb.s.classList.toggle('on', audio.solo[t]);
    setText(tb.name, nameOf(t));
    tb.el.dataset.type = isAudio(t) ? 'audio' : isMidi(t) ? 'midi' : isDrums(t) ? 'kit' : isSynth(t) ? 'synth' : 'inst';    // picks the icon by the name
    tb.q.dataset.q = engine.tracks[t].quant;
    // FX: shown while a pedal is on (and the track's FX isn't bypassed)
    const fx = audio.fx[t].settings, pedals = PEDALS.filter(p => fx.pedals[p.id].on).map(p => p.name);
    tb.fx.hidden = !(fx.on && pedals.length);
    tb.fx.title = pedals.length ? `FX: ${pedals.join(' + ')}${fx.on ? '' : ' (bypassed)'}` : '';
    setText(tb.q, { off: 'Q off', mid: 'Q 32', strong: 'Q 16' }[engine.tracks[t].quant]);
    setText(tb.len, len ? `${len} bar${len > 1 ? 's' : ''}` : '—');
    setText(tb.page, settings.pages[t]?.name ?? '');              // Settings: the page this button picks
    tb.el.classList.toggle('setpage', page === 'settings' && t === settings.page());
    tb.el.classList.toggle('nopage', !settings.pages[t]);
    if (page !== 'settings') drawMini(tb.mini, engine, t, inst(t).color, isDrums(t));
  });

  // The selected track's sequencer
  const view = engine.view(sel);
  const { color } = inst(sel);
  $('seq').style.setProperty('--lane-color', color);
  setText($('seq-title'), jam ? 'Jam' : `Track ${sel + 1}`);
  btn.jam.classList.toggle('on', jam);
  document.body.classList.toggle('jam', jam);
  if (instSelect.value !== audio.instruments[sel] && document.activeElement !== instSelect) instSelect.value = audio.instruments[sel];
  const bars = view.length / bpb;
  setText($('seq-len'), bars ? `${bars}-bar loop` : engine.tracks[sel].notes.length ? 'recording…' : 'empty');
  setText($('pos'), engine.playing ? `${Math.floor(view.head / bpb) + 1}.${Math.floor(view.head % bpb) + 1}` : '1.1');
  drawRoll($('roll'), view, bpb, isAudio(sel) ? AUDIO_ROWS : rowsFor(sel), color);

  // Playing panel: keyboard or kit for the selected track; colour and lights follow it
  document.body.dataset.inst = drums ? 'drums' : isAudio(sel) ? 'audio' : 'pitched';   // also picks the Note button's picture
  document.body.style.setProperty('--kb-color', inst(sel).color);
  document.body.classList.toggle('kb-open', notePanel);
  btn.note.classList.toggle('page-on', notePanel);
  setText(btn.note.querySelector('.plabel'), notePanel ? 'Hide' : 'Play');
  setText($('oct'), isAudio(sel) ? `Input: ${inst(sel).input ?? 'none'}`
    : isMidi(sel) ? `Out: ${inst(sel).output ?? 'none'} · ch ${inst(sel).channel} · Octave C${octaves[sel]}`
    : drums ? '' : `Octave C${octaves[sel]}`);
  if (notePanel) {
    $('keyboard').hidden = drums || isAudio(sel);
    $('kit').hidden = !drums;
    $('kb-audio').hidden = !isAudio(sel);
    setText($('kb-track'), `Track ${sel + 1}`);
    setText($('kb-inst'), nameOf(sel));
    setText($('kb-oct'), drums || isAudio(sel) ? '' : `C${octaves[sel]}–B${octaves[sel] + 1}`);
    const down = new Set();
    for (const p of pressed.values()) if (p.track === sel) down.add(keyFor(sel, p.note));
    const fromLoop = new Set([...engine.loopSounding(sel)].map(n => keyFor(sel, n)));
    if (drums) {
      const names = inst(sel).padNames;
      kitEls.forEach((d, i) => {
        setText(d.querySelector('.kname'), names ? names[i] || '—' : KIT[i].name);
        d.classList.toggle('empty', !!names && !names[i]);
        d.classList.toggle('down', down.has(i));
        d.classList.toggle('loop', fromLoop.has(i));
      });
    } else {
      keyEls.forEach(({ el: k, name }, s) => {
        setText(name, s % 12 === 0 ? `C${octaves[sel] + s / 12}` : NOTE_NAMES[s % 12]);
        k.classList.toggle('down', down.has(s));
        k.classList.toggle('loop', fromLoop.has(s));
      });
    }
  }

  document.body.classList.add('ready');          // built: show the panel (hidden till now, so nothing shifts)
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ---- Novation Circuit Tracks control surface (patched firmware) ---------------
// ---- projects --------------------------------------------------------------------
const session = setupSession({
  engine, audio, actions, octaves, presetOn, kitOn, audioOn, midiOn, makeClip, DEFAULTS, DEFAULT_KIT, INSTRUMENTS,
  ensureAudio: (name, input) => audioPage.ensure(name, input),
  ensureMidi: (name, settings) => midiPage.ensure(name, settings),
  beforeRestore: () => Promise.all([kitPage.refresh(), instPage.refresh()]),
});
const audioPage = setupAudioInstruments({
  root: $('page-audio'), audio, engine, inputs, audioOn, session,
  onChanged(change) {
    fillInstruments();
    if (change?.renamed) audio.instruments.forEach((n, t) => { if (n === change.renamed[0]) audio.instruments[t] = change.renamed[1]; });
    if (change?.key) audio.instruments.forEach((n, t) => { if (n === change.key) connectAudioInput(t); });   // its input may have changed
  },
});
const midiPage = setupMidiInstruments({
  root: $('page-midi'), audio, engine, midiOn, session,
  onChanged(change) {
    fillInstruments();
    if (change?.renamed) audio.instruments.forEach((n, t) => { if (n === change.renamed[0]) audio.instruments[t] = change.renamed[1]; });
  },
});
fillInstruments();                       // now with this computer's audio and MIDI instruments
const instPage = setupInstrumentPage({ root: $('page-presets'), audio, engine, presetOn, session, inputs, onChanged: () => fillInstruments() });
const kitPage = setupKitPage({ root: $('page-kits'), audio, engine, kitOn, session, onKitsChanged: fillInstruments, builtInKits });
session.store.onGranted = () => { kitPage.refresh(); instPage.refresh(); };   // folder allowed: your kits and instruments
instPage.refresh();
// The project's name in the logo row (• = unsaved changes); Save lights up when there are some.
setInterval(() => {
  const dirty = session.dirty();
  setText($('project'), session.name() ?? 'Untitled');
  $('project').classList.toggle('dirty', dirty);
  btn.save.classList.toggle('on', dirty);
}, 300);

const app = {
  engine, audio, actions, press, release, noteFor, isDrums, isAudio, isMidi, isSynth, soundBlocked, levels, kitPad, pageCards,
  fxBypass: () => fxPage.bypass(),
  // The page whose columns the Circuit's 8 knobs turn (FX, Synth): { nudge, codes, values }.
  knobPage: () => (page === 'fx' ? fxPage : page === 'synth' && isSynth(engine.selected) ? synthPage : null),
  pageControls: () => (page === 'presets' ? instPage.controls() : null),   // the instrument maker
  circuitShift: false,
  flashing: false,               // Settings › Firmware is talking to the Circuit in recovery mode
  notePanel: () => notePanel,
  session,
  settings,
  page: () => page,
  jam: () => jam,
  canTranspose: () => !isDrums(engine.selected) && !isAudio(engine.selected) && engine.tracks[engine.selected].notes.length > 0,
  holding: null,                 // the Circuit button being held for its hold action ('tempo')
  heldNotes: t => [...pressed.values()].filter(p => p.track === t).map(p => p.note),
  onStatus: text => {                    // the logo's badge glows green while the Circuit is connected
    $('circuit').classList.toggle('on', text === 'connected');
    $('circuit').title = `Circuit: ${text}`;
  },
};
connectCircuit(app);
window.looper = app; // for debugging from the console

// The release, in the GitHub link's tooltip (version.json says "dev" here; the release workflow
// writes the tag into it).
fetch('version.json', { cache: 'no-store' }).then(r => r.json()).then(({ version }) => {
  const gh = document.querySelector('.gh');
  if (gh && version) gh.title = `Source code on GitHub · ${version}`;
}).catch(() => {});
// ---- what's on screen, in the address ------------------------------------------------
// #<track>[/<page>[/<settings page>]][/keys], e.g. #3/fx, #1/settings/midi, #0 (Jam), #2/keys, so
// a refresh comes back to the same view. Replaced as it changes, so Back still leaves the looper.
const URL_PAGE = { presets: 'instruments' };
function viewHash() {
  const parts = [jam ? 0 : engine.selected + 1];
  if (page !== 'looper') parts.push(URL_PAGE[page] ?? page);
  if (page === 'settings') parts.push(settings.pages[settings.page()].name.toLowerCase());
  if (notePanel) parts.push('keys');
  return '#' + parts.join('/');
}
function saveView() {
  if (tour.isOpen()) return;                 // the guide's screens aren't yours: the address keeps yours
  const h = viewHash();
  if (location.hash !== h) history.replaceState(null, '', h);
}
function loadView() {
  const parts = decodeURIComponent(location.hash.slice(1)).split('/').filter(Boolean);
  if (!parts.length) return;
  const t = Number(parts.shift());
  if (t === 0) jam = true; else if (t >= 1 && t <= TRACKS) { jam = false; engine.select(t - 1); }
  if (parts.at(-1) === 'keys') { parts.pop(); notePanel = true; }
  const p = parts.shift();
  const name = Object.keys(URL_PAGE).find(k => URL_PAGE[k] === p) ?? p;
  if (['presets', 'kits', 'audio', 'midi', 'fx', 'synth', 'settings'].includes(name)) page = name;
  if (page === 'settings' && parts[0]) {
    const i = settings.pages.findIndex(pg => pg.name.toLowerCase() === parts[0]);
    if (i >= 0) settings.selectPage(i);
  }
}
loadView();                                  // the track, page and panel from the address...
const view = location.hash;
session.startup().then(() => {               // ...then the last project (or the default template)
  if (location.hash !== view) { history.replaceState(null, '', view); loadView(); }   // e.g. its synth page once it has its synth tracks
  requestAnimationFrame(() => requestAnimationFrame(() => tour.startup()));   // the guide, once the panel's drawn
});
