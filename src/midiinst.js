// MIDI instruments: a named external instrument played over MIDI ("Minilogue" = MIDI out to the
// Minilogue on channel 1). A track playing one sends its notes, live and looped, to that output
// on that channel, timed to line up with the browser's audio. Optionally an input: while the
// track is selected only that keyboard plays it (otherwise any keyboard does).
//
// Kept on this computer (ports belong to the machine); projects remember each one's settings, so
// opening a project elsewhere makes the ones it needs. The MIDI page (Shift + MIDI, the Circuit's
// Note button) lists them, each with a switch for whether MIDI (tap) cycles through it, and makes
// new ones.
import { INSTRUMENTS } from './instruments.js';
import { cardPage, tracksUsing } from './cards.js';

const STORE = 'midiInstruments';
const COLORS = ['#6aa8f0', '#a58af5', '#f08ad0', '#5fd0e0', '#9ad06a', '#f0b06a'];
export const midiKey = name => `midi:${name}`;
const colorFor = name => COLORS[[...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 5) % COLORS.length];
const notCircuit = p => !/circuit/i.test(p.name);   // the Circuit is the control surface, never an instrument

let access = null;
export const midiAccess = () => (access ??= navigator.requestMIDIAccess ? navigator.requestMIDIAccess() : Promise.reject(new Error('no Web MIDI')));
let ports = { inputs: [], outputs: [] };
midiAccess().then(m => {
  const scan = () => { ports = { inputs: [...m.inputs.values()].filter(notCircuit), outputs: [...m.outputs.values()].filter(notCircuit) }; };
  m.addEventListener('statechange', scan);
  scan();
}).catch(() => {});
const outputNamed = name => ports.outputs.find(p => p.name === name && p.state !== 'disconnected');
export const outputPort = outputNamed;                 // for the sampler

// Context time -> performance.now() time of when that moment is heard, so MIDI lands with the audio.
function perfTime(ctx, t) {
  const ts = ctx.getOutputTimestamp?.();
  if (ts && ts.performanceTime) return ts.performanceTime + (t - ts.contextTime) * 1000;
  return performance.now() + (t - ctx.currentTime) * 1000;
}

// A voice that plays the note on the instrument's output. Muted (or not soloed) tracks stay
// silent; the track's volume scales velocity (unity = as played).
function midiVoice(def, audio) {
  return (ctx, dest, note, vel, t, onEnd) => {
    const track = audio.bus.indexOf(dest);
    const port = outputNamed(def.output);
    const done = () => queueMicrotask(onEnd);
    if (!port || (track >= 0 && !audio.audible(track))) { done(); return { release() {}, kill() {} }; }
    const ch = (def.channel - 1) & 15;
    const v = Math.max(1, Math.min(127, Math.round(vel * Math.min(1.25, (audio.vol[track] ?? 0.8) / 0.8))));
    const on = perfTime(ctx, t);
    port.send([0x90 | ch, note, v], on);
    let ended = false;
    const end = at => {
      if (ended) return;
      ended = true;
      const off = Math.max(at, on + 1);
      port.send([0x80 | ch, note, 0], off);
      setTimeout(onEnd, Math.max(0, off - performance.now()) + 5);
    };
    return { release: when => end(perfTime(ctx, when)), kill: () => end(performance.now()) };
  };
}

function saved() {
  try { return JSON.parse(localStorage.getItem(STORE) ?? '[]'); } catch { return []; }
}

