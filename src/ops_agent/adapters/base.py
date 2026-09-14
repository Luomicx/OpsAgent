"""模型适配器契约（Definition 层）。

统一的内部消息格式，屏蔽不同厂商 API 的差异。
新增模型 = 新增一个实现 :class:`ModelAdapter` 的插件。
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any, Final, Literal, Protocol, runtime_checkable

from ..kernel.capability import capability

Role = Literal["system", "user", "assistant", "tool"]


@dataclass
class ToolCallRequest:
    """模型发起的一次工具调用请求。"""

    id: str
    name: str
    arguments: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_openai(
        cls, raw: dict[str, Any], fallback_id: str = ""
    ) -> ToolCallRequest:
        fn = raw.get("function") or {}
        raw_args = fn.get("arguments") or "{}"
        try:
            arguments = json.loads(raw_args) if isinstance(raw_args, str) else dict(raw_args)
        except json.JSONDecodeError:
            arguments = {"_raw": raw_args}
        return cls(
            id=raw.get("id") or fallback_id,
            name=str(fn.get("name", "")),
            arguments=arguments,
        )


@dataclass
class Message:
    role: Role
    content: str = ""
    tool_calls: list[ToolCallRequest] = field(default_factory=list)
    tool_call_id: str = ""
    name: str = ""

    # -- 构造糖 -----------------------------------------------------------
    @classmethod
    def system(cls, content: str) -> Message:
        return cls(role="system", content=content)

    @classmethod
    def user(cls, content: str) -> Message:
        return cls(role="user", content=content)

    @classmethod
    def assistant(
        cls, content: str = "", tool_calls: list[ToolCallRequest] | None = None
    ) -> Message:
        return cls(role="assistant", content=content, tool_calls=tool_calls or [])

    @classmethod
    def tool_result(cls, tool_call_id: str, name: str, content: str) -> Message:
        return cls(role="tool", content=content, tool_call_id=tool_call_id, name=name)

    @property
    def has_tool_calls(self) -> bool:
        return bool(self.tool_calls)

    # -- 序列化（OpenAI 兼容格式） ----------------------------------------
    def to_dict(self) -> dict[str, Any]:
        payload: dict[str, Any] = {"role": self.role}
        if self.content:
            payload["content"] = self.content
        if self.role == "assistant" and self.tool_calls:
            payload["tool_calls"] = [
                {
                    "id": call.id,
                    "type": "function",
                    "function": {
                        "name": call.name,
                        "arguments": json.dumps(call.arguments, ensure_ascii=False),
                    },
                }
                for call in self.tool_calls
            ]
        if self.role == "tool":
            payload["tool_call_id"] = self.tool_call_id
            if self.name:
                payload["name"] = self.name
        return payload


@dataclass
class Response:
    """一次模型响应。"""

    message: Message
    finish_reason: str = "stop"
    usage: dict[str, int] = field(default_factory=dict)
    raw: dict[str, Any] = field(default_factory=dict)

    @property
    def text(self) -> str:
        return self.message.content

    @property
    def tool_calls(self) -> list[ToolCallRequest]:
        return self.message.tool_calls


@runtime_checkable
class ModelAdapter(Protocol):
    """模型适配器契约。"""

    name: str

    def supports_function_calling(self) -> bool: ...

    async def chat(
        self, messages: list[Message], tools: list[dict[str, Any]] | None = None
    ) -> Response: ...


MODEL_ADAPTER: Final = capability("model_adapter", None, "模型适配器")


class AdapterError(RuntimeError):
    """模型调用失败。"""
