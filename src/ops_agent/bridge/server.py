"""RPC 服务：把 Kernel 的能力暴露成一个 JSON-RPC 端点。

这是 GUI 与 Python 核心之间**唯一**的接触面。它做三件事：

1. 按需组装/拆装 Kernel（``configure``）
2. 把请求分发到具体方法（``dispatch``）
3. 订阅事件总线，把事件**实时**推给前端（``_pump``）

关键设计：**订阅与 Kernel 同生命周期**。事件泵的句柄在 configure 时登记、
在 shutdown 时注销 —— 这正是 AGENTS.md 2.3「可逆副作用」在桥接层的落实。
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
from collections.abc import Awaitable, Callable
from typing import Any, Final

from ..agent.loop import AGENT_LOOP, AgentLoopFactory
from ..config import DEFAULT_CONFIG_PATH, load_config
from ..kernel.container import Kernel
from ..kernel.events import Handle
from ..permission.pipeline import PERMISSION_PIPELINE
from ..runtime import ADAPTER_PLUGINS, build_kernel
from ..session.store import SESSION_STORE, EventStore
from .pending import CANCELLABLE_METHODS, PendingTable, run_pending
from .protocol import (
    INVALID_REQUEST,
    METHOD_NOT_FOUND,
    InvalidParams,
    RpcError,
    failure,
    success,
)
from .serialize import (
    decision_to_dict,
    event_to_dict,
    layer_to_dict,
    result_to_dict,
    session_event_to_dict,
)

logger = logging.getLogger(__name__)

#: 同时只允许一个 ``run`` —— Agent 会话有状态，并发跑会互相污染上下文。
BUSY: Final = "已有正在执行的任务，请先取消或等待其结束"


class RpcServer:
    """无传输依赖的 RPC 实现。

    ``notify`` 由调用方注入（sidecar 传 stdout 写函数，测试传列表收集器），
    因此服务本身既不依赖 stdio 也不依赖任何 IO，可以纯内存测。
    """

    def __init__(self, notify: Callable[[dict[str, Any]], None]) -> None:
        self._notify = notify
        self._pending = PendingTable()
        self._kernel: Kernel | None = None
        self._config_path: str = str(DEFAULT_CONFIG_PATH)
        self._adapter: str = "mock"
        self._session_path: str | None = None
        self._event_handle: Handle | None = None
        self._inflight: asyncio.Task[Any] | None = None

    # ------------------------------------------------------------ 生命周期
    async def configure(
        self,
        *,
        adapter: str | None = None,
        session_path: str | None = None,
        config_path: str | None = None,
    ) -> dict[str, Any]:
        """（重）建 Kernel。重复调用会先干净地拆掉上一个。"""
        await self.shutdown()

        next_adapter = adapter or self._adapter
        if next_adapter not in ADAPTER_PLUGINS:
            raise InvalidParams(f"未知适配器：{next_adapter}")

        next_session = session_path if session_path is not None else self._session_path

        raw = load_config(config_path or self._config_path)
        kernel = await build_kernel(
            raw,
            adapter=next_adapter,
            session_path=next_session,
            dry_run=True,  # 桌面端默认不连真实主机，走假 SSH 跑通链路
        )

        # 订阅事件总线 —— 通配订阅，全部转发给前端
        handle = kernel.events.on("*", self._on_event)

        self._kernel = kernel
        self._adapter = next_adapter
        self._session_path = next_session
        self._config_path = config_path or self._config_path
        self._event_handle = handle

        return self.status()

    async def shutdown(self) -> None:
        """拆掉 Kernel 并**注销事件订阅**（可逆副作用）。"""
        if self._kernel is not None and self._event_handle is not None:
            self._kernel.events.off(self._event_handle)
        self._event_handle = None
        if self._kernel is not None:
            with contextlib.suppress(Exception):
                await self._kernel.shutdown()
            self._kernel = None

    # ------------------------------------------------------------ 状态
    def status(self) -> dict[str, Any]:
        """给前端渲染顶栏用的快照。"""
        kernel = self._require_kernel()
        store = kernel.try_get(SESSION_STORE)
        tools = kernel.try_get("tool_registry")
        return {
            "ready": True,
            "adapter": self._adapter,
            "configPath": self._config_path,
            "sessionPath": str(store.path) if isinstance(store, EventStore) and store.path else "",
            "eventCount": len(store.all()) if isinstance(store, EventStore) else 0,
            "tools": tools.names() if tools is not None else [],
            "plugins": kernel.plugins,
            "capabilities": kernel.capabilities,
            "apiKeyPresent": _api_key_present(),
        }

    # ------------------------------------------------------------ 分发
    async def dispatch(self, message: dict[str, Any]) -> dict[str, Any] | None:
        """处理一条入站消息；返回要回写的响应，或 ``None``（无需响应）。"""
        if "__malformed__" in message:
            return failure(None, -32700, "无法解析的 JSON 行")

        msg_id = message.get("id")
        method = message.get("method")

        # 只有 id 没有 method → 是别的端的响应，桌面端不需要处理
        if not method:
            return None

        params = message.get("params")
        if not isinstance(params, dict):
            params = {}

        # 通知型请求（无 id）—— 目前没有这种用法，忽略即可
        if msg_id is None:
            return None

        if method == "cancel":
            return self._handle_cancel(msg_id, params)

        handler = self._handlers().get(method)
        if handler is None:
            return failure(msg_id, METHOD_NOT_FOUND, f"未注册的方法：{method}")

        # run 可在执行中取消：走 run_pending；其余方法瞬时完成，直接 await
        if method in CANCELLABLE_METHODS:
            try:
                result = await run_pending(
                    self._pending, msg_id, method, lambda _p: handler(params)
                )
            except RpcError as exc:
                return failure(msg_id, exc.code, exc.message)
            except Exception as exc:  # 兜底：任何异常都要变成结构化错误，不能静默
                logger.exception("RPC %s 执行失败", method)
                return failure(msg_id, -32603, f"{type(exc).__name__}: {exc}")
            return success(msg_id, result)

        try:
            return success(msg_id, await handler(params))
        except RpcError as exc:
            return failure(msg_id, exc.code, exc.message)
        except Exception as exc:
            logger.exception("RPC %s 执行失败", method)
            return failure(msg_id, -32603, f"{type(exc).__name__}: {exc}")

    def _handlers(self) -> dict[str, Callable[[dict[str, Any]], Awaitable[Any]]]:
        return {
            "ping": self._r_ping,
            "configure": self._r_configure,
            "status": self._r_status,
            "run": self._r_run,
            "checkCommand": self._r_check_command,
            "permission": self._r_permission,
            "replay": self._r_replay,
        }

    def _handle_cancel(self, msg_id: Any, params: dict[str, Any]) -> dict[str, Any]:
        """取消在途请求。

        * 带 ``targetId`` —— 精确取消某一个
        * 不带 —— 取消当前所有在途请求（GUI 的「停止」按钮用这条）
        """
        reason = str(params.get("reason") or "用户取消")
        target = params.get("targetId")

        if target is None:
            count = self._pending.cancel_all(reason)
            return success(msg_id, {"cancelled": count > 0, "count": count})

        hit = self._pending.cancel(target, reason)
        return success(msg_id, {"cancelled": hit, "count": 1 if hit else 0})

    # ------------------------------------------------------------ 方法实现
    async def _r_ping(self, _params: dict[str, Any]) -> dict[str, Any]:
        return {"pong": True, "adapter": self._adapter, "ready": self._kernel is not None}

    async def _r_configure(self, params: dict[str, Any]) -> dict[str, Any]:
        return await self.configure(
            adapter=params.get("adapter"),
            session_path=params.get("sessionPath"),
            config_path=params.get("configPath"),
        )

    async def _r_status(self, _params: dict[str, Any]) -> dict[str, Any]:
        return self.status()

    async def _r_run(self, params: dict[str, Any]) -> dict[str, Any]:
        """执行一次诊断。"""
        kernel = self._require_kernel()
        prompt = str(params.get("prompt") or "").strip()
        if not prompt:
            raise InvalidParams("prompt 不能为空")

        host = str(params.get("host") or "unknown-host")
        user = params.get("user")
        user = str(user) if user else None

        self._notify({"jsonrpc": "2.0", "method": "run.state", "params": {"state": "running"}})
        try:
            factory: AgentLoopFactory = kernel.get(AGENT_LOOP)
            loop = factory.create(host, user=user)
            result = await loop.run(prompt)
        finally:
            self._notify({"jsonrpc": "2.0", "method": "run.state", "params": {"state": "idle"}})

        payload = result_to_dict(result)
        payload["status"] = self.status()
        return payload

    async def _r_check_command(self, params: dict[str, Any]) -> dict[str, Any]:
        """只做权限校验，不连主机 —— 演示权限引擎用。"""
        kernel = self._require_kernel()
        command = str(params.get("command") or "").strip()
        if not command:
            raise InvalidParams("command 不能为空")
        pipeline = kernel.get(PERMISSION_PIPELINE)
        decision = pipeline.check_command(command, host=str(params.get("host") or ""))
        return {"command": command, "decision": decision_to_dict(decision)}

    async def _r_permission(self, _params: dict[str, Any]) -> dict[str, Any]:
        kernel = self._require_kernel()
        pipeline = kernel.get(PERMISSION_PIPELINE)
        layers = [layer_to_dict(layer) for layer in pipeline.describe()]
        return {
            "layers": layers,
            "totalRules": sum(layer["ruleCount"] for layer in layers),
        }

    async def _r_replay(self, params: dict[str, Any]) -> dict[str, Any]:
        """回放已落盘的事件流。"""
        path = params.get("path") or self._session_path
        if not path:
            raise InvalidParams("没有可用的事件流路径")
        store = EventStore.load(str(path))
        return {
            "path": str(path),
            "events": [session_event_to_dict(e) for e in store.all()],
            "integrity": store.verify_integrity(),
        }

    # ------------------------------------------------------------ 事件泵
    async def _on_event(self, event: Any) -> None:
        """事件总线回调 → 推给前端。

        注意两件事：
        1. 用 ``event.type`` 作为方法名之外，还带 ``params.type``，前端两者都能用
        2. 这里**不 await 任何 IO** —— 通知写函数是同步的，避免拖慢 Agent 主循环
        """
        self._notify(
            {
                "jsonrpc": "2.0",
                "method": "event",
                "params": event_to_dict(event),
            }
        )

    # ------------------------------------------------------------ 工具
    def _require_kernel(self) -> Kernel:
        if self._kernel is None:
            raise RpcError(INVALID_REQUEST, "Kernel 尚未初始化，请先调用 configure")
        return self._kernel


def _api_key_present() -> bool:
    """只回报「有没有」Key，绝不回报 Key 本身。"""
    import os

    return bool(os.environ.get("DEEPSEEK_API_KEY"))


__all__ = ["BUSY", "RpcServer"]
