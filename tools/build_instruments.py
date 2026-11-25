"""Build the built-in sampled instruments in instruments/ from free (CC0) sample libraries.

    python3 tools/build_instruments.py [cache-dir]

For each instrument: picks sampled notes every few semitones, in one or two velocity layers,
reads each one's root note (from the library's SFZ map, or the file name checked against the
measured pitch), trims and fades it, scales the whole instrument to peak at -1 dBFS (so its
dynamics stay), and writes 16-bit FLAC plus instrument.json and instruments/index.json. Needs ffmpeg.

Sources (all CC0 1.0):
  Osiris Piano            Versilian Studios & Karoryfer Samples   github.com/sfzinstruments/Osiris_Piano
  Meatbass, Bigcat Cello  Karoryfer Samples (& Bigcat)            github.com/sfzinstruments
  VCSL                    Versilian Community Sample Library       github.com/sgossner/VCSL
"""
import json
import math
import os
import re
import shutil
import struct
import subprocess
import sys
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'instruments')
CACHE = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, '.inst-cache')

REPOS = {
    'osiris': ('sfzinstruments/Osiris_Piano', 'main'),
    'meatbass': ('sfzinstruments/karoryfer.meatbass', 'master'),
    'cello': ('sfzinstruments/karoryfer-bigcat.cello', 'master'),
    'vcsl': ('sgossner/VCSL', 'master'),
}
NOTE = {'c': 0, 'd': 2, 'e': 4, 'f': 5, 'g': 7, 'a': 9, 'b': 11}


def fetch(repo, path):
    name, branch = REPOS[repo]
    local = os.path.join(CACHE, repo, path)
    if not os.path.exists(local):
        os.makedirs(os.path.dirname(local), exist_ok=True)
        urllib.request.urlretrieve(f'https://raw.githubusercontent.com/{name}/{branch}/' + urllib.parse.quote(path), local)
    return local


def tree(repo):
    path = os.path.join(CACHE, f'{repo}-tree.json')
    if not os.path.exists(path):
        name, branch = REPOS[repo]
        os.makedirs(CACHE, exist_ok=True)
        urllib.request.urlretrieve(f'https://api.github.com/repos/{name}/git/trees/{branch}?recursive=1', path)
    return [x['path'] for x in json.load(open(path))['tree'] if x['type'] == 'blob']


def sfz_regions(repo, sfz_path, base='Programs'):
    """Regions of an SFZ map: [{sample (repo path), key, lo, hi, lovel, hivel, rand}] with group
    opcodes inherited. Just enough SFZ for these libraries' mapping files. Sample paths are relative
    to the instrument's main .sfz files (in `base`), not to the mapping file."""
    text = open(fetch(repo, sfz_path), encoding='utf-8', errors='replace').read()
    text = re.sub(r'//[^\n]*', '', text)
    out, group, cur, where = [], {}, None, None
    for tok in re.finditer(r'<(\w+)>|(\w+)=([^\s<]+(?: [^\s=<]+(?=\s|$))*)', text):
        if tok.group(1):
            if cur is not None and where == 'region':
                out.append(cur)
            where = tok.group(1)
            if where == 'group':
                group = {}
            cur = dict(group) if where == 'region' else (group if where == 'group' else {})
            continue
        k, v = tok.group(2), tok.group(3).strip()
        if cur is not None:
            cur[k] = v
    if cur is not None and where == 'region':
        out.append(cur)
    regions = []
    for r in out:
        if 'sample' not in r:
            continue
        sample = os.path.normpath(os.path.join(base, r['sample'].replace('\\', '/'))).replace('\\', '/')
        key = int(r.get('pitch_keycenter', r.get('key', -1)))
        regions.append({
            'sample': sample, 'key': key,
            'lo': int(r.get('lokey', r.get('key', key))), 'hi': int(r.get('hikey', r.get('key', key))),
            'lovel': int(r.get('lovel', 1)), 'hivel': int(r.get('hivel', 127)),
            'rand': float(r.get('lorand', 0)),
        })
    return regions


