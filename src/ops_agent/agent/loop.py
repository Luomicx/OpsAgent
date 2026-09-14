"""Agent 主循环（ReAct：Think → Act → Observe → Repeat → Final）。

这里是唯一编排工具调用的地方，也是权限校验的**强制检查点**：
任何工具执行都必须先经过 :class:`PermissionPipeline`，没有例外。
"""

from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any, Final

from ..adapters.base import MODEL_ADAPTER, ModelAdapter, ToolCallRequest
from ..context.compressor import KeepRecentCompressor
from ..context.manager import ContextManager
from ..kernel.capability import capability
from ..kernel.container import Plugin, plugin
from ..kernel.context import PluginContext
from ..permission.base import ToolCall
from ..permission.pipeline import PERMISSION_PIPELINE, PermissionPipeline
from ..tools.base import ToolContext as ToolExecContext
from ..tools.base import ToolResult
from ..tools.registry import TOOL_REGISTRY, ToolRegistry
from .prompts import build_system_prompt

logger = logging.getLogger(__name__)

AGENT_LOOP: Final = capability("agent_loop", None, "Agent 主循环工厂")

EmitFn = Callable[..., Awaitable[Any]]


async def _noop_emit(*_args: Any, **_kwargs: Any) -> None:
    return None


@dataclass
class AgentConfig:
    max_steps: int = 8
    max_tool_output_chars: int = 4000
    keep_recent: int = 20


@dataclass
class StepRecord:
    """一次工具调用的完整留痕（审计 + 回放用）。"""

    tool: str
    args: dict[str, Any] = field(default_factory=dict)
    command: str = ""
    allowed: bool = True
    layer: str = ""
    reason: str = ""
    output: str = ""

    @property
    def denied(self) -> bool:
        return not self.allowed


@dataclass
class AgentResult:
    text: str = ""
    steps: list[StepRecord] = field(default_factory=list)
    steps_used: int = 0
    finished: bool = True

    @property
    def denied_steps(self) -> list[StepRecord]:
        return [s for s in self.steps if s.denied]


