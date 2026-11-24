"""Emulator check for LOOP3D: each hook sends its message, then [BE 64 gate&7F], both via the router."""
import struct, sys
from unicorn import Uc, UC_ARCH_ARM, UC_MODE_THUMB, UC_MODE_MCLASS, UC_HOOK_CODE
from unicorn.arm_const import *
import fw, build_takeover as B
from test_takeover import CASES, ENTRY, FLASH, RAM, SP0, CALLER

ROUTER_OBJ, GATE = 0x20003000, 0x45   # gate word with bits 0, 2 and 6 set

def run(img, entry, index, value):
    mu = Uc(UC_ARCH_ARM, UC_MODE_THUMB | UC_MODE_MCLASS)
    mu.mem_map(FLASH, 0x80000); mu.mem_write(fw.APP_BASE, img); mu.mem_map(RAM, 0x20000)
    mu.mem_write(B.ROUTER_PTR, struct.pack('<I', ROUTER_OBJ)); mu.mem_write(B.MIDI_GATE, struct.pack('<I', GATE))
    for r, v in ((UC_ARM_REG_R0, 0x20001000), (UC_ARM_REG_R1, index), (UC_ARM_REG_R2, value),
                 (UC_ARM_REG_SP, SP0), (UC_ARM_REG_LR, CALLER)):
        mu.reg_write(r, v)
    sent, done = [], [False]
    def on_code(uc, addr, size, _):
        if addr == B.MIDI_SEND: sent.append(('GATED SENDER USED', [], 0, 0))
        if addr == B.ROUTER_SEND:
            sent.append((uc.reg_read(UC_ARM_REG_R0), list(uc.mem_read(uc.reg_read(UC_ARM_REG_R2), 3)),
                         uc.reg_read(UC_ARM_REG_R1), uc.reg_read(UC_ARM_REG_SP) % 8))
            uc.reg_write(UC_ARM_REG_PC, uc.reg_read(UC_ARM_REG_LR))
        if addr == CALLER & ~1: done[0] = True; uc.emu_stop()
    mu.hook_add(UC_HOOK_CODE, on_code)
    mu.emu_start(entry | 1, 0, count=400)
    return sent, done[0], mu.reg_read(UC_ARM_REG_SP)

img, *_ = B.build(fw.load_stock(sys.argv[1]), diag=True)
ok_all = True
for hook, index, value, want in CASES:
    sent, returned, sp = run(img, ENTRY[hook], index, value)
    ok = (len(sent) == 2 and all(s[0] == ROUTER_OBJ and s[2] == 7 and s[3] == 0 for s in sent)
          and sent[0][1] == want and sent[1][1] == [0xBE, 100, GATE] and returned and sp == SP0)
    ok_all &= ok
    print(f'{"ok  " if ok else "FAIL"} {hook:<15} -> ' + ' | '.join(' '.join(f'{b:02x}' for b in s[1]) for s in sent))
print('ALL PASSED' if ok_all else 'SOME CHECKS FAILED'); sys.exit(0 if ok_all else 1)
