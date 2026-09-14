"""端到端冒烟：真实组装 Kernel，跑完整链路（假 SSH + mock LLM）。"""

import pytest

from ops_agent.agent import AGENT_LOOP
from ops_agent.permission import PERMISSION_PIPELINE
from ops_agent.runtime import build_kernel, default_plugins
from ops_agent.session import SESSION_STORE
from ops_agent.tools import TOOL_REGISTRY


@pytest.mark.asyncio
async def test_default_plugins_topo_order() -> None:
    plugins = default_plugins("mock")
    names = [p.name for p in plugins]
    assert names.index("ssh_pool") < names.index("ssh_execute")  # 依赖在前
    assert "agent_loop" in names


@pytest.mark.asyncio
async def test_kernel_boots_with_all_capabilities() -> None:
    kernel = await build_kernel({"ssh": {"dry_run": True}}, adapter="mock")
    try:
        assert kernel.get(TOOL_REGISTRY).names() == [
            "ssh_execute",
            "ssh_read_file",
            "ssh_list_dir",
        ]
        assert kernel.get(PERMISSION_PIPELINE).check_command("df -h").allowed
        assert kernel.get(AGENT_LOOP) is not None
        assert kernel.get(SESSION_STORE) is not None
    finally:
        await kernel.shutdown()


@pytest.mark.asyncio
async def test_end_to_end_with_fake_ssh(tmp_path) -> None:
    """一次完整会话：查磁盘 → 尝试写操作被拦截 → 出结论 → 事件落盘。"""
    session_path = tmp_path / "session.jsonl"
    kernel = await build_kernel(
        {"ssh": {"dry_run": True}},
        adapter="mock",
        session_path=str(session_path),
    )
    try:
        loop = kernel.get(AGENT_LOOP).create("demo-host")
        result = await loop.run("看看磁盘和内存")

        assert result.text
        assert len(result.steps) == 3
        assert result.steps[0].command == "df -h"
        assert result.steps[2].denied  # rm -rf 被 L1 拦截
        assert result.denied_steps

        store = kernel.get(SESSION_STORE)
        types = [e.type for e in store.all()]
        assert "agent.input" in types
        assert "tool.before" in types
        assert "permission.denied" in types
        assert "agent.final" in types
        assert store.verify_integrity()
        assert session_path.exists()
    finally:
        await kernel.shutdown()


@pytest.mark.asyncio
async def test_kernel_shutdown_closes_cleanly() -> None:
    kernel = await build_kernel({"ssh": {"dry_run": True}}, adapter="mock")
    await kernel.shutdown()
    assert kernel.plugins == []
