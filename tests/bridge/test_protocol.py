"""桥接层测试：协议分帧、待决取消、序列化脱敏、RPC 分发。

这些测试**完全离线**：不 spawn 进程、不起端口，直接把 ``RpcServer`` 拿过来
喂字典消息 —— 因为服务本身的传输是注入的（见 ``RpcServer.__init__``）。
"""

from __future__ import annotations

import asyncio
import json
from typing import Any

import pytest

from ops_agent.bridge.pending import PendingTable, run_pending
from ops_agent.bridge.protocol import (
    INVALID_PARAMS,
    METHOD_NOT_FOUND,
    LineCodec,
    RpcError,
    encode,
    failure,
    notification,
    success,
)
from ops_agent.bridge.serialize import _redact, step_to_dict
from ops_agent.bridge.server import RpcServer


# ---------------------------------------------------------------- 分帧
class TestLineCodec:
    def test_single_complete_line(self) -> None:
        codec = LineCodec()
        messages = codec.feed('{"a":1}\n')
        assert messages == [{"a": 1}]

    def test_partial_line_is_buffered(self) -> None:
        """一次读取可能切在消息中间 —— 这是 NDJSON 必须处理的场景。"""
        codec = LineCodec()
        assert codec.feed('{"a":') == []
        assert codec.feed("1}") == []
        assert codec.feed("\n") == [{"a": 1}]

    def test_multiple_lines_in_one_chunk(self) -> None:
        codec = LineCodec()
        messages = codec.feed('{"a":1}\n{"b":2}\n{"c":3}\n')
        assert messages == [{"a": 1}, {"b": 2}, {"c": 3}]

    def test_split_across_chunks_mid_message(self) -> None:
        """最刁钻的情况：切点在第二行的 JSON 中间。"""
        codec = LineCodec()
        assert codec.feed('{"a":1}\n{"b"') == [{"a": 1}]
        assert codec.feed(':2}\n') == [{"b": 2}]

    def test_blank_lines_ignored(self) -> None:
        codec = LineCodec()
        assert codec.feed("\n\n\n") == []

    def test_malformed_line_is_marked_not_raised(self) -> None:
        """坏行不能让整条链路崩掉。"""
        codec = LineCodec()
        messages = codec.feed("这不是 JSON\n")
        assert len(messages) == 1
        assert "__malformed__" in messages[0]

    def test_non_object_json_is_malformed(self) -> None:
        codec = LineCodec()
        messages = codec.feed("[1,2,3]\n")
        assert "__malformed__" in messages[0]

    def test_buffered_exposes_remainder(self) -> None:
        codec = LineCodec()
        codec.feed('{"partial"')
        assert codec.buffered == '{"partial"'


class TestEncoding:
    def test_encode_is_single_line_with_newline(self) -> None:
        line = encode({"a": 1})
        assert line.endswith("\n")
        assert line.count("\n") == 1

    def test_encode_keeps_chinese_readable(self) -> None:
        """ensure_ascii=False —— 中文日志可读，且体积更小。"""
        line = encode({"msg": "磁盘不足"})
        assert "磁盘不足" in line

    def test_encode_roundtrip_with_newline_in_value(self) -> None:
        """值里含换行必须被转义，否则会破坏行分帧。"""
        line = encode({"output": "line1\nline2"})
        assert line.count("\n") == 1  # 只有结尾那个
        assert json.loads(line)["output"] == "line1\nline2"

    def test_notification_has_no_id(self) -> None:
        msg = notification("event", {"type": "x"})
        assert "id" not in msg

    def test_success_and_failure_shapes(self) -> None:
        assert success(1, {"ok": True})["result"] == {"ok": True}
        err = failure(2, -32601, "nope")
        assert err["error"]["code"] == -32601
        assert "result" not in err


# ---------------------------------------------------------------- 待决取消
class TestPendingTable:
    def test_open_and_close(self) -> None:
        table = PendingTable()
        table.open(1, "run")
        assert len(table) == 1
        table.close(1)
        assert len(table) == 0

    def test_cancel_hits_open_request(self) -> None:
        table = PendingTable()
        pending = table.open("42", "run")
        assert table.cancel("42") is True
        assert pending.cancelled is True

    def test_cancel_misses_unknown_id(self) -> None:
        assert PendingTable().cancel(999) is False

    def test_int_and_str_ids_do_not_collide(self) -> None:
        """1 与 "1" 必须各自成项，否则会互相取消。"""
        table = PendingTable()
        table.open(1, "run")
        table.open("1", "run")
        assert len(table) == 2
        table.cancel(1)
        assert table.active[0].cancelled != table.active[1].cancelled


