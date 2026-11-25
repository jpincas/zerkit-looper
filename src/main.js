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

// One per track, laid out like the Circuit's track buttons: Synth 1-2, MIDI 1-2, Drum 1-4.
// Separate drum tracks let drum parts have their own loop lengths (1-bar kick, 2-bar hats...).
const DEFAULTS = ['synth', 'bass', 'keys', 'pad', 'drums', 'drums', 'drums', 'drums'];
const TRACKS = DEFAULTS.length;

const audio = new AudioOut(TRACKS);
DEFAULTS.forEach((inst, t) => (audio.instruments[t] = inst));
const engine = new Engine(audio, TRACKS);
setInterval(() => engine.tick(), 25);

const $ = id => document.getElementById(id);

// Pages: the pad area shows the Looper, or the Presets or Kits page.
let page = 'looper';
// Presets the Preset button cycles through (all to start with). Will be saved per project.
const presetOn = Object.fromEntries(Object.keys(INSTRUMENTS).map(k => [k, true]));
// Kits the Kits button cycles through ("kit:<name>" -> on/off; kits start on). Saved per project.
const kitOn = {};
const clamp01 = v => Math.max(0, Math.min(1, v));
const inst = t => INSTRUMENTS[audio.instruments[t]];
const isDrums = t => !!inst(t).drums;
const isAudio = t => !!inst(t).audio;

// ---- keyboard octave (per track) ---------------------------------------------

const octaves = DEFAULTS.map(name => INSTRUMENTS[name].octave ?? 4);
const baseNote = t => (octaves[t] + 1) * 12; // octave 4 -> C4 = 60
// What key `s` plays on track t: on synth tracks the s-th semitone of the two-octave keyboard
// (0-23, from the track's octave); on drum tracks kit pad s (0-15).
const noteFor = (t, s) => (isDrums(t) ? KIT[s % KIT.length].note : baseNote(t) + s);
// The key (keyboard semitone or kit pad) that shows `note` on track t, or -1
const keyFor = (t, note) => {
  if (isDrums(t)) return kitPad(note);
  const s = note - baseNote(t);
  return s >= 0 && s < 24 ? s : -1;
};

// ---- actions (shared by keyboard shortcuts and on-screen controls) ------------

const actions = {
  play() { audio.resume(); engine.playing ? engine.stop() : engine.start(); },
  record() { audio.resume(); engine.toggleRecord(); },
  undo() { engine.undo(); },
  clearTrack() { engine.clearTrack(engine.selected); },
  clearAll() { engine.clearAll(); },
  click() { engine.click = !engine.click; },
  tempo(d) { engine.setTempo(engine.bpm + d); },
  swing(d) { engine.setSwing(engine.swing + d); },
  // Shift + Octave: move the selected track's recorded notes by an octave (synth tracks only:
  // drums map every octave onto the same pads, and audio would need a pitch-shifter).
  transpose(d) {
    const t = engine.selected;
    if (!isDrums(t) && !isAudio(t)) engine.transpose(t, 12 * d);
  },
  octave(d) {
    const t = engine.selected;
    octaves[t] = Math.max(0, Math.min(7, octaves[t] + d));
  },
  select(t) { engine.select(t); },
  volume(t, d) { actions.setVolume(t, audio.vol[t] + d); },
  setVolume(t, v) { audio.vol[t] = clamp01(v); audio.mix(); },
  pan(t, d) { audio.setPan(t, audio.pan[t] + d); },
  setPan(t, v) { audio.setPan(t, v); },
  mute(t) { audio.mute[t] = !audio.mute[t]; audio.mix(); },
  solo(t) { audio.solo[t] = !audio.solo[t]; audio.mix(); },
  quant() { engine.cycleQuant(engine.selected); },          // the selected track's record quantise
  // Preset: the selected track's next preset among those switched on in the Presets page.
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
  togglePage(name) { page = page === name ? 'looper' : name; },
  // Browser sounds (synths, drums, click) against audio tracks, and the overall output. Both 0-1,
  // remembered in this browser.
  internalLevel(v) { levels.internal = clamp01(v); audio.setSynthLevel(levels.internal); saveLevels(); },
  masterVolume(v) { levels.master = clamp01(v); audio.setMasterVolume(levels.master); saveLevels(); },
  instrument(t, name) {
    audio.setInstrument(t, name);
    if (INSTRUMENTS[name].octave != null) octaves[t] = INSTRUMENTS[name].octave;
    if (INSTRUMENTS[name].audio && !trackInput[t]) chooseDefaultInput(t);
  },
};

