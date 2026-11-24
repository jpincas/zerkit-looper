"""Build v1: every Circuit Tracks button sends a MIDI CC when pressed and released.

    .venv/bin/python build_buttons.py incoming/circuittracks-firmware-4486.syx

Button id N (0-27) sends CC (20 + N) on channel 15: value 127 on press, 0 on release.
The buttons keep their normal behaviour (this build only adds the MIDI).

How: the stock press/release handlers (located by CIRCUIT-HACKS-RC) both start with the
4-byte prologue `push {r3,r4,r5,lr}; mov r4,r0`. We replace those 4 bytes with a `b.w` to
our code (appended after the stock image), send the CC through the stock MIDI sender
0x0803BEDA(port mask 7 = USB + both DIN outs, pointer to message), then run the prologue
we displaced and branch back.
"""
import sys
import capstone
import fw
import thumb as T

PRESS, RELEASE = 0x08033320, 0x0803381A   # (ctrl, id) handlers
PROLOGUE = bytes.fromhex('38b50446')        # push {r3, r4, r5, lr}; mov r4, r0
MIDI_SEND = 0x0803BEDA
STATUS = 0xBE                               # Control Change, channel 15
CC_BASE = 20
MARK = b'LOOP01'                            # in the version block, so the bootloader installs it


def build(stock):
    img = bytearray(stock)
    base = fw.APP_BASE + ((len(img) + 3) & ~3)
    img += b'\xFF' * (base - fw.APP_BASE - len(img))
    code, listing = bytearray(), []

    def emit(text, enc):
        listing.append((base + len(code), text))
        code.extend(enc(base + len(code)) if callable(enc) else enc)

    # send_cc(r1 = button id, r2 = value): sends [0xBE, 20 + id, value]
    send_cc = base
    emit('push {r4, lr}', T.push([4], lr=True))
    emit('sub sp, #8', T.sub_sp(8))
    emit('mov r4, sp', T.mov(4, 13))
    emit(f'movs r3, #{STATUS:#x}', T.movs(3, STATUS))
    emit('strb r3, [r4]', T.strb(3, 4, 0))
    emit(f'adds r1, #{CC_BASE}', b'\x14\x31')             # adds r1, #20  (0x3100 | imm8)
    emit('strb r1, [r4, #1]', T.strb(1, 4, 1))
    emit('strb r2, [r4, #2]', T.strb(2, 4, 2))
    emit('mov r1, r4', T.mov(1, 4))
    emit('movs r0, #7', T.movs(0, 7))
    emit(f'bl #{MIDI_SEND:#x}', lambda at: T.bl(at, MIDI_SEND))
    emit('add sp, #8', T.add_sp(8))
    emit('pop {r4, pc}', T.pop([4], pc=True))

    hooks = {}
    for name, entry, value in (('press', PRESS, 127), ('release', RELEASE, 0)):
        assert bytes(img[entry - fw.APP_BASE:entry - fw.APP_BASE + 4]) == PROLOGUE, f'{name}: stock bytes differ'
        hooks[name] = base + len(code)
        emit('push {r0, r1, r2, r3, r4, lr}', T.push([0, 1, 2, 3, 4], lr=True))   # 24 bytes: keeps 8-byte alignment
        emit(f'movs r2, #{value}', T.movs(2, value))
        emit(f'bl #{send_cc:#x}', lambda at: T.bl(at, send_cc))
        emit('pop.w {r0, r1, r2, r3, r4, lr}', T.pop_w([0, 1, 2, 3, 4], lr=True))
        emit('push {r3, r4, r5, lr}', T.push([3, 4, 5], lr=True))                # the displaced prologue
        emit('mov r4, r0', T.mov(4, 0))
        emit(f'b.w #{entry + 4:#x}', lambda at, e=entry: T.b_w(at, e + 4))

    img += code
    for name, entry in (('press', PRESS), ('release', RELEASE)):
        img[entry - fw.APP_BASE:entry - fw.APP_BASE + 4] = T.b_w(entry, hooks[name])

    mark = fw.VERSION_MARK - 0
    assert img[mark:mark + 6] == b'\0' * 6
    img[mark:mark + 6] = MARK
    return bytes(img), base, listing, hooks


def verify(img, base, listing, hooks):
    md = capstone.Cs(capstone.CS_ARCH_ARM, capstone.CS_MODE_THUMB | capstone.CS_MODE_MCLASS)
    end = fw.APP_BASE + len(img)
    got = [(i.address, f'{i.mnemonic} {i.op_str}'.strip()) for i in md.disasm(img[base - fw.APP_BASE:], base)]
    assert got[-1][0] < end and len(got) == len(listing), 'disassembly length differs'
    import re
    norm = lambda s: re.sub(r'#(0x[0-9a-f]+|\d+)', lambda m: '#' + str(int(m.group(1), 0)), s.replace(' ', '').lower())
    for (a1, want), (a2, have) in zip(listing, got):
        assert a1 == a2 and norm(want) == norm(have), f'{a1:#x}: wanted "{want}", got "{have}"'
    for entry, name in ((PRESS, 'press'), (RELEASE, 'release')):
        ins = next(md.disasm(img[entry - fw.APP_BASE:entry - fw.APP_BASE + 4], entry))
        assert ins.mnemonic == 'b.w' and int(ins.op_str.lstrip('#'), 16) == hooks[name]
    return got


if __name__ == '__main__':
    stock = fw.load_stock(sys.argv[1])
    img, base, listing, hooks = build(stock)
    got = verify(img, base, listing, hooks)
    for a, text in got:
        print(f'  {a:#010x}  {text}')
    changed = [i for i in range(len(stock)) if stock[i] != img[i]]
    print(f'stock bytes changed: {len(changed)} (two 4-byte hooks + 6-byte version mark)')
    print(f'new code: {len(img) - len(stock)} bytes at {base:#x}; image now {len(img):#x} bytes')
    syx = fw.encode(img)
    sent = fw.decode(syx)
    assert sent[:len(img)] == img and set(sent[len(img):]) <= {0xFF}
    out = 'build/circuittracks-4486-LOOP01.syx'
    import os
    os.makedirs('build', exist_ok=True)
    open(out, 'wb').write(syx)
    open(out.replace('.syx', '.bin'), 'wb').write(sent)
    print(f'wrote {out}  sha256 {fw.sha256(syx)}')
