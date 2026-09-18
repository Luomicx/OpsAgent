#!/usr/bin/env python3
"""把 Latin 字体子集下载到本地并生成 @font-face 样式。

为什么不用 Google Fonts CDN：
    桌面应用不应依赖运行时联网取字体 —— 断网时字体会回退到系统字体，
    字宽变化会破坏与设计稿的 1:1 对齐。

为什么只打包 Latin：
    中文完整字库（Noto Sans SC）有 5–10 MB，塞进桌面端不划算。
    中文走系统字体（PingFang SC / Microsoft YaHei），视觉上足够接近。

    python desktop/scripts/bundle_fonts.py
"""

from __future__ import annotations

import re
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
FONT_DIR = ROOT / "desktop" / "src" / "assets" / "fonts"
CSS_OUT = ROOT / "desktop" / "src" / "styles" / "fonts.css"

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)
HEADERS = {"User-Agent": UA, "Accept": "text/css,*/*;q=0.1", "Accept-Language": "en"}

# (CSS 里的 family 名, Google Fonts 查询串, 输出文件名前缀)
FAMILIES = [
    ("Inter", "Inter:wght@300..700", "inter"),
    ("JetBrains Mono", "JetBrains+Mono:wght@400..600", "jbmono"),
]

# 覆盖 Basic Latin 的那一片
LATIN_TOKEN = "U+0000-00FF"


def fetch(url: str) -> bytes:
    return urllib.request.urlopen(
        urllib.request.Request(url, headers=HEADERS), timeout=60
    ).read()


def parse_faces(css: str) -> list[dict[str, str]]:
    """把 @font-face 解析成 dict 列表。

    刻意不用 `\\s`（转义序列在不同 shell 里容易被吃掉），
    改用 `[^;]+` / `[^}]+` 这类不含反斜杠的写法。
    """
    faces = []
    for block in re.findall(r"@font-face[^}]+}", css):
        face = {}
        for key in ("font-family", "font-weight", "font-style", "unicode-range"):
            m = re.search(key + r":([^;]+);", block)
            if m:
                face[key] = m.group(1).strip()
        m = re.search(r"url\((https://[^)]+)\)", block)
        if m:
            face["url"] = m.group(1)
        faces.append(face)
    return faces


def main() -> int:
    FONT_DIR.mkdir(parents=True, exist_ok=True)

    lines = [
        "/* 本地打包字体 —— 由 desktop/scripts/bundle_fonts.py 生成，勿手改。",
        "   桌面应用不应依赖运行时联网取字体，否则断网时字宽变化会破坏与设计稿的 1:1 对齐。",
        "   仅打包 Latin 子集；中文走系统字体（PingFang SC / Microsoft YaHei）。 */",
        "",
    ]
    total = 0
    for family, query, slug in FAMILIES:
        css = fetch(
            f"https://fonts.googleapis.com/css2?family={query}&display=swap"
        ).decode()
        faces = parse_faces(css)
        picked = [f for f in faces if LATIN_TOKEN in f.get("unicode-range", "")]
        if len(picked) != 1:
            print(f"✗ {family}: 期望 1 个 Latin 子集，实得 {len(picked)}")
            return 1

        face = picked[0]
        weight = face.get("font-weight", "400")
        data = fetch(face["url"])
        name = f"{slug}-latin.woff2"
        (FONT_DIR / name).write_bytes(data)
        total += len(data)

        lines.append(
            f"@font-face{{font-family:'{family}';font-style:normal;"
            f"font-weight:{weight};font-display:swap;"
            f"src:url('../assets/fonts/{name}') format('woff2');}}"
        )
        print(f"  ✓ {family:16} {weight:12} {len(data) / 1024:6.1f} KB → {name}")

    CSS_OUT.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"\n✓ {CSS_OUT.relative_to(ROOT)}（字体合计 {total / 1024:.1f} KB）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
