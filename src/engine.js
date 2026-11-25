// Transport + open-ended, bar-quantised multi-track looper where every track has its own
// loop length (like Maschine): a 1-bar drum loop simply cycles 8 times under an 8-bar bass.
//
// Every musical position is in beats (quarter notes), never seconds, so tempo changes just
// rescale playback. All tracks run on one clock: a track's position is
// (beat - track.loop.origin) mod track.loop.length, so the alignment you heard while
// recording is kept. Stop + Play restarts from the top of the longest loop.
//
// The engine has no idea what makes the sound. It talks to an `out` object with:
//   now()                                        -> audio-clock time in seconds
//   noteOn(track, note, vel) / noteOff(track, note)      (live, immediate)
//   playNote(track, note, vel, onTime, offTime)          (scheduled, from the loops)
//   playClip(track, clip, time, offsetSeconds)           (audio tracks: one pass of a recorded clip)
//
// Audio tracks hold clips instead of notes: one recorded take, a loop long, made by whoever
// handles onClose (the engine only knows when and where; the audio side owns the sound).
//   click(time, accent)
//   cancelScheduled()

const LOOKAHEAD = 0.12;   // seconds of events scheduled ahead of "now"
const EARLY_GRACE = 0.25; // beats: a first note this close before a bar line starts the take on it
const MIN_DUR = 0.05;     // beats: shortest note we store

// Record quantise, per track: where a recorded note's start snaps to (in beats). Notes keep the
// length you played; you still hear them live exactly when you played them.
export const QUANT = { off: 0, mid: 0.125, strong: 0.25 };  // off, 32nds, 16ths
export const QUANT_ORDER = ['off', 'mid', 'strong'];

const mod = (a, n) => ((a % n) + n) % n;

export class Engine {
  constructor(out, trackCount = 2) {
    this.out = out;
    this.bpm = 120;
    this.beatsPerBar = 4;
    this.click = true;
    this.playing = false;

    // beat = anchorBeat + (time - anchorTime) * bpm / 60
    this.anchorTime = 0;
    this.anchorBeat = 0;
    this.scheduledTo = 0;

    // Record states (one recording at a time, into recTrack):
    //   idle      - nothing recording
    //   armed     - waiting for the first note on recTrack, which fixes where the take starts
    //   recording - open-ended take on an empty track
    //   closing   - Record pressed; still recording until the end of the current bar
    //   overdub   - recording into recTrack's existing loop, at its length
    this.rec = 'idle';
    this.recTrack = 0;
    this.recStart = 0;
    this.recEnd = 0;

    // Each track: { notes, loop: { origin, length, playFrom } | null }
    // Each track: { notes, clips (audio tracks), loop, quant }
    this.tracks = Array.from({ length: trackCount }, () => ({ notes: [], clips: [], loop: null, quant: 'off' }));
    this.onClose = null;    // (track, startBeat, endBeat, pass) when a take's length is fixed
    this.onDubEnd = null;   // (track, startBeat, endBeat, pass) when an overdub pass ends (kept, not undone)
    this.dubStart = 0;      // beat the current overdub started at
    this.fresh = false;     // scheduling (re)starts: audio clips already mid-pass join part-way
    this.selected = 0;
    this.swing = 50;        // % of an 8th where its second 16th falls: 50 = straight, 75 = full shuffle
    this.pass = 0;          // recording pass number, stamped on each note (for undo)
    this.redoStack = [];    // undone passes, newest last: [{ pass, tracks: [{ i, notes, clips, loop }] }]
    this.held = new Map();  // "track:note" -> recorded note still waiting for its note-off
  }

  // ---- time ---------------------------------------------------------------

  beat() {
    if (!this.playing) return this.anchorBeat;
    return this.beatAtTime(this.out.now());
  }
  beatAtTime(t) { return this.anchorBeat + (t - this.anchorTime) * this.bpm / 60; }
  timeAt(beat) { return this.anchorTime + (beat - this.anchorBeat) * 60 / this.bpm; }
  nextBar(beat) { return (Math.floor(beat / this.beatsPerBar) + 1) * this.beatsPerBar; }
  trackPos(t, beat) { const l = this.tracks[t].loop; return mod(beat - l.origin, l.length); }

