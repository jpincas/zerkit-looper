"""Build LOOP02: the Circuit Tracks becomes a dedicated control surface for the looper app.

    .venv/bin/python build_takeover.py incoming/circuittracks-firmware-4486.syx

Every input is reported over USB/DIN MIDI and NOTHING reaches the stock firmware's
handlers, so the Circuit itself never reacts (no sequencer, sounds, view changes, Start/Stop).
All messages are on channel 15:

    button press / release   CC (20 + id)  127 / 0        id 0-27, see BUTTONS
    pad press                Note On   pad 0-31, velocity
    pad release              Note Off  pad 0-31
    macro knob 0-7           CC (1 + knob) = low 7 bits of the value the firmware reports
    master knob 0/1          CC (9 + n)    = low 7 bits of the value the firmware reports

How: the input controller's handlers (vtable 0x0805A100, located by CIRCUIT-HACKS-RC) each get
their first 4 bytes replaced by `b.w` to a few instructions of ours that build the message and
tail-call a small sender, which calls the stock MIDI sender 0x0803BEDA(port mask 7, message)
and returns straight to the controller's caller.
"""
import os
import re
import sys
import capstone
import fw
import thumb as T

MIDI_SEND = 0x0803BEDA
MARK = b'LOOP02'

# (name, entry, expected first 4 stock bytes, message builder). On entry r0 = ctrl, r1 = index, r2 = value.
HOOKS = [
    ('pad press',      0x08033282, '70b50646', [('movs r3, #0x7f', T.movs(3, 0x7F)), ('ands r2, r3', T.ands(2, 3)),
                                                ('movs r0, #0x9e', T.movs(0, 0x9E))]),
    ('pad release',    0x080332FE, '38b50446', [('movs r2, #0', T.movs(2, 0)), ('movs r0, #0x8e', T.movs(0, 0x8E))]),
    ('button press',   0x08033320, '38b50446', [('movs r2, #0x7f', T.movs(2, 0x7F)), ('adds r1, #20', T.adds(1, 20)),
                                                ('movs r0, #0xbe', T.movs(0, 0xBE))]),
    ('button release', 0x0803381A, '38b50446', [('movs r2, #0', T.movs(2, 0)), ('adds r1, #20', T.adds(1, 20)),
                                                ('movs r0, #0xbe', T.movs(0, 0xBE))]),
    ('macro knob',     0x08033848, '70b50446', [('movs r3, #0x7f', T.movs(3, 0x7F)), ('ands r2, r3', T.ands(2, 3)),
                                                ('adds r1, #1', T.adds(1, 1)), ('movs r0, #0xbe', T.movs(0, 0xBE))]),
    ('master knob',    0x08033878, '70b50546', [('movs r3, #0x7f', T.movs(3, 0x7F)), ('ands r2, r3', T.ands(2, 3)),
                                                ('adds r1, #9', T.adds(1, 9)), ('movs r0, #0xbe', T.movs(0, 0xBE))]),
]


ROUTER_PTR = 0x200069F4   # [ROUTER_PTR] = MIDI router object, as loaded by the stock sender
ROUTER_SEND = 0x08020C42  # router(obj, port mask, message): what the stock sender calls after its gate check
MIDI_GATE = 0x20000A6C    # stock gate word: bit 2 set = MIDI switched off (in and out)
DIAG_CC = 100


