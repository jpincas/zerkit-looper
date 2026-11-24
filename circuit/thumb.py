"""Tiny Thumb-2 assembler: just the instructions our patches use.

Every build disassembles its output with Capstone and compares it to the intended
listing, so a wrong encoding fails the build instead of reaching the device.
"""
import struct


def h(x):
    return struct.pack('<H', x)


def _reglist(regs):
    m = 0
    for r in regs:
        assert 0 <= r <= 7
        m |= 1 << r
    return m


def push(regs, lr=False):              # push {r.., lr}
    return h(0xB400 | (0x100 if lr else 0) | _reglist(regs))


def pop(regs, pc=False):               # pop {r.., pc}
    return h(0xBC00 | (0x100 if pc else 0) | _reglist(regs))


def pop_w(regs, lr=False):             # pop.w {r.., lr}
    return h(0xE8BD) + h(_reglist(regs) | (0x4000 if lr else 0))


def movs(rd, imm):                     # movs rd, #imm8
    assert rd < 8 and 0 <= imm < 256
    return h(0x2000 | rd << 8 | imm)


def mov(rd, rm):                       # mov rd, rm (any registers, incl. sp)
    return h(0x4600 | (rd >> 3) << 7 | rm << 3 | (rd & 7))


def strb(rt, rn, imm):                 # strb rt, [rn, #imm5]
    assert rt < 8 and rn < 8 and 0 <= imm < 32
    return h(0x7000 | imm << 6 | rn << 3 | rt)


def adds(rdn, imm):                    # adds rdn, #imm8
    assert rdn < 8 and 0 <= imm < 256
    return h(0x3000 | rdn << 8 | imm)


def ands(rdn, rm):                     # ands rdn, rm
    assert rdn < 8 and rm < 8
    return h(0x4000 | rm << 3 | rdn)


def ldr(rt, rn, imm=0):                # ldr rt, [rn, #imm] (imm multiple of 4, < 128)
    assert rt < 8 and rn < 8 and imm % 4 == 0 and 0 <= imm < 128
    return h(0x6800 | (imm // 4) << 6 | rn << 3 | rt)


def _mov16(rd, imm16, top):
    i, imm4, imm3, imm8 = imm16 >> 11 & 1, imm16 >> 12, imm16 >> 8 & 7, imm16 & 0xFF
    return h((0xF2C0 if top else 0xF240) | i << 10 | imm4) + h(imm3 << 12 | rd << 8 | imm8)


def mov32(rd, value):                  # movw rd, #lo16 ; movt rd, #hi16
    return _mov16(rd, value & 0xFFFF, False) + _mov16(rd, value >> 16, True)


def sub_sp(imm):                       # sub sp, #imm (multiple of 4)
    assert imm % 4 == 0 and imm < 512
    return h(0xB080 | imm // 4)


def add_sp(imm):                       # add sp, #imm
    assert imm % 4 == 0 and imm < 512
    return h(0xB000 | imm // 4)


def _branch32(at, target, link):
    off = target - (at + 4)
    assert off % 2 == 0 and -(1 << 24) <= off < (1 << 24), 'branch out of range'
    off &= (1 << 25) - 1
    s = off >> 24 & 1
    i1, i2 = off >> 23 & 1, off >> 22 & 1
    j1, j2 = (~(i1 ^ s)) & 1, (~(i2 ^ s)) & 1
    imm10, imm11 = off >> 12 & 0x3FF, off >> 1 & 0x7FF
    return h(0xF000 | s << 10 | imm10) + h((0xD000 if link else 0x9000) | j1 << 13 | j2 << 11 | imm11)


def bl(at, target):                    # bl target
    return _branch32(at, target, True)


def b_w(at, target):                   # b.w target
    return _branch32(at, target, False)


# ---- more 16-bit encodings ---------------------------------------------------------

def ldrb(rt, rn, imm=0):               # ldrb rt, [rn, #imm5]
    assert rt < 8 and rn < 8 and 0 <= imm < 32
    return h(0x7800 | imm << 6 | rn << 3 | rt)


def str_(rt, rn, imm=0):               # str rt, [rn, #imm] (multiple of 4, < 128)
    assert rt < 8 and rn < 8 and imm % 4 == 0 and 0 <= imm < 128
    return h(0x6000 | (imm // 4) << 6 | rn << 3 | rt)


def ldrh_r(rt, rn, rm):                # ldrh rt, [rn, rm]
    return h(0x5A00 | rm << 6 | rn << 3 | rt)


def strh_r(rt, rn, rm):                # strh rt, [rn, rm]
    return h(0x5200 | rm << 6 | rn << 3 | rt)


def lsls(rd, rm, imm):                 # lsls rd, rm, #imm5
    assert rd < 8 and rm < 8 and 0 < imm < 32
    return h(imm << 6 | rm << 3 | rd)


def subs(rdn, imm):                    # subs rdn, #imm8
    assert rdn < 8 and 0 <= imm < 256
    return h(0x3800 | rdn << 8 | imm)


def cmp(rn, imm):                      # cmp rn, #imm8
    assert rn < 8 and 0 <= imm < 256
    return h(0x2800 | rn << 8 | imm)


def cmp_r(rn, rm):                     # cmp rn, rm
    return h(0x4280 | rm << 3 | rn)


def bx_lr():
    return h(0x4770)


COND = {'eq': 0, 'ne': 1, 'hs': 2, 'lo': 3, 'mi': 4, 'pl': 5, 'hi': 8, 'ls': 9, 'ge': 10, 'lt': 11, 'gt': 12, 'le': 13}


def b_cond(at, target, cond):          # b<cond> target (16-bit, +-256 bytes)
    off = target - (at + 4)
    assert off % 2 == 0 and -256 <= off < 256, 'conditional branch out of range'
    return h(0xD000 | COND[cond] << 8 | (off >> 1) & 0xFF)


def b(at, target):                     # b target (16-bit, +-2 KB)
    off = target - (at + 4)
    assert off % 2 == 0 and -2048 <= off < 2048, 'branch out of range'
    return h(0xE000 | (off >> 1) & 0x7FF)


class Asm:
    """Two-pass assembler: every instruction has a fixed size, so label addresses are known
    after the first pass; encoders that need addresses get (at, labels)."""

    def __init__(self, base):
        self.base, self.items, self.labels = base, [], {}

    def here(self):
        return self.base + sum(size for size, _, _ in self.items)

    def label(self, name):
        assert name not in self.labels, name
        self.labels[name] = self.here()

    def __call__(self, text, enc, size=None):
        if callable(enc):
            assert size, f'{text}: size needed for a deferred encoding'
        else:
            size = len(enc)
        self.items.append((size, enc, text))

    def assemble(self):
        out, listing, at = bytearray(), [], self.base
        for size, enc, text in self.items:
            data = enc(at, self.labels) if callable(enc) else enc
            assert len(data) == size, f'{text}: {len(data)} bytes, expected {size}'
            for k, v in self.labels.items():           # '<name>' in the text = that label's address
                text = text.replace(f'<{k}>', hex(v))
            listing.append((at, text))
            out += data
            at += size
        return bytes(out), listing
