// Audio instruments: a named audio input ("CP88" = the CP88's USB audio). An audio track plays one;
// choosing it for a track connects the track to that input. They're kept on this computer (inputs
// belong to the machine), and projects remember each one's name and input, so opening a project
// elsewhere makes the ones it needs.
//
// The Audio page (Shift + Audio, the Circuit's Mixer button) lists them, each with a switch for
// whether Audio (tap) cycles through it, and makes new ones: a name and an input.
import { INSTRUMENTS } from './instruments.js';
import { cardPage, tracksUsing } from './cards.js';

const STORE = 'audioInstruments';
const COLORS = ['#c9d46a', '#e0a95a', '#6ad4b8', '#d48ae0', '#8ab4f8', '#e07a7a'];
export const audioKey = name => `audio:${name}`;
const colorFor = name => COLORS[[...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 3) % COLORS.length];

function saved() {
  try { return JSON.parse(localStorage.getItem(STORE) ?? '[]'); } catch { return []; }
}
function persist() {
  const list = Object.values(INSTRUMENTS).filter(d => d.audio).map(d => ({ name: d.name, input: d.input }));
  try { localStorage.setItem(STORE, JSON.stringify(list)); } catch {}
}
function register({ name, input }) {
  INSTRUMENTS[audioKey(name)] = { name, color: colorFor(name), audio: true, input: input ?? null };
}

export function setupAudioInstruments({ root, audio, engine, inputs, audioOn, session, onChanged }) {
  for (const a of saved()) { register(a); audioOn[audioKey(a.name)] ??= true; }
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  let editing = null;          // { from: name | null } while the editor is open

  // Make (or update) one, e.g. for a project that uses one this computer doesn't have yet.
  function ensure(name, input) {
    const key = audioKey(name);
    if (INSTRUMENTS[key]) return key;
    register({ name, input });
    audioOn[key] ??= true;
    persist();
    onChanged();
    return key;
  }

  const keys = () => Object.keys(INSTRUMENTS).filter(k => INSTRUMENTS[k].audio).sort((a, b) => a.localeCompare(b));
  const connected = label => inputs.devices.some(d => d.label === label);

  const cards = cardPage(root, {
    items: () => keys().map(key => ({ key, name: INSTRUMENTS[key].name, color: INSTRUMENTS[key].color })),
    isOn: key => audioOn[key] !== false,
    current: key => audio.instruments[engine.selected] === key,
    toggle: key => { audioOn[key] = audioOn[key] === false; },
    usedBy: key => [tracksUsing(audio.instruments, key), INSTRUMENTS[key].input ? (inputs.devices.some(d => d.label !== 'Audio input') && !connected(INSTRUMENTS[key].input) ? 'not connected' : '') : 'no input'].filter(Boolean).join(' · '),
    onEdit: key => edit(INSTRUMENTS[key].name),
    onNew: () => edit(null),
    newLabel: 'New audio',
  });
  function drawList() { editing = null; cards.draw(); }
  function update() { if (!editing) cards.update(); }

  async function edit(name) {
    editing = { from: name };
    const def = name ? INSTRUMENTS[audioKey(name)] : null;
    root.innerHTML = `
      <div class="kit-edit audio-edit">
        <div class="ke-head">
          <input class="dlg-name ke-name" id="ae-name" placeholder="Name, e.g. CP88" maxlength="40" spellcheck="false" value="${esc(def?.name ?? '')}">
          <button class="dlg-btn" data-act="back">Back</button>
          <button class="dlg-btn primary" data-act="save">Save</button>
        </div>
        <label class="ae-row"><span>Input</span><select class="inst ae-input" id="ae-input"><option>Loading inputs…</option></select></label>
        <p class="dlg-note" id="ae-note">The audio input this plays: an instrument's USB audio, an interface input, a microphone.</p>
      </div>`;
    const nameEl = root.querySelector('#ae-name'), sel = root.querySelector('#ae-input');
    nameEl.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') save(); });
    root.querySelector('[data-act=back]').onclick = drawList;
    root.querySelector('[data-act=save]').onclick = save;
    if (!name) nameEl.focus();
    // Device names need permission to use audio input once.
    let list = inputs.devices;
    if (!list.length || list[0].label === 'Audio input') { try { list = await inputs.permit(); } catch { list = []; } }
    if (!editing) return;
    const labels = [...new Set(list.map(d => d.label))];
    if (def?.input && !labels.includes(def.input)) labels.unshift(def.input);
    sel.innerHTML = labels.length
      ? labels.map(l => `<option value="${esc(l)}">${esc(l)}${connected(l) ? '' : ' (not connected)'}</option>`).join('')
      : '<option value="">No audio inputs found (allow audio input in the browser)</option>';
    if (def?.input) sel.value = def.input;
    sel.addEventListener('keydown', e => e.stopPropagation());
  }

  function save() {
    const nameEl = root.querySelector('#ae-name'), note = root.querySelector('#ae-note');
    const name = nameEl.value.trim();
    const input = root.querySelector('#ae-input').value || null;
    if (!name) { nameEl.focus(); note.innerHTML = '<b class="warn">Give it a name.</b>'; return; }
    const key = audioKey(name), from = editing.from, fromKey = from && audioKey(from);
    if (INSTRUMENTS[key] && name !== from) { note.innerHTML = `<b class="warn">There's already one called “${esc(name)}”.</b>`; return; }
    if (fromKey && fromKey !== key) {                     // renamed: tracks using it follow
      delete INSTRUMENTS[fromKey];
      audioOn[key] = audioOn[fromKey] ?? true;
      delete audioOn[fromKey];
    }
    register({ name, input });
    audioOn[key] ??= true;
    persist();
    onChanged({ renamed: fromKey && fromKey !== key ? [fromKey, key] : null, key });
    session.toast(`Saved · ${name}`);
    drawList();
  }

  return { ensure, update, show: () => (editing ? null : drawList()), editing: () => !!editing, cards };
}
