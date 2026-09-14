"""会话事件流的事件定义。

事件流是**审计、压缩、回放的唯一数据源**（AGENTS.md 2.4）。
事件类型是封闭集合：新增类型必须先在这里登记，不允许随意塞字段。
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass, field
from typing import Any, Final

# --- 事件类型封闭集合 -----------------------------------------------------
SESSION_START: Final = "session.start"
SESSION_END: Final = "session.end"
AGENT_INPUT: Final = "agent.input"
AGENT_THINK: Final = "agent.think"
AGENT_FINAL: Final = "agent.final"
AGENT_ERROR: Final = "agent.error"
TOOL_BEFORE: Final = "tool.before"
TOOL_AFTER: Final = "tool.after"
TOOL_ERROR: Final = "tool.error"
PERMISSION_DENIED: Final = "permission.denied"
PERMISSION_ALLOWED: Final = "permission.allowed"
SSH_CONNECT: Final = "ssh.connect"
SSH_COMMAND: Final = "ssh.command"
CONTEXT_COMPACT: Final = "context.compact"

EVENT_TYPES: Final[frozenset[str]] = frozenset(
    {
        SESSION_START,
        SESSION_END,
        AGENT_INPUT,
        AGENT_THINK,
        AGENT_FINAL,
        AGENT_ERROR,
        TOOL_BEFORE,
        TOOL_AFTER,
        TOOL_ERROR,
        PERMISSION_DENIED,
        PERMISSION_ALLOWED,
        SSH_CONNECT,
        SSH_COMMAND,
        CONTEXT_COMPACT,
    }
)


@dataclass(frozen=True)
class SessionEvent:
    """append-only 事件流中的一条记录。"""

    seq: int
    type: str
    data: dict[str, Any] = field(default_factory=dict)
    ts: float = field(default_factory=time.time)

    def __post_init__(self) -> None:
        if self.type not in EVENT_TYPES:
            raise ValueError(f"未登记的事件类型: {self.type}（请先在 session/event.py 登记）")

    # -- 序列化 -----------------------------------------------------------
    def to_dict(self) -> dict[str, Any]:
        return {"seq": self.seq, "ts": self.ts, "type": self.type, "data": self.data}

    def to_json(self) -> str:
        return json.dumps(self.to_dict(), ensure_ascii=False, separators=(",", ":"))

    @classmethod
    def from_dict(cls, raw: dict[str, Any]) -> SessionEvent:
        return cls(
            seq=int(raw["seq"]),
            type=str(raw["type"]),
            data=dict(raw.get("data") or {}),
            ts=float(raw.get("ts", time.time())),
        )

    @classmethod
    def from_json(cls, line: str) -> SessionEvent:
        return cls.from_dict(json.loads(line))

    def __str__(self) -> str:  # pragma: no cover - 调试友好
        return f"#{self.seq} {self.type} {self.data}"
