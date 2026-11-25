"""Build the built-in kits in kits/ from free (CC0) sample libraries.

    python3 tools/build_kits.py [cache-dir]

Downloads the chosen samples (cached in cache-dir), blends microphones where a library has
several, trims the silent tail, caps the length, fades out, peak-normalises to -1 dBFS and
writes 16-bit FLAC, plus each kit's kit.json and kits/index.json. Needs ffmpeg.

Sources (all CC0 1.0, public domain):
  Big Rusty Drums, Swirly Drums     Karoryfer Samples, https://github.com/sfzinstruments
  Virtuosity Drums                  Versilian Studios, https://github.com/sfzinstruments/virtuosity_drums
  VCSL                              Versilian Community Sample Library, https://github.com/sgossner/VCSL
"""
import json
import os
import re
import shutil
import subprocess
import sys
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'kits')
CACHE = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, '.kit-cache')

REPOS = {
    'rusty': ('sfzinstruments/karoryfer.big-rusty-drums', 'main'),
    'swirly': ('sfzinstruments/karoryfer.swirly-drums', 'main'),
    'virt': ('sfzinstruments/virtuosity_drums', 'master'),
    'vcsl': ('sgossner/VCSL', 'master'),
}
_trees = {}


def tree(repo):
    if repo not in _trees:
        name, branch = REPOS[repo]
        path = os.path.join(CACHE, f'{repo}-tree.json')
        if not os.path.exists(path):
            urllib.request.urlretrieve(f'https://api.github.com/repos/{name}/git/trees/{branch}?recursive=1', path)
        _trees[repo] = [x['path'] for x in json.load(open(path))['tree'] if x['type'] == 'blob']
    return _trees[repo]


def pick(repo, folder, stem, level=0.8, rr=1):
    """The file in `folder` whose name starts with `stem` + velocity layer, at `level` of the
    loudest layer (the strong-but-not-hardest hit), round robin `rr` (or the first there is)."""
    stem, _, suffix = stem.partition('|')            # "snare_hit|_top": only files ending in _top
    pat = re.compile(re.escape(stem) + r'_v(?:l)?(\d+)(?:_(\d+))?(?:_rr(\d+))?[^/]*' + re.escape(suffix) + r'\.(?:wav|flac)$', re.I)
    found = []
    for p in tree(repo):
        if '/' not in p:
            continue
        d, f = p.rsplit('/', 1)
        if d != folder:
            continue
        m = pat.match(f)
        if m:
            found.append((int(m.group(1)), int(m.group(3) or 1), p))
    if not found:
        raise SystemExit(f'no samples for {repo}:{folder}/{stem}')
    top = max(v for v, _, _ in found)
    want = max(1, round(top * level))
    vl = min({v for v, _, _ in found}, key=lambda v: abs(v - want))
    takes = sorted((r, p) for v, r, p in found if v == vl)
    return next((p for r, p in takes if r == rr), takes[0][1])


def fetch(repo, path):
    name, branch = REPOS[repo]
    local = os.path.join(CACHE, repo, path)
    if not os.path.exists(local):
        os.makedirs(os.path.dirname(local), exist_ok=True)
        url = f'https://raw.githubusercontent.com/{name}/{branch}/' + urllib.parse.quote(path)
        urllib.request.urlretrieve(url, local)
    return local


def peak_db(path):
    probe = subprocess.run(['ffmpeg', '-v', 'info', '-i', path, '-af', 'volumedetect', '-f', 'null', '-'], capture_output=True, text=True).stderr
    return float(re.search(r'max_volume: (-?[\d.]+) dB', probe).group(1))


def render(sources, out, max_len):
    """sources: [(local file, gain)] mixed together -> out (FLAC). Returns the mix's peak (dBFS)
    before normalising, so very quiet sources can be spotted."""
    mixed, trimmed = out + '.mix.wav', out + '.trim.wav'
    ins = sum((['-i', f] for f, _ in sources), [])
    chains = ''.join(f'[{i}]aformat=sample_rates=48000:channel_layouts=stereo,volume={g}[a{i}];' for i, (_, g) in enumerate(sources))
    mix = ''.join(f'[a{i}]' for i in range(len(sources))) + f'amix=inputs={len(sources)}:normalize=0:duration=longest'
    subprocess.run(['ffmpeg', '-v', 'error', '-y', *ins, '-filter_complex', chains + mix, '-c:a', 'pcm_f32le', mixed], check=True)
    peak = peak_db(mixed)
    # Normalise to -1 dBFS, then trim the tail below -60 dB of that, cap the length.
    trim = 'areverse,silenceremove=start_periods=1:start_threshold=-60dB:start_silence=0.03:detection=peak,areverse'
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', mixed, '-af', f'volume={-1 - peak}dB,{trim},atrim=end={max_len}', '-c:a', 'pcm_f32le', trimmed], check=True)
    dur = float(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', trimmed], capture_output=True, text=True).stdout)
    fade = min(0.06, dur / 4)
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', trimmed, '-af', f'afade=t=out:st={dur - fade:.4f}:d={fade:.4f}',
                    '-sample_fmt', 's16', '-c:a', 'flac', '-compression_level', '8', out], check=True)
    os.remove(mixed)
    os.remove(trimmed)
    return peak, dur


