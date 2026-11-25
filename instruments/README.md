# Built-in sampled instruments

Built by `tools/build_instruments.py` from free sample libraries released under **CC0 1.0**
(public domain). Thanks to their authors:

| Instrument | Made from | Notes |
| --- | --- | --- |
| Grand Piano | [Osiris Piano](https://github.com/sfzinstruments/Osiris_Piano), Versilian Studios & Karoryfer Samples | every 4 semitones, A0-C8, 2 velocity layers |
| Upright Bass | [Meatbass](https://github.com/sfzinstruments/karoryfer.meatbass), Karoryfer Samples (pizzicato) | every 4 semitones, 1 layer |
| Cello | [Cello](https://github.com/sfzinstruments/karoryfer-bigcat.cello), Karoryfer Samples & Bigcat (sustained bow) | every 4 semitones, 1 layer |
| Vibraphone | [VCSL](https://github.com/sgossner/VCSL) vibraphone, hard mallets | every 3 semitones, F3-E6, 2 layers |
| Harp | VCSL concert harp | every 3 semitones, 2 layers |

Each note's root comes from the library's SFZ map, or from its file name checked against the
measured pitch. Samples are trimmed (up to 5 s; 2.5 s for the bass), faded, and the whole
instrument is scaled to peak at -1 dBFS (so its dynamics stay), as 16-bit FLAC.

Rebuild with `python3 tools/build_instruments.py [cache-dir]` (needs ffmpeg).