def build(stock, diag=False):
    """diag=True (LOOP03D): bypass the stock gate and follow every message with CC 100 = gate word & 0x7F."""
    img = bytearray(stock)
    base = fw.APP_BASE + ((len(img) + 3) & ~3)
    img += b'\xFF' * (base - fw.APP_BASE - len(img))
    code, listing = bytearray(), []

    def emit(text, enc):
        listing.append((base + len(code), text))
        code.extend(enc(base + len(code)) if callable(enc) else enc)

    def route(msg_reg):          # router([ROUTER_PTR], 7, msg_reg): the stock sender minus its gate check
        emit(f'mov r2, r{msg_reg}', T.mov(2, msg_reg))
        emit('movs r1, #7', T.movs(1, 7))
        emit(f'movw r0, #{ROUTER_PTR & 0xFFFF:#x}', T.mov32(0, ROUTER_PTR)[:4])
        emit(f'movt r0, #{ROUTER_PTR >> 16:#x}', T.mov32(0, ROUTER_PTR)[4:])
        emit('ldr r0, [r0]', T.ldr(0, 0))
        emit(f'bl #{ROUTER_SEND:#x}', lambda at: T.bl(at, ROUTER_SEND))

    # send3(r0, r1, r2): sends the 3-byte message [r0, r1, r2], returns to whoever called the hook.
    send3 = base
    emit('push {r4, lr}', T.push([4], lr=True))
    emit('sub sp, #8', T.sub_sp(8))
    emit('mov r4, sp', T.mov(4, 13))
    emit('strb r0, [r4]', T.strb(0, 4, 0))
    emit('strb r1, [r4, #1]', T.strb(1, 4, 1))
    emit('strb r2, [r4, #2]', T.strb(2, 4, 2))
    if not diag:
        emit('mov r1, r4', T.mov(1, 4))
        emit('movs r0, #7', T.movs(0, 7))
        emit(f'bl #{MIDI_SEND:#x}', lambda at: T.bl(at, MIDI_SEND))
    else:
        route(4)
        emit(f'movs r0, #{DIAG_CC}', T.movs(0, DIAG_CC))      # then [0xBE, 100, gate & 0x7F]
        emit('strb r0, [r4, #1]', T.strb(0, 4, 1))
        emit('movs r0, #0xbe', T.movs(0, 0xBE))
        emit('strb r0, [r4]', T.strb(0, 4, 0))
        emit(f'movw r0, #{MIDI_GATE & 0xFFFF:#x}', T.mov32(0, MIDI_GATE)[:4])
        emit(f'movt r0, #{MIDI_GATE >> 16:#x}', T.mov32(0, MIDI_GATE)[4:])
        emit('ldr r0, [r0]', T.ldr(0, 0))
        emit('movs r1, #0x7f', T.movs(1, 0x7F))
        emit('ands r0, r1', T.ands(0, 1))
        emit('strb r0, [r4, #2]', T.strb(0, 4, 2))
        route(4)
    emit('add sp, #8', T.add_sp(8))
    emit('pop {r4, pc}', T.pop([4], pc=True))

    targets = {}
    for name, entry, prologue, body in HOOKS:
        off = entry - fw.APP_BASE
        assert bytes(img[off:off + 4]).hex() == prologue, f'{name}: stock bytes differ'
        targets[name] = base + len(code)
        for text, enc in body:
            emit(text, enc)
        emit(f'b.w #{send3:#x}', lambda at: T.b_w(at, send3))

    img += code
    for name, entry, _, _ in HOOKS:
        off = entry - fw.APP_BASE
        img[off:off + 4] = T.b_w(entry, targets[name])

    assert img[fw.VERSION_MARK:fw.VERSION_MARK + 6] == b'\0' * 6
    img[fw.VERSION_MARK:fw.VERSION_MARK + 6] = b'LOOP3D' if diag else MARK
    return bytes(img), base, listing, targets


def verify(img, base, listing, targets):
    md = capstone.Cs(capstone.CS_ARCH_ARM, capstone.CS_MODE_THUMB | capstone.CS_MODE_MCLASS)
    got = [(i.address, f'{i.mnemonic} {i.op_str}'.strip()) for i in md.disasm(img[base - fw.APP_BASE:], base)]
    norm = lambda s: re.sub(r'#(0x[0-9a-f]+|\d+)', lambda m: '#' + str(int(m.group(1), 0)), s.replace(' ', '').lower())
    assert len(got) == len(listing), f'disassembly has {len(got)} instructions, expected {len(listing)}'
    for (a1, want), (a2, have) in zip(listing, got):
        assert a1 == a2 and norm(want) == norm(have), f'{a1:#x}: wanted "{want}", got "{have}"'
    for name, entry, _, _ in HOOKS:
        ins = next(md.disasm(img[entry - fw.APP_BASE:entry - fw.APP_BASE + 4], entry))
        assert ins.mnemonic == 'b.w' and int(ins.op_str.lstrip('#'), 16) == targets[name], name
    return got


if __name__ == '__main__':
    stock = fw.load_stock(sys.argv[1])
    diag = '--diag' in sys.argv
    img, base, listing, targets = build(stock, diag)
    for a, text in verify(img, base, listing, targets):
        print(f'  {a:#010x}  {text}')
    changed = sum(1 for i in range(len(stock)) if stock[i] != img[i])
    print(f'stock bytes changed: {changed} ({len(HOOKS)} hooks x 4 + 6-byte mark)')
    print(f'new code: {len(img) - len(stock)} bytes at {base:#x}')
    syx = fw.encode(img)
    sent = fw.decode(syx)
    assert sent[:len(img)] == img and set(sent[len(img):]) <= {0xFF}
    os.makedirs('build', exist_ok=True)
    out = f"build/circuittracks-4486-{'LOOP3D' if diag else 'LOOP02'}.syx"
    open(out, 'wb').write(syx)
    open(out.replace('.syx', '.bin'), 'wb').write(sent)
    print(f'wrote {out}  sha256 {fw.sha256(syx)}')
