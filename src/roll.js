// Canvas piano roll for one track: rows of pitches, bars across, moving playhead.
//
// `rows` describes the vertical axis:
//   count          number of rows (row 0 at the bottom)
//   rowOf(note)    row index for a MIDI note, or -1 if off-screen
//   label(i)       text for row i
//   major(i)       always label this row, even when rows are too thin to label them all
//   black(i)       shade as a black-key row

const GUTTER = 52;
const RULER = 18;
const C = {
  bg: '#101217',
  rowWhite: '#161a21',
  rowBlack: '#111419',
  ruler: '#1b1f27',
  rulerRec: '#3a1a1d',
  beat: 'rgba(255,255,255,0.05)',
  bar: 'rgba(255,255,255,0.16)',
  text: '#7d8594',
  held: '#ff5f5f',
  noteRec: '#ff5f5f',
  head: '#e9ecf1',
  headRec: '#ff5f5f',
};

export function drawRoll(canvas, view, beatsPerBar, rows, color) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (!w || !h) return;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const gw = w - GUTTER;
  const rowH = (h - RULER) / rows.count;
  const x = beat => GUTTER + (beat / view.span) * gw;
  const rowY = i => RULER + (rows.count - 1 - i) * rowH;

  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, w, h);

  // Rows + labels
  const labelAll = rowH >= 14;
  ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.textBaseline = 'middle';
  for (let i = 0; i < rows.count; i++) {
    const y = rowY(i);
    ctx.fillStyle = rows.black(i) ? C.rowBlack : C.rowWhite;
    ctx.fillRect(GUTTER, y, gw, rowH);
    if (labelAll || rows.major(i)) {
      ctx.fillStyle = C.text;
      ctx.fillText(rows.label(i), 8, y + rowH / 2);
    }
  }

  // Ruler
  ctx.fillStyle = view.recording ? C.rulerRec : C.ruler;
  ctx.fillRect(GUTTER, 0, gw, RULER);

  // Grid
  ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace';
  for (let b = 0; b <= view.span; b++) {
    const isBar = b % beatsPerBar === 0;
    const px = Math.round(x(b)) + 0.5;
    ctx.strokeStyle = isBar ? C.bar : C.beat;
    ctx.beginPath();
    ctx.moveTo(px, isBar ? 0 : RULER);
    ctx.lineTo(px, h);
    ctx.stroke();
    if (isBar && b < view.span) {
      ctx.fillStyle = C.text;
      ctx.fillText(String(b / beatsPerBar + 1), px + 5, RULER / 2);
    }
  }

  // Notes (already projected onto the shared timeline; repeats of shorter loops are "ghost")
  const inset = rowH > 6 ? 1.5 : 0.5;
  for (const n of view.notes) {
    const r = rows.rowOf(n.note);
    if (r < 0) continue;
    ctx.fillStyle = n.held ? C.held : view.recording ? C.noteRec : color;
    ctx.globalAlpha = n.ghost ? 0.38 : 1;
    const y = rowY(r) + inset;
    const hgt = Math.max(1, rowH - inset * 2);
    const x0 = x(n.start);
    fillRound(ctx, x0 + 1, y, Math.max(3, x(Math.min(n.start + n.dur, view.span)) - x0 - 2), hgt);
    // A note that runs past the end of the timeline wraps round to the start.
    if (n.start + n.dur > view.span) {
      fillRound(ctx, x(0) + 1, y, Math.max(3, x(n.start + n.dur - view.span) - x(0) - 2), hgt);
    }
  }
  ctx.globalAlpha = 1;

  // Audio clips: a waveform across the whole lane, one per pass of the loop.
  const mid = RULER + (h - RULER) / 2, amp = (h - RULER) / 2 - 6;
  for (const c of view.clips ?? []) {
    const x0 = x(c.start), x1 = x(c.start + c.len), n = Math.max(1, Math.round(x1 - x0));
    const peaks = c.clip.peaks(n);
    ctx.globalAlpha = c.ghost ? 0.38 : 1;
    ctx.fillStyle = color;
    if (!peaks) { ctx.fillRect(Math.max(GUTTER, x0), mid - 0.5, Math.min(x1, w) - Math.max(GUTTER, x0), 1); continue; }
    for (let i = 0; i < n; i++) {
      const px = x0 + i;
      if (px < GUTTER || px >= w) continue;
      const a = Math.max(0.5, Math.min(1, Math.sqrt(peaks[i])) * amp);   // sqrt: quiet parts stay visible
      ctx.fillRect(px, mid - a, 1, a * 2);
    }
  }
  ctx.globalAlpha = 1;

  // Playhead
  const hx = Math.round(x(view.head)) + 0.5;
  ctx.strokeStyle = view.recording ? C.headRec : C.head;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(hx, 0);
  ctx.lineTo(hx, h);
  ctx.stroke();
  ctx.lineWidth = 1;
}

function fillRound(ctx, x, y, w, h) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, Math.min(3, h / 2));
  ctx.fill();
}
