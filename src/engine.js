// Transport + open-ended, bar-quantised multi-track looper.
//
// Every musical position is stored in beats (quarter notes), never seconds,
// so a tempo change just rescales playback.
//
// All tracks share one loop length, set by the first take on any track.
// Recording always goes into the selected track.
//
// The engine has no idea what makes the sound. It talks to an `out` object with:
//   now()                                        -> audio-clock time in seconds
//   noteOn(track, note, vel) / noteOff(track, note)      (live, immediate)
//   playNote(track, note, vel, onTime, offTime)          (scheduled, from the loop)
//   click(time, accent)
//   cancelScheduled()
// Today that's Web Audio; later it can be a Web MIDI / CoreMIDI output.

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
    this.scheduledTo = 0; // beat up to which events have been handed to `out`

    // Record states:
    //   idle      - nothing recording (looping if a loop exists)
    //   armed     - waiting for the first note, which fixes where the take starts
    //   recording - open-ended first take
    //   closing   - X pressed; still recording until the end of the current bar
    //   overdub   - recording into an existing loop
    this.rec = 'idle';
    this.recStart = 0;
    this.recEnd = 0;

    this.tracks = Array.from({ length: trackCount }, () => ({ notes: [] }));
    this.selected = 0;
    this.loop = null; // { origin, length, playFrom } - all in beats, shared by every track
    this.pass = 0;    // recording pass number, stamped on each note (for undo)

    this.held = new Map(); // "track:note" -> recorded note still waiting for its note-off
  }

  // ---- time ---------------------------------------------------------------

  beat() {
    if (!this.playing) return this.anchorBeat;
    return this.beatAtTime(this.out.now());
  }
  beatAtTime(t) { return this.anchorBeat + (t - this.anchorTime) * this.bpm / 60; }
  timeAt(beat) { return this.anchorTime + (beat - this.anchorBeat) * 60 / this.bpm; }
  nextBar(beat) { return (Math.floor(beat / this.beatsPerBar) + 1) * this.beatsPerBar; }
  loopPos(beat) { return mod(beat - this.loop.origin, this.loop.length); }
  isEmpty() { return this.tracks.every(t => t.notes.length === 0); }

  // ---- transport ----------------------------------------------------------

  start(lead = 0.05) {
    if (this.playing) return;
    this.anchorTime = this.out.now() + lead;
    this.anchorBeat = 0;
    this.scheduledTo = 0;
    this.playing = true;
    if (this.loop) { this.loop.origin = 0; this.loop.playFrom = 0; }
  }

  stop() {
    if (!this.playing) return;
    const b = this.beat();
    // Stopping mid-take keeps it: the loop closes at the end of the current bar.
    if (this.rec === 'recording') this.closeTake(b);
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
    if (this.playing) { // re-anchor so the beat position doesn't jump
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
        this.rec = this.loop ? 'overdub' : 'armed';
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

  // X pressed during the take: the loop length becomes "up to the end of this bar".
  // The loop exists from now on (so playback can be scheduled ahead), but we keep
  // recording into it until the bar line.
  closeTake(b) {
    this.recEnd = this.nextBar(b);
    this.loop = { origin: this.recStart, length: this.recEnd - this.recStart, playFrom: this.recEnd };
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
    for (const t of this.tracks) t.notes = [];
    this.held.clear();
    this.loop = null;
    this.rec = 'idle';
    this.resync();
  }

  clearTrack(i) {
    if (this.rec === 'recording' || this.rec === 'closing') return this.clearAll();
    this.tracks[i].notes = [];
    this.dropHeld(n => n.track === i);
    this.afterRemoval();
  }

  // Z: throw away whatever was recorded most recently, on any track.
  //   - during the first take: drop it and stay armed, ready for another go
  //   - during an overdub: drop this pass and stop overdubbing
  //   - otherwise: drop the latest pass; once nothing is left, the loop goes too
  undo() {
    if (this.rec === 'recording' || this.rec === 'closing') {
      this.clearAll();
      this.pass++;
      this.rec = 'armed';
      return;
    }
    if (!this.loop) return;
    let last = -1;
    if (this.rec === 'overdub') { last = this.pass; this.rec = 'idle'; }
    else for (const t of this.tracks) for (const n of t.notes) last = Math.max(last, n.pass);
    for (const t of this.tracks) t.notes = t.notes.filter(n => n.pass !== last);
    this.dropHeld(n => n.pass === last);
    this.afterRemoval();
  }

  dropHeld(match) {
    for (const [key, n] of this.held) if (match(n)) this.held.delete(key);
  }

  afterRemoval() {
    if (this.isEmpty()) {
      this.loop = null;
      if (this.rec === 'overdub') this.rec = 'idle';
    }
    this.resync();
  }

  // Drop everything already handed to the output and schedule again from now,
  // so removed notes don't sound and remaining ones (and clicks) still do.
  resync() {
    this.out.cancelScheduled();
    if (this.playing) this.scheduledTo = this.beat();
  }

  // ---- notes --------------------------------------------------------------

  noteOn(track, note, vel = 100) {
    this.out.noteOn(track, note, vel);
    if (this.rec === 'armed' && !this.playing) this.start(0); // first note starts everything, on beat 1
    if (!this.playing) return;
    const b = this.beat();
    const key = `${track}:${note}`;
    if (this.held.has(key)) { this.finalize(this.held.get(key), b); this.held.delete(key); }

    if (this.rec === 'armed') this.beginTake(b);
    if (this.rec === 'closing' && b >= this.recEnd) this.finishTake(this.recEnd);

    let n = null;
    if (this.rec === 'recording' || this.rec === 'closing') {
      const pressed = Math.max(b, this.recStart);
      n = { track, note, vel, start: pressed - this.recStart, dur: null, pressed, kind: 'take', pass: this.pass };
    } else if (this.rec === 'overdub') {
      n = { track, note, vel, start: this.loopPos(b), dur: null, pressed: b, kind: 'dub', pass: this.pass };
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
    if (n.kind === 'take' && this.rec !== 'recording') end = Math.min(end, this.recEnd);
    n.dur = Math.max(MIN_DUR, end - n.pressed);
    if (n.kind === 'dub' && this.loop) n.dur = Math.min(n.dur, this.loop.length);
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

    if (this.loop) {
      const { origin, length: L, playFrom } = this.loop;
      const lo = Math.max(from, playFrom);
      this.tracks.forEach((t, ti) => {
        for (const n of t.notes) {
          if (n.dur == null) continue; // still held
          let k = Math.ceil((lo - origin - n.start) / L - 1e-9);
          for (let abs = origin + k * L + n.start; abs < to; k++, abs = origin + k * L + n.start) {
            if (abs >= lo) this.out.playNote(ti, n.note, n.vel, this.timeAt(abs), this.timeAt(abs + n.dur));
          }
        }
      });
    }
    this.scheduledTo = to;
  }

  // ---- read-only helpers for the UI ----------------------------------------

  // What a track's piano roll should show: visible span (beats), playhead, notes.
  view(i) {
    const bpb = this.beatsPerBar;
    const b = this.beat();
    const notes = this.tracks[i].notes;
    const here = i === this.selected;
    if (this.loop) {
      return {
        span: this.loop.length,
        head: this.playing ? this.loopPos(b) : 0,
        notes,
        recording: here && (this.rec === 'closing' || this.rec === 'overdub'),
      };
    }
    if (this.rec === 'recording') {
      const rel = b - this.recStart;
      const bars = Math.max(4, Math.floor(rel / bpb) + 2); // always one empty bar ahead
      return { span: bars * bpb, head: rel, notes, recording: here };
    }
    // No loop yet (armed or not): nothing to show beyond bar 1, so circle round it.
    return {
      span: 4 * bpb,
      head: this.playing ? mod(Math.max(b, 0), bpb) : 0,
      notes,
      recording: here && this.rec === 'armed',
    };
  }

  // A track's loop notes sounding right now (for lighting up the keyboard).
  loopSounding(i) {
    const s = new Set();
    if (!this.loop || !this.playing) return s;
    const b = this.beat();
    if (b < this.loop.playFrom) return s;
    const pos = this.loopPos(b);
    for (const n of this.tracks[i].notes) {
      if (n.dur != null && mod(pos - n.start, this.loop.length) < n.dur) s.add(n.note);
    }
    return s;
  }
}
