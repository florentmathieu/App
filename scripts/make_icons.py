#!/usr/bin/env python3
"""Generate PicoTune PWA icons (no external deps, pure PNG via zlib)."""
import struct, zlib, os

OUT = os.path.join(os.path.dirname(__file__), '..', 'icons')
os.makedirs(OUT, exist_ok=True)

def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))

def make(size):
    bg_top = (24, 28, 54)
    bg_bot = (13, 15, 26)
    px = bytearray()
    # palette for the equalizer bars
    colors = [(108,123,255), (179,136,255), (79,195,247), (46,193,110), (255,93,115)]

    # bar geometry
    n = 5
    margin = size * 0.16
    gap = size * 0.035
    usable = size - 2*margin - (n-1)*gap
    bw = usable / n
    base_y = size - margin
    heights = [0.55, 0.85, 0.45, 0.95, 0.65]

    radius = size * 0.22  # rounded square corner

    for y in range(size):
        row = bytearray([0])  # filter byte
        t = y / size
        bg = lerp(bg_top, bg_bot, t)
        for x in range(size):
            # rounded-rect mask for the icon background
            inside = True
            cx = min(x, size-1-x)
            cy = min(y, size-1-y)
            if cx < radius and cy < radius:
                dx = radius - cx
                dy = radius - cy
                if dx*dx + dy*dy > radius*radius:
                    inside = False
            if not inside:
                row += bytes((0, 0, 0, 0))
                continue

            r, g, b = bg
            # draw bars
            for i in range(n):
                bx0 = margin + i*(bw+gap)
                bx1 = bx0 + bw
                bh = heights[i] * (size - 2*margin)
                by0 = base_y - bh
                if bx0 <= x < bx1 and by0 <= y <= base_y:
                    col = colors[i]
                    # subtle vertical gradient on the bar
                    bt = (y - by0) / max(bh, 1)
                    r, g, b = lerp(col, lerp(col, (255,255,255), 0.0), bt)
                    r, g, b = lerp((255,255,255), col, min(1.0, bt+0.15))
                    break
            row += bytes((r, g, b, 255))
        px += row

    raw = bytes(px)
    comp = zlib.compress(raw, 9)

    def chunk(typ, data):
        c = typ + data
        return struct.pack('>I', len(data)) + c + struct.pack('>I', zlib.crc32(c) & 0xffffffff)

    sig = b'\x89PNG\r\n\x1a\n'
    ihdr = struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0)  # RGBA
    png = sig + chunk(b'IHDR', ihdr) + chunk(b'IDAT', comp) + chunk(b'IEND', b'')
    path = os.path.join(OUT, f'icon-{size}.png')
    with open(path, 'wb') as f:
        f.write(png)
    print('wrote', path, len(png), 'bytes')

for s in (180, 192, 512):
    make(s)
