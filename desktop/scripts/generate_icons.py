#!/usr/bin/env python3
"""生成桌面端图标（ICO + PNG）。

图标是**生成产物**：与其往仓库里塞无法维护的二进制，不如留一个可复现的脚本。
纯标准库实现（zlib + struct），不依赖 Pillow。

    python desktop/scripts/generate_icons.py

设计：深色圆角底 + 蓝色菱形（呼应 CLI 的 ◆ 标记）+ 绿/红两点
（对应本应用的语义色：「放行」与「拦截」）。
"""

from __future__ import annotations

import struct
import zlib
from pathlib import Path

OUT_DIR = Path(__file__).resolve().parents[1] / "src-tauri" / "icons"

# 与 desktop/src/styles/global.css 的主题色保持一致
BG = (13, 17, 23, 255)          # --bg-base
ACCENT = (74, 158, 255, 255)    # --accent
OK = (47, 191, 143, 255)        # --ok
DANGER = (240, 96, 63, 255)     # --danger
TRANSPARENT = (0, 0, 0, 0)

SS = 4  # 超采样倍数：靠它得到平滑边缘，避免锯齿


def blend(dst: tuple[int, ...], src: tuple[int, ...], alpha: float) -> tuple[int, ...]:
    """把 src 以 alpha 覆盖到 dst 上。"""
    return tuple(
        int(round(dst[i] * (1 - alpha) + src[i] * alpha)) for i in range(4)
    )


def rounded_rect_hit(x: float, y: float, size: float, radius: float) -> bool:
    """点是否落在圆角矩形内。"""
    cx = min(max(x, radius), size - radius)
    cy = min(max(y, radius), size - radius)
    if (x, y) == (cx, cy):
        return True
    return (x - cx) ** 2 + (y - cy) ** 2 <= radius**2


def diamond_hit(x: float, y: float, size: float, thickness: float) -> bool:
    """点是否落在「菱形描边」上（曼哈顿距离在带内）。

    菱形略高于几何中心，给下方两个语义点留出位置。
    """
    cx = size / 2
    cy = size * 0.44
    d = abs(x - cx) + abs(y - cy)
    half = size * 0.27
    return abs(d - half) <= thickness


def dot_hit(x: float, y: float, cx: float, cy: float, r: float) -> bool:
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r


def render(size: int) -> list[list[tuple[int, ...]]]:
    """渲染一张 size×size 的 RGBA 图（超采样抗锯齿）。"""
    big = size * SS
    radius = big * 0.20
    thickness = big * 0.042
    dot_r = big * 0.058

    # 底部绿点、红点 —— 语义是「放行 / 拦截」，错开菱形下缘以免被遮住
    dot_y = big * 0.795
    left_dot = (big * 0.37, dot_y)
    right_dot = (big * 0.63, dot_y)

    rows: list[list[tuple[int, ...]]] = []
    for py in range(size):
        row: list[tuple[int, ...]] = []
        for px in range(size):
            # 对该像素做 SS×SS 采样后平均
            acc = [0.0, 0.0, 0.0, 0.0]
            for sy in range(SS):
                for sx in range(SS):
                    x = px * SS + sx + 0.5
                    y = py * SS + sy + 0.5
                    pixel = TRANSPARENT
                    if rounded_rect_hit(x, y, big, radius):
                        pixel = BG
                        if diamond_hit(x, y, big, thickness):
                            pixel = ACCENT
                        elif dot_hit(x, y, *left_dot, dot_r):
                            pixel = OK
                        elif dot_hit(x, y, *right_dot, dot_r):
                            pixel = DANGER
                    for i in range(4):
                        acc[i] += pixel[i]
            n = SS * SS
            row.append(tuple(int(round(v / n)) for v in acc))
        rows.append(row)
    return rows


def to_png(rows: list[list[tuple[int, ...]]]) -> bytes:
    """把 RGBA 像素写成 PNG 字节。"""
    height = len(rows)
    width = len(rows[0])

    raw = bytearray()
    for row in rows:
        raw.append(0)  # 每行的 filter type：0 = None
        for pixel in row:
            raw.extend(pixel)

    def chunk(tag: bytes, payload: bytes) -> bytes:
        return (
            struct.pack(">I", len(payload))
            + tag
            + payload
            + struct.pack(">I", zlib.crc32(tag + payload) & 0xFFFFFFFF)
        )

    ihdr = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", zlib.compress(bytes(raw), 9))
        + chunk(b"IEND", b"")
    )


def to_ico(images: list[tuple[int, bytes]]) -> bytes:
    """把多张 PNG 打包成 ICO（Vista+ 支持内嵌 PNG）。"""
    count = len(images)
    header = struct.pack("<HHH", 0, 1, count)
    offset = 6 + count * 16

    entries = bytearray()
    payload = bytearray()
    for size, png in images:
        # 256 在 ICO 里用 0 表示
        dim = 0 if size >= 256 else size
        entries.extend(
            struct.pack(
                "<BBBBHHII",
                dim,          # width
                dim,          # height
                0,            # 调色板数
                0,            # 保留
                1,            # 色彩平面
                32,           # 位深
                len(png),     # 数据长度
                offset,       # 数据偏移
            )
        )
        payload.extend(png)
        offset += len(png)

    return bytes(header) + bytes(entries) + bytes(payload)


def main() -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    sizes = [16, 32, 48, 64, 128, 256]
    pngs: dict[int, bytes] = {}
    for size in sizes:
        pngs[size] = to_png(render(size))
        print(f"  渲染 {size}x{size}")

    # Windows 可执行文件图标
    ico_path = OUT_DIR / "icon.ico"
    ico_path.write_bytes(to_ico([(s, pngs[s]) for s in [256, 128, 64, 48, 32, 16]]))
    print(f"  写出 {ico_path.name}")

    # Tauri 打包所需的标准 PNG 尺寸
    for name, size in [
        ("32x32.png", 32),
        ("128x128.png", 128),
        ("128x128@2x.png", 256),
        ("icon.png", 256),
    ]:
        path = OUT_DIR / name
        path.write_bytes(pngs[size])
        print(f"  写出 {name}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
