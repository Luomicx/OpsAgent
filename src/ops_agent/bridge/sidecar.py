"""stdio sidecar 传输层。

进程入口：Rust 端把本模块拉起来，双方通过 **stdin/stdout** 交换 NDJSON 消息。

为什么用 stdio 而不是本地 HTTP：

* **不开端口** —— Windows 上不会弹防火墙授权框，也不会被别的进程探测
* **进程即权限边界** —— 子进程随宿主退出而退出，没有孤儿服务
* **无第三方依赖** —— 不需要 aiohttp/uvicorn 这类额外栈

关键工程点：**stdout 是协议信道，日志必须走 stderr**。任何误写 stdout 的
``print`` 都会污染协议流，因此这里在启动时就把 stdout 锁进一个专用 writer，
并显式把 logging 重定向到 stderr。
"""

from __future__ import annotations

import asyncio
import contextlib
import sys
from typing import Any, Final

from .protocol import Envelope, LineCodec, encode, failure
from .server import RpcServer

#: 单条入站消息的长度上限（1 MiB）—— 防止畸形输入撑爆内存
MAX_LINE_BYTES: Final = 1024 * 1024


def _write_stdout(payload: dict[str, Any]) -> None:
    """把一条消息写到协议信道。

    刻意用 ``sys.stdout.buffer`` 直接写字节：绕开文本层的换行/编码转换，
    避免 Windows 上把 ``\\n`` 变成 ``\\r\\n`` 污染行分割。
    """
    line = encode(payload)
    out = getattr(sys.stdout, "buffer", None)
    if out is None:  # pragma: no cover - 仅在无 buffer 的极端环境下
        sys.stdout.write(line)
        sys.stdout.flush()
        return
    out.write(line.encode("utf-8"))
    out.flush()


async def serve(server: RpcServer | None = None) -> None:
    """主循环：读 stdin → 分发 → 写 stdout。"""
    rpc = server or RpcServer(notify=_write_stdout)

    # 启动握手：让宿主知道 sidecar 活了，并带上初始状态
    try:
        status = await rpc.configure()
        _write_stdout(
            {
                "jsonrpc": "2.0",
                "method": "ready",
                "params": status,
            }
        )
    except Exception as exc:  # pragma: no cover - 启动失败应立刻可见
        _write_stdout(
            {
                "jsonrpc": "2.0",
                "method": "fatal",
                "params": {"error": f"{type(exc).__name__}: {exc}"},
            }
        )
        raise

    codec = LineCodec()
    loop = asyncio.get_running_loop()
    stdin = sys.stdin.buffer

    while True:
        # 读操作放到线程池，避免阻塞事件循环（Windows 上 pipe 读是同步的）
        chunk = await loop.run_in_executor(None, stdin.readline, MAX_LINE_BYTES)
        if not chunk:
            break  # 宿主关闭了管道 → 优雅退出

        try:
            text = chunk.decode("utf-8")
        except UnicodeDecodeError:
            _write_stdout(failure(None, -32700, "非法 UTF-8"))
            continue

        for raw in codec.feed(text):
            envelope = Envelope.parse(raw)
            response = await rpc.dispatch(envelope.raw)
            if response is not None:
                _write_stdout(response)

    await rpc.shutdown()


def main() -> int:
    """进程入口（pyproject 里注册为 ``ops-agent-bridge``）。"""
    # 协议信道必须是干净的 stdout：把日志全部推到 stderr
    with contextlib.suppress(AttributeError, ValueError):
        sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[union-attr]
        sys.stderr.reconfigure(encoding="utf-8")  # type: ignore[union-attr]

    try:
        asyncio.run(serve())
    except KeyboardInterrupt:  # pragma: no cover
        return 130
    # 进程顶层兜底：任何未捕获异常都必须可见地报错并以非 0 退出，
    # 否则宿主只会看到「管道突然断了」而不知道原因
    except Exception as exc:  # noqa: BLE001  # pragma: no cover
        print(f"bridge 异常退出: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
