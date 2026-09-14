"""工具插件：注册表 + 三个 SSH 只读工具。"""

from .base import BaseTool, Tool, ToolContext, ToolResult, ToolSpec
from .registry import TOOL_REGISTRY, ToolRegistry, tool_registry_plugin
from .ssh_execute import SSHExecuteTool, ssh_execute_plugin
from .ssh_list_dir import SSHListDirTool, ssh_list_dir_plugin
from .ssh_read_file import SSHReadFileTool, ssh_read_file_plugin

__all__ = [
    "TOOL_REGISTRY",
    "BaseTool",
    "SSHExecuteTool",
    "SSHListDirTool",
    "SSHReadFileTool",
    "Tool",
    "ToolContext",
    "ToolRegistry",
    "ToolResult",
    "ToolSpec",
    "ssh_execute_plugin",
    "ssh_list_dir_plugin",
    "ssh_read_file_plugin",
    "tool_registry_plugin",
]
