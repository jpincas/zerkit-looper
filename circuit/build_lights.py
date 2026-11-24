"""Build LOOP04: LOOP3D (full input takeover) + the app controls every light.

    .venv/bin/python build_lights.py incoming/circuittracks-firmware-4486.syx

Lights: the panel's 69 LEDs (0-31 pads, 32 + button id for buttons, 60-67 knobs, 68 master
filter) are shown from our own 69-code frame in RAM; the stock painter never runs. Colours
are Novation palette codes (0 = off, 0x53 red, 0x2D yellow, 0x17 green, ...).

Commands from the app (SysEx; 7D = the non-commercial manufacturer id, which no stock
handler answers):
    F0 7D 01 <led> <colour> F7                      set one LED
    F0 7D 02 <first led> <colour> <colour> ... F7   set a run of LEDs (stops at LED 68)

How:
  * the two calls of the stock LED task 0x08034196(ctrl, frame) -> bl c_leds, which copies
    our 69 halfwords into the frame (the stock converter after it turns codes into RGB);
  * the incoming SysEx dispatcher 0x0801EB30(port, msg = {buf, len}, x) starts with b.w c_sx:
    F0 7D ... is ours, anything else runs the displaced `push.w {r4-r8, lr}` and goes on
    at 0x0801EB34. SysEx doesn't pass through the stock MIDI gate (0x20000A6C).
  * RAM 0x20045000: signature, then the 69 halfwords. That region is above the heap and
    unused by stock (CIRCUIT-HACKS-RC NOTAS); RAM isn't cleared at power-on, so the
    signature decides whether the frame must be cleared first.
"""
import os
import re
import sys
import capstone
import fw
import thumb as T
import build_takeover as BT

LED_TASK = 0x08034196
LED_CALLS = [0x08033B46, 0x0803415A]          # bl LED_TASK at both
SX_IN, SX_PROLOGUE = 0x0801EB30, bytes.fromhex('2de9f041')   # push.w {r4, r5, r6, r7, r8, lr}
RAM_SIG, SIG = 0x20045000, 0x4C4F4F50         # 'POOL' little-endian
FRAME = RAM_SIG + 4
N_LEDS = 69
MARK = b'LOOP04'


def mov32(a, rd, value, comment=''):
    a(f'movw r{rd}, #{value & 0xFFFF:#x}', T.mov32(rd, value)[:4])
    a(f'movt r{rd}, #{value >> 16:#x}', T.mov32(rd, value)[4:])


def lights_code(base):
    a = T.Asm(base)
    br = lambda cond, lbl: (lambda at, L: T.b_cond(at, L[lbl], cond))
    bl_ = lambda lbl: (lambda at, L: T.bl(at, L[lbl]))

    # c_init(): if the signature is missing, clear the frame and write it. Uses r0-r3 only.
    a.label('c_init')
    mov32(a, 3, RAM_SIG)
    a('ldr r2, [r3]', T.ldr(2, 3))
    mov32(a, 1, SIG)
    a('cmp r2, r1', T.cmp_r(2, 1))
    a('beq <init_done>', br('eq', 'init_done'), 2)
    a('str r1, [r3]', T.str_(1, 3))
    a('movs r2, #0', T.movs(2, 0))
    a('movs r0, #35', T.movs(0, 35))                       # 35 words = 140 bytes >= 69 halfwords
    a.label('init_loop')
    a('adds r3, #4', T.adds(3, 4))
    a('str r2, [r3]', T.str_(2, 3))
    a('subs r0, #1', T.subs(0, 1))
    a('bne <init_loop>', br('ne', 'init_loop'), 2)
    a.label('init_done')
    a('bx lr', T.bx_lr())

    # c_leds(ctrl, frame): replaces the stock LED task; copies our 69 codes into the frame.
    a.label('c_leds')
    a('push {r4, lr}', T.push([4], lr=True))
    a('mov r4, r1', T.mov(4, 1))
    a('bl <c_init>', bl_('c_init'), 4)
    mov32(a, 3, FRAME)
    a('movs r0, #0', T.movs(0, 0))
    a.label('copy_loop')
    a('ldrh r2, [r3, r0]', T.ldrh_r(2, 3, 0))
    a('strh r2, [r4, r0]', T.strh_r(2, 4, 0))
    a('adds r0, #2', T.adds(0, 2))
    a(f'cmp r0, #{2 * N_LEDS}', T.cmp(0, 2 * N_LEDS))
    a('bne <copy_loop>', br('ne', 'copy_loop'), 2)
    a('pop {r4, pc}', T.pop([4], pc=True))

    # c_sx(port, msg, x): head of the stock SysEx dispatcher.
    a.label('c_sx')
    a('ldr r3, [r1]', T.ldr(3, 1))                         # buf
    a('ldrb r3, [r3, #1]', T.ldrb(3, 3, 1))
    a('cmp r3, #0x7d', T.cmp(3, 0x7D))
    a('beq <sx_ours>', br('eq', 'sx_ours'), 2)
    a('push.w {r4, r5, r6, r7, r8, lr}', SX_PROLOGUE)       # not ours: the displaced instruction,
    a(f'b.w #{SX_IN + 4:#x}', lambda at, L: T.b_w(at, SX_IN + 4), 4)  # then the rest of stock
    a.label('sx_ours')
    a('push {r4, r5, r6, lr}', T.push([4, 5, 6], lr=True))
    a('ldr r4, [r1]', T.ldr(4, 1))                         # r4 = buf
    a('ldr r5, [r1, #4]', T.ldr(5, 1, 4))                  # r5 = len (F0 .. F7 inclusive)
    a('bl <c_init>', bl_('c_init'), 4)
    mov32(a, 6, FRAME)
    a('ldrb r0, [r4, #2]', T.ldrb(0, 4, 2))                # command
    a('cmp r0, #1', T.cmp(0, 1))
    a('beq <sx_one>', br('eq', 'sx_one'), 2)
    a('cmp r0, #2', T.cmp(0, 2))
    a('beq <sx_run>', br('eq', 'sx_run'), 2)
    a('b <sx_done>', lambda at, L: T.b(at, L['sx_done']), 2)
    # F0 7D 01 led colour F7
    a.label('sx_one')
    a('cmp r5, #6', T.cmp(5, 6))
    a('blt <sx_done>', br('lt', 'sx_done'), 2)
    a('ldrb r0, [r4, #3]', T.ldrb(0, 4, 3))
    a(f'cmp r0, #{N_LEDS}', T.cmp(0, N_LEDS))
    a('bhs <sx_done>', br('hs', 'sx_done'), 2)
    a('ldrb r1, [r4, #4]', T.ldrb(1, 4, 4))
    a('lsls r0, r0, #1', T.lsls(0, 0, 1))
    a('strh r1, [r6, r0]', T.strh_r(1, 6, 0))
    a('b <sx_done>', lambda at, L: T.b(at, L['sx_done']), 2)
    # F0 7D 02 first c0 c1 ... F7: len - 5 colours
    a.label('sx_run')
    a('ldrb r0, [r4, #3]', T.ldrb(0, 4, 3))
    a('subs r5, #5', T.subs(5, 5))
    a('ble <sx_done>', br('le', 'sx_done'), 2)
    a('adds r4, #4', T.adds(4, 4))
    a.label('run_loop')
    a(f'cmp r0, #{N_LEDS}', T.cmp(0, N_LEDS))
    a('bhs <sx_done>', br('hs', 'sx_done'), 2)
    a('ldrb r1, [r4]', T.ldrb(1, 4))
    a('adds r4, #1', T.adds(4, 1))
    a('lsls r3, r0, #1', T.lsls(3, 0, 1))
    a('strh r1, [r6, r3]', T.strh_r(1, 6, 3))
    a('adds r0, #1', T.adds(0, 1))
    a('subs r5, #1', T.subs(5, 1))
    a('bne <run_loop>', br('ne', 'run_loop'), 2)
    a.label('sx_done')
    a('pop {r4, r5, r6, pc}', T.pop([4, 5, 6], pc=True))
    code, listing = a.assemble()
    return code, listing, a.labels


