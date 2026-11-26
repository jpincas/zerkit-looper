"""Synthesise the electronic built-in kits (House, Techno, Dubstep, DnB) into kits/.

    python3 tools/synth_kits.py

Every sound is made here from oscillators, noise and filters (the way the drum machines these
genres grew up on make theirs), so the kits are our own work, MIT like the rest, and rebuild
byte for byte: the noise is seeded. Pure Python plus ffmpeg (for FLAC). Each sample is
normalised to -1 dBFS, its tail below -60 dB trimmed, faded out and written as 16-bit stereo
48 kHz FLAC, like tools/build_kits.py's. Pads keep the General MIDI roles where a kit has them
(1 kick, 2 snare, 3 clap, 4 rim, 5-7 hats, 8 snare 2, 9-12 low to high, 13 crash, 14 ride ...).
"""
import json
import math
import os
import random
import re
import shutil
import subprocess
import tempfile
import wave

FS = 48000
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'kits')
TAU = 2 * math.pi


# ---- building blocks (lists of floats) --------------------------------------------------

def n_of(sec):
    return int(sec * FS)


def env(sec, decay, attack=0.0, hold=0.0):
    """Attack (linear), hold, then exponential decay (decay = time to 1/e)."""
    out = []
    a, h = n_of(attack), n_of(hold)
    for i in range(n_of(sec)):
        if i < a:
            out.append(i / a)
        elif i < a + h:
            out.append(1.0)
        else:
            out.append(math.exp(-(i - a - h) / FS / decay))
    return out


def noise(sec, seed):
    r = random.Random(seed)
    return [r.uniform(-1, 1) for _ in range(n_of(sec))]


def sweep(sec, f0, f1, tau, shape='sine', phase=0.0):
    """Oscillator gliding exponentially from f0 to f1 (tau = time to 1/e of the way)."""
    out, ph = [], phase
    for i in range(n_of(sec)):
        f = f1 + (f0 - f1) * math.exp(-i / FS / tau)
        ph += TAU * f / FS
        s = math.sin(ph)
        out.append(s if shape == 'sine' else (1.0 if s >= 0 else -1.0) if shape == 'square' else math.asin(s) * 2 / math.pi)
    return out


def metal(sec, tune=1.0, freqs=(205.3, 304.4, 369.6, 522.7, 540.0, 800.0)):
    """Six detuned square waves: the 808/909 cymbal and hat source."""
    out, phs = [], [random.Random(k).random() * TAU for k in range(len(freqs))]
    inc = [TAU * f * tune / FS for f in freqs]
    for _ in range(n_of(sec)):
        s = 0.0
        for k in range(len(freqs)):
            phs[k] += inc[k]
            s += 1.0 if math.sin(phs[k]) >= 0 else -1.0
        out.append(s / len(freqs))
    return out


def biquad(x, kind, f, q=0.707):
    w0 = TAU * min(f, FS * 0.45) / FS
    c, alpha = math.cos(w0), math.sin(w0) / (2 * q)
    if kind == 'lp':
        b0, b1, b2 = (1 - c) / 2, 1 - c, (1 - c) / 2
    elif kind == 'hp':
        b0, b1, b2 = (1 + c) / 2, -(1 + c), (1 + c) / 2
    else:                                                   # 'bp', 0 dB peak
        b0, b1, b2 = alpha, 0.0, -alpha
    a0, a1, a2 = 1 + alpha, -2 * c, 1 - alpha
    b0, b1, b2, a1, a2 = b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0
    y, x1, x2, y1, y2 = [], 0.0, 0.0, 0.0, 0.0
    for s in x:
        o = b0 * s + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
        x2, x1, y2, y1 = x1, s, y1, o
        y.append(o)
    return y


def mul(a, b):
    return [p * q for p, q in zip(a, b)]


def mix(*parts):
    """mix((signal, gain), ...) to the longest."""
    n = max(len(s) for s, _ in parts)
    out = [0.0] * n
    for s, g in parts:
        for i, v in enumerate(s):
            out[i] += v * g
    return out


def drive(x, amount):
    k = math.tanh(amount)
    return [math.tanh(v * amount) / k for v in x]


def delay(x, sec):
    return [0.0] * n_of(sec) + x


def pad_to(x, sec):
    return x + [0.0] * max(0, n_of(sec) - len(x))


