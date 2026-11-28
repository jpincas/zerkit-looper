// Novation Circuit Tracks (patched LOOP04 firmware) as the looper's control surface.
// Protocol: docs/circuit-protocol.md. Inputs arrive on channel 15; lights go out as SysEx F0 7D.
import { isBlack } from './keys.js';
import { INSTRUMENTS } from './instruments.js';

// The sound sources go down the left column (Preset, Note, Velocity, Gate, Pattern Settings):
// Instruments, Kits, Synth, Audio, MIDI. Jam is the Patterns button, right of the track buttons.
const BTN = { preset: 8, kits: 9, synth: 10, audio: 11, midi: 12, jam: 13, settings: 14, fx: 15, scales: 18, undo: 24, save: 25, open: 26, quant: 21, record: 16, play: 17, octDown: 19, octUp: 20, tempo: 22, clearTrack: 23, shift: 27 };
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
const KIT_CODE = 0x4D;                           // any kit (teal)
const AUDIO_CODE = 0x2D;                         // any audio instrument (yellow)
const MIDI_CODE = 0x09;                          // any MIDI instrument (blue)
const SYNTH_CODE = 0x32;                         // a synth track (pink)
const INST_CODE = {                             // the built-in sampled instruments
  'smp:Grand Piano': 0x2B, 'smp:Upright Bass': 0x45, 'smp:Cello': 0x53, 'smp:Vibraphone': 0x13, 'smp:Harp': 0x49,
};
const OWN_CODE = 0x17;                           // your own sampled instruments (green)

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

