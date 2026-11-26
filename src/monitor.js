// Settings › Monitor: every MIDI message coming in, newest first, from every input (the Circuit's
// controls too). Messages the looper doesn't play are dimmed, with why (Settings › MIDI picks an
// input and channel). Clear track empties it.
import { whyIgnored } from './midiin.js';

const BUTTONS = ['Synth 1', 'Synth 2', 'MIDI 1', 'MIDI 2', 'Drum 1', 'Drum 2', 'Drum 3', 'Drum 4', 'Preset', 'Note',
  'Velocity', 'Gate', 'Pattern Settings', 'Patterns', 'Mixer', 'FX', 'Record', 'Play', 'Scales', 'Octave ▼',
  'Octave ▲', '1-16/17-32', 'Tempo/Swing', 'Clear', 'Duplicate', 'Save', 'Projects', 'Shift'];
const NOTE = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
const noteName = n => NOTE[n % 12] + (Math.floor(n / 12) - 1);
const KEEP = 200;

function decode([s, a, b], port) {
  const ch = (s & 0x0F) + 1, type = s & 0xF0;
  if (/circuit/i.test(port) && ch === 15) {                     // the patched firmware's controls
    if (type === 0x90) return `Pad ${a + 1} down`;
    if (type === 0x80) return `Pad ${a + 1} up`;
    if (type === 0xB0 && a >= 20 && a < 20 + BUTTONS.length) return `${BUTTONS[a - 20]} ${b ? 'down' : 'up'}`;
    if (type === 0xB0 && a >= 1 && a <= 8) return `Knob ${a} ${b >= 64 ? b - 128 : `+${b}`}`;
    if (type === 0xB0 && a === 9) return `Filter knob ${b}`;
    if (type === 0xB0 && a === 10) return `Volume knob ${b}`;
  }
  switch (type) {
    case 0x80: return `${noteName(a)} off`;
    case 0x90: return b ? `${noteName(a)} on · ${b}` : `${noteName(a)} off`;
    case 0xA0: return `Aftertouch ${noteName(a)} ${b}`;
    case 0xB0: return a === 64 ? `Sustain ${b >= 64 ? 'down' : 'up'}` : `CC ${a} = ${b}`;
    case 0xC0: return `Program ${a + 1}`;
    case 0xD0: return `Pressure ${a}`;
    case 0xE0: return `Pitch bend ${((b << 7) | a) - 8192}`;
  }
  return { 0xF0: 'SysEx', 0xFA: 'Start', 0xFB: 'Continue', 0xFC: 'Stop', 0xFF: 'Reset' }[s] ?? `System ${s.toString(16)}`;
}

export function setupMonitor({ isOwnOutput, ownInput }) {
  const rows = [];
  let added = 0, shown = -1, root = null;

  navigator.requestMIDIAccess?.({ sysex: true }).then(midi => {
    const heard = new WeakSet();
    const hook = () => {
      for (const port of midi.inputs.values()) {
        if (heard.has(port)) continue;
        heard.add(port);
        port.addEventListener('midimessage', ({ data }) => {
          if (data[0] === 0xF8 || data[0] === 0xFE) return;                  // clock, active sensing
          if (/circuit/i.test(port.name) && data[0] === 0xBE && data[1] === 100) return;   // firmware health report
          const ch = data[0] < 0xF0 ? (data[0] & 0x0F) + 1 : null;
          const row = { t: new Date(), port: port.name, ch, text: decode(data, port.name), why: whyIgnored(port.name, data[0], { isOwnOutput, ownInput }) };
          rows.unshift(row);
          if (rows.length > KEEP) rows.pop();
          added++;
        });
      }
    };
    midi.addEventListener('statechange', hook);
    hook();
  }).catch(() => {});

  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const time = d => d.toTimeString().slice(0, 8) + '.' + String(d.getMilliseconds()).padStart(3, '0');
  function draw(el, fresh) {
    if (!fresh && shown === added && root === el) return;
    shown = added;
    root = el;
    el.innerHTML = `<div class="set mon">${rows.map(r => `
      <div class="mon-row${r.why ? ' ignored' : ''}"><span class="mon-t">${time(r.t)}</span><span class="mon-port">${esc(r.port)}</span>`
      + `<span class="mon-ch">${r.ch ?? ''}</span><span class="mon-msg">${esc(r.text)}</span><span class="mon-why">${r.why ?? ''}</span></div>`).join('')}</div>`;
  }

  return {
    name: 'Monitor',
    update: draw,
    count: () => 0,
    enter() {},
    del() { rows.length = 0; added++; },
    canDelete: () => rows.length > 0,
    press() {},
    state: () => [],
  };
}
