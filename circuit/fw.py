"""Circuit Tracks firmware .syx <-> raw image.

Format as documented by the CIRCUIT-HACKS-RC project (MIT, github.com/Ghillermo/CIRCUIT-HACKS-RC,
tools/ct_fw.py), re-implemented here and checked against Novation's official 1.2.1 file:

  F0 00 20 29 00 71  01 64 00 00 + protocol version 0x572 (4 nibbles)          F7   INIT
  F0 00 20 29 00 7C  00 + version (6 nib) + size (8 nib) + CRC-32/MPEG-2 (8 nib) F7   HEADER
  F0 00 20 29 00 72  32 image bytes packed as 37 seven-bit bytes                 F7   WRITE, blocks 1..N-1
  F0 00 20 29 00 73  block 0 (the vector table), packed the same way            F7   FINISH

The image is linked at 0x08010000 (the bootloader below it is never sent).
"""
import hashlib

APP_BASE = 0x08010000
MAX_SIZE = 0x70000            # what the bootloader accepts
PROTO = 0x572
PRODUCT = 0x64
HDR = bytes([0xF0, 0x00, 0x20, 0x29, 0x00])

STOCK_SYX_SHA = 'bd2d294bafa88fdec7ae1f5fcaaa13158323969c5a40f83405a72e4ad329a0bd'
STOCK_IMG_SHA = 'b897e0f01c403974eafae32074876234f2da7ef834796a485993acf01423f8da'

# 0x26-byte version block right after the vector table. The bootloader only installs an image
# whose block differs from the installed one; bytes +0x20..+0x25 are zero padding we can mark.
VERSION_BLOCK = 0x1C8
VERSION_MARK = VERSION_BLOCK + 0x20


def sha256(b):
    return hashlib.sha256(b).hexdigest()


fw_sha = sha256


def crc32_mpeg2(data):
    table = []
    for i in range(256):
        c = i << 24
        for _ in range(8):
            c = ((c << 1) ^ 0x04C11DB7) if c & 0x80000000 else (c << 1)
            c &= 0xFFFFFFFF
        table.append(c)
    crc = 0xFFFFFFFF
    for b in data:
        crc = ((crc << 8) & 0xFFFFFFFF) ^ table[((crc >> 24) ^ b) & 0xFF]
    return crc


def _nib(value, n):
    return bytes((value >> (4 * (n - 1 - i))) & 0xF for i in range(n))


def _unnib(data):
    v = 0
    for b in data:
        assert b <= 0xF
        v = (v << 4) | b
    return v


def _pack(block):
    bits = int.from_bytes(block, 'big') << 3
    return bytes((bits >> (7 * (36 - i))) & 0x7F for i in range(37))


def _unpack(payload):
    assert len(payload) == 37 and all(b < 0x80 for b in payload)
    bits = 0
    for b in payload:
        bits = (bits << 7) | b
    return (bits >> 3).to_bytes(32, 'big')


def decode(syx):
    msgs, i = [], 0
    while i < len(syx):
        s = syx.index(0xF0, i)
        e = syx.index(0xF7, s)
        assert syx[s:s + 5] == HDR
        msgs.append((syx[s + 5], syx[s + 6:e]))
        i = e + 1
    cmds = [c for c, _ in msgs]
    assert cmds[0] == 0x71 and cmds[1] == 0x7C and cmds[-1] == 0x73
    assert all(c == 0x72 for c in cmds[2:-1])
    hdr = msgs[1][1]
    size, crc = _unnib(hdr[7:15]), _unnib(hdr[15:23])
    image = b''.join([_unpack(msgs[-1][1])] + [_unpack(p) for _, p in msgs[2:-1]])[:size]
    assert crc32_mpeg2(image) == crc, 'CRC mismatch'
    return image


def encode(image):
    # Pad patched images to a whole number of 32-byte blocks. The bootloader rejected (status 126,
    # CRC) a 0x4CE32-byte image; it checks with the STM32's word-based CRC unit, so the size must
    # at least be a multiple of 4. Stock (0x4CDDC) is left exactly as Novation made it.
    if fw_sha(image) != STOCK_IMG_SHA:
        image = image + b'\xFF' * (-len(image) % 32)
    assert len(image) % 4 == 0 and len(image) <= MAX_SIZE
    padded = image + b'\xFF' * (-len(image) % 32)
    blocks = [padded[i:i + 32] for i in range(0, len(padded), 32)]
    out = bytearray()
    out += HDR + bytes([0x71, 0x01, PRODUCT, 0x00, 0x00]) + _nib(PROTO, 4) + b'\xF7'
    out += HDR + bytes([0x7C, 0x00]) + _nib(PROTO, 6) + _nib(len(image), 8) + _nib(crc32_mpeg2(image), 8) + b'\xF7'
    for blk in blocks[1:]:
        out += HDR + bytes([0x72]) + _pack(blk) + b'\xF7'
    out += HDR + bytes([0x73]) + _pack(blocks[0]) + b'\xF7'
    return bytes(out)


def load_stock(path):
    syx = open(path, 'rb').read()
    assert sha256(syx) == STOCK_SYX_SHA, 'not the official Circuit Tracks 1.2.1 (build 4486) file'
    image = decode(syx)
    assert sha256(image) == STOCK_IMG_SHA
    assert encode(image) == syx, 'round trip failed'
    return image


if __name__ == '__main__':
    import sys
    img = load_stock(sys.argv[1])
    print(f'official 1.2.1 build 4486: image {len(img):#x} bytes, ends at {APP_BASE + len(img):#010x}')
    print('decode -> encode reproduces the official .syx byte for byte')
    print('version block:', img[VERSION_BLOCK:VERSION_BLOCK + 0x26])
