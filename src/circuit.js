// Novation Circuit Tracks (patched LOOP04 firmware) as the looper's control surface.
// Protocol: docs/circuit-protocol.md. Inputs arrive on channel 15; lights go out as SysEx F0 7D.
import { isBlack } from './keys.js';

const BTN = { preset: 8, note: 9, kits: 13, save: 25, open: 26, quant: 21, record: 16, play: 17, octDown: 19, octUp: 20, tempo: 22, clear: 23, shift: 27 };
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
//   Note mode, synth track: two octaves. Rows 1-2 = upper octave, rows 3-4 = lower; black keys
//               above white keys.
//   Note mode, drum track:  rows 1-2 = mute / solo as in track view, rows 3-4 = the 16-pad kit
//               (pads 1-8 along the bottom row, 9-16 above, as on screen).
const MUTE_ROW = 0, SOLO_ROW = 8, STEP_ROW = 16;
const WHITE = [0, 2, 4, 5, 7, 9, 11, 12];
const BLACK = { 1: 1, 2: 3, 4: 6, 5: 8, 6: 10 };
// Kit pad (0-15) under Circuit pad p in Note mode, or null.
const kitPadAt = p => (p >= 24 ? p - 24 : p >= 16 ? p - 8 : null);
function noteModeSemitone(p) {
  const row = p >> 3, col = p & 7;
  const s = row % 2 ? WHITE[col] : BLACK[col];
  return s == null ? null : s + (row < 2 ? 12 : 0);
}

