// Computer-keyboard piano: one octave from C4.
// White keys on the home row (A S D F G H J), black keys on the row above (W E · T Y U).
// Uses KeyboardEvent.code (physical position), so it works on any keyboard layout.

export const BASE_NOTE = 60; // C4

export const KEYS = {
  KeyA: 0, KeyW: 1, KeyS: 2, KeyE: 3, KeyD: 4, KeyF: 5,
  KeyT: 6, KeyG: 7, KeyY: 8, KeyH: 9, KeyU: 10, KeyJ: 11,
};

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const isBlack = semitone => [1, 3, 6, 8, 10].includes(semitone);
export const keyLetter = semitone => Object.keys(KEYS).find(k => KEYS[k] === semitone).slice(3);
