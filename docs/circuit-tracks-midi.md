# Novation Circuit Tracks: what it sends over MIDI

Mapped on 2026-11-24 with the Circuit plugged into a Mac over USB-C, using a MIDI monitor page (now Settings › Monitor),
with the Circuit on its default settings.

The port shows up as **"Circuit Tracks MIDI"** (manufacturer "Focusrite A.E"), both input and output.

## Channels

| Circuit track | MIDI channel |
| --- | --- |
| Synth 1 | 1 |
| Synth 2 | 2 |
| MIDI 1 | 3 |
| MIDI 2 | 4 |
| Drums 1–4 | 10 |
| Project-wide (master filter) | 16 |

## Controls

| Control | Sends |
| --- | --- |
| Pads, **bottom two rows** (note view) | Note on/off on the selected track's channel, velocity-sensitive |
| Pads, top two rows | Nothing. These are the 16 sequencer steps |
| Synth tracks: bottom-row keyboard | Scale layout (C minor by default), one octave per row. The bottom row starts at C2 and the upper row at C3 |
| Drum tracks: bottom-row pads | That drum's fixed note at varying velocity: Drum 1 = 60, Drum 2 = 62, Drum 3 = 64, Drum 4 = 65 |
| Macro knobs 1–8 (synth tracks) | CC 80–87, absolute 0–127, on the track's channel |
| Macro knob 1 (MIDI tracks) | CC 1 (MIDI-track macros are user-assignable CCs) |
| Master filter knob | CC 74 on channel 16 |
| Master volume knob | Nothing |
| Play | Start (`FA`), then Stop (`FC`) on the next press |
| Track select and all other buttons | Nothing |

## Notes

- Selecting a track on the Circuit doesn't send anything itself. It changes which channel the pads and knobs send on.
- While playing, the Circuit's own sequencer output is sent as notes too. If the Circuit is used
  to play into the looper, its patterns should be empty, or the looper will record them.
- Clock wasn't checked. The monitor counts clock ticks on screen but doesn't log them.
