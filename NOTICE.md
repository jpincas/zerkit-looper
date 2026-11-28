# Notices and credits

## Samples (CC0 1.0)

The built-in kits (`kits/`) and sampled instruments (`instruments/`) are trimmed, faded and
normalised from these libraries, all released under
[CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) (public domain). No credit is
required, but they deserve it:

| Library | Author | Used for |
| --- | --- | --- |
| [Big Rusty Drums](https://github.com/sfzinstruments/karoryfer.big-rusty-drums) | Karoryfer Samples | Rock kit |
| [Swirly Drums](https://github.com/sfzinstruments/karoryfer.swirly-drums) | Karoryfer Samples | Jazz kit |
| [Virtuosity Drums](https://github.com/sfzinstruments/virtuosity_drums) | Versilian Studios | Pop, Acoustic and Percussion kits |
| [VCSL](https://github.com/sgossner/VCSL) (Versilian Community Sample Library) | Versilian Studios | Vibraphone, Harp, and extra percussion in several kits |
| [Osiris Piano](https://github.com/sfzinstruments/Osiris_Piano) | Versilian Studios & Karoryfer Samples | Grand Piano |
| [Meatbass](https://github.com/sfzinstruments/karoryfer.meatbass) | Karoryfer Samples | Upright Bass |
| [Cello](https://github.com/sfzinstruments/karoryfer-bigcat.cello) | Karoryfer Samples & Bigcat | Cello |

`tools/build_kits.py` and `tools/build_instruments.py` rebuild them from the original repositories.

The electronic kits (House, Techno, Dubstep, DnB) use no samples: `tools/synth_kits.py` synthesises
every sound, so they're this project's own work under its MIT licence. Its reverb follows
Jezar's public-domain Freeverb design.

## Grooves (CC BY 4.0)

24 of the grooves (`src/grooves-data.js`: the first three rows) are excerpts of performances from
the **Groove MIDI Dataset** by Jon Gillick, Adam Roberts, Jesse Engel, Douglas Eck and David
Bamman (Google Magenta), released under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/):
<https://magenta.tensorflow.org/datasets/groove>. They're changed: two bars and one fill bar
taken from each performance, moved onto the bar, their drums mapped onto the kit pads and,
where swung, written straight for the looper's Swing to play. `tools/build_grooves.py` does it.

> Jon Gillick, Adam Roberts, Jesse Engel, Douglas Eck, and David Bamman. "Learning to Groove with
> Inverse Sequence Transformations." International Conference on Machine Learning (ICML), 2019.

The electronic grooves (the fourth row) are programmed in that script: this
project's own work.

## Circuit Tracks firmware research

The firmware update format, the input handlers' addresses, the button ids and the free RAM region
used by the patch builders in `circuit/` were documented by
[CIRCUIT-HACKS-RC](https://github.com/Ghillermo/CIRCUIT-HACKS-RC) by Ghillermo (MIT). The code
here is a re-implementation, not a copy. Thank you.

## Trademarks

Novation, Circuit Tracks and Components are trademarks of Focusrite Audio Engineering Ltd.
CP88 is a trademark of Yamaha Corporation. Zerkit Looper is an independent project, not
affiliated with or endorsed by either company. Product names are used only to say what the
looper works with.
