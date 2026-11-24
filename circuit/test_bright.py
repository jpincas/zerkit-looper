"""Emulator checks for LOOP05's knob brightness (Unicorn).

    .venv/bin/python test_bright.py incoming/circuittracks-firmware-4486.syx

Runs the stock LED converter 0x0803423c with our hook in it, over a palette and a frame we
control, and checks what it hands on for each LED.
"""
import struct
import sys
from unicorn import UC_HOOK_CODE
from unicorn.arm_const import *
import fw
import build_lights as L
from test_lights import Dev, CALLER, SP0, GUARD

CONVERT = 0x0803423C
PARAM_GET = 0x0803542C                 # stock: returns a pointer to a parameter's value
CTRL, FLAGS, ZERO, PAL = 0x20020000, 0x20020400, 0x20020500, L.PALETTE_PTR
STOCK_FRAME, RGB_OUT = 0x20021000, 0x20022000
KNOBS = range(60, 69)


def palette(code):                     # a recognisable colour per code: 0x00BBGGRR
    return (code * 2 & 0xFF) | (0xF0 << 8) | (0x40 << 16)


def scaled(rgb, b):                    # the stock scaler 0x080475a6
    f = (b * 0x1CC + 0x1A00) & 0xFFFFFFFF
    return sum(((rgb >> (8 * k) & 0xFF) * f >> 16) << (8 * k) for k in range(3))


class Conv(Dev):
    def __init__(self, img):
        super().__init__(img)
        mu = self.mu
        mu.mem_write(PAL, b''.join(struct.pack('<I', palette(c)) for c in range(0x200)))
        mu.mem_write(ZERO, bytes(16))
        mu.mem_write(FLAGS, bytes(16))
        mu.mem_write(CTRL + 0x70, struct.pack('<I', FLAGS))
        mu.mem_write(CTRL + 0x78, struct.pack('<I', 0x12345678))
        self.dim = False
        mu.hook_add(UC_HOOK_CODE, self._param, begin=PARAM_GET, end=PARAM_GET)

    def _param(self, uc, addr, size, _):            # stub: the "dim" flag word, then return
        uc.mem_write(ZERO, struct.pack('<I', (1 << 10) if self.dim else 0))
        uc.reg_write(UC_ARM_REG_R0, ZERO)
        uc.reg_write(UC_ARM_REG_PC, uc.reg_read(UC_ARM_REG_LR))

    def convert(self, codes):
        self.mu.mem_write(STOCK_FRAME, struct.pack(f'<{L.N_LEDS}H', *codes))
        self.mu.mem_write(RGB_OUT, b'\x77' * 4 * 80)
        for r, v in ((UC_ARM_REG_R0, CTRL), (UC_ARM_REG_R1, RGB_OUT), (UC_ARM_REG_R2, STOCK_FRAME),
                     (UC_ARM_REG_SP, SP0), (UC_ARM_REG_LR, CALLER)):
            self.mu.reg_write(r, v)
        self.stop_at = None
        self.mu.emu_start(CONVERT | 1, 0, count=200000)
        assert self.mu.reg_read(UC_ARM_REG_PC) == CALLER & ~1
        return list(struct.unpack(f'<{L.N_LEDS}I', self.mu.mem_read(RGB_OUT, 4 * L.N_LEDS)))

    def bright(self):
        return list(self.mu.mem_read(L.BRIGHT, 9))


def main(path):
    stock = fw.load_stock(path)
    img, base, listing, labels = L.build(stock, bright=True)
    ok_all = True

    def check(cond, what):
        nonlocal ok_all
        print(f'{"ok  " if cond else "FAIL"} {what}')
        ok_all &= bool(cond)

    codes = [(i * 5 + 1) % 128 for i in range(L.N_LEDS)]

    # 0. stock converter, unpatched: every LED is just its palette colour
    s = Conv(stock)
    out = s.convert(codes)
    check(out == [palette(c) for c in codes], 'stock: every LED = palette[code]')

    d = Conv(img)
    # 1. first use on garbage RAM: new signature, frame off, every knob at full
    d.call(labels['c_leds'], 0x20001000, STOCK_FRAME)
    check(struct.unpack('<I', d.mu.mem_read(L.RAM_SIG, 4))[0] == L.SIG5, 'LOOP05 signature written')
    check(d.bright() == [L.FULL] * 9, 'knob brightness starts at full (127)')
    check(set(d.mu.mem_read(L.BRIGHT + 9, 3)) <= {L.FULL} and set(d.mu.mem_read(L.BRIGHT + 12, 0x40)) == {GUARD},
          'nothing written past the brightness bytes')

    # 2. at full, the converter's output is exactly stock
    check(d.convert(codes) == out, 'patched, all knobs at 127: output identical to stock')

    # 3. set brightness by SysEx; LEDs below 60 are skipped, the run stops after 68
    vals = [0, 10, 40, 63, 90, 120, 126, 127, 64]
    pc, sp = d.sysex(labels['c_sx'], [0xF0, 0x7D, 0x03, 58, 5, 6] + vals + [1, 2, 0xF7])
    check(d.bright() == vals, f'F0 7D 03 58 ... -> knob brightness {d.bright()}')
    check(pc == CALLER & ~1 and sp == SP0, 'brightness SysEx returns to the caller')
    check(set(d.mu.mem_read(L.BRIGHT + 12, 0x40)) == {GUARD}, 'still nothing written past them')
    d.sysex(labels['c_sx'], [0xF0, 0x7D, 0x03, 64, 33, 0xF7])
    vals[4] = 33
    check(d.bright() == vals, 'F0 7D 03 64 33 F7 -> just knob 5 changes')
    d.sysex(labels['c_sx'], [0xF0, 0x7D, 0x03, 69, 1, 0xF7])
    d.sysex(labels['c_sx'], [0xF0, 0x7D, 0x03, 60, 0xF7])
    check(d.bright() == vals, 'out-of-range and empty brightness commands change nothing')

    # 4. the converter scales each knob by its brightness; pads and buttons untouched
    got = d.convert(codes)
    want = [scaled(palette(codes[i]), vals[i - 60]) if i in KNOBS and vals[i - 60] < 127 else palette(codes[i])
            for i in range(L.N_LEDS)]
    check(got[:60] == out[:60], 'pads and buttons: unchanged')
    check(got[60:] == want[60:], 'knobs: palette colour scaled by brightness')
    for i in KNOBS:
        print(f'      LED {i}: code {codes[i]:#04x} brightness {vals[i - 60]:3d}  {out[i]:06x} -> {got[i]:06x}')
    lo, hi = scaled(0xFFFFFF, 0) & 0xFF, scaled(0xFFFFFF, 126) & 0xFF
    print(f'      scale range: brightness 0 -> {lo}/255, 126 -> {hi}/255')

    # 5. code 0 (off) stays off at any brightness
    got = d.convert([0] * L.N_LEDS)
    check(all(got[i] == scaled(palette(0), vals[i - 60]) if vals[i - 60] < 127 else got[i] == palette(0) for i in KNOBS),
          'code 0 scales like any other colour (palette[0] is the device\'s "off")')

    # 6. the stock "dim" mode still halves our brightness (as it did for its own)
    d.dim = True
    got = d.convert(codes)
    check(got[63] == scaled(palette(codes[63]), vals[3] >> 1), 'dim mode: brightness halved')

    print('ALL PASSED' if ok_all else 'SOME CHECKS FAILED')
    return ok_all


if __name__ == '__main__':
    sys.exit(0 if main(sys.argv[1]) else 1)
