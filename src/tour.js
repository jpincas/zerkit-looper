// The guide: a short click-through of the panel. Each step opens what it's about (a page, the
// playing panel), dims the rest, and says what it does and how on the Circuit. Next / Back
// (→ ←, Enter), Esc or ✕ closes it and puts the screen back as it was. The step reached, whether
// it's finished and "Don't show on startup" are kept in this browser. It shows on startup until
// it's finished or switched off; Settings › Guide starts it again.

// Each step: `view` (what's opened for it: a page, the playing panel, Jam), `target` (a list of
// selectors: each one a lit hole in the dimming, the last the one the card sits by), `text`, and
// `circuit` (how it's done on the Circuit Tracks).
const STEPS = [
  { title: 'Welcome to Zerkit Looper', text: 'Eight tracks of loops, played from your computer keyboard, a MIDI keyboard or a Circuit Tracks. This takes about two minutes.' },
  { target: ['#circuit'], title: 'Laid out like a Circuit Tracks', text: 'Every button here sits where its button is on the Circuit, so you can use either. The Circuit’s labels say something else: each step tells you which one to press.',
    circuit: 'Plug it in over USB: this lights up. It needs the Zerkit firmware (Settings › Firmware).' },
  { target: ['#trackbar'], title: 'Tracks', text: 'Each track has its own sound and its own loop length, pictured small on its button. Click one, or press 1–8, to select it.',
    circuit: 'Synth 1, Synth 2, MIDI 1, MIDI 2, Drum 1–4: tracks 1–8.' },
  { target: ['.pbtn.preset, .pbtn.kits, .pbtn.synth, .pbtn.audio, .pbtn.midi'], title: 'Sounds', text: 'A track plays an instrument, a drum kit, a synth, an audio input or a MIDI instrument. Tap one to give the selected track the next of its kind.',
    circuit: 'The column down the left: Preset, Note, Velocity, Gate, Pattern Settings.' },
  { view: { page: 'presets' }, target: ['.pbtn.preset', '#page-presets'], title: 'Lists', text: 'Shift + a sound opens its list, here the instruments. Only the cards that are on come round when you tap the button. Shift + it again goes back.',
    circuit: 'Shift + Preset (Note, Gate, Pattern Settings for the others). Pads 1–16 switch the cards.' },
  { view: { keys: true }, target: ['.pbtn.note', '.keys-area'], title: 'Play', text: 'A keyboard, or kit pads on a drum track, for the selected track. Your computer keys play it: A to J, with W E T Y U for the black keys.',
    circuit: 'Scales: Note mode. The 32 pads become two octaves, black keys above white; on a drum track rows 3–4 are the kit.' },
  { view: { keys: true }, target: ['.pbtn.octDown, .pbtn.octUp'], title: 'Octave', text: 'Moves the keyboard up or down an octave. With Shift: moves the track’s recorded notes instead.',
    circuit: 'Octave ▼ ▲, and Shift + them.' },
  { target: ['.pbtn.record'], title: 'Record', text: 'Press Record (X), then play: recording starts on your first note. Press it again to close the loop at the end of the bar.',
    circuit: 'Record.' },
  { target: ['.pbtn.play'], title: 'Play and stop', text: 'Space. Stop then Play starts again from the top. Record on a track that has a loop adds to it (overdub).',
    circuit: 'Play.' },
  { target: ['#seq'], title: 'The loop', text: 'The selected track’s notes. Tracks can be different lengths: shorter loops repeat under the longest, drawn faded.',
    circuit: 'Pad rows 3–4: the 16 steps of the bar that’s playing, in the track’s colour.' },
  { target: ['#mute-row, #solo-row'], title: 'Mute and solo', text: 'One of each under every track.',
    circuit: 'Pad row 1 mutes (red), row 2 solos (green).' },
  { target: ['#master-vol', '#master-int', '#knobs'], title: 'Volume', text: 'A knob per track: drag or scroll. With Shift: left-right position. Double-click resets. Left of them the overall volume, right a master filter (Shift: the click’s level).',
    circuit: 'The knob above each track, with Shift for position. Master volume: overall. Master filter: the filter, with Shift the click.' },
  { target: ['.pbtn.undo, .pbtn.clearTrack'], title: 'Undo and clear', text: 'Undo (Z) takes off the last take or overdub, Shift redoes it. Clear track (⌫) empties the selected track; Shift trims empty bars off the end of its loop.',
    circuit: 'Duplicate undoes, Shift + Duplicate redoes. Clear empties the track, Shift + Clear trims it.' },
  { target: ['.pbtn.quant, .pbtn.tempo'], title: 'Timing', text: 'Q snaps what you record on this track to 32nds or 16ths. Click switches the metronome; hold it and scroll for tempo, with Shift for swing.',
    circuit: '1-16/17-32 is Q: red off, amber 32nds, green 16ths. Tempo/Swing: tap for the click; hold it and turn the master filter for tempo, Shift too for swing.' },
  { view: { page: 'fx' }, target: ['.pbtn.fx', '#page-fx'], title: 'FX', text: 'Eight pedals for the selected track: compressor to reverb. Hold Shift here for presets; Shift + FX bypasses them.',
    circuit: 'FX. A column’s knob turns its pedal’s mix; hold pad 1–3 of the column and turn for its controls; the bottom pad is the footswitch.' },
  { view: { page: 'synth' }, target: ['.pbtn.synth', '#page-synth'], title: 'Synth', text: 'Makes the selected track a synth with its own settings, and shows them. Hold Shift here for 32 presets. The track’s own button goes back to the loop.',
    circuit: 'Velocity. The same as FX: knob per column, hold pad 1–3 and turn, bottom pad on or off; Shift + a pad: a preset.' },
  { view: { jam: true }, target: ['.tbtn.jam'], title: 'Jam', text: 'Track 0 selects no track, so your keyboard only plays itself over the loop (0). Pick a track to come back.',
    circuit: 'Patterns (amber while jamming).' },
  { target: ['.pbtn.save, .pbtn.open'], title: 'Projects', text: 'Save (⌘S) and Open (⌘O). Shift + Save keeps your setup as a template; Shift + Open starts a new project. The last one reopens when you come back.',
    circuit: 'Save and Projects, with Shift. Lists come up on screen: the master filter or Octave ▲ ▼ chooses, Play picks.' },
  { view: { page: 'settings' }, target: ['.pbtn.settings', '#trackbar', '#page-settings'], title: 'Settings', text: 'Templates, which MIDI keyboard plays the tracks, the Circuit’s firmware, a MIDI monitor, and this guide. The track buttons pick the page.',
    circuit: 'Mixer. Track buttons: the page. Octave ▲ ▼ or the master filter: choose. Play: pick. Clear: delete.' },
  { title: 'That’s it', text: 'Have fun. Settings › Guide starts this again.' },
];

