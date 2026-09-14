"""权限层契约（Definition 层）。"""

from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any


@dataclass(frozen=True)
class ToolCall:
    """一次待授权的工具调用。权限层只认这个结构，不认具体工具类型。"""

    tool: str
    args: Mapping[str, Any] = field(default_factory=dict)
    host: str = ""
    user: str = ""
    command: str = ""

    @property
    def summary(self) -> str:
        cmd = self.command or dict(self.args).get("command", "")
        target = f"[{self.host}] " if self.host else ""
        return f"{target}{self.tool}: {cmd}"


@dataclass(frozen=True)
class Decision:
    """单层判定结果。"""

    allowed: bool
    layer: str
    reason: str
    rule: str | None = None

    @classmethod
    def allow(cls, layer: str, reason: str = "通过") -> Decision:
        return cls(allowed=True, layer=layer, reason=reason)

    @classmethod
    def deny(cls, layer: str, reason: str, rule: str | None = None) -> Decision:
        return cls(allowed=False, layer=layer, reason=reason, rule=rule)

    def __bool__(self) -> bool:
        return self.allowed

    def __str__(self) -> str:  # pragma: no cover - 调试友好
        flag = "允许" if self.allowed else "拒绝"
        return f"[{self.layer}] {flag}：{self.reason}"


class PermissionLayer(ABC):
    """权限层基类。新增层级必须继承它并实现 ``check``（AGENTS.md 4.3）。"""

    layer_id: str = "L?"
    name: str = "未命名层"
    description: str = ""

    @abstractmethod
    def check(self, call: ToolCall) -> Decision: ...

    def rules(self) -> list[str]:
        """当前层生效的规则摘要，用于 CLI 展示与审计。"""
        return []

    def __repr__(self) -> str:  # pragma: no cover - 调试友好
        return f"<{self.layer_id} {self.name}>"