class TestRunPending:
    async def test_normal_completion_returns_value(self) -> None:
        table = PendingTable()

        async def work(_p: Any) -> str:
            return "done"

        assert await run_pending(table, 1, "run", work) == "done"
        assert len(table) == 0  # 结束后自动清理

    async def test_client_cancel_raises_rpcerror(self) -> None:
        table = PendingTable()
        started = asyncio.Event()

        async def work(pending: Any) -> str:
            started.set()
            while not pending.should_stop:
                await asyncio.sleep(0.01)
            return "干净退出"

        async def cancel_soon() -> None:
            await started.wait()
            await asyncio.sleep(0.05)
            table.cancel(1, "用户点了停止")

        canceller = asyncio.create_task(cancel_soon())
        with pytest.raises(RpcError) as exc:
            await run_pending(table, 1, "run", work, timeout=5)
        await canceller

        assert "用户点了停止" in exc.value.message

    async def test_work_exception_propagates(self) -> None:
        """工作协程的异常必须能被调用方看见，不能被吞成「已完成」。"""
        table = PendingTable()

        async def work(_p: Any) -> str:
            raise ValueError("炸了")

        with pytest.raises(ValueError, match="炸了"):
            await run_pending(table, 1, "run", work)


# ---------------------------------------------------------------- 脱敏
class TestRedaction:
    @pytest.mark.parametrize(
        "key", ["api_key", "API_KEY", "password", "token", "private_key", "secret"]
    )
    def test_sensitive_keys_are_masked(self, key: str) -> None:
        assert _redact({key: "sk-super-secret"})[key] == "***"

    def test_nested_dict_is_redacted(self) -> None:
        payload = {"model": {"api_key": "sk-xxx", "name": "deepseek"}}
        cleaned = _redact(payload)
        assert cleaned["model"]["api_key"] == "***"
        assert cleaned["model"]["name"] == "deepseek"

    def test_benign_keys_untouched(self) -> None:
        cleaned = _redact({"command": "df -h", "host": "10.0.0.1"})
        assert cleaned == {"command": "df -h", "host": "10.0.0.1"}


class TestSerialize:
    def test_step_is_flat_and_camelcase(self) -> None:
        from ops_agent.agent.loop import StepRecord

        record = StepRecord(
            tool="ssh_execute",
            command="df -h",
            args={"command": "df -h"},
            allowed=False,
            layer="L1",
            reason="命中黑名单",
            output="",
        )
        payload = step_to_dict(record)
        assert payload["tool"] == "ssh_execute"
        assert payload["denied"] is True
        assert payload["outputLength"] == 0
        assert payload["layer"] == "L1"
        # 前端直接消费，不能出现 snake_case 键
        assert "output_length" not in payload


# ---------------------------------------------------------------- RPC 分发
@pytest.fixture()
def server() -> RpcServer:
    return RpcServer(notify=lambda _msg: None)


class TestDispatch:
    async def test_unknown_method_returns_method_not_found(self, server: RpcServer) -> None:
        response = await server.dispatch({"jsonrpc": "2.0", "id": 1, "method": "不存在"})
        assert response is not None
        assert response["error"]["code"] == METHOD_NOT_FOUND

    async def test_malformed_line_returns_parse_error(self, server: RpcServer) -> None:
        response = await server.dispatch({"__malformed__": "坏行"})
        assert response is not None
        assert response["error"]["code"] == -32700

    async def test_response_without_method_is_ignored(self, server: RpcServer) -> None:
        """只有 id 没有 method 的是响应，不该被当成请求处理。"""
        assert await server.dispatch({"jsonrpc": "2.0", "id": 1, "result": {}}) is None

    async def test_ping_works_before_configure(self, server: RpcServer) -> None:
        response = await server.dispatch({"jsonrpc": "2.0", "id": 1, "method": "ping"})
        assert response is not None
        assert response["result"]["pong"] is True
        assert response["result"]["ready"] is False

    async def test_run_without_configure_is_structured_error(self, server: RpcServer) -> None:
        response = await server.dispatch(
            {"jsonrpc": "2.0", "id": 1, "method": "run", "params": {"prompt": "hi"}}
        )
        assert response is not None
        assert "error" in response
        assert "configure" in response["error"]["message"]

    async def test_cancel_unknown_target_reports_false(self, server: RpcServer) -> None:
        response = await server.dispatch(
            {
                "jsonrpc": "2.0",
                "id": 1,
                "method": "cancel",
                "params": {"targetId": 77},
            }
        )
        assert response is not None
        assert response["result"]["cancelled"] is False

    async def test_bad_params_are_structured(self, server: RpcServer) -> None:
        """缺少必填参数 → INVALID_PARAMS（-32602），而不是笼统的内部错误。"""
        await server.configure(adapter="mock")
        try:
            response = await server.dispatch(
                {"jsonrpc": "2.0", "id": 1, "method": "checkCommand", "params": {}}
            )
        finally:
            await server.shutdown()
        assert response is not None
        assert response["error"]["code"] == INVALID_PARAMS