  // The longest loop: the "song" the transport restarts from, and the display's timeline.
  get master() {
    let best = null;
    for (const t of this.tracks) if (t.loop && (!best || t.loop.length > best.length)) best = t.loop;
    return best;
  }
  get loop() { return this.master; } // for callers that only ask "is anything looping, and how long?"
  isEmpty() { return this.tracks.every(t => t.notes.length === 0 && t.clips.length === 0); }
  hasAudio() { return this.tracks.some(t => t.clips.length > 0); }

  // ---- transport ----------------------------------------------------------

  start(lead = 0.05) {
    if (this.playing) return;
    // Restart from the top of the longest loop, keeping every track's alignment to it.
    const m = this.master;
    if (m) {
      const ref = m.origin;
      for (const t of this.tracks) {
        if (!t.loop) continue;
        t.loop.origin = mod(t.loop.origin - ref, t.loop.length);
        t.loop.playFrom = 0;
      }
    }
    this.anchorTime = this.out.now() + lead;
    this.anchorBeat = 0;
    this.scheduledTo = 0;
    this.fresh = true;
    this.dubStart = 0;                                // an overdub armed while stopped starts here
    this.playing = true;
  }

  stop() {
    if (!this.playing) return;
    const b = this.beat();
    if (this.rec === 'recording') this.closeTake(b);    // stopping mid-take keeps it
    if (this.rec === 'closing') this.finishTake(Math.min(b, this.recEnd));
    if (this.rec === 'overdub') this.endDub(b);
    for (const n of this.held.values()) this.finalize(n, b);
    this.held.clear();
    for (const t of this.tracks) for (const n of t.notes) delete n.notBefore;   // beats restart from 0
    this.playing = false;
    this.anchorBeat = 0;
    this.out.cancelScheduled();
  }

  setSwing(pct) { this.swing = Math.max(50, Math.min(75, Math.round(pct))); }

  // Swing, applied as the loops play: within each 8th note the second 16th moves from halfway
  // to `swing`% of the way, and everything in between stretches with it. Never earlier than
  // written, so notes are never pushed back into time already scheduled.
  swung(b) {
    if (this.swing === 50) return b;
    const cell = Math.floor(b * 2) / 2, p = b - cell, m = this.swing / 200;   // 8th = 0.5 beat
    return cell + (p < 0.25 ? p * (m / 0.25) : m + (p - 0.25) * ((0.5 - m) / 0.25));
  }

  setTempo(bpm) {
    if (this.hasAudio()) return;                     // recorded audio can't change speed
    bpm = Math.max(30, Math.min(300, Math.round(bpm)));
    if (this.playing) {
      const now = this.out.now();
      this.anchorBeat = this.beatAtTime(now);
      this.anchorTime = now;
    }
    this.bpm = bpm;
  }

  // Move a track's recorded notes by `semis`. Refused (false) if any would leave the MIDI range.
  transpose(i, semis) {
    const notes = this.tracks[i].notes;
    if (!notes.length || notes.some(n => n.note + semis < 0 || n.note + semis > 127)) return false;
    for (const n of notes) n.note += semis;
    return true;
  }

  cycleQuant(i) {
    const t = this.tracks[i];
    t.quant = QUANT_ORDER[(QUANT_ORDER.indexOf(t.quant) + 1) % QUANT_ORDER.length];
  }

  // Snap a recorded start position to the track's grid, wrapping round its loop if it has one.
  quantise(i, start) {
    const g = QUANT[this.tracks[i].quant];
    if (g) start = Math.round(start / g) * g;
    const loop = this.tracks[i].loop;
    return loop ? mod(start, loop.length) : start;
  }

  select(track) {
    if (track >= 0 && track < this.tracks.length) this.selected = track;
  }

  // ---- recording ----------------------------------------------------------

  toggleRecord() {
    switch (this.rec) {
      case 'idle':
        this.pass++;
        this.redoStack = [];                            // a new recording: what was undone is gone
        this.recTrack = this.selected;
        this.rec = this.tracks[this.recTrack].loop ? 'overdub' : 'armed';
        this.dubStart = this.beat();
        break;
      case 'armed':
        this.rec = 'idle';
        break;
      case 'overdub':
        this.endDub(this.beat());
        break;
      case 'recording':
        this.closeTake(this.beat());
        break;
      // 'closing': already on its way to the bar line - ignore
    }
  }

  // First note while armed: the take starts at the top of the bar it fell in,
  // or at the next bar line if it was played just ahead of it.
  beginTake(b) {
    const bpb = this.beatsPerBar;
    let s = Math.floor(b / bpb) * bpb;
    if (s + bpb - b <= EARLY_GRACE) s += bpb;
    this.recStart = s;
    this.rec = 'recording';
  }

