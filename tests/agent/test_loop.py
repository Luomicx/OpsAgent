"""Agent 主循环测试：全部使用 mock LLM，不依赖真实 API。"""

import pytest

from ops_agent.adapters import MockAdapter
from ops_agent.adapters.base import Message, Response, ToolCallRequest
from ops_agent.agent import AgentConfig, AgentLoop
from ops_agent.context import ContextManager
from ops_agent.permission import PermissionPipeline
from ops_agent.ssh import SSHPool, fake_factory
from ops_agent.tools import ToolContext
from ops_agent.tools.registry import ToolRegistry
from ops_agent.tools.ssh_execute import SSHExecuteTool


def _build(responses: list[Response] | None = None, handler=None) -> AgentLoop:
    registry = ToolRegistry()
    registry.register(SSHExecuteTool(SSHPool(factory=fake_factory())))
    return AgentLoop(
        adapter=MockAdapter(responses, handler=handler),
        registry=registry,
        permission=PermissionPipeline.default(),
        tool_ctx=ToolContext(host="10.0.0.1"),
        config=AgentConfig(max_steps=4),
        system_prompt="test",
    )


@pytest.mark.asyncio
async def test_loop_runs_tool_and_returns_final_answer() -> None:
    calls: list[list[Message]] = []

    def handler(messages: list[Message]) -> Response:
        calls.append(list(messages))
        tool_results = [m for m in messages if m.role == "tool"]
        if not tool_results:
            return Response(
                Message.assistant(
                    "查一下磁盘",
                    tool_calls=[
                        ToolCallRequest(
                            id="c1", name="ssh_execute", arguments={"command": "df -h"}
                        )
                    ],
                )
            )
        return Response(Message.assistant("磁盘剩余 19G，正常。"))

    loop = _build(handler=handler)
    result = await loop.run("磁盘够用吗？")

    assert result.text == "磁盘剩余 19G，正常。"
    assert len(result.steps) == 1
    assert result.steps[0].allowed
    assert "19G" in result.steps[0].output
    assert len(calls) == 2  # 一轮工具调用 + 一轮总结


@pytest.mark.asyncio
async def test_loop_reports_permission_denial_to_llm() -> None:
    def handler(messages: list[Message]) -> Response:
        tool_results = [m for m in messages if m.role == "tool"]
        if not tool_results:
            return Response(
                Message.assistant(
                    "清理日志",
                    tool_calls=[
                        ToolCallRequest(
                            id="c1",
                            name="ssh_execute",
                            arguments={"command": "rm -rf /var/log/old"},
                        )
                    ],
                )
            )
        return Response(Message.assistant("被安全策略拦下了。"))

    loop = _build(handler=handler)
    result = await loop.run("帮我把日志清一下")

    step = result.steps[0]
    assert step.denied
    assert step.layer == "L1"
    assert result.denied_steps
    assert result.text == "被安全策略拦下了。"
    # 被拒绝的调用不能真的执行
    assert step.output == ""


@pytest.mark.asyncio
async def test_unknown_tool_is_reported_not_crashing() -> None:
    def handler(messages: list[Message]) -> Response:
        tool_results = [m for m in messages if m.role == "tool"]
        if not tool_results:
            return Response(
                Message.assistant(
                    "",
                    tool_calls=[ToolCallRequest(id="c1", name="not_exist", arguments={})],
                )
            )
        return Response(Message.assistant("工具不存在，已停止。"))

    loop = _build(handler=handler)
    result = await loop.run("随便试试")
    assert result.steps[0].denied
    assert "未注册的工具" in result.steps[0].reason


@pytest.mark.asyncio
async def test_max_steps_protection() -> None:
    def handler(messages: list[Message]) -> Response:
        return Response(
            Message.assistant(
                "继续查",
                tool_calls=[
                    ToolCallRequest(
                        id=f"c{len(messages)}",
                        name="ssh_execute",
                        arguments={"command": "df -h"},
                    )
                ],
            )
        )

    loop = _build(handler=handler)
    result = await loop.run("无限循环")
    assert not result.finished
    assert len(result.steps) == 4
    assert "最大步数" in result.text


@pytest.mark.asyncio
async def test_direct_final_answer_without_tools() -> None:
    loop = _build([Response(Message.assistant("这个问题不用查主机：重启试试。"))])
    result = await loop.run("怎么重启？")
    assert result.steps == []
    assert "重启" in result.text


@pytest.mark.asyncio
async def test_context_grows_with_observations() -> None:
    loop = _build(handler=lambda messages: Response(Message.assistant("done")))
    assert isinstance(loop.context, ContextManager)
    await loop.run("hi")
    assert any(m.role == "user" for m in loop.context.snapshot())
