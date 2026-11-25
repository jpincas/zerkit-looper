// The Instruments page: the melodic instruments as cards (tap: in or out of Instrument's cycle),
// and the instrument maker. New instruments come from the sampler (it plays a MIDI instrument
// note by note and records it through an audio instrument's input) or from dropped audio files
// (each one's note from its name, e.g. "Piano_C4.wav"). Made with the Circuit in mind: its knobs
// 1-8 are the eight settings, Play starts or stops sampling, Record saves.
import { INSTRUMENTS } from './instruments.js';
import { cardPage, tracksUsing } from './cards.js';
import { registerSampler, samplerKey, InstrumentStore, noteName, noteFromName, spreadZones } from './sampler.js';
import { outputPort } from './midiinst.js';

const EVERY = [1, 2, 3, 4, 6, 12];
// The eight settings, in Circuit knob order. `v` is the value, `nudge` a relative turn.
const SETTINGS = [
  { key: 'low', name: 'Low note', min: 21, max: 96, step: 1, fmt: noteName },
  { key: 'high', name: 'High note', min: 36, max: 108, step: 1, fmt: noteName },
  { key: 'every', name: 'Every', list: EVERY, fmt: v => `${v} st` },
  { key: 'layers', name: 'Layers', list: [1, 2, 3], fmt: v => `${v} vel` },
  { key: 'length', name: 'Note length', min: 0.3, max: 8, step: 0.1, fmt: v => `${v.toFixed(1)}s` },
  { key: 'tail', name: 'Tail', min: 0.1, max: 6, step: 0.1, fmt: v => `${v.toFixed(1)}s` },
  { key: 'release', name: 'Release', min: 0.05, max: 3, step: 0.05, fmt: v => `${v.toFixed(2)}s` },
  { key: 'octave', name: 'Octave', min: 1, max: 6, step: 1, fmt: v => `C${v}` },
];
const VELS = { 1: [100], 2: [64, 120], 3: [45, 85, 125] };
const sleep = ms => new Promise(r => setTimeout(r, ms));

