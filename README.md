# MIDI Looper (web prototype)

A looper for the web (a Mac app later), played from the computer keyboard, MIDI keyboards and a Novation Circuit Tracks, with sampled instruments, kits, audio and MIDI tracks.
It exists to get the looping logic right before Web MIDI / CoreMIDI hardware is wired in.

## Run

ES modules need to be served over http (opening the file directly won't work):

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000 in Chrome.

## Controls

| Key | Action |
| --- | --- |
| `A S D F G H J` | White keys (C to B of the current octave) |
| `W E` `T Y U` | Black keys |
| `,` / `.` | Octave down / up for the selected track |
| `1`–`8` | Select track. The keyboard plays and records into the selected track |
| `0` | Jam: deselect every track, so keyboards play only themselves over the loop (pick a track to come back) |
| `Space` | Play / stop |
| `X` | Record: arm, then close the loop, then toggle overdub |
| `C` | Metronome click on/off |
| `↑` / `↓` | Tempo ±1 BPM (hold Shift for ±5) |
| `Z` / `Shift+Z` | Undo the last recording (the latest take or overdub pass, on its own track) / redo it |
| `Backspace` | Clear the selected track (`Shift+Backspace` clears everything) |

## How looping works

1. Select a track and press **X** (or **Record** on the Circuit) to arm it. Nothing advances until you play.
   - Your first note starts the take at the top of the bar it falls in. A note up to a 16th
     early is pulled onto the next downbeat instead.
   - If the transport is stopped, the first note also starts it, on beat 1.
2. Keep playing. The take is open-ended, so there's no length to set in advance.
3. Press **X** again. Recording carries on to the **end of the current bar**, and that is
   this track's loop length.
4. **Every track has its own length**, like Maschine. A 1-bar drum loop cycles 8 times under
   an 8-bar bass loop. Tracks keep the alignment you heard while recording them.
5. With a loop on the selected track, **X** toggles overdub, which records into it at its length.
6. **Undo** (Z, or **Clear** on the Circuit) removes the most recent take or overdub pass, on
   the one track it was recorded on. A track left empty loses its length.
7. **Stop** then **Play** restarts from the top of the longest loop.

## Tracks

There are 8 tracks, laid out like the Circuit's track buttons (Synth 1–2, MIDI 1–2, Drum 1–4).

The page is laid out like the Circuit Tracks. Top to bottom:

- **Logo row:** in the middle, a calculator-style readout of the tempo (BPM), which shows the swing
  % while Shift is held; then the project's name, and the ∞ badge, which glows green while the Circuit is
  connected (hover it for the connection's state).
- **Knobs:** Master volume (everything the looper plays) on the left, a volume knob above each
  track (with Shift: its left-right position, shown on the strip under it), and Click (the metronome's level) on the right. The Circuit's master volume and master filter knobs
  turn the two outer ones. Drag up/down or scroll to turn; double-click resets.
- **Row above the tracks:** Play/Hide (the play controls; the Circuit's Scales button) | Octave ▼ ▲ (Shift: move the selected track's notes an octave), Q (cycles the selected track's record
  quantise; each track button shows its own: Q off, Q 32, Q 16), Tempo (tap: click; hold + filter knob or scroll: tempo;
  Shift: swing; shows tempo · swing), Undo (Shift: redo), Clear track, Save (Shift: save as), Open (Shift:
  new project) | Shift (holds for the next press).
- **Track row:** Instrument (tap: the selected track's next melodic instrument, of those switched
  on; Shift: the Instruments page) | the eight track buttons | Jam, track "0" in dark grey (tap or
  `0`: deselect every track, see below). A small icon by each track's name shows its type: keyboard
  (instrument), pads (kit), saw-and-square (synth), waveform (audio). Each track button shows its
  instrument (a synth track: its preset), loop length and activity. Click one, press `1`–`8`, or
  press its Circuit button to select it.
- **Pages:** the pad area shows the Looper, or another page. Shift + Instrument opens
  **Instruments**: every melodic instrument with a switch for whether Instrument cycles through it
  (and which tracks use it). Shift + Audio opens **Audio**, Shift + MIDI opens **MIDI**.
  Every page shows up to 16 square cards on the top two pad rows, like the Circuit's pads: tap a
  card (or its pad on the Circuit) to switch it in or out of its button's cycle; ✎ edits kits,
  audio and MIDI instruments; **＋ New** is underneath. On the Circuit, a card's pad shows the
  instrument's colour when on, dim when off, white for the selected track's own.
  Shift + Kits opens **Kits** (see below). The same again goes back.
- **Pads:** a mute strip and a solo strip, one pad under each track, sharing the first pad row.
  Below them, filling the other three rows, the selected track's sequencer on the shared timeline (the longest loop), with repeats of shorter loops drawn faded. Its header shows the transport: what the looper is doing, the bar.beat and the beat dots.
- **Beside the pads:** the sound sources down the left, under Instrument: Kits (tap: next kit;
  Shift: the Kits page), Synth (see Synth tracks), Audio (tap: next audio instrument; Shift: the
  Audio page) and MIDI (tap: next MIDI instrument; Shift: the MIDI page). On the right: a spare
  button (unused so far), FX, Record, Play.

**Jam** (track 0) deselects every track, so keyboards and pads play nothing in the looper and you
can play your own instrument over the loop. Pick a track to come back.

Each button shows its actions top to bottom: what Shift does (small grey, marked ⇧), what holding
it does (small blue, marked with a clock), what a tap does (the main label), then any readout. While Shift is held (the Shift
key, the Circuit's Shift, or the on-screen Shift) the buttons with a Shift action light up; while
Tempo is held on the Circuit, its hold action lights up. Greyed-out buttons aren't used yet.

**Play / Hide** (the Circuit's Scales button; Note mode on the Circuit) opens a playing panel under the looper: a two-octave keyboard on instrument and MIDI tracks, or the
16-pad kit on drum tracks (pads 1–8 along the bottom, under the eight tracks; 9–16 above). The
computer keyboard plays the first octave, or the first 12 pads.

A track plays one of five kinds of sound:

- **Instruments** (melodic, sampled): Grand Piano, Upright Bass, Cello, Vibraphone, Harp, plus your
  own (see Sampled instruments). Tracks 1-4 start on Grand Piano, Upright Bass, Vibraphone and
  Cello. Each track remembers its own keyboard octave. (The old synthesised sounds are retired:
  projects that used them open with the nearest sampled instrument.)
- **Kits**: 16 samples on 16 pads (see Kits). Tracks 5-8 start on the Acoustic kit.
- **Synth**: a subtractive synth, its own settings on each track (see Synth tracks).
- **Audio**: an audio instrument, i.e. a named audio input (see Audio tracks).
- **MIDI**: a MIDI instrument, i.e. an external instrument played over MIDI (see MIDI tracks).

Kit pads are in playing order: Kick, Snare, Clap, Rim, Closed hat, Pedal hat, Open hat, Snare 2
along the bottom; four toms, Crash, Ride, Tambourine, Cowbell above. Each plays its General MIDI
note, so a part played in from a MIDI drum kit lands on the right sounds; other notes fold onto
the GM octave from C1.

## Novation Circuit Tracks

With the patched firmware (see `docs/circuit-protocol.md`), the Circuit drives the looper:

| Circuit | Looper |
| --- | --- |
| Play / Record | Play-stop / record (arm, close, overdub) |
| Clear / Shift + Clear | Undo the last recording / redo it |
| Duplicate | Clear the selected track |
| Track buttons (Synth 1 … Drum 4) | Select tracks 1–8 |
| Preset / Shift + Preset | The selected track's next instrument (of those switched on) / Instruments page on and off |
| Note / Shift + Note | The selected track's next kit (of those switched on) / Kits page on and off |
| Velocity | Make the selected track a synth track and show its synth / on a synth track: Synth page on and off (knob: a column's main control; hold pad 1-3 + knob: its controls; bottom pad: on/off; Shift + pad: one of 32 presets) |
| Gate / Shift + Gate | The selected track's next audio instrument / Audio page on and off |
| Pattern Settings / Shift + Pattern Settings | The selected track's next MIDI instrument / MIDI page on and off |
| Patterns | Jam (its light amber while jamming) |
| Octave ▼ ▲ / Shift + Octave ▼ ▲ | Keyboard octave / move the selected track's notes an octave (instrument and MIDI tracks) |
| Tempo/Swing: tap | Click on/off |
| Hold Tempo/Swing + turn the master filter knob | Tempo (with Shift held too: swing) |
| Macro knob above each track / with Shift | That track's volume / left-right position |
| Scales | Switch between track view and Note mode (and the play controls on screen) |
| FX / Shift + FX | The selected track's 8 FX pedals (knob: a pedal's mix; hold pad 1-3 + knob: its controls; bottom pad: footswitch; Shift + pad: one of 32 presets) / bypass them |
| 1-16/17-32 | Cycle the selected track's record quantise (its light: red off, amber 32nds, green 16ths) |
| Save / Shift + Save | Save the project / save as |
| Projects / Shift + Projects | Open a recent project (on screen) / new project |
| Master volume knob | Master volume |
| Master filter knob | Click level (hold Tempo: tempo; Shift too: swing) |

**Track view** (default):

| Pads | Looper |
| --- | --- |
| Row 1 | Mute each track (red = muted) |
| Row 2 | Solo each track (green = soloed; several can be soloed) |
| Rows 3–4 | 16-step view of the selected track: the bar the playhead is in, notes in the track colour |

**Note mode** on an instrument or MIDI track: all 32 pads are a two-octave keyboard with velocity. Rows 1–2 are
the upper octave and rows 3–4 the lower; in each pair, black keys are above white keys. On a drum
track: rows 1–2 stay mute and solo, rows 3–4 are the 16-pad kit, laid out as on screen. Track
buttons still select tracks.

**Swing** (50% straight to 75% full shuffle) delays each 8th note's second 16th as the loops
play, stretching everything in between, so it works on unquantised playing too. Audio clips and
the click aren't swung.

**Record quantise** is per track and starts off. Off keeps notes where you played them;
otherwise their starts snap to 32nds or 16ths. Notes keep the length you played, and you hear
them live exactly as played; the loop plays them on the grid from the next pass.


## Projects

**Save** (⌘S) the first time asks for a name, then saves straight away every time after, with a
brief "Saved" notice. **⇧ Save** (⇧⌘S) saves under a new name. **Open** (⌘O) lists recent
projects, newest first (↑ ↓ and Enter, or click). **⇧ Open** starts a new project. Opening or
starting a new project asks first if there are unsaved changes. The current project's name is in
the logo row, with • while there are unsaved changes (Save shows it too, and its light on the
Circuit is white).

Projects live in a folder on your computer, chosen the first time you save (Chrome asks for
permission to use it; choose "Allow on every visit", or it asks again after a reload). Each
project is a folder:

    My Song.zerkit/
      project.json      tempo, swing, tracks (instrument, octave, quantise, volume, pan, mute,
                        solo, loop, notes), audio instruments with their inputs, which instruments,
                        kits and audio instruments are switched off
      audio/*.wav       one 32-bit float WAV per recorded take or overdub layer

Saving from the Circuit works once the folder has been allowed in this session (a click on the
page is needed for that; a Circuit button doesn't count).

## Sampled instruments

A sampled instrument is recorded notes spread across the keyboard: each key plays the nearest
recording in its velocity layer, re-pitched, with a natural release. Samples load the first time
an instrument is used. Five come built in (see `instruments/README.md`).

Make your own on the Instruments page (Shift + Instrument): **＋ New instrument** opens the maker.

- **Sample a hardware instrument:** choose a MIDI instrument to play (e.g. your Moog) and an audio
  instrument to record it through, set the range and how it's sampled, and press **Sample** (Play
  on the Circuit). It plays each note, records it, trims it to its attack and tail, and matches
  levels across the instrument (keeping its dynamics). Stop at any time.
- **Or drop audio files** on the maker: each one's note comes from its name ("Piano_C4.wav",
  "Moog A#2").
- The eight settings are the Circuit's knobs 1-8: Low note, High note, Every (semitones), Layers
  (velocities 1-3), Note length, Tail, Release, Octave (the keyboard's starting octave). Click a
  sampled note to hear it, ✕ to remove it. **Save** (Record on the Circuit) names and keeps it.

Your instruments are kept in the projects folder, in `Instruments/` (`My Moog.zinst/instrument.json`
and `samples/*.wav`); ✎ on its card edits one.

## Kits

A kit is 16 samples on the 16 kit pads, played the same way on screen and on the Circuit, with
the same GM notes, so a drum part can move from kit to kit. (The old synthesised Drums is
retired: projects that used it open with the Acoustic kit.)

On the Kits page (Shift + Kits), **＋ New kit** opens the editor: drop audio files (WAV, AIFF,
MP3, M4A, FLAC) onto pads (several at once fill the empty pads after it), click a pad to hear it,
drag a pad onto another to swap them, ✕ to clear one, name it and **Save kit**. Click a kit to
edit it (saving under a new name makes a copy). Each kit's switch says whether **Kits** (tap)
cycles through it; the switches are saved with the project. Kits are also in the instrument menu.

Five kits come built in: **Rock, Pop, Jazz** (brushes), **Acoustic** and **Percussion**, made
from free CC0 sample libraries (see `kits/README.md`). Editing a built-in kit and saving it makes
your own copy.

Your own kits are kept in the projects folder, in `Kits/`, one folder each with its samples copied in
(`My Kit.zkit/kit.json` and `samples/`), so moving or deleting the original files doesn't matter.
A project refers to its kits by name.

## Audio tracks

An **audio instrument** is a named audio input: "CP88" = the CP88's USB audio. Make them on the
Audio page (Shift + Audio, the Circuit's Gate button): **＋ New audio**, a name and an input.
They're kept on this computer (inputs belong to the machine); projects remember each one's name
and input, so opening a project elsewhere makes the ones it needs. **Audio** (tap) cycles the
selected track through the ones switched on; choosing one connects the track to its input.

Arm with X: the take starts on the first sound
and closes on a bar line like any other, and plays back through the computer's audio output
with its own loop length, mute, solo, volume and undo. Recordings are shifted back by the
input's latency so they sit on the beat. Once a track holds audio the tempo is locked.
Overdubbing (X on a track with a loop) adds a layer, which undo can take off again.

## FX

Every track has a pedalboard of 8 pedals in a row, between its volume and its left-right
position, one per Circuit pad column:

| Column | Pedal | Controls (hold pad 1 / 2 / 3 of the column and turn its knob) |
| --- | --- | --- |
| 1 | Comp | Threshold, Ratio, Makeup |
| 2 | Drive | Drive, Tone, Level |
| 3 | Filter | Cutoff, Resonance, Sweep (a half-note wobble) |
| 4 | Chorus | Rate, Depth, Feedback |
| 5 | Phaser | Rate, Depth, Feedback |
| 6 | Tremolo | Rate (synced), Depth, Shape (sine or square) |
| 7 | Delay | Time (synced; ping-pong), Feedback, Tone |
| 8 | Reverb | Decay, Tone, Pre-delay |

**FX** (the Circuit's FX button) opens the selected track's. On the Circuit, a column's knob on its
own turns that pedal's **Mix**; hold pad 1, 2 or 3 of the column and turn it for that control;
the column's bottom pad is the **footswitch**. Pads show each pedal's colour when it's on (a
held pad white); knob lights show what each knob is turning. On screen each pedal is its Mix knob,
three controls and a footswitch.

**Presets:** hold **Shift** (on the Circuit, the Shift key, or on-screen Shift) and the pedals give way
to 32 presets in a 4 x 8 grid lying on the pads; press one (pad n = preset n) to load it. One row
per kind: Spaces (Dry, Room, Studio, Plate, Hall, Cathedral, Shimmer, Ambient), Echoes (Slapback,
16ths, 8ths, Dotted, Quarters, Dub, Tape Echo, Ping-pong), Colour (Glue, Punch, Warm, Crunch, Fuzz,
Lo-fi, Radio, Muffled), Movement (Chorus, Ensemble, Slow Phase, Fast Phase, Wobble, Tremolo,
Stutter, Swirl). The loaded one is white. Turning a pedal's control switches it on. **⇧ Bypass** switches the track's FX off
and on; a purple FX badge on the track shows when a pedal is on. A pedal's audio is only made the
first time it's switched on. Each track's FX is saved with the project.

## Synth tracks

**Synth** (the Circuit's Velocity button) makes the selected track a synth track and opens its
synth; on a synth track it opens and closes the Synth page. Every track has its own synth
settings, so eight synth tracks can sound completely different; they're saved with the project
(kept even while a track plays something else). It's made of Web Audio nodes, like the FX, laid
out left to right like a synth panel, one column per Circuit pad column:

| Column | Main knob | Controls (hold pad 1 / 2 / 3 of the column and turn its knob) |
| --- | --- | --- |
| 1 Saw | Level | Octave, Detune, Spread (a detuned stack: supersaw) |
| 2 Square | Level | Octave, Detune, Width (pulse width) |
| 3 Sine | Level | Octave, FM (bells, e-pianos), FM ratio |
| 4 Noise | Level | Colour, Decay (or Hold), Res |
| 5 Filter | Cutoff | Resonance, Type (LP 24, LP 12, BP, HP), Key track |
| 6 Filter env | Amount | Attack, Decay, Sustain (releases with the amp) |
| 7 Amp env | Attack | Decay, Sustain, Release (off: a plain gate) |
| 8 LFO | Depth | Rate (synced), Shape, To (pitch, filter or amp) |

The bottom pad (or the round switch on screen) switches a column on and off; turning one of its
controls switches it on. The header has the voice settings: **Poly / Mono / Legato** (legato
doesn't restart the envelopes for a note played while another is held; letting go goes back to a
key still down), **Glide**, **Velocity** (how much velocity sets loudness and the filter
envelope's depth) and **Volume**. Turning a control changes notes already sounding.

**Presets:** hold **Shift** for 32 presets in a 4 x 8 grid lying on the pads, a row each:
Leads (Classic, Supersaw, Square Lead, Brass, Whistle, Screamer, Chip, Fat Lead), Bass (Sub Bass,
Saw Bass, Acid, Reese, Pulse Bass, Wobble, FM Bass, Fat Bass), Pads (Warm Pad, Dream Pad, Strings,
Organ, Choir, Glass Pad, Dark Pad, Sweep) and Plucks (Pluck, E-Piano, Bell, Marimba, Harp, Clav,
Kalimba, Stab). New synth tracks start on Classic.

## MIDI tracks

A **MIDI instrument** is an external instrument played over MIDI: a name, an **output** (a MIDI
port and channel) and optionally an **input** (the keyboard that plays it; any keyboard if not
set). Make them on the MIDI page (Shift + MIDI, the Circuit's Pattern Settings button). A MIDI track records
notes like any other and sends them, live and looped, to its output, timed to line up with the
browser's audio; mute and solo apply, and the track's volume scales velocity. If the same
instrument is both input and output, turn its Local Control off so it doesn't sound twice. Like
audio instruments they're kept on this computer and projects remember their settings.

## Code layout

- `src/engine.js`: transport, record state machine and lookahead scheduler. It's pure logic
  that talks to an `out` interface, so it can be swapped for MIDI output later.
- `src/audio.js`: Web Audio implementation of `out`. It routes each track to its instrument and plays the click.
- `src/instruments.js`: the instrument registry and the kit pad layout; `src/audioinst.js` /
  `src/midiinst.js`: audio and MIDI instruments and their pages; `src/cards.js`: the square
  cards every page uses; `src/fx.js` / `src/fxpage.js`: the per-track pedals, and the FX page; `src/synth.js` /
  `src/synthpage.js`: the per-track synth, and the Synth page.
- `src/projects.js`: the projects folder and the project files; `src/session.js`: the current
  project (saving, opening, new) and its screens.
- `src/kits.js`: sample kits (storage, and each kit as an instrument); `src/kitpage.js`: the Kits
  page and kit editor.
- `kits/`: the built-in kits; `tools/build_kits.py` builds them. `instruments/`: the built-in
  sampled instruments; `tools/build_instruments.py` builds them.
- `src/sampler.js`: sampled instruments (zones, playback, storage); `src/instpage.js`: the
  Instruments page and the instrument maker.
- `src/roll.js`: canvas piano roll (one per track).
- `src/keys.js`: computer-keyboard note mapping.
- `src/audioin.js`, `src/capture-worklet.js`: audio inputs, captured continuously so takes can be cut out of them.
- `src/main.js`: wiring, shortcuts and the render loop.
