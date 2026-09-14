"""工具插件：列出目标主机目录内容（只读）。"""

from __future__ import annotations

import shlex
from typing import Any, ClassVar

from ..kernel.container import Plugin, plugin
from ..kernel.context import PluginContext
from ..ssh.pool import SSH_POOL, SSHPool
from .base import BaseTool, ToolContext, ToolResult
from .registry import TOOL_REGISTRY, ToolRegistry


class SSHListDirTool(BaseTool):
    name = "ssh_list_dir"
    description = "列出目标主机某个目录的内容（等价于 ls -la），用于定位日志、配置或数据目录。"
    parameters: ClassVar[dict[str, Any]] = {
        "type": "object",
        "properties": {
            "path": {"type": "string", "description": "目录路径，默认 .", "default": "."},
        },
        "required": [],
    }

    def __init__(self, pool: SSHPool) -> None:
        self._pool = pool

    @staticmethod
    def build_command(path: str) -> str:
        return f"ls -la {shlex.quote(path)}"

    def command_of(self, args: dict[str, Any]) -> str | None:
        return self.build_command(str(args.get("path") or "."))

    async def invoke(self, args: dict[str, Any], ctx: ToolContext) -> ToolResult:
        path = str(args.get("path") or ".").strip() or "."
        if not ctx.host:
            return ToolResult.failure("未指定目标主机")
        command = self.build_command(path)
        try:
            result = await self._pool.run(ctx.host, command, user=ctx.user)
        except Exception as exc:  # noqa: BLE001
            return ToolResult.failure(f"{type(exc).__name__}: {exc}", path=path)
        if result.exit_code != 0:
            return ToolResult.failure(
                result.output or f"退出码 {result.exit_code}", path=path, exit_code=result.exit_code
            )
        return ToolResult.success(result.output, path=path, exit_code=0)


def _setup(ctx: PluginContext) -> None:
    pool: SSHPool = ctx.require(SSH_POOL)
    registry: ToolRegistry = ctx.require(TOOL_REGISTRY)
    tool = SSHListDirTool(pool)
    registry.register(tool)
    ctx.on_unload(lambda: registry.unregister(tool.name))


ssh_list_dir_plugin: Plugin = plugin(
    name="ssh_list_dir",
    setup=_setup,
    requires=(SSH_POOL, TOOL_REGISTRY),
)
