import struct, zlib, os

def png(path, size, draw):
    w = h = size
    buf = bytearray()
    px = [[ (31,111,235,255) for _ in range(w)] for _ in range(h)]
    draw(px, w, h)
    raw = bytearray()
    for y in range(h):
        raw.append(0)
        for x in range(w):
            r,g,b,a = px[y][x]
            raw += bytes([r,g,b,a])
    def chunk(tag, data):
        c = tag + data
        return struct.pack('>I', len(data)) + c + struct.pack('>I', zlib.crc32(c))
    sig = b'\x89PNG\r\n\x1a\n'
    ihdr = struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0)
    idat = zlib.compress(bytes(raw), 9)
    data = sig + chunk(b'IHDR', ihdr) + chunk(b'IDAT', idat) + chunk(b'IEND', b'')
    with open(path, 'wb') as f:
        f.write(data)

def draw_helmet(px, w, h):
    cx, cy = w/2, h/2
    r_outer = w*0.33
    for y in range(h):
        for x in range(w):
            dx, dy = x-cx, y-cy
            dist = (dx*dx+dy*dy) ** 0.5
            if dy < 0 and dist < r_outer:
                px[y][x] = (255,255,255,255)
            if 0 <= dy < h*0.06 and abs(dx) < r_outer*1.15:
                px[y][x] = (255,255,255,255)
    bw = w*0.10
    bh = h*0.30
    bx0, by0 = int(cx-bw/2), int(cy - h*0.05)
    for y in range(by0, min(h, int(by0+bh))):
        for x in range(bx0, min(w, int(bx0+bw))):
            px[y][x] = (31,111,235,255)

os.makedirs('icons', exist_ok=True)
png('icons/icon-192.png', 192, draw_helmet)
png('icons/icon-512.png', 512, draw_helmet)
print("done")
