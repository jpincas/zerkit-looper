#!/usr/bin/env python3
"""Build src/grooves-data.js: the 16 grooves Shift shows on the Kits page, each with a fill.

Three rows come from Magenta's Groove MIDI Dataset (real drummers on an electronic kit, to a
click; CC BY 4.0, https://magenta.tensorflow.org/datasets/groove). From each long
performance we take:

  - the groove: the most typical 2 bars (the medoid of all its 2-bar windows), so a fill or a
    crash doesn't end up in the loop;
  - the fill: the bar the drummer played just before a crash, the one most unlike the groove,
    plus the crash it lands on.

The timing is the drummer's own, moved so they sit on the beat on average. Where they swing
16ths, the notes are written straight and the groove sets the looper's Swing to match, so
turning Swing still works. Eighth-note swing (jazz, shuffles) stays in the notes, Swing 50.

The electronic row is programmed here (a drum machine plays to the grid anyway).

    python3 -m venv /tmp/gv && /tmp/gv/bin/pip install mido
    curl -LO https://storage.googleapis.com/magentadata/datasets/groove/groove-v1.0.0-midionly.zip
    unzip groove-v1.0.0-midionly.zip
    /tmp/gv/bin/python tools/build_grooves.py groove/          # --show prints the grids
"""
import json, statistics, sys
from pathlib import Path

import mido

BPB = 4
OUT = Path(__file__).resolve().parent.parent / 'src' / 'grooves-data.js'

# The drummers' kit (Roland TD-11) onto our pads' General MIDI notes.
MAP = {
    36: 36,                                  # kick
    38: 38, 40: 40, 37: 37,                  # snare, rimshot (pad 8), cross-stick
    42: 42, 22: 42, 46: 46, 26: 46, 44: 44,  # hi-hat closed (bow, edge), open, pedal
    43: 41, 58: 41, 45: 45, 47: 45, 48: 47, 50: 47,   # floor, mid, high tom (heads and rims)
    49: 49, 55: 49, 57: 49, 52: 49,          # crashes
    51: 51, 59: 51, 53: 51,                  # ride (bow, edge, bell)
}
CYMBAL = {49}
TOMS = {41, 45, 47}

# (row, name, performance, kit[, nudge]). Rows: 0 pop/rock/blues, 1 acoustic/folk, 2 jazz/funk.
# `nudge`: beats to move the bar line by, where the backbeat isn't on 2 and 4 (half-time).
PICKS = [
    (0, 'Rock', 'drummer3/session1/1_rock_105_beat_4-4.mid', 'Rock'),
    (0, 'Pop', 'drummer7/session2/103_pop_132_beat_4-4.mid', 'Pop'),
    (0, 'Motown', 'drummer7/session2/54_soul-motown_148_beat_4-4.mid', 'Pop'),
    (0, 'Shuffle', 'drummer5/session1/17_blues-shuffle_72_beat_4-4.mid', 'Rock'),
    (1, 'Ballad', 'drummer7/session3/11_pop-soft_83_beat_4-4.mid', 'Acoustic'),
    (1, 'Country', 'drummer7/session2/80_country_78_beat_4-4.mid', 'Acoustic'),
    (1, 'Indie folk', 'drummer8/session2/40_rock-indie_104_beat_4-4.mid', 'Acoustic'),
    (1, 'Bossa nova', 'drummer5/session1/1_latin-brazilian-bossa_127_beat_4-4.mid', 'Acoustic'),
    (2, 'Swing', 'drummer1/session1/48_jazz_93_beat_4-4.mid', 'Jazz'),
    (2, 'Funk', 'drummer7/session2/72_funk_100_beat_4-4.mid', 'Pop'),
    (2, 'Purdie', 'drummer1/session1/239_funk-purdieshuffle_130_beat_4-4.mid', 'Pop', 1),
    (2, 'Hip-hop', 'drummer7/session2/87_hiphop_75_beat_4-4.mid', 'Pop'),
]


def read(path):
    m = mido.MidiFile(path)
    bpm, notes = 120, []
    for tr in m.tracks:
        t = 0
        for msg in tr:
            t += msg.time
            if msg.type == 'set_tempo':
                bpm = mido.tempo2bpm(msg.tempo)
            elif msg.type == 'note_on' and msg.velocity > 0 and msg.note in MAP:
                notes.append((t / m.ticks_per_beat, MAP[msg.note], msg.velocity))
    return round(bpm), sorted(notes)


