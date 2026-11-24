"""Run every LOOP02 hook in an ARM emulator (Unicorn), entering at the stock handler's address.

Checks per call: exactly one message reaches the stock MIDI sender with port mask 7 and the
expected bytes, the stack is 8-byte aligned at that call, and execution returns straight to
the controller's caller with sp back where it started (so no stock handler code runs).
"""
import sys
from unicorn import Uc, UC_ARCH_ARM, UC_MODE_THUMB, UC_MODE_MCLASS, UC_HOOK_CODE
from unicorn.arm_const import *
import fw
import build_takeover as B

FLASH, RAM, SP0 = 0x08000000, 0x20000000, 0x20010000
CALLER = 0x08012341
ENTRY = {name: entry for name, entry, _, _ in B.HOOKS}

CASES = [  # (hook, index r1, value r2, expected bytes)
    ('pad press', 0, 100, [0x9E, 0, 100]),
    ('pad press', 31, 1, [0x9E, 31, 1]),
    ('pad press', 12, 200, [0x9E, 12, 200 & 0x7F]),
    ('pad release', 31, 0, [0x8E, 31, 0]),
    ('button press', 16, 0, [0xBE, 36, 127]),        # Record
    ('button release', 16, 0, [0xBE, 36, 0]),
    ('button press', 27, 0, [0xBE, 47, 127]),        # Shift
    ('button release', 0, 0, [0xBE, 20, 0]),         # Synth 1
    ('macro knob', 0, 1, [0xBE, 1, 1]),
    ('macro knob', 7, 0xFFFFFFFF, [0xBE, 8, 0x7F]),  # a -1 turn reads as 127 (7-bit two's complement)
    ('macro knob', 3, 64, [0xBE, 4, 64]),
    ('master knob', 0, 5, [0xBE, 9, 5]),
    ('master knob', 1, 0xFFFFFFFE, [0xBE, 10, 0x7E]),
]


def run(img, entry, index, value):
    mu = Uc(UC_ARCH_ARM, UC_MODE_THUMB | UC_MODE_MCLASS)
    mu.mem_map(FLASH, 0x80000)
    mu.mem_write(fw.APP_BASE, img)
    mu.mem_map(RAM, 0x20000)
    for r, v in ((UC_ARM_REG_R0, 0x20001000), (UC_ARM_REG_R1, index), (UC_ARM_REG_R2, value),
                 (UC_ARM_REG_SP, SP0), (UC_ARM_REG_LR, CALLER)):
        mu.reg_write(r, v)
    sent, steps, returned = [], [0], [False]

    def on_code(uc, addr, size, _):
        steps[0] += 1
        if steps[0] > 200:
            uc.emu_stop()
        if addr == B.MIDI_SEND:
            sp = uc.reg_read(UC_ARM_REG_SP)
            sent.append((uc.reg_read(UC_ARM_REG_R0), list(uc.mem_read(uc.reg_read(UC_ARM_REG_R1), 3)), sp % 8))
            uc.reg_write(UC_ARM_REG_PC, uc.reg_read(UC_ARM_REG_LR))
        if addr == CALLER & ~1:
            returned[0] = True
            uc.emu_stop()

    mu.hook_add(UC_HOOK_CODE, on_code)
    mu.emu_start(entry | 1, 0)
    return sent, returned[0], mu.reg_read(UC_ARM_REG_SP)


if __name__ == '__main__':
    img, *_ = B.build(fw.load_stock(sys.argv[1]))
    ok_all = True
    for hook, index, value, want in CASES:
        sent, returned, sp = run(img, ENTRY[hook], index, value)
        ok = (len(sent) == 1 and sent[0][0] == 7 and sent[0][1] == want and sent[0][2] == 0
              and returned and sp == SP0)
        ok_all &= ok
        got = ' '.join(f'{b:02x}' for b in sent[0][1]) if sent else 'nothing'
        print(f'{"ok  " if ok else "FAIL"} {hook:<15} index {index:<3} value {value & 0xFFFFFFFF:#x}: sent {got}'
              f'{"" if ok else f"  (want {want}, returned={returned}, sp ok={sp == SP0}, msgs={len(sent)})"}')
    print('ALL PASSED' if ok_all else 'SOME CHECKS FAILED')
    sys.exit(0 if ok_all else 1)
