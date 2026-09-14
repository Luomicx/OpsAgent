"""能力三角色：Definition / Provider / Consumer。

对应 AGENTS.md 2.2 —— 本模块只放**契约与描述符**，禁止引入任何实现依赖。

* **Definition**：纯契约（``Protocol`` 或抽象类型），描述"能做什么"。
* **Provider**：具体实现，通过 ``PluginContext.provide()`` 自注册到 Kernel。
* **Consumer**：通过 ``PluginContext.require()`` 取用能力，不关心谁提供的。
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any, Generic, Protocol, TypeVar, runtime_checkable

T = TypeVar("T")
T_co = TypeVar("T_co", covariant=True)


@dataclass(frozen=True)
class Capability(Generic[T]):
    """能力描述符：名字 + 契约类型。

    名字是 Kernel 中的唯一键（如 ``"model_adapter"``），契约类型仅用于类型检查与文档。
    """

    name: str
    contract: type[T] | None = None
    description: str = ""

    def __str__(self) -> str:  # pragma: no cover - 调试友好
        return self.name


def capability(name: str, contract: type[T] | None = None, description: str = "") -> Capability[T]:
    """声明一个能力。约定由 Provider 与 Consumer 共同 import 同一个描述符。"""
    return Capability(name=name, contract=contract, description=description)


@runtime_checkable
class Provider(Protocol[T_co]):
    """Provider 角色：在插件 setup 阶段把实现注册进 Kernel。"""

    def provide(self, ctx: Any) -> T_co:
        """构造能力实例；``ctx`` 为 :class:`PluginContext`。"""
        ...


class ProviderFn(Generic[T]):
    """函数式 Provider，把 ``ctx -> T`` 的工厂包装成对象。"""

    def __init__(self, factory: Callable[[Any], T]) -> None:
        self._factory = factory

    def provide(self, ctx: Any) -> T:
        return self._factory(ctx)

    def __call__(self, ctx: Any) -> T:
        return self._factory(ctx)


def consumer(cap: Capability[T]) -> Callable[[Any], T]:
    """Consumer 角色的语法糖：返回一个「从 ctx 取能力」的函数。"""

    def _resolve(ctx: Any) -> T:
        return ctx.require(cap)

    return _resolve


class MissingCapabilityError(KeyError):
    """请求的能力尚未被任何插件提供。"""

    def __init__(self, name: str, requester: str = "") -> None:
        self.name = name
        self.requester = requester
        hint = f"（由 {requester} 请求）" if requester else ""
        super().__init__(f"capability '{name}' 未提供{hint}")