export function setupInstrumentPage({ root, audio, engine, presetOn, session, inputs, onChanged }) {
  const store = new InstrumentStore(session.store);
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  let draft = null;           // { name, from, zones: [{ root, layer, buffer }], s: settings, midi, audio }
  let run = null;             // sampling in progress: { stop, text }

  // ---- the cards ------------------------------------------------------------------------
  const cards = cardPage(root, {
    items: () => Object.keys(presetOn).filter(k => INSTRUMENTS[k]).map(key => ({ key, name: INSTRUMENTS[key].name, color: INSTRUMENTS[key].color })),
    isOn: key => presetOn[key],
    current: key => audio.instruments[engine.selected] === key,
    toggle: key => { presetOn[key] = !presetOn[key]; },
    usedBy: key => tracksUsing(audio.instruments, key) || (INSTRUMENTS[key].builtIn ? 'built-in' : 'yours'),
    onEdit: key => (INSTRUMENTS[key].sampled && !INSTRUMENTS[key].builtIn ? edit(key) : session.toast('Built-in instruments can\'t be edited', 'warn')),
    onNew: () => edit(null),
    newLabel: 'New instrument',
  });

  // Your own instruments, from the projects folder.
  async function refresh() {
    if ((await session.store.access()) !== 'granted') return;
    for (const name of await store.names()) {
      try {
        const def = await store.register(name, audio.ctx);
        presetOn[samplerKey(def.name)] ??= true;
      } catch (err) { console.warn('instrument', name, err); }
    }
    onChanged();
    if (!draft) cards.draw();
  }

  // ---- the maker ---------------------------------------------------------------------------
  async function edit(key) {
    const def = key && INSTRUMENTS[key];
    draft = {
      name: def?.name ?? '', from: def?.name ?? null, zones: [],
      s: { low: 36, high: 84, every: 3, layers: 1, length: 2, tail: 1, release: def?.release ?? 0.4, octave: def?.octave ?? 3 },
      midi: Object.keys(INSTRUMENTS).find(k => INSTRUMENTS[k].midi) ?? '',
      audio: Object.keys(INSTRUMENTS).find(k => INSTRUMENTS[k].audio) ?? '',
    };
    if (def) {
      await def.load();
      const layerStarts = [...new Set(def.zones.map(z => z.velLo))].sort((a, b) => a - b);
      draft.zones = def.zones.filter(z => z.buffer).map(z => ({ root: z.root, buffer: z.buffer, layer: layerStarts.indexOf(z.velLo) }));
      draft.s.layers = Math.min(3, layerStarts.length);
    }
    draw();
  }

  const opt = (keys, cur, none) => (keys.length ? keys.map(k => `<option value="${esc(k)}"${k === cur ? ' selected' : ''}>${esc(INSTRUMENTS[k].name)}</option>`).join('') : `<option value="">${none}</option>`);

  function draw() {
    const midis = Object.keys(INSTRUMENTS).filter(k => INSTRUMENTS[k].midi);
    const auds = Object.keys(INSTRUMENTS).filter(k => INSTRUMENTS[k].audio);
    root.innerHTML = `
      <div class="kit-edit inst-edit">
        <div class="ke-head">
          <input class="dlg-name ke-name" id="ie-name" placeholder="Name, e.g. Moog Bass" maxlength="40" spellcheck="false" value="${esc(draft.name)}">
          <button class="dlg-btn" data-act="back">Back</button>
          <button class="dlg-btn primary" data-act="save" title="Save (Record on the Circuit)">Save</button>
        </div>
        <div class="ie-source">
          <span>Sample</span><select class="inst" id="ie-midi">${opt(midis, draft.midi, 'no MIDI instruments (Shift + MIDI)')}</select>
          <span>through</span><select class="inst" id="ie-audio">${opt(auds, draft.audio, 'no audio instruments (Shift + Audio)')}</select>
          <button class="dlg-btn primary" data-act="run" title="Start or stop (Play on the Circuit)">▶ Sample</button>
          <span class="ie-run"></span>
        </div>
        <div class="ie-knobs">${SETTINGS.map((p, k) => `<div class="knob pk" data-k="${k}"><div class="dial"><i></i></div><span class="klabel">${p.name}</span><span class="kval"></span></div>`).join('')}</div>
        <div class="ie-zones" id="ie-zones"></div>
        <p class="dlg-note">Or drop audio files here: each one's note from its name ("Piano_C4.wav", "Moog A#2"). Click a note to hear it.</p>
      </div>`;
    const nameEl = root.querySelector('#ie-name');
    for (const el of root.querySelectorAll('input, select')) el.addEventListener('keydown', e => e.stopPropagation());
    nameEl.addEventListener('input', () => { draft.name = nameEl.value; });
    nameEl.addEventListener('keydown', e => { if (e.key === 'Enter') save(); });
    root.querySelector('#ie-midi').addEventListener('change', e => { draft.midi = e.target.value; });
    root.querySelector('#ie-audio').addEventListener('change', e => { draft.audio = e.target.value; });
    root.querySelector('[data-act=back]').onclick = () => { stopRun(); draft = null; cards.draw(); };
    root.querySelector('[data-act=save]').onclick = save;
    root.querySelector('[data-act=run]').onclick = toggleRun;
    root.querySelectorAll('.ie-knobs .pk').forEach(el => {
      const k = Number(el.dataset.k), dial = el.querySelector('.dial');
      dial.addEventListener('wheel', e => { e.preventDefault(); nudge(k, e.deltaY < 0 ? 3 : -3); }, { passive: false });
      dial.addEventListener('pointerdown', e => {
        e.preventDefault();
        let y = e.clientY;
        const move = ev => { const d = Math.round((y - ev.clientY) / 4); if (d) { y = ev.clientY; nudge(k, d); } };
        const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
      });
    });
    const zonesEl = root.querySelector('#ie-zones');
    root.querySelector('.inst-edit').addEventListener('dragover', e => e.preventDefault());
    root.querySelector('.inst-edit').addEventListener('drop', e => { e.preventDefault(); dropFiles([...e.dataTransfer.files]); });
    zonesEl.addEventListener('click', e => {
      const chip = e.target.closest('.ie-zone');
      if (!chip) return;
      const i = Number(chip.dataset.i);
      if (e.target.closest('.ie-x')) { draft.zones.splice(i, 1); drawZones(); return; }
      audition(draft.zones[i]);
    });
    drawZones();
    update();
  }

  function drawZones() {
    const el = root.querySelector('#ie-zones');
    if (!el) return;
    const sorted = draft.zones.map((z, i) => ({ z, i })).sort((a, b) => a.z.layer - b.z.layer || a.z.root - b.z.root);
    el.innerHTML = sorted.length ? sorted.map(({ z, i }) => `<span class="ie-zone" data-i="${i}" title="Click to hear">${noteName(z.root)}${draft.s.layers > 1 ? `<small>v${z.layer + 1}</small>` : ''}<b class="ie-x" title="Remove">✕</b></span>`).join('')
      : '<span class="dlg-note">No notes yet: sample some, or drop files.</span>';
  }

  // Knob turns (screen or Circuit). Listed settings step every few clicks.
  const acc = Array(8).fill(0);
  function nudge(k, delta) {
    const p = SETTINGS[k], s = draft.s;
    if (p.list) {
      acc[k] += delta;
      if (Math.abs(acc[k]) < 3) return;
      const i = Math.max(0, Math.min(p.list.length - 1, p.list.indexOf(s[p.key]) + Math.sign(acc[k])));
      acc[k] = 0;
      s[p.key] = p.list[i];
    } else {
      s[p.key] = Math.max(p.min, Math.min(p.max, Math.round((s[p.key] + delta * p.step) / p.step) * p.step));
    }
    if (s.high < s.low + 1) s.high = s.low + 1;
  }
  const fraction = k => { const p = SETTINGS[k], v = draft.s[p.key]; return p.list ? p.list.indexOf(v) / (p.list.length - 1) : (v - p.min) / (p.max - p.min); };

  const plan = () => {
    const notes = [];
    for (let n = draft.s.low; n <= draft.s.high; n += draft.s.every) notes.push(n);
    return notes;
  };

  function update() {
    if (!draft) return cards.update();
    root.querySelectorAll('.ie-knobs .pk').forEach(el => {
      const k = Number(el.dataset.k), p = SETTINGS[k];
      el.querySelector('.dial').style.setProperty('--v', fraction(k).toFixed(3));
      const t = p.fmt(draft.s[p.key]);
      const kv = el.querySelector('.kval');
      if (kv.textContent !== t) kv.textContent = t;
    });
    const n = plan().length, layers = draft.s.layers, secs = n * layers * (draft.s.length + draft.s.tail + 0.3);
    const runEl = root.querySelector('.ie-run');
    const t = run ? run.text : `${n} notes × ${layers} = ${n * layers} samples, about ${Math.round(secs / 60)}m ${Math.round(secs % 60)}s`;
    if (runEl && runEl.textContent !== t) runEl.textContent = t;
    const btn = root.querySelector('[data-act=run]');
    if (btn) btn.textContent = run ? '■ Stop' : '▶ Sample';
  }

  // ---- sampling: play each note over MIDI, record it, trim it ----------------------------
  function toggleRun() { run ? stopRun() : startRun(); }
  function stopRun() { if (run) run.stopped = true; }

  async function startRun() {
    const midi = INSTRUMENTS[draft.midi], aud = INSTRUMENTS[draft.audio];
    const port = midi && outputPort(midi.output);
    if (!port) return session.toast(midi ? `“${midi.name}”: its output isn't connected` : 'Choose a MIDI instrument to sample (Shift + MIDI makes one)', 'warn');
    if (!aud?.input) return session.toast('Choose an audio instrument with an input (Shift + Audio)', 'warn');
    let list = inputs.devices.length && inputs.devices[0].label !== 'Audio input' ? inputs.devices : null;
    try { list ??= await inputs.permit(); } catch { list = []; }
    const dev = list.find(d => d.label === aud.input);
    if (!dev) return session.toast(`“${aud.input}” isn't connected`, 'warn');
    const input = await inputs.open(dev.deviceId);
    audio.resume();
    const ch = (midi.channel - 1) & 15, notes = plan(), vels = VELS[draft.s.layers], total = notes.length * vels.length;
    const { length, tail } = draft.s;
    run = { stopped: false, text: 'Starting…' };
    const got = [];
    let i = 0;
    for (const [layer, vel] of vels.entries()) {
      for (const note of notes) {
        if (run.stopped || !draft) break;
        run.text = `Sampling ${noteName(note)}${vels.length > 1 ? ` v${layer + 1}` : ''} (${++i}/${total})`;
        const t0 = audio.ctx.currentTime;
        port.send([0x90 | ch, note, vel]);
        await sleep(length * 1000);
        port.send([0x80 | ch, note, 0]);
        await sleep(tail * 1000 + 250);
        let r;
        for (let tries = 0; tries < 40; tries++) { r = input.extract(t0 - 0.05, length + tail + 0.35); if (r.complete) break; await sleep(50); }
        const buffer = trim(r.buffer);
        if (buffer) got.push({ root: note, layer, buffer });
      }
    }
    port.send([0xB0 | ch, 123, 0]);                          // all notes off, just in case
    const stopped = run.stopped;
    run = null;
    if (!draft) return;
    if (!got.length) return session.toast('Nothing was heard: check the MIDI instrument and the audio input', 'warn');
    // New layers replace the notes already there at the same root and layer.
    draft.zones = draft.zones.filter(z => !got.some(g => g.root === z.root && g.layer === z.layer)).concat(got);
    normalise(draft.zones);
    drawZones();
    session.toast(`${got.length} notes sampled${stopped ? ' (stopped)' : ''}`);
  }

  // From the first sound (a little before it) to where it dies away, with a short fade.
  function trim(buf) {
    const L = buf.getChannelData(0), R = buf.numberOfChannels > 1 ? buf.getChannelData(1) : L;
    let peak = 0;
    for (let i = 0; i < L.length; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
    if (peak < 0.003) return null;                            // silence
    const on = peak * 0.05, off = peak * 0.001;
    let a = 0;
    while (a < L.length && Math.abs(L[a]) < on && Math.abs(R[a]) < on) a++;
    a = Math.max(0, a - Math.round(buf.sampleRate * 0.004));
    let b = L.length - 1;
    while (b > a && Math.abs(L[b]) < off && Math.abs(R[b]) < off) b--;
    const len = Math.max(1, b - a + 1), sr = buf.sampleRate, fadeN = Math.min(len, Math.round(sr * 0.03));
    const out = new AudioBuffer({ numberOfChannels: 2, length: len, sampleRate: sr });
    [L, R].forEach((src, c) => {
      const dst = out.getChannelData(c);
      dst.set(src.subarray(a, a + len));
      for (let i = 0; i < fadeN; i++) dst[len - 1 - i] *= i / fadeN;
    });
    return out;
  }

  // One gain for the whole instrument, so its loudest note peaks at -1 dBFS and dynamics stay.
  function normalise(zones) {
    let peak = 0;
    for (const z of zones) for (let c = 0; c < z.buffer.numberOfChannels; c++) for (const x of z.buffer.getChannelData(c)) peak = Math.max(peak, Math.abs(x));
    if (!peak) return;
    const g = 0.89 / peak;
    if (Math.abs(g - 1) < 0.01) return;
    for (const z of zones) for (let c = 0; c < z.buffer.numberOfChannels; c++) { const d = z.buffer.getChannelData(c); for (let i = 0; i < d.length; i++) d[i] *= g; }
  }

  async function dropFiles(files) {
    const audioFiles = files.filter(f => f.type.startsWith('audio/') || /\.(wav|aiff?|mp3|m4a|flac|ogg|caf)$/i.test(f.name));
    if (!audioFiles.length) return;
    let next = 60, unnamed = 0;
    for (const f of audioFiles) {
      try {
        const buffer = await audio.ctx.decodeAudioData(await f.arrayBuffer());
        let root = noteFromName(f.name);
        if (root == null) { root = next; next += 1; unnamed++; }
        draft.zones = draft.zones.filter(z => !(z.root === root && z.layer === 0));
        draft.zones.push({ root, layer: 0, buffer });
      } catch { session.toast(`Couldn't read “${f.name}”`, 'warn'); }
    }
    normalise(draft.zones);
    drawZones();
    if (unnamed) session.toast(`${unnamed} file${unnamed > 1 ? 's' : ''} had no note in the name: put on C4 upwards`, 'warn');
  }

  function audition(z) {
    if (!z) return;
    audio.resume();
    const src = new AudioBufferSourceNode(audio.ctx, { buffer: z.buffer });
    src.connect(audio.master);
    src.start();
    setTimeout(() => { try { src.stop(); } catch {} }, 2500);
  }

  async function save() {
    const name = draft.name.trim().replace(/[\\/:*?"<>|]/g, '-');
    if (!name) { root.querySelector('#ie-name')?.focus(); return session.toast('Give the instrument a name', 'warn'); }
    if (!draft.zones.length) return session.toast('Sample some notes, or drop files, first', 'warn');
    if (name !== draft.from && INSTRUMENTS[samplerKey(name)]) return session.toast(`There's already an instrument called “${name}”`, 'warn');
    if (!(await session.ensureAccess())) return;
    const layers = Math.max(...draft.zones.map(z => z.layer)) + 1;
    const zones = spreadZones(draft.zones.map(z => ({ ...z })), layers);
    try {
      await store.save({ name, octave: draft.s.octave, release: draft.s.release, zones });
      registerSampler({ name, octave: draft.s.octave, release: draft.s.release, zones, decode: b => audio.ctx.decodeAudioData(b) }).loaded = Promise.resolve();
      presetOn[samplerKey(name)] ??= true;
      onChanged();
      session.toast(`Saved · ${name}`);
      draft = null;
      cards.draw();
    } catch (err) {
      console.error(err);
      session.toast(`Couldn't save: ${err.message}`, 'warn');
    }
  }

  // ---- the Circuit while the maker is open ----------------------------------------------------
  const controls = {
    knob: (k, d) => nudge(k, d),
    button(name) {
      if (name === 'play') { toggleRun(); return true; }
      if (name === 'record') { save(); return true; }
      return false;
    },
    values: () => SETTINGS.map((_, k) => Math.round(fraction(k) * 126)),
    codes: () => SETTINGS.map(() => 0x2B),
  };

  cards.draw();
  return {
    refresh, update, cards, show: () => (draft ? draw() : cards.draw()),
    editing: () => !!draft,
    controls: () => (draft ? controls : null),
    sampling: () => !!run,
  };
}
