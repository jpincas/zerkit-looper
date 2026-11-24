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
The row across the top shows each track's instrument, loop length and activity. Click one, press
`1`–`8`, or press its Circuit button to select it. The sequencer below shows the selected track on
the shared timeline (the longest loop), with repeats of shorter loops drawn faded.

Instruments: Synth, Bass, Pluck, Pad, Keys (FM electric piano), Organ, Bell and Drums, all
synthesised in the browser. Each track remembers its own keyboard octave.

The drum rack follows the General MIDI layout: C kick, C# rim, D snare, D# clap, E snare 2,
F/G/A/B toms, F# closed hat, G# pedal hat, A# open hat. Every octave maps onto the same 12 pads.

## Novation Circuit Tracks

With the patched firmware (see `docs/circuit-protocol.md`), the Circuit drives the looper:

| Circuit | Looper |
| --- | --- |
| Play / Record | Play-stop / record (arm, close, overdub) |
| Clear / Shift + Clear | Undo the last recording / clear the selected track |
| Track buttons (Synth 1 … Drum 4) | Select tracks 1–8 |
| Preset (Shift reverses) | Change the selected track's instrument |
| Octave ▼ ▲ | Keyboard octave |
| Tempo/Swing: tap / hold + turn macro knob 1 | Click on/off / tempo |
| Macro knob above each track | That track's volume |
| Note | Switch between track view and Note mode |
| Hold 1-16/17-32 + track button | Cycle that track's record quantise (lights show it while held: red off, amber 32nds, green 16ths) |

**Track view** (default):

| Pads | Looper |
| --- | --- |
| Row 1 | Mute each track (red = muted) |
| Row 2 | Solo each track (green = soloed; several can be soloed) |
| Rows 3–4 | 16-step view of the selected track: the bar the playhead is in, notes in the track colour |

**Note mode:** all 32 pads are a two-octave keyboard with velocity. Rows 1–2 are the upper octave
and rows 3–4 the lower; in each pair, black keys are above white keys. Track buttons still
select tracks.

**Record quantise** is per track and starts off. Off keeps notes where you played them;
otherwise their starts snap to 32nds or 16ths. Notes keep the length you played, and you hear
them live exactly as played; the loop plays them on the grid from the next pass.

On screen, each track button has a quantise chip (Q red = off, 32 amber, 16 green; click to change), M and S toggles, and a volume bar along its bottom edge
(scroll over the button to change it).

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
- `src/roll.js`: canvas piano roll (one per track).
- `src/keys.js`: computer-keyboard note mapping.
- `src/audioin.js`, `src/capture-worklet.js`: audio inputs, captured continuously so takes can be cut out of them.
- `src/main.js`: wiring, shortcuts and the render loop.