def centre(notes, nudge=0):
    """Line the performance up with the bar. The recordings aren't reliably aligned to it, so
    try every offset (in 48ths of a beat, over a bar) and keep the one that puts the most
    weight on the 8th-note grid, kicks on 1 and 3 and the backbeat (snare, cross-stick or
    hi-hat foot) on 2 and 4."""
    import math
    near = lambda x, g: math.exp(-((x - round(x / g) * g) / 0.04) ** 2 / 2)
    def score(off):
        s = 0
        for b, n, v in notes:
            b -= off
            w = v / 127
            s += w * near(b, 0.5)
            beat = round(b) % BPB
            if abs(b - round(b)) < 0.1:
                if n == 36: s += w * (1.5 if beat == 0 else 0.7 if beat == 2 else -0.3)
                if n in (38, 40, 37, 44): s += w * (1.5 if beat in (1, 3) else -0.3)
        return s
    off = max((k / 48 for k in range(48 * BPB)), key=score)
    # then the fine offset: notes near a beat sit on it, on average (drummers push or lay back)
    dev = [b - off - round(b - off) for b, _, _ in notes if abs(b - off - round(b - off)) < 0.12]
    off += (statistics.median(dev) if dev else 0) + nudge
    return [(b - off, n, v) for b, n, v in notes if b - off >= 0]


def window(notes, start, length, early=0.12):
    """Notes from `start` for `length` beats, relative to it (a hit a hair early still counts)."""
    return [(b - start, n, v) for b, n, v in notes if start - early <= b < start + length - early]


def features(notes, length):
    """The (sound, 12th-of-a-beat slot) hits that aren't ghost notes: 16ths and triplets both
    land on a slot."""
    return {(n, round(max(b, 0) * 12) % (length * 12)) for b, n, v in notes if v >= 30}


def dist(a, b):
    """Jaccard distance: 0 the same hits, 1 nothing in common."""
    return 1 - len(a & b) / max(1, len(a | b))


# ---- swing: the looper delays every second 16th to swing% of its 8th ----

def swing_of(notes):
    """The 16th swing in a part (50 = straight), from where its second 16ths fall."""
    ps = [p for b, _, _ in notes if 0.15 < (p := b - int(b * 2) / 2) < 0.42]
    if len(ps) < 8:
        return 50
    s = round(statistics.median(ps) * 200)
    return s if s >= 54 else 50


