"""append-only 会话事件存储（JSONL）。

落盘格式一行一条 JSON，天然 append-only：不改写、不删除，只追加。
这样审计可以事后校验完整性（seq 连续），回放可以直接重放工具调用序列。
"""

from __future__ import annotations

import asyncio
from collections.abc import Iterator
from pathlib import Path
from typing import Any, Final

from ..kernel.capability import capability
from ..kernel.container import Plugin, plugin
from ..kernel.context import PluginContext
from .event import EVENT_TYPES, SessionEvent

SESSION_STORE: Final = capability("session_store", "会话事件流存储")


class EventStore:
    """线程/协程安全的事件存储。

    ``path`` 为 ``None`` 时退化成纯内存存储（测试与 dry-run 场景）。
    """

    def __init__(self, path: str | Path | None = None, *, session_id: str = "") -> None:
        self.path = Path(path) if path else None
        self.session_id = session_id
        self._events: list[SessionEvent] = []
        self._seq = 0
        self._lock = asyncio.Lock()
        if self.path:
            self.path.parent.mkdir(parents=True, exist_ok=True)

    # -- 写入 -------------------------------------------------------------
    async def append(self, event: SessionEvent) -> SessionEvent:
        async with self._lock:
            self._seq = max(self._seq, event.seq)
            self._events.append(event)
            if self.path:
                await asyncio.to_thread(self._write_line, event.to_json())
        return event

    def record(self, type: str, **data: Any) -> SessionEvent:
        """构造下一条事件（分配 seq），但不落盘 —— 由 :meth:`append` 完成。"""
        self._seq += 1
        return SessionEvent(seq=self._seq, type=type, data=data)

    async def emit(self, type: str, **data: Any) -> SessionEvent:
        """构造 + 落盘一步到位。"""
        return await self.append(self.record(type, **data))

    def _write_line(self, line: str) -> None:
        assert self.path is not None
        with self.path.open("a", encoding="utf-8") as f:
            f.write(line + "\n")

    # -- 读取 -------------------------------------------------------------
    @property
    def seq(self) -> int:
        return self._seq

    def all(self) -> list[SessionEvent]:
        return list(self._events)

    def replay(self, types: set[str] | None = None) -> Iterator[SessionEvent]:
        for event in self._events:
            if types is None or event.type in types:
                yield event

    @classmethod
    def load(cls, path: str | Path) -> EventStore:
        """从磁盘回放一个已存在的会话。"""
        p = Path(path)
        store = cls(p)
        if not p.exists():
            return store
        for line in p.read_text(encoding="utf-8").splitlines():
            if line.strip():
                event = SessionEvent.from_json(line)
                store._events.append(event)
                store._seq = max(store._seq, event.seq)
        return store

    def verify_integrity(self) -> bool:
        """seq 必须严格递增且从 1 开始 —— 简单的篡改/丢写检测。"""
        return [e.seq for e in self._events] == list(range(1, len(self._events) + 1))


def _setup(ctx: PluginContext) -> None:
    cfg = ctx.config
    store = EventStore(path=cfg.get("path"), session_id=cfg.get("session_id", ""))

    async def _on_any(event: Any) -> None:
        if event.type not in EVENT_TYPES:  # 只落盘已登记的类型，保持事件集封闭
            return
        await store.append(store.record(event.type, **event.data))

    # 通配订阅：所有事件落盘（consumer 角色）
    ctx.on("*", _on_any)
    ctx.provide(SESSION_STORE, store)


session_store_plugin: Plugin = plugin(
    name="session_store",
    setup=_setup,
    provides=(SESSION_STORE,),
)
