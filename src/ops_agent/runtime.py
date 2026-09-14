"""默认插件集的组装。

「新增能力 = 新增插件」的落点就在 :func:`default_plugins` 这一个列表里。
"""

from __future__ import annotations

from typing import Any

from .adapters.deepseek import deepseek_adapter_plugin
from .adapters.mock import mock_adapter_plugin
from .agent.loop import agent_loop_plugin
from .config import expand_env, kernel_config, load_permission_rules
from .kernel.container import Kernel, Plugin
from .permission.pipeline import permission_pipeline_plugin
from .session.store import session_store_plugin
from .ssh.pool import ssh_pool_plugin
from .tools.registry import tool_registry_plugin
from .tools.ssh_execute import ssh_execute_plugin
from .tools.ssh_list_dir import ssh_list_dir_plugin
from .tools.ssh_read_file import ssh_read_file_plugin

ADAPTER_PLUGINS: dict[str, Plugin] = {
    "deepseek": deepseek_adapter_plugin,
    "mock": mock_adapter_plugin,
}


def default_plugins(adapter: str = "mock") -> tuple[Plugin, ...]:
    """返回默认插件集（顺序无关，Kernel 会按依赖拓扑排序）。"""
    try:
        adapter_plugin = ADAPTER_PLUGINS[adapter]
    except KeyError as exc:
        raise ValueError(f"未知适配器: {adapter}，可选: {list(ADAPTER_PLUGINS)}") from exc
    return (
        tool_registry_plugin,
        permission_pipeline_plugin,
        ssh_pool_plugin,
        ssh_execute_plugin,
        ssh_read_file_plugin,
        ssh_list_dir_plugin,
        adapter_plugin,
        agent_loop_plugin,
    )


async def build_kernel(
    raw_config: dict[str, Any] | None = None,
    *,
    adapter: str = "mock",
    session_path: str | None = None,
    rules_path: str | None = None,
    dry_run: bool = False,
) -> Kernel:
    """按配置组装一个可用的 Kernel。

    ``session_store`` 先行加载，确保它在任何事件产生前完成通配符订阅。
    """
    raw = expand_env(raw_config or {})
    cfg = kernel_config(raw)
    cfg["permission_pipeline"] = load_permission_rules(rules_path, base=raw.get("permission") or {})
    if session_path:
        cfg["session_store"]["path"] = session_path
    if dry_run:
        cfg.setdefault("ssh_pool", {})
        cfg["ssh_pool"]["dry_run"] = True
    if adapter == "mock":
        cfg.setdefault("mock_adapter", {})
        cfg["mock_adapter"]["demo"] = True

    kernel = Kernel(cfg)
    await kernel.load(session_store_plugin)
    await kernel.load_all(default_plugins(adapter))
    return kernel