// ---- the panel (laid out like the Circuit Tracks) ------------------------------------

const levels = { internal: 0.4, master: 0.8 };
try {
  const saved = JSON.parse(localStorage.getItem('levels') ?? 'null');
  if (saved) Object.assign(levels, saved);
  else if (localStorage.getItem('synthLevel') != null) levels.internal = Number(localStorage.getItem('synthLevel')) / 100;
} catch {}
function saveLevels() { try { localStorage.setItem('levels', JSON.stringify(levels)); } catch {} }
audio.setSynthLevel(levels.internal);
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
function makeKnob(parent, { label, title, get, set, dflt, shift }) {
  const k = el('div', 'knob', `<div class="dial"><i></i></div>`
    + (shift ? '<span class="pan"><i></i><b></b></span>' : `<span class="klabel">${label}</span>`));
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
  const pan = k.querySelector('.pan');
  return {
    el: k, label: k.querySelector('.klabel'),
    update(color) {
      dial.style.setProperty('--v', get().toFixed(3));
      if (pan) pan.style.setProperty('--p', shift.get().toFixed(3));
      if (color) k.style.setProperty('--c', color);
    },
  };
}

const masterKnob = makeKnob($('master-vol'), {
  label: 'Master', title: 'Master volume: everything the looper plays. The Circuit\'s master volume knob turns it. Drag or scroll; double-click to reset.',
  get: () => levels.master, set: actions.masterVolume, dflt: 0.8,
});
const internalKnob = makeKnob($('master-int'), {
  label: 'Internal sounds', title: 'Level of the built-in sounds (synths, drums, click) against audio tracks. The Circuit\'s master filter knob turns it.',
  get: () => levels.internal, set: actions.internalLevel, dflt: 0.4,
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
  [3, 1, 'scales', { tap: 'Scales' }],
  [3, 2, 'octDown', { tap: 'Octave ▼', shift: 'Track ▼', act: e => (shifted(e) ? actions.transpose(-1) : actions.octave(-1)),
    title: 'Tap: keyboard octave down (,). Shift: move the selected track\'s notes down an octave' }],
  [3, 3, 'octUp', { tap: 'Octave ▲', shift: 'Track ▲', act: e => (shifted(e) ? actions.transpose(1) : actions.octave(1)),
    title: 'Tap: keyboard octave up (.). Shift: move the selected track\'s notes up an octave' }],
  [3, 4, 'quant', { tap: 'Q', act: () => actions.quant(), title: 'Record quantise for the selected track: off → 32nds → 16ths (each track button shows its own)' }],
  [3, 5, 'tempo', { tap: 'Click', shift: 'Swing', shiftHold: true, hold: 'Tempo', act: () => actions.click(),
    title: 'Tap: the metronome (C). Hold + turn the master filter knob (or scroll over it): tempo (↑ ↓). Shift + hold + turn (or Shift + scroll): swing' }],
  [3, 6, 'clear', { tap: 'Undo', shift: 'Clear track', act: e => (shifted(e) ? actions.clearTrack() : actions.undo()),
    title: 'Tap: undo the last recording (Z). Shift: clear the selected track (⌫)' }],
  [3, 7, 'duplicate', { tap: 'Duplicate' }],
  [3, 8, 'save', { tap: 'Save', shift: 'Save as', act: e => (shifted(e) ? session.saveAs() : session.save()),
    title: 'Tap: save the project (⌘S; the first time, name it). Shift: save as (⇧⌘S)' }],
  [3, 9, 'open', { tap: 'Open', shift: 'New', act: e => (shifted(e) ? session.newProject() : session.open()),
    title: 'Tap: open a recent project (⌘O). Shift: start a new project' }],
  [3, 10, 'shift', { tap: 'Shift', act: () => (shiftLatch = !shiftLatch), title: 'Shift: hold the Shift key, or click this for the next press' }],
  [4, 1, 'preset', { tap: 'Preset', shift: 'Presets page', act: e => (shifted(e) ? actions.togglePage('presets') : actions.nextInstrument(1)),
    title: 'Tap: the selected track\'s next preset (of those switched on in the Presets page). Shift: open the Presets page, or go back to the Looper' }],
  [4, 10, 'kits', { tap: 'Kits', shift: 'Kits page', act: e => (shifted(e) ? actions.togglePage('kits') : actions.nextKit()),
    title: 'Tap: the selected track\'s next kit (of those switched on in the Kits page). Shift: open the Kits page, or go back to the Looper' }],
  [5, 1, 'note', { tap: 'Show', act: () => actions.toggleNotes(),
    title: 'Show or hide the keyboard (synth tracks) or kit pads (drum tracks) under the looper' }],
  [6, 1, 'velocity', { tap: 'Velocity' }],
  [7, 1, 'gate', { tap: 'Gate' }],
  [8, 1, 'patternSettings', { tap: 'Pattern Settings' }],
  [5, 10, 'mixer', { tap: 'Mixer' }],
  [6, 10, 'fx', { tap: 'FX' }],
  [7, 10, 'record', { tap: 'Record', act: () => actions.record(), title: 'Record (X)' }],
  [8, 10, 'play', { tap: 'Play', act: () => actions.play(), title: 'Play / Stop (Space)' }],
]) {
  const b = makeButton(row === 3 && col > 1 && col < 10 ? $('aux') : $('device'), { ...def, cls: key });
  if (b.parentElement.id === 'device') { b.style.gridRow = row; b.style.gridColumn = col; }
  btn[key] = b;
}
btn.tempo.addEventListener('wheel', e => {
  e.preventDefault();
  const d = e.deltaY < 0 ? 1 : -1;
  e.shiftKey || shiftDown() ? actions.swing(d) : actions.tempo(d);
}, { passive: false });

