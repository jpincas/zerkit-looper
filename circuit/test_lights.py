"""Emulator checks for the LOOP04 light code (Unicorn)."""
import struct
import sys
from unicorn import Uc, UC_ARCH_ARM, UC_MODE_THUMB, UC_MODE_MCLASS, UC_HOOK_CODE
from unicorn.arm_const import *
import fw
import build_lights as L

FLASH, RAM, SP0, CALLER = 0x08000000, 0x20000000, 0x20010000, 0x08012341
OUT, MSG, BUF = 0x20002000, 0x20003000, 0x20003100
GUARD = 0xA5


class Dev:
    def __init__(self, img):
        self.mu = Uc(UC_ARCH_ARM, UC_MODE_THUMB | UC_MODE_MCLASS)
        self.mu.mem_map(FLASH, 0x80000)
        self.mu.mem_write(fw.APP_BASE, img)
        self.mu.mem_map(RAM, 0x50000)
        self.mu.mem_write(L.RAM_SIG, bytes([GUARD]) * 0x200)       # power-on garbage + guard after the frame
        self.mu.hook_add(UC_HOOK_CODE, self._code)
        self.stop_at = None

    def _code(self, uc, addr, size, _):
        if addr in (CALLER & ~1, self.stop_at):
            uc.emu_stop()

    def call(self, entry, r0=0, r1=0, r2=0, stop_at=None):
        self.stop_at = stop_at
        for r, v in ((UC_ARM_REG_R0, r0), (UC_ARM_REG_R1, r1), (UC_ARM_REG_R2, r2),
                     (UC_ARM_REG_SP, SP0), (UC_ARM_REG_LR, CALLER)):
            self.mu.reg_write(r, v)
        self.mu.emu_start(entry | 1, 0, count=5000)
        return self.mu.reg_read(UC_ARM_REG_PC), self.mu.reg_read(UC_ARM_REG_SP)

    def frame(self):
        return list(struct.unpack(f'<{L.N_LEDS}H', self.mu.mem_read(L.FRAME, 2 * L.N_LEDS)))

    def sysex(self, entry, data):
        self.mu.mem_write(BUF, bytes(data))
        self.mu.mem_write(MSG, struct.pack('<II', BUF, len(data)))
        return self.call(entry, 0, MSG, 0x1234, stop_at=L.SX_IN + 4)


def main(path):
    img, base, listing, labels = L.build(fw.load_stock(path))
    ok_all = True

    def check(cond, what):
        nonlocal ok_all
        print(f'{"ok  " if cond else "FAIL"} {what}')
        ok_all &= bool(cond)

    d = Dev(img)
    # 1. the LED task replacement on garbage RAM: clears the frame, writes the signature, copies zeros
    d.mu.mem_write(OUT, b'\x77' * 0x100)
    pc, sp = d.call(labels['c_leds'], 0x20001000, OUT)
    sig = struct.unpack('<I', d.mu.mem_read(L.RAM_SIG, 4))[0]
    check(sig == L.SIG, 'signature written on first use')
    check(d.frame() == [0] * L.N_LEDS, 'garbage frame cleared to 0 (all LEDs off)')
    out = d.mu.mem_read(OUT, 0x100)
    check(out[:2 * L.N_LEDS] == bytes(2 * L.N_LEDS) and set(out[2 * L.N_LEDS:]) == {0x77},
          'stock frame gets exactly 69 halfwords, nothing beyond')
    check(pc == CALLER & ~1 and sp == SP0, 'returns to the caller with sp restored')
    guard_after = lambda: set(d.mu.mem_read(L.RAM_SIG + 4 + 140, 0x40)) == {GUARD}
    check(guard_after(), 'nothing written past our 140-byte area')

    # 2. set one LED
    pc, sp = d.sysex(labels['c_sx'], [0xF0, 0x7D, 0x01, 48, 0x53, 0xF7])        # Record LED red
    f = d.frame()
    check(f[48] == 0x53 and sum(1 for v in f if v) == 1, 'F0 7D 01 48 53 F7 -> LED 48 = 0x53 only')
    check(pc == CALLER & ~1 and sp == SP0, 'our SysEx returns to the caller (stock dispatcher not run)')

    # 3. a full frame
    colours = [(i * 7 + 3) % 128 for i in range(L.N_LEDS)]
    d.sysex(labels['c_sx'], [0xF0, 0x7D, 0x02, 0] + colours + [0xF7])
    check(d.frame() == colours, 'F0 7D 02 00 <69 colours> F7 -> whole frame')
    d.mu.mem_write(OUT, b'\x77' * 0x100)
    d.call(labels['c_leds'], 0x20001000, OUT)
    check(list(struct.unpack(f'<{L.N_LEDS}H', d.mu.mem_read(OUT, 2 * L.N_LEDS))) == colours,
          'LED task copies the frame into the stock frame')

    # 4. a run that overshoots LED 68 stops there; an out-of-range single LED is ignored
    d.sysex(labels['c_sx'], [0xF0, 0x7D, 0x02, 66] + [0x11] * 10 + [0xF7])
    f = d.frame()
    check(f[66:] == [0x11] * 3 and f[:66] == colours[:66], 'run from 66 writes 66-68 only')
    d.sysex(labels['c_sx'], [0xF0, 0x7D, 0x01, 69, 0x53, 0xF7])
    d.sysex(labels['c_sx'], [0xF0, 0x7D, 0x01, 5, 0xF7])                         # too short
    d.sysex(labels['c_sx'], [0xF0, 0x7D, 0x02, 0, 0xF7])                         # no colours
    d.sysex(labels['c_sx'], [0xF0, 0x7D, 0x09, 0, 1, 2, 0xF7])                   # unknown command
    check(d.frame() == f, 'out-of-range, short, empty and unknown commands change nothing')
    check(guard_after(), 'still nothing written past our area')

    # 5. somebody else's SysEx goes to stock untouched
    pc, sp = d.sysex(labels['c_sx'], [0xF0, 0x7E, 0x7F, 0x06, 0x01, 0xF7])
    regs = [d.mu.reg_read(r) for r in (UC_ARM_REG_R0, UC_ARM_REG_R1, UC_ARM_REG_R2)]
    stacked = struct.unpack('<6I', d.mu.mem_read(sp, 24))
    check(pc == L.SX_IN + 4, 'identity request continues into stock at 0x0801EB34')
    check(regs == [0, MSG, 0x1234], 'with port, msg and x intact')
    check(sp == SP0 - 24 and stacked[5] == CALLER, 'and the displaced push.w {r4-r8, lr} done')
    check(d.frame() == f, 'and our frame untouched')

    # 6. the signature survives: a second LED-task call doesn't clear a set frame
    d.call(labels['c_leds'], 0x20001000, OUT)
    check(d.frame() == f, 'frame kept once the signature is there')

    print('ALL PASSED' if ok_all else 'SOME CHECKS FAILED')
    return ok_all


if __name__ == '__main__':
    sys.exit(0 if main(sys.argv[1]) else 1)
