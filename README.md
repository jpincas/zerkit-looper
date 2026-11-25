# MIDI Looper (web prototype)

A minimal looper that uses the computer keyboard as input and a built-in Web Audio synth as output.
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
| `Space` | Play / stop |
| `X` | Record: arm, then close the loop, then toggle overdub |
| `C` | Metronome click on/off |
| `↑` / `↓` | Tempo ±1 BPM (hold Shift for ±5) |
| `Z` | Undo the last recording (the latest take or overdub pass, on its own track) |
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

- **Knobs:** Master volume (everything the looper plays) on the left, a volume knob above each
  track (with Shift: its left-right position, shown on the strip under it), and Internal sounds on the right. The Circuit's master volume and master filter knobs
  turn the two outer ones. Drag up/down or scroll to turn; double-click resets.
- **Row above the tracks:** Scales | Octave ▼ ▲ (Shift: move the selected track's notes an octave), Q (cycles the selected track's record
  quantise; each track button shows its own: Q off, Q 32, Q 16), Tempo (tap: click; hold + filter knob or scroll: tempo;
  Shift: swing; shows tempo · swing), Undo (Shift: clear the track), Duplicate, Save (Shift: save as), Open (Shift:
  new project) | Shift (holds for the next press).
- **Track row:** Preset (tap: the selected track's next preset, of those switched on; Shift: the
  Presets page) | the eight track buttons | Kits (Shift: the Kits page). Each track button shows its instrument, loop length and activity. Click one,
  press `1`–`8`, or press its Circuit button to select it.
- **Pages:** the pad area shows the Looper, or another page. Shift + Preset opens **Presets**:
  every preset with a switch for whether Preset cycles through it (and which tracks use it).
  Shift + Kits (the Circuit's Patterns button) opens **Kits** (see below). The same again goes back.
- **Pads:** a mute strip and a solo strip, one pad under each track, sharing the first pad row.
  Below them, filling the other three rows, the selected track's sequencer on the shared timeline (the longest loop), with repeats of shorter loops drawn faded.
- **Beside the pads:** Note, Velocity, Gate, Pattern Settings on the left; Mixer, FX, Record,
  Play on the right.

Each button shows its actions top to bottom: what Shift does (small grey, marked ⇧), what holding
it does (small blue, marked with a clock), what a tap does (the main label), then any readout. While Shift is held (the Shift
key, the Circuit's Shift, or the on-screen Shift) the buttons with a Shift action light up; while
Tempo is held on the Circuit, its hold action lights up. Greyed-out buttons aren't used yet.

**Show / Hide** (the Circuit's Note button, on screen) opens a playing panel under the looper: a two-octave keyboard on synth tracks, or the
16-pad kit on drum tracks (pads 1–8 along the bottom, under the eight tracks; 9–16 above). The
computer keyboard plays the first octave, or the first 12 pads.

Instruments: Synth, Bass, Pluck, Pad, Keys (FM electric piano), Organ, Bell and Drums, all
synthesised in the browser. Each track remembers its own keyboard octave.

The drum kit has 16 pads, in playing order: Kick, Snare, Clap, Rim, Closed hat, Pedal hat, Open
hat, Snare 2 along the bottom; four toms, Crash, Ride, Tambourine, Cowbell above. Each plays its
General MIDI note, so a part played in from a MIDI drum kit lands on the right sounds; other notes
fold onto the GM octave from C1.

## Novation Circuit Tracks

With the patched firmware (see `docs/circuit-protocol.md`), the Circuit drives the looper:

| Circuit | Looper |
| --- | --- |
| Play / Record | Play-stop / record (arm, close, overdub) |
| Clear / Shift + Clear | Undo the last recording / clear the selected track |
| Track buttons (Synth 1 … Drum 4) | Select tracks 1–8 |
| Preset / Shift + Preset | The selected track's next preset (of those switched on) / Presets page on and off |
| Patterns / Shift + Patterns | The selected track's next kit (of those switched on) / Kits page on and off |
| Octave ▼ ▲ / Shift + Octave ▼ ▲ | Keyboard octave / move the selected track's notes an octave (synth tracks) |
| Tempo/Swing: tap | Click on/off |
| Hold Tempo/Swing + turn the master filter knob | Tempo (with Shift held too: swing) |
| Macro knob above each track / with Shift | That track's volume / left-right position |
| Note | Switch between track view and Note mode |
| 1-16/17-32 | Cycle the selected track's record quantise (its light: red off, amber 32nds, green 16ths) |
| Save / Shift + Save | Save the project / save as |
| Projects / Shift + Projects | Open a recent project (on screen) / new project |
| Master volume knob | Master volume |
| Master filter knob | Internal sounds level |

**Track view** (default):

| Pads | Looper |
| --- | --- |
| Row 1 | Mute each track (red = muted) |
| Row 2 | Solo each track (green = soloed; several can be soloed) |
| Rows 3–4 | 16-step view of the selected track: the bar the playhead is in, notes in the track colour |

**Note mode** on a synth track: all 32 pads are a two-octave keyboard with velocity. Rows 1–2 are
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
the status strip, with • while there are unsaved changes (Save shows it too, and its light on the
Circuit is white).

Projects live in a folder on your computer, chosen the first time you save (Chrome asks for
permission to use it; choose "Allow on every visit", or it asks again after a reload). Each
project is a folder:

    My Song.zerkit/
      project.json      tempo, swing, tracks (instrument, octave, quantise, volume, pan, mute,
                        solo, loop, notes), audio inputs by name, the Presets switches
      audio/*.wav       one 32-bit float WAV per recorded take or overdub layer

Saving from the Circuit works once the folder has been allowed in this session (a click on the
page is needed for that; a Circuit button doesn't count).

## Kits

A kit is 16 samples on the 16 kit pads. It plays exactly like the built-in Drums (same pads, on
screen and on the Circuit, same GM notes), so a drum part can move from kit to kit.

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

Choose **Audio** as a track's instrument, then pick any of the computer's audio inputs (an
instrument's USB audio, an interface, a mic). Arm with X: the take starts on the first sound
and closes on a bar line like any other, and plays back through the computer's audio output
with its own loop length, mute, solo, volume and undo. Recordings are shifted back by the
input's latency so they sit on the beat. Once a track holds audio the tempo is locked.
Overdubbing on audio tracks isn't there yet.

## Code layout

- `src/engine.js`: transport, record state machine and lookahead scheduler. It's pure logic
  that talks to an `out` interface, so it can be swapped for MIDI output later.
- `src/audio.js`: Web Audio implementation of `out`. It routes each track to its instrument and plays the click.
- `src/instruments.js`: the synth voice and the drum rack.
- `src/projects.js`: the projects folder and the project files; `src/session.js`: the current
  project (saving, opening, new) and its screens.
- `src/kits.js`: sample kits (storage, and each kit as an instrument); `src/kitpage.js`: the Kits
  page and kit editor.
- `kits/`: the built-in kits; `tools/build_kits.py` builds them.
- `src/roll.js`: canvas piano roll (one per track).
- `src/keys.js`: computer-keyboard note mapping.
- `src/audioin.js`, `src/capture-worklet.js`: audio inputs, captured continuously so takes can be cut out of them.
- `src/main.js`: wiring, shortcuts and the render loop.