  // Audio tracks: the first sound while armed starts the take. `at` is the audio-clock time
  // that sound was played (already corrected for latency), so nothing of its attack is lost:
  // stopped, the transport starts with beat 1 there; playing, the take starts on its bar.
  startTake(at) {
    if (this.rec !== 'armed') return;
    if (!this.playing) this.start(at - this.out.now());
    this.beginTake(this.beatAtTime(at));
  }

  // Record pressed during the take: this track's length becomes "up to the end of this bar".
  // The loop exists from now on (so playback is scheduled ahead) but we keep recording into
  // it until the bar line.
  closeTake(b) {
    this.recEnd = this.nextBar(b);
    const t = this.tracks[this.recTrack];
    t.loop = {
      origin: this.recStart,
      length: this.recEnd - this.recStart,
      playFrom: this.recEnd,          // the first pass was played live
    };
    for (const n of t.notes) n.start = mod(n.start, t.loop.length);   // a last note snapped onto the bar line wraps to 1
    this.onClose?.(this.recTrack, this.recStart, this.recEnd, this.pass);

    this.rec = 'closing';
  }

  endDub(b) {
    this.rec = 'idle';
    if (this.playing && b > this.dubStart) this.onDubEnd?.(this.recTrack, this.dubStart, b, this.pass);
  }

  // A new audio layer (from an overdub) arrives after its pass ended: play it from now on.
  // Later passes come from the scheduler; the rest of this pass, and any pass start the
  // scheduler has already gone past, are started here.
  addClip(i, clip) {
    const t = this.tracks[i];
    t.clips.push(clip);
    if (!this.playing || !t.loop) return;
    const { origin, length: L } = t.loop;
    const spb = 60 / this.bpm;
    const b = this.beat() + 0.02;
    const c0 = origin + Math.floor((b - origin) / L) * L;
    this.out.playClip?.(i, clip, this.timeAt(b), (b - c0) * spb);
    for (let s = c0 + L; s < this.scheduledTo; s += L) this.out.playClip?.(i, clip, this.timeAt(s), 0);
  }

  finishTake(at) {
    for (const [key, n] of this.held) {
      if (n.kind === 'take') { n.dur = Math.max(MIN_DUR, at - n.pressed); this.held.delete(key); }
    }
    this.rec = 'idle';
  }

  // ---- clearing & undo ------------------------------------------------------

  clearAll() {
    for (const t of this.tracks) { t.notes = []; t.clips = []; t.loop = null; }
    this.redoStack = [];
    this.held.clear();
    this.rec = 'idle';
    this.resync();
  }

  clearTrack(i) {
    const recordingHere = this.rec !== 'idle' && this.recTrack === i;
    this.redoStack = [];
    this.tracks[i].notes = [];
    this.tracks[i].clips = [];
    this.tracks[i].loop = null;
    this.dropHeld(n => n.track === i);
    if (recordingHere) this.rec = 'idle';
    this.resync();
  }

  // Undo: throw away the most recent recording - one take or one overdub pass, on the one
  // track it was recorded on. Nothing else is touched.
  //   - during a take: drop it and stay armed, ready for another go
  //   - during an overdub: drop this pass and stop overdubbing
  //   - otherwise: drop the latest pass; a track left empty loses its length
  undo() {
    if (this.rec === 'recording' || this.rec === 'closing') {
      this.removePass(this.pass);
      this.tracks[this.recTrack].loop = null;
      this.pass++;
      this.rec = 'armed';
      this.resync();
      return;
    }
    let last = -1;
    if (this.rec === 'overdub') { last = this.pass; this.rec = 'idle'; }
    else for (const t of this.tracks) for (const n of [...t.notes, ...t.clips]) last = Math.max(last, n.pass);
    if (last >= 0) this.removePass(last, true);
    this.resync();
  }

  // Redo: put back the most recently undone pass (its notes, audio, and the loop length if the
  // undo had emptied the track). Only when not recording.
  redo() {
    if (this.rec !== 'idle' || !this.redoStack.length) return;
    const { tracks } = this.redoStack.pop();
    for (const { i, notes, clips, loop } of tracks) {
      const t = this.tracks[i];
      t.notes.push(...notes);
      t.clips.push(...clips);
      if (!t.loop && loop) t.loop = { ...loop, playFrom: 0 };
    }
    this.resync();
  }
  canRedo() { return this.rec === 'idle' && this.redoStack.length > 0; }

