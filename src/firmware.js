// Settings › Firmware: puts the looper's firmware (or Novation's own) on the Circuit Tracks, from
// the screen (the Circuit can't drive this: it's in recovery mode). Both start from Novation's
// official 1.2.1 .syx, which we can't redistribute: the user picks their own download (on a dev
// machine it's also served from circuit/incoming/). Zerkit's LOOP06 is built from it here
// (fwimage.js) and only sent if its SHA-256 matches the Python build's.
// Protocol: docs/circuit-protocol.md.

import { sha256, split, buildLoop, STOCK_SHA } from './fwimage.js';

const FILES = [
  { id: 'loop', label: 'Zerkit', sub: 'LOOP06' },
  { id: 'stock', label: 'Novation', sub: '1.2.1' },
];
const LOCAL_STOCK = 'circuit/incoming/circuittracks-firmware-4486.syx';
const NOVATION_URL = 'https://components.novationmusic.com/api/v2/firmwares/168/file';
const NOV = [0xF0, 0x00, 0x20, 0x29, 0x00];
const STATUS = { 0: 'update started', 1: 'press Play on the Circuit', 16: 'cancelled on the Circuit',
  17: 'confirmation timed out', 124: 'failed (not viable)', 125: 'received, checking', 126: 'failed (CRC)', 127: 'done' };