# ---- the kits ---------------------------------------------------------------------------
# Each pad: (label, max seconds, [(repo, folder, stem, gain), ...]). Pads 1-8 are the bottom
# row, 9-16 the row above; pads keep the General MIDI roles (kick, snare, clap, rim, hats,
# snare 2, toms low to high, crash, ride, tambourine, cowbell) so parts move between kits.

DRUM, CYM = 1.6, 4.0
VCSL_S = 'Idiophones/Struck Idiophones'
VCSL_M = 'Membranophones/Struck Membranophones'


def virt(art, mics):
    """Virtuosity Drums: Samples/<mic>/<drum>/<mic>_<drum>_<articulation>."""
    drum = art.split('_')[0]
    return [('virt', f'Samples/{mic}/{drum}', f'{mic}_{art}', g) for mic, g in mics]


TIGHT = [('kickmic', 0.8), ('snaremic', 0.8), ('mid', 0.6)]      # drums: close mics
TIGHT_CYM = [('mid', 0.8), ('oh', 0.6)]                           # hats and cymbals: away from the drums
ROOMY = [('mid', 0.7), ('oh', 0.7), ('room', 0.6)]


def swirly(folder, stem, wet=0.5, mics=('',)):
    """Swirly Drums: dry and room ("wet") recordings; snares also have top and bottom mics,
    named after the take ("snare_hit_vl10_rr1_top.wav"). stem None: a middle file of the folder."""
    gains = [1, 0.5] if len(mics) > 1 else [1]
    spec = lambda m: None if stem is None else stem + (f'|{m}' if m else '')
    return [('swirly', f'Samples/{folder}', spec(m), g) for m, g in zip(mics, gains)] + \
           [('swirly', f'Samples/wet/{folder}', spec(m), wet * g) for m, g in zip(mics, gains)]


