"""Mock 测试演示脚本。

演示三种用 MockAdapter 自定义测试场景的写法，全部离线、不联网、不连主机。

运行：
    .venv/Scripts/python.exe examples/mock_demo.py
"""

from __future__ import annotations

import asyncio

from ops_agent.adapters import MockAdapter
from ops_agent.adapters.base import Message, Response, ToolCallRequest
from ops_agent.agent import AgentConfig, AgentLoop
from ops_agent.permission import PermissionPipeline
from ops_agent.ssh import SSHPool, fake_factory
from ops_agent.tools import ToolContext
from ops_agent.tools.registry import ToolRegistry
from ops_agent.tools.ssh_execute import SSHExecuteTool
from ops_agent.tools.ssh_list_dir import SSHListDirTool
from ops_agent.tools.ssh_read_file import SSHReadFileTool


def build_loop(
    handler=None, responses: list[Response] | None = None
) -> AgentLoop:
    """组装一个全离线的 AgentLoop：mock 模型 + 假 SSH + 真实权限层。

    ``responses`` 与 ``handler`` 二选一：
    - ``responses``：按固定顺序返回（测试固定流程）
    - ``handler``：根据 messages 动态决定（测试分支逻辑）
    """
    registry = ToolRegistry()
    pool = SSHPool(factory=fake_factory())
    registry.register(SSHExecuteTool(pool))
    registry.register(SSHReadFileTool(pool))
    registry.register(SSHListDirTool(pool))

    return AgentLoop(
        adapter=MockAdapter(responses, handler=handler),
        registry=registry,
        permission=PermissionPipeline.default(),
        tool_ctx=ToolContext(host="demo-host"),
        config=AgentConfig(max_steps=6),
        system_prompt="你是运维助手，只做只读诊断。",
    )


# ---------------------------------------------------------------------------
# 场景 1：预设响应序列（最简单）——按顺序返回，适合测试固定流程
# ---------------------------------------------------------------------------
async def scenario_1_scripted() -> None:
    print("\n" + "=" * 62)
    print("场景 1：预设响应序列 —— 固定两步（调工具 → 总结）")
    print("=" * 62)

    responses = [
        Response(
            Message.assistant(
                "先看磁盘",
                tool_calls=[
                    ToolCallRequest(id="c1", name="ssh_execute", arguments={"command": "df -h"})
                ],
            )
        ),
        Response(Message.assistant("磁盘使用率 63%，正常。")),
    ]

    loop = build_loop(responses=responses)

    result = await loop.run("磁盘够用吗？")
    print(f"  最终回答 : {result.text}")
    print(f"  调用步数 : {len(result.steps)}")
    for step in result.steps:
        flag = "允许" if step.allowed else f"拒绝({step.layer})"
        print(f"    - {step.tool} [{flag}] {step.command}")


# ---------------------------------------------------------------------------
# 场景 2：条件式 handler —— 根据上下文动态决定，最灵活
# ---------------------------------------------------------------------------
async def scenario_2_conditional() -> None:
    print("\n" + "=" * 62)
    print("场景 2：条件式 handler —— 先查日志，再尝试危险操作（应被拦截）")
    print("=" * 62)

    def handler(messages: list[Message]) -> Response:
        tool_results = [m for m in messages if m.role == "tool"]
        if not tool_results:
            return Response(
                Message.assistant(
                    "先看 nginx 错误日志",
                    tool_calls=[
                        ToolCallRequest(
                            id="c1",
                            name="ssh_read_file",
                            arguments={"path": "/var/log/nginx/error.log", "lines": 50},
                        )
                    ],
                )
            )
        if len(tool_results) < 2:
            # 故意发起写操作，验证 L1 拦截
            return Response(
                Message.assistant(
                    "日志有点大，清理一下",
                    tool_calls=[
                        ToolCallRequest(
                            id="c2",
                            name="ssh_execute",
                            arguments={"command": "rm -rf /var/log/nginx/old"},
                        )
                    ],
                )
            )
        return Response(Message.assistant("清理被拒绝，改建议只做日志轮转。"))

    loop = build_loop(handler)
    result = await loop.run("nginx 好像有问题，帮忙看看")
    print(f"  最终回答 : {result.text}")
    for step in result.steps:
        flag = "允许" if step.allowed else f"拒绝({step.layer})"
        print(f"    - {step.tool} [{flag}] {step.command}")
        if step.denied:
            print(f"        原因: {step.reason}")
    print(f"  被拦截次数: {len(result.denied_steps)}")


# ---------------------------------------------------------------------------
# 场景 3：验证工具链路 —— 检查假数据是否真的流回模型
# ---------------------------------------------------------------------------
async def scenario_3_verify_flow() -> None:
    print("\n" + "=" * 62)
    print("场景 3：验证链路 —— 假 SSH 输出是否正确回灌给模型")
    print("=" * 62)

    seen: list[str] = []

    def handler(messages: list[Message]) -> Response:
        for m in messages:
            if m.role == "tool":
                seen.append(m.content[:60].replace("\n", " "))
        tool_results = [m for m in messages if m.role == "tool"]
        if not tool_results:
            return Response(
                Message.assistant(
                    "查目录",
                    tool_calls=[
                        ToolCallRequest(
                            id="c1", name="ssh_list_dir", arguments={"path": "/var/log"}
                        )
                    ],
                )
            )
        return Response(Message.assistant("日志目录内容已确认。"))

    loop = build_loop(handler)
    result = await loop.run("看看 /var/log 有什么")
    print(f"  最终回答 : {result.text}")
    print("  模型实际看到的工具输出：")
    for s in seen:
        print(f"    → {s}")
    assert result.steps[0].allowed, "工具应被放行"
    assert "error.log" in result.steps[0].output, "假数据应包含预置内容"
    print("  ✓ 断言通过：假数据已正确回灌")


async def main() -> None:
    await scenario_1_scripted()
    await scenario_2_conditional()
    await scenario_3_verify_flow()
    print("\n" + "=" * 62)
    print("全部场景运行完毕（离线，未连接任何主机）")
    print("=" * 62)


if __name__ == "__main__":
    asyncio.run(main())
