import { Engine } from './engine.js';
import { AudioOut } from './audio.js';
import { KEYS, NOTE_NAMES, isBlack, keyLetter } from './keys.js';
import { INSTRUMENTS, DRUM_BASE, DRUM_SHORT, drumIndex } from './instruments.js';
import { drawRoll } from './roll.js';
import { connectCircuit } from './circuit.js';

// One per track, laid out like the Circuit's track buttons: Synth 1-2, MIDI 1-2, Drum 1-4.
// Separate drum tracks let drum parts have their own loop lengths (1-bar kick, 2-bar hats...).
const DEFAULTS = ['synth', 'bass', 'keys', 'pad', 'drums', 'drums', 'drums', 'drums'];
const TRACKS = DEFAULTS.length;

const audio = new AudioOut(TRACKS);
DEFAULTS.forEach((inst, t) => (audio.instruments[t] = inst));
const engine = new Engine(audio, TRACKS);
setInterval(() => engine.tick(), 25);

const $ = id => document.getElementById(id);
const inst = t => INSTRUMENTS[audio.instruments[t]];
const isDrums = t => !!inst(t).drums;

// ---- keyboard octave (per track) ---------------------------------------------

const octaves = DEFAULTS.map(name => INSTRUMENTS[name].octave ?? 4);
const baseNote = t => (octaves[t] + 1) * 12; // octave 4 -> C4 = 60
// MIDI note that on-screen key `s` (0-11) plays on track t
const noteFor = (t, s) => (isDrums(t) ? DRUM_BASE + s : baseNote(t) + s);
// On-screen key (0-11) that shows `note` on track t, or -1
const keyFor = (t, note) => {
  if (isDrums(t)) return drumIndex(note);
  const s = note - baseNote(t);
  return s >= 0 && s < 12 ? s : -1;
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
  octave(d) {
    const t = engine.selected;
    octaves[t] = Math.max(0, Math.min(7, octaves[t] + d));
  },
  select(t) { engine.select(t); },
  instrument(t, name) {
    audio.setInstrument(t, name);
    if (INSTRUMENTS[name].octave != null) octaves[t] = INSTRUMENTS[name].octave;
  },
};

$('play').onclick = actions.play;
$('rec').onclick = actions.record;
$('undo').onclick = actions.undo;
$('clear').onclick = e => (e.shiftKey ? actions.clearAll() : actions.clearTrack());
$('click').onclick = actions.click;
$('tempo-up').onclick = () => actions.tempo(1);
$('tempo-down').onclick = () => actions.tempo(-1);
$('oct-up').onclick = () => actions.octave(1);
$('oct-down').onclick = () => actions.octave(-1);

// ---- track buttons + the selected track's sequencer -----------------------------

const tbtns = [];
for (let t = 0; t < TRACKS; t++) {
  const el = document.createElement('button');
  el.className = 'tbtn';
  el.title = `Track ${t + 1} (${t + 1})`;
  el.innerHTML = `<span class="tnum">${t + 1}</span><span class="tname"></span><span class="tlen"></span><i class="tdot"></i>`;
  el.addEventListener('click', () => actions.select(t));
  $('trackbar').appendChild(el);
  tbtns.push({ el, name: el.querySelector('.tname'), len: el.querySelector('.tlen'), dot: el.querySelector('.tdot') });
}

const instSelect = $('inst');
instSelect.innerHTML = Object.entries(INSTRUMENTS).map(([k, v]) => `<option value="${k}">${v.name}</option>`).join('');
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
    return { count: 12, rowOf: drumIndex, label: i => DRUM_SHORT[i], major: i => i === 0 || i === 2 || i === 6, black: isBlack };
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