export function setupMidiInstruments({ root, audio, engine, midiOn, session, onChanged }) {
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  let editing = null;

  function register({ name, output = null, channel = 1, input = null }) {
    const def = { name, color: colorFor(name), midi: true, octave: 4, output, channel, input };
    def.voice = midiVoice(def, audio);
    INSTRUMENTS[midiKey(name)] = def;
  }
  function persist() {
    const list = Object.values(INSTRUMENTS).filter(d => d.midi).map(({ name, output, channel, input }) => ({ name, output, channel, input }));
    try { localStorage.setItem(STORE, JSON.stringify(list)); } catch {}
  }
  for (const m of saved()) { register(m); midiOn[midiKey(m.name)] ??= true; }

  // Make one a project needs that this computer hasn't got.
  function ensure(name, settings = {}) {
    const key = midiKey(name);
    if (INSTRUMENTS[key]) return key;
    register({ name, ...settings });
    midiOn[key] ??= true;
    persist();
    onChanged();
    return key;
  }

  const keys = () => Object.keys(INSTRUMENTS).filter(k => INSTRUMENTS[k].midi).sort((a, b) => a.localeCompare(b));
  const isThere = (list, name) => list.some(p => p.name === name && p.state !== 'disconnected');

  const cards = cardPage(root, {
    items: () => keys().map(key => ({ key, name: INSTRUMENTS[key].name, color: INSTRUMENTS[key].color })),
    isOn: key => midiOn[key] !== false,
    current: key => audio.instruments[engine.selected] === key,
    toggle: key => { midiOn[key] = midiOn[key] === false; },
    usedBy: key => [tracksUsing(audio.instruments, key), INSTRUMENTS[key].output ? (isThere(ports.outputs, INSTRUMENTS[key].output) ? `ch ${INSTRUMENTS[key].channel}` : 'not connected') : 'no output'].filter(Boolean).join(' · '),
    onEdit: key => edit(INSTRUMENTS[key].name),
    onNew: () => edit(null),
    newLabel: 'New MIDI instrument',
  });
  function drawList() { editing = null; cards.draw(); }
  function update() { if (!editing) cards.update(); }

  async function edit(name) {
    editing = { from: name };
    const def = name ? INSTRUMENTS[midiKey(name)] : null;
    try { await midiAccess(); } catch {}
    const opts = (list, current, none) => {
      const names = list.map(p => p.name);
      if (current && !names.includes(current)) names.unshift(current);
      return `<option value="">${none}</option>` + names.map(n =>
        `<option value="${esc(n)}"${n === current ? ' selected' : ''}>${esc(n)}${isThere(list, n) ? '' : ' (not connected)'}</option>`).join('');
    };
    root.innerHTML = `
      <div class="kit-edit audio-edit">
        <div class="ke-head">
          <input class="dlg-name ke-name" id="me-name" placeholder="Name, e.g. Minilogue" maxlength="40" spellcheck="false" value="${esc(def?.name ?? '')}">
          <button class="dlg-btn" data-act="back">Back</button>
          <button class="dlg-btn primary" data-act="save">Save</button>
        </div>
        <label class="ae-row"><span>Output</span><select class="inst ae-input" id="me-out">${opts(ports.outputs, def?.output, 'None')}</select>
          <select class="inst me-ch" id="me-ch">${[...Array(16)].map((_, i) => `<option value="${i + 1}"${(def?.channel ?? 1) === i + 1 ? ' selected' : ''}>Ch ${i + 1}</option>`).join('')}</select></label>
        <label class="ae-row"><span>Input</span><select class="inst ae-input" id="me-in">${opts(ports.inputs, def?.input, 'Any keyboard')}</select></label>
        <p class="dlg-note" id="me-note">Output: where its notes go. Input: which keyboard plays it while its track is selected (any, if not set). If the same instrument is both, turn its Local Control off so it doesn't sound twice.</p>
      </div>`;
    const nameEl = root.querySelector('#me-name');
    for (const el of root.querySelectorAll('input, select')) el.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter' && el === nameEl) save(); });
    root.querySelector('[data-act=back]').onclick = drawList;
    root.querySelector('[data-act=save]').onclick = save;
    if (!name) nameEl.focus();
  }

  function save() {
    const nameEl = root.querySelector('#me-name'), note = root.querySelector('#me-note');
    const name = nameEl.value.trim();
    const settings = {
      output: root.querySelector('#me-out').value || null,
      channel: Number(root.querySelector('#me-ch').value) || 1,
      input: root.querySelector('#me-in').value || null,
    };
    if (!name) { nameEl.focus(); note.innerHTML = '<b class="warn">Give it a name.</b>'; return; }
    const key = midiKey(name), from = editing.from, fromKey = from && midiKey(from);
    if (INSTRUMENTS[key] && name !== from) { note.innerHTML = `<b class="warn">There's already one called “${esc(name)}”.</b>`; return; }
    if (fromKey && fromKey !== key) {
      delete INSTRUMENTS[fromKey];
      midiOn[key] = midiOn[fromKey] ?? true;
      delete midiOn[fromKey];
    }
    register({ name, ...settings });
    midiOn[key] ??= true;
    persist();
    onChanged({ renamed: fromKey && fromKey !== key ? [fromKey, key] : null });
    session.toast(`Saved · ${name}`);
    drawList();
  }

  return { ensure, update, show: () => (editing ? null : drawList()), editing: () => !!editing, cards };
}
