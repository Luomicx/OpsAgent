"""L1 全局黑名单。

硬编码 + 可配置的高危模式，命中即拒绝，**不可被后续层级放行**。
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from re import Pattern
from typing import Any

from .base import Decision, PermissionLayer, ToolCall
from .shell import normalize

# 默认高危模式：默认只读场景下，凡写操作、提权、破坏性命令一律禁止
DEFAULT_PATTERNS: tuple[str, ...] = (
    r"\brm\s+-[a-z]*[rf]",  # rm -r / rm -f / rm -rf（变形也吃）
    r"\brm\s+-[a-z]*\s+/(\s|$)",  # rm -x /
    r"\bdd\b.*\bif=",  # dd if=/dev/zero of=/dev/sda
    r"\bmkfs(\.[a-z0-9]+)?\b",
    r"\b(fdisk|parted|wipefs|shred|truncate|swapon|mkswap)\b",
    r"\b(shutdown|reboot|halt|poweroff)\b",
    r"\binit\s+[06]\b",
    r"\bsystemctl\s+(stop|disable|mask|reset-failed)\b",
    r"\bservice\s+\S+\s+(stop|disable)\b",
    r"\b(useradd|userdel|usermod|groupadd|passwd|chpasswd|visudo)\b",
    r"\bchmod\b",
    r"\bchown\b",
    r"\bsudo\b",
    r"\bsu\s",
    r"\bkillall\b",
    r"\bkill\s+-9\s+1\b",
    r"\bcrontab\s+(-r|-e)\b",
    r"/etc/ssh/sshd_config",
    r":\s*\(\s*\)\s*\{",  # fork bomb
    r"\b(curl|wget)\b.*\|\s*(sudo\s+)?(sh|bash|zsh|python)\b",
    r"\|\s*(sudo\s+)?(sh|bash|zsh|python)\b",
    r"\b(sh|bash|zsh|python|perl|ruby)\s+-c\b",
    r"\b(eval|exec)\s",
    r">\s*/dev/(sd[a-z]|nvme|vd[a-z]|xvd[a-z])",
    r"\bmv\s+/\s",
    r"\biptables\b|\bufw\b|\bfirewall-cmd\b",
    r"\bdocker\s+(rm|rmi|stop|kill|exec|run|prune)\b",
    r"\bhistory\s+-c\b",
)

DEFAULT_LITERALS: tuple[str, ...] = (
    "rm -rf /",
    "rm -rf /*",
    "dd if=/dev/zero",
    "chmod -r 777 /",
    "mv / /dev/null",
    ":(){:|:&};:",
)


@dataclass
class Layer1Blacklist(PermissionLayer):
    """L1：全局黑名单层。"""

    layer_id: str = "L1"
    name: str = "全局黑名单"
    description: str = "硬编码禁止破坏性/提权/写操作命令，命中即拒绝"
    patterns: tuple[str, ...] = field(default=DEFAULT_PATTERNS)
    literals: tuple[str, ...] = field(default=DEFAULT_LITERALS)

    def __post_init__(self) -> None:
        self._compiled: list[Pattern[str]] = [re.compile(p) for p in self.patterns]
        self._literals: list[str] = [normalize(x) for x in self.literals]

    # -- 构造 -------------------------------------------------------------
    @classmethod
    def from_config(cls, cfg: dict[str, Any] | None = None) -> Layer1Blacklist:
        cfg = cfg or {}
        # `patterns` / `literals` 若显式给出则完全覆盖默认值；`extra_*` 才是追加
        patterns = tuple(cfg.get("patterns") or ()) or tuple(DEFAULT_PATTERNS) + tuple(
            cfg.get("extra_patterns") or ()
        )
        literals = tuple(cfg.get("literals") or ()) or tuple(DEFAULT_LITERALS) + tuple(
            cfg.get("extra_literals") or ()
        )
        return cls(patterns=patterns, literals=literals)

    # -- 校验 -------------------------------------------------------------
    def check(self, call: ToolCall) -> Decision:
        command = call.command.strip()
        if not command:
            return Decision.allow(self.layer_id, "非命令类工具，黑名单不适用")

        normalized = normalize(command)
        for literal in self._literals:
            if literal and literal in normalized:
                return Decision.deny(
                    self.layer_id, f"命令包含高危片段：{literal!r}", rule=literal
                )

        for pattern in self._compiled:
            match = pattern.search(normalized)
            if match:
                return Decision.deny(
                    self.layer_id,
                    f"命中黑名单模式：/{pattern.pattern}/",
                    rule=match.group(0)[:120],
                )

        return Decision.allow(self.layer_id, "未命中黑名单")

    def rules(self) -> list[str]:
        return [f"pattern:{p}" for p in self.patterns] + [f"literal:{x}" for x in self.literals]
