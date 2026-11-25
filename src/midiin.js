// MIDI keyboards: any MIDI input except the Circuit (which is the control surface) plays the
// selected track, on any channel. Input only: nothing is ever sent back to the keyboard.

export function connectMidiKeyboards({ onNote, onSustain, onStatus }) {
  if (!navigator.requestMIDIAccess) return onStatus?.('no Web MIDI');
  navigator.requestMIDIAccess().then(midi => {
    const hook = () => {
      const names = [];
      for (const port of midi.inputs.values()) {
        if (/circuit/i.test(port.name)) continue;
        names.push(port.name);
        port.onmidimessage = ({ data: [s, a, b] }) => {
          const type = s & 0xF0;
          if (type === 0x90) onNote(a, b, port.name);      // velocity 0 = note-off
          else if (type === 0x80) onNote(a, 0, port.name);
          else if (type === 0xB0 && a === 64) onSustain(b >= 64);
        };
      }
      onStatus?.(names.length ? names.join(', ') : 'none');
    };
    midi.addEventListener('statechange', hook);
    hook();
  }).catch(() => onStatus?.('MIDI permission refused'));
}
