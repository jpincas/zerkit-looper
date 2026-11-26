# Yamaha CP88: MIDI map for the looper

> **Retired approach.** The looper no longer controls the CP88 over MIDI. Per-section looping
> by MIDI (below) worked in tests but was unreliable in real playing, so the CP88 is now looped
> as audio, with an ordinary audio track (any input). This page is kept as a record of what the
> CP88 does over MIDI and what was tried. The code and the monitor test buttons were removed.

Sources: the CP88/CP73 Owner's Manual (menu list, settings list, data list), plus tests on Jon's
CP88 over USB on 2026-11-24.

## Connection

- USB shows two ports, **"CP88/CP73 Port 1"** and **"Port 2"**. **Port 1 is the sound engine and
  the keyboard.** Port 2 only passes MIDI through to and from the 5-pin MIDI jacks.
- It doesn't answer the universal identity request (`F0 7E 7F 06 01 F7`). Tested: no reply.
- It is also a USB **audio** interface: stereo, 44.1 kHz, in both directions. Its USB audio out
  carries the same signal as its main outputs.

## What it sends (tested, default settings)

- Port 1, **channel 1** (menu: General → MIDI Settings → MIDI Channel → **Tx**, 1–16 or Off).
- Note-on with velocity, and real note-off with release velocity 64.
- **Sustain = CC 64, continuous (half-damper)**: 0–127 in small steps, with the default
  "FC3A (HalfOn)" pedal type.
- Panel knobs and switches send nothing until **MIDI Control** (General → MIDI Settings) is set to On.

## What it receives

- **One receive channel** for the whole instrument (General → MIDI Settings → MIDI Channel → **Rx**,
  1–16 or All, default 1). Every section that is switched on plays every incoming note: the
  CP88 is not multitimbral. Tested: channel 1 played every section; other channels were silent.
- A section switched **off** is silent for incoming MIDI too. It isn't just disconnected from the keys.
- **Local Control** (General → Local Control): Off = the keys only send MIDI, and the sound engine
  still plays what it receives. This is the standard looper setup.

## Remote control of the panel (needs MIDI Control = On)

Values for switches: 0–63 = off, 64–127 = on. Knobs use 0–127.

| | Piano | E.Piano | Sub |
| --- | --- | --- | --- |
| Section on/off | CC 102 | CC 106 | CC 111 |
| Volume | CC 13 | CC 19 | CC 30 |
| Tone | CC 14 | CC 20 | CC 31 |
| Voice select | CC 12 | CC 18 | CC 29 |
| Split (L/R) | CC 103 | CC 107 | CC 112 |
| Octave | CC 104 | CC 108 | CC 113 |
| Delay / Reverb send | CC 77 / 81 | CC 78 / 82 | CC 79 / 83 |

Global: master volume CC 7, expression CC 11, modulation CC 1, delay on/off CC 115, reverb
on/off CC 117, all-delay depth CC 93, all-reverb depth CC 91. Pedals: sustain CC 64, sostenuto
CC 66, soft CC 67. Live Set Sounds change with program change / bank select (if enabled).

## Master Keyboard

Up to 4 zones, each with its own transmit channel, key range, octave and transpose, sending
to **external** instruments. It doesn't change how the CP88's own sections receive.

## Per-section looping (firmware 2.00, tested 2026-11-24)

Firmware 2.00 adds **Section SW Mode** ([MENU] → Control Panel → Advanced Settings). With it set
to **Next-Key** and **MIDI Control = On**, switching a section on or off by CC only affects
notes that start afterwards. Notes already sounding keep the section they started on. That
holds for notes received over MIDI too: in a routing test, three chords sent
after switching to Piano, E.Piano and Sub in turn were held together and sounded as three
different sounds, layered.

How the looper uses it (`src/cp88.js`):

- The instruments **CP88 Piano**, **CP88 E.Piano** and **CP88 Sub** each play one section.
- Every note-on goes out in one message with the section CCs (102 / 106 / 111) in front of it:
  that section on, the others off.
- Between notes, the CP88 rests on the **selected track's** section. A loop note on another
  section switches over, starts, and switches straight back in the same message, so the panel
  follows the track being played and its sound can be changed while loops run.
- The CP88's keys play the looper's selected track. Set **Local Control Off** so they don't also
  play the CP88 directly; the looper passes notes back on the right section, and pedals and
  wheels straight through.
- A CP88 track's volume knob sends that section's volume CC (13 / 19 / 30).
- Pedals (sustain 64 with its half-damper values, sostenuto 66, soft 67) are recorded with the
  notes and replayed on the track's own section (see below). A pedal already down when a
  take starts is recorded at its first beat. Stopping or undoing sends every pedal up, on
  every section. The sequencer shows the sustain pedal as a strip under the bar numbers.

Known limits:

- Everything is on one MIDI channel. A note-off only names the key, so a note-off on one
  section could end the same key held on another. It hasn't been a problem in practice so far.

## Per-section pedals (tested 2026-11-24)

On its own, a pedal is per channel: a Piano loop's sustain also held E.Piano notes. But each
section has **Receive Sustain / Sostenuto / Soft** switches ([SETTINGS] → Receive SW), which can
be set remotely by Yamaha parameter change:

    F0 43 10 7F 1C 08 50 0p <12 sustain | 13 sostenuto | 14 soft> <00 off | 01 on> F7     (p: 0 Piano, 1 E.Piano, 2 Sub)

Tested with the monitor's "per-section sustain test": with Receive Sustain on for Piano only,
pedal down, a Piano chord rang on after release and an E.Piano chord stopped. So the looper
sends each pedal movement as: that track's section on, only that section receiving that pedal,
the pedal, every section receiving again, back to the resting section. The CP88 is left with
every receive switch on, as it was.
