# Built-in kits

Five 16-pad kits that ship with Zerkit Looper, built by `tools/build_kits.py` from free sample
libraries, all released under **CC0 1.0** (public domain): no royalties, no credit required.
Thanks to their authors anyway:

| Kit | Made from |
| --- | --- |
| Rock | [Big Rusty Drums](https://github.com/sfzinstruments/karoryfer.big-rusty-drums) by Karoryfer Samples (a big 1980s kit; close and overhead mics blended). Clap, tambourine and cowbell from VCSL. |
| Pop | [Virtuosity Drums](https://github.com/sfzinstruments/virtuosity_drums) by Versilian Studios, close mics (tight). Clap and tambourine from VCSL. |
| Jazz | [Swirly Drums](https://github.com/sfzinstruments/karoryfer.swirly-drums) by Karoryfer Samples, played with brushes (dry and room blended). |
| Acoustic | Virtuosity Drums, mid, overhead and room mics (natural). |
| Percussion | Virtuosity Drums percussion, plus cajón, darbuka, tambourine and guiro from VCSL. |

VCSL is the [Versilian Community Sample Library](https://github.com/sgossner/VCSL).

Pads keep the General MIDI roles (1 kick, 2 snare, 3 clap, 4 rim, 5-7 hats, 8 snare 2, 9-12 toms
low to high, 13 crash, 14 ride, 15-16 tambourine and cowbell) where a kit has them, so a drum
part moves between kits. Each sample is one strong hit, trimmed, faded and normalised to -1 dBFS,
as 16-bit FLAC.

Rebuild with `python3 tools/build_kits.py [cache-dir]` (needs ffmpeg; downloads about 30 MB).