  // Remove a pass everywhere. `keep`: remember it for redo.
  removePass(p, keep = false) {
    const saved = [];
    this.tracks.forEach((t, i) => {
      const notes = t.notes.filter(n => n.pass === p && n.dur != null), clips = t.clips.filter(c => c.pass === p);
      if (keep && (notes.length || clips.length)) saved.push({ i, notes, clips, loop: t.loop && { ...t.loop } });
      t.notes = t.notes.filter(n => n.pass !== p);
      t.clips = t.clips.filter(c => c.pass !== p);
      if (t.notes.length === 0 && t.clips.length === 0) t.loop = null;
    });
    if (saved.length) this.redoStack.push({ pass: p, tracks: saved });
    this.dropHeld(n => n.pass === p);
  }

  dropHeld(match) {
    for (const [key, n] of this.held) if (match(n)) this.held.delete(key);
  }

  // Drop everything already handed to the output and schedule again from now.
  resync() {
    this.out.cancelScheduled();
    if (this.playing) this.scheduledTo = this.beat();
    this.fresh = true;
  }

  // ---- notes --------------------------------------------------------------

  noteOn(track, note, vel = 100) {
    this.out.noteOn(track, note, vel);
    const intoRec = track === this.recTrack;
    if (this.rec === 'armed' && intoRec && !this.playing) this.start(0); // first note starts everything, on beat 1
    if (!this.playing) return;
    const b = this.beat();
    const key = `${track}:${note}`;
    if (this.held.has(key)) { this.finalize(this.held.get(key), b); this.held.delete(key); }
    if (!intoRec) return;

    if (this.rec === 'armed') this.beginTake(b);
    if (this.rec === 'closing' && b >= this.recEnd) this.finishTake(this.recEnd);

    let n = null;
    if (this.rec === 'recording' || this.rec === 'closing') {
      const pressed = Math.max(b, this.recStart);
      n = { track, note, vel, start: this.quantise(track, pressed - this.recStart), dur: null, pressed, kind: 'take', pass: this.pass };
    } else if (this.rec === 'overdub') {
      n = { track, note, vel, start: this.quantise(track, this.trackPos(track, b)), dur: null, pressed: b, kind: 'dub', pass: this.pass };
    }
    if (n) {
      // You heard this note live, so if quantise moved it slightly later, don't play it
      // again on this pass: the loop takes over from the next time round.
      n.notBefore = b + QUANT.strong;
      this.tracks[track].notes.push(n);
      this.held.set(key, n);
    }
  }

  noteOff(track, note) {
    this.out.noteOff(track, note);
    const key = `${track}:${note}`;
    const n = this.held.get(key);
    if (!n) return;
    this.held.delete(key);
    this.finalize(n, this.beat());
  }

  finalize(n, b) {
    let end = b;
    const takeOpen = this.rec === 'recording' && n.track === this.recTrack;
    if (n.kind === 'take' && !takeOpen) end = Math.min(end, this.recEnd);
    n.dur = Math.max(MIN_DUR, end - n.pressed);
    const loop = this.tracks[n.track].loop;
    if (n.kind === 'dub' && loop) n.dur = Math.min(n.dur, loop.length);
  }

  // ---- scheduler (call every ~25ms) ----------------------------------------

  tick() {
    if (!this.playing) return;
    if (this.rec === 'closing' && this.beat() >= this.recEnd) this.finishTake(this.recEnd);

    const from = this.scheduledTo;
    const to = this.beatAtTime(this.out.now() + LOOKAHEAD);
    if (to <= from) return;

    if (this.click) {
      for (let k = Math.max(0, Math.ceil(from)); k < to; k++) {
        this.out.click(this.timeAt(k), k % this.beatsPerBar === 0);
      }
    }

    this.tracks.forEach((t, ti) => {
      if (!t.loop) return;
      const { origin, length: L, playFrom } = t.loop;
      const lo = Math.max(from, playFrom);
      for (const c of t.clips) {
        // Scheduling just (re)started: a pass already under way joins part-way through.
        const c0 = origin + Math.floor((lo - origin) / L) * L;
        if (this.fresh && c0 < lo && c0 >= playFrom) this.out.playClip?.(ti, c, this.timeAt(lo), (lo - c0) * 60 / this.bpm);
        for (let k = Math.ceil((lo - origin) / L - 1e-9), abs = origin + k * L; abs < to; k++, abs = origin + k * L) {
          if (abs >= lo) this.out.playClip?.(ti, c, this.timeAt(abs), 0);
        }
      }
      for (const n of t.notes) {
        if (n.dur == null) continue; // still held
        let k = Math.ceil((lo - origin - n.start) / L - 1e-9);
        for (let abs = origin + k * L + n.start; abs < to; k++, abs = origin + k * L + n.start) {
          if (abs >= lo && !(abs < n.notBefore)) {
            this.out.playNote(ti, n.note, n.vel, this.timeAt(this.swung(abs)), this.timeAt(this.swung(abs + n.dur)));
          }
        }
      }
    });
    this.scheduledTo = to;
    this.fresh = false;
  }