def reverb(x, room=0.8, damp=0.3, wet=0.3, tail=1.0):
    """Freeverb (Jezar's public-domain design): stereo out from mono in."""
    x = pad_to(x, len(x) / FS + tail)
    sc = FS / 44100
    combs = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617]
    alls = [556, 441, 341, 225]
    fb, d1 = room * 0.28 + 0.7, damp * 0.4
    outs = []
    for spread in (0, 23):
        cb = [[0.0] * int((c + spread) * sc) for c in combs]
        ci, store = [0] * 8, [0.0] * 8
        ab = [[0.0] * int((a + spread) * sc) for a in alls]
        ai = [0] * 4
        out = []
        for s in x:
            inp, acc = s * 0.015, 0.0
            for k in range(8):
                buf = cb[k]
                o = buf[ci[k]]
                store[k] = o * (1 - d1) + store[k] * d1
                buf[ci[k]] = inp + store[k] * fb
                ci[k] = (ci[k] + 1) % len(buf)
                acc += o
            for k in range(4):
                buf = ab[k]
                b = buf[ai[k]]
                buf[ai[k]] = acc + b * 0.5
                ai[k] = (ai[k] + 1) % len(buf)
                acc = b - acc
            out.append(acc)
        outs.append(out)
    return [[d + w * wet * 3 for d, w in zip(x, o)] for o in outs]


def stereo(x):
    return [x, x]


# ---- instruments ------------------------------------------------------------------------

def kick(f0, f1, tau, decay, hold=0.02, click=0.5, punch=1.5, sec=0.8, lp=None, seed=1):
    body = mul(sweep(sec, f0, f1, tau), env(sec, decay, attack=0.001, hold=hold))
    clk = mul(biquad(noise(0.012, seed), 'hp', 1800), env(0.012, 0.003))
    x = drive(mix((body, 1.0), (clk, click)), punch)
    return stereo(biquad(x, 'lp', lp) if lp else x)


def snare(tone=(185, 330), tone_decay=0.08, noise_decay=0.16, hp=1500, lp=9000, tone_mix=0.6, noise_mix=0.9,
          punch=1.2, sec=0.6, verb=None, seed=2):
    t = mix(*((mul(sweep(sec, f * 1.4, f, 0.008), env(sec, tone_decay, attack=0.0005)), 1 / len(tone)) for f in tone))
    nz = biquad(biquad(noise(sec, seed), 'hp', hp), 'lp', lp)
    nz = mul(nz, env(sec, noise_decay, attack=0.0008))
    x = drive(mix((t, tone_mix), (nz, noise_mix)), punch)
    return reverb(x, *verb) if verb else stereo(x)


def clap(decay=0.13, f=1100, sec=0.6, verb=None, seed=3):
    nz = biquad(biquad(noise(sec, seed), 'bp', f, 1.1), 'hp', 500)
    e = [0.0] * n_of(sec)
    for k, start in enumerate((0, 0.011, 0.022, 0.034)):            # the hands, then the tail
        d = decay if k == 3 else 0.006
        for i in range(n_of(start), len(e)):
            e[i] = max(e[i], math.exp(-(i - n_of(start)) / FS / d) * (1.0 if k == 3 else 0.85))
    x = drive(mul(nz, e), 1.5)
    return reverb(x, *verb) if verb else stereo(x)


def rim(f=(1700, 480), decay=0.018, seed=4):
    sec = 0.2
    t = mix(*((mul(sweep(sec, g, g, 1), env(sec, decay)), 0.5) for g in f))
    clk = mul(biquad(noise(sec, seed), 'bp', 3000, 2), env(sec, 0.004))
    return stereo(drive(mix((t, 1.0), (clk, 0.6)), 2.0))


def hat(decay, tune=1.0, noise_mix=0.35, hp=7000, bp=10000, sec=None, attack=0.0005, dark=None, seed=5, punch=1.0):
    sec = sec or min(2.0, decay * 7)
    def side(s):
        src = mix((metal(sec, tune), 1.0), (noise(sec, s), noise_mix))
        x = biquad(biquad(src, 'bp', bp, 0.8), 'hp', hp)
        if dark:
            x = biquad(x, 'lp', dark)
        return drive(mul(x, env(sec, decay, attack=attack)), punch)
    return [side(seed), side(seed + 100)] if decay > 0.2 else stereo(side(seed))


def cymbal(decay=1.2, tune=1.6, sec=3.0, bell=0.0, hp=5000, seed=6):
    def side(s):
        src = mix((metal(sec, tune), 0.7), (metal(sec, tune * 1.414, (263.0, 397.0, 467.0, 611.0, 742.0, 951.0)), 0.5),
                  (noise(sec, s), 0.45))
        x = biquad(src, 'hp', hp)
        x = mul(x, env(sec, decay, attack=0.002))
        if bell:
            b = mix(*((mul(sweep(sec, f, f, 1), env(sec, 0.5)), 0.33) for f in (2950, 4170, 5380)))
            x = mix((x, 1.0), (b, bell))
        return x
    return [side(seed), side(seed + 100)]


