"""SSH 工具插件测试（用假连接，不依赖真实主机）。"""

import pytest

from ops_agent.ssh import CommandResult, FakeSSHConnection, SSHPool, fake_factory
from ops_agent.tools import (
    SSHExecuteTool,
    SSHListDirTool,
    SSHReadFileTool,
    ToolContext,
)
from ops_agent.tools.registry import ToolRegistry


@pytest.fixture
def pool() -> SSHPool:
    return SSHPool(factory=fake_factory())


@pytest.fixture
def ctx() -> ToolContext:
    return ToolContext(host="10.0.0.1", user="ops")


@pytest.mark.asyncio
async def test_execute_returns_output(pool: SSHPool, ctx: ToolContext) -> None:
    tool = SSHExecuteTool(pool)
    result = await tool.invoke({"command": "df -h"}, ctx)
    assert result.ok
    assert "/dev/mapper" in result.output
    assert result.meta["exit_code"] == 0


@pytest.mark.asyncio
async def test_execute_requires_command(pool: SSHPool, ctx: ToolContext) -> None:
    tool = SSHExecuteTool(pool)
    with pytest.raises(ValueError):
        await tool.invoke({}, ctx)


@pytest.mark.asyncio
async def test_execute_requires_host(pool: SSHPool) -> None:
    tool = SSHExecuteTool(pool)
    result = await tool.invoke({"command": "df -h"}, ToolContext(host=""))
    assert not result.ok
    assert "未指定目标主机" in (result.error or "")


@pytest.mark.asyncio
async def test_command_of_exposed_for_permission(pool: SSHPool) -> None:
    """command_of 是权限层的输入源，必须原样返回待执行的命令。"""
    tool = SSHExecuteTool(pool)
    assert tool.command_of({"command": "df -h"}) == "df -h"


@pytest.mark.asyncio
async def test_read_file_quotes_path(pool: SSHPool, ctx: ToolContext) -> None:
    tool = SSHReadFileTool(pool)
    command = tool.command_of({"path": "/var/log/nginx/$(whoami).log"})
    assert command is not None
    assert "'" in command  # shlex.quote 必须生效
    result = await tool.invoke({"path": "/etc/hosts"}, ctx)
    assert result.ok


@pytest.mark.asyncio
async def test_read_file_respects_lines(pool: SSHPool, ctx: ToolContext) -> None:
    tool = SSHReadFileTool(pool)
    assert "head -n 10" in (tool.command_of({"path": "/etc/hosts", "lines": 10}) or "")
    assert "head -n 200" in (tool.command_of({"path": "/etc/hosts"}) or "")


def test_list_dir_default_path(pool: SSHPool) -> None:
    tool = SSHListDirTool(pool)
    assert tool.command_of({}) == "ls -la ."
    assert tool.command_of({"path": "/tmp/x y"}) == "ls -la '/tmp/x y'"


@pytest.mark.asyncio
async def test_registry_registers_and_unregisters() -> None:
    registry = ToolRegistry()
    tool = SSHExecuteTool(SSHPool(factory=fake_factory()))
    registry.register(tool)
    assert registry.has("ssh_execute")
    assert registry.get("ssh_execute") is tool
    assert len(registry.openai_tools()) == 1
    registry.unregister("ssh_execute")
    assert not registry.has("ssh_execute")


def test_registry_rejects_duplicate(pool: SSHPool) -> None:
    registry = ToolRegistry()
    registry.register(SSHExecuteTool(pool))
    with pytest.raises(ValueError):
        registry.register(SSHExecuteTool(pool))


@pytest.mark.asyncio
async def test_pool_reuses_connection() -> None:
    pool = SSHPool(factory=fake_factory())
    first = await pool.acquire("10.0.0.1")
    second = await pool.acquire("10.0.0.1")
    assert first is second
    assert pool.stats()["connections"] == 1
    await pool.close_all()
    assert pool.cached_hosts() == []


@pytest.mark.asyncio
async def test_pool_gives_up_after_three_attempts() -> None:
    attempts = {"n": 0}

    async def failing_factory(host: str, user: str) -> FakeSSHConnection:
        attempts["n"] += 1
        raise OSError("connection refused")

    pool = SSHPool(factory=failing_factory)
    with pytest.raises(ConnectionError):
        await pool.acquire("10.0.0.9")
    assert attempts["n"] == 3  # 不允许无限重试（AGENTS.md 4.2）


def test_command_result_output_property() -> None:
    result = CommandResult(
        host="h", command="c", stdout="out", stderr="err", exit_code=1, duration_ms=5
    )
    assert not result.ok
    assert "stderr" in result.output