  // ---- read-only helpers for the UI ----------------------------------------

  // The shared timeline every lane is drawn on: where it starts (in beats), how long it is,
  // and where the playhead is on it.
  display() {
    const bpb = this.beatsPerBar;
    const b = this.beat();
    const m = this.master;
    const mLen = m ? m.length : 0;
    if (this.rec === 'recording' || this.rec === 'closing') {
      const rel = b - this.recStart;
      const take = this.rec === 'closing' ? this.recEnd - this.recStart
        : Math.max(m ? 0 : 4 * bpb, (Math.floor(rel / bpb) + 2) * bpb); // one empty bar ahead
      return { anchor: this.recStart, span: Math.max(mLen, take), head: Math.max(0, rel), recording: true };
    }
    if (m) {
      return { anchor: m.origin, span: m.length, head: this.playing ? mod(b - m.origin, m.length) : 0,
               recording: this.rec === 'overdub' };
    }
    // Nothing recorded: nothing to show beyond bar 1, so the playhead circles round it.
    return { anchor: 0, span: 4 * bpb, head: this.playing ? mod(Math.max(b, 0), bpb) : 0, recording: this.rec === 'armed' };
  }

  // A track's notes projected onto the shared timeline. Shorter loops repeat; repeats
  // after the first pass of the loop are marked ghost so the UI can draw them fainter.
  view(i) {
    const d = this.display();
    const t = this.tracks[i];
    const b = this.beat();
    const here = this.rec !== 'idle' && this.recTrack === i;
    const notes = [];
    for (const n of t.notes) {
      if (n.dur == null) {                         // held right now: draw from press to playhead
        const x = n.pressed - d.anchor;
        if (t.loop && this.rec === 'overdub') {
          const xs = mod(n.pressed - d.anchor, d.span);
          notes.push({ note: n.note, start: xs, dur: Math.max(0, b - n.pressed), held: true });
        } else if (x >= 0 && x < d.span) {
          notes.push({ note: n.note, start: x, dur: Math.max(0, b - n.pressed), held: true });
        }
        continue;
      }
      if (!t.loop) {                               // open take: no repeats yet
        const x = this.recStart + n.start - d.anchor;
        if (x >= 0 && x < d.span) notes.push({ note: n.note, start: x, dur: n.dur });
        continue;
      }
      const { origin, length: L } = t.loop;
      let k = Math.ceil((d.anchor - origin - n.start) / L - 1e-9);
      for (let x = origin + k * L + n.start - d.anchor; x < d.span; k++, x += L) {
        notes.push({ note: n.note, start: x, dur: n.dur, ghost: x >= L });
      }
    }
    // Audio clips: one per pass of the loop on the shared timeline, like notes.
    const clips = [];
    if (t.loop) {
      const { origin, length: L } = t.loop;
      for (const c of t.clips) {
        let k = Math.ceil((d.anchor - origin) / L - 1e-9) - 1;
        for (let x = origin + k * L - d.anchor; x < d.span; k++, x += L) {
          if (x + L > 0) clips.push({ clip: c, start: x, len: L, ghost: x >= L || x < 0 });
        }
      }
    }
    return { span: d.span, head: d.head, notes, clips, recording: here && d.recording,
             length: t.loop ? t.loop.length : 0 };
  }

  // A track's loop notes sounding right now (for lighting up keyboards).
  loopSounding(i) {
    const s = new Set();
    const t = this.tracks[i];
    if (!t.loop || !this.playing) return s;
    const b = this.beat();
    if (b < t.loop.playFrom) return s;
    const pos = this.trackPos(i, b);
    for (const n of t.notes) {
      if (n.dur != null && mod(pos - n.start, t.loop.length) < n.dur) s.add(n.note);
    }
    return s;
  }
}