def unswing(b, swing):
    """Where to write a note so that the looper's swing plays it at `b`."""
    if swing == 50:
        return b
    cell = int(b * 2) / 2 if b >= 0 else -((-b * 2) // 1 + 1) / 2
    q, m = b - cell, swing / 200
    return cell + (q * 0.25 / m if q < m else 0.25 + (q - m) * 0.25 / (0.5 - m))


def pack(notes, swing, length):
    out = []
    for b, n, v in notes:
        s = unswing(b, swing)
        s = s % length if s < 0 else s
        out.append([round(s, 3), n, v])
    return sorted(out)


def extract(path, nudge=0):
    bpm, notes = read(path)
    notes = centre(notes, nudge)
    bars = int(notes[-1][0] // BPB)
    starts = [s for s in range(2, bars - 3, 2)]            # skip the count-in and the ending
    wins = {s: window(notes, s * BPB, 2 * BPB) for s in starts}
    busy = statistics.median(len(w) for w in wins.values())
    starts = [s for s in starts if len(wins[s]) >= 0.8 * busy]   # not a break or a breakdown
    feats = {s: features(w, 2 * BPB) for s, w in wins.items()}
    best = min(starts, key=lambda s: sum(dist(feats[s], feats[o]) for o in starts))
    groove = wins[best]
    swing = swing_of(groove)

    # The fill: a bar followed by a crash on the next downbeat, as unlike the groove as can be.
    typical = [features(window(groove, i * BPB, BPB), BPB) for i in (0, 1)]
    landed = lambda bar: [(b, n, v) for b, n, v in window(notes, (bar + 1) * BPB, 0.25) if n in CYMBAL]
    cands = [bar for bar in range(2, bars - 2) if landed(bar)] or list(range(2, bars - 2))
    def score(bar):
        w = window(notes, bar * BPB, BPB)
        return min(dist(features(w, BPB), t) for t in typical) + 0.03 * sum(n in TOMS or n == 38 for _, n, _ in w)
    fbar = max(cands, key=score)
    fill = window(notes, fbar * BPB, BPB) + [(b + BPB, n, v) for b, n, v in landed(fbar)]
    return bpm, swing, pack(groove, swing, 2 * BPB), pack(fill, swing, BPB + 1)


# ---- the electronic row, programmed: one character per 16th, '.' = rest, 1-9 = velocity ----

def grid(parts, length):
    out = []
    for note, steps in parts:
        steps = steps.replace(' ', '')
        assert len(steps) == length * 4, (note, len(steps))
        for i, c in enumerate(steps):
            if c != '.':
                out.append([i / 4, note, min(127, int(c) * 14)])
    return sorted(out)

ELECTRONIC = [
    ('House', 124, 56, 'House', [
        (36, '9...9...9...9... 9...9...9...9...'),
        (39, '....8.......8... ....8.......8...'),
        (42, '3.5.3.5.3.5.3.5. 3.5.3.5.3.5.3.55'),
        (46, '..7...7...7...7. ..7...7...7...7.'),
        (54, '.4.4.4.4.4.4.4.4 .4.4.4.4.4.4.4.4'),
    ], [
        (36, '9...9...9.......'),
        (39, '....8.......8...'),
        (38, '........45566789'),
        (46, '..7...7.........'),
        (49, '................9'),
    ]),
    ('Techno', 130, 50, 'Techno', [
        (36, '9...9...9...9... 9...9...9...9...'),
        (42, '6.36.36.6.36.363 6.36.36.6.36.363'),
        (46, '..8...8...8...8. ..8...8...8...8.'),
        (39, '....7.......7... ....7.......7...'),
        (37, '...5.....5....5. ...5.....5..5.5.'),
    ], [
        (36, '9...9...........'),
        (42, '6.36.36.........'),
        (37, '...5....56565656'),
        (45, '........5..5..5.'),
        (41, '..........5..5.5'),
        (49, '................9'),
    ]),
    ('Dubstep', 140, 50, 'Dubstep', [
        (36, '9.........7..... 9.....7...7.....'),
        (38, '........9....... ........9.......'),
        (42, '5.4.5.4.5.4.5.4. 5.4.5.4.5.4.5.44'),
        (46, '..............6. ......6.......6.'),
    ], [
        (36, '9.........7.....'),
        (38, '........9..4.4.5'),
        (45, '............7...'),
        (41, '..............77'),
        (42, '5.4.5.4.........'),
        (49, '................9'),
    ]),
    ('DnB', 174, 50, 'DnB', [
        (36, '9.........8..... 9.........8.7...'),
        (38, '....9.......9... ....9.......9...'),
        (40, '.......3.3.....3 ..3....3.3......'),
        (42, '6.4.6.4.6.4.6.4. 6.4.6.4.6.4.6.46'),
        (46, '..............5. ..............5.'),
    ], [
        (36, '9.........8.....'),
        (38, '....9...6.6.7788'),
        (47, '.........7......'),
        (45, '...........7....'),
        (41, '.............7.7'),
        (42, '6.4.6.4.........'),
        (49, '................9'),
    ]),
]


def show(name, notes, length):
    names = {36: 'K', 38: 'S', 40: 'RS', 37: 'X', 39: 'Cl', 42: 'CH', 44: 'PH', 46: 'OH', 41: 'T1', 45: 'T3', 47: 'T4', 49: 'Cr', 51: 'Rd', 54: 'Tb'}
    print(f'  {name}')
    for note in sorted({n for _, n, _ in notes}):
        row = ['.'] * (length * 4)
        for b, n, v in notes:
            i = round(b * 4)
            if n == note and i < len(row):
                row[i] = str(min(9, v * 10 // 128))
        print(f'   {names.get(note, note):>3} ' + ' '.join(''.join(row[i:i + 16]) for i in range(0, len(row), 16)))


def main():
    root = Path(sys.argv[1])
    grooves = []
    for row, name, path, kit, *nudge in PICKS:
        bpm, swing, notes, fill = extract(root / path, *nudge)
        grooves.append({'name': name, 'row': row, 'bpm': bpm, 'swing': swing, 'kit': kit, 'bars': 2, 'notes': notes, 'fill': fill})
    for name, bpm, swing, kit, notes, fill in ELECTRONIC:
        n = grid(notes, 2 * BPB)
        f = grid([(k, s[:16]) for k, s in fill], BPB) + [[BPB, k, 126] for k, s in fill if len(s) > 16 and s[16] != '.']
        grooves.append({'name': name, 'row': 3, 'bpm': bpm, 'swing': swing, 'kit': kit, 'bars': 2, 'notes': n, 'fill': sorted(f)})

    if '--show' in sys.argv:
        for g in grooves:
            print(f"{g['name']}  {g['bpm']} BPM  swing {g['swing']}  {g['kit']}")
            show('groove', g['notes'], 2 * BPB)
            show('fill', g['fill'], BPB + 1)

    order = sorted(grooves, key=lambda g: g['row'])
    body = ',\n'.join('  ' + json.dumps(g, separators=(',', ':')) for g in order)
    OUT.write_text(
        '// Generated by tools/build_grooves.py: don\'t edit. Rows 1-3 are from the Groove MIDI\n'
        '// Dataset (Magenta, CC BY 4.0); row 4 is programmed. Notes: [beat, GM drum note, velocity].\n'
        f'export default [\n{body},\n];\n')
    print(f'wrote {OUT} ({OUT.stat().st_size} bytes, {len(order)} grooves)')


if __name__ == '__main__':
    main()
