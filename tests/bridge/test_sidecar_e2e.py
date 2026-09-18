"""sidecar 端到端测试：真的把进程拉起来，用 NDJSON 跟它对话。

这是最接近真实运行形态的一层 —— Tauri 端做的正是「spawn 子进程 + 收发行」，
所以这里必须真起进程，而不是 mock 掉 IO。

验证四件事：

1. 握手：进程起来后会主动推一条 ``ready``（带初始状态）
2. 请求/响应：``ping`` / ``checkCommand`` / ``run`` 都能往返
3. 事件推送：``run`` 期间事件**没有 id**，与响应可区分
4. 协议信道干净：stdout 只有 JSON 行，没有被 print 污染
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path
from typing import Any

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]

#: 单条消息的等待上限 —— 起进程 + 加载插件需要一点时间，给宽裕些
READ_TIMEOUT = 60.0


class SidecarProcess:
    """把子进程包成「一问一答」的同步客户端。"""

    def __init__(self) -> None:
        self.proc = subprocess.Popen(
            [sys.executable, "-u", "-m", "ops_agent.bridge.sidecar"],
            cwd=str(REPO_ROOT),
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            bufsize=1,  # 行缓冲：保证每条消息立刻可读
        )
        self._next_id = 1
        self.pushed: list[dict[str, Any]] = []

    # -- 生命周期 ---------------------------------------------------------
    def close(self) -> None:
        if self.proc.poll() is None:
            self.proc.stdin and self.proc.stdin.close()
            try:
                self.proc.wait(timeout=10)
            except subprocess.TimeoutExpired:  # pragma: no cover
                self.proc.kill()
                self.proc.wait(timeout=5)

    # -- 收发 -------------------------------------------------------------
    def send(self, method: str, params: dict[str, Any] | None = None) -> int:
        msg_id = self._next_id
        self._next_id += 1
        payload: dict[str, Any] = {"jsonrpc": "2.0", "id": msg_id, "method": method}
        if params is not None:
            payload["params"] = params
        assert self.proc.stdin is not None
        self.proc.stdin.write(json.dumps(payload, ensure_ascii=False) + "\n")
        self.proc.stdin.flush()
        return msg_id

    def read_message(self) -> dict[str, Any]:
        """读一行并解析；顺带断言 stdout 是纯 JSON（协议信道未被污染）。"""
        assert self.proc.stdout is not None
        line = self.proc.stdout.readline()
        if not line:
            stderr = self.proc.stderr.read() if self.proc.stderr else ""
            raise AssertionError(f"sidecar 提前退出。stderr:\n{stderr}")
        try:
            return json.loads(line)
        except json.JSONDecodeError as exc:  # pragma: no cover
            raise AssertionError(f"stdout 出现非 JSON 内容：{line!r}") from exc

    def call(self, method: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
        """发请求并一直读到对应 id 的响应；途中收到的推送收进 ``pushed``。"""
        target = self.send(method, params)
        while True:
            message = self.read_message()
            if message.get("id") == target and "method" not in message:
                return message
            self.pushed.append(message)

    def wait_for(self, method: str, *, limit: int = 400) -> dict[str, Any]:
        """等待某条推送到达（如 ready）。"""
        for _ in range(limit):
            message = self.read_message()
            if message.get("method") == method:
                return message
            self.pushed.append(message)
        raise AssertionError(f"等不到推送：{method}")  # pragma: no cover


@pytest.fixture()
def sidecar() -> Any:
    proc = SidecarProcess()
    try:
        yield proc
    finally:
        proc.close()


class TestHandshake:
    def test_pushes_ready_on_startup(self, sidecar: SidecarProcess) -> None:
        """启动握手：前端据此知道后端活了，并拿到初始状态。"""
        ready = sidecar.wait_for("ready")
        assert "id" not in ready, "推送不能带 id，否则会跟响应混淆"
        assert ready["params"]["ready"] is True
        assert ready["params"]["adapter"] == "mock"

    def test_ready_payload_has_no_credentials(self, sidecar: SidecarProcess) -> None:
        """握手信息里只能有「有没有 Key」，不能有 Key。"""
        ready = sidecar.wait_for("ready")
        params = ready["params"]
        assert isinstance(params["apiKeyPresent"], bool)
        assert "apiKey" not in params
        assert "sk-" not in json.dumps(params)


class TestRequestResponse:
    def test_ping_roundtrip(self, sidecar: SidecarProcess) -> None:
        sidecar.wait_for("ready")
        response = sidecar.call("ping")
        assert "error" not in response
        assert response["result"]["pong"] is True
        assert response["result"]["ready"] is True

    def test_unknown_method_is_structured_error(self, sidecar: SidecarProcess) -> None:
        sidecar.wait_for("ready")
        response = sidecar.call("没有这个方法")
        assert response["error"]["code"] == -32601

    def test_check_command_blocks_rm_rf(self, sidecar: SidecarProcess) -> None:
        sidecar.wait_for("ready")
        response = sidecar.call("checkCommand", {"command": "rm -rf /"})
        decision = response["result"]["decision"]
        assert decision["allowed"] is False
        assert decision["layer"] == "L1"

    def test_permission_report_roundtrip(self, sidecar: SidecarProcess) -> None:
        sidecar.wait_for("ready")
        response = sidecar.call("permission")
        layers = response["result"]["layers"]
        assert [layer["layer"] for layer in layers] == ["L1", "L2", "L3"]

    def test_malformed_line_does_not_kill_process(self, sidecar: SidecarProcess) -> None:
        """喂一行坏 JSON，进程要回错误并继续服务 —— 不能崩。"""
        sidecar.wait_for("ready")
        assert sidecar.proc.stdin is not None
        sidecar.proc.stdin.write("这不是 JSON\n")
        sidecar.proc.stdin.flush()

        error = sidecar.read_message()
        assert error["error"]["code"] == -32700

        # 仍然可用
        assert sidecar.call("ping")["result"]["pong"] is True

    def test_blank_lines_are_ignored(self, sidecar: SidecarProcess) -> None:
        sidecar.wait_for("ready")
        assert sidecar.proc.stdin is not None
        sidecar.proc.stdin.write("\n\n\n")
        sidecar.proc.stdin.flush()
        # 空行不产生任何消息，下一条请求仍能正常配对
        assert sidecar.call("ping")["result"]["pong"] is True


class TestStreaming:
    def test_run_streams_events_then_returns_result(self, sidecar: SidecarProcess) -> None:
        """run 期间事件边跑边推，最后才回响应 —— 这是 GUI 实时性的来源。"""
        sidecar.wait_for("ready")
        response = sidecar.call("run", {"prompt": "看看磁盘和内存", "host": "demo-host"})

        assert "error" not in response, response
        result = response["result"]
        assert result["text"]
        assert result["steps"]

        # 途中应当收到过事件推送
        events = [m for m in sidecar.pushed if m.get("method") == "event"]
        assert events, "应当有事件被推送出来"
        assert all("id" not in e for e in events), "推送必须无 id"

        types = {e["params"]["type"] for e in events}
        assert "agent.input" in types
        assert "tool.before" in types

    def test_run_state_is_bracketed(self, sidecar: SidecarProcess) -> None:
        """running 与 idle 必须成对，否则前端会一直转圈。"""
        sidecar.wait_for("ready")
        sidecar.call("run", {"prompt": "查磁盘", "host": "demo-host"})
        states = [
            m["params"]["state"]
            for m in sidecar.pushed
            if m.get("method") == "run.state"
        ]
        assert states[0] == "running"
        assert states[-1] == "idle"

    def test_stdout_stays_clean_json(self, sidecar: SidecarProcess) -> None:
        """协议信道的核心约束：stdout 只有 JSON 行。

        任何调试用的 print 都会污染这里 —— 所以本测试断言每一行都可解析。
        """
        sidecar.wait_for("ready")
        response = sidecar.call("run", {"prompt": "查磁盘", "host": "demo-host"})
        assert "result" in response

        for message in sidecar.pushed:
            assert isinstance(message, dict)
            assert "jsonrpc" in message


class TestShutdown:
    def test_closing_stdin_exits_cleanly(self) -> None:
        """宿主关闭管道 → sidecar 必须自行退出，不能变成孤儿进程。"""
        proc = SidecarProcess()
        proc.wait_for("ready")
        assert proc.proc.stdin is not None
        proc.proc.stdin.close()
        try:
            code = proc.proc.wait(timeout=15)
            assert code == 0
        finally:
            proc.close()
