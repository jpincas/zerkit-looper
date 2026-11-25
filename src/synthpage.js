// The Synth page (Synth button): the selected track's synth, laid out like a synth panel, left to
// right: oscillators, filter, envelopes, LFO, one per Circuit pad column. Each column is its main
// knob, three controls and an on/off switch; the voice settings (Poly / Mono / Legato, glide,
// velocity, volume) sit in the header. Holding Shift swaps it all for the 32 presets, a row each
// of leads, bass, pads and plucks lying on the pads. On the Circuit, as on the FX page: the column's knob turns its main control; hold
// pad 1, 2 or 3 of the column and turn it for that control instead; the bottom pad switches it.
import { SYNTH_COLS, SECTIONS, PRESETS, PRESET_ROWS, MODES, VOICE_KNOBS, fromPreset } from './synth.js';

// The oscillators' waveforms, drawn next to their names.
const WAVE = {
  saw: 'M1 9L8 1V9L15 1V9', square: 'M1 9V1H5V9H9V1H13V9H15', sine: 'M1 5C3 -1 5 -1 6 5S9 11 11 5S14 -1 15 3',
  noise: 'M1 5L2 2L3 7L4 3L5 8L6 1L7 6L8 4L9 9L10 2L11 6L12 3L13 8L14 4L15 6',
};

