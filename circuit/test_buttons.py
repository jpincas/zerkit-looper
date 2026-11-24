"""Run the patched press/release handlers in an ARM emulator (Unicorn).

For each hook: start at the stock entry point as the firmware would (r0 = ctrl, r1 = button id,
lr = caller), intercept the stock MIDI sender to capture what we send, and stop when execution
returns to the stock handler. Then check that everything stock code relies on is exactly as if
the original prologue had run: r0/r1 preserved, r4 = ctrl, sp moved by 16, and the stacked
{r3, r4, r5, lr} hold the caller's values.
"""
import struct
import sys
from unicorn import Uc, UC_ARCH_ARM, UC_MODE_THUMB, UC_MODE_MCLASS, UC_HOOK_CODE
from unicorn.arm_const import *
import fw
import build_buttons as B

FLASH, RAM, SP0 = 0x08000000, 0x20000000, 0x20010000
CALLER = 0x08012341             # fake return address (thumb bit set)


def run(img, entry, resume, button):
    mu = Uc(UC_ARCH_ARM, UC_MODE_THUMB | UC_MODE_MCLASS)
    mu.mem_map(FLASH, 0x80000)
    mu.mem_write(fw.APP_BASE, img)
    mu.mem_map(RAM, 0x20000)
    regs = {UC_ARM_REG_R0: 0x20001000, UC_ARM_REG_R1: button, UC_ARM_REG_R2: 0x2222,
            UC_ARM_REG_R3: 0x3333, UC_ARM_REG_R4: 0x4444, UC_ARM_REG_R5: 0x5555,
            UC_ARM_REG_SP: SP0, UC_ARM_REG_LR: CALLER}
    for r, v in regs.items():
        mu.reg_write(r, v)
    sent, steps = [], [0]

    def on_code(uc, addr, size, _):
        steps[0] += 1
        if steps[0] > 200:
            uc.emu_stop()
        if addr == B.MIDI_SEND:                       # stand-in for the stock sender
            ports = uc.reg_read(UC_ARM_REG_R0)
            msg = bytes(uc.mem_read(uc.reg_read(UC_ARM_REG_R1), 3))
            sent.append((ports, msg, uc.reg_read(UC_ARM_REG_SP) % 8))
            uc.reg_write(UC_ARM_REG_PC, uc.reg_read(UC_ARM_REG_LR))
        if addr == resume:
            uc.emu_stop()

    mu.hook_add(UC_HOOK_CODE, on_code)
    mu.emu_start(entry | 1, 0)
    pc = mu.reg_read(UC_ARM_REG_PC)
    sp = mu.reg_read(UC_ARM_REG_SP)
    stacked = struct.unpack('<4I', mu.mem_read(sp, 16))
    return dict(pc=pc, sent=sent, sp=sp, stacked=stacked,
                r0=mu.reg_read(UC_ARM_REG_R0), r1=mu.reg_read(UC_ARM_REG_R1), r4=mu.reg_read(UC_ARM_REG_R4))


def check(name, res, button, value):
    ok = True
    def expect(cond, what):
        nonlocal ok
        print(f'  {"ok  " if cond else "FAIL"} {what}')
        ok &= cond
    expect(len(res['sent']) == 1, 'sent exactly one MIDI message')
    if res['sent']:
        ports, msg, align = res['sent'][0]
        expect(ports == 7, f'port mask 7 (USB + DIN outs): {ports}')
        expect(msg == bytes([0xBE, 20 + button, value]), f'message = {msg.hex(" ")} (CC {20 + button} on ch15 = {value})')
        expect(align == 0, 'stack 8-byte aligned at the call')
    expect(res['r0'] == 0x20001000 and res['r1'] == button, 'r0 (ctrl) and r1 (id) preserved')
    expect(res['r4'] == 0x20001000, 'r4 = ctrl, as the stock prologue leaves it')
    expect(res['sp'] == SP0 - 16, 'sp moved by 16, as the stock prologue leaves it')
    expect(res['stacked'] == (0x3333, 0x4444, 0x5555, CALLER), 'stacked {r3, r4, r5, lr} = caller values')
    return ok


if __name__ == '__main__':
    img, *_ = B.build(fw.load_stock(sys.argv[1]))
    all_ok = True
    for name, entry, value in (('press', B.PRESS, 127), ('release', B.RELEASE, 0)):
        for button in (0, 16, 27):                     # Synth 1, Record, Shift
            print(f'{name} button {button}:')
            all_ok &= check(name, run(img, entry, entry + 4, button), button, value)
    print('ALL PASSED' if all_ok else 'SOME CHECKS FAILED')
    sys.exit(0 if all_ok else 1)
