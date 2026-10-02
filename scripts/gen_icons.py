# -*- coding: utf-8 -*-
"""生成 fnOS 应用包图标（纯 Python PNG 写入，无外部依赖）。"""
import os
import struct
import zlib

BASE = os.path.join(os.path.dirname(__file__), "..", "custdb")


def make_png(path, size):
    bg = (23, 54, 93)     # #17365D 深蓝
    fg = (91, 155, 213)   # #5B9BD5 中蓝
    accent = (255, 255, 255)  # 白
    r = size * 0.20
    cx = cy = size / 2.0
    half = size * 0.32
    rows = []
    for y in range(size):
        row = bytearray([0])  # PNG filter: None
        for x in range(size):
            qx = max(abs(x - cx) - (half - r), 0.0)
            qy = max(abs(y - cy) - (half - r), 0.0)
            if qx * qx + qy * qy <= r * r:
                # 圆角方块内：绘制一个简单的“信”字形（两条横线+一条竖线）
                inner = False
                if half * 0.55 <= abs(x - cx) <= half * 0.62:
                    inner = True
                if half * 0.55 <= abs(y - cy) <= half * 0.62:
                    inner = True
                color = fg if not inner else accent
            else:
                color = bg
            row += bytes(color)
        rows.append(bytes(row))
    raw = b"".join(rows)

    def chunk(tag, data):
        c = tag + data
        return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c) & 0xFFFFFFFF)

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(raw, 9))
    png += chunk(b"IEND", b"")
    with open(path, "wb") as f:
        f.write(png)
    print("generated", os.path.relpath(path, BASE), size)


def main():
    targets = [
        ("ICON.PNG", 64),
        ("ICON_256.PNG", 256),
        ("app/ui/images/icon_64.png", 64),
        ("app/ui/images/icon_256.png", 256),
    ]
    for rel, size in targets:
        p = os.path.join(BASE, rel)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        make_png(p, size)


if __name__ == "__main__":
    main()
