"""桥接层集成测试：真正组装 Kernel，跑通 run / checkCommand / permission。

与 ``test_protocol.py`` 的分工：那边测纯函数与分发骨架（不建 Kernel），
这边测**端到端** —— 真的把插件加载起来，真的跑一次 Agent 循环。

全部离线：适配器用 mock，SSH 走 dry-run 假连接。因此这些用例适合放进 CI。
"""

from __future__ import annotations

import json
from typing import Any

import pytest

from ops_agent.bridge.server import RpcServer


@pytest.fixture()
async def live_server() -> Any:
    """已 configure 好的 server，并把推送的消息收集下来供断言。"""
    pushed: list[dict[str, Any]] = []
    server = RpcServer(notify=pushed.append)
    await server.configure(adapter="mock", session_path="")
    server.pushed = pushed  # type: ignore[attr-defined]
    try:
        yield server
    finally:
        await server.shutdown()


class TestConfigure:
    async def test_status_after_configure(self, live_server: RpcServer) -> None:
        status = live_server.status()
        assert status["ready"] is True
        assert status["adapter"] == "mock"
        # 内核应当装配了这些插件
        assert "agent_loop" in status["plugins"]
        assert "permission_pipeline" in status["plugins"]

    async def test_tools_are_registered(self, live_server: RpcServer) -> None:
        tools = live_server.status()["tools"]
        assert set(tools) == {"ssh_execute", "ssh_read_file", "ssh_list_dir"}

    async def test_unknown_adapter_rejected(self) -> None:
        server = RpcServer(notify=lambda _m: None)
        with pytest.raises(Exception, match="未知适配器"):
            await server.configure(adapter="不存在的适配器")

    async def test_reconfigure_is_idempotent(self, live_server: RpcServer) -> None:
        """重复 configure 必须干净重建，不能报「插件已加载」。"""
        first = await live_server.configure(adapter="mock", session_path="")
        second = await live_server.configure(adapter="mock", session_path="")
        assert first["plugins"] == second["plugins"]

    async def test_api_key_presence_is_boolean_only(self, live_server: RpcServer) -> None:
        """只回报布尔，绝不泄露 Key 本身。"""
        assert isinstance(live_server.status()["apiKeyPresent"], bool)


class TestCheckCommand:
    @pytest.mark.parametrize("command", ["df -h", "free -m", "ps aux"])
    async def test_readonly_commands_allowed(self, live_server: RpcServer, command: str) -> None:
        response = await live_server.dispatch(
            {
                "jsonrpc": "2.0",
                "id": 1,
                "method": "checkCommand",
                "params": {"command": command},
            }
        )
        assert response is not None
        assert response["result"]["decision"]["allowed"] is True
        assert response["result"]["decision"]["layer"] == "ALL"

    async def test_l1_blacklist_blocks_rm_rf(self, live_server: RpcServer) -> None:
        response = await live_server.dispatch(
            {
                "jsonrpc": "2.0",
                "id": 2,
                "method": "checkCommand",
                "params": {"command": "rm -rf /var/log"},
            }
        )
        assert response is not None
        decision = response["result"]["decision"]
        assert decision["allowed"] is False
        assert decision["layer"] == "L1"
        assert decision["rule"]  # 应当回报命中了哪条规则

    async def test_l2_requires_nonblocking_top(self, live_server: RpcServer) -> None:
        """top 不带 -b 会阻塞会话，必须被 L2 拦下。"""
        response = await live_server.dispatch(
            {"jsonrpc": "2.0", "id": 3, "method": "checkCommand", "params": {"command": "top"}}
        )
        assert response is not None
        assert response["result"]["decision"]["allowed"] is False
        assert response["result"]["decision"]["layer"] == "L2"

    async def test_l3_blocks_command_substitution(self, live_server: RpcServer) -> None:
        response = await live_server.dispatch(
            {
                "jsonrpc": "2.0",
                "id": 4,
                "method": "checkCommand",
                "params": {"command": "ls $(whoami)"},
            }
        )
        assert response is not None
        assert response["result"]["decision"]["allowed"] is False

    async def test_empty_command_is_invalid(self, live_server: RpcServer) -> None:
        response = await live_server.dispatch(
            {"jsonrpc": "2.0", "id": 5, "method": "checkCommand", "params": {"command": "   "}}
        )
        assert response is not None
        assert response["error"]["code"] == -32602