export function setupFirmware({ onBusy }) {
  let midi = null, inp = null, out = null;
  let device = '', deviceCls = '', mode = null;            // mode: 'bootloader' | 'firmware' | null
  let chosen = null, packets = null, xfer = null, progress = 0, phase = '', phaseCls = '';
  const log = [];
  let version = 0, shown = -1, root = null;
  let stock = null, pending = null;                       // the official .syx, once we have it
  const changed = () => { version++; onBusy?.(mode === 'bootloader' || !!xfer); };

  const note = (msg, cls = '') => { log.unshift({ msg, cls }); log.length = Math.min(log.length, 6); changed(); };
  const setPhase = (msg, cls = '') => { phase = msg; phaseCls = cls; changed(); };

  async function ports() {
    if (!midi) midi = await navigator.requestMIDIAccess({ sysex: true });
    const pick = list => [...list.values()].find(p => /circuit tracks/i.test(p.name) && !/midi ?[23]|din/i.test(p.name));
    inp = pick(midi.inputs); out = pick(midi.outputs);
    return inp && out;
  }

  async function check() {
    if (xfer) return;
    chosen = null; mode = null;
    try {
      if (!(await ports())) { device = 'No Circuit Tracks found'; deviceCls = 'bad'; return changed(); }
    } catch (e) { device = `MIDI refused: ${e.message}`; deviceCls = 'bad'; return changed(); }
    device = 'Asking…'; deviceCls = ''; changed();
    const reply = await new Promise(resolve => {
      const t = setTimeout(() => { inp.removeEventListener('midimessage', h); resolve(null); }, 2000);
      function h(ev) {
        const d = ev.data;
        if (d.length === 17 && d[0] === 0xF0 && d[1] === 0x7E && d[3] === 0x06 && d[4] === 0x02) { clearTimeout(t); inp.removeEventListener('midimessage', h); resolve(d); }
      }
      inp.addEventListener('midimessage', h);
      out.send([0xF0, 0x7E, 0x7F, 0x06, 0x01, 0xF7]);          // identity request
    });
    if (!reply) { device = 'No reply'; deviceCls = 'bad'; return changed(); }
    // F0 7E dev 06 02 | 00 20 29 | mode (0x11 bootloader, 0x01 firmware) | …  build in bytes 14-15
    mode = reply[8] === 0x11 || /boot/i.test(inp.name) ? 'bootloader' : 'firmware';
    const build = reply[14] * 128 + reply[15];
    device = mode === 'bootloader' ? `Recovery mode ✓ (bootloader ${build})` : `Running normally (build ${build}): restart it in recovery mode`;
    deviceCls = mode === 'bootloader' ? 'ok' : 'warn';
    changed();
  }

  // The official file: served locally on a dev machine, otherwise picked by the user.
  async function localStock() {
    try {
      const res = await fetch(LOCAL_STOCK, { cache: 'no-store' });
      if (!res.ok) return null;
      const buf = await res.arrayBuffer();
      return (await sha256(buf)) === STOCK_SHA ? buf : null;
    } catch { return null; }
  }
  function pickStock(f) {
    pending = f;
    const input = Object.assign(document.createElement('input'), { type: 'file', accept: '.syx' });
    input.onchange = async () => {
      const file = input.files[0];
      if (!file) return;
      const buf = await file.arrayBuffer();
      if ((await sha256(buf)) !== STOCK_SHA) return note(`${file.name}: not Novation’s 1.2.1 (build 4486) file`, 'bad');
      stock = buf;
      if (pending) choose(pending);
    };
    input.click();
  }

  localStock().then(buf => { if (buf && !stock) { stock = buf; changed(); } });

  async function choose(f) {
    if (mode !== 'bootloader' || xfer) return;
    if (!stock) return pickStock(f);                      // synchronously: the picker needs the click
    chosen = null; changed();
    pending = null;
    try {
      packets = split(f.id === 'loop' ? await buildLoop(stock) : new Uint8Array(stock));
      chosen = f;
      changed();
    } catch (e) { note(`${f.label} ${f.sub}: ${e.message}`, 'bad'); }
  }

  // Send INIT + HEADER, then one message each time the Circuit asks for the next.
  function send() {
    if (!chosen || xfer) return;
    xfer = { next: 0, last: -1, timer: null };
    inp.addEventListener('midimessage', onMsg);
    note(`Sending ${chosen.label} ${chosen.sub}`);
    setPhase('Starting…');
    sendNext(); sendNext();
    arm(25000);
  }
  function arm(ms) { clearTimeout(xfer.timer); xfer.timer = setTimeout(() => finish('Timed out waiting for the Circuit. Nothing more was sent.', 'bad'), ms); }
  function sendNext() {
    out.send(packets[xfer.next++]);
    progress = xfer.next / packets.length;
    if (xfer.next === packets.length) { setPhase('Sent. Waiting for the Circuit…'); arm(30000); }
    changed();
  }
  function onMsg(ev) {
    const d = ev.data;
    if (!xfer || d[0] !== 0xF0 || NOV.some((b, k) => d[k] !== b)) return;
    if (d[5] === 0x72) {                                     // the Circuit asks for the next block
      let n = null;
      if (d.length === 10) n = d[6] + (d[7] << 7) + (d[8] << 14);
      else if (d.length === 15) { const s = d.slice(6, 14); n = s[7] + (s[6] << 4) + (s[5] << 8); }
      if (n === null) return;
      if ((n > xfer.last || n === 0) && xfer.next < packets.length) {
        xfer.last = n;
        if (phase !== 'Sending…') setPhase('Sending…');
        sendNext();
        if (xfer.next < packets.length) arm(10000);
      }
    } else if (d[5] === 0x73 && d.length === 10) {          // status
      const c = d[6];
      note(STATUS[c] ?? `status ${c}`, c === 127 ? 'ok' : c >= 124 || c === 16 || c === 17 ? 'bad' : '');
      if (c === 1) { setPhase('Press Play on the Circuit', 'warn'); arm(25000); }
      else if (c === 0 || c === 125) arm(30000);
      else if (c === 127) finish('Done: the Circuit restarts and installs it.', 'ok');
      else if (c === 16 || c === 17 || c === 124 || c === 126) finish('The Circuit refused it: its firmware is unchanged.', 'bad');
    }
  }
  function finish(msg, cls) {
    if (!xfer) return;
    clearTimeout(xfer.timer); inp.removeEventListener('midimessage', onMsg); xfer = null;
    mode = null; chosen = null; device = '';
    setPhase(msg, cls);
  }

  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  function draw(el, fresh) {
    if (!fresh && shown === version && root === el) return;
    shown = version; root = el;
    const ready = mode === 'bootloader' && !xfer;
    el.innerHTML = `<div class="set fw">
      <div class="fw-row"><button class="sr-btn fw-check"${xfer ? ' disabled' : ''}>Check Circuit</button>
        <span class="fw-dev ${deviceCls}">${esc(device || 'Recovery mode: switch it off, hold Scales + Preset + Note, switch it on')}</span></div>
      <div class="fw-files">${FILES.map(f => `<button class="card fw-file${chosen === f ? ' on' : ''}" data-id="${f.id}"${ready ? '' : ' disabled'}>`
        + `<span class="card-name">${f.label}</span><span class="card-use">${f.sub}</span></button>`).join('')}
        ${chosen && !xfer ? `<button class="sr-btn fw-send">Send ${chosen.label}</button>` : ''}
        ${xfer ? '<button class="sr-btn fw-abort">Abort</button>' : ''}</div>
      ${stock ? '' : `<a class="fw-get" href="${NOVATION_URL}">Novation 1.2.1 .syx ↓</a>`}
      ${phase || xfer ? `<div class="fw-phase ${phaseCls}">${esc(phase)}</div><div class="fw-bar"><i style="width:${(progress * 100).toFixed(1)}%"></i></div>` : ''}
      <div class="fw-log">${log.map(l => `<div class="${l.cls}">${esc(l.msg)}</div>`).join('')}</div>
    </div>`;
    el.querySelector('.fw-check').onclick = check;
    el.querySelectorAll('.fw-file').forEach(b => (b.onclick = () => choose(FILES.find(f => f.id === b.dataset.id))));
    el.querySelector('.fw-send')?.addEventListener('click', send);
    el.querySelector('.fw-abort')?.addEventListener('click', () => finish('Aborted: the Circuit discards an unfinished update.', 'warn'));
  }

  return {
    name: 'Firmware',
    update: draw,
    count: () => 0,
    enter() {},
    del() {},
    canDelete: () => false,
    press() {},
    state: () => [],
  };
}
