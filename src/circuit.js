// Novation Circuit Tracks (patched LOOP04 firmware) as the looper's control surface.
// Protocol: docs/circuit-protocol.md. Inputs arrive on channel 15; lights go out as SysEx F0 7D.
import { INSTRUMENTS } from './instruments.js';
import { isBlack } from './keys.js';

const BTN = { preset: 8, note: 9, quant: 21, record: 16, play: 17, octDown: 19, octUp: 20, tempo: 22, clear: 23, shift: 27 };
const TRACK_BTNS = [0, 1, 2, 3, 4, 5, 6, 7];     // Synth 1-2, MIDI 1-2, Drum 1-4 -> tracks 1-8
const N_LEDS = 69;
const ledBtn = id => 32 + id;
const KNOB_LED = 60;                             // + knob index

// Novation palette codes
const C = { off: 0, white: 0x01, dim: 0x02, red: 0x53, dimRed: 0x54, green: 0x17, amber: 0x2B };
// Knob lights: the track's colour, dimmed to its volume. Brightness goes to the firmware
// separately (LOOP05: F0 7D 03 60 b0..b8 F7, 127 = full, 0-126 = 10%-98%); LOOP04 ignores it.
const brightFor = vol => Math.round(127 * vol * vol);      // follows the track's gain (vol squared)
const QUANT_CODE = { off: C.red, mid: C.amber, strong: C.green };
const INST_CODE = { synth: 0x2B, bass: 0x45, pluck: 0x13, pad: 0x49, keys: 0x17, organ: 0x32, bell: 0x6A, drums: 0x4D,
  audio: 0x2D };

// Pads are numbered 0-31, row by row from the top-left, so column = track.
//   Track view: row 1 = mute (pads 0-7), row 2 = solo (8-15), rows 3-4 = 16-step view of the bar.
//   Note mode:  two octaves. Rows 1-2 = upper octave, rows 3-4 = lower; black keys above white keys.
const MUTE_ROW = 0, SOLO_ROW = 8, STEP_ROW = 16;
const WHITE = [0, 2, 4, 5, 7, 9, 11, 12];
const BLACK = { 1: 1, 2: 3, 4: 6, 5: 8, 6: 10 };
function noteModeSemitone(p) {
  const row = p >> 3, col = p & 7;
  const s = row % 2 ? WHITE[col] : BLACK[col];
  return s == null ? null : s + (row < 2 ? 12 : 0);
}