def note_of(name, offset=0):
    """'A#3', 'Bb2', 'A-1', 'c4' in a file name -> MIDI note (C4 = 60), plus `offset` semitones."""
    m = re.search(r'(?<![A-Za-z])([A-Ga-g])([#sb]?)(-?\d)(?!\d)', name)
    if not m:
        return None
    n = NOTE[m.group(1).lower()] + {'#': 1, 's': 1, 'b': -1}.get(m.group(2), 0)
    return 12 * (int(m.group(3)) + 1) + n + offset


def pitch_of(path):
    """Rough fundamental (as a MIDI note) by autocorrelation of a slice after the attack."""
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-ac', '1', '-ar', '22050', '-ss', '0.15', '-t', '0.25',
                          '-f', 's16le', '-'], capture_output=True).stdout
    x = struct.unpack(f'<{len(raw) // 2}h', raw)
    if len(x) < 2000:
        return None
    best, lag_best = 0, 0
    for lag in range(20, 1400):                         # ~15 Hz .. 1100 Hz
        s = sum(x[i] * x[i + lag] for i in range(0, 2400, 2))
        if s > best:
            best, lag_best = s, lag
    if not lag_best:
        return None
    return 69 + 12 * math.log2(22050 / lag_best / 440)


def render(src, out, max_len, gain_db):
    """Trim the tail, cap the length, fade out, apply the instrument's gain -> 16-bit FLAC."""
    trim = 'areverse,silenceremove=start_periods=1:start_threshold=-62dB:start_silence=0.05:detection=peak,areverse'
    tmp = out + '.tmp.wav'
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', src, '-af', f'volume={gain_db}dB,{trim},atrim=end={max_len}', '-ar', '48000', '-c:a', 'pcm_f32le', tmp], check=True)
    dur = float(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', tmp], capture_output=True, text=True).stdout)
    fade = min(0.25, dur / 4)
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', tmp, '-af', f'afade=t=out:st={dur - fade:.4f}:d={fade:.4f}',
                    '-sample_fmt', 's16', '-c:a', 'flac', '-compression_level', '8', out], check=True)
    os.remove(tmp)


def peak_db(path):
    probe = subprocess.run(['ffmpeg', '-v', 'info', '-i', path, '-af', 'volumedetect', '-f', 'null', '-'], capture_output=True, text=True).stderr
    return float(re.search(r'max_volume: (-?[\d.]+) dB', probe).group(1))


def spaced(keys, every):
    """Pick roots from the available ones, about `every` semitones apart (always the ends)."""
    keys = sorted(set(keys))
    out = [keys[0]]
    for k in keys[1:]:
        if k - out[-1] >= every:
            out.append(k)
    if out[-1] != keys[-1]:
        out.append(keys[-1])
    return out


# ---- the instruments ----------------------------------------------------------------------
# Each: a list of velocity layers, each layer a list of (root note, repo, path). Layers split the
# velocity range evenly (soft first).

def from_sfz(repo, maps, every, pick=lambda r: True):
    layers = []
    for sfz in maps:
        regs = [r for r in sfz_regions(repo, sfz) if pick(r) and r['rand'] == 0 and r['key'] >= 0]
        by_key = {}
        for r in regs:
            by_key.setdefault(r['key'], r)
        roots = spaced(by_key, every)
        layers.append([(k, repo, by_key[k]['sample']) for k in roots])
    return layers


