// The Kits page: your kits (each with a switch for whether Kits cycles through it), and the kit
// editor: 16 pads laid out as on the Circuit (1-8 along the bottom). Drop audio files onto pads,
// click a pad to hear it, drag one pad onto another to swap them, ✕ to clear, then save it named.
import { INSTRUMENTS, KIT } from './instruments.js';
import { KitStore, PADS, registerKit, kitKey, labelFor } from './kits.js';
import { cardPage, tracksUsing } from './cards.js';

const AUDIO_FILE = /\.(wav|wave|aif|aiff|mp3|m4a|aac|flac|ogg|opus|caf)$/i;

export function setupKitPage({ root, audio, engine, kitOn, session, onKitsChanged, builtInKits }) {
  const store = new KitStore(session.store);
  let draft = null;        // the kit being edited: { name, from, pads: [{ label, buffer, file?, bytes?, ext? } | null] }
  let dirty = false;
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

  // ---- the library ------------------------------------------------------------------

  // Built-in kits (shipped with the app): always there, no folder needed.
  const builtIn = {};
  for (const kit of builtInKits) {
    builtIn[kit.name] = kit;
    kitOn[kitKey(kit.name)] ??= true;
  }
  const builtInReady = Promise.resolve();

  // Load every kit in the folder as an instrument. Kits keep their switch; new ones start on.
  let loading = null;
  async function refresh() {
    await builtInReady;
    if ((await session.store.access()) !== 'granted') return;
    loading ??= (async () => {
      for (const name of await store.names()) {
        try {
          registerKit(await store.load(name, audio.ctx));
          kitOn[kitKey(name)] ??= true;
        } catch (err) { console.warn('kit', name, err); }
      }
      onKitsChanged();
      if (!draft) drawList();
    })().finally(() => { loading = null; });
    return loading;
  }

  const kitKeys = () => Object.keys(INSTRUMENTS).filter(k => INSTRUMENTS[k].kit).sort((a, b) => a.localeCompare(b));

  // The kit cards. Your own kits live in the projects folder: without access, a note says so.
  let access = 'granted';
  const cards = cardPage(root, {
    items: () => kitKeys().map(key => ({ key, name: INSTRUMENTS[key].name, color: INSTRUMENTS[key].color })),
    isOn: key => kitOn[key] !== false,
    current: key => audio.instruments[engine.selected] === key,
    toggle: key => { kitOn[key] = kitOn[key] === false; },
    usedBy: key => tracksUsing(audio.instruments, key) || (INSTRUMENTS[key].builtIn ? 'built-in' : ''),
    onEdit: key => edit(INSTRUMENTS[key].name),
    onNew: () => edit(null),
    newLabel: 'New kit',
    footer: () => (access === 'granted' ? '' : `<span class="cards-note">${access === 'none' ? 'Your own kits are kept in your projects folder.' : `Allow access to your projects folder, “${esc(session.store.folderName)}”, to see your own kits.`}</span>
      <button class="dlg-btn" data-act="allow">${access === 'none' ? 'Choose folder…' : 'Allow'}</button>`),
    wireFoot: foot => foot.querySelector('[data-act=allow]')?.addEventListener('click', async () => { try { if (await session.store.allow()) refresh(); } catch {} }),
  });
  async function drawList() {
    draft = null;
    access = await session.store.access();
    cards.draw();
  }
  function update() {
    if (draft) return drawPads();
    cards.update();
  }

  // ---- the editor ----------------------------------------------------------------------

  async function edit(name) {
    if (name && INSTRUMENTS[kitKey(name)]?.builtIn && builtIn[name]) {
      // A built-in kit: edit a copy (its samples come along as new files when saved).
      draft = { name, from: null, pads: builtIn[name].pads.map(p => p && { ...p }) };
    } else if (name) {
      try { draft = { ...(await store.load(name, audio.ctx)), from: name }; }
      catch (err) { session.toast(`Couldn't open kit “${name}”: ${err.message}`, 'warn'); return; }
    } else {
      draft = { name: '', from: null, pads: Array(PADS).fill(null) };
    }
    dirty = false;
    root.innerHTML = `
      <div class="kit-edit">
        <div class="ke-head">
          <input class="dlg-name ke-name" id="ke-name" placeholder="Kit name" maxlength="60" spellcheck="false" value="${esc(draft.name)}">
          <button class="dlg-btn" data-act="back">Back</button>
          <button class="dlg-btn primary" data-act="save">Save kit</button>
        </div>
        <p class="dlg-note" id="ke-note">Drop audio files onto pads (several fill the pads after it) · click a pad to hear it · drag a pad onto another to swap · ✕ clears</p>
        <div class="kit ke-pads" id="ke-pads"></div>
      </div>`;
    const grid = root.querySelector('#ke-pads');
    for (let i = 0; i < PADS; i++) {
      const pad = document.createElement('div');
      pad.className = 'kpad ke-pad';
      pad.style.gridRow = i < 8 ? 2 : 1;
      pad.style.gridColumn = (i % 8) + 1;
      pad.draggable = true;
      pad.innerHTML = `<canvas></canvas><span class="knum">${i + 1}</span><span class="kname"></span><span class="ke-hint">${KIT[i].name}</span><button class="ke-clear" title="Clear this pad">✕</button>`;
      wirePad(pad, i);
      grid.appendChild(pad);
    }
    const nameEl = root.querySelector('#ke-name');
    nameEl.addEventListener('input', () => { dirty = true; });
    nameEl.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') save(); });
    root.querySelector('[data-act=save]').onclick = save;
    const back = root.querySelector('[data-act=back]');
    back.onclick = () => {
      if (dirty && back.dataset.sure !== '1') { back.dataset.sure = '1'; back.textContent = 'Discard changes'; return; }
      close();
    };
    if (!name) nameEl.focus();
    drawn = '';
    drawPads();
  }

  function close() { draft = null; drawList(); }

  let drawn = '';
  function drawPads() {
    const key = draft.pads.map(p => p?.label ?? '').join('|');
    if (key === drawn) return;
    drawn = key;
    root.querySelectorAll('.ke-pad').forEach((pad, i) => {
      const p = draft.pads[i];
      pad.classList.toggle('filled', !!p);
      pad.querySelector('.kname').textContent = p?.label ?? '';
      drawWave(pad.querySelector('canvas'), p?.buffer);
    });
  }

  function drawWave(canvas, buffer) {
    const w = canvas.clientWidth || 80, h = canvas.clientHeight || 40, dpr = devicePixelRatio || 1;
    canvas.width = w * dpr; canvas.height = h * dpr;
    const g = canvas.getContext('2d');
    g.clearRect(0, 0, canvas.width, canvas.height);
    if (!buffer) return;
    const d = buffer.getChannelData(0), n = Math.floor(w * dpr), step = d.length / n;
    g.fillStyle = 'rgba(255,255,255,0.22)';
    for (let x = 0; x < n; x++) {
      let m = 0;
      for (let j = Math.floor(x * step), e = Math.floor((x + 1) * step); j < e; j++) m = Math.max(m, Math.abs(d[j]));
      const bar = Math.max(1, m * canvas.height * 0.9);
      g.fillRect(x, (canvas.height - bar) / 2, 1, bar);
    }
  }

  function audition(i) {
    const b = draft.pads[i]?.buffer;
    if (!b) return;
    audio.resume();
    const src = new AudioBufferSourceNode(audio.ctx, { buffer: b });
    src.connect(audio.master);
    src.start();
  }

  function wirePad(pad, i) {
    pad.addEventListener('click', e => {
      if (e.target.closest('.ke-clear')) { draft.pads[i] = null; dirty = true; return drawPads(); }
      audition(i);
    });
    pad.addEventListener('dragstart', e => {
      if (!draft.pads[i]) return e.preventDefault();
      e.dataTransfer.setData('application/x-zerkit-pad', String(i));
      e.dataTransfer.effectAllowed = 'move';
    });
    pad.addEventListener('dragover', e => { e.preventDefault(); pad.classList.add('drop'); });
    pad.addEventListener('dragleave', () => pad.classList.remove('drop'));
    pad.addEventListener('drop', async e => {
      e.preventDefault();
      pad.classList.remove('drop');
      const from = e.dataTransfer.getData('application/x-zerkit-pad');
      if (from !== '') {                                   // pad onto pad: swap them
        const j = Number(from);
        [draft.pads[i], draft.pads[j]] = [draft.pads[j], draft.pads[i]];
        dirty = true;
        return drawPads();
      }
      const files = [...e.dataTransfer.files].filter(f => f.type.startsWith('audio/') || AUDIO_FILE.test(f.name));
      if (!files.length) return session.toast('Drop audio files (WAV, AIFF, MP3, M4A, FLAC)', 'warn');
      // The first file goes on this pad, the rest on the empty pads after it.
      const targets = [i];
      for (let k = i + 1; k < PADS && targets.length < files.length; k++) if (!draft.pads[k]) targets.push(k);
      if (targets.length < files.length) session.toast(`Only ${targets.length} of ${files.length} files fitted`, 'warn');
      await Promise.all(targets.map(async (k, n) => {
        const f = files[n];
        try {
          const bytes = await f.arrayBuffer();
          const buffer = await audio.ctx.decodeAudioData(bytes.slice(0));
          draft.pads[k] = { label: labelFor(f.name), buffer, bytes, ext: (f.name.match(/\.([^.]+)$/)?.[1] ?? 'wav').toLowerCase() };
        } catch { session.toast(`Couldn't read “${f.name}”`, 'warn'); }
      }));
      dirty = true;
      drawPads();
    });
  }

  let saving = false;
  async function save() {
    if (saving) return;
    const nameEl = root.querySelector('#ke-name'), note = root.querySelector('#ke-note');
    const name = nameEl.value.trim().replace(/[\\/:*?"<>|]/g, '-');
    if (!name) { nameEl.focus(); note.innerHTML = '<b class="warn">Give the kit a name.</b>'; return; }
    const btn = root.querySelector('[data-act=save]');
    // A new name that's taken by another kit: ask once.
    if (name !== draft.from && btn.dataset.replace !== name && await store.exists(name)) {
      btn.dataset.replace = name;
      btn.textContent = 'Replace';
      note.innerHTML = `<b class="warn">A kit called “${esc(name)}” already exists.</b> Save again to replace it.`;
      return;
    }
    saving = true;
    try {
      if (!(await session.ensureAccess())) return;
      const kit = { name, pads: draft.pads };
      await store.save(kit, draft.from);
      registerKit(kit);
      kitOn[kitKey(name)] ??= true;
      onKitsChanged();
      session.toast(`Kit saved · ${name}`);
      close();
    } catch (err) {
      console.error(err);
      session.toast(`Couldn't save kit: ${err.message}`, 'warn');
    } finally {
      saving = false;
    }
  }

  // Allow dropping onto the page without the browser opening the file instead.
  root.addEventListener('dragover', e => e.preventDefault());
  root.addEventListener('drop', e => e.preventDefault());

  refresh();
  drawList();
  return { refresh, update, show: () => (draft ? null : drawList()), editing: () => !!draft, cards };
}