export function connectCircuit(app) {
  const { engine, audio, actions } = app;
  let out = null, inp = null, lastFrame = '', lastBright = '';
  let shift = false, noteMode = false;
  let quantHeld = false;                         // hold 1-16/17-32 + track button = cycle that track's quantise
  let tempoHeld = false, tempoTurned = false;    // hold Tempo + turn knob 1 = tempo; tap Tempo = click

  // ---- input ---------------------------------------------------------------
  function onMidi(ev) {
    const [s, a, b] = ev.data;
    if (s === 0x9E) return padDown(a, b);
    if (s === 0x8E) return app.release(`circuit${a}`);
    if (s !== 0xBE || a === 100) return;              // 100 = firmware health report
    if (a >= 20 && a < 48) return b ? buttonDown(a - 20) : buttonUp(a - 20);
    if (a >= 1 && a <= 8) return knob(a - 1, b >= 64 ? b - 128 : b);
  }

  function padDown(p, vel) {
    audio.resume();
    if (noteMode) {
      const s = noteModeSemitone(p);
      if (s != null) app.press(`circuit${p}`, s, Math.max(1, vel));
      return;
    }
    if (p < SOLO_ROW) return actions.mute(p - MUTE_ROW);
    if (p < STEP_ROW) return actions.solo(p - SOLO_ROW);
  }

  function buttonDown(id) {
    audio.resume();
    if (id === BTN.shift) { shift = true; return; }
    if (id === BTN.quant) { quantHeld = true; return; }
    if (TRACK_BTNS.includes(id)) return quantHeld ? actions.quant(id) : actions.select(id);
    switch (id) {
      case BTN.note: noteMode = !noteMode; return;
      case BTN.play: return actions.play();
      case BTN.record: return actions.record();
      case BTN.octDown: return actions.octave(-1);
      case BTN.octUp: return actions.octave(1);
      case BTN.tempo: tempoHeld = true; tempoTurned = false; return;
      case BTN.preset: return cycleInstrument(shift ? -1 : 1);
      case BTN.clear: return shift ? actions.clearTrack() : actions.undo();
    }
  }

  function buttonUp(id) {
    if (id === BTN.shift) shift = false;
    if (id === BTN.quant) quantHeld = false;
    if (id === BTN.tempo) {
      if (!tempoTurned) actions.click();
      tempoHeld = false;
    }
  }

  function knob(k, delta) {
    if (tempoHeld) {
      if (k === 0) { actions.tempo(delta); tempoTurned = true; }
      return;
    }
    actions.volume(k, delta * 0.02);                 // knob above each track = its volume
  }

  function cycleInstrument(dir) {
    const names = Object.keys(INSTRUMENTS);
    const t = engine.selected;
    const i = names.indexOf(audio.instruments[t]);
    actions.instrument(t, names[(i + dir + names.length) % names.length]);
  }

  // ---- lights ----------------------------------------------------------------
  function frame() {
    const f = new Array(N_LEDS).fill(C.off);
    const sel = engine.selected;
    const b = engine.beat();
    const blink = Math.floor(performance.now() / 250) % 2 === 0;
    const instCode = t => INST_CODE[audio.instruments[t]] ?? C.white;

    TRACK_BTNS.forEach(t => (f[ledBtn(t)] = quantHeld ? QUANT_CODE[engine.tracks[t].quant]
      : t === sel ? C.white : instCode(t)));
    f[ledBtn(BTN.quant)] = quantHeld ? C.white : C.dim;
    f[ledBtn(BTN.preset)] = instCode(sel);
    f[ledBtn(BTN.note)] = noteMode ? C.white : C.dim;
    f[ledBtn(BTN.play)] = app.soundBlocked?.() ? (blink ? C.red : C.off)     // sound blocked: click the page
      : engine.playing ? C.green : C.dim;
    f[ledBtn(BTN.record)] = {
      idle: engine.tracks[sel].loop ? C.dimRed : C.off,
      armed: blink ? C.red : C.off,
      recording: C.red,
      closing: blink ? C.red : C.dimRed,
      overdub: C.amber,
    }[engine.rec];
    f[ledBtn(BTN.clear)] = !engine.isEmpty() ? C.white : C.off;      // something to undo
    const onBeat = engine.playing && b >= 0 && b % 1 < 0.15;
    f[ledBtn(BTN.tempo)] = tempoHeld ? C.white : engine.click ? (onBeat ? C.white : C.dim) : C.off;
    f[ledBtn(BTN.octDown)] = f[ledBtn(BTN.octUp)] = app.isDrums(sel) ? C.off : C.white;
    f[ledBtn(BTN.shift)] = shift ? C.white : C.dim;

    // Knobs: the track's colour (brightness = volume, sent separately). While Tempo is held,
    // only knob 1 is lit (white): it sets the tempo.
    for (let t = 0; t < 8; t++) {
      f[KNOB_LED + t] = tempoHeld ? (t === 0 ? C.white : C.off) : audio.vol[t] > 0 ? instCode(t) : C.off;
    }

    if (noteMode) noteLights(f, sel, instCode);
    else trackLights(f, sel, instCode);
    return f;
  }

  function trackLights(f, sel, instCode) {
    for (let t = 0; t < 8; t++) {
      f[MUTE_ROW + t] = audio.mute[t] ? C.red : C.dim;
      f[SOLO_ROW + t] = audio.solo[t] ? C.green : C.dim;
    }
    // Step view: the bar the playhead is in, 16 steps. Beats marked dim, note starts in track colour.
    const view = engine.view(sel);
    const bpb = engine.beatsPerBar;
    const stepLen = bpb / 16;
    const running = engine.playing || engine.rec === 'armed';
    const base = running ? Math.floor(view.head / bpb) * bpb : 0;
    for (let i = 0; i < 16; i += 4) f[STEP_ROW + i] = C.dim;
    for (const n of view.notes) {
      const i = Math.floor((n.start - base) / stepLen + 1e-6);
      if (i >= 0 && i < 16) f[STEP_ROW + i] = instCode(sel);
    }
    if (running) {
      const i = Math.min(15, Math.floor((view.head - base) / stepLen));
      f[STEP_ROW + i] = view.recording ? C.red : C.white;
    }
  }

  function noteLights(f, sel, instCode) {
    // Instrument colour on white keys, dim on black keys, white while sounding.
    const sounding = new Set([...engine.loopSounding(sel), ...app.heldNotes(sel)]);
    for (let p = 0; p < 32; p++) {
      const s = noteModeSemitone(p);
      if (s == null) continue;
      f[p] = sounding.has(app.noteFor(sel, s)) ? C.white : isBlack(s % 12) ? C.dim : instCode(sel);
    }
  }

  function sendFrame() {
    if (!out) return;
    const f = frame();
    const key = f.join(',');
    if (key === lastFrame) return;
    lastFrame = key;
    out.send([0xF0, 0x7D, 0x02, 0x00, ...f, 0xF7]);
  }

  function sendBrightness() {
    if (!out) return;
    const b = [...audio.vol.map(v => (tempoHeld ? 127 : brightFor(v))), 127];   // knobs 1-8, then the filter knob
    const key = b.join(',');
    if (key === lastBright) return;
    lastBright = key;
    out.send([0xF0, 0x7D, 0x03, KNOB_LED, ...b, 0xF7]);
  }
  setInterval(() => { sendFrame(); sendBrightness(); }, 30);
  app.circuitMode = () => (noteMode ? 'note' : 'track');

  // ---- connection --------------------------------------------------------------
  if (!navigator.requestMIDIAccess) { app.onStatus?.('no Web MIDI'); return; }
  navigator.requestMIDIAccess({ sysex: true }).then(midi => {
    const pick = () => {
      const find = list => [...list.values()].find(p => /circuit tracks midi/i.test(p.name) && !/boot/i.test(p.name)) || null;
      const newIn = find(midi.inputs);
      if (inp && inp !== newIn) inp.onmidimessage = null;
      inp = newIn;
      if (inp) inp.onmidimessage = onMidi;
      out = find(midi.outputs);
      lastFrame = lastBright = '';                     // resend everything to a (re)connected Circuit
      app.onStatus?.(inp && out ? 'connected' : 'not found');
    };
    midi.onstatechange = pick;
    pick();
  }).catch(() => app.onStatus?.('MIDI permission refused'));
}
