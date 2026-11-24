// Novation Circuit Tracks (patched LOOP04 firmware) as the looper's control surface.
// Protocol: docs/circuit-protocol.md. Inputs arrive on channel 15; lights go out as SysEx F0 7D.
import { INSTRUMENTS } from './instruments.js';
import { isBlack } from './keys.js';

const BTN = { preset: 8, record: 16, play: 17, octDown: 19, octUp: 20, tempo: 22, clear: 23, shift: 27 };
const TRACK_BTNS = [0, 1, 2, 3, 4, 5, 6, 7];     // Synth 1-2, MIDI 1-2, Drum 1-4 -> tracks 1-8
const N_LEDS = 69;
const ledBtn = id => 32 + id;
const KNOB_LED = 60;                             // + knob index

// Novation palette codes
const C = { off: 0, white: 0x01, dim: 0x02, red: 0x53, dimRed: 0x54, green: 0x17, amber: 0x2B };
const INST_CODE = { synth: 0x2B, bass: 0x45, pluck: 0x13, pad: 0x49, keys: 0x17, organ: 0x32, bell: 0x6A, drums: 0x4D };

// Pads are numbered 0-31, row by row from the top-left.
// Rows 1-2 (pads 0-15): loop position. Row 3 (16-23): black keys. Row 4 (24-31): white keys C..C.
const BLACK_ROW = 16, WHITE_ROW = 24;
const WHITE = [0, 2, 4, 5, 7, 9, 11, 12];
const BLACK = { 1: 1, 2: 3, 4: 6, 5: 8, 6: 10 };
const padSemitone = p => (p >= WHITE_ROW ? WHITE[p - WHITE_ROW] : p >= BLACK_ROW ? BLACK[p - BLACK_ROW] ?? null : null);

export function connectCircuit(app) {
  const { engine, audio, actions } = app;
  let out = null, inp = null, shift = false, lastFrame = '';

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
    const s = padSemitone(p);
    if (s == null) return;
    audio.resume();
    app.press(`circuit${p}`, s, Math.max(1, vel));
  }

  function buttonDown(id) {
    audio.resume();
    if (id === BTN.shift) { shift = true; return; }
    if (TRACK_BTNS.includes(id)) return actions.select(id);
    switch (id) {
      case BTN.play: return actions.play();
      case BTN.record: return actions.record();
      case BTN.octDown: return actions.octave(-1);
      case BTN.octUp: return actions.octave(1);
      case BTN.tempo: return actions.click();
      case BTN.preset: return cycleInstrument(shift ? -1 : 1);
      case BTN.clear: return shift ? actions.clearTrack() : actions.undo();
    }
  }

  function buttonUp(id) {
    if (id === BTN.shift) shift = false;
  }

  function knob(k, delta) {
    if (k === 0) actions.tempo(delta);               // macro 1: tempo
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

    TRACK_BTNS.forEach(t => (f[ledBtn(t)] = t === sel ? C.white : instCode(t)));
    f[ledBtn(BTN.preset)] = instCode(sel);
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
    f[ledBtn(BTN.tempo)] = engine.click ? (onBeat ? C.white : C.dim) : C.off;
    f[ledBtn(BTN.octDown)] = f[ledBtn(BTN.octUp)] = app.isDrums(sel) ? C.off : C.white;
    f[ledBtn(BTN.shift)] = shift ? C.white : C.dim;
    f[KNOB_LED] = C.amber;                           // macro 1 = tempo

    // Loop position: 16 steps across the current view, bar starts marked.
    const view = engine.view(sel);
    const bpb = engine.beatsPerBar;
    for (let bar = 0; bar * bpb < view.span; bar++) f[Math.floor((bar * bpb / view.span) * 16)] = C.dim;
    if (engine.playing || engine.rec === 'armed') {
      const step = Math.min(15, Math.floor((view.head / view.span) * 16));
      f[step] = view.recording ? C.red : C.white;
    }

    // Keyboard rows: instrument colour on white keys, dim on black keys, white while sounding.
    const sounding = new Set([...engine.loopSounding(sel), ...app.heldNotes(sel)]);
    for (let p = BLACK_ROW; p < 32; p++) {
      const s = padSemitone(p);
      if (s == null) continue;
      f[p] = sounding.has(app.noteFor(sel, s)) ? C.white : isBlack(s % 12) ? C.dim : instCode(sel);
    }
    return f;
  }

  function sendFrame() {
    if (!out) return;
    const f = frame();
    const key = f.join(',');
    if (key === lastFrame) return;
    lastFrame = key;
    out.send([0xF0, 0x7D, 0x02, 0x00, ...f, 0xF7]);
  }
  setInterval(sendFrame, 30);

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
      lastFrame = '';                                  // resend everything to a (re)connected Circuit
      app.onStatus?.(inp && out ? 'connected' : 'not found');
    };
    midi.onstatechange = pick;
    pick();
  }).catch(() => app.onStatus?.('MIDI permission refused'));
}