// The light colour for an instrument key.
function codeFor(key) {
  const def = INSTRUMENTS[key];
  return INST_CODE[key] ?? (def?.kit ? KIT_CODE : def?.audio ? AUDIO_CODE : def?.midi ? MIDI_CODE : def?.synth ? SYNTH_CODE : def?.sampled ? OWN_CODE : C.white);
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
    if (app.flashing) return;                         // Settings › Firmware has the Circuit
    const [s, a, b] = ev.data;
    if (app.session?.dialogOpen()) return dialogInput(s, a, b);
    if (s === 0x9E) return padDown(a, b);
    if (s === 0x8E) { app.pageCards()?.release?.(a); return app.release(`circuit${a}`); }
    if (s !== 0xBE || a === 100) return;              // 100 = firmware health report
    if (a >= 20 && a < 48) return b ? buttonDown(a - 20) : buttonUp(a - 20);
    if (a >= 1 && a <= 8) return knob(a - 1, b >= 64 ? b - 128 : b);
    if (a === 10) return actions.masterVolume(b / 127);    // master volume knob (absolute)
    if (a === 9) return app.page() === 'settings' ? settingsKnob(b) : filterKnob(b);
  }

  // Settings (the cog): the master filter knob moves up and down its list, a step per 2 positions.
  let settingsTurn = 0;
  function settingsKnob(b) {
    const d = lastFilter == null ? 0 : b - lastFilter;
    lastFilter = b;
    settingsTurn += d;
    while (Math.abs(settingsTurn) >= 2) { app.settings.move(Math.sign(settingsTurn)); settingsTurn -= 2 * Math.sign(settingsTurn); }
  }
  // ...and the track buttons pick its page, Octave ▲ ▼ move, Play picks, Clear deletes.
  function settingsButton(id) {
    const st = app.settings;
    if (TRACK_BTNS.includes(id)) { st.selectPage(id); return true; }
    switch (id) {
      case BTN.octUp: st.move(-1); return true;
      case BTN.octDown: st.move(1); return true;
      case BTN.play: st.enter(); return true;
      case BTN.clearTrack: st.del(); return true;
    }
    return false;
  }

  // A project screen is open (Open list, name box, "discard changes?"): only the master filter
  // knob and Octave ▲ ▼ (move), Play (choose) and Projects (close) do anything.
  let dialogTurn = 0;
  function dialogInput(s, a, b) {
    const session = app.session;
    if (s === 0xBE && a === 9) {                           // master filter knob: a step per 2 positions
      const d = lastFilter == null ? 0 : b - lastFilter;
      lastFilter = b;
      dialogTurn += d;
      while (Math.abs(dialogTurn) >= 2) { session.move(Math.sign(dialogTurn)); dialogTurn -= 2 * Math.sign(dialogTurn); }
      return;
    }
    if (s !== 0xBE || a < 20 || a >= 48 || !b) return;     // buttons, on press
    switch (a - 20) {
      case BTN.octUp: return session.move(-1);
      case BTN.octDown: return session.move(1);
      case BTN.play: return session.choose();
      case BTN.open: return session.close();
    }
  }

  function padDown(p, vel) {
    audio.resume();
    const cards = app.pageCards();                     // a page is open: its pads (cards, or the FX pedals)
    if (cards) { if (cards.press) cards.press(p); else if (p < (cards.max ?? 16)) cards.toggleAt(p); return; }
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
    const controls = app.pageControls?.();
    if (controls && (id === BTN.play || id === BTN.record) && controls.button(id === BTN.play ? 'play' : 'record')) return;
    if (id === BTN.shift) { shift = app.circuitShift = true; return; }
    if (app.page() === 'settings' && settingsButton(id)) return;
    if (TRACK_BTNS.includes(id)) return actions.select(id);
    switch (id) {
      case BTN.scales: return actions.toggleNotes();                                           // Note mode (Show/Hide)
      case BTN.quant: return actions.quant();             // 1-16/17-32: the selected track's record quantise
      case BTN.play: return actions.play();
      case BTN.record: return actions.record();
      case BTN.octDown: return shift ? actions.transpose(-1) : actions.octave(-1);   // Shift: move the track's notes
      case BTN.octUp: return shift ? actions.transpose(1) : actions.octave(1);
      case BTN.tempo: tempoHeld = true; tempoTurned = false; app.holding = 'tempo'; return;
      case BTN.preset: return shift ? actions.togglePage('presets') : actions.nextInstrument(1);   // Shift: Instruments page
      case BTN.kits: return shift ? actions.togglePage('kits') : actions.nextKit();            // the Note button
      case BTN.synth: return actions.synth();                                                  // the Velocity button
      case BTN.audio: return shift ? actions.togglePage('audio') : actions.nextAudio();        // the Gate button
      case BTN.midi: return shift ? actions.togglePage('midi') : actions.nextMidi();            // the Pattern Settings button
      case BTN.fx: return shift ? app.fxBypass() : actions.togglePage('fx');                   // the track's pedals / bypass
      case BTN.save: return shift ? app.session.saveTemplate() : app.session.save();
      case BTN.open: return shift ? app.session.openTemplate() : app.session.open();            // the Projects button
      case BTN.settings: return actions.togglePage('settings');                                // the Mixer button (the cog)
      case BTN.clearTrack: return shift ? actions.trimTrack() : actions.clearTrack();          // the Clear button (Shift: trim)
      case BTN.undo: return shift ? actions.redo() : actions.undo();                           // the Duplicate button
      case BTN.jam: return actions.jamButton();                                                // the Patterns button: Jam, then a fill
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
    const controls = app.pageControls?.();               // e.g. the instrument maker's settings
    if (controls) return controls.knob(k, delta);
    if (app.knobPage()) return app.knobPage().nudge(k, delta);   // FX / Synth page: its 8 columns
    if (shift) return actions.pan(k, delta * 0.03);  // Shift: that track's left-right position
    actions.volume(k, delta * 0.02);                 // knob above each track = its volume
  }

  // The master filter knob. The filter follows its position, so the centre detent is always "off"
  // (and the ends are the deepest low- and high-pass). With Shift it turns the click level, with
  // Tempo held the tempo (Shift too: swing): those are turns, the change since its last report.
  // After them, or after the filter was moved on screen, the knob no longer points where the
  // filter is, so the filter picks up only once the knob comes round to it: nothing jumps.
  let knobFilter = null;                         // the filter value the knob last set (null: out of step)
  function filterKnob(pos) {
    const prev = lastFilter, d = prev == null ? 0 : pos - prev;
    lastFilter = pos;
    if (tempoHeld) {
      if (d) { shift ? actions.swing(d) : actions.tempo(d); tempoTurned = true; knobFilter = null; }
      return;
    }
    if (shift) {
      knobFilter = null;
      if (prev == null || pos === 0 || pos === 127) return actions.clickLevel(pos / 127);   // first report, end stops: exact
      if (d) actions.clickLevel(app.levels.click + d / 127);
      return;
    }
    if (prev != null && knobFilter !== app.levels.filter) {          // out of step: wait for the pick-up
      const at = app.levels.filter * 127;                            // where the filter is, as a knob position
      if (Math.abs(pos - at) > 2 && (prev - at) * (pos - at) > 0) return;   // not reached or crossed yet
    }
    actions.filter(pos / 127);
    knobFilter = app.levels.filter;
  }

  // ---- lights ----------------------------------------------------------------
  function frame() {
    const f = new Array(N_LEDS).fill(C.off);
    if (app.session?.dialogOpen()) {                       // a project screen: just its controls
      f[ledBtn(BTN.octUp)] = f[ledBtn(BTN.octDown)] = C.white;
      f[ledBtn(BTN.play)] = C.green;
      f[ledBtn(BTN.open)] = C.dim;
      f[KNOB_LED + 8] = C.white;                            // the master filter knob
      return f;
    }
    if (app.page() === 'settings') return settingsLights(f);
    const sel = engine.selected;
    const b = engine.beat();
    const blink = Math.floor(performance.now() / 250) % 2 === 0;
    const instCode = t => codeFor(audio.instruments[t]);

    const jam = app.jam?.();                                // Jam: no track selected
    TRACK_BTNS.forEach(t => (f[ledBtn(t)] = t === sel && !jam ? C.white : instCode(t)));
    const fill = engine.fillState();                       // a fill: green armed, flashing with its hits as it plays
    f[ledBtn(BTN.jam)] = fill === 'armed' || (fill === 'playing' && engine.fillHit()) ? C.green : jam ? C.amber : C.dim;
    f[ledBtn(BTN.quant)] = QUANT_CODE[engine.tracks[sel].quant];
    f[ledBtn(BTN.preset)] = app.page() === 'presets' ? C.white : instCode(sel);
    f[ledBtn(BTN.kits)] = app.page() === 'kits' ? C.white : C.dim;
    f[ledBtn(BTN.audio)] = app.page() === 'audio' ? C.white : C.dim;
    f[ledBtn(BTN.fx)] = app.page() === 'fx' ? C.white : C.dim;
    f[ledBtn(BTN.synth)] = app.page() === 'synth' ? C.white : app.isSynth(sel) ? SYNTH_CODE : C.dim;
    f[ledBtn(BTN.save)] = projectDirty ? C.white : C.dim;                 // white: unsaved changes
    f[ledBtn(BTN.open)] = C.dim;
    f[ledBtn(BTN.scales)] = isNoteMode() ? C.white : C.dim;
    f[ledBtn(BTN.midi)] = app.page() === 'midi' ? C.white : C.dim;
    f[ledBtn(BTN.play)] = app.soundBlocked?.() ? (blink ? C.red : C.off)     // sound blocked: click the page
      : engine.playing ? C.green : C.dim;
    f[ledBtn(BTN.record)] = {
      idle: engine.tracks[sel].loop ? C.dim : C.off,          // dim: the track has a loop (Record would overdub)
      armed: blink ? C.red : C.off,
      recording: C.red,
      closing: blink ? C.red : C.dimRed,
      overdub: C.amber,
    }[engine.rec];
    f[ledBtn(BTN.undo)] = (shift ? engine.canRedo() : !engine.isEmpty()) ? C.white : C.off;   // something to undo / redo
    f[ledBtn(BTN.clearTrack)] = (shift ? engine.trimLength(sel) : engine.tracks[sel].notes.length + engine.tracks[sel].clips.length) ? C.white : C.off;   // something to clear / trim
    f[ledBtn(BTN.settings)] = C.dim;
    const onBeat = engine.playing && b >= 0 && b % 1 < 0.15;
    f[ledBtn(BTN.tempo)] = tempoHeld ? C.white : engine.click ? (onBeat ? C.white : C.dim) : C.off;
    f[ledBtn(BTN.octDown)] = f[ledBtn(BTN.octUp)] = (shift ? app.canTranspose() : !app.isDrums(sel)) ? C.white : C.off;
    f[ledBtn(BTN.shift)] = shift ? C.white : C.dim;

    // Knobs: the track's colour (brightness = volume, sent separately). The filter knob lights
    // while Tempo is held, when it sets the tempo (white) or, with Shift, the swing (amber).
    for (let t = 0; t < 8; t++) {
      f[KNOB_LED + t] = app.pageControls?.() ? app.pageControls().codes()[t]     // a page's own settings
        : app.knobPage() ? app.knobPage().codes()[t]            // FX / Synth page: each column's colour
        : audio.vol[t] > 0 ? instCode(t) : C.off;
    }
    f[KNOB_LED + 8] = tempoHeld ? (shift ? C.amber : C.white) : app.levels.filter !== 0.5 ? C.white : C.off;   // lit: filtering

    const cards = app.pageCards();
    if (cards) pageLights(f, cards);
    else if (isNoteMode() && app.isDrums(sel)) kitLights(f, sel, instCode);
    else if (isNoteMode()) noteLights(f, sel, instCode);
    else trackLights(f, sel, instCode);
    return f;
  }

  // Settings: its pages on the track buttons (white: the one shown), its controls, a pad per row.
  function settingsLights(f) {
    const st = app.settings;
    TRACK_BTNS.forEach(t => (f[ledBtn(t)] = t === st.page() ? C.white : st.pages[t] ? C.dim : C.off));
    f[ledBtn(BTN.settings)] = C.white;
    f[ledBtn(BTN.octUp)] = f[ledBtn(BTN.octDown)] = C.white;
    f[ledBtn(BTN.play)] = C.green;
    f[ledBtn(BTN.clearTrack)] = st.canDelete() ? C.white : C.off;
    f[ledBtn(BTN.save)] = f[ledBtn(BTN.open)] = C.dim;
    f[ledBtn(BTN.shift)] = shift ? C.white : C.dim;
    f[KNOB_LED + 8] = C.white;                              // the master filter knob
    pageLights(f, st.cards);
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

  // A page's cards on pads 1-16 (the grooves: 1-32): the instrument's colour when switched on, dim when off, white
  // for the selected track's own.
  function pageLights(f, cards) {
    cards.state().forEach((c, i) => { if (c) f[i] = c.current ? C.white : c.on ? (c.code ?? codeFor(c.key)) : C.dim; });
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
    if (!out || app.flashing) { lastFrame = ''; return; }     // flashing: leave it alone, resend after
    const f = frame();
    const key = f.join(',');
    if (key === lastFrame) return;
    lastFrame = key;
    out.send([0xF0, 0x7D, 0x02, 0x00, ...f, 0xF7]);
  }

  function sendBrightness() {
    if (!out || app.flashing) { lastBright = ''; return; }
    const controls = app.pageControls?.();
    const b = controls ? [...controls.values(), 127]
      : app.knobPage()
      ? [...app.knobPage().values().map(v => Math.round(v * 126)), 127]   // FX / Synth page: each control's value
      : [...audio.vol.map(brightFor), 127];                      // knobs 1-8, then the filter knob
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