export function connectCircuit(app) {
  const { engine, audio, actions } = app;
  let out = null, inp = null, lastFrame = '', lastBright = '';
  let shift = false;
  // Note mode is shared with the screen's Show/Hide panel: one switch, toggled from either.
  const isNoteMode = () => app.notePanel();
  let tempoHeld = false, tempoTurned = false;    // tap Tempo = click; hold Tempo + filter knob = tempo (+ Shift: swing)
  let lastFilter = null;                         // the master filter knob's last position (0-127)

  // ---- input ---------------------------------------------------------------
  function onMidi(ev) {
    const [s, a, b] = ev.data;
    if (s === 0x9E) return padDown(a, b);
    if (s === 0x8E) return app.release(`circuit${a}`);
    if (s !== 0xBE || a === 100) return;              // 100 = firmware health report
    if (a >= 20 && a < 48) return b ? buttonDown(a - 20) : buttonUp(a - 20);
    if (a >= 1 && a <= 8) return knob(a - 1, b >= 64 ? b - 128 : b);
    if (a === 10) return actions.masterVolume(b / 127);    // master volume knob (absolute)
    if (a === 9) return filterKnob(b);
  }

  function padDown(p, vel) {
    audio.resume();
    if (isNoteMode()) {
      const s = app.isDrums(engine.selected) ? kitPadAt(p) : noteModeSemitone(p);
      if (s != null) return app.press(`circuit${p}`, s, Math.max(1, vel));
      if (!app.isDrums(engine.selected)) return;    // drum tracks: rows 1-2 stay mute / solo
    }
    if (p < SOLO_ROW) return actions.mute(p - MUTE_ROW);
    if (p < STEP_ROW) return actions.solo(p - SOLO_ROW);
  }

  function buttonDown(id) {
    audio.resume();
    if (id === BTN.shift) { shift = app.circuitShift = true; return; }
    if (TRACK_BTNS.includes(id)) return actions.select(id);
    switch (id) {
      case BTN.note: return actions.toggleNotes();
      case BTN.quant: return actions.quant();             // 1-16/17-32: the selected track's record quantise
      case BTN.play: return actions.play();
      case BTN.record: return actions.record();
      case BTN.octDown: return shift ? actions.transpose(-1) : actions.octave(-1);   // Shift: move the track's notes
      case BTN.octUp: return shift ? actions.transpose(1) : actions.octave(1);
      case BTN.tempo: tempoHeld = true; tempoTurned = false; app.holding = 'tempo'; return;
      case BTN.preset: return shift ? actions.togglePage('presets') : actions.nextInstrument(1);   // Shift: Presets page
      case BTN.kits: return shift ? actions.togglePage('kits') : actions.nextKit();            // the Patterns button
      case BTN.save: return shift ? app.session.saveAs() : app.session.save();
      case BTN.open: return shift ? app.session.newProject() : app.session.open();              // the Projects button
      case BTN.clear: return shift ? actions.clearTrack() : actions.undo();
    }
  }

  function buttonUp(id) {
    if (id === BTN.shift) shift = app.circuitShift = false;
    if (id === BTN.tempo) {
      if (!tempoTurned) actions.click();
      tempoHeld = false;
      app.holding = null;
    }
  }

  function knob(k, delta) {
    if (shift) return actions.pan(k, delta * 0.03);  // Shift: that track's left-right position
    actions.volume(k, delta * 0.02);                 // knob above each track = its volume
  }

  // The master filter knob is the general-purpose knob: what it turns depends on what's held.
  // It reports a position, so it's used as turns (the change since its last report): that way
  // changing the tempo doesn't make Internal sounds jump the next time it's turned on its own.
  function filterKnob(pos) {
    const first = lastFilter == null, d = first ? 0 : pos - lastFilter;
    lastFilter = pos;
    if (tempoHeld) {
      if (d) { shift ? actions.swing(d) : actions.tempo(d); tempoTurned = true; }
      return;
    }
    if (first || pos === 0 || pos === 127) return actions.internalLevel(pos / 127);   // first report, end stops: exact
    if (d) actions.internalLevel(app.levels.internal + d / 127);
  }

  // ---- lights ----------------------------------------------------------------
  function frame() {
    const f = new Array(N_LEDS).fill(C.off);
    const sel = engine.selected;
    const b = engine.beat();
    const blink = Math.floor(performance.now() / 250) % 2 === 0;
    const instCode = t => INST_CODE[audio.instruments[t]] ?? C.white;

    TRACK_BTNS.forEach(t => (f[ledBtn(t)] = t === sel ? C.white : instCode(t)));
    f[ledBtn(BTN.quant)] = QUANT_CODE[engine.tracks[sel].quant];
    f[ledBtn(BTN.preset)] = app.page() === 'presets' ? C.white : instCode(sel);
    f[ledBtn(BTN.kits)] = app.page() === 'kits' ? C.white : C.dim;
    f[ledBtn(BTN.save)] = projectDirty ? C.white : C.dim;                 // white: unsaved changes
    f[ledBtn(BTN.open)] = C.dim;
    f[ledBtn(BTN.note)] = isNoteMode() ? C.white : C.dim;
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
    f[ledBtn(BTN.octDown)] = f[ledBtn(BTN.octUp)] = (shift ? app.canTranspose() : !app.isDrums(sel)) ? C.white : C.off;
    f[ledBtn(BTN.shift)] = shift ? C.white : C.dim;

    // Knobs: the track's colour (brightness = volume, sent separately). The filter knob lights
    // while Tempo is held, when it sets the tempo (white) or, with Shift, the swing (amber).
    for (let t = 0; t < 8; t++) {
      f[KNOB_LED + t] = audio.vol[t] > 0 ? instCode(t) : C.off;
    }
    f[KNOB_LED + 8] = tempoHeld ? (shift ? C.amber : C.white) : C.off;

    if (isNoteMode() && app.isDrums(sel)) kitLights(f, sel, instCode);
    else if (isNoteMode()) noteLights(f, sel, instCode);
    else trackLights(f, sel, instCode);
    return f;
  }

  function trackLights(f, sel, instCode) {
    mixLights(f);
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

  function mixLights(f) {
    for (let t = 0; t < 8; t++) {
      f[MUTE_ROW + t] = audio.mute[t] ? C.red : C.dim;
      f[SOLO_ROW + t] = audio.solo[t] ? C.green : C.dim;
    }
  }

  function kitLights(f, sel, instCode) {
    // Mute / solo on top; the kit below in the track's colour, white while sounding.
    mixLights(f);
    const sounding = new Set([...engine.loopSounding(sel), ...app.heldNotes(sel)].map(app.kitPad));
    for (let p = 16; p < 32; p++) f[p] = sounding.has(kitPadAt(p)) ? C.white : instCode(sel);
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
    const b = [...audio.vol.map(brightFor), 127];   // knobs 1-8, then the filter knob
    const key = b.join(',');
    if (key === lastBright) return;
    lastBright = key;
    out.send([0xF0, 0x7D, 0x03, KNOB_LED, ...b, 0xF7]);
  }
  setInterval(() => { sendFrame(); sendBrightness(); }, 30);
  let projectDirty = false;                       // checked less often: it compares the whole project
  setInterval(() => { projectDirty = !!app.session?.dirty(); }, 300);
  app.circuitMode = () => (isNoteMode() ? 'note' : 'track');

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