def tom(f, decay=0.3, sec=0.9, punch=1.3, noise_mix=0.15, seed=7):
    body = mul(sweep(sec, f * 1.7, f, 0.045), env(sec, decay, attack=0.001))
    nz = mul(biquad(noise(sec, seed), 'bp', f * 4, 1.0), env(sec, 0.02))
    return stereo(drive(mix((body, 1.0), (nz, noise_mix)), punch))


def conga(f=320, decay=0.17):
    sec = 0.6
    body = mul(sweep(sec, f * 1.25, f, 0.012), env(sec, decay, attack=0.0008))
    return stereo(drive(body, 1.2))


def cowbell(decay=0.25):
    sec = 0.8
    src = metal(sec, 1.0, (540.0, 800.0))
    e = [0.6 * math.exp(-i / FS / 0.025) + 0.4 * math.exp(-i / FS / decay) for i in range(n_of(sec))]
    return stereo(mul(biquad(src, 'bp', 850, 1.3), e))


def shaker(attack=0.015, decay=0.06, f=6500, seed=8):
    sec = 0.4
    x = biquad(biquad(noise(sec, seed), 'bp', f, 1.2), 'hp', 3000)
    return stereo(mul(x, env(sec, decay, attack=attack)))


def tambourine(seed=9):
    sec = 0.6
    e = [0.0] * n_of(sec)
    for start in (0, 0.009, 0.019):
        for i in range(n_of(start), len(e)):
            e[i] = max(e[i], math.exp(-(i - n_of(start)) / FS / 0.07))
    src = mix((metal(sec, 9.0), 0.6), (noise(sec, seed), 0.6))
    return stereo(mul(biquad(src, 'hp', 6500), e))


def sub(f, sec=1.4, decay=0.6, hold=0.35, punch=1.6):
    body = mul(sweep(sec, f * 1.06, f, 0.03), env(sec, decay, attack=0.004, hold=hold))
    return stereo(drive(body, punch))


def sub_drop(f0=110, f1=30, sec=1.8):
    body = mul(sweep(sec, f0, f1, 0.55), env(sec, 0.9, attack=0.004, hold=0.4))
    return stereo(drive(body, 1.8))


def zap(f0=2400, f1=70, tau=0.03, decay=0.12):
    sec = 0.5
    return stereo(mul(sweep(sec, f0, f1, tau, 'tri'), env(sec, decay)))


def perc(fc=620, fm=1460, index=4.0, decay=0.07):
    sec = 0.4
    out = []
    for i in range(n_of(sec)):
        t = i / FS
        k = index * math.exp(-t / 0.02)
        out.append(math.sin(TAU * fc * t + k * math.sin(TAU * fm * t)) * math.exp(-t / decay))
    return stereo(out)


def rumble(seed=10):
    k = kick(200, 45, 0.03, 0.3, punch=3.0, sec=0.6)[0]
    l, r = reverb(k, room=0.9, damp=0.5, wet=1.0, tail=1.2)
    return [drive(biquad(biquad(s, 'lp', 180), 'lp', 180), 2.0) for s in (l, r)]


def reverse(stereo_x, sec):
    n = n_of(sec)
    out = []
    for s in stereo_x:
        r = s[:n][::-1]
        out.append([v * (i / n) ** 2 for i, v in enumerate(r)])           # swell in
    return out


# ---- the kits ---------------------------------------------------------------------------
# (label, max seconds, sound)

DROOM = (0.55, 0.4, 0.18)            # small room for snares
BIG = (0.88, 0.35, 0.42)             # big hall: dubstep snare

