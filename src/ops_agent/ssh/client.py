"""SSH 客户端封装（基于 AsyncSSH）。

只暴露运维需要的最小面：跑命令、读文件、列目录。
**这里不做任何权限判断** —— 权限由 ``permission/`` 的分层管线负责。
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any, Protocol

import asyncssh

DEFAULT_USER = "root"
DEFAULT_PORT = 22
DEFAULT_CONNECT_TIMEOUT = 10.0
DEFAULT_COMMAND_TIMEOUT = 15.0


@dataclass(frozen=True)
class CommandResult:
    """一次远程命令执行的完整结果，审计日志的最小单位。"""

    host: str
    command: str
    stdout: str
    stderr: str
    exit_code: int
    duration_ms: int
    user: str = ""

    @property
    def ok(self) -> bool:
        return self.exit_code == 0

    @property
    def output(self) -> str:
        """给 LLM 看的合并输出。"""
        out = self.stdout.strip()
        err = self.stderr.strip()
        if err:
            out = f"{out}\n[stderr]\n{err}" if out else f"[stderr]\n{err}"
        return out or "(无输出)"

    def to_dict(self) -> dict[str, Any]:
        return {
            "host": self.host,
            "user": self.user,
            "command": self.command,
            "exit_code": self.exit_code,
            "duration_ms": self.duration_ms,
            "stdout": self.stdout,
            "stderr": self.stderr,
        }


class SSHConnectionLike(Protocol):
    """连接池只依赖这个协议，测试时可用假实现替换。"""

    async def run(self, command: str, *, timeout: float = DEFAULT_COMMAND_TIMEOUT) -> CommandResult:
        ...

    async def close(self) -> None:
        ...


class SSHConnection:
    """单条 SSH 连接。"""

    def __init__(
        self,
        host: str,
        *,
        user: str = DEFAULT_USER,
        port: int = DEFAULT_PORT,
        connect_timeout: float = DEFAULT_CONNECT_TIMEOUT,
        command_timeout: float = DEFAULT_COMMAND_TIMEOUT,
        password: str | None = None,
        private_key: str | None = None,
        known_hosts: Any = None,
    ) -> None:
        self.host = host
        self.user = user
        self.port = port
        self.connect_timeout = connect_timeout
        self.command_timeout = command_timeout
        self.password = password
        self.private_key = private_key
        self.known_hosts = known_hosts
        self._conn: asyncssh.SSHClientConnection | None = None

    async def connect(self) -> SSHConnection:
        kwargs: dict[str, Any] = {
            "host": self.host,
            "port": self.port,
            "username": self.user,
            "connect_timeout": self.connect_timeout,
            "known_hosts": self.known_hosts,  # None => 不校验 host key
        }
        if self.password:
            kwargs["password"] = self.password
        if self.private_key:
            kwargs["client_keys"] = [self.private_key]
        self._conn = await asyncssh.connect(**kwargs)
        return self

    @property
    def is_connected(self) -> bool:
        return self._conn is not None

    async def run(self, command: str, *, timeout: float | None = None) -> CommandResult:
        if self._conn is None:
            raise RuntimeError(f"SSH 连接未建立: {self.host}")
        started = time.perf_counter()
        result = await self._conn.run(
            command, check=False, timeout=timeout or self.command_timeout
        )
        elapsed = int((time.perf_counter() - started) * 1000)
        return CommandResult(
            host=self.host,
            user=self.user,
            command=command,
            stdout=result.stdout or "",
            stderr=result.stderr or "",
            exit_code=-1 if result.exit_status is None else int(result.exit_status),
            duration_ms=elapsed,
        )

    async def close(self) -> None:
        if self._conn is not None:
            self._conn.close()
            await self._conn.wait_closed()
            self._conn = None


@dataclass
class SSHHostConfig:
    """单台主机的连接参数。"""

    host: str
    user: str = DEFAULT_USER
    port: int = DEFAULT_PORT
    password: str | None = None
    private_key: str | None = None
    connect_timeout: float = DEFAULT_CONNECT_TIMEOUT
    command_timeout: float = DEFAULT_COMMAND_TIMEOUT
    tags: list[str] = field(default_factory=list)
