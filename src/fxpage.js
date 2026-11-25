// The FX page (FX button): the selected track's 8 pedals, one per Circuit pad column. On screen each
// pedal is its Mix knob, its three controls and a footswitch. Holding Shift swaps them for the 32
// presets, a 4 x 8 grid lying on the pads (pad n = preset n).
// On the Circuit: the column's knob turns Mix; hold pad 1, 2 or 3 of the column and turn it for
// that control instead; the column's bottom pad is the footswitch.
import { PEDALS, PRESETS, PRESET_ROWS, fromPreset } from './fx.js';

export function setupFxPage({ root, audio, engine, trackName, shiftHeld, consumeShift }) {
  const fxOf = () => audio.fx[engine.selected];
  const settings = () => fxOf().settings;
  const held = Array(8).fill(null);          // per column: the control row held on the Circuit (0-2)

  function edited() { settings().edited = true; fxOf().apply(); }
  function preset(i) { const on = settings().on; fxOf().set({ ...fromPreset(i), on }); }
  function footswitch(col) { const p = settings().pedals[PEDALS[col].id]; p.on = !p.on; edited(); }
  function bypass(t = engine.selected) { const f = audio.fx[t]; f.settings.on = !f.settings.on; f.apply(); }

  // The value a control has (row null = Mix), and setting it. Turning a control switches its pedal on.
  const get = (col, row) => { const p = settings().pedals[PEDALS[col].id]; return row == null ? p.mix : p.p[row]; };
  function set(col, row, v) {
    const ped = PEDALS[col], p = settings().pedals[ped.id], spec = row == null ? null : ped.params[row];
    v = Math.max(0, Math.min(1, v));
    if (spec?.steps) v = Math.round(v * (spec.steps - 1)) / (spec.steps - 1);
    if (get(col, row) === v) return;
    if (row == null) p.mix = v; else p.p[row] = v;
    p.on = true;
    edited();
  }
  // A relative turn: the Circuit's knobs, or scrolling. Stepped controls move a step per few clicks.
  const acc = {};
  function nudge(col, delta, row = held[col]) {
    const spec = row == null ? null : PEDALS[col].params[row];
    if (spec?.steps) {
      const k = `${col}:${row}`;
      acc[k] = (acc[k] ?? 0) + delta;
      if (Math.abs(acc[k]) < 3) return;
      const dir = Math.sign(acc[k]);
      acc[k] = 0;
      return set(col, row, get(col, row) + dir / (spec.steps - 1));
    }
    set(col, row, get(col, row) + delta * 0.01);
  }

  // ---- drawing ---------------------------------------------------------------------------
  const knob = (col, row, big) => {
    const label = row == null ? 'Mix' : PEDALS[col].params[row].name;
    return `<div class="knob pk${big ? ' pk-mix' : ''}" data-col="${col}" data-row="${row ?? ''}"><div class="dial"><i></i></div>`
      + `<span class="klabel">${label}</span><span class="kval"></span></div>`;
  };
  function draw() {
    root.innerHTML = `
      <div class="fxp">
        <div class="fx-head">
          <b class="fx-track"></b><span class="fx-preset"></span><span class="fx-hint">⇧ hold Shift for presets</span>
          <span class="fx-bypass" title="Bypass this track's FX (Shift + FX)"></span>
        </div>
        <div class="fx-grid">${PRESET_ROWS.map((row, r) => row.presets.map((p, c) => `
          <button class="fx-pre" data-i="${r * 8 + c}" style="--c:${row.color}"><span class="card-num">${r * 8 + c + 1}</span>`
            + `${c === 0 ? `<span class="fx-kind">${row.kind}</span>` : ''}<span class="fx-pre-name">${p.name}</span></button>`).join('')).join('')}
        </div>
        <div class="fx-pedals">${PEDALS.map((p, col) => `
          <div class="pedal" data-col="${col}" style="--c:${p.color}">
            <div class="pedal-name">${p.name}</div>
            ${knob(col, null, true)}
            ${[0, 1, 2].map(row => knob(col, row)).join('')}
            <i class="pedal-led"></i>
            <button class="pedal-switch" title="Footswitch (the column's bottom pad)"></button>
          </div>`).join('')}
        </div>
      </div>`;
    root.querySelectorAll('.fx-pre').forEach(b => b.addEventListener('click', () => { preset(Number(b.dataset.i)); consumeShift?.(); }));
    root.querySelector('.fx-bypass').addEventListener('click', () => bypass());
    root.querySelectorAll('.pedal-switch').forEach(b => b.addEventListener('click', () => footswitch(Number(b.closest('.pedal').dataset.col))));
    root.querySelectorAll('.pk').forEach(el => {
      const col = Number(el.dataset.col), row = el.dataset.row === '' ? null : Number(el.dataset.row);
      const dial = el.querySelector('.dial');
      dial.addEventListener('pointerdown', e => {
        e.preventDefault();
        const y0 = e.clientY, v0 = get(col, row);
        const move = ev => set(col, row, v0 + (y0 - ev.clientY) / 150);
        const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
      });
      dial.addEventListener('wheel', e => { e.preventDefault(); nudge(col, e.deltaY < 0 ? 3 : -3, row); }, { passive: false });
    });
  }

  function update() {
    if (!root.querySelector('.fxp')) draw();
    const s = settings();
    const text = (el, t) => { if (el.textContent !== t) el.textContent = t; };
    text(root.querySelector('.fx-track'), `Track ${engine.selected + 1} · ${trackName(engine.selected)}`);
    text(root.querySelector('.fx-preset'), `${s.preset}${s.edited ? ' (edited)' : ''}`);
    root.querySelector('.fxp').classList.toggle('presets-shown', !!shiftHeld?.());
    root.querySelectorAll('.fx-pre').forEach((b, i) => b.classList.toggle('on', PRESETS[i].name === s.preset && !s.edited));
    const by = root.querySelector('.fx-bypass');
    text(by, s.on ? 'FX on' : 'Bypassed');
    by.classList.toggle('off', !s.on);
    root.querySelectorAll('.pedal').forEach(el => el.classList.toggle('on', s.on && s.pedals[PEDALS[Number(el.dataset.col)].id].on));
    root.querySelectorAll('.pk').forEach(el => {
      const col = Number(el.dataset.col), row = el.dataset.row === '' ? null : Number(el.dataset.row);
      const v = get(col, row);
      el.querySelector('.dial').style.setProperty('--v', v.toFixed(3));
      text(el.querySelector('.kval'), row == null ? `${Math.round(v * 100)}%` : PEDALS[col].params[row].fmt(v));
      el.classList.toggle('held', row != null && held[col] === row);   // the control a held pad hands the Circuit's knob
    });
  }

  // ---- the Circuit's pads: rows 1-3 pick a control while held, row 4 is the footswitch ----
  const cards = {
    press(pad) {
      if (shiftHeld?.()) return preset(pad);                // Shift: the preset grid
      const row = pad >> 3, col = pad & 7;
      if (row === 3) footswitch(col); else held[col] = row;
    },
    release(pad) {
      const row = pad >> 3, col = pad & 7;
      if (row < 3 && held[col] === row) held[col] = null;
    },
    toggleAt(pad) { cards.press(pad); },
    state() {
      const s = settings(), out = [];
      if (shiftHeld?.()) {                                   // Shift: presets, the active one white
        PRESET_ROWS.forEach(row => row.presets.forEach(p => out.push({ on: true, current: p.name === s.preset && !s.edited, code: row.code })));
        return out;
      }
      for (let row = 0; row < 4; row++) {
        PEDALS.forEach((p, col) => {
          const on = s.on && s.pedals[p.id].on;
          out.push({ on, current: row < 3 && held[col] === row, code: p.code });
        });
      }
      return out;
    },
  };

  return {
    update, nudge, bypass, cards,
    // Per column, the value its knob turns right now (for the Circuit's knob lights).
    values: () => PEDALS.map((_, col) => get(col, held[col])),
    codes: () => PEDALS.map(p => p.code),
  };
}