class TestPermissionReport:
    async def test_report_has_three_layers(self, live_server: RpcServer) -> None:
        response = await live_server.dispatch(
            {"jsonrpc": "2.0", "id": 1, "method": "permission"}
        )
        assert response is not None
        layers = response["result"]["layers"]
        assert [layer["layer"] for layer in layers] == ["L1", "L2", "L3"]
        assert response["result"]["totalRules"] > 0

    async def test_layer_rules_are_normalized(self, live_server: RpcServer) -> None:
        """规则可能是字符串或正则对象，序列化后必须是统一形状。"""
        response = await live_server.dispatch(
            {"jsonrpc": "2.0", "id": 2, "method": "permission"}
        )
        assert response is not None
        for layer in response["result"]["layers"]:
            assert layer["ruleCount"] == len(layer["rules"])
            for rule in layer["rules"]:
                assert set(rule) == {"pattern", "kind", "description"}


class TestRun:
    async def test_run_produces_result_and_pushes_events(self, live_server: RpcServer) -> None:
        response = await live_server.dispatch(
            {
                "jsonrpc": "2.0",
                "id": 10,
                "method": "run",
                "params": {"prompt": "看看磁盘和内存", "host": "demo-host"},
            }
        )
        assert response is not None, "run 应当返回响应"
        result = response["result"]

        assert result["text"], "应当有最终结论"
        assert result["steps"], "应当有工具调用留痕"
        assert result["status"]["ready"] is True

        # 事件应当被实时推送出来
        pushed: list[dict[str, Any]] = live_server.pushed  # type: ignore[attr-defined]
        event_types = {
            msg["params"]["type"]
            for msg in pushed
            if msg.get("method") == "event"
        }
        assert "agent.input" in event_types
        assert "tool.before" in event_types

    async def test_run_push_never_leaks_api_key(self, live_server: RpcServer) -> None:
        """事件推送到前端前必须脱敏。"""
        await live_server.dispatch(
            {
                "jsonrpc": "2.0",
                "id": 11,
                "method": "run",
                "params": {"prompt": "查磁盘", "host": "demo-host"},
            }
        )
        pushed: list[dict[str, Any]] = live_server.pushed  # type: ignore[attr-defined]
        blob = json.dumps(pushed, ensure_ascii=False)
        assert "sk-" not in blob, "推送内容里不应出现疑似 API Key"

    async def test_run_state_notifications_bracket_the_run(self, live_server: RpcServer) -> None:
        """running / idle 必须成对出现，否则前端会一直转圈。"""
        await live_server.dispatch(
            {
                "jsonrpc": "2.0",
                "id": 12,
                "method": "run",
                "params": {"prompt": "查磁盘", "host": "demo-host"},
            }
        )
        pushed: list[dict[str, Any]] = live_server.pushed  # type: ignore[attr-defined]
        states = [
            msg["params"]["state"]
            for msg in pushed
            if msg.get("method") == "run.state"
        ]
        assert states[0] == "running"
        assert states[-1] == "idle"

    async def test_empty_prompt_rejected(self, live_server: RpcServer) -> None:
        response = await live_server.dispatch(
            {"jsonrpc": "2.0", "id": 13, "method": "run", "params": {"prompt": "  "}}
        )
        assert response is not None
        assert response["error"]["code"] == -32602


class TestReplay:
    async def test_replay_without_path_is_invalid(self, live_server: RpcServer) -> None:
        response = await live_server.dispatch(
            {"jsonrpc": "2.0", "id": 1, "method": "replay", "params": {}}
        )
        assert response is not None
        assert response["error"]["code"] == -32602


class TestLifecycle:
    async def test_shutdown_removes_all_event_subscriptions(self) -> None:
        """可逆副作用：shutdown 后不能留下任何事件订阅。

        通配订阅者有两方 —— session_store（落盘）与 RPC 桥接（推给前端）。
        两者都必须被注销，否则就是句柄泄漏。
        """
        pushed: list[dict[str, Any]] = []
        server = RpcServer(notify=pushed.append)
        await server.configure(adapter="mock", session_path="")

        kernel = server._kernel
        assert kernel is not None
        # 没有精确订阅者，但有 2 个通配订阅者（session_store + RPC 桥接）
        assert kernel.events.listeners("tool.before") == 2

        await server.shutdown()

        assert server._kernel is None
        assert kernel.events.listeners("tool.before") == 0

    async def test_status_without_kernel_raises(self) -> None:
        from ops_agent.bridge.protocol import RpcError

        server = RpcServer(notify=lambda _m: None)
        with pytest.raises(RpcError, match="configure"):
            server.status()
