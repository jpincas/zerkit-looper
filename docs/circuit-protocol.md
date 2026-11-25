# Circuit Tracks control-surface protocol (LOOP04 / LOOP05 / LOOP06 firmware)

The patched firmware turns the Novation Circuit Tracks into a dedicated USB controller for the
looper. The Circuit's own sequencer, sounds and screens are switched off. Every input goes to the
app, and the app sets every light.

It travels as USB-MIDI because that's what the device's USB connection speaks. It is not musical
MIDI. The app treats the "Circuit Tracks MIDI" port as a control surface, separate from real
MIDI instruments.

## Circuit → app (all on channel 15)

| Input | Message | Notes |
| --- | --- | --- |
| Button press / release | `BE (20+id) 7F` / `BE (20+id) 00` | id 0–27, see the table below |
| Pad press | `9E pad velocity` | pad 0–31, velocity-sensitive |
| Pad release | `8E pad 00` | |
| Macro knob 1–8 | `BE (1..8) value` | **relative**: 7-bit two's complement, so 1 = +1 and 127 = −1 |
| Master filter / Master volume | `BE 9 value` / `BE 10 value` | volume (CC 10) reports an **absolute** position; the filter (CC 9) is assumed to as well |
| Health report | `BE 64 gate` | after every message; bit 2 = stock MIDI gate closed. Ignore it in the app |

Button ids (from CIRCUIT-HACKS-RC, confirmed on hardware for Record, Play, Synth 1/2, MIDI 1/2,
Drum 1, Mixer and FX):

| id | button | id | button | id | button | id | button |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 0 | Synth 1 | 7 | Drum 4 | 14 | Mixer | 21 | 1-16/17-32 |
| 1 | Synth 2 | 8 | Preset | 15 | FX | 22 | Tempo/Swing |
| 2 | MIDI 1 | 9 | Note | 16 | Record | 23 | Clear |
| 3 | MIDI 2 | 10 | Velocity | 17 | Play | 24 | Duplicate |
| 4 | Drum 1 | 11 | Gate | 18 | Scales | 25 | Save |
| 5 | Drum 2 | 12 | Pattern Settings | 19 | Octave down | 26 | Projects |
| 6 | Drum 3 | 13 | Patterns | 20 | Octave up | 27 | Shift |

## App → Circuit: lights (SysEx, manufacturer 7D = non-commercial)

| Command | Message |
| --- | --- |
| Set one light | `F0 7D 01 <led> <colour> F7` |
| Set a run of lights | `F0 7D 02 <first led> <colour> <colour> … F7` (stops at LED 68; a whole panel is 74 bytes) |
| Knob brightness (LOOP05/06) | `F0 7D 03 <first led> <brightness> … F7`, for LEDs 60–68 only (others skipped). 127 = full colour; 0–126 scale it from 10% to 98% |

LED numbers: pads 0–31 (same numbering as pad presses), buttons `32 + id`, macro knobs 60–67,
master filter 68. Some button LEDs are single-colour (white), so any non-zero code just lights them.

Colours are Novation palette codes 0–127, for example 0 off, 0x01 white, 0x09 blue,
0x13 light blue, 0x17 green, 0x2D yellow, 0x32 magenta, 0x45 orange, 0x53 red, 0x54 dim red.
Some codes are animated (flash or pulse) by the firmware. Use Palette mode in `lights.html` to
see every code on the device.

Knob brightness uses the stock firmware's own scaler (0x080475a6), which it normally uses
to show parameter values on the knobs. Brightness starts at 127 (full) for every knob. LOOP04
ignores command 03.

All lights are off at power-on. The firmware keeps the last frame the app sent.

LOOP06 adds a splash screen: from power-on, "LOOP" scrolls across the pads (red, orange,
yellow, green letters, one column every 110 ms on the stock 1 ms tick at 0x20006a28) until
the first `F0 7D` message arrives. That message clears the pads and ends the splash, so a
Circuit showing LOOP is running and waiting for the app.

## Building, flashing and recovery

- `circuit/build_lights.py` builds LOOP04 (LOOP05 with `--bright`, LOOP06 with `--splash`) from Novation's official 1.2.1 file, which `circuit/fw.py`
  checks by SHA-256. `circuit/test_*.py` run the patched code in an ARM emulator.
- `flash.html` sends allow-listed builds to the Circuit in recovery mode. Recovery mode is
  **Scales + Preset + Note** held at power-on, and it also restores the official firmware.
- The patch technique and firmware addresses come from the community project
  [CIRCUIT-HACKS-RC](https://github.com/Ghillermo/CIRCUIT-HACKS-RC) (MIT).
- Known issue: LOOP02, which sent through the stock gated sender, once had the stock MIDI gate
  close and stay closed. The cause wasn't found. LOOP03D/04 send around the gate, and lights come
  in by SysEx, which the gate doesn't affect.
