// MIDI keyboards: a MIDI input (any but the Circuit, which is the control surface) plays the
// selected track. Settings › MIDI picks which: every input or one, on every channel (omni) or
// one. Kept in this browser. Input only: nothing is ever sent back to the keyboard.
// Ports the looper itself sends to (a MIDI instrument's output, e.g. the IAC bus) are ignored, or
// its own notes would come straight back in and loop forever.

const KEY = 'midiIn';
// input: a port's name (null: all of them); channel: 1-16 (0: omni).
export const midiIn = { input: null, channel: 0 };
try { Object.assign(midiIn, JSON.parse(localStorage.getItem(KEY) ?? '{}')); } catch {}
export function setMidiIn(patch) {
  Object.assign(midiIn, patch);
  try { localStorage.setItem(KEY, JSON.stringify(midiIn)); } catch {}
}

// Why a message from `port` isn't played (null: it is). Also for the Monitor page.
export function whyIgnored(port, status, { isOwnOutput = () => false, ownInput = () => false } = {}) {
  if (/circuit/i.test(port)) return 'the Circuit: controls';
  if (isOwnOutput(port)) return 'the looper sends here';
  if (midiIn.input && port !== midiIn.input && !ownInput(port)) return 'not the MIDI input';
  if (midiIn.channel && status < 0xF0 && (status & 0x0F) + 1 !== midiIn.channel) return `not channel ${midiIn.channel}`;
  return null;
}

// The inputs there are now (names), for Settings › MIDI.
export let midiInputs = [];

// `ownInput(name)`: a port the selected track's MIDI instrument names as its own keyboard; that one
// plays it whatever input is picked here.
export function connectMidiKeyboards({ onNote, onSustain, onStatus, isOwnOutput = () => false, ownInput = () => false }) {
  if (!navigator.requestMIDIAccess) return onStatus?.('no Web MIDI');
  navigator.requestMIDIAccess().then(midi => {
    const hook = () => {
      const names = [];
      for (const port of midi.inputs.values()) {
        if (/circuit/i.test(port.name)) continue;
        if (port.state === 'connected') names.push(port.name);
        port.onmidimessage = ({ data: [s, a, b] }) => {
          if (whyIgnored(port.name, s, { isOwnOutput, ownInput })) return;
          const type = s & 0xF0;
          if (type === 0x90) onNote(a, b, port.name);      // velocity 0 = note-off
          else if (type === 0x80) onNote(a, 0, port.name);
          else if (type === 0xB0 && a === 64) onSustain(b >= 64);
        };
      }
      midiInputs = names;
      onStatus?.(names.length ? names.join(', ') : 'none');
    };
    midi.addEventListener('statechange', hook);
    hook();
  }).catch(() => onStatus?.('MIDI permission refused'));
}