// Track buttons, then mute and solo pads under each.
const tbtns = [];
for (let t = 0; t < TRACKS; t++) {
  const b = el('button', 'tbtn', `<span class="tnum">${t + 1}</span><i class="tdot"></i><span class="tname"></span><span class="tlen"></span><b class="tq"></b>`);
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
  tbtns.push({ el: b, name: b.querySelector('.tname'), len: b.querySelector('.tlen'), dot: b.querySelector('.tdot'), q: b.querySelector('.tq'), m, s: so });
}

const instSelect = $('inst');
// The instrument menu: presets, then kits. Rebuilt when kits are added.
function fillInstruments() {
  const opt = ([k, v]) => `<option value="${k}">${v.name.replace(/</g, '&lt;')}</option>`;
  const all = Object.entries(INSTRUMENTS), kits = all.filter(([, v]) => v.kit);
  instSelect.innerHTML = all.filter(([, v]) => !v.kit).map(opt).join('')
    + (kits.length ? `<optgroup label="Kits">${kits.sort((a, b) => a[0].localeCompare(b[0])).map(opt).join('')}</optgroup>` : '');
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
  if (pressed.has(src)) return;
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

// The playing panel under the looper (Note): a two-octave keyboard on synth tracks, the 16-pad
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
  switch (e.code) {
    case 'Space': actions.play(); break;
    case 'KeyX': actions.record(); break;
    case 'KeyZ': actions.undo(); break;
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

const inputSelect = $('input');
let inputOptionsKey = '';
function syncInputSelect(t) {
  const key = inputs.devices.map(d => d.deviceId + d.label).join('|');
  if (key !== inputOptionsKey) {
    inputOptionsKey = key;
    const named = inputs.devices.length && inputs.devices[0].label !== 'Audio input';
    inputSelect.innerHTML = (named ? '' : '<option value="">Allow audio input…</option>')
      + inputs.devices.map(d => `<option value="${d.deviceId}">${d.label}</option>`).join('');
  }
  const want = trackInput[t] ?? '';
  if (inputSelect.value !== want && document.activeElement !== inputSelect) inputSelect.value = want;
}
inputSelect.addEventListener('change', async () => {
  const t = engine.selected;
  if (!inputSelect.value) { await chooseDefaultInput(t); inputSelect.blur(); return; }
  await useInput(t, inputSelect.value);
  inputSelect.blur();
});
inputs.list();

// ---- MIDI keyboards ------------------------------------------------------------
// Play the selected track's sound (audio tracks ignore them: those record their input).
// The sustain pedal holds notes like a piano: a key let go while it's down keeps sounding
// until the pedal comes up, and is recorded that long.
let sustain = false;
const sustained = new Set();                       // keyboard notes let go while the pedal was down
connectMidiKeyboards({
  onNote(note, vel) {
    const src = `midi:${note}`;
    if (!vel) {
      if (sustain && pressed.has(src)) sustained.add(src); else release(src);
      return;
    }
    sustained.delete(src);
    release(src);                                  // same key again: restart it
    const track = engine.selected;
    if (isAudio(track)) return;
    pressed.set(src, { track, note });
    engine.noteOn(track, note, vel);
  },
  onSustain(down) {
    sustain = down;
    if (down) return;
    for (const src of sustained) release(src);
    sustained.clear();
  },
  onStatus: text => {
    $('midi-in').textContent = `MIDI in: ${text}`;
    $('midi-in').classList.toggle('on', !/none|refused|no Web/.test(text));
  },
});

// ---- pages ----------------------------------------------------------------------

// Presets page: one card per preset, with its switch for cycling and the tracks using it.
const presetCards = Object.entries(INSTRUMENTS).filter(([, def]) => !def.kit).map(([name, def]) => {
  const card = el('button', 'preset-card', `<i class="swatch"></i><span class="pc-name">${def.name}</span>`
    + `<span class="pc-use"></span><span class="pc-switch"><i></i></span>`);
  card.style.setProperty('--c', def.color);
  card.title = `${def.name}: click to switch it in or out of Preset's cycle`;
  card.addEventListener('click', () => actions.togglePreset(name));
  $('preset-list').appendChild(card);
  return { name, card, use: card.querySelector('.pc-use') };
});

function drawPage() {
  document.body.dataset.page = page;
  btn.preset.classList.toggle('page-on', page === 'presets');
  btn.kits.classList.toggle('page-on', page === 'kits');
  for (const id of ['mute-row', 'solo-row', 'seq']) $(id).hidden = page !== 'looper';
  $('page-presets').hidden = page !== 'presets';
  const kitsShown = !$('page-kits').hidden;
  $('page-kits').hidden = page !== 'kits';
  if (page === 'kits') { if (!kitsShown) kitPage.show(); kitPage.update(); }
  if (page !== 'presets') return;
  for (const { name, card, use } of presetCards) {
    card.classList.toggle('on', presetOn[name]);
    card.classList.toggle('current', audio.instruments[engine.selected] === name);
    const tracks = audio.instruments.map((n, t) => (n === name ? t + 1 : 0)).filter(Boolean);
    setText(use, tracks.length ? `Track${tracks.length > 1 ? 's' : ''} ${tracks.join(', ')}` : 'Not in use');
  }
}

// ---- render loop ------------------------------------------------------------

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

  $('sound-gate').hidden = !soundBlocked();
  setText($('status'), status());
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
  setText(btn.tempo.querySelector('.pval'), `${engine.bpm} · ${engine.swing}%`);
  btn.clear.classList.toggle('on', !engine.isEmpty());
  btn.shift.classList.toggle('on', shiftDown());
  document.body.classList.toggle('shift', shiftDown());
  btn.tempo.classList.toggle('holding', app.holding === 'tempo');        // held on the Circuit
  const drums = isDrums(sel);
  // With Shift down they transpose the track instead, which needs recorded notes on a synth track.
  const canMove = app.canTranspose();
  btn.octUp.disabled = shiftDown() ? !canMove : drums || octaves[sel] >= 7;
  btn.octDown.disabled = shiftDown() ? !canMove : drums || octaves[sel] <= 0;
  drawPage();

  // Knobs
  masterKnob.update();
  internalKnob.update();
  volKnobs.forEach((k, t) => k.update(inst(t).color));

  // Track buttons
  const recTrack = engine.rec !== 'idle' ? engine.recTrack : -1;
  tbtns.forEach((tb, t) => {
    const len = engine.tracks[t].loop ? engine.tracks[t].loop.length / bpb : 0;
    const sounding = engine.loopSounding(t).size > 0 || [...pressed.values()].some(p => p.track === t);
    tb.el.style.setProperty('--c', inst(t).color);
    tb.el.classList.toggle('selected', t === sel);
    tb.el.classList.toggle('rec', t === recTrack);
    tb.el.classList.toggle('empty', !engine.tracks[t].notes.length);
    tb.dot.classList.toggle('on', sounding && audio.audible(t));
    tb.el.classList.toggle('silent', !audio.audible(t));
    tb.m.classList.toggle('on', audio.mute[t]);
    tb.s.classList.toggle('on', audio.solo[t]);
    setText(tb.name, inst(t).name);
    tb.q.dataset.q = engine.tracks[t].quant;
    setText(tb.q, { off: 'Q off', mid: 'Q 32', strong: 'Q 16' }[engine.tracks[t].quant]);
    setText(tb.len, len ? `${len} bar${len > 1 ? 's' : ''}` : '—');
  });

  // The selected track's sequencer
  const view = engine.view(sel);
  const { color } = inst(sel);
  $('seq').style.setProperty('--lane-color', color);
  setText($('seq-title'), `Track ${sel + 1}`);
  if (instSelect.value !== audio.instruments[sel] && document.activeElement !== instSelect) instSelect.value = audio.instruments[sel];
  const bars = view.length / bpb;
  setText($('seq-len'), bars ? `${bars}-bar loop` : engine.tracks[sel].notes.length ? 'recording…' : 'empty');
  setText($('pos'), engine.playing ? `${Math.floor(view.head / bpb) + 1}.${Math.floor(view.head % bpb) + 1}` : '1.1');
  drawRoll($('roll'), view, bpb, isAudio(sel) ? AUDIO_ROWS : rowsFor(sel), color);
  $('input').hidden = !isAudio(sel);
  syncInputSelect(sel);

  // Playing panel: keyboard or kit for the selected track; colour and lights follow it
  document.body.dataset.inst = drums ? 'drums' : isAudio(sel) ? 'audio' : 'pitched';   // also picks the Note button's picture
  document.body.style.setProperty('--kb-color', inst(sel).color);
  document.body.classList.toggle('kb-open', notePanel);
  btn.note.classList.toggle('page-on', notePanel);
  setText(btn.note.querySelector('.plabel'), notePanel ? 'Hide' : 'Show');
  setText($('oct'), drums || isAudio(sel) ? '' : `Octave C${octaves[sel]}`);
  if (notePanel) {
    $('keyboard').hidden = drums || isAudio(sel);
    $('kit').hidden = !drums;
    $('kb-audio').hidden = !isAudio(sel);
    setText($('kb-track'), `Track ${sel + 1}`);
    setText($('kb-inst'), inst(sel).name);
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

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ---- Novation Circuit Tracks control surface (patched firmware) ---------------
let circuitStatus = '…';
setInterval(() => {
  const mode = circuitStatus === 'connected' && app.circuitMode?.() === 'note' ? ' · Note mode' : '';
  setText($('circuit'), `Circuit: ${circuitStatus}${mode}`);
}, 100);
// ---- projects --------------------------------------------------------------------
const session = setupSession({
  engine, audio, actions, octaves, trackInput, presetOn, kitOn, makeClip, inputs, useInput, chooseDefaultInput, DEFAULTS, INSTRUMENTS,
  beforeRestore: () => kitPage.refresh(),
});
const kitPage = setupKitPage({ root: $('page-kits'), audio, engine, kitOn, session, onKitsChanged: fillInstruments });
// The project's name in the status strip (• = unsaved changes); Save lights up when there are some.
setInterval(() => {
  const dirty = session.dirty();
  setText($('project'), session.name() ?? 'Untitled');
  $('project').classList.toggle('dirty', dirty);
  btn.save.classList.toggle('on', dirty);
}, 300);

const app = {
  engine, audio, actions, press, release, noteFor, isDrums, soundBlocked, levels, kitPad,
  circuitShift: false,
  notePanel: () => notePanel,
  session,
  page: () => page,
  canTranspose: () => !isDrums(engine.selected) && !isAudio(engine.selected) && engine.tracks[engine.selected].notes.length > 0,
  holding: null,                 // the Circuit button being held for its hold action ('tempo')
  heldNotes: t => [...pressed.values()].filter(p => p.track === t).map(p => p.note),
  onStatus: text => {
    circuitStatus = text;
    $('circuit').classList.toggle('on', text === 'connected');
  },
};
connectCircuit(app);
window.looper = app; // for debugging from the console
