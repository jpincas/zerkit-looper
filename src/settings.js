// Settings (the cog): pages of settings in the pad area. While it's open the track buttons pick
// the page; ▲ ▼ (the Octave buttons, the arrow keys or the master filter knob) choose a row,
// Play (Enter) does the row's thing and Clear track (⌫) deletes it, pressed twice.
//
// Pages:
//   Templates: the stock setup and your templates. Play makes the chosen one the default (the
//              setup every new project starts with; the stock setup when none is).
//   MIDI:      which MIDI input plays the selected track (all, or one) and on which channel
//              (omni, or 1-16). Laid out like the pads: inputs on row 1, Omni on row 2,
//              channels 1-16 on rows 3-4. Play (or the pad) picks.
//   Firmware:  firmware.js.   Monitor: monitor.js.   Guide: tour.js.
import { templates } from './templates.js';
import { midiIn, setMidiIn, midiInputs } from './midiin.js';

export function setupSettings({ root, INSTRUMENTS, DEFAULTS, toast, onMidiChange, isOwnOutput = () => false, more = [] }) {
  let page = 0, sel = 0, confirmDelete = null;          // confirmDelete: the row waiting for a second press
  let rows = [], shown = '', dflt = null;             // dflt: the default template's name (null: stock)

  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const ago = t => {
    const s = (Date.now() - t) / 1000;
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.floor(s / 60)} min ago`;
    if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
    if (s < 86400 * 7) return `${Math.floor(s / 86400)} d ago`;
    return new Date(t).toLocaleDateString();
  };

  // ---- Templates ------------------------------------------------------------------
  function readRows() {
    rows = [{ name: null, label: 'Stock setup', when: 'built in', colors: DEFAULTS.map(k => INSTRUMENTS[k]?.color ?? '#888'), tempo: 120 },
      ...templates.list().map(t => ({ name: t.name, label: t.name, when: ago(t.savedAt), colors: t.json.tracks.map(x => INSTRUMENTS[x.instrument]?.color ?? '#888'), tempo: t.json.tempo }))];
    dflt = templates.defaultName();
    sel = Math.min(sel, rows.length - 1);
  }
  const isDefault = r => r.name === dflt;                     // the stock row when there's none
  function makeDefault(i) {
    const r = rows[i];
    const name = isDefault(r) ? null : r.name;                  // the default again: back to stock
    templates.setDefault(name);
    toast(name ? `New projects start from “${name}”` : 'New projects start from the stock setup');
  }
  function remove(i) {
    const r = rows[i];
    if (r.name == null) return toast('The stock setup is built in: it can’t be deleted', 'warn');
    if (confirmDelete !== r.name) { confirmDelete = r.name; return; }
    templates.remove(r.name);
    confirmDelete = null;
    toast(`Deleted · ${r.name}`);
    readRows();
  }

  function drawTemplates() {
    const key = JSON.stringify(['t', sel, confirmDelete, dflt, rows.map(r => r.name)]);
    if (key === shown) return;
    shown = key;
    root.innerHTML = `
      <div class="set">
        <div class="set-list">${rows.map((r, i) => `
          <div class="set-row${i === sel ? ' sel' : ''}${isDefault(r) ? ' dflt' : ''}" data-i="${i}">
            <span class="sr-star" title="The default">★</span>
            <span class="sr-name">${esc(r.label)}</span>
            <span class="di-tracks">${r.colors.map(c => `<i class="on" style="--c:${c}"></i>`).join('')}</span>
            <span class="sr-tempo">${r.tempo} BPM</span>
            <span class="sr-when">${r.when}</span>
            <button class="sr-btn sr-default">${isDefault(r) ? 'Default' : 'Make default'}</button>
            ${r.name == null ? '<span></span>' : `<button class="sr-btn sr-del${confirmDelete === r.name ? ' armed' : ''}">${confirmDelete === r.name ? 'Delete?' : 'Delete'}</button>`}
          </div>`).join('')}
        </div>
      </div>`;
    root.querySelectorAll('.set-row').forEach(el => {
      const i = Number(el.dataset.i);
      el.addEventListener('click', () => { if (sel !== i) confirmDelete = null; sel = i; });
      el.querySelector('.sr-default').addEventListener('click', e => { e.stopPropagation(); sel = i; makeDefault(i); });
      el.querySelector('.sr-del')?.addEventListener('click', e => { e.stopPropagation(); sel = i; remove(i); });
    });
    root.querySelector('.set-row.sel')?.scrollIntoView({ block: 'nearest' });
  }

  let version = -1;
  const TEMPLATES = {
    name: 'Templates',
    update() {
      if (version !== templates.version()) { version = templates.version(); readRows(); }
      drawTemplates();
    },
    count: () => rows.length,
    enter() { makeDefault(sel); },
    del() { remove(sel); },
    canDelete: () => rows[sel]?.name != null,
    press(p) { if (p < rows.length) { if (sel !== p) confirmDelete = null; sel = p; } },
    // A pad per row (the default amber, the chosen one white).
    state: () => rows.slice(0, 32).map((r, i) => ({ on: true, current: i === sel, code: isDefault(r) ? 0x2B : 0x02 })),
  };

  // ---- MIDI -----------------------------------------------------------------------
  // The pads: row 1 = All + up to 7 inputs, row 2 = Omni, rows 3-4 = channels 1-16. `sel` walks
  // the ones in use, in that order.
  // Not the ports the looper sends to (e.g. the IAC bus): those are always ignored, so can't be picked.
  const live = () => midiInputs.filter(n => !isOwnOutput(n));
  const inputs = () => {
    const names = live();
    if (midiIn.input && !names.includes(midiIn.input)) names.push(midiIn.input);   // picked but unplugged
    return [null, ...names].slice(0, 8);
  };
  const midiPads = () => [...inputs().map((name, i) => ({ pad: i, input: name })), { pad: 8, channel: 0 },
    ...Array.from({ length: 16 }, (_, c) => ({ pad: 16 + c, channel: c + 1 }))];
  const picked = it => ('input' in it ? midiIn.input === it.input : midiIn.channel === it.channel);
  function pickMidi(it) {
    if (!it || picked(it)) return;
    setMidiIn('input' in it ? { input: it.input } : { channel: it.channel });
    onMidiChange?.();
  }
  function drawMidi() {
    const items = midiPads(), on = live();
    const key = JSON.stringify(['m', sel, midiIn, items.map(it => it.input ?? it.channel), on]);
    if (key === shown) return;
    shown = key;
    const cell = (it, i) => {
      const label = 'input' in it ? (it.input ?? 'All inputs') : it.channel ? String(it.channel) : 'Omni';
      const gone = 'input' in it && it.input && !on.includes(it.input);
      return `<button class="card set-pad${picked(it) ? ' on' : ''}${i === sel ? ' sel' : ''}${gone ? ' gone' : ''}${'channel' in it ? ' ch' : ''}" data-i="${i}"
        style="grid-row:${(it.pad >> 3) + 1};grid-column:${(it.pad & 7) + 1}"><span class="card-name">${esc(label)}</span></button>`;
    };
    root.innerHTML = `<div class="set-pads">${items.map(cell).join('')}</div>`;
    root.querySelectorAll('.set-pad').forEach(el => el.addEventListener('click', () => { sel = Number(el.dataset.i); pickMidi(items[sel]); }));
  }
  const MIDI = {
    name: 'MIDI',
    update: drawMidi,
    count: () => midiPads().length,
    enter() { pickMidi(midiPads()[sel]); },
    del() {},
    canDelete: () => false,
    press(p) { const items = midiPads(), i = items.findIndex(it => it.pad === p); if (i >= 0) { sel = i; pickMidi(items[i]); } },
    state() {
      const out = Array(32).fill(null);
      midiPads().forEach((it, i) => (out[it.pad] = { on: true, current: i === sel, code: picked(it) ? 0x2B : 0x02 }));
      return out;
    },
  };

  const PAGES = [TEMPLATES, MIDI, ...more];
  let fresh = true;                                     // the page changed: draw it from scratch
  const cur = () => PAGES[page];
  return {
    pages: PAGES,
    page: () => page,
    selectPage(i) { if (i < PAGES.length && i !== page) { page = i; sel = 0; confirmDelete = null; shown = ''; fresh = true; } },
    update() { cur().update(root, fresh); fresh = false; },
    move(dir) { if (cur().move) return cur().move(dir); sel = Math.max(0, Math.min(cur().count() - 1, sel + dir)); confirmDelete = null; },
    enter() { cur().enter(); },
    del() { cur().del(); },
    canDelete: () => cur().canDelete(),
    close() { confirmDelete = null; },
    cards: {
      press(p) { cur().press(p); },
      release() {},
      state: () => cur().state(),
    },
  };
}
