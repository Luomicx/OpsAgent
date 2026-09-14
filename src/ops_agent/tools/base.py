"""工具契约（Definition 层）。

这里只定义「工具是什么」，不含任何具体工具实现，也不含 SSH 依赖之外的东西。
工具插件通过 ``command_of()`` 把"我准备执行什么 shell 命令"暴露出来，
权限层因此无需理解每个工具的语义。
"""

from __future__ import annotations

import json
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, ClassVar, Protocol, runtime_checkable


@dataclass(frozen=True)
class ToolSpec:
    """喂给 LLM 的 function-calling schema。"""

    name: str
    description: str
    parameters: dict[str, Any] = field(default_factory=dict)

    def to_openai(self) -> dict[str, Any]:
        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": self.parameters
                or {"type": "object", "properties": {}, "required": []},
            },
        }


@dataclass(frozen=True)
class ToolResult:
    ok: bool
    output: str = ""
    error: str | None = None
    meta: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def success(cls, output: str, **meta: Any) -> ToolResult:
        return cls(ok=True, output=output, meta=meta)

    @classmethod
    def failure(cls, error: str, **meta: Any) -> ToolResult:
        return cls(ok=False, output="", error=error, meta=meta)

    def to_observation(self) -> str:
        """转成回灌给 LLM 的文本。"""
        if self.ok:
            return self.output
        return f"[工具执行失败] {self.error}"


@dataclass(frozen=True)
class ToolContext:
    """工具执行上下文：目标主机 + 执行者 + 最大步数预算等。"""

    host: str = ""
    user: str | None = None
    session_id: str = ""

    def with_host(self, host: str) -> ToolContext:
        return ToolContext(host=host, user=self.user, session_id=self.session_id)


@runtime_checkable
class Tool(Protocol):
    """工具协议（Definition）。"""

    name: str

    def spec(self) -> ToolSpec: ...

    async def invoke(self, args: dict[str, Any], ctx: ToolContext) -> ToolResult: ...

    def command_of(self, args: dict[str, Any]) -> str | None: ...


class BaseTool(ABC):
    """工具基类：实现 spec + invoke，并声明将执行的 shell 命令。"""

    name: str = ""
    description: str = ""
    parameters: ClassVar[dict[str, Any]] = {}

    def spec(self) -> ToolSpec:
        if not self.name:
            raise ValueError("工具必须声明 name")
        return ToolSpec(name=self.name, description=self.description, parameters=self.parameters)

    @abstractmethod
    async def invoke(self, args: dict[str, Any], ctx: ToolContext) -> ToolResult: ...

    def command_of(self, args: dict[str, Any]) -> str | None:
        """返回该调用将要执行的 shell 命令；非 shell 工具返回 ``None``。"""
        return None

    def _require(self, args: dict[str, Any], key: str) -> str:
        value = args.get(key)
        if not isinstance(value, str) or not value.strip():
            raise ValueError(f"参数 '{key}' 缺失或不是字符串")
        return value.strip()

    def dump(self, payload: Any) -> str:
        return json.dumps(payload, ensure_ascii=False, indent=2)