def from_names(repo, folder, layer_patterns, every, check_octave=True):
    files = [p for p in tree(repo) if p.rsplit('/', 1)[0] == folder and p.lower().endswith('.wav')]
    layers = []
    offset = None
    for pat in layer_patterns:
        notes = {}
        for p in files:
            f = p.rsplit('/', 1)[1]
            if re.search(pat, f):
                n = note_of(f)
                if n is not None:
                    notes.setdefault(n, p)
        if offset is None and check_octave:
            # The file names' octave numbering against the measured pitch of a middle sample.
            k = sorted(notes)[len(notes) // 2]
            measured = pitch_of(fetch(repo, notes[k]))
            offset = 12 * round((measured - k) / 12) if measured else 0
            print(f'    {folder.rsplit("/", 1)[-1]}: named {k}, measured {measured and round(measured, 1)} -> octave offset {offset}')
        roots = spaced(notes, every)
        layers.append([(k + (offset or 0), repo, notes[k]) for k in roots])
    return layers


INSTRUMENTS = [
    ('Grand Piano', '#e8c26a', 5.0, 0.7, 3, lambda: from_sfz('osiris', [
        'Programs/modules/mappings/uc_mica_vl1_map.sfz', 'Programs/modules/mappings/uc_mica_vl2_map.sfz'], every=4)),
    ('Upright Bass', '#c98a5a', 2.5, 0.25, 2, lambda: from_sfz('meatbass', ['Programs/pizz_basic_map.sfz'], every=4,
        pick=lambda r: r['lovel'] >= 64)),
    ('Cello', '#d0805a', 5.0, 0.35, 2, lambda: from_sfz('cello', ['Programs/vc_arco_sus_map.sfz'], every=4,
        pick=lambda r: '/sus/' in r['sample'] and r['lovel'] >= 64)),
    ('Vibraphone', '#7fc4e0', 5.0, 0.9, 4, lambda: from_names('vcsl', 'Idiophones/Struck Idiophones/Vibraphone/Hard Mallets',
        [r'_v2_rr1', r'_v3_rr1'], every=3)),
    ('Harp', '#c7b7f0', 5.0, 1.2, 3, lambda: from_names('vcsl', 'Chordophones/Composite Chordophones/Concert Harp',
        [r'_(mf|mp|p)\d', r'_f\d'], every=3)),
]


def main():
    os.makedirs(CACHE, exist_ok=True)
    os.makedirs(OUT, exist_ok=True)
    index = []
    for name, color, max_len, release, octave, layers_fn in INSTRUMENTS:
        print(name)
        layers = layers_fn()
        idir = os.path.join(OUT, f'{name}.zinst')
        shutil.rmtree(idir, ignore_errors=True)
        os.makedirs(os.path.join(idir, 'samples'))
        srcs = [[(k, fetch(repo, path)) for k, repo, path in layer] for layer in layers]
        loud = max(peak_db(f) for layer in srcs for _, f in layer)
        gain = -1 - loud                                  # one gain for the whole instrument
        zones = []
        n = len(srcs)
        for li, layer in enumerate(srcs):
            vlo, vhi = 1 + li * 127 // n, (li + 1) * 127 // n
            roots = [k for k, _ in layer]
            for i, (k, f) in enumerate(layer):
                lo = 0 if i == 0 else (roots[i - 1] + k) // 2 + 1
                hi = 127 if i == len(layer) - 1 else (k + roots[i + 1]) // 2
                fname = f'{li + 1}-{k:03d}.flac'
                render(f, os.path.join(idir, 'samples', fname), max_len, gain)
                zones.append({'file': fname, 'root': k, 'lo': lo, 'hi': hi, 'velLo': vlo, 'velHi': vhi})
            print(f'  layer {li + 1}: {len(layer)} notes, roots {roots[0]}..{roots[-1]}')
        json.dump({'format': 'zerkit-instrument', 'version': 1, 'name': name, 'color': color, 'octave': octave,
                   'release': release, 'zones': zones}, open(os.path.join(idir, 'instrument.json'), 'w'), indent=1)
        index.append(name)
    json.dump(index, open(os.path.join(OUT, 'index.json'), 'w'))
    print('instruments:', index)


if __name__ == '__main__':
    main()