KITS = {
    # 909-style: round kick, tuned snare, airy hats, claps with a little room
    'House': lambda: [
        ('Kick', 0.8, kick(230, 52, 0.03, 0.42, hold=0.03, click=0.4, punch=1.4)),
        ('Snare', 0.6, snare((185, 330), 0.09, 0.17, hp=1300, lp=9500)),
        ('Clap', 0.9, clap(0.14, 1150, verb=(0.5, 0.4, 0.15))),
        ('Rim', 0.2, rim()),
        ('Closed HH', 0.3, hat(0.045, tune=1.05, noise_mix=0.5)),
        ('Pedal HH', 0.4, hat(0.085, tune=1.05, noise_mix=0.5, attack=0.004)),
        ('Open HH', 1.4, hat(0.38, tune=1.05, noise_mix=0.5)),
        ('Snare 2', 0.4, snare((200, 360), 0.05, 0.09, hp=2000, lp=11000, tone_mix=0.4, seed=12)),
        ('Low Tom', 0.9, tom(95)),
        ('Mid Tom', 0.8, tom(135, 0.26)),
        ('High Tom', 0.7, tom(185, 0.22)),
        ('Conga', 0.6, conga(330)),
        ('Crash', 3.0, cymbal(1.1, 1.7)),
        ('Ride', 2.5, cymbal(0.9, 2.1, sec=2.5, bell=0.25, hp=4000, seed=16)),
        ('Shaker', 0.4, shaker()),
        ('Cowbell', 0.8, cowbell()),
    ],
    # harder and drier: driven kick, metallic hats, noisy snare, rumble
    'Techno': lambda: [
        ('Kick', 0.7, kick(320, 47, 0.022, 0.34, hold=0.02, click=0.7, punch=3.2, lp=7000)),
        ('Snare', 0.5, snare((195, 340), 0.06, 0.12, hp=1800, punch=2.2, seed=21)),
        ('Clap', 0.6, clap(0.1, 1300, seed=22)),
        ('Rim', 0.2, rim((1850, 520), 0.014)),
        ('Closed HH', 0.3, hat(0.035, tune=1.25, noise_mix=0.2, punch=1.8)),
        ('Pedal HH', 0.4, hat(0.07, tune=1.25, noise_mix=0.2, attack=0.003, punch=1.8)),
        ('Open HH', 1.2, hat(0.3, tune=1.25, noise_mix=0.2, punch=1.6)),
        ('Noise Snare', 0.4, snare((240,), 0.03, 0.1, hp=3000, lp=12000, tone_mix=0.2, punch=2.5, seed=23)),
        ('Low Tom', 0.9, tom(85, punch=2.0)),
        ('Mid Tom', 0.8, tom(120, 0.24, punch=2.0)),
        ('High Tom', 0.7, tom(165, 0.2, punch=2.0)),
        ('Perc', 0.4, perc()),
        ('Crash', 3.0, cymbal(1.0, 1.9, seed=26)),
        ('Ride', 2.5, cymbal(0.7, 2.4, sec=2.5, bell=0.35, hp=4500, seed=27)),
        ('Rumble', 1.6, rumble()),
        ('Cowbell', 0.8, cowbell(0.18)),
    ],
    # half-time weight: deep kick, huge snare, subs and FX
    'Dubstep': lambda: [
        ('Kick', 0.8, kick(190, 46, 0.035, 0.38, hold=0.04, click=0.8, punch=2.4)),
        ('Snare', 1.8, snare((200, 410), 0.1, 0.22, hp=900, lp=10000, tone_mix=0.7, punch=1.8, verb=BIG, seed=31)),
        ('Clap', 1.4, clap(0.16, 1000, verb=(0.8, 0.4, 0.3), seed=32)),
        ('Rim', 0.2, rim((1600, 450), 0.02)),
        ('Closed HH', 0.3, hat(0.04, tune=0.95, noise_mix=0.4, dark=12000)),
        ('Pedal HH', 0.4, hat(0.08, tune=0.95, noise_mix=0.4, attack=0.004, dark=12000)),
        ('Open HH', 1.4, hat(0.4, tune=0.95, noise_mix=0.4, dark=12000)),
        ('Snap', 0.5, snare((260,), 0.04, 0.08, hp=2500, lp=12000, tone_mix=0.3, punch=2.0, seed=33)),
        ('Sub', 1.4, sub(43.65)),                                  # F1
        ('Sub Drop', 1.8, sub_drop()),
        ('Tom', 0.9, tom(110, 0.3, punch=1.8)),
        ('Zap', 0.5, zap()),
        ('Crash', 3.0, cymbal(1.3, 1.5, seed=36)),
        ('Ride', 2.5, cymbal(0.8, 2.0, sec=2.5, bell=0.3, hp=4000, seed=37)),
        ('Shaker', 0.4, shaker(f=5500, seed=38)),
        ('Reverse Crash', 1.6, reverse(cymbal(1.3, 1.5, seed=39), 1.6)),
    ],
    # tight and bright: short kick, cracking snare with a ring, crisp hats, sub
    'DnB': lambda: [
        ('Kick', 0.5, kick(270, 58, 0.014, 0.2, hold=0.01, click=0.9, punch=2.0)),
        ('Snare', 0.8, snare((225, 450), 0.12, 0.15, hp=1800, lp=12000, tone_mix=0.75, punch=1.9, verb=DROOM, seed=41)),
        ('Clap', 0.7, clap(0.11, 1400, verb=(0.4, 0.4, 0.12), seed=42)),
        ('Rim', 0.2, rim((2000, 560), 0.012)),
        ('Closed HH', 0.3, hat(0.03, tune=1.15, noise_mix=0.45, hp=8000)),
        ('Pedal HH', 0.4, hat(0.06, tune=1.15, noise_mix=0.45, hp=8000, attack=0.003)),
        ('Open HH', 1.0, hat(0.25, tune=1.15, noise_mix=0.45, hp=8000)),
        ('Ghost Snare', 0.3, snare((240,), 0.03, 0.06, hp=2500, lp=10000, tone_mix=0.4, punch=1.2, seed=43)),
        ('Sub', 1.4, sub(41.2, decay=0.5, hold=0.25)),            # E1
        ('Low Tom', 0.8, tom(120, 0.22)),
        ('High Tom', 0.7, tom(175, 0.18)),
        ('Crunch Snare', 0.6, snare((210,), 0.05, 0.14, hp=1200, lp=8000, tone_mix=0.5, punch=4.0, seed=44)),
        ('Crash', 3.0, cymbal(1.0, 1.8, seed=46)),
        ('Ride', 2.5, cymbal(0.7, 2.3, sec=2.5, bell=0.4, hp=4500, seed=47)),
        ('Tambourine', 0.6, tambourine()),
        ('Reverse Crash', 1.6, reverse(cymbal(1.0, 1.8, seed=49), 1.6)),
    ],
}


