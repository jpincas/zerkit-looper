"""Emulator checks for LOOP06's splash screen (Unicorn).

    .venv/bin/python test_splash.py incoming/circuittracks-firmware-4486.syx

Runs our LED task on power-on RAM, steps the stock 1 ms tick, and checks the pads show
"LOOP" scrolling until the app's first SysEx message, which ends it and clears the pads.
"""
import struct
import sys
import fw
import build_lights as L
from test_lights import Dev, OUT, CALLER, SP0, GUARD

CHAR = {0: '.', 0x53: 'R', 0x45: 'O', 0x2D: 'Y', 0x17: 'G'}


def window(pos):                       # what the 32 pads should show at a scroll position
    rows = L.splash_strip()
    return [rows[r][(pos + c) % L.SPLASH_W] for r in range(4) for c in range(8)]


def show(pads):
    return '\n'.join('      ' + ''.join(CHAR.get(x, '?') for x in pads[8 * r:8 * r + 8]) for r in range(4))


def main(path):
    img, base, listing, labels = L.build(fw.load_stock(path), splash=True)
    ok_all = True

    def check(cond, what):
        nonlocal ok_all
        print(f'{"ok  " if cond else "FAIL"} {what}')
        ok_all &= bool(cond)

    d = Dev(img)
    words = lambda: struct.unpack('<3I', d.mu.mem_read(L.SPLASH, 12))
    set_tick = lambda t: d.mu.mem_write(L.TICK, struct.pack('<I', t & 0xFFFFFFFF))

    def leds():
        pc, sp = d.call(labels['c_leds'], 0x20001000, OUT)
        assert pc == CALLER & ~1 and sp == SP0, 'c_leds did not return cleanly'
        out = list(struct.unpack(f'<{L.N_LEDS}H', d.mu.mem_read(OUT, 2 * L.N_LEDS)))
        assert out == d.frame(), 'stock frame differs from ours'
        return out

    print(f'strip: {L.SPLASH_W} columns')
    print(show([x for r in L.splash_strip() for x in r[:8]]).replace('      ', '      strip 0-7: ', 1))

    # 1. power-on: new signature, splash on at the start position, knobs at full
    set_tick(0)
    out = leds()
    check(struct.unpack('<I', d.mu.mem_read(L.RAM_SIG, 4))[0] == L.SIG6, 'LOOP06 signature written')
    check(words() == (1, 0, L.SPLASH_START), f'splash on, position {L.SPLASH_START}: {words()}')
    check(list(d.mu.mem_read(L.BRIGHT, 9)) == [L.FULL] * 9, 'knob brightness starts at full')
    check(set(d.mu.mem_read(L.SPLASH + 12, 0x40)) == {GUARD}, 'nothing written past the splash words')
    check(out[:32] == window(L.SPLASH_START), 'pads show the strip at the start position')
    check(out[32:] == [0] * (L.N_LEDS - 32), 'buttons and knobs stay off')
    print(show(out[:32]))

    # 2. under 110 ms later: no step; at 110 ms: one column
    set_tick(L.STEP_MS - 1)
    check(leds()[:32] == window(L.SPLASH_START), '109 ms: still the same position')
    set_tick(L.STEP_MS)
    out = leds()
    check(words()[2] == L.SPLASH_START + 1 and out[:32] == window(L.SPLASH_START + 1), '110 ms: moved one column')

    # 3. a full cycle and a bit: every position drawn right, wraps after the last column
    t, pos, good, seen = L.STEP_MS, L.SPLASH_START + 1, True, []
    for _ in range(L.SPLASH_W + 5):
        t += L.STEP_MS
        set_tick(t)
        pos = (pos + 1) % L.SPLASH_W
        out = leds()
        good &= words()[2] == pos and out[:32] == window(pos)
        seen.append(out[:32])
    check(good, f'{L.SPLASH_W + 5} steps: every position right, wrapping at {L.SPLASH_W}')
    for k in range(3, 26, 4):
        print(f'      position {(L.SPLASH_START + 2 + k) % L.SPLASH_W}:')
        print(show(seen[k]))

    # 4. the tick wrapping round 2^32 still steps
    d.mu.mem_write(L.SPLASH + 4, struct.pack('<I', 0xFFFFFFF0))
    set_tick(0x60)
    before = words()[2]
    leds()
    check(words()[2] == (before + 1) % L.SPLASH_W, 'tick wrap-around: still steps')

    # 5. a garbage position (e.g. RAM damage) is reset rather than read past the table
    d.mu.mem_write(L.SPLASH + 8, struct.pack('<I', 200))
    check(leds()[:32] == window(0) and words()[2] == 0, 'out-of-range position reset to 0')

    # 6. the app's first message ends the splash, clears the pads, then applies the message
    pc, sp = d.sysex(labels['c_sx'], [0xF0, 0x7D, 0x01, 5, 0x17, 0xF7])
    check(pc == CALLER & ~1 and sp == SP0, 'SysEx returns to the caller')
    check(words()[0] == 0, 'splash off')
    want = [0] * L.N_LEDS
    want[5] = 0x17
    check(d.frame() == want, 'pads cleared, then LED 5 set by the message')
    set_tick(0x60 + 10 * L.STEP_MS)
    check(leds() == want, 'later ticks: the splash stays off, the app\'s lights stay')

    # 7. other messages behave as in LOOP05
    d.sysex(labels['c_sx'], [0xF0, 0x7D, 0x02, 30, 1, 2, 3, 0xF7])
    want[30:33] = [1, 2, 3]
    check(d.frame() == want, 'F0 7D 02 run still works')
    d.sysex(labels['c_sx'], [0xF0, 0x7D, 0x03, 60, 50, 0xF7])
    check(d.mu.mem_read(L.BRIGHT, 1)[0] == 50, 'F0 7D 03 brightness still works')

    # 8. a reboot with RAM kept (signature present) doesn't restart the splash
    leds()
    check(words()[0] == 0, 'signature present: splash stays off')

    print('ALL PASSED' if ok_all else 'SOME CHECKS FAILED')
    return ok_all


if __name__ == '__main__':
    sys.exit(0 if main(sys.argv[1]) else 1)
