// Grooves: what the Kits page shows while Shift is held. 32 drum grooves, a row of eight of each
// kind (pop/rock/blues, acoustic/folk, jazz/funk, electronic, each in its own colour), on all
// 32 of the Circuit's pads. Tapping one puts it on the selected track (see actions.groove).
import GROOVES from './grooves-data.js';
import { cardPage } from './cards.js';

const KIND_COLORS = ['#e8795a', '#d9b84a', '#9a7ef0', '#5ab8e8'];
const KIND_CODES = [0x2B, 0x2D, 0x49, 0x09];            // the same on the Circuit's pads

export function setupGroovePage({ root, current, onPick }) {
  const cards = cardPage(root, {
    items: () => GROOVES.map((g, i) => ({ key: String(i), name: g.name, color: KIND_COLORS[g.row], code: KIND_CODES[g.row] })),
    isOn: () => true,
    current: key => current() === GROOVES[Number(key)].name,
    toggle: key => onPick(GROOVES[Number(key)]),
    usedBy: key => { const g = GROOVES[Number(key)]; return `${g.bpm}${g.swing > 50 ? ` · ${g.swing}%` : ''}`; },
    max: 32,
    hint: item => `${item.name}: tap to put it on the selected track (sets the tempo and swing, and turns the click off). while jamming, Jam plays its fill at the end of the loop`,
  });
  return { cards, show: cards.draw, update: cards.update };
}
