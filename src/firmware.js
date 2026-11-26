// Settings › Firmware: puts the looper's firmware (or Novation's own) on the Circuit Tracks, from
// the screen (the Circuit can't drive this: it's in recovery mode). Only these exact files can be
// sent (SHA-256 checked); they're built on the dev machine (circuit/build_takeover.py) and served
// from circuit/build/ and circuit/incoming/, so elsewhere the page says they're missing.
// Protocol: docs/circuit-protocol.md.

const FILES = [
  { id: 'loop', label: 'Zerkit', sub: 'LOOP06', url: 'circuit/build/circuittracks-4486-LOOP06.syx',
    sha: '562f9f39b37345a9f32adc86f7d407efbf1df4edb1fb797bc10ec01a957241bc' },
  { id: 'stock', label: 'Novation', sub: '1.2.1', url: 'circuit/incoming/circuittracks-firmware-4486.syx',
    sha: 'bd2d294bafa88fdec7ae1f5fcaaa13158323969c5a40f83405a72e4ad329a0bd' },
];
const NOV = [0xF0, 0x00, 0x20, 0x29, 0x00];
const STATUS = { 0: 'update started', 1: 'press Play on the Circuit', 16: 'cancelled on the Circuit',
  17: 'confirmation timed out', 124: 'failed (not viable)', 125: 'received, checking', 126: 'failed (CRC)', 127: 'done' };

export function setupFirmware({ onBusy }) {
  let midi = null, inp = null, out = null;
  let device = '', deviceCls = '', mode = null;            // mode: 'bootloader' | 'firmware' | null
  let chosen = null, packets = null, xfer = null, progress = 0, phase = '', phaseCls = '';
  const log = [];
  let version = 0, shown = -1, root = null;
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

  async function sha256(buf) {
    return [...new Uint8Array(await crypto.subtle.digest('SHA-256', buf))].map(b => b.toString(16).padStart(2, '0')).join('');
  }
  function split(u8) {
    const msgs = [];
    for (let i = 0; i < u8.length;) {
      const s = u8.indexOf(0xF0, i), e = u8.indexOf(0xF7, s);
      if (s < 0 || e < 0) break;
      msgs.push(u8.slice(s, e + 1)); i = e + 1;
    }
    const cmds = msgs.map(m => m[5]);
    if (cmds[0] !== 0x71 || cmds[1] !== 0x7C || cmds.at(-1) !== 0x73 || cmds.slice(2, -1).some(c => c !== 0x72)) throw Error('unexpected message order');
    return msgs;
  }

  async function choose(f) {
    if (mode !== 'bootloader' || xfer) return;
    chosen = null; changed();
    try {
      const res = await fetch(f.url, { cache: 'no-store' });
      if (!res.ok) throw Error('not on this computer');
      const buf = await res.arrayBuffer();
      if ((await sha256(buf)) !== f.sha) throw Error('checksum mismatch: not sending it');
      packets = split(new Uint8Array(buf));
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
