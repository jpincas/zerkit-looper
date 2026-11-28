// The current project: saving it, opening others, starting a new one, and the screens for it
// (a name box the first time you save, a "Saved" notice after that, and a list of recent projects).
// Storage is in projects.js; this file turns the looper's state into a project and back.
import { Projects, supported } from './projects.js';
import { defaultFx, readFx } from './fx.js';
import { defaultSynth, readSynth } from './synth.js';
import { RETIRED } from './instruments.js';
import { templates } from './templates.js';

const FORMAT = 'zerkit-project', VERSION = 1;

export function setupSession(ctx) {
  const { engine, audio, actions, octaves, presetOn, kitOn, audioOn, midiOn, makeClip, DEFAULTS, DEFAULT_KIT, INSTRUMENTS } = ctx;
  const store = new Projects();
  let name = null;             // the current project's name (null: never saved)
  let savedKey = null;         // what it looked like when last saved or opened, to tell if it's changed
  let busy = false;
  // The project last saved or opened, reopened when the page loads (a new project forgets it).
  const LAST = 'lastProject';
  const remember = n => { try { if (n) localStorage.setItem(LAST, n); else localStorage.removeItem(LAST); } catch {} };
  let reopen = null;           // that project, while it waits for a click to allow the folder again

  // ---- the looper's state <-> a project ----------------------------------------

  function snapshot() {
    const audioFiles = new Map();
    const tracks = engine.tracks.map((tr, t) => {
      const instrument = audio.instruments[t];
      const out = {
        instrument, octave: octaves[t], quant: tr.quant,
        volume: audio.vol[t], pan: audio.pan[t], mute: audio.mute[t], solo: audio.solo[t],
        fx: structuredClone(audio.fx[t].settings),
        synth: structuredClone(audio.synth[t].settings),   // kept even while the track plays something else
        loop: tr.loop ? { origin: tr.loop.origin, length: tr.loop.length } : null,
        notes: tr.notes.filter(n => n.dur != null).map(({ note, vel, start, dur, pass, kind }) => ({ note, vel, start, dur, pass, kind })),
      };
      if (tr.fill) { out.fill = tr.fill.map(({ note, vel, start, dur }) => ({ note, vel, start, dur })); out.groove = tr.groove; }
      if (INSTRUMENTS[instrument].midi) {                         // so another computer can make it
        const { output, channel, input } = INSTRUMENTS[instrument];
        out.midi = { output, channel, input };
      }
      if (INSTRUMENTS[instrument].audio) {
        out.input = INSTRUMENTS[instrument].input ?? null;      // so another computer can make it
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
      kitsOff: Object.keys(kitOn).filter(k => kitOn[k] === false).sort(),   // kits start on, so only the off ones
      audiosOff: Object.keys(audioOn).filter(k => audioOn[k] === false).sort(),
      midisOff: Object.keys(midiOn).filter(k => midiOn[k] === false).sort(),
      tracks,
    };
    return { json, audioFiles };
  }

  // A template: the project without its recordings.
  function templateOf(json) {
    const { nextPass, ...rest } = json;
    return { ...rest, tracks: json.tracks.map(({ loop, notes, clips, fill, groove, ...t }) => t) };
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
    for (const [k, on] of Object.entries(json.presetsOn ?? {})) if (k in presetOn) presetOn[k] = on;
    for (const k of Object.keys(kitOn)) kitOn[k] = !(json.kitsOff ?? []).includes(k);
    for (const k of Object.keys(audioOn)) audioOn[k] = !(json.audiosOff ?? []).includes(k);
    for (const k of Object.keys(midiOn)) midiOn[k] = !(json.midisOff ?? []).includes(k);
    const lost = new Set();
    json.tracks.forEach((t, i) => {
      // An instrument that's gone: the retired synthesised Drums quietly becomes the default kit;
      // a missing kit does too, with a warning.
      if (t.instrument === 'drums') t.instrument = DEFAULT_KIT;
      if (RETIRED[t.instrument]) t.instrument = RETIRED[t.instrument];   // the old synthesised sounds
      // Audio: the project's audio instrument, made here if this computer hasn't got it (the old
      // generic "Audio" becomes one named after its input).
      if (t.instrument === 'audio') t.instrument = ctx.ensureAudio(t.input ?? 'Audio input', t.input);
      else if (t.instrument.startsWith('audio:') && !INSTRUMENTS[t.instrument]) ctx.ensureAudio(t.instrument.slice(6), t.input);
      else if (t.instrument.startsWith('midi:') && !INSTRUMENTS[t.instrument]) ctx.ensureMidi(t.instrument.slice(5), t.midi);
      if (!INSTRUMENTS[t.instrument]) {
        lost.add(t.instrument.replace(/^\w+:/, ''));
        t.instrument = t.instrument.startsWith('kit:') ? DEFAULT_KIT : DEFAULTS[0];
      }
      actions.instrument(i, t.instrument);
      octaves[i] = t.octave ?? octaves[i];
      const tr = engine.tracks[i];
      tr.quant = t.quant ?? 'off';
      tr.notes = (t.notes ?? []).map(n => ({ ...n, track: i }));
      tr.clips = clips[i];
      tr.loop = t.loop ? { ...t.loop, playFrom: 0 } : null;
      tr.fill = t.fill ?? null;
      tr.groove = t.groove ?? null;
      audio.vol[i] = t.volume ?? 0.8;
      audio.mute[i] = !!t.mute;
      audio.solo[i] = !!t.solo;
      audio.setPan(i, t.pan ?? 0);
      audio.fx[i].set(readFx(t.fx));                     // also reads the earlier delay + reverb FX
      audio.synth[i].set(readSynth(t.synth));
    });
    audio.mix();
    if (lost.size) setTimeout(() => toast(`Not found: ${[...lost].join(', ')} (using a built-in instead)`, 'warn'), 1400);
    engine.pass = json.nextPass ?? 1 + Math.max(0, ...json.tracks.flatMap(t => [...(t.notes ?? []), ...(t.clips ?? [])].map(n => n.pass)));
  }

  // The stock setup (what a new project is without a default template).
  function reset() {
    engine.stop();
    engine.clearAll();
    engine.setTempo(120);
    engine.setSwing(50);
    for (const k of Object.keys(presetOn)) presetOn[k] = true;
    for (const k of Object.keys(kitOn)) kitOn[k] = true;
    for (const k of Object.keys(audioOn)) audioOn[k] = true;
    for (const k of Object.keys(midiOn)) midiOn[k] = true;
    DEFAULTS.forEach((inst, i) => {
      actions.instrument(i, inst);
      engine.tracks[i].quant = 'off';
      audio.vol[i] = 0.8; audio.mute[i] = false; audio.solo[i] = false; audio.setPan(i, 0);
      audio.fx[i].set(defaultFx());
      audio.synth[i].set(defaultSynth());
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

  // Save under `n`; true once saved.
  async function write(n) {
    if (busy) return false;
    busy = true;
    try {
      if (!(await ensureAccess())) return false;
      const { json, audioFiles } = snapshot();
      const missing = json.tracks.some(t => (t.clips ?? []).some(c => !audioFiles.has(c.file)));
      if (missing) { toast('Still recording audio: try again in a moment', 'warn'); return false; }
      const key = keyOf(json);
      await store.save(n, { ...json, savedAt: Date.now(), summary: summary(json) }, audioFiles);
      name = n;
      savedKey = key;
      remember(n);
      toast(`Saved · ${n}`);
      return true;
    } catch (err) {
      console.error(err);
      toast(`Couldn't save: ${err.message}`, 'warn');
      return false;
    } finally {
      busy = false;
    }
  }

  // Open project `n`; true once open.
  async function openProject(n) {
    try {
      const { json, audio: loadAudio } = await store.load(n, audio.ctx);
      await ctx.beforeRestore?.();                  // e.g. the kit library, so the project's kits exist
      await restore(json, loadAudio);
      name = n;
      savedKey = keyOf(snapshot().json);
      remember(n);
      closeDialog();
      toast(`Opened · ${n}`);
      return true;
    } catch (err) {
      console.error(err);
      toast(`Couldn't open “${n}”: ${err.message}`, 'warn');
      return false;
    }
  }

  // When the page loads: the last project, as last saved. Chrome lets the page back into the
  // projects folder only after a click or key press on it (unless "Allow on every visit"), so
  // then the first one reopens it; until then (or with no last project) the default template.
  async function startup() {
    let last = null;
    try { last = localStorage.getItem(LAST); } catch {}
    const state = last ? await store.access() : 'none';
    if (state === 'granted') {
      if ((await store.exists(last)) && (await openProject(last))) return;
      remember(null);
    } else if (state === 'prompt') {
      reopen = last;
      const go = async () => {
        window.removeEventListener('pointerdown', go, true);
        window.removeEventListener('keydown', go, true);
        const n = reopen;
        reopen = null;
        try { if ((await store.allow()) && (await store.exists(n))) await openProject(n); } catch {}
      };
      window.addEventListener('pointerdown', go, true);
      window.addEventListener('keydown', go, true);
    }
    const d = templates.defaultName();
    if (d) await fromTemplate(d, true);
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

  // Name box: the first save, Save As, and Save template (`exists`, `save` and `note` for those;
  // `after`: what to do once a project is saved).
  function nameBox(title, initial, kind = {}) {
    const folder = store.folderName;
    const exists = kind.exists ?? (async n => n !== name && (await store.access()) === 'granted' && store.exists(n));
    const save = kind.save ?? (async n => { if ((await write(n)) && kind.after) kind.after(); });
    showDialog(`
      <h3>${title}</h3>
      <input class="dlg-name" id="dlg-name" maxlength="80" spellcheck="false" value="${esc(initial)}">
      <p class="dlg-note" id="dlg-note">${kind.note ?? (folder ? `In your projects folder, “${esc(folder)}”.` : 'You’ll choose a folder for your projects (just this once).')}</p>
      <div class="dlg-actions"><button class="dlg-btn" data-act="cancel">Cancel</button><button class="dlg-btn primary" data-act="save">Save</button></div>`,
      e => { if (e.key === 'Enter') submit(); });
    const input = $('dlg-name');
    input.focus();
    input.select();
    let confirmReplace = null;
    async function submit() {
      const n = input.value.trim().replace(/[\\/:*?"<>|]/g, '-');
      if (!n) return input.focus();
      // Saving under another one's name replaces it: ask once.
      if (confirmReplace !== n && (await exists(n))) {
        confirmReplace = n;
        $('dlg-note').innerHTML = `<b class="warn">“${esc(n)}” already exists.</b> Save again to replace it.`;
        dialog.querySelector('[data-act=save]').textContent = 'Replace';
        return;
      }
      closeDialog();
      save(n);
    }
    input.addEventListener('input', () => { confirmReplace = null; dialog.querySelector('[data-act=save]').textContent = 'Save'; });
    dialog.querySelector('[data-act=save]').onclick = submit;
    dialog.querySelector('[data-act=cancel]').onclick = closeDialog;
  }

  // A first save's suggested name: the date and time, to the second ("2026-11-25 18.42.07"), so
  // Save then Play (or Enter) saves without typing.
  const stamp = (d = new Date()) => {
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}.${p(d.getMinutes())}.${p(d.getSeconds())}`;
  };

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

  // Unsaved changes: Save current (chosen to start with) or Continue without saving, then `next`.
  function saveFirst(next) {
    const choices = [
      { label: 'Save current', go: () => (name ? write(name).then(ok => ok && next()) : nameBox('Save project', stamp(), { after: next })) },
      { label: 'Continue without saving', go: next },
    ];
    showDialog(`<h3>${name ? `“${esc(name)}”` : 'This project'} has unsaved changes</h3>
      <div class="dlg-list">${choices.map((c, i) => `<button class="dlg-item" data-i="${i}"><span class="di-name">${c.label}</span></button>`).join('')}</div>`);
    const els = [...dialog.querySelectorAll('.dlg-item')];
    let sel = 0;
    const mark = () => els.forEach((r, i) => r.classList.toggle('sel', i === sel));
    const pick = i => { closeDialog(); choices[i].go(); };
    mark();
    els.forEach((r, i) => { r.onclick = () => pick(i); r.onmouseenter = () => { sel = i; mark(); }; });
    onKey = e => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { sel = e.key === 'ArrowDown' ? 1 : 0; mark(); }
      if (e.key === 'Enter') pick(sel);
    };
  }

  // A new, unnamed project with a template's setup (null: the stock setup).
  async function fromTemplate(tname, quiet = false) {
    const t = tname ? templates.get(tname) : null;
    try {
      if (t) { await ctx.beforeRestore?.(); await restore(t.json, () => Promise.reject(new Error('no audio in a template'))); } else reset();
    } catch (err) {
      console.error(err);
      toast(`Couldn't use the template “${tname}”: ${err.message}`, 'warn');
      reset();
    }
    engine.pass = 0;
    name = null;
    savedKey = keyOf(snapshot().json);
    closeDialog();
    if (!quiet) { remember(null); toast(t ? `New project · ${t.name}` : 'New project'); }
  }

  // Save template: the setup under a name of your choice (the last one used to start with).
  let lastTemplate = null;
  function saveTemplate() {
    nameBox('Save template', lastTemplate ?? 'My setup', {
      note: 'Everything but the recordings: sounds, mix, FX, synths, tempo.',
      exists: async n => templates.exists(n),
      save(n) {
        if (!templates.save(n, templateOf(snapshot().json))) return toast('Couldn’t save the template: browser storage is full or blocked', 'warn');
        lastTemplate = n;
        toast(`Template saved · ${n}`);
      },
    });
  }

  // Open template: a new project from a template, or the stock setup. Starts on the default.
  function openTemplateList() {
    const list = templates.list(), dflt = templates.defaultName();
    const rows = [{ name: null, label: 'Stock setup', when: 'built in' }, ...list.map(t => ({ name: t.name, label: t.name, when: ago(t.savedAt), json: t.json }))];
    showDialog(`<h3>New project</h3>
      <div class="dlg-list" id="dlg-list">${rows.map((r, i) => {
        const json = r.json, tracks = json ? json.tracks.map(t => INSTRUMENTS[t.instrument]?.color ?? '#888') : DEFAULTS.map(k => INSTRUMENTS[k]?.color ?? '#888');
        return `<button class="dlg-item${r.name === dflt ? ' current' : ''}" data-i="${i}">
          <span class="di-name">${esc(r.label)}</span>
          <span class="di-when">${r.name === dflt ? '★ default' : r.when}</span>
          <span class="di-tracks">${tracks.map(c => `<i class="on" style="--c:${c}"></i>`).join('')}</span>
          <span class="di-tempo">${json?.tempo ?? 120} BPM</span>
        </button>`;
      }).join('')}</div>
      <div class="dlg-actions"><span class="dlg-hint">${list.length ? '↑ ↓ to choose · Enter to start' : 'Shift + Save keeps the current setup as a template'}</span><button class="dlg-btn" data-act="cancel">Close</button></div>`);
    dialog.querySelector('[data-act=cancel]').onclick = closeDialog;
    const els = [...dialog.querySelectorAll('.dlg-item')];
    let sel = Math.max(0, rows.findIndex(r => r.name === dflt));
    const mark = () => els.forEach((r, i) => r.classList.toggle('sel', i === sel));
    mark();
    els.forEach((r, i) => {
      r.onclick = () => fromTemplate(rows[i].name);
      r.onmouseenter = () => { sel = i; mark(); };
    });
    onKey = e => {
      if (e.key === 'ArrowDown') { sel = Math.min(els.length - 1, sel + 1); mark(); els[sel].scrollIntoView({ block: 'nearest' }); }
      if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); mark(); els[sel].scrollIntoView({ block: 'nearest' }); }
      if (e.key === 'Enter') fromTemplate(rows[sel].name);
    };
  }

  savedKey = keyOf(snapshot().json);   // a fresh page counts as unchanged

  return {
    store,
    toast,
    ensureAccess,
    save() { if (name) write(name); else nameBox('Save project', stamp()); },
    saveAs() { nameBox('Save as', name ? `${name} copy` : stamp()); },
    open() { if (dialog.hidden) openList(); else closeDialog(); },
    saveTemplate,
    // New project: save first if there are unsaved changes, then pick what to start from.
    openTemplate() { if (!dialog.hidden) closeDialog(); else if (isDirty()) saveFirst(openTemplateList); else openTemplateList(); },
    // When the page opens: the default template's setup, if there is one.
    startup,
    reopening: () => reopen,     // the last project's name while it waits for a click
    name: () => name,
    dirty: isDirty,
    dialogOpen: () => !dialog.hidden,
    // Keys while a screen is up: Escape closes it, the screen handles the rest.
    key(e) { if (e.key === 'Escape') closeDialog(); else onKey?.(e); },
    // From the Circuit: move up or down the list (or the screen's choices), and choose.
    move(dir) { onKey?.({ key: dir < 0 ? 'ArrowUp' : 'ArrowDown' }); },
    choose() { onKey?.({ key: 'Enter' }); },
    close: closeDialog,
  };
}
