# Built-in kits

Nine 16-pad kits ship with Zerkit Looper.

## Sampled

Five are built by `tools/build_kits.py` from free sample libraries, all released under
**CC0 1.0** (public domain): no royalties, no credit required. Thanks to their authors anyway:

| Kit | Made from |
| --- | --- |
| Rock | [Big Rusty Drums](https://github.com/sfzinstruments/karoryfer.big-rusty-drums) by Karoryfer Samples (a big 1980s kit; close and overhead mics blended). Clap, tambourine and cowbell from VCSL. |
| Pop | [Virtuosity Drums](https://github.com/sfzinstruments/virtuosity_drums) by Versilian Studios, close mics (tight). Clap and tambourine from VCSL. |
| Jazz | [Swirly Drums](https://github.com/sfzinstruments/karoryfer.swirly-drums) by Karoryfer Samples, played with brushes (dry and room blended), its hats and cymbals set below the drums (`LEVEL` in `tools/build_kits.py`). |
| Acoustic | Virtuosity Drums, mid, overhead and room mics (natural). |
| Percussion | Virtuosity Drums percussion, plus cajón, darbuka, tambourine and guiro from VCSL. |

VCSL is the [Versilian Community Sample Library](https://github.com/sgossner/VCSL).

Pads keep the General MIDI roles (1 kick, 2 snare, 3 clap, 4 rim, 5-7 hats, 8 snare 2, 9-12 toms
low to high, 13 crash, 14 ride, 15-16 tambourine and cowbell) where a kit has them, so a drum
part moves between kits. Each sample is one strong hit, trimmed, faded and normalised to -1 dBFS,
as 16-bit FLAC.

Rebuild with `python3 tools/build_kits.py [cache-dir]` (needs ffmpeg; downloads about 30 MB).

## Synthesised

Four are synthesised from scratch by `tools/synth_kits.py`, from oscillators, seeded noise,
filters and a Freeverb-style reverb, the way the drum machines behind these genres make their
sounds. No samples are used, so they're this project's own work (MIT), and they rebuild byte for
byte with `python3 tools/synth_kits.py` (pure Python plus ffmpeg).

| Kit | Character |
| --- | --- |
| House | 909-style: round kick, tuned snare, airy hats, claps with a little room, conga, cowbell |
| Techno | Driven kick, metallic hats, noise snare, FM perc, rumble |
| Dubstep | Deep kick, huge reverb snare, snap, sub (F1), sub drop, zap, reverse crash |
| DnB | Short tight kick, ringing snare, ghost and crunch snares, crisp hats, sub (E1), reverse crash |

Pads keep the same roles as the sampled kits (pads 9-12 hold subs and FX where a genre has no
use for four toms).
