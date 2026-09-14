"""工具注册表（Provider）。

注册表本身也是一个插件提供的能力：好处是"有哪些工具"这件事同样可插拔，
后续接 MCP 协议时，只需再加一个往这里塞工具的插件。
"""

from __future__ import annotations

from typing import Final

from ..kernel.capability import capability
from ..kernel.container import Plugin, plugin
from ..kernel.context import PluginContext
from .base import Tool, ToolSpec


class ToolRegistry:
    """工具名 -> 工具实例。"""

    def __init__(self) -> None:
        self._tools: dict[str, Tool] = {}

    def register(self, tool: Tool) -> Tool:
        if not tool.name:
            raise ValueError("工具缺少 name")
        if tool.name in self._tools:
            raise ValueError(f"工具重名: {tool.name}")
        self._tools[tool.name] = tool
        return tool

    def unregister(self, name: str) -> None:
        self._tools.pop(name, None)

    def get(self, name: str) -> Tool:
        try:
            return self._tools[name]
        except KeyError as exc:
            raise KeyError(f"未注册的工具: {name}") from exc

    def has(self, name: str) -> bool:
        return name in self._tools

    def names(self) -> list[str]:
        return list(self._tools)

    def specs(self) -> list[ToolSpec]:
        return [t.spec() for t in self._tools.values()]

    def openai_tools(self) -> list[dict]:
        return [s.to_openai() for s in self.specs()]

    def __len__(self) -> int:
        return len(self._tools)


TOOL_REGISTRY: Final = capability("tool_registry", ToolRegistry, "工具注册表")


def _setup(ctx: PluginContext) -> None:
    registry = ToolRegistry()
    ctx.provide(TOOL_REGISTRY, registry)


tool_registry_plugin: Plugin = plugin(
    name="tool_registry",
    setup=_setup,
    provides=(TOOL_REGISTRY,),
)