class AgentLoop:
    """单会话的 ReAct 循环。"""

    def __init__(
        self,
        *,
        adapter: ModelAdapter,
        registry: ToolRegistry,
        permission: PermissionPipeline,
        tool_ctx: ToolExecContext,
        emit: EmitFn | None = None,
        config: AgentConfig | None = None,
        system_prompt: str | None = None,
    ) -> None:
        self._adapter = adapter
        self._registry = registry
        self._permission = permission
        self._tool_ctx = tool_ctx
        self._emit = emit or _noop_emit
        self._config = config or AgentConfig()
        self.context = ContextManager(
            system_prompt=system_prompt
            or build_system_prompt(host=tool_ctx.host),
            compressor=KeepRecentCompressor(
                keep_recent=self._config.keep_recent,
            ),
            max_messages=self._config.keep_recent + 20,
        )

    # -- 主入口 -----------------------------------------------------------
    async def run(self, user_input: str) -> AgentResult:
        self.context.add_user(user_input)
        await self._emit("agent.input", input=user_input, host=self._tool_ctx.host)

        result = AgentResult()
        for step in range(1, self._config.max_steps + 1):
            messages = self.context.build()
            await self._emit("agent.think", step=step, messages=len(messages))

            response = await self._adapter.chat(messages, self._registry.openai_tools())
            self.context.add_assistant(response.message)

            if not response.message.has_tool_calls:
                result.text = response.message.content
                result.steps_used = step
                await self._emit("agent.final", step=step, length=len(result.text))
                return result

            for call in response.message.tool_calls:
                record = await self._execute(call)
                result.steps.append(record)
                self.context.add_tool_result(
                    call.id,
                    call.name,
                    self._observation(record),
                )

        result.text = (
            f"已达到最大步数（{self._config.max_steps}）仍未得出结论，已停止。"
        )
        result.steps_used = self._config.max_steps
        result.finished = False
        await self._emit("agent.error", reason="max_steps_exceeded")
        return result

    # -- 单步执行 ---------------------------------------------------------
    async def _execute(self, call: ToolCallRequest) -> StepRecord:
        record = StepRecord(tool=call.name, args=dict(call.arguments))

        if not self._registry.has(call.name):
            record.allowed = False
            record.layer = "-"
            record.reason = f"未注册的工具：{call.name}"
            await self._emit("tool.error", tool=call.name, error=record.reason)
            return record

        tool = self._registry.get(call.name)
        record.command = tool.command_of(call.arguments) or ""

        perm_call = ToolCall(
            tool=call.name,
            args=call.arguments,
            host=self._tool_ctx.host,
            user=self._tool_ctx.user or "",
            command=record.command,
        )
        await self._emit(
            "tool.before",
            tool=call.name,
            command=record.command,
            host=self._tool_ctx.host,
            args=call.arguments,
        )

        decision = await self._permission.acheck(perm_call)
        record.layer = decision.layer
        record.reason = decision.reason
        record.allowed = decision.allowed
        if not decision.allowed:
            await self._emit(
                "tool.after",
                tool=call.name,
                ok=False,
                denied_by=decision.layer,
                reason=decision.reason,
            )
            return record

        try:
            outcome: ToolResult = await tool.invoke(call.arguments, self._tool_ctx)
        except Exception as exc:
            logger.exception("工具 %s 执行异常", call.name)
            record.allowed = True
            record.output = ""
            record.reason = f"{type(exc).__name__}: {exc}"
            await self._emit("tool.error", tool=call.name, error=record.reason)
            return record

        record.output = outcome.to_observation()
        await self._emit(
            "tool.after",
            tool=call.name,
            ok=outcome.ok,
            length=len(record.output),
            exit_code=outcome.meta.get("exit_code"),
        )
        return record

    @staticmethod
    def _observation(record: StepRecord) -> str:
        if not record.allowed:
            return (
                f"[安全策略拒绝 · {record.layer}] {record.reason}"
                f"（命令：{record.command or '-'}）"
            )
        return record.output or "(无输出)"


class AgentLoopFactory:
    """按目标主机创建 AgentLoop（把依赖解析推迟到运行时）。"""

    def __init__(
        self,
        *,
        adapter: ModelAdapter,
        registry: ToolRegistry,
        permission: PermissionPipeline,
        emit: EmitFn | None,
        config: AgentConfig,
    ) -> None:
        self._adapter = adapter
        self._registry = registry
        self._permission = permission
        self._emit = emit
        self._config = config

    def create(
        self, host: str, *, user: str | None = None, system_prompt: str | None = None
    ) -> AgentLoop:
        return AgentLoop(
            adapter=self._adapter,
            registry=self._registry,
            permission=self._permission,
            tool_ctx=ToolExecContext(host=host, user=user),
            emit=self._emit,
            config=self._config,
            system_prompt=system_prompt,
        )


def _setup(ctx: PluginContext) -> None:
    cfg = dict(ctx.config)
    config = AgentConfig(
        max_steps=int(cfg.get("max_steps", 8)),
        max_tool_output_chars=int(cfg.get("max_tool_output_chars", 4000)),
        keep_recent=int(cfg.get("keep_recent", 20)),
    )
    factory = AgentLoopFactory(
        adapter=ctx.require(MODEL_ADAPTER),
        registry=ctx.require(TOOL_REGISTRY),
        permission=ctx.require(PERMISSION_PIPELINE),
        emit=ctx.emit,
        config=config,
    )
    ctx.provide(AGENT_LOOP, factory)


agent_loop_plugin: Plugin = plugin(
    name="agent_loop",
    setup=_setup,
    requires=(MODEL_ADAPTER, TOOL_REGISTRY, PERMISSION_PIPELINE),
    provides=(AGENT_LOOP,),
)


__all__ = [
    "AGENT_LOOP",
    "AgentConfig",
    "AgentLoop",
    "AgentLoopFactory",
    "AgentResult",
    "StepRecord",
    "agent_loop_plugin",
]
