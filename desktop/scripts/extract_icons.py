#!/usr/bin/env python3
"""从设计稿提取图标精灵，生成 React 组件。

**单一事实来源是设计稿**：图标只在 `design/console-ui.html` 里维护，
本脚本把它转成 `desktop/src/components/ui/IconSprite.tsx`。

    python desktop/scripts/extract_icons.py

这样做的好处：图标永远与设计稿一致，不会出现「设计稿改了、代码没改」的漂移。
"""

from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DESIGN = ROOT / "design" / "console-ui.html"
OUT = ROOT / "desktop" / "src" / "components" / "ui" / "IconSprite.tsx"

# SVG 属性名 kebab → camel（React 惯用写法）
ATTR_MAP = [
    ("stroke-width", "strokeWidth"),
    ("stroke-linecap", "strokeLinecap"),
    ("stroke-linejoin", "strokeLinejoin"),
    ("stroke-dasharray", "strokeDasharray"),
    ("stroke-dashoffset", "strokeDashoffset"),
    ("fill-rule", "fillRule"),
    ("clip-rule", "clipRule"),
    ("text-anchor", "textAnchor"),
]


def to_jsx(attrs: str) -> str:
    for kebab, camel in ATTR_MAP:
        attrs = attrs.replace(kebab + "=", camel + "=")
    return attrs


def main() -> int:
    src = DESIGN.read_text(encoding="utf-8")
    m = re.search(
        r'<svg xmlns="http://www\.w3\.org/2000/svg" style="position:absolute.*?</svg>',
        src,
        re.S,
    )
    if not m:
        print(f"✗ 在 {DESIGN} 里找不到图标 sprite")
        return 1

    syms = re.findall(
        r'<symbol id="([^"]+)" viewBox="([^"]+)">(.*?)</symbol>', m.group(0), re.S
    )
    if not syms:
        print("✗ 没有提取到任何 <symbol>")
        return 1

    body = "\n".join(
        f'    <symbol id="{i}" viewBox="{vb}">{to_jsx(inner)}</symbol>'
        for i, vb, inner in syms
    )
    ids_union = "\n".join(f"  | '{i}'" for i, _, _ in syms)
    ids_array = ", ".join(f"'{i}'" for i, _, _ in syms)

    tsx = f"""/**
 * 图标精灵。**自动生成，请勿手改**。
 *
 * 单一事实来源是设计稿 design/console-ui.html；
 * 要改图标请先改设计稿，再执行：
 *
 *     python desktop/scripts/extract_icons.py
 *
 * 用法：<Icon name="i-shield" /> —— 内部走 <use href="#id">，
 * 描边与填充由 CSS 的 .ic 控制，颜色继承 currentColor。
 */
const SPRITE = `
{body}
`;

export const ICON_IDS = [{ids_array}] as const;

export type IconId =
{ids_union};

export default function IconSprite() {{
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      style={{{{ position: 'absolute', width: 0, height: 0, overflow: 'hidden' }}}}
      aria-hidden="true"
      dangerouslySetInnerHTML={{{{ __html: SPRITE }}}}
    />
  );
}}
"""

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(tsx, encoding="utf-8")
    print(f"✓ {len(syms)} 个图标 → {OUT.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
