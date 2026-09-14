"""OpsAgent —— 基于 SSH 的智能运维 Agent。

插件化内核 + 分层权限控制 + append-only 会话事件流。
"""

from __future__ import annotations

from .kernel import Kernel, Plugin, PluginContext, plugin
from .runtime import build_kernel, default_plugins

__version__ = "0.1.0"

__all__ = [
    "Kernel",
    "Plugin",
    "PluginContext",
    "__version__",
    "build_kernel",
    "default_plugins",
    "plugin",
]