KITS = {
    'Rock': [
        ('Kick', DRUM, [('rusty', 'Samples/kick_24/kick/kick', 'k', 1)]),
        ('Snare', DRUM, [('rusty', 'Samples/snare_14/center/top', 'sn_center', 1), ('rusty', 'Samples/snare_14/center/btm', 'sn_center', 0.5)]),
        ('Clap', DRUM, [('vcsl', f'{VCSL_S}/Claps', '=Clap_rr1.wav', 1)]),
        ('Sidestick', DRUM, [('rusty', 'Samples/snare_14/sidestick/top', 'sn_ss', 1)]),
        ('Closed HH', DRUM, [('rusty', 'Samples/hihat_14/cl/cl', 'ht_cl', 1), ('rusty', 'Samples/hihat_14/cl/oh', 'ht_cl', 0.7)]),
        ('Pedal HH', DRUM, [('rusty', 'Samples/hihat_14/chik/cl', 'ht_chik', 1), ('rusty', 'Samples/hihat_14/chik/oh', 'ht_chik', 0.7)]),
        ('Open HH', CYM, [('rusty', 'Samples/hihat_14/open/cl', 'ht_open', 1), ('rusty', 'Samples/hihat_14/open/oh', 'ht_open', 0.7)]),
        ('Rimshot', DRUM, [('rusty', 'Samples/snare_14/rimshot/top', 'sn_rims', 1), ('rusty', 'Samples/snare_14/rimshot/btm', 'sn_rims', 0.5)]),
        ('Floor Tom', DRUM, [('rusty', 'Samples/tom_22/center/cl', 't22', 1)]),
        ('Tom 18', DRUM, [('rusty', 'Samples/tom_18/center/cl', 't18', 1)]),
        ('Tom 15', DRUM, [('rusty', 'Samples/tom_15/center/cl', 't15', 1)]),
        ('Tom 14', DRUM, [('rusty', 'Samples/tom_14/center/cl', 't14', 1)]),
        ('Crash', CYM, [('rusty', 'Samples/crash_17/cr/cl', 'cr', 0.7), ('rusty', 'Samples/crash_17/cr/oh', 'cr', 1)]),
        ('Ride', CYM, [('rusty', 'Samples/ride_22/rd/cl', 'rd', 0.7), ('rusty', 'Samples/ride_22/rd/oh', 'rd', 1)]),
        ('Tambourine', DRUM, [('vcsl', f'{VCSL_S}/Tambourine 1', 'Tamb1_Hit', 1)]),
        ('Cowbell', DRUM, [('vcsl', f'{VCSL_S}/Cowbells', 'Cowbell1_Hit', 1)]),
    ],
    'Pop': [
        ('Kick', DRUM, virt('kick_snoff', TIGHT)),
        ('Snare', DRUM, virt('snare_center', TIGHT)),
        ('Clap', DRUM, [('vcsl', f'{VCSL_S}/Claps', '=Clap_rr1.wav', 1)]),
        ('Cross Stick', DRUM, virt('snare_crossstick', TIGHT)),
        ('Closed HH', DRUM, virt('hh_closed', TIGHT_CYM)),
        ('Pedal HH', DRUM, virt('hh_pedal', TIGHT_CYM)),
        ('Open HH', CYM, virt('hh_open', TIGHT_CYM)),
        ('Rimshot', DRUM, virt('snare_rimshot', TIGHT)),
        ('Low Tom', DRUM, virt('ltom_center', TIGHT)),
        ('Low Tom Rim', DRUM, virt('ltom_rimshot', TIGHT)),
        ('High Tom', DRUM, virt('htom_center', TIGHT)),
        ('High Tom Edge', DRUM, virt('htom_offcenter', TIGHT)),
        ('Crash', CYM, virt('crash_crash', TIGHT_CYM)),
        ('Ride Bell', CYM, virt('ride_bell', TIGHT_CYM)),
        ('Tambourine', DRUM, [('vcsl', f'{VCSL_S}/Tambourine 1', 'Tamb1_Hit', 1)]),
        ('Shaker', DRUM, [('virt', 'Samples/perc/close/shaker', '~LShaker', 1)]),
    ],
    'Jazz': [
        ('Kick', DRUM, swirly('kick_buzz', 'buzz_kick_with_snare_buzz')),
        ('Brush Snare', DRUM, swirly('snare_main', 'snare_hit', mics=('_top', '_btm'))),
        ('Brush Stir', CYM, swirly('snare_stir', None)),
        ('Snare Edge', DRUM, swirly('snare_edge', 'snare_edge', mics=('_top', '_btm'))),
        ('Closed HH', DRUM, swirly('hat_closed', 'hh_closed')),
        ('Foot HH', DRUM, swirly('hat_foot', 'hh_foot')),
        ('Open HH', CYM, swirly('hat_open', 'hh_open')),
        ('Snare Dig', DRUM, swirly('snare_dig', 'snare_dig', mics=('_top', '_btm'))),
        ('Floor Tom', DRUM, swirly('tom_floor', 'tom_floor')),
        ('Low Tom', DRUM, swirly('tom_mlow', 'tom_mlow')),
        ('Mid Tom', DRUM, swirly('tom_mhi', 'tom_mhi')),
        ('High Tom', DRUM, swirly('tom_vhi', 'tom_vhi')),
        ('Crash', CYM, swirly('crash', 'crash')),
        ('Ride', CYM, swirly('ride', 'ride')),
        ('Splash', CYM, swirly('splash', 'splash')),
        ('Cowbell', DRUM, swirly('cowbell', 'cowbell')),
    ],
    'Acoustic': [
        ('Kick', DRUM, virt('kick_snoff', ROOMY)),
        ('Snare', DRUM, virt('snare_center', ROOMY)),
        ('Snare Muted', DRUM, virt('snare_muted', ROOMY)),
        ('Cross Stick', DRUM, virt('snare_crossstick', ROOMY)),
        ('Closed HH', DRUM, virt('hh_closed', ROOMY)),
        ('Pedal HH', DRUM, virt('hh_pedal', ROOMY)),
        ('Open HH', CYM, virt('hh_open', ROOMY)),
        ('Rimshot', DRUM, virt('snare_rimshot', ROOMY)),
        ('Low Tom', DRUM, virt('ltom_center', ROOMY)),
        ('Low Tom Muted', DRUM, virt('ltom_muted', ROOMY)),
        ('High Tom', DRUM, virt('htom_center', ROOMY)),
        ('High Tom Edge', DRUM, virt('htom_offcenter', ROOMY)),
        ('Crash', CYM, virt('crash_crash', ROOMY)),
        ('Ride', CYM, virt('ride_ride', ROOMY)),
        ('Flat Ride', CYM, virt('flatride_ride', ROOMY)),
        ('Ride Bell', CYM, virt('ride_bell', ROOMY)),
    ],
    'Percussion': [
        ('Tumba', DRUM, [('virt', 'Samples/perc/close/tumba', '~Tumba', 1)]),
        ('Conga', DRUM, [('virt', 'Samples/perc/close/conga', '~Conga', 1)]),
        ('Bongo Low', DRUM, [('virt', 'Samples/perc/close/bongol', '~BongoL_Hit', 1)]),
        ('Bongo High', DRUM, [('virt', 'Samples/perc/close/bongoh', '~BongoH_Hit', 1)]),
        ('Cajon', DRUM, [('vcsl', f'{VCSL_S}/Cajon', '=Cajon_hit1_f_rr1.wav', 1)]),
        ('Timbale', DRUM, [('virt', 'Samples/perc/oh/timbales', 'timb13', 1)]),
        ('Shaker', DRUM, [('virt', 'Samples/perc/close/shaker', '~LShaker', 1)]),
        ('Tambourine', DRUM, [('vcsl', f'{VCSL_S}/Tambourine 1', 'Tamb1_Hit', 1)]),
        ('Claves', DRUM, [('virt', 'Samples/perc/close/claves', '~Claves1_Hit', 1)]),
        ('Woodblock', DRUM, [('virt', 'Samples/perc/oh/woodblock', 'woodblock_lo', 1)]),
        ('Agogo', DRUM, [('virt', 'Samples/perc/close/agogo', '~Agogo', 1)]),
        ('Cowbell', DRUM, [('virt', 'Samples/perc/close/cowbell', '~Cowbell1', 1)]),
        ('Guiro', DRUM, [('vcsl', f'{VCSL_S}/Guiro', '~Guiro', 1)]),
        ('Cabasa', DRUM, [('virt', 'Samples/perc/close/cabasa', '~Cabasa', 1)]),
        ('Triangle', CYM, [('virt', 'Samples/perc/close/triangle', '~Triangle1_Hit', 1)]),
        ('Darbuka', DRUM, [('vcsl', f'{VCSL_M}/Darbuka', 'Darbuka_1_hit', 1)]),
    ],
}