export function setupSynthPage({ root, audio, engine, shiftHeld, consumeShift, isSynth }) {
  const synthOf = () => audio.synth[engine.selected];
  const settings = () => synthOf().settings;
  const held = Array(8).fill(null);          // per column: the control row held on the Circuit (0-2)

  function edited() { settings().edited = true; synthOf().apply(); }
  function preset(i) { synthOf().set(fromPreset(i)); }
  function toggle(col) { const c = settings().cols[SYNTH_COLS[col].id]; c.on = !c.on; edited(); }

  // The value a control has (row null = the main knob), and setting it. Turning one switches its column on.
  const get = (col, row) => { const c = settings().cols[SYNTH_COLS[col].id]; return row == null ? c.main : c.p[row]; };
  function set(col, row, v) {
    const spec = row == null ? null : SYNTH_COLS[col].params[row], c = settings().cols[SYNTH_COLS[col].id];
    v = Math.max(0, Math.min(1, v));
    if (spec?.steps) v = Math.round(v * (spec.steps - 1)) / (spec.steps - 1);
    if (get(col, row) === v) return;
    if (row == null) c.main = v; else c.p[row] = v;
    c.on = true;
    edited();
  }
  const acc = {};
  function nudge(col, delta, row = held[col]) {
    const spec = row == null ? null : SYNTH_COLS[col].params[row];
    if (spec?.steps) {                                     // stepped: a step per few clicks
      const k = `${col}:${row}`;
      acc[k] = (acc[k] ?? 0) + delta;
      if (Math.abs(acc[k]) < 3) return;
      const dir = Math.sign(acc[k]);
      acc[k] = 0;
      return set(col, row, get(col, row) + dir / (spec.steps - 1));
    }
    set(col, row, get(col, row) + delta * 0.01);
  }
  function setVoice(id, v) { settings()[id] = Math.max(0, Math.min(1, v)); edited(); }

  // ---- drawing ---------------------------------------------------------------------------
  // A knob: drag up/down or scroll; double-click for the preset's value.
  function wireKnob(el, get, set, nudgeBy) {
    const dial = el.querySelector('.dial');
    dial.addEventListener('pointerdown', e => {
      e.preventDefault();
      const y0 = e.clientY, v0 = get();
      const move = ev => set(v0 + (y0 - ev.clientY) / 150);
      const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    });
    dial.addEventListener('wheel', e => { e.preventDefault(); nudgeBy(e.deltaY < 0 ? 3 : -3); }, { passive: false });
  }
  const knob = (col, row, big) => {
    const c = SYNTH_COLS[col], label = row == null ? c.main.name : c.params[row].name;
    return `<div class="knob pk${big ? ' pk-mix' : ''}" data-col="${col}" data-row="${row ?? ''}"><div class="dial"><i></i></div>`
      + `<span class="klabel">${label}</span><span class="kval"></span></div>`;
  };
  // Section headings over their columns.
  const sections = () => {
    const out = [];
    SYNTH_COLS.forEach((c, i) => {
      if (i && SYNTH_COLS[i - 1].section === c.section) out.at(-1).span++;
      else out.push({ ...SECTIONS[c.section], span: 1 });
    });
    return out.map(s => `<div class="syn-sec" style="--c:${s.color};grid-column:span ${s.span}">${s.name}</div>`).join('');
  };
  function draw() {
    root.innerHTML = `
      <div class="fxp synp">
        <div class="fx-head syn-head">
          <b class="fx-track"></b><span class="fx-preset"></span><span class="fx-hint">⇧ hold Shift for presets</span>
          <div class="syn-voice">
            <div class="syn-modes">${MODES.map(m => `<button class="syn-mode" data-mode="${m}">${m[0].toUpperCase() + m.slice(1)}</button>`).join('')}</div>
            ${VOICE_KNOBS.map(k => `<div class="knob vk" data-id="${k.id}"><div class="dial"><i></i></div><span class="vk-text"><span class="klabel">${k.name}</span><span class="kval"></span></span></div>`).join('')}
          </div>
        </div>
        <div class="syn-secs">${sections()}</div>
        <div class="fx-grid syn-grid">${PRESET_ROWS.map((row, r) => row.presets.map((p, c) => `
          <button class="fx-pre" data-i="${r * 8 + c}" style="--c:${row.color}"><span class="card-num">${r * 8 + c + 1}</span>`
            + `${c === 0 ? `<span class="fx-kind">${row.kind}</span>` : ''}<span class="fx-pre-name">${p.name}</span></button>`).join('')).join('')}
        </div>
        <div class="fx-pedals">${SYNTH_COLS.map((c, col) => `
          <div class="pedal syn-col" data-col="${col}" style="--c:${c.color}">
            <div class="pedal-name">${WAVE[c.id] ? `<svg class="syn-wave" viewBox="0 0 16 10"><path d="${WAVE[c.id]}"/></svg>` : ''}${c.name}</div>
            ${knob(col, null, true)}
            ${[0, 1, 2].map(row => knob(col, row)).join('')}
            <i class="pedal-led"></i>
            <button class="pedal-switch" title="On / off (the column's bottom pad)"></button>
          </div>`).join('')}
        </div>
      </div>`;
    root.querySelectorAll('.fx-pre').forEach(b => b.addEventListener('click', () => { preset(Number(b.dataset.i)); consumeShift?.(); }));
    root.querySelectorAll('.pedal-switch').forEach(b => b.addEventListener('click', () => toggle(Number(b.closest('.pedal').dataset.col))));
    root.querySelectorAll('.syn-mode').forEach(b => b.addEventListener('click', () => { settings().mode = b.dataset.mode; edited(); }));
    root.querySelectorAll('.pk').forEach(el => {
      const col = Number(el.dataset.col), row = el.dataset.row === '' ? null : Number(el.dataset.row);
      wireKnob(el, () => get(col, row), v => set(col, row, v), d => nudge(col, d, row));
    });
    root.querySelectorAll('.vk').forEach(el => {
      const id = el.dataset.id;
      wireKnob(el, () => settings()[id], v => setVoice(id, v), d => setVoice(id, settings()[id] + d * 0.01));
      el.querySelector('.dial').addEventListener('dblclick', () => setVoice(id, VOICE_KNOBS.find(k => k.id === id).dflt));
    });
  }

  function update() {
    if (!root.querySelector('.synp')) draw();
    const s = settings(), t = engine.selected;
    const text = (el, x) => { if (el.textContent !== x) el.textContent = x; };
    const page = root.querySelector('.synp');
    page.classList.toggle('presets-shown', !!shiftHeld?.());
    text(root.querySelector('.fx-track'), `Track ${t + 1} · Synth`);
    text(root.querySelector('.fx-preset'), `${s.preset}${s.edited ? ' (edited)' : ''}`);
    root.querySelectorAll('.fx-pre').forEach((b, i) => b.classList.toggle('on', PRESETS[i].name === s.preset && !s.edited));
    root.querySelectorAll('.syn-mode').forEach(b => b.classList.toggle('on', b.dataset.mode === s.mode));
    root.querySelectorAll('.vk').forEach(el => {
      const k = VOICE_KNOBS.find(x => x.id === el.dataset.id);
      el.querySelector('.dial').style.setProperty('--v', s[k.id].toFixed(3));
      text(el.querySelector('.kval'), k.fmt(s[k.id]));
    });
    root.querySelectorAll('.pedal').forEach(el => el.classList.toggle('on', s.cols[SYNTH_COLS[Number(el.dataset.col)].id].on));
    root.querySelectorAll('.pk').forEach(el => {
      const col = Number(el.dataset.col), row = el.dataset.row === '' ? null : Number(el.dataset.row), c = SYNTH_COLS[col];
      const v = get(col, row);
      el.querySelector('.dial').style.setProperty('--v', v.toFixed(3));
      text(el.querySelector('.kval'), (row == null ? c.main : c.params[row]).fmt(v));
      el.classList.toggle('held', row != null && held[col] === row);
    });
  }

  // ---- the Circuit's pads: rows 1-3 pick a control while held, row 4 switches the column ----
  const cards = {
    press(pad) {
      if (!isSynth(engine.selected)) return;
      if (shiftHeld?.()) { if (pad < PRESETS.length) preset(pad); return; }   // Shift: the presets
      const row = pad >> 3, col = pad & 7;
      if (row === 3) toggle(col); else held[col] = row;
    },
    release(pad) {
      const row = pad >> 3, col = pad & 7;
      if (row < 3 && held[col] === row) held[col] = null;
    },
    toggleAt(pad) { cards.press(pad); },
    state() {
      const s = settings(), out = [];
      if (!isSynth(engine.selected)) return out;
      if (shiftHeld?.()) {                                   // Shift: presets, the current one white
        PRESET_ROWS.forEach(row => row.presets.forEach(p => out.push({ on: true, current: p.name === s.preset && !s.edited, code: row.code })));
        return out;
      }
      for (let row = 0; row < 4; row++) {
        SYNTH_COLS.forEach((c, col) => out.push({ on: s.cols[c.id].on, current: row < 3 && held[col] === row, code: c.code }));
      }
      return out;
    },
  };

  return {
    update, nudge, cards,
    values: () => SYNTH_COLS.map((_, col) => get(col, held[col])),
    codes: () => SYNTH_COLS.map(c => c.code),
  };
}
