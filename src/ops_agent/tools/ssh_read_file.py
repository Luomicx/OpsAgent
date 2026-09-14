"""工具插件：读取目标主机上的文件内容（只读）。"""

from __future__ import annotations

import shlex
from typing import Any, ClassVar

from ..kernel.container import Plugin, plugin
from ..kernel.context import PluginContext
from ..ssh.pool import SSH_POOL, SSHPool
from .base import BaseTool, ToolContext, ToolResult
from .registry import TOOL_REGISTRY, ToolRegistry

MAX_LINES = 2000
DEFAULT_LINES = 200


class SSHReadFileTool(BaseTool):
    name = "ssh_read_file"
    description = "读取目标主机上一个文本文件的前 N 行（默认 200 行），用于查看日志或配置。"
    parameters: ClassVar[dict[str, Any]] = {
        "type": "object",
        "properties": {
            "path": {"type": "string", "description": "文件绝对路径，如 /var/log/nginx/error.log"},
            "lines": {
                "type": "integer",
                "description": f"读取行数，默认 {DEFAULT_LINES}，最大 {MAX_LINES}",
                "minimum": 1,
                "maximum": MAX_LINES,
            },
        },
        "required": ["path"],
    }

    def __init__(self, pool: SSHPool) -> None:
        self._pool = pool

    @staticmethod
    def build_command(path: str, lines: int) -> str:
        # shlex.quote 是硬性要求：路径来自 LLM/用户，绝不能裸拼进 shell
        return f"head -n {int(lines)} {shlex.quote(path)}"

    def command_of(self, args: dict[str, Any]) -> str | None:
        path = args.get("path")
        if not path:
            return None
        return self.build_command(str(path), int(args.get("lines") or DEFAULT_LINES))

    async def invoke(self, args: dict[str, Any], ctx: ToolContext) -> ToolResult:
        path = self._require(args, "path")
        lines = max(1, min(int(args.get("lines") or DEFAULT_LINES), MAX_LINES))
        if not ctx.host:
            return ToolResult.failure("未指定目标主机")
        command = self.build_command(path, lines)
        try:
            result = await self._pool.run(ctx.host, command, user=ctx.user)
        except Exception as exc:  # noqa: BLE001
            return ToolResult.failure(f"{type(exc).__name__}: {exc}", path=path)
        if result.exit_code != 0:
            return ToolResult.failure(
                result.output or f"退出码 {result.exit_code}", path=path, exit_code=result.exit_code
            )
        return ToolResult.success(result.output, path=path, lines=lines, exit_code=0)


def _setup(ctx: PluginContext) -> None:
    pool: SSHPool = ctx.require(SSH_POOL)
    registry: ToolRegistry = ctx.require(TOOL_REGISTRY)
    tool = SSHReadFileTool(pool)
    registry.register(tool)
    ctx.on_unload(lambda: registry.unregister(tool.name))


ssh_read_file_plugin: Plugin = plugin(
    name="ssh_read_file",
    setup=_setup,
    requires=(SSH_POOL, TOOL_REGISTRY),
)