def build(stock):
    img, *_ = BT.build(stock, diag=True)                     # LOOP3D inputs, unchanged
    img = bytearray(img)
    base = fw.APP_BASE + ((len(img) + 3) & ~3)
    img += b'\xFF' * (base - fw.APP_BASE - len(img))
    code, listing, labels = lights_code(base)
    img += code
    for site in LED_CALLS:
        off = site - fw.APP_BASE
        assert bytes(img[off:off + 4]) == T.bl(site, LED_TASK), f'{site:#x}: not a bl to the LED task'
        img[off:off + 4] = T.bl(site, labels['c_leds'])
    off = SX_IN - fw.APP_BASE
    assert bytes(img[off:off + 4]) == SX_PROLOGUE
    img[off:off + 4] = T.b_w(SX_IN, labels['c_sx'])
    img[fw.VERSION_MARK:fw.VERSION_MARK + 6] = MARK
    return bytes(img), base, listing, labels


def verify(img, base, listing, labels):
    md = capstone.Cs(capstone.CS_ARCH_ARM, capstone.CS_MODE_THUMB | capstone.CS_MODE_MCLASS)
    end = base + sum(1 for _ in listing) and listing[-1][0] + 2
    got = [(i.address, f'{i.mnemonic} {i.op_str}'.strip()) for i in md.disasm(img[base - fw.APP_BASE:end - fw.APP_BASE], base)]
    norm = lambda s: re.sub(r'#(0x[0-9a-f]+|\d+)', lambda m: '#' + str(int(m.group(1), 0)),
                            re.sub(r'\b(b\w*|bl) (0x[0-9a-f]+)', r'\1 #\2', s.replace(' ', ' ').lower())).replace(' ', '')
    assert len(got) == len(listing), f'{len(got)} instructions disassembled, {len(listing)} intended'
    for (a1, want), (a2, have) in zip(listing, got):
        assert a1 == a2 and norm(want) == norm(have), f'{a1:#x}: wanted "{want}", got "{have}"'
    for site in LED_CALLS:
        ins = next(md.disasm(img[site - fw.APP_BASE:site - fw.APP_BASE + 4], site))
        assert ins.mnemonic == 'bl' and int(ins.op_str.lstrip('#'), 16) == labels['c_leds']
    ins = next(md.disasm(img[SX_IN - fw.APP_BASE:SX_IN - fw.APP_BASE + 4], SX_IN))
    assert ins.mnemonic == 'b.w' and int(ins.op_str.lstrip('#'), 16) == labels['c_sx']
    return got


if __name__ == '__main__':
    stock = fw.load_stock(sys.argv[1])
    img, base, listing, labels = build(stock)
    for a, text in verify(img, base, listing, labels):
        print(f'  {a:#010x}  {text}')
    print('labels:', {k: hex(v) for k, v in labels.items() if k.startswith('c_')})
    syx = fw.encode(img)
    sent = fw.decode(syx)
    assert sent[:len(img)] == img and set(sent[len(img):]) <= {0xFF}
    os.makedirs('build', exist_ok=True)
    out = 'build/circuittracks-4486-LOOP04.syx'
    open(out, 'wb').write(syx)
    open(out.replace('.syx', '.bin'), 'wb').write(sent)
    print(f'image {len(img):#x} (sent as {len(sent):#x}); wrote {out}  sha256 {fw.sha256(syx)}')
