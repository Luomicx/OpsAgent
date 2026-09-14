"""Mock 适配器：不联网也能跑通整条链路（测试 + 离线演示）。"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from ..kernel.container import Plugin, plugin
from ..kernel.context import PluginContext
from .base import MODEL_ADAPTER, Message, Response, ToolCallRequest

ChatHandler = Callable[[list[Message]], Response]


class MockAdapter:
    """按预设剧本返回响应。

    优先级：``handler`` > ``responses`` 队列 > 默认兜底。
    """

    name = "mock"

    def __init__(
        self,
        responses: list[Response] | None = None,
        *,
        handler: ChatHandler | None = None,
    ) -> None:
        self._responses = list(responses or [])
        self._handler = handler
        self.calls: list[list[Message]] = []

    def supports_function_calling(self) -> bool:
        return True

    async def chat(
        self, messages: list[Message], tools: list[dict[str, Any]] | None = None
    ) -> Response:
        self.calls.append(list(messages))
        if self._handler is not None:
            return self._handler(messages)
        if self._responses:
            return self._responses.pop(0)
        return Response(Message.assistant("（mock）没有更多预设响应了。"))


def _tool(name: str, **arguments: Any) -> ToolCallRequest:
    seed = abs(hash((name, tuple(sorted(arguments.items())))))
    return ToolCallRequest(id=f"call_{seed % 10_000}", name=name, arguments=arguments)


def demo_handler(messages: list[Message]) -> Response:
    """离线演示剧本：查磁盘/内存 → 尝试一次写操作（应被权限层拒绝）→ 总结。"""
    tool_results = [m for m in messages if m.role == "tool"]
    if not tool_results:
        return Response(
            Message.assistant(
                "我先看一下磁盘和内存。",
                tool_calls=[
                    _tool("ssh_execute", command="df -h"),
                    _tool("ssh_execute", command="free -m"),
                ],
            )
        )
    if len(tool_results) < 3:
        # 故意发起一次写操作，用于演示 L1 拦截
        return Response(
            Message.assistant(
                "日志目录可能占满了，我清理一下旧的日志。",
                tool_calls=[
                    _tool("ssh_execute", command="rm -rf /var/log/old"),
                ],
            )
        )
    return Response(
        Message.assistant("诊断完成：磁盘与内存都在正常范围，清理操作已被安全策略拦截。")
    )


def demo_adapter() -> MockAdapter:
    return MockAdapter(handler=demo_handler)


def _setup(ctx: PluginContext) -> None:
    cfg = dict(ctx.config)
    if cfg.get("demo"):
        ctx.provide(MODEL_ADAPTER, demo_adapter())
        return
    # 允许通过配置注入静态回复序列，方便脚本化测试
    replies = [Message.assistant(str(x)) for x in cfg.get("replies", [])]
    ctx.provide(MODEL_ADAPTER, MockAdapter([Response(m) for m in replies]))


mock_adapter_plugin: Plugin = plugin(
    name="mock_adapter",
    setup=_setup,
    provides=(MODEL_ADAPTER,),
)
