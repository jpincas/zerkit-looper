"""Build LOOP04: LOOP3D (full input takeover) + the app controls every light.

    .venv/bin/python build_lights.py incoming/circuittracks-firmware-4486.syx [--bright | --splash]

--bright builds LOOP05: LOOP04 plus `F0 7D 03 <led> <brightness 0-127> ... F7` for the knob
LEDs 60-68 (127 = full; 0-126 scale the colour from 10% to 98%).

--splash builds LOOP06: LOOP05 plus a splash screen. From power-on until the app's first
F0 7D message, "LOOP" scrolls across the pads (so the Circuit doesn't look dead before the
app connects). The first message ends it and clears the pads.

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

# LOOP05 = LOOP04 + knob brightness. The stock LED converter 0x0803423c turns the frame's codes
# into RGB; for the knob LEDs (60-68) it can scale a colour by a brightness 0-126 through
# 0x080475a6 (factor = b * 0x1cc + 0x1a00, /65536: 10%..98%), and uses 0xff for "don't scale".
# We replace its `movs r4, #0xff ; ldr r0, [pc, #0x174]` with `bl c_knob`.
MARK5 = b'LOOP05'
SIG5 = 0x354F4F50                             # 'POO5': a fresh signature, so LOOP04's RAM is re-initialised
KNOB_SITE, KNOB_ORIG = 0x080342B2, bytes.fromhex('ff245d48')
PALETTE_LIT, PALETTE_PTR = 0x0803442C, 0x20003804


def mov32(a, rd, value, comment=''):
    a(f'movw r{rd}, #{value & 0xFFFF:#x}', T.mov32(rd, value)[:4])
    a(f'movt r{rd}, #{value >> 16:#x}', T.mov32(rd, value)[4:])


# Knob brightness (LOOP05 only): 9 bytes, one per LED 60-68, after the frame.
BRIGHT = RAM_SIG + 0x90
FULL = 127                                    # 127 = full colour; 0-126 = 10%-98% (stock scaler)

# Splash (LOOP06 only): three words after the brightness bytes: active flag, tick of the last
# step, scroll position. The tick is the stock 1 ms counter (SysTick handler 0x0805998c).
MARK6 = b'LOOP06'
SIG6 = 0x364F4F50                             # 'POO6'
SPLASH = RAM_SIG + 0x9C
TICK = 0x20006A28
STEP_MS = 110                                 # one column every 110 ms
FONT = {'L': ['X..', 'X..', 'X..', 'XXX'],
        'O': ['XXX', 'X.X', 'X.X', 'XXX'],
        'P': ['XXX', 'X.X', 'XXX', 'X..']}
SPLASH_COLOURS = [0x53, 0x45, 0x2D, 0x17]     # red, orange, yellow, green
SPLASH_GAP = 6                                # blank columns after the word, before it repeats


def splash_strip():
    """The scrolling strip: 4 rows of W palette codes ("LOOP" + gap), one strip cycle."""
    rows = [[] for _ in range(4)]
    for k, (ch, colour) in enumerate(zip('LOOP', SPLASH_COLOURS)):
        for r in range(4):
            rows[r] += [colour if c == 'X' else 0 for c in FONT[ch][r]] + ([0] if k < 3 else [0] * SPLASH_GAP)
    return rows


SPLASH_W = len(splash_strip()[0])             # 21
SPLASH_START = 15                             # first view: the gap, with L about to come in
SPLASH_ROW = SPLASH_W + 7                     # stored row length: the strip + its first 7 columns again


def splash_table():
    """What c_splash reads: each row stored with its first 7 columns repeated after it, so the
    8 columns seen at any position are contiguous."""
    return bytes(sum(([*row, *row[:7]] for row in splash_strip()), []))


def lights_code(base, sig=SIG, bright=False, splash=False, tab=0):
    a = T.Asm(base)
    br = lambda cond, lbl: (lambda at, L: T.b_cond(at, L[lbl], cond))
    bl_ = lambda lbl: (lambda at, L: T.bl(at, L[lbl]))

    # c_init(): if the signature is missing, clear the frame and write it. Uses r0-r3 only.
    a.label('c_init')
    mov32(a, 3, RAM_SIG)
    a('ldr r2, [r3]', T.ldr(2, 3))
    mov32(a, 1, sig)
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
    if bright:                                             # r3 = RAM_SIG + 0x8C: three words of FULL
        mov32(a, 2, FULL * 0x01010101)
        for _ in range(3):
            a('adds r3, #4', T.adds(3, 4))
            a('str r2, [r3]', T.str_(2, 3))
    if splash:                                             # r3 = SPLASH - 4: flag 1, last tick 0, position
        for value in (1, 0, SPLASH_START):
            a('adds r3, #4', T.adds(3, 4))
            a(f'movs r2, #{value}', T.movs(2, value))
            a('str r2, [r3]', T.str_(2, 3))
    a.label('init_done')
    a('bx lr', T.bx_lr())

    # c_leds(ctrl, frame): replaces the stock LED task; copies our 69 codes into the frame.
    a.label('c_leds')
    a('push {r4, lr}', T.push([4], lr=True))
    a('mov r4, r1', T.mov(4, 1))
    a('bl <c_init>', bl_('c_init'), 4)
    if splash:
        a('bl <c_splash>', bl_('c_splash'), 4)
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
    if splash:
        a('bl <c_unsplash>', bl_('c_unsplash'), 4)
    mov32(a, 6, FRAME)
    a('ldrb r0, [r4, #2]', T.ldrb(0, 4, 2))                # command
    a('cmp r0, #1', T.cmp(0, 1))
    a('beq <sx_one>', br('eq', 'sx_one'), 2)
    a('cmp r0, #2', T.cmp(0, 2))
    a('beq <sx_run>', br('eq', 'sx_run'), 2)
    if bright:
        a('cmp r0, #3', T.cmp(0, 3))
        a('beq <sx_bri>', br('eq', 'sx_bri'), 2)
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
    if bright:
        # F0 7D 03 first b0 b1 ... F7: brightness for LEDs 60-68 (others skipped)
        a.label('sx_bri')
        a('ldrb r0, [r4, #3]', T.ldrb(0, 4, 3))
        a('subs r5, #5', T.subs(5, 5))
        a('ble <sx_done>', br('le', 'sx_done'), 2)
        a('adds r4, #4', T.adds(4, 4))
        mov32(a, 6, BRIGHT - 60)
        a.label('bri_loop')
        a(f'cmp r0, #{N_LEDS}', T.cmp(0, N_LEDS))
        a('bhs <sx_done>', br('hs', 'sx_done'), 2)
        a('cmp r0, #60', T.cmp(0, 60))
        a('blo <bri_next>', br('lo', 'bri_next'), 2)
        a('ldrb r1, [r4]', T.ldrb(1, 4))
        a('strb r1, [r6, r0]', T.strb_r(1, 6, 0))
        a.label('bri_next')
        a('adds r4, #1', T.adds(4, 1))
        a('adds r0, #1', T.adds(0, 1))
        a('subs r5, #1', T.subs(5, 1))
        a('bne <bri_loop>', br('ne', 'bri_loop'), 2)
    a.label('sx_done')
    a('pop {r4, r5, r6, pc}', T.pop([4, 5, 6], pc=True))
    if bright:
        # c_knob: called from the stock converter's knob loop in place of
        # `movs r4, #0xff ; ldr r0, [pc, #0x174]`. r8 = knob LEDs left (9 -> LED 60), so this
        # LED is BRIGHT[9 - r8]. Returns r4 = brightness for the stock scaler (0xff = full,
        # untouched) and r0 = the palette pointer the displaced ldr loaded. Clobbers r1.
        a.label('c_knob')
        a('movs r4, #0xff', T.movs(4, 0xFF))
        mov32(a, 0, BRIGHT + 9)
        a('mov r1, r8', T.mov(1, 8))
        a('subs r0, r0, r1', T.subs_r(0, 0, 1))
        a('ldrb r0, [r0]', T.ldrb(0, 0))
        a(f'cmp r0, #{FULL}', T.cmp(0, FULL))
        a('bhs <knob_full>', br('hs', 'knob_full'), 2)
        a('mov r4, r0', T.mov(4, 0))
        a.label('knob_full')
        mov32(a, 0, PALETTE_PTR)
        a('bx lr', T.bx_lr())
    if splash:
        # c_splash(): while the splash is on, step the scroll every STEP_MS and draw the 8
        # columns at the scroll position into our frame's pads. Uses r0-r3 only.
        a.label('c_splash')
        mov32(a, 3, SPLASH)
        a('ldr r0, [r3]', T.ldr(0, 3))
        a('cmp r0, #0', T.cmp(0, 0))
        a('bne <spl_on>', br('ne', 'spl_on'), 2)
        a('bx lr', T.bx_lr())
        a.label('spl_on')
        mov32(a, 1, TICK)
        a('ldr r1, [r1]', T.ldr(1, 1))
        a('ldr r2, [r3, #4]', T.ldr(2, 3, 4))
        a('subs r0, r1, r2', T.subs_r(0, 1, 2))
        a(f'cmp r0, #{STEP_MS}', T.cmp(0, STEP_MS))
        a('blo <spl_draw>', br('lo', 'spl_draw'), 2)
        a('str r1, [r3, #4]', T.str_(1, 3, 4))
        a('ldr r0, [r3, #8]', T.ldr(0, 3, 8))
        a('adds r0, #1', T.adds(0, 1))
        a('str r0, [r3, #8]', T.str_(0, 3, 8))
        a.label('spl_draw')
        a('ldr r0, [r3, #8]', T.ldr(0, 3, 8))
        a(f'cmp r0, #{SPLASH_W}', T.cmp(0, SPLASH_W))
        a('blo <spl_pos_ok>', br('lo', 'spl_pos_ok'), 2)
        a('movs r0, #0', T.movs(0, 0))
        a('str r0, [r3, #8]', T.str_(0, 3, 8))
        a.label('spl_pos_ok')
        mov32(a, 1, tab)                                   # the table (build puts it after the code)
        a('adds r1, r1, r0', T.adds_r(1, 1, 0))
        mov32(a, 2, FRAME)
        for row in range(4):
            for col in range(8):
                at = lambda off: f', #{off}' if off else ''
                a(f'ldrb r0, [r1{at(col)}]', T.ldrb(0, 1, col))
                a(f'strh r0, [r2{at(2 * (8 * row + col))}]', T.strh(0, 2, 2 * (8 * row + col)))
            if row < 3:
                a(f'adds r1, #{SPLASH_ROW}', T.adds(1, SPLASH_ROW))
        a('bx lr', T.bx_lr())

        # c_unsplash(): the app has sent its first message: splash off, pads cleared. r0-r3 only.
        a.label('c_unsplash')
        mov32(a, 3, SPLASH)
        a('ldr r0, [r3]', T.ldr(0, 3))
        a('cmp r0, #0', T.cmp(0, 0))
        a('bne <uns_on>', br('ne', 'uns_on'), 2)
        a('bx lr', T.bx_lr())
        a.label('uns_on')
        a('movs r0, #0', T.movs(0, 0))
        a('str r0, [r3]', T.str_(0, 3))
        mov32(a, 3, FRAME)
        a('movs r1, #16', T.movs(1, 16))                    # 16 words = the 32 pads
        a.label('uns_loop')
        a('str r0, [r3]', T.str_(0, 3))
        a('adds r3, #4', T.adds(3, 4))
        a('subs r1, #1', T.subs(1, 1))
        a('bne <uns_loop>', br('ne', 'uns_loop'), 2)
        a('bx lr', T.bx_lr())
    code, listing = a.assemble()
    return code, listing, a.labels


def mark(bright, splash):
    return MARK6 if splash else MARK5 if bright else MARK


def build(stock, bright=False, splash=False):
    bright = bright or splash
    img, *_ = BT.build(stock, diag=True)                     # LOOP3D inputs, unchanged
    img = bytearray(img)
    base = fw.APP_BASE + ((len(img) + 3) & ~3)
    img += b'\xFF' * (base - fw.APP_BASE - len(img))
    sig = SIG6 if splash else SIG5 if bright else SIG
    code, listing, labels = lights_code(base, sig, bright, splash)
    if splash:                                             # same size, now with the table's address
        code, listing, labels = lights_code(base, sig, bright, splash, tab=base + len(code))
    img += code
    if splash:
        img += splash_table()
    for site in LED_CALLS:
        off = site - fw.APP_BASE
        assert bytes(img[off:off + 4]) == T.bl(site, LED_TASK), f'{site:#x}: not a bl to the LED task'
        img[off:off + 4] = T.bl(site, labels['c_leds'])
    off = SX_IN - fw.APP_BASE
    assert bytes(img[off:off + 4]) == SX_PROLOGUE
    img[off:off + 4] = T.b_w(SX_IN, labels['c_sx'])
    if bright:
        off = KNOB_SITE - fw.APP_BASE
        assert bytes(img[off:off + 4]) == KNOB_ORIG, 'knob site: not movs r4, #0xff ; ldr r0, [pc, #0x174]'
        lit = PALETTE_LIT - fw.APP_BASE
        assert int.from_bytes(img[lit:lit + 4], 'little') == PALETTE_PTR
        img[off:off + 4] = T.bl(KNOB_SITE, labels['c_knob'])
    img[fw.VERSION_MARK:fw.VERSION_MARK + 6] = mark(bright, splash)
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
    if 'c_knob' in labels:
        ins = next(md.disasm(img[KNOB_SITE - fw.APP_BASE:KNOB_SITE - fw.APP_BASE + 4], KNOB_SITE))
        assert ins.mnemonic == 'bl' and int(ins.op_str.lstrip('#'), 16) == labels['c_knob']
    return got


if __name__ == '__main__':
    stock = fw.load_stock(sys.argv[1])
    bright = '--bright' in sys.argv                          # LOOP05
    splash = '--splash' in sys.argv                          # LOOP06
    img, base, listing, labels = build(stock, bright, splash)
    for a, text in verify(img, base, listing, labels):
        print(f'  {a:#010x}  {text}')
    print('labels:', {k: hex(v) for k, v in labels.items() if k.startswith('c_')})
    syx = fw.encode(img)
    sent = fw.decode(syx)
    assert sent[:len(img)] == img and set(sent[len(img):]) <= {0xFF}
    os.makedirs('build', exist_ok=True)
    out = f'build/circuittracks-4486-{mark(bright or splash, splash).decode()}.syx'
    open(out, 'wb').write(syx)
    open(out.replace('.syx', '.bin'), 'wb').write(sent)
    print(f'image {len(img):#x} (sent as {len(sent):#x}); wrote {out}  sha256 {fw.sha256(syx)}')
