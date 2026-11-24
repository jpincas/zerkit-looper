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
| `1`–`4` | Select track. The keyboard plays and records into the selected track |
| `Space` | Play / stop |
| `X` | Record: arm, then close the loop, then toggle overdub |
| `C` | Metronome click on/off |
| `↑` / `↓` | Tempo ±1 BPM (hold Shift for ±5) |
| `Z` | Undo the last recording on any track (the current take, or the latest overdub pass) |
| `Backspace` | Clear the selected track (`Shift+Backspace` clears everything) |

## Tracks

There are four tracks. Each lane has a dropdown to pick its instrument: Synth, Bass, Pluck,
Pad, Keys (FM electric piano), Organ, Bell or Drums. All of them are synthesised in the browser.
Each track remembers its own keyboard octave.

All tracks share one loop length, which the first take on any track sets. After that,
X on a track overdubs into it at that length. When every track is empty, the loop length goes too.

The drum rack follows the General MIDI layout: C kick, C# rim, D snare, D# clap, E snare 2,
F/G/A/B toms, F# closed hat, G# pedal hat, A# open hat. Every octave maps onto the same 12 pads.

## How looping works

1. Press **X** to arm. Nothing advances until you play: the playhead circles bar 1.
   - Your first note starts the take at the top of the bar it falls in. A note up to a 16th
     early is pulled onto the next downbeat instead.
   - If the transport is stopped, the first note also starts it, on beat 1.
2. Keep playing. The take is open-ended, so there's no loop length to set in advance.
3. Press **X** again. Recording carries on to the **end of the current bar**. Then the loop
   closes and playback continues from its start.
4. With a loop playing, **X** toggles overdub, which records into the loop at its fixed length.

Stopping during a take keeps it. The loop closes at the end of the current bar.

## Code layout

- `src/engine.js`: transport, record state machine and lookahead scheduler. It's pure logic
  that talks to an `out` interface, so it can be swapped for MIDI output later.
- `src/audio.js`: Web Audio implementation of `out`. It routes each track to its instrument and plays the click.
- `src/instruments.js`: the synth voice and the drum rack.
- `src/roll.js`: canvas piano roll (one per track).
- `src/keys.js`: computer-keyboard note mapping.
- `src/main.js`: wiring, shortcuts and the render loop.
