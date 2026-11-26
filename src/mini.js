// The little sequencer in each track button: the track's own loop, 4 bars at a time (a longer
// loop pages through them as it plays), notes across the track's own pitch range, audio as
// its waveform, and a faint playhead. Kits: each drum used gets its own row.

const MAX_BARS = 4;

export function drawMini(canvas, engine, t, color, kit = false) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (!w || !h) return;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const track = engine.tracks[t];
  if (!track.loop) return;
  const L = track.loop.length;
  const W = Math.min(L, MAX_BARS * engine.beatsPerBar);   // a page
  const pos = engine.playing ? engine.trackPos(t, engine.beat()) : 0;
  const from = Math.floor(pos / W) * W;                   // the page that's playing
  const x = b => ((b - from) / W) * w;

  ctx.fillStyle = color;
  if (track.clips.length) {
    const n = Math.max(1, Math.round((w * L) / W)), mid = h / 2;
    for (const c of track.clips) {
      const peaks = c.peaks(n);
      if (!peaks) continue;
      ctx.globalAlpha = 0.8;
      const i0 = Math.round((from / L) * n);
      for (let i = 0; i < Math.min(w, x(L)); i++) {
        const a = Math.max(0.5, Math.min(1, Math.sqrt(peaks[i0 + i] ?? 0)) * (mid - 1));
        ctx.fillRect(i, mid - a, 1, a * 2);
      }
    }
  }

  const notes = track.notes.filter(n => n.dur != null);
  if (notes.length) {
    const used = [...new Set(notes.map(n => n.note))].sort((a, b) => a - b);
    const row = kit ? note => used.indexOf(note) : note => note;
    const lo = row(used[0]), hi = row(used.at(-1));
    const range = Math.max(hi - lo, kit ? 3 : 6);          // a narrow part doesn't fill the height
    const bar = Math.max(1.5, Math.min(3, h / (range + 1)));
    const pad = (range - (hi - lo)) / 2;
    const y = note => h - bar - ((row(note) - lo + pad) / range) * (h - bar);
    ctx.globalAlpha = 0.9;
    for (const n of notes) {
      if (n.start < from || n.start >= from + W) continue;
      const x0 = x(n.start);
      ctx.fillRect(x0, y(n.note), Math.max(1.5, Math.min(x(n.start + n.dur), w) - x0 - 0.5), bar);
    }
  }

  if (engine.playing) {
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = '#e9ecf1';
    ctx.fillRect(Math.round(x(pos)), 0, 1, h);
  }
  ctx.globalAlpha = 1;
}
