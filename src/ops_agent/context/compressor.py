"""上下文压缩策略。

先做「保留最近 N 条 + 长文本截断」这种**不依赖模型**的实现，
后续要接摘要式压缩（调 LLM 生成 summary）只需再实现一个 :class:`Compressor`。
"""

from __future__ import annotations

from abc import ABC, abstractmethod

from ..adapters.base import Message

MAX_TOOL_OUTPUT_CHARS = 4000


class Compressor(ABC):
    """压缩策略接口。"""

    @abstractmethod
    def compact(self, messages: list[Message], system_prompt: str = "") -> list[Message]: ...

    @staticmethod
    def truncate(text: str, limit: int = MAX_TOOL_OUTPUT_CHARS) -> str:
        if len(text) <= limit:
            return text
        head = text[: limit // 2]
        tail = text[-limit // 2 :]
        return f"{head}\n...[已截断 {len(text) - limit} 字符]...\n{tail}"


class KeepRecentCompressor(Compressor):
    """保留开头的 user 意图 + 最近 N 条，并对超长工具输出做截断。"""

    def __init__(
        self, keep_recent: int = 20, max_output_chars: int = MAX_TOOL_OUTPUT_CHARS
    ) -> None:
        self.keep_recent = keep_recent
        self.max_output_chars = max_output_chars

    def compact(self, messages: list[Message], system_prompt: str = "") -> list[Message]:
        for m in messages:
            if m.role == "tool":
                m.content = self.truncate(m.content, self.max_output_chars)
        if len(messages) <= self.keep_recent:
            return messages
        head = [m for m in messages[:1] if m.role == "user"]
        return [*head, *messages[-self.keep_recent :]]
