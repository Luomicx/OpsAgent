"""JSON-RPC 行协议。

前后端之间跑的是**换行分隔的 JSON**（NDJSON）—— 一行一条消息，天然支持流式推送，
不需要长度前缀或分帧解析。这个模块是纯契约层，不含任何业务逻辑。

消息形状（请求/响应遵循 JSON-RPC 2.0 的子集）::

    {"jsonrpc":"2.0","id":1,"method":"run","params":{...}}      # 请求
    {"jsonrpc":"2.0","id":1,"result":{...}}                     # 成功响应
    {"jsonrpc":"2.0","id":1,"error":{"code":-32601,...}}        # 失败响应
    {"jsonrpc":"2.0","method":"event","params":{...}}           # 服务端主动推送（无 id）

设计要点：**id 只会出现在响应上**。前端据此把「问」和「答」配对，
把「推」和「答」分流 —— 这也是后面 :class:`PendingTable` 能用一个类型同时
承载「等待应答」和「等待断开」两种语义的原因。
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass, field
from typing import Any, Final

JSONRPC_VERSION: Final = "2.0"

# --- 标准错误码（JSON-RPC 2.0）-------------------------------------------
PARSE_ERROR: Final = -32700
INVALID_REQUEST: Final = -32600
METHOD_NOT_FOUND: Final = -32601
INVALID_PARAMS: Final = -32602
INTERNAL_ERROR: Final = -32603

# --- 服务端主动推送的方法名 ------------------------------------------------
EVENT_METHOD: Final = "event"


@dataclass(frozen=True)
class RpcError(Exception):
    """业务侧可直接抛出的结构化错误，会被序列化成 error 对象。"""

    code: int
    message: str

    def to_dict(self) -> dict[str, Any]:
        return {"code": self.code, "message": self.message}

    def __str__(self) -> str:  # pragma: no cover - 仅用于日志
        return f"[{self.code}] {self.message}"


class InvalidParams(RpcError):
    """参数不合法：默认错误码 -32602。"""

    def __init__(self, message: str) -> None:
        super().__init__(INVALID_PARAMS, message)


class MethodNotFound(RpcError):
    """方法未注册：默认错误码 -32601。"""

    def __init__(self, message: str) -> None:
        super().__init__(METHOD_NOT_FOUND, message)


@dataclass
class LineCodec:
    """把字节流切成一行行 JSON 对象 —— 流式解析，不假设一次读入的边界。

    ``feed()`` 接受任意长度的字节片段，内部缓冲未闭合的行。
    这是 NDJSON 协议的关键：一次 TCP/pipe 读取可能切在任意位置，
    甚至一条消息中间，必须由 codec 负责拼接。
    """

    _buffer: str = ""

    def feed(self, chunk: str) -> list[dict[str, Any]]:
        """喂入一段文本，返回其中已经完整的所有消息。"""
        self._buffer += chunk
        messages: list[dict[str, Any]] = []
        while "\n" in self._buffer:
            line, self._buffer = self._buffer.split("\n", 1)
            line = line.strip()
            if not line:
                continue
            try:
                parsed = json.loads(line)
            except json.JSONDecodeError:
                # 单行坏了不该拖垮整条链路：丢弃并继续，错误由调用方补一条响应
                messages.append({"__malformed__": line})
                continue
            if isinstance(parsed, dict):
                messages.append(parsed)
            else:
                messages.append({"__malformed__": line})
        return messages

    @property
    def buffered(self) -> str:
        return self._buffer


def encode(message: dict[str, Any]) -> str:
    """序列化成一行（含换行符）。``ensure_ascii=False`` 保证中文可读。"""
    return json.dumps(message, ensure_ascii=False, separators=(",", ":")) + "\n"


# ---------------------------------------------------------------- 构造助手
def request(msg_id: int, method: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
    payload: dict[str, Any] = {"jsonrpc": JSONRPC_VERSION, "id": msg_id, "method": method}
    if params is not None:
        payload["params"] = params
    return payload


def success(msg_id: Any, result: Any) -> dict[str, Any]:
    return {"jsonrpc": JSONRPC_VERSION, "id": msg_id, "result": result}


def failure(msg_id: Any, code: int, message: str) -> dict[str, Any]:
    return {
        "jsonrpc": JSONRPC_VERSION,
        "id": msg_id,
        "error": {"code": code, "message": message},
    }


def notification(method: str, params: dict[str, Any]) -> dict[str, Any]:
    """服务端主动推送：**没有 id**，前端据此与响应区分。"""
    return {"jsonrpc": JSONRPC_VERSION, "method": method, "params": params}


@dataclass(frozen=True)
class Envelope:
    """入站消息的归一化视图，避免各处散落 ``msg.get(...)``。"""

    raw: dict[str, Any]
    id: Any = None
    method: str = ""
    params: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def parse(cls, raw: dict[str, Any]) -> Envelope:
        params = raw.get("params")
        return cls(
            raw=raw,
            id=raw.get("id"),
            method=str(raw.get("method") or ""),
            params=dict(params) if isinstance(params, dict) else {},
        )

    @property
    def malformed(self) -> bool:
        return "__malformed__" in self.raw

    @property
    def is_request(self) -> bool:
        """有 method 才算请求；只有 id 的是响应。"""
        return bool(self.method)


def now() -> float:
    return time.time()