# ---- output -----------------------------------------------------------------------------

def finish(sig, max_len):
    """Normalise to -1 dBFS, trim the tail below -60 dB, cap the length, fade out."""
    n = min(max(len(c) for c in sig), n_of(max_len))
    sig = [pad_to(c, n / FS)[:n] for c in sig]
    peak = max(abs(v) for c in sig for v in c) or 1.0
    g = 10 ** (-1 / 20) / peak
    sig = [[v * g for v in c] for c in sig]
    floor = 10 ** (-61 / 20)
    end = max(i for c in sig for i in range(len(c) - 1, -1, -1) if abs(c[i]) > floor) + 1
    end = min(n, end + n_of(0.03))
    fade = min(n_of(0.06), end // 4)
    return [[v * (min(1.0, (end - i) / fade) if i >= end - fade else 1.0) for i, v in enumerate(c[:end])] for c in sig]


def write_flac(sig, path):
    l, r = sig
    with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as tmp:
        wav = tmp.name
    with wave.open(wav, 'wb') as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(FS)
        frames = bytearray()
        for a, b in zip(l, r):
            for v in (a, b):
                frames += int(max(-32768, min(32767, round(v * 32767)))).to_bytes(2, 'little', signed=True)
        w.writeframes(bytes(frames))
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', wav, '-c:a', 'flac', '-compression_level', '8',
                    '-fflags', '+bitexact', '-flags:a', '+bitexact', path], check=True)
    os.remove(wav)
    return len(l) / FS


def main():
    index_path = os.path.join(OUT, 'index.json')
    index = json.load(open(index_path)) if os.path.exists(index_path) else []
    for name, build in KITS.items():
        pads = build()
        assert len(pads) == 16, name
        kdir = os.path.join(OUT, f'{name}.zkit')
        shutil.rmtree(kdir, ignore_errors=True)
        os.makedirs(os.path.join(kdir, 'samples'))
        out_pads = []
        for i, (label, max_len, sig) in enumerate(pads):
            fname = f'{i + 1:02d}-{re.sub(r"[^a-z0-9]+", "-", label.lower()).strip("-")}.flac'
            dur = write_flac(finish(sig, max_len), os.path.join(kdir, 'samples', fname))
            out_pads.append({'file': fname, 'label': label})
            print(f'  {name:8s} {i + 1:2d} {label:14s} {dur:4.2f}s')
        json.dump({'format': 'zerkit-kit', 'version': 1, 'name': name, 'pads': out_pads},
                  open(os.path.join(kdir, 'kit.json'), 'w'), indent=1)
        if name not in index:
            index.append(name)
    json.dump(index, open(index_path, 'w'))
    print('kits:', index)


if __name__ == '__main__':
    main()
