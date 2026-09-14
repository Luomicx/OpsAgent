"""权限校验流水线。

按 L1 → L2 → L3 顺序执行，**任一层拒绝即中止**，并把决策写入审计事件流
（``permission.allowed`` / ``permission.denied``）。
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any, Final

from ..kernel.capability import capability
from ..kernel.container import Plugin, plugin
from ..kernel.context import PluginContext
from .base import Decision, PermissionLayer, ToolCall
from .layer1_blacklist import Layer1Blacklist
from .layer2_whitelist import Layer2Whitelist
from .layer3_shell_injection import Layer3ShellInjection

PERMISSION_PIPELINE: Final = capability("permission_pipeline", "权限校验流水线")

Emitter = Callable[..., Awaitable[Any]] | None


@dataclass
class PermissionPipeline:
    """串联若干权限层；短路返回第一个拒绝。"""

    layers: list[PermissionLayer]
    emit: Emitter = None

    @classmethod
    def default(cls, cfg: dict[str, Any] | None = None, emit: Emitter = None) -> PermissionPipeline:
        cfg = cfg or {}
        layers: list[PermissionLayer] = [
            Layer1Blacklist.from_config(cfg.get("layer1_blacklist")),
            Layer2Whitelist.from_config(cfg.get("layer2_whitelist")),
            Layer3ShellInjection.from_config(cfg.get("layer3_shell_injection")),
        ]
        return cls(layers=layers, emit=emit)

    def check(self, call: ToolCall) -> Decision:
        for layer in self.layers:
            decision = layer.check(call)
            if not decision.allowed:
                return decision
        return Decision.allow("ALL", f"通过全部 {len(self.layers)} 层校验")

    async def acheck(self, call: ToolCall) -> Decision:
        decision = self.check(call)
        if self.emit is not None:
            if decision.allowed:
                await self.emit(
                    "permission.allowed",
                    tool=call.tool,
                    host=call.host,
                    command=call.command,
                )
            else:
                await self.emit(
                    "permission.denied",
                    tool=call.tool,
                    host=call.host,
                    command=call.command,
                    layer=decision.layer,
                    reason=decision.reason,
                    rule=decision.rule or "",
                )
        return decision

    def check_command(self, command: str, *, tool: str = "cli", host: str = "") -> Decision:
        return self.check(ToolCall(tool=tool, host=host, command=command, args={}))

    def describe(self) -> list[dict[str, Any]]:
        return [
            {
                "layer": layer.layer_id,
                "name": layer.name,
                "description": layer.description,
                "rules": layer.rules(),
            }
            for layer in self.layers
        ]


def _setup(ctx: PluginContext) -> None:
    pipeline = PermissionPipeline.default(
        cfg=dict(ctx.config),
        emit=lambda t, **kw: ctx.emit(t, **kw),
    )
    ctx.provide(PERMISSION_PIPELINE, pipeline)


permission_pipeline_plugin: Plugin = plugin(
    name="permission_pipeline",
    setup=_setup,
    provides=(PERMISSION_PIPELINE,),
)


__all__ = [
    "PERMISSION_PIPELINE",
    "Layer1Blacklist",
    "Layer2Whitelist",
    "Layer3ShellInjection",
    "PermissionPipeline",
    "permission_pipeline_plugin",
]
