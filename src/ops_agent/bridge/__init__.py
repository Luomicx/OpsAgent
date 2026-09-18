"""桌面端与 Python 核心之间的 JSON-RPC 桥接层。

分层：

* :mod:`protocol`  —— 纯契约：NDJSON 分帧、消息构造、错误码
* :mod:`pending`   —— 待决请求表与协作式取消
* :mod:`serialize` —— 领域对象 → 前端 JSON（含出站脱敏）
* :mod:`server`    —— RPC 方法实现，驱动 Kernel 与事件泵
* :mod:`sidecar`   —— stdio 传输层与进程入口

本包**只消费** Kernel 的能力，不修改任何既有模块 —— 符合「新增能力 = 新增插件」，
且不触碰内核（AGENTS.md 2.1）。
"""

from __future__ import annotations

from .protocol import (
    EVENT_METHOD,
    JSONRPC_VERSION,
    LineCodec,
    RpcError,
    encode,
    failure,
    notification,
    request,
    success,
)
from .server import RpcServer

__all__ = [
    "EVENT_METHOD",
    "JSONRPC_VERSION",
    "LineCodec",
    "RpcError",
    "RpcServer",
    "encode",
    "failure",
    "notification",
    "request",
    "success",
]
