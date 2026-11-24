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
//   click(time, accent)
//   cancelScheduled()

const LOOKAHEAD = 0.12;   // seconds of events scheduled ahead of "now"
const EARLY_GRACE = 0.25; // beats: a first note this close before a bar line starts the take on it
const MIN_DUR = 0.05;     // beats: shortest note we store

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
    this.tracks = Array.from({ length: trackCount }, () => ({ notes: [], loop: null }));
    this.selected = 0;
    this.pass = 0;          // recording pass number, stamped on each note (for undo)
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
  isEmpty() { return this.tracks.every(t => t.notes.length === 0); }

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
    this.playing = true;
  }

  stop() {
    if (!this.playing) return;
    const b = this.beat();
    if (this.rec === 'recording') this.closeTake(b);    // stopping mid-take keeps it
    if (this.rec === 'closing') this.finishTake(Math.min(b, this.recEnd));
    if (this.rec === 'overdub') this.rec = 'idle';
    for (const n of this.held.values()) this.finalize(n, b);
    this.held.clear();
    this.playing = false;
    this.anchorBeat = 0;
    this.out.cancelScheduled();
  }

  setTempo(bpm) {
    bpm = Math.max(30, Math.min(300, Math.round(bpm)));
    if (this.playing) {
      const now = this.out.now();
      this.anchorBeat = this.beatAtTime(now);
      this.anchorTime = now;
    }
    this.bpm = bpm;
  }

  select(track) {
    if (track >= 0 && track < this.tracks.length) this.selected = track;
  }

  // ---- recording ----------------------------------------------------------

  toggleRecord() {
    switch (this.rec) {
      case 'idle':
        this.pass++;
        this.recTrack = this.selected;
        this.rec = this.tracks[this.recTrack].loop ? 'overdub' : 'armed';
        break;
      case 'armed':
      case 'overdub':
        this.rec = 'idle';
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

  // Record pressed during the take: this track's length becomes "up to the end of this bar".
  // The loop exists from now on (so playback is scheduled ahead) but we keep recording into
  // it until the bar line.
  closeTake(b) {
    this.recEnd = this.nextBar(b);
    this.tracks[this.recTrack].loop = {
      origin: this.recStart,
      length: this.recEnd - this.recStart,
      playFrom: this.recEnd,          // the first pass was played live
    };
    this.rec = 'closing';
  }

  finishTake(at) {
    for (const [key, n] of this.held) {
      if (n.kind === 'take') { n.dur = Math.max(MIN_DUR, at - n.pressed); this.held.delete(key); }
    }
    this.rec = 'idle';
  }

  // ---- clearing & undo ------------------------------------------------------

  clearAll() {
    for (const t of this.tracks) { t.notes = []; t.loop = null; }
    this.held.clear();
    this.rec = 'idle';
    this.resync();
  }

  clearTrack(i) {
    const recordingHere = this.rec !== 'idle' && this.recTrack === i;
    this.tracks[i].notes = [];
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
    else for (const t of this.tracks) for (const n of t.notes) last = Math.max(last, n.pass);
    if (last >= 0) this.removePass(last);
    this.resync();
  }

  removePass(p) {
    for (const t of this.tracks) {
      t.notes = t.notes.filter(n => n.pass !== p);
      if (t.notes.length === 0) t.loop = null;
    }
    this.dropHeld(n => n.pass === p);
  }

  dropHeld(match) {
    for (const [key, n] of this.held) if (match(n)) this.held.delete(key);
  }

  // Drop everything already handed to the output and schedule again from now.
  resync() {
    this.out.cancelScheduled();
    if (this.playing) this.scheduledTo = this.beat();
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
      n = { track, note, vel, start: pressed - this.recStart, dur: null, pressed, kind: 'take', pass: this.pass };
    } else if (this.rec === 'overdub') {
      n = { track, note, vel, start: this.trackPos(track, b), dur: null, pressed: b, kind: 'dub', pass: this.pass };
    }
    if (n) {
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
      for (const n of t.notes) {
        if (n.dur == null) continue; // still held
        let k = Math.ceil((lo - origin - n.start) / L - 1e-9);
        for (let abs = origin + k * L + n.start; abs < to; k++, abs = origin + k * L + n.start) {
          if (abs >= lo) this.out.playNote(ti, n.note, n.vel, this.timeAt(abs), this.timeAt(abs + n.dur));
        }
      }
    });
    this.scheduledTo = to;
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
    return { span: d.span, head: d.head, notes, recording: here && d.recording, length: t.loop ? t.loop.length : 0 };
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
