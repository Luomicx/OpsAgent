"""事件总线。

事件名遵循 ``<domain>.<action>`` 约定（见 AGENTS.md 3.2）。
所有订阅都返回 :class:`Handle`，配合 ``off()`` 即可实现「可逆副作用」。
"""

from __future__ import annotations

import asyncio
import inspect
import logging
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any

logger = logging.getLogger(__name__)

Handler = Callable[["Event"], Awaitable[None] | None]
WILDCARD = "*"


@dataclass(frozen=True)
class Event:
    """一次事件实例（不可变，事件流是 append-only 的）。"""

    type: str
    data: dict[str, Any] = field(default_factory=dict)
    ts: float = field(default_factory=time.time)


@dataclass(frozen=True)
class Handle:
    """订阅句柄，用于精确退订。"""

    type: str
    handler: Handler

    @property
    def handler_name(self) -> str:
        return getattr(self.handler, "__name__", repr(self.handler))


class EventBus:
    """进程内事件总线。

    * ``on(type, handler)`` 返回句柄；``off(handle)`` 精确移除 —— 插件卸载时可完整撤销。
    * ``emit`` 为异步，按订阅顺序 await 所有 handler；单个 handler 抛错不影响其它订阅者。
    * 支持 ``*`` 通配订阅（常用于审计落盘）。
    """

    def __init__(self) -> None:
        self._handlers: dict[str, list[Handler]] = {}
        self._wildcard: list[Handler] = []

    def on(self, type: str, handler: Handler) -> Handle:
        if type == WILDCARD:
            self._wildcard.append(handler)
        else:
            self._handlers.setdefault(type, []).append(handler)
        return Handle(type, handler)

    def off(self, handle: Handle) -> None:
        bucket = self._wildcard if handle.type == WILDCARD else self._handlers.get(handle.type, [])
        for i, h in enumerate(bucket):
            if h is handle.handler:
                bucket.pop(i)
                return

    def listeners(self, type: str) -> int:
        return len(self._handlers.get(type, [])) + len(self._wildcard)

    async def emit(self, type: str, **data: Any) -> Event:
        event = Event(type=type, data=data)
        for handler in [*(self._handlers.get(type) or []), *self._wildcard]:
            try:
                outcome = handler(event)
                if inspect.isawaitable(outcome):
                    await outcome
            except Exception:
                logger.exception("event handler %s failed on %s", handler, type)
        return event

    def emit_sync(self, type: str, **data: Any) -> Event:
        """同步发射，仅供没有事件循环的场景（如纯函数测试）。"""
        event = Event(type=type, data=data)
        for handler in [*(self._handlers.get(type) or []), *self._wildcard]:
            outcome = handler(event)
            if inspect.isawaitable(outcome):
                logger.warning("async handler %s skipped in emit_sync", handler)
                outcome.close()  # 避免 "coroutine was never awaited" 警告
        return event

    async def drain(self) -> None:
        """让出一次事件循环，便于测试中刷新回调。"""
        await asyncio.sleep(0)
