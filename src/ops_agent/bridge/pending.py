"""待决请求表。

一次 RPC 调用期间，服务端要同时等待**两类**外部信号：

1. 前端发来 ``cancel``（用户点了「停止」）
2. Agent 循环自己跑完

朴素写法是 ``create_task(work)`` + ``wait_for(cancel_event)``，但那样有竞态：
任务抛错时异常会被挂起而无人 await，最终变成 "Task exception was never retrieved"，
而且在 Python 3.12 之前 ``wait_for`` 还可能取消掉**本不该被取消**的任务。

这里换成更结实的做法 —— **合并通知**：把「取消」和「完成」都表达成
:class:`PendingRequest` 上的一个 ``threading.Event``，调用方只等这一个事件，
再根据 ``cancelled`` 标志分辨发生了什么。这样：

* 只有一个等待点，不存在竞态
* 任务自身的异常由调用方 ``await`` 取出，不会被吞
* 取消是**协作式**的 —— 工作协程自己检查 ``cancelled`` 并干净退出，
  不做强制 task.cancel()，避免把 sidecar 留在半初始化状态
"""

from __future__ import annotations

import asyncio
import contextlib
import threading
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any, Final

from .protocol import INTERNAL_ERROR, RpcError

#: 客户端可以取消的方法白名单 —— 长跑方法才允许取消，避免误伤瞬时的查询
CANCELLABLE_METHODS: Final[frozenset[str]] = frozenset({"run"})

#: 单个请求的硬上限，兜底防止工作协程永久挂起
DEFAULT_TIMEOUT: Final = 300.0


@dataclass
class PendingRequest:
    """一个正在处理中的请求。"""

    id: Any
    method: str
    event: threading.Event = field(default_factory=threading.Event)
    cancelled: bool = False
    reason: str = ""

    # -- 两种完成路径 -----------------------------------------------------
    def finish(self) -> None:
        """工作协程正常结束（成功或异常），唤醒等待方。"""
        self.event.set()

    def cancel(self, reason: str = "客户端取消") -> None:
        """客户端请求取消。注意：只置标志，不强制打断协程。"""
        self.cancelled = True
        self.reason = reason
        self.event.set()

    @property
    def should_stop(self) -> bool:
        """协作式取消的检查点 —— 工作协程在循环里轮询这个属性。"""
        return self.cancelled


class PendingTable:
    """按 ``id`` 索引的待决请求表（进程内，通常只有一个活跃请求）。"""

    def __init__(self) -> None:
        self._items: dict[Any, PendingRequest] = {}

    def open(self, msg_id: Any, method: str) -> PendingRequest:
        pending = PendingRequest(id=msg_id, method=method)
        self._items[_key(msg_id)] = pending
        return pending

    def cancel(self, msg_id: Any, reason: str = "客户端取消") -> bool:
        """返回是否命中 —— 没命中说明请求已结束或 id 不对。"""
        pending = self._items.get(_key(msg_id))
        if pending is None:
            return False
        pending.cancel(reason)
        return True

    def cancel_all(self, reason: str = "客户端取消") -> int:
        """取消当前所有在途请求，返回取消的个数。

        GUI 的「停止」按钮走这条路径：它只想停掉正在跑的那次诊断，
        并不关心（也不该知道）请求的 id 是什么。
        """
        for pending in self._items.values():
            pending.cancel(reason)
        return len(self._items)

    def close(self, msg_id: Any) -> None:
        self._items.pop(_key(msg_id), None)

    def __len__(self) -> int:
        return len(self._items)

    @property
    def active(self) -> list[PendingRequest]:
        return list(self._items.values())


def _key(msg_id: Any) -> str:
    """id 可能是 int 也可能是 str，统一成字符串做键，避免 1 与 "1" 各自成项。"""
    return f"{type(msg_id).__name__}:{msg_id}"


def _swallow(task: asyncio.Task[Any]) -> None:
    """取出被取消任务的异常，避免 "Task exception was never retrieved" 噪音。"""
    if task.cancelled():
        return
    with contextlib.suppress(Exception):
        task.exception()


async def run_pending(
    table: PendingTable,
    msg_id: Any,
    method: str,
    work: Callable[[PendingRequest], Awaitable[Any]],
    *,
    timeout: float = DEFAULT_TIMEOUT,
) -> Any:
    """在工作协程里跑 ``work``，同时允许客户端取消。

    调用方 await 本函数直到 --- 工作结束、被取消、或超时，三者之一。

    实现要点：等待点只有**一个**（``pending.event``），它由两条路径置位 ——
    工作协程结束时（``add_done_callback``）或客户端取消时。这样既没有
    「谁先到」的竞态，也不会出现无主协程把异常吞掉。

    :raises RpcError: 取消或超时会被转成结构化错误，统一由外层回给前端。
    """
    pending = table.open(msg_id, method)
    task: asyncio.Task[Any] | None = None
    try:
        task = asyncio.create_task(work(pending))
        # 关键：工作一结束（成功或抛错）就唤醒等待方，否则这里会一直等到超时
        task.add_done_callback(lambda _t: pending.finish())

        await _wait_event(pending.event, timeout=timeout)

        # 取消优先于完成判定 —— 否则「刚取消就恰好跑完」会产生不确定的结果
        if pending.cancelled:
            raise RpcError(INTERNAL_ERROR, f"已取消：{pending.reason}")

        if not task.done():
            raise RpcError(INTERNAL_ERROR, f"请求超时（>{timeout:.0f}s）")

        return task.result()
    finally:
        table.close(msg_id)
        if task is not None and not task.done():
            if pending.cancelled:
                # 协作式取消：让工作协程自己看到 should_stop 后干净收尾，
                # 不强行 task.cancel()，避免把 sidecar 留在半初始化状态
                task.add_done_callback(_swallow)
            else:
                task.cancel()


async def _wait_event(event: threading.Event, *, timeout: float) -> None:
    """把 ``threading.Event`` 桥接成 asyncio 等待 —— 轮询粒度 20ms。

    之所以不用 ``asyncio.Event``：取消可能从**另一个线程**（比如信号处理）
    触发，``threading.Event`` 在那里是安全的。
    """
    deadline = asyncio.get_running_loop().time() + timeout
    while not event.is_set():
        if asyncio.get_running_loop().time() >= deadline:
            return
        await asyncio.sleep(0.02)
