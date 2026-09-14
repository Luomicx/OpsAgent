"""插件上下文。

插件唯一能接触到的 Kernel 门面。提供四件事：事件、配置、能力注册/解析、**卸载钩子**。
任何运行时副作用都必须配一个 ``on_unload``，卸载时 Kernel 会倒序执行，保证可逆。
"""

from __future__ import annotations

import contextlib
from collections.abc import Callable
from typing import TYPE_CHECKING, Any, TypeVar

from .capability import Capability, MissingCapabilityError
from .events import Event, EventBus, Handle

if TYPE_CHECKING:  # pragma: no cover - 仅类型检查
    from .container import Kernel

T = TypeVar("T")

TeardownFn = Callable[[], None]


class PluginContext:
    """传给 ``Plugin.setup(ctx)`` 的上下文对象。"""

    def __init__(
        self,
        kernel: Kernel,
        plugin_name: str,
        events: EventBus,
        config: dict[str, Any] | None = None,
    ) -> None:
        self._kernel = kernel
        self._plugin_name = plugin_name
        self._events = events
        self._config = config or {}
        self._teardowns: list[TeardownFn] = []

    # -- 只读属性 ---------------------------------------------------------
    @property
    def plugin_name(self) -> str:
        return self._plugin_name

    @property
    def events(self) -> EventBus:
        return self._events

    @property
    def config(self) -> dict[str, Any]:
        return self._config

    @property
    def kernel(self) -> Kernel:
        return self._kernel

    # -- 能力 -------------------------------------------------------------
    def provide(self, cap: Capability[T], instance: T) -> T:
        """Provider 角色：把实现注册到 Kernel，供其它插件消费。"""
        self._kernel.register_capability(cap, instance, provider=self._plugin_name)
        return instance

    def require(self, cap: Capability[T]) -> T:
        """Consumer 角色：解析一个能力，缺失时抛 :class:`MissingCapabilityError`。"""
        try:
            return self._kernel.get(cap)
        except MissingCapabilityError as exc:
            exc.requester = self._plugin_name
            raise

    def try_require(self, cap: Capability[T], default: T | None = None) -> T | None:
        """可选依赖：拿不到就返回默认值，不报错。"""
        return self._kernel.try_get(cap, default)

    # -- 可逆副作用 -------------------------------------------------------
    def on(self, event_type: str, handler: Any) -> Handle:
        """订阅事件，并自动登记退订动作（可逆副作用的标准写法）。"""
        handle = self._events.on(event_type, handler)
        self.on_unload(lambda: self._events.off(handle))
        return handle

    def on_unload(self, fn: TeardownFn) -> None:
        """登记卸载时执行的清理动作。"""
        self._teardowns.append(fn)

    def teardown(self) -> None:
        """倒序执行清理动作；单个动作失败不阻断其余清理。"""
        for fn in reversed(self._teardowns):
            with contextlib.suppress(Exception):  # 清理阶段不得抛出
                fn()
        self._teardowns.clear()

    # -- 事件 -------------------------------------------------------------
    async def emit(self, event_type: str, **data: Any) -> Event:
        return await self._events.emit(event_type, **data)

    def __repr__(self) -> str:  # pragma: no cover - 调试友好
        return f"<PluginContext {self._plugin_name}>"