const keyEls = [];
let white = 0;
for (let s = 0; s < 12; s++) {
  const el = document.createElement('div');
  const black = isBlack(s);
  el.className = black ? 'key black' : 'key white';
  el.innerHTML = `<span class="letter">${keyLetter(s)}</span><span class="name"></span>`;
  if (black) el.style.left = `calc(${(white / 7) * 100}% - var(--black-w) / 2)`;
  else white++;
  el.addEventListener('pointerdown', e => {
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    audio.resume();
    press(`ptr${e.pointerId}`, s);
  });
  el.addEventListener('pointerup', e => release(`ptr${e.pointerId}`));
  el.addEventListener('pointercancel', e => release(`ptr${e.pointerId}`));
  $('keyboard').appendChild(el);
  keyEls.push({ el, name: el.querySelector('.name') });
}

// ---- computer keyboard ----------------------------------------------------

window.addEventListener('keydown', e => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.target instanceof HTMLSelectElement) e.target.blur();
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

// ---- render loop ------------------------------------------------------------

const beatDots = [...document.querySelectorAll('#beats i')];

function status() {
  const bpb = engine.beatsPerBar;
  const track = `track ${engine.recTrack + 1}`;
  switch (engine.rec) {
    case 'armed':
      return `Armed · ${track} · starts on your first note`;
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
  setText($('bpm'), String(engine.bpm));
  setText($('status'), status());
  $('play').classList.toggle('on', engine.playing);
  setText($('play').querySelector('.icon'), engine.playing ? '■' : '▶');
  $('rec').dataset.state = engine.rec;
  $('click').classList.toggle('on', engine.click);
  document.body.dataset.rec = engine.rec;
  const beatIdx = engine.playing && b >= 0 ? Math.floor(b % bpb) : -1;
  beatDots.forEach((d, i) => d.classList.toggle('on', i === beatIdx));

  // Track buttons
  const recTrack = engine.rec !== 'idle' ? engine.recTrack : -1;
  tbtns.forEach((tb, t) => {
    const len = engine.tracks[t].loop ? engine.tracks[t].loop.length / bpb : 0;
    const sounding = engine.loopSounding(t).size > 0 || [...pressed.values()].some(p => p.track === t);
    tb.el.style.setProperty('--c', inst(t).color);
    tb.el.classList.toggle('selected', t === sel);
    tb.el.classList.toggle('rec', t === recTrack);
    tb.el.classList.toggle('empty', !engine.tracks[t].notes.length);
    tb.dot.classList.toggle('on', sounding);
    setText(tb.name, inst(t).name);
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
  drawRoll($('roll'), view, bpb, rowsFor(sel), color);

  // Keyboard: labels, colour and lights follow the selected track
  const drums = isDrums(sel);
  document.body.dataset.inst = drums ? 'drums' : 'pitched';
  document.body.style.setProperty('--kb-color', inst(sel).color);
  setText($('kb-track'), `Track ${sel + 1} · ${inst(sel).name}`);
  setText($('oct'), drums ? '—' : `C${octaves[sel]}`);
  $('oct-up').disabled = drums || octaves[sel] >= 7;
  $('oct-down').disabled = drums || octaves[sel] <= 0;

  const down = new Set();
  for (const p of pressed.values()) if (p.track === sel) down.add(keyFor(sel, p.note));
  const fromLoop = new Set([...engine.loopSounding(sel)].map(n => keyFor(sel, n)));
  keyEls.forEach(({ el, name }, s) => {
    setText(name, drums ? DRUM_SHORT[s] : NOTE_NAMES[s] + (s === 0 ? octaves[sel] : ''));
    el.classList.toggle('down', down.has(s));
    el.classList.toggle('loop', fromLoop.has(s));
  });

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ---- Novation Circuit Tracks control surface (patched firmware) ---------------
const app = {
  engine, audio, actions, press, release, noteFor, isDrums, soundBlocked,
  heldNotes: t => [...pressed.values()].filter(p => p.track === t).map(p => p.note),
  onStatus: text => {
    $('circuit').textContent = `Circuit: ${text}`;
    $('circuit').classList.toggle('on', text === 'connected');
  },
};
connectCircuit(app);
window.looper = app; // for debugging from the console
