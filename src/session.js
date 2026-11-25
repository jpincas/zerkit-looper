// The current project: saving it, opening others, starting a new one, and the screens for it
// (a name box the first time you save, a "Saved" notice after that, and a list of recent projects).
// Storage is in projects.js; this file turns the looper's state into a project and back.
import { Projects, supported } from './projects.js';

const FORMAT = 'zerkit-project', VERSION = 1;

export function setupSession(ctx) {
  const { engine, audio, actions, octaves, trackInput, presetOn, makeClip, inputs, useInput, chooseDefaultInput, DEFAULTS, INSTRUMENTS } = ctx;
  const store = new Projects();
  let name = null;             // the current project's name (null: never saved)
  let savedKey = null;         // what it looked like when last saved or opened, to tell if it's changed
  let busy = false;

  // ---- the looper's state <-> a project ----------------------------------------

  function snapshot() {
    const audioFiles = new Map();
    const tracks = engine.tracks.map((tr, t) => {
      const instrument = audio.instruments[t];
      const out = {
        instrument, octave: octaves[t], quant: tr.quant,
        volume: audio.vol[t], pan: audio.pan[t], mute: audio.mute[t], solo: audio.solo[t],
        loop: tr.loop ? { origin: tr.loop.origin, length: tr.loop.length } : null,
        notes: tr.notes.filter(n => n.dur != null).map(({ note, vel, start, dur, pass, kind }) => ({ note, vel, start, dur, pass, kind })),
      };
      if (INSTRUMENTS[instrument].audio) {
        out.input = inputs.devices.find(d => d.deviceId === trackInput[t])?.label ?? null;
        out.clips = tr.clips.map(c => {
          const file = `audio/${c.id}.wav`;
          const buf = c.complete();
          if (buf) audioFiles.set(file, buf);
          return { file, pass: c.pass, seconds: c.seconds };
        });
      }
      return out;
    });
    const json = {
      format: FORMAT, version: VERSION,
      tempo: engine.bpm, swing: engine.swing, click: engine.click, beatsPerBar: engine.beatsPerBar,
      nextPass: engine.pass,
      presetsOn: { ...presetOn },
      tracks,
    };
    return { json, audioFiles };
  }

  const keyOf = json => JSON.stringify(json);
  const isDirty = () => keyOf(snapshot().json) !== savedKey;

  // For the Open list: tempo, and each track's colour and loop length in bars.
  function summary(json) {
    return {
      tempo: json.tempo,
      tracks: json.tracks.map(t => ({ color: INSTRUMENTS[t.instrument]?.color ?? '#888', bars: t.loop ? t.loop.length / json.beatsPerBar : 0 })),
    };
  }

  async function restore(json, loadAudio) {
    if (json.format !== FORMAT) throw new Error('not a Zerkit project');
    // Load the audio first, so a missing file leaves the current project untouched.
    const clips = await Promise.all(json.tracks.map(t => Promise.all((t.clips ?? []).map(async c => {
      const buffer = await loadAudio(c.file);
      return makeClip(c.pass, c.seconds, keep => { keep(buffer); return buffer; }, c.file.split('/').pop().replace(/\.wav$/, ''));
    }))));
    engine.stop();
    engine.clearAll();
    engine.setTempo(json.tempo);
    engine.setSwing(json.swing ?? 50);
    engine.click = json.click ?? true;
    Object.assign(presetOn, json.presetsOn ?? {});
    json.tracks.forEach((t, i) => {
      actions.instrument(i, t.instrument);
      octaves[i] = t.octave ?? octaves[i];
      const tr = engine.tracks[i];
      tr.quant = t.quant ?? 'off';
      tr.notes = (t.notes ?? []).map(n => ({ ...n, track: i }));
      tr.clips = clips[i];
      tr.loop = t.loop ? { ...t.loop, playFrom: 0 } : null;
      audio.vol[i] = t.volume ?? 0.8;
      audio.mute[i] = !!t.mute;
      audio.solo[i] = !!t.solo;
      audio.setPan(i, t.pan ?? 0);
      if (INSTRUMENTS[t.instrument].audio) reconnectInput(i, t.input);
    });
    audio.mix();
    engine.pass = json.nextPass ?? 1 + Math.max(0, ...json.tracks.flatMap(t => [...(t.notes ?? []), ...(t.clips ?? [])].map(n => n.pass)));
  }

  // Audio inputs are found again by name (their ids differ between browsers and sessions).
  async function reconnectInput(t, label) {
    const list = await inputs.list();
    const match = label && list.find(d => d.label === label);
    if (match) useInput(t, match.deviceId); else chooseDefaultInput(t);
  }

  function reset() {
    engine.stop();
    engine.clearAll();
    engine.setTempo(120);
    engine.setSwing(50);
    for (const k of Object.keys(presetOn)) presetOn[k] = true;
    DEFAULTS.forEach((inst, i) => {
      actions.instrument(i, inst);
      engine.tracks[i].quant = 'off';
      audio.vol[i] = 0.8; audio.mute[i] = false; audio.solo[i] = false; audio.setPan(i, 0);
    });
    audio.mix();
    engine.pass = 0;
  }

  // ---- storage access ------------------------------------------------------------

  // Make sure the projects folder can be used. From a click this can ask (or pick the folder
  // the first time); from the Circuit it can't, so it says what to do instead.
  async function ensureAccess() {
    if (!supported()) { toast(isSecureContext ? 'Saving needs Chrome (File System Access)' : 'Saving needs a secure page (https or localhost)', 'warn'); return false; }
    const state = await store.access();
    if (state === 'granted') return true;
    if (!navigator.userActivation?.isActive) {
      toast(state === 'none' ? 'Click Save on screen to choose a projects folder' : `Click Save on screen to allow access to “${store.folderName}”`, 'warn');
      return false;
    }
    try { return await store.allow(); } catch { return false; }   // picker cancelled
  }

  async function write(n) {
    if (busy) return;
    busy = true;
    try {
      if (!(await ensureAccess())) return;
      const { json, audioFiles } = snapshot();
      const missing = json.tracks.some(t => (t.clips ?? []).some(c => !audioFiles.has(c.file)));
      if (missing) { toast('Still recording audio: try again in a moment', 'warn'); return; }
      const key = keyOf(json);
      await store.save(n, { ...json, savedAt: Date.now(), summary: summary(json) }, audioFiles);
      name = n;
      savedKey = key;
      toast(`Saved · ${n}`);
    } catch (err) {
      console.error(err);
      toast(`Couldn't save: ${err.message}`, 'warn');
    } finally {
      busy = false;
    }
  }

  async function openProject(n) {
    try {
      const { json, audio: loadAudio } = await store.load(n, audio.ctx);
      await restore(json, loadAudio);
      name = n;
      savedKey = keyOf(snapshot().json);
      closeDialog();
      toast(`Opened · ${n}`);
    } catch (err) {
      console.error(err);
      toast(`Couldn't open “${n}”: ${err.message}`, 'warn');
    }
  }

  // ---- screens -------------------------------------------------------------------

  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const dialog = $('dialog');
  let onKey = null;

  function showDialog(html, keys) {
    dialog.innerHTML = `<div class="dlg">${html}</div>`;
    dialog.hidden = false;
    onKey = keys;
  }
  function closeDialog() { dialog.hidden = true; dialog.innerHTML = ''; onKey = null; }
  dialog.addEventListener('pointerdown', e => { if (e.target === dialog) closeDialog(); });   // click outside: close

  let toastTimer = 0;
  function toast(text, kind = 'ok') {
    const t = $('toast');
    t.textContent = text;
    t.className = `toast show ${kind}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.className = `toast ${kind}`), kind === 'ok' ? 1300 : 3200);
  }

  // Name box: the first save, and Save As.
  function nameBox(title, initial) {
    const folder = store.folderName;
    showDialog(`
      <h3>${title}</h3>
      <input class="dlg-name" id="dlg-name" maxlength="80" spellcheck="false" value="${esc(initial)}">
      <p class="dlg-note" id="dlg-note">${folder ? `In your projects folder, “${esc(folder)}”.` : 'You’ll choose a folder for your projects (just this once).'}</p>
      <div class="dlg-actions"><button class="dlg-btn" data-act="cancel">Cancel</button><button class="dlg-btn primary" data-act="save">Save</button></div>`,
      e => { if (e.key === 'Enter') submit(); });
    const input = $('dlg-name');
    input.focus();
    input.select();
    let confirmReplace = null;
    async function submit() {
      const n = input.value.trim().replace(/[\\/:*?"<>|]/g, '-');
      if (!n) return input.focus();
      // Saving under another project's name replaces it: ask once.
      if (n !== name && confirmReplace !== n && (await store.access()) === 'granted' && (await store.exists(n))) {
        confirmReplace = n;
        $('dlg-note').innerHTML = `<b class="warn">“${esc(n)}” already exists.</b> Save again to replace it.`;
        dialog.querySelector('[data-act=save]').textContent = 'Replace';
        return;
      }
      closeDialog();
      write(n);
    }
    input.addEventListener('input', () => { confirmReplace = null; dialog.querySelector('[data-act=save]').textContent = 'Save'; });
    dialog.querySelector('[data-act=save]').onclick = submit;
    dialog.querySelector('[data-act=cancel]').onclick = closeDialog;
  }

  const ago = t => {
    const s = (Date.now() - t) / 1000;
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.floor(s / 60)} min ago`;
    if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
    if (s < 86400 * 7) return `${Math.floor(s / 86400)} d ago`;
    return new Date(t).toLocaleDateString();
  };

  // Recent projects.
  async function openList() {
    if (!supported()) return toast('Opening needs Chrome (File System Access)', 'warn');
    showDialog(`<h3>Open</h3><div class="dlg-list" id="dlg-list"><p class="dlg-note">Loading…</p></div>
      <div class="dlg-actions"><span class="dlg-hint">↑ ↓ to choose · Enter to open</span><button class="dlg-btn" data-act="cancel">Close</button></div>`);
    dialog.querySelector('[data-act=cancel]').onclick = closeDialog;
    const listEl = $('dlg-list');
    const state = await store.access();
    if (state !== 'granted') {
      listEl.innerHTML = state === 'none'
        ? `<p class="dlg-note">No projects folder yet. Save a project to choose one, or pick an existing folder.</p>
           <button class="dlg-btn primary" data-act="allow">Choose projects folder…</button>`
        : `<p class="dlg-note">Allow access to your projects folder, “${esc(store.folderName)}”.</p>
           <button class="dlg-btn primary" data-act="allow">Allow</button>`;
      listEl.querySelector('[data-act=allow]').onclick = async () => { try { if (await store.allow()) openList(); } catch {} };
      return;
    }
    let items;
    try { items = await store.list(); } catch (err) { listEl.innerHTML = `<p class="dlg-note warn">${esc(err.message)}</p>`; return; }
    if (!items.length) { listEl.innerHTML = `<p class="dlg-note">No projects in “${esc(store.folderName)}” yet.</p>`; return; }
    const dirty = isDirty() && !engine.isEmpty();
    listEl.innerHTML = (dirty ? `<p class="dlg-note warn">${name ? `“${esc(name)}” has` : 'This project has'} unsaved changes. Opening another discards them.</p>` : '')
      + items.map((p, i) => `
        <button class="dlg-item${p.name === name ? ' current' : ''}" data-i="${i}">
          <span class="di-name">${esc(p.name)}</span>
          <span class="di-when">${p.name === name ? 'open now' : ago(p.savedAt)}</span>
          <span class="di-tracks">${(p.summary?.tracks ?? []).map(t => `<i style="--c:${t.color}" class="${t.bars ? 'on' : ''}" title="${t.bars ? `${t.bars} bar${t.bars > 1 ? 's' : ''}` : 'empty'}"></i>`).join('')}</span>
          <span class="di-tempo">${p.summary?.tempo ?? '–'} BPM</span>
        </button>`).join('');
    const rows = [...listEl.querySelectorAll('.dlg-item')];
    let sel = 0;
    const mark = () => rows.forEach((r, i) => r.classList.toggle('sel', i === sel));
    mark();
    rows.forEach((r, i) => {
      r.onclick = () => openProject(items[i].name);
      r.onmouseenter = () => { sel = i; mark(); };
    });
    onKey = e => {
      if (e.key === 'ArrowDown') { sel = Math.min(rows.length - 1, sel + 1); mark(); rows[sel].scrollIntoView({ block: 'nearest' }); }
      if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); mark(); rows[sel].scrollIntoView({ block: 'nearest' }); }
      if (e.key === 'Enter') openProject(items[sel].name);
    };
  }

  function confirmNew() {
    showDialog(`<h3>New project</h3><p class="dlg-note warn">${name ? `“${esc(name)}” has` : 'This project has'} unsaved changes. Start a new one anyway?</p>
      <div class="dlg-actions"><button class="dlg-btn" data-act="cancel">Cancel</button><button class="dlg-btn primary" data-act="new">Discard and start new</button></div>`,
      e => { if (e.key === 'Enter') go(); });
    const go = () => { closeDialog(); startNew(); };
    dialog.querySelector('[data-act=new]').onclick = go;
    dialog.querySelector('[data-act=cancel]').onclick = closeDialog;
  }
  function startNew() {
    reset();
    name = null;
    savedKey = keyOf(snapshot().json);
    toast('New project');
  }

  savedKey = keyOf(snapshot().json);   // a fresh page counts as unchanged

  return {
    save() { if (name) write(name); else nameBox('Save project', 'Untitled'); },
    saveAs() { nameBox('Save as', name ? `${name} copy` : 'Untitled'); },
    open() { if (dialog.hidden) openList(); else closeDialog(); },
    newProject() { if (isDirty() && !engine.isEmpty()) confirmNew(); else startNew(); },
    name: () => name,
    dirty: isDirty,
    dialogOpen: () => !dialog.hidden,
    // Keys while a screen is up: Escape closes it, the screen handles the rest.
    key(e) { if (e.key === 'Escape') closeDialog(); else onKey?.(e); },
  };
}