def first_in(repo, folder):
    """For folders with one kind of hit and naming we don't parse: a middle file."""
    fs = sorted(p for p in tree(repo) if '/' in p and p.rsplit('/', 1)[0] == folder and p.lower().endswith(('.wav', '.flac')))
    if not fs:
        raise SystemExit(f'no samples in {repo}:{folder}')
    return fs[len(fs) // 2]


def resolve(repo, folder, stem):
    if stem is None:
        return first_in(repo, folder)
    if stem.startswith('='):                          # an exact file name
        return f'{folder}/{stem[1:]}'
    if stem.startswith('~'):                          # the strongest first take among files named so
        cands = sorted(p for p in tree(repo) if '/' in p and p.rsplit('/', 1)[0] == folder
                       and p.rsplit('/', 1)[1].startswith(stem[1:]) and re.search(r'rr1[_.]', p))
        if not cands:
            raise SystemExit(f'no samples for {repo}:{folder}/{stem}')
        return max(cands, key=lambda p: peak_db(fetch(repo, p)))
    return pick(repo, folder, stem)


def main():
    os.makedirs(CACHE, exist_ok=True)
    os.makedirs(OUT, exist_ok=True)
    index = []
    for name, pads in KITS.items():
        assert len(pads) == 16, name
        kdir = os.path.join(OUT, f'{name}.zkit')
        shutil.rmtree(kdir, ignore_errors=True)
        os.makedirs(os.path.join(kdir, 'samples'))
        out_pads = []
        for i, (label, max_len, srcs) in enumerate(pads):
            files = []
            for repo, folder, stem, gain in srcs:
                path = resolve(repo, folder, stem)
                files.append((fetch(repo, path), gain))
            fname = f'{i + 1:02d}-{re.sub(r"[^a-z0-9]+", "-", label.lower()).strip("-")}.flac'
            peak, dur = render(files, os.path.join(kdir, 'samples', fname), max_len)
            out_pads.append({'file': fname, 'label': label})
            quiet = '   QUIET SOURCE' if peak < -24 else ''
            print(f'  {name:10s} {i + 1:2d} {label:14s} {dur:4.2f}s peak {peak:6.1f} dB <- {", ".join(os.path.basename(f) for f, _ in files)}{quiet}')
        json.dump({'format': 'zerkit-kit', 'version': 1, 'name': name, 'pads': out_pads}, open(os.path.join(kdir, 'kit.json'), 'w'), indent=1)
        index.append(name)
    json.dump(index, open(os.path.join(OUT, 'index.json'), 'w'))
    print('kits:', index)


if __name__ == '__main__':
    main()
