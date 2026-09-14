"""上下文管理：系统提示 + 消息历史 + 压缩策略。"""

from __future__ import annotations

from dataclasses import dataclass, field

from ..adapters.base import Message
from .compressor import Compressor, KeepRecentCompressor


@dataclass
class ContextManager:
    """一次会话的消息簿。

    压缩策略通过 :class:`Compressor` 注入 —— 未来接 "模型摘要压缩" 时只需换实现。
    """

    system_prompt: str
    compressor: Compressor = field(default_factory=KeepRecentCompressor)
    max_messages: int = 40
    history: list[Message] = field(default_factory=list)

    # -- 写入 -------------------------------------------------------------
    def add(self, message: Message) -> None:
        self.history.append(message)
        self._maybe_compact()

    def add_user(self, content: str) -> None:
        self.add(Message.user(content))

    def add_assistant(self, message: Message) -> None:
        self.add(message)

    def add_tool_result(self, tool_call_id: str, name: str, content: str) -> None:
        self.add(Message.tool_result(tool_call_id, name, content))

    # -- 读取 -------------------------------------------------------------
    def build(self, user_input: str | None = None) -> list[Message]:
        messages: list[Message] = []
        if self.system_prompt:
            messages.append(Message.system(self.system_prompt))
        messages.extend(self.history)
        if user_input:
            messages.append(Message.user(user_input))
        return messages

    def snapshot(self) -> list[Message]:
        return list(self.history)

    def estimate_chars(self) -> int:
        return sum(len(m.content) for m in self.history) + len(self.system_prompt)

    # -- 压缩 -------------------------------------------------------------
    def _maybe_compact(self) -> None:
        if len(self.history) <= self.max_messages:
            return
        self.history = self.compressor.compact(self.history, self.system_prompt)

    def reset(self) -> None:
        self.history.clear()