const KEY = 'tour';

// `view(v)` opens what a step shows (nothing: the Looper page); `snapshot()` / `restore(s)` put
// back what was on screen before the guide.
export function setupTour({ view, snapshot, restore }) {
  const st = { step: 0, done: false, hide: false };
  try { Object.assign(st, JSON.parse(localStorage.getItem(KEY) ?? '{}')); } catch {}
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch {} };
  let open = false, version = 0, before = null, settle = 0;

  const el = document.createElement('div');
  el.className = 'tour';
  el.hidden = true;
  el.innerHTML = `<svg class="tour-dim"><path fill-rule="evenodd"/></svg><div class="tour-rings"></div>
    <div class="tour-card" role="dialog" aria-live="polite">
      <button class="tour-x" title="Close (Esc)">✕</button>
      <div class="tour-num"></div><h3></h3><p class="tour-text"></p>
      <p class="tour-hw"><b>Circuit</b><span></span></p>
      <div class="tour-foot">
        <label class="tour-hide"><input type="checkbox"> Don’t show on startup</label>
        <button class="tour-btn tour-back">Back</button><button class="tour-btn primary tour-next">Next</button>
      </div>
    </div>`;
  document.body.appendChild(el);
  const dim = el.querySelector('.tour-dim path'), rings = el.querySelector('.tour-rings');
  const card = el.querySelector('.tour-card'), hide = el.querySelector('.tour-hide input');
  el.querySelector('.tour-x').onclick = () => close();
  el.querySelector('.tour-back').onclick = () => go(st.step - 1);
  el.querySelector('.tour-next').onclick = () => go(st.step + 1);
  hide.onchange = () => { st.hide = hide.checked; save(); version++; };
  el.addEventListener('pointerdown', e => e.stopPropagation());    // the page underneath stays still

  // The holes: one around everything each of the step's selectors matches.
  function holes(s) {
    const pad = 6;
    return (s.target ?? []).map(sel => {
      const rs = [...document.querySelectorAll(sel)].map(n => n.getBoundingClientRect()).filter(r => r.width);
      return rs.length && { l: Math.min(...rs.map(x => x.left)) - pad, t: Math.min(...rs.map(x => x.top)) - pad,
        r: Math.max(...rs.map(x => x.right)) + pad, b: Math.max(...rs.map(x => x.bottom)) + pad };
    }).filter(Boolean);
  }
  const R = 10;
  const box = ({ l, t, r, b }) => `M${l + R} ${t}H${r - R}A${R} ${R} 0 0 1 ${r} ${t + R}V${b - R}A${R} ${R} 0 0 1 ${r - R} ${b}`
    + `H${l + R}A${R} ${R} 0 0 1 ${l} ${b - R}V${t + R}A${R} ${R} 0 0 1 ${l + R} ${t}Z`;

  function place() {
    const s = STEPS[st.step], hs = holes(s);
    const vw = innerWidth, vh = innerHeight, gap = 14, m = 12;
    dim.setAttribute('d', `M0 0H${vw}V${vh}H0Z` + hs.map(box).join(''));
    rings.innerHTML = hs.map(h => `<i style="left:${h.l}px;top:${h.t}px;width:${h.r - h.l}px;height:${h.b - h.t}px"></i>`).join('');
    card.style.left = card.style.top = '0px';
    const cw = card.offsetWidth, ch = card.offsetHeight;
    let x = (vw - cw) / 2, y = (vh - ch) / 2;                  // no target: the middle
    if (hs.length) {
      // By the last hole: below, above, then beside it (a tall one beside it first); on screen
      // and clear of every hole. Else the spot that covers the least of them.
      const r = hs.at(-1), cx = (r.l + r.r - cw) / 2, cy = (r.t + r.b - ch) / 2;
      const spots = [[cx, r.b + gap], [cx, r.t - gap - ch]], sides = [[r.r + gap, cy], [r.l - gap - cw, cy]];
      const tall = r.b - r.t > r.r - r.l;
      const fit = ([px, py]) => [Math.max(m, Math.min(vw - cw - m, px)), Math.max(m, Math.min(vh - ch - m, py))];
      const over = ([px, py]) => hs.reduce((a, h) => a + Math.max(0, Math.min(px + cw, h.r) - Math.max(px, h.l)) * Math.max(0, Math.min(py + ch, h.b) - Math.max(py, h.t)), 0);
      const tries = [...(tall ? [...sides, ...spots] : [...spots, ...sides]), [x, y]].map(fit);
      // A page much bigger than the card: inside it at the bottom, clear of the other holes.
      const inside = fit([cx, r.b - gap - ch]);
      const big = (r.r - r.l) * (r.b - r.t) > 4 * cw * ch;
      const overOthers = ([px, py]) => hs.slice(0, -1).some(h => px < h.r && px + cw > h.l && py < h.b && py + ch > h.t);
      [x, y] = tries.find(p => over(p) === 0) ?? (big && !overOthers(inside) ? inside : null)
        ?? tries.reduce((a, p) => (over(p) < over(a) ? p : a));
    }
    card.style.left = `${x}px`;
    card.style.top = `${y}px`;
  }

  function show() {
    const s = STEPS[st.step], last = st.step === STEPS.length - 1;
    el.querySelector('.tour-num').textContent = `${st.step + 1} / ${STEPS.length}`;
    el.querySelector('h3').textContent = s.title;
    el.querySelector('.tour-text').textContent = s.text;
    el.querySelector('.tour-hw').hidden = !s.circuit;
    el.querySelector('.tour-hw span').textContent = s.circuit ?? '';
    el.querySelector('.tour-back').disabled = st.step === 0;
    el.querySelector('.tour-next').textContent = last ? 'Done' : 'Next';
    hide.checked = st.hide;
    place();
  }

  // A step opens its view, then (once it's drawn) the card comes up by it.
  function go(i) {
    if (i >= STEPS.length) { st.done = true; st.step = 0; save(); return close(); }
    st.step = Math.max(0, i);
    save();
    view?.(STEPS[st.step].view ?? {});
    const n = ++settle;
    card.style.visibility = 'hidden';
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (n !== settle || !open) return;
      show();
      card.style.visibility = '';
      setTimeout(() => { if (n === settle && open) place(); }, 250);    // after any page's own layout
    }));
  }

  function start(at = st.step) {
    if (!open) before = snapshot?.();
    open = true;
    el.hidden = false;
    document.body.classList.add('touring');
    go(at);
  }
  function close() {
    open = false;
    el.hidden = true;
    document.body.classList.remove('touring');
    if (before) restore?.(before);
    before = null;
    version++;
  }

  addEventListener('resize', () => { if (open) place(); });
  // Keys while it's open: → / Enter next, ← back, Esc close; nothing else reaches the looper.
  addEventListener('keydown', e => {
    if (!open) return;
    const k = { ArrowRight: () => go(st.step + 1), Enter: () => go(st.step + 1), ArrowLeft: () => go(st.step - 1), Escape: close }[e.key];
    e.preventDefault();
    e.stopImmediatePropagation();
    if (!e.repeat) k?.();
  }, true);

  // Settings › Guide: start over, carry on, show on startup.
  let sel = 0, shownKey = '';
  const rows = () => [
    { label: 'Start the guide', go: () => { st.done = false; start(0); } },
    ...(st.step > 0 && !st.done ? [{ label: `Continue from step ${st.step + 1}`, go: () => start() }] : []),
    { label: 'Show on startup', toggle: true, on: () => !st.hide && !st.done, go: () => { const on = !st.hide && !st.done; st.hide = on; if (!on) st.done = false; save(); version++; } },
  ];
  const page = {
    name: 'Guide',
    update(root, fresh) {
      const list = rows();
      sel = Math.min(sel, list.length - 1);
      const key = JSON.stringify([sel, version, st, list.length]);
      if (!fresh && key === shownKey) return;
      shownKey = key;
      root.innerHTML = `<div class="set"><div class="set-list">${list.map((r, i) => `
        <div class="set-row tour-row${i === sel ? ' sel' : ''}" data-i="${i}"><span class="sr-name">${r.label}</span>`
        + (r.toggle ? `<span class="tour-toggle${r.on() ? ' on' : ''}">${r.on() ? 'On' : 'Off'}</span>` : '') + '</div>').join('')}</div></div>`;
      root.querySelectorAll('.set-row').forEach(n => (n.onclick = () => { sel = Number(n.dataset.i); rows()[sel].go(); }));
    },
    count: () => rows().length,
    move(dir) { sel = Math.max(0, Math.min(rows().length - 1, sel + dir)); },
    enter() { rows()[sel]?.go(); },
    del() {},
    canDelete: () => false,
    press(p) { if (p < rows().length) { sel = p; rows()[p].go(); } },
    state: () => rows().map((r, i) => ({ on: true, current: i === sel, code: r.toggle && r.on() ? 0x2B : 0x02 })),
  };

  return {
    page,
    start,
    isOpen: () => open,
    // On startup: unless it's finished or switched off, carrying on where it was left.
    startup() { if (!st.done && !st.hide) start(); },
  };
}
