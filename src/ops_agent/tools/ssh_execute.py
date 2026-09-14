"""工具插件：在目标主机执行一条只读诊断命令。"""

from __future__ import annotations

from typing import Any, ClassVar

from ..kernel.container import Plugin, plugin
from ..kernel.context import PluginContext
from ..ssh.pool import SSH_POOL, SSHPool
from .base import BaseTool, ToolContext, ToolResult
from .registry import TOOL_REGISTRY, ToolRegistry

MAX_TIMEOUT = 60


class SSHExecuteTool(BaseTool):
    name = "ssh_execute"
    description = (
        "在目标主机上执行一条**只读诊断**命令（如 df/free/ps/journalctl/tail），"
        "返回 stdout、stderr 与退出码。禁止用于任何写操作。"
    )
    parameters: ClassVar[dict[str, Any]] = {
        "type": "object",
        "properties": {
            "command": {
                "type": "string",
                "description": "要执行的 shell 命令，必须是只读诊断类命令",
            },
            "timeout": {
                "type": "integer",
                "description": f"超时秒数，默认 15，最大 {MAX_TIMEOUT}",
                "minimum": 1,
                "maximum": MAX_TIMEOUT,
            },
        },
        "required": ["command"],
    }

    def __init__(self, pool: SSHPool) -> None:
        self._pool = pool

    def command_of(self, args: dict[str, Any]) -> str | None:
        return args.get("command")

    async def invoke(self, args: dict[str, Any], ctx: ToolContext) -> ToolResult:
        command = self._require(args, "command")
        timeout = min(int(args.get("timeout") or 15), MAX_TIMEOUT)
        if not ctx.host:
            return ToolResult.failure("未指定目标主机")
        try:
            result = await self._pool.run(ctx.host, command, user=ctx.user, timeout=float(timeout))
        except Exception as exc:  # noqa: BLE001 - 工具失败要变成 LLM 可理解的 observation
            return ToolResult.failure(f"{type(exc).__name__}: {exc}", command=command)
        return ToolResult.success(
            result.output,
            exit_code=result.exit_code,
            host=result.host,
            duration_ms=result.duration_ms,
            command=command,
        )


def _setup(ctx: PluginContext) -> None:
    pool: SSHPool = ctx.require(SSH_POOL)
    registry: ToolRegistry = ctx.require(TOOL_REGISTRY)

    tool = SSHExecuteTool(pool)
    registry.register(tool)
    # 可逆副作用：卸载插件时把工具摘掉，避免注册表里留下悬空引用
    ctx.on_unload(lambda: registry.unregister(tool.name))


ssh_execute_plugin: Plugin = plugin(
    name="ssh_execute",
    setup=_setup,
    requires=(SSH_POOL, TOOL_REGISTRY),
)
