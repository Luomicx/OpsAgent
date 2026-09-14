"""插件容器内核。

Kernel 是本项目唯一的「运行时」，但它**不含任何业务逻辑** —— 只负责：

* 插件的加载 / 卸载 / 依赖校验
* 能力的注册与解析（Provider / Consumer 解耦）
* 事件总线的持有
* 卸载钩子的执行（可逆副作用）

新增能力 = 新增插件，不允许改这里。
"""

from __future__ import annotations

import inspect
import logging
from collections.abc import Awaitable, Callable, Iterable, Sequence
from dataclasses import dataclass, field
from typing import Any, TypeVar

from .capability import Capability, MissingCapabilityError
from .context import PluginContext
from .events import EventBus

logger = logging.getLogger(__name__)

T = TypeVar("T")

CapRef = Capability[Any] | str
SetupFn = Callable[[PluginContext], Awaitable[None] | None]


@dataclass(frozen=True)
class Plugin:
    """插件描述符。命名约定见 AGENTS.md 3.2：变量名形如 ``ssh_execute_plugin``。"""

    name: str
    setup: SetupFn
    requires: tuple[CapRef, ...] = ()
    provides: tuple[CapRef, ...] = ()
    version: str = "0.1.0"

    def __post_init__(self) -> None:
        if not self.name:
            raise ValueError("plugin name 不能为空")


def plugin(
    name: str,
    *,
    setup: SetupFn,
    requires: Sequence[CapRef] = (),
    provides: Sequence[CapRef] = (),
    version: str = "0.1.0",
) -> Plugin:
    """函数式创建插件的小助手，让插件声明读起来像配置。"""
    return Plugin(
        name=name,
        setup=setup,
        requires=tuple(requires),
        provides=tuple(provides),
        version=version,
    )


@dataclass
class _LoadedPlugin:
    plugin: Plugin
    ctx: PluginContext
    capabilities: list[str] = field(default_factory=list)


def _cap_name(cap: CapRef) -> str:
    return cap.name if isinstance(cap, Capability) else cap


class Kernel:
    """插件容器。典型用法::

        kernel = Kernel(config)
        await kernel.load_all([ssh_pool_plugin, ssh_execute_plugin, ...])
        tool_registry = kernel.get(TOOL_REGISTRY)
    """

    def __init__(self, config: dict[str, Any] | None = None) -> None:
        self._config: dict[str, Any] = config or {}
        self._events = EventBus()
        self._capabilities: dict[str, Any] = {}
        self._owners: dict[str, str] = {}
        self._plugins: dict[str, _LoadedPlugin] = {}
        self._order: list[str] = []
        self._closed = False

    # -- 基础属性 ---------------------------------------------------------
    @property
    def events(self) -> EventBus:
        return self._events

    @property
    def config(self) -> dict[str, Any]:
        return self._config

    @property
    def plugins(self) -> list[str]:
        return list(self._order)

    async def emit(self, event_type: str, **data: Any) -> Any:
        """便捷方法：在内核事件总线上发一个事件。"""
        return await self._events.emit(event_type, **data)

    @property
    def capabilities(self) -> dict[str, str]:
        """能力名 -> 提供它的插件名。"""
        return dict(self._owners)

    # -- 能力注册与解析 ---------------------------------------------------
    def register_capability(self, cap: CapRef, instance: Any, provider: str = "") -> None:
        name = _cap_name(cap)
        if name in self._capabilities and self._owners.get(name) != provider:
            logger.warning(
                "capability '%s' 被 %s 覆盖（原提供者 %s）",
                name,
                provider,
                self._owners.get(name),
            )
        self._capabilities[name] = instance
        self._owners[name] = provider

    def has(self, cap: CapRef) -> bool:
        return _cap_name(cap) in self._capabilities

    def get(self, cap: Capability[T] | str) -> T:
        name = _cap_name(cap)
        if name not in self._capabilities:
            raise MissingCapabilityError(name)
        instance = self._capabilities[name]
        if isinstance(cap, Capability) and cap.contract is not None:
            self._assert_contract(name, instance, cap.contract)
        return instance  # type: ignore[no-any-return]

    def try_get(self, cap: Capability[T] | str, default: T | None = None) -> T | None:
        try:
            return self.get(cap)
        except MissingCapabilityError:
            return default

    @staticmethod
    def _assert_contract(name: str, instance: Any, contract: type) -> None:
        try:
            ok = isinstance(instance, contract)
        except TypeError:
            return  # 非 runtime_checkable 的 Protocol 无法 isinstance，跳过
        if not ok:
            raise TypeError(f"capability '{name}' 的实现 {instance!r} 不满足契约 {contract!r}")

    # -- 生命周期 ---------------------------------------------------------
    async def load(self, plug: Plugin) -> PluginContext:
        if self._closed:
            raise RuntimeError("Kernel 已关闭，无法加载插件")
        if plug.name in self._plugins:
            raise ValueError(f"插件 '{plug.name}' 已加载")

        missing = [_cap_name(c) for c in plug.requires if not self.has(c)]
        if missing:
            raise MissingCapabilityError(missing[0], requester=plug.name)

        ctx = PluginContext(
            kernel=self,
            plugin_name=plug.name,
            events=self._events,
            config=self._config.get(plug.name, {}),
        )
        entry = _LoadedPlugin(plugin=plug, ctx=ctx)
        self._plugins[plug.name] = entry
        self._order.append(plug.name)

        outcome = plug.setup(ctx)
        if inspect.isawaitable(outcome):
            await outcome

        # 插件可能在 setup 中注册了任意能力，这里按声明补齐归属并校验契约（尽早失败）
        for cap in plug.provides:
            name = _cap_name(cap)
            if name not in self._capabilities:
                logger.warning("插件 %s 声明提供 '%s' 但 setup 未注册", plug.name, name)
                continue
            if isinstance(cap, Capability) and cap.contract is not None:
                self._assert_contract(name, self._capabilities[name], cap.contract)
            entry.capabilities.append(name)
            self._owners.setdefault(name, plug.name)

        await self._events.emit("plugin.loaded", plugin=plug.name, version=plug.version)
        return ctx

    async def load_all(self, plugins: Iterable[Plugin]) -> None:
        """按依赖关系做拓扑排序后依次加载。

        多轮扫描：每轮加载"依赖已满足"的插件；某一轮没有任何进展说明存在无法满足的依赖。
        """
        pending = list(plugins)
        while pending:
            ready = [
                p
                for p in pending
                if all(self.has(c) for c in p.requires) and p.name not in self._plugins
            ]
            if not ready:
                names = ", ".join(p.name for p in pending)
                blocked = ", ".join(
                    f"{p.name}->{_cap_name(c)}"
                    for p in pending
                    for c in p.requires
                    if not self.has(c)
                )
                raise MissingCapabilityError(blocked or names, requester="load_all")
            for p in ready:
                await self.load(p)
                pending.remove(p)

    async def unload(self, name: str) -> None:
        entry = self._plugins.pop(name, None)
        if entry is None:
            return
        entry.ctx.teardown()  # 可逆副作用：倒序撤销
        for cap_name in entry.capabilities:
            self._capabilities.pop(cap_name, None)
            self._owners.pop(cap_name, None)
        if name in self._order:
            self._order.remove(name)
        await self._events.emit("plugin.unloaded", plugin=name)

    async def shutdown(self) -> None:
        for name in reversed(self._order):
            await self.unload(name)
        self._closed = True
        await self._events.emit("kernel.shutdown", plugins=len(self._plugins))
