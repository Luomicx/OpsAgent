"""SSH 连接池。

以 ``(host, user)`` 为键复用连接，避免每敲一条命令就握手一次。
连接失败**最多重试 3 次**（AGENTS.md 4.2），避免暴力尝试。
"""

from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any, Final

from ..kernel.capability import capability
from ..kernel.container import Plugin, plugin
from ..kernel.context import PluginContext
from .client import (
    DEFAULT_COMMAND_TIMEOUT,
    DEFAULT_CONNECT_TIMEOUT,
    DEFAULT_PORT,
    DEFAULT_USER,
    CommandResult,
    SSHConnection,
    SSHConnectionLike,
)
from .fake import fake_factory

logger = logging.getLogger(__name__)

SSH_POOL: Final = capability("ssh_pool", "SSH 连接池")

MAX_CONNECT_ATTEMPTS = 3
ConnectionFactory = Callable[[str, str], Awaitable[SSHConnectionLike]]


@dataclass
class PoolConfig:
    default_user: str = DEFAULT_USER
    port: int = DEFAULT_PORT
    connect_timeout: float = DEFAULT_CONNECT_TIMEOUT
    command_timeout: float = DEFAULT_COMMAND_TIMEOUT
    pool_size: int = 5
    password: str | None = None
    private_key: str | None = None
    hosts: dict[str, dict[str, Any]] = field(default_factory=dict)
    dry_run: bool = False

    @classmethod
    def from_dict(cls, raw: dict[str, Any] | None) -> PoolConfig:
        raw = raw or {}
        return cls(
            default_user=str(raw.get("default_user", DEFAULT_USER)),
            port=int(raw.get("port", DEFAULT_PORT)),
            connect_timeout=float(raw.get("connect_timeout", DEFAULT_CONNECT_TIMEOUT)),
            command_timeout=float(raw.get("command_timeout", DEFAULT_COMMAND_TIMEOUT)),
            pool_size=int(raw.get("pool_size", 5)),
            password=raw.get("password"),
            private_key=raw.get("private_key"),
            hosts=dict(raw.get("hosts") or {}),
            dry_run=bool(raw.get("dry_run", False)),
        )


class SSHPool:
    """按主机缓存连接；并发上限由 ``pool_size`` 控制。"""

    def __init__(
        self,
        config: PoolConfig | None = None,
        *,
        factory: ConnectionFactory | None = None,
        emit: Callable[[str, Any], Awaitable[Any]] | None = None,
    ) -> None:
        self._config = config or PoolConfig()
        self._factory = factory or self._default_factory
        self._emit = emit
        self._conns: dict[tuple[str, str], SSHConnectionLike] = {}
        self._stats = {"commands": 0, "connections": 0, "failures": 0}

    # -- 连接管理 ---------------------------------------------------------
    def _host_cfg(self, host: str) -> dict[str, Any]:
        return self._config.hosts.get(host, {})

    def _user_for(self, host: str, user: str | None) -> str:
        return user or self._host_cfg(host).get("user") or self._config.default_user

    async def _default_factory(self, host: str, user: str) -> SSHConnectionLike:
        cfg = self._host_cfg(host)
        conn = SSHConnection(
            host,
            user=user,
            port=int(cfg.get("port", self._config.port)),
            connect_timeout=self._config.connect_timeout,
            command_timeout=self._config.command_timeout,
            password=cfg.get("password", self._config.password),
            private_key=cfg.get("private_key", self._config.private_key),
        )
        return await conn.connect()

    async def acquire(self, host: str, user: str | None = None) -> SSHConnectionLike:
        key = (host, self._user_for(host, user))
        if key in self._conns:
            return self._conns[key]

        last_error: Exception | None = None
        for attempt in range(1, MAX_CONNECT_ATTEMPTS + 1):
            try:
                conn = await self._factory(key[0], key[1])
                self._conns[key] = conn
                self._stats["connections"] += 1
                if self._emit:
                    await self._emit(
                        "ssh.connect", host=key[0], user=key[1], attempt=attempt, ok=True
                    )
                return conn
            except Exception as exc:  # noqa: BLE001 - 统一收敛为连接失败
                last_error = exc
                self._stats["failures"] += 1
                logger.warning("SSH 连接失败 %s (第 %d 次): %s", key[0], attempt, exc)
                if self._emit:
                    await self._emit(
                        "ssh.connect",
                        host=key[0],
                        user=key[1],
                        attempt=attempt,
                        ok=False,
                        error=str(exc),
                    )
        raise ConnectionError(
            f"SSH 连接失败（已重试 {MAX_CONNECT_ATTEMPTS} 次）: {key[0]}"
        ) from last_error

    # -- 执行 -------------------------------------------------------------
    async def run(
        self,
        host: str,
        command: str,
        *,
        user: str | None = None,
        timeout: float | None = None,
    ) -> CommandResult:
        conn = await self.acquire(host, user)
        self._stats["commands"] += 1
        result = await conn.run(command, timeout=timeout or self._config.command_timeout)
        if self._emit:
            await self._emit("ssh.command", **result.to_dict())
        return result

    # -- 运维 -------------------------------------------------------------
    def stats(self) -> dict[str, int]:
        return dict(self._stats)

    def cached_hosts(self) -> list[str]:
        return [host for host, _ in self._conns]

    async def close_all(self) -> None:
        for conn in list(self._conns.values()):
            try:
                await conn.close()
            except Exception:
                logger.debug("关闭 SSH 连接失败", exc_info=True)
        self._conns.clear()


def _setup(ctx: PluginContext) -> None:
    cfg = PoolConfig.from_dict(dict(ctx.config))
    factory = fake_factory() if cfg.dry_run else None
    pool = SSHPool(cfg, factory=factory, emit=lambda t, **kw: ctx.emit(t, **kw))

    # 可逆副作用：Kernel 卸载插件时自动关闭所有连接
    ctx.on_unload(lambda: _close_sync(pool))
    ctx.provide(SSH_POOL, pool)


_BACKGROUND_TASKS: set[Any] = set()


def _close_sync(pool: SSHPool) -> None:
    """卸载时关闭全部连接；没有运行中的事件循环就退化为 asyncio.run。"""
    import asyncio

    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        asyncio.run(pool.close_all())
    else:
        task = loop.create_task(pool.close_all())
        _BACKGROUND_TASKS.add(task)
        task.add_done_callback(_BACKGROUND_TASKS.discard)


ssh_pool_plugin: Plugin = plugin(
    name="ssh_pool",
    setup=_setup,
    provides=(SSH_POOL,),
)
