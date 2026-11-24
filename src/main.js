import { Engine } from './engine.js';
import { AudioOut } from './audio.js';
import { KEYS, NOTE_NAMES, isBlack, keyLetter } from './keys.js';
import { INSTRUMENTS, DRUM_BASE, DRUM_SHORT, drumIndex } from './instruments.js';
import { drawRoll } from './roll.js';
import { connectCircuit } from './circuit.js';
import { AudioInputs } from './audioin.js';
import { connectMidiKeyboards } from './midiin.js';

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
const isAudio = t => !!inst(t).audio;

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
  volume(t, d) { audio.vol[t] = Math.max(0, Math.min(1, audio.vol[t] + d)); audio.mix(); },
  mute(t) { audio.mute[t] = !audio.mute[t]; audio.mix(); },
  solo(t) { audio.solo[t] = !audio.solo[t]; audio.mix(); },
  quant(t) { engine.cycleQuant(t); },
  instrument(t, name) {
    audio.setInstrument(t, name);
    if (INSTRUMENTS[name].octave != null) octaves[t] = INSTRUMENTS[name].octave;
    if (INSTRUMENTS[name].audio && !trackInput[t]) chooseDefaultInput(t);
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
  el.innerHTML = `<span class="tnum">${t + 1}</span><span class="tname"></span><span class="tlen"></span><i class="tdot"></i>`
    + `<span class="tms"><b class="tq"></b><b class="tm" title="Mute">M</b><b class="ts" title="Solo">S</b></span><i class="tvol"><i></i></i>`;
  el.addEventListener('click', e => {
    if (e.target.classList.contains('tm')) return actions.mute(t);
    if (e.target.classList.contains('ts')) return actions.solo(t);
    if (e.target.classList.contains('tq')) return actions.quant(t);
    actions.select(t);
  });
  // Scroll over a track button to change its volume.
  el.addEventListener('wheel', e => { e.preventDefault(); actions.volume(t, e.deltaY < 0 ? 0.03 : -0.03); }, { passive: false });
  $('trackbar').appendChild(el);
  tbtns.push({
    el, name: el.querySelector('.tname'), len: el.querySelector('.tlen'), dot: el.querySelector('.tdot'),
    q: el.querySelector('.tq'), m: el.querySelector('.tm'), s: el.querySelector('.ts'), vol: el.querySelector('.tvol i'),
  });
}

const instSelect = $('inst');
instSelect.innerHTML = Object.entries(INSTRUMENTS).map(([k, v]) => `<option value="${k}">${v.name}</option>`).join('');
// Blur after choosing so Space/arrows go back to the looper, not the dropdown.
instSelect.addEventListener('change', () => { actions.instrument(engine.selected, instSelect.value); instSelect.blur(); });

// Browsers keep audio paused until the page gets a click or key press (input from the
// Circuit doesn't count), so any click or key anywhere turns sound on.
const soundBlocked = () => audio.ctx.state !== 'running';
for (const ev of ['pointerdown', 'keydown']) window.addEventListener(ev, () => audio.resume(), { capture: true });

// Level of the browser sounds against audio tracks (which play at the level they were recorded).
// Remembered in this browser. Default 0.4 = gain 0.19.
const synthLevel = $('synth-level');
let savedLevel = 40;
try { savedLevel = Number(localStorage.getItem('synthLevel') ?? 40); } catch {}
synthLevel.value = String(savedLevel);
audio.setSynthLevel(savedLevel / 100);
synthLevel.addEventListener('input', () => {
  audio.setSynthLevel(synthLevel.value / 100);
  try { localStorage.setItem('synthLevel', synthLevel.value); } catch {}
});
synthLevel.addEventListener('change', () => synthLevel.blur());   // arrow keys go back to tempo

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
const inputLabel = t => inputs.devices.find(d => d.deviceId === trackInput[t])?.label || 'no input chosen';

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
// are worked out once the audio is complete.
function makeClip(pass, seconds, getBuffer) {
  let done = null, peaks = null;
  return {
    pass, seconds,
    buffer() { return done ?? getBuffer(b => (done = b)); },
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
    engine.addClip(t, makeClip(pass, seconds, () => layer));
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
    tb.dot.classList.toggle('on', sounding && audio.audible(t));
    tb.el.classList.toggle('silent', !audio.audible(t));
    tb.m.classList.toggle('on', audio.mute[t]);
    tb.s.classList.toggle('on', audio.solo[t]);
    const q = engine.tracks[t].quant;
    tb.q.dataset.q = q;
    setText(tb.q, { off: 'Q', mid: '32', strong: '16' }[q]);
    tb.q.title = `Record quantise: ${{ off: 'off', mid: '32nds', strong: '16ths' }[q]}. Click to change.`;
    tb.vol.style.width = `${Math.round(audio.vol[t] * 100)}%`;
    tb.el.title = `Track ${t + 1} (${t + 1}) · volume ${Math.round(audio.vol[t] * 100)}% · scroll to change`;
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
  drawRoll($('roll'), view, bpb, isAudio(sel) ? AUDIO_ROWS : rowsFor(sel), color);
  $('input').hidden = !isAudio(sel);
  syncInputSelect(sel);

  // Keyboard: labels, colour and lights follow the selected track
  const drums = isDrums(sel);
  document.body.dataset.inst = drums ? 'drums' : 'pitched';
  document.body.style.setProperty('--kb-color', inst(sel).color);
  setText($('kb-track'), `Track ${sel + 1} · ${isAudio(sel) ? inputLabel(sel) : inst(sel).name}`);
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
let circuitStatus = '…';
setInterval(() => {
  const mode = circuitStatus === 'connected' && app.circuitMode?.() === 'note' ? ' · Note mode' : '';
  setText($('circuit'), `Circuit: ${circuitStatus}${mode}`);
}, 100);
const app = {
  engine, audio, actions, press, release, noteFor, isDrums, soundBlocked,
  heldNotes: t => [...pressed.values()].filter(p => p.track === t).map(p => p.note),
  onStatus: text => {
    circuitStatus = text;
    $('circuit').classList.toggle('on', text === 'connected');
  },
};
connectCircuit(app);
window.looper = app; // for debugging from the console
