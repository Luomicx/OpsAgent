"""假 SSH 连接：不联网也能完整跑通「权限校验 → 工具调用 → 结论」链路。

用于离线演示与冒烟测试（``--dry-run``）。
"""

from __future__ import annotations

import re
from typing import Any

from .client import CommandResult

FIXTURES: dict[str, str] = {
    "df": """Filesystem      Size  Used Avail Use% Mounted on
/dev/mapper/rl-root   50G   32G   19G  63% /
/dev/sda1            1.0G  320M  705M  32% /boot
tmpfs                3.9G     0  3.9G   0% /dev/shm""",
    "free": """               total        used        free      shared  buff/cache   available
Mem:            7982        3210        2104         132        2667        4401
Swap:           4095           0        4095""",
    "ps": """USER       PID %CPU %MEM COMMAND
root         1  0.0  0.1 /usr/lib/systemd/systemd
nginx     1204  0.3  1.2 nginx: worker process
root      2311  0.1  0.4 /usr/bin/python3""",
    "ls": """total 28
drwxr-xr-x.  2 root root 4096 Sep 10 09:12 .
drwxr-xr-x. 12 root root 4096 Sep 10 09:10 ..
-rw-r--r--.  1 root root 1204 Sep 10 09:11 error.log
-rw-r--r--.  1 root root 8812 Sep 10 09:12 access.log""",
    "journalctl": """-- Logs begin at Mon 2026-09-07 08:00:01 CST. --
Sep 10 09:12:03 demo-host nginx[1204]: accept4() failed (24: Too many open files)
Sep 10 09:12:04 demo-host systemd[1]: nginx.service: Failed with result 'exit-code'.""",
}

DEFAULT_OUTPUT = "(dry-run) 命令已通过权限校验并被执行（假数据）"


class FakeSSHConnection:
    """按命令首词返回预置输出。"""

    def __init__(self, host: str, user: str = "root") -> None:
        self.host = host
        self.user = user
        self.commands: list[str] = []

    async def run(self, command: str, *, timeout: float = 15.0) -> CommandResult:
        self.commands.append(command)
        key = self._match(command)
        output = FIXTURES.get(key, DEFAULT_OUTPUT)
        return CommandResult(
            host=self.host,
            user=self.user,
            command=command,
            stdout=output,
            stderr="",
            exit_code=0,
            duration_ms=3,
        )

    @staticmethod
    def _match(command: str) -> str:
        match = re.match(r"\s*([a-zA-Z0-9_]+)", command)
        token = match.group(1) if match else ""
        for key in FIXTURES:
            if token.startswith(key):
                return key
        return token

    async def close(self) -> None:
        return None


def fake_factory() -> Any:
    """返回可用于 SSHPool 的工厂函数。"""

    async def _factory(host: str, user: str) -> FakeSSHConnection:
        return FakeSSHConnection(host, user)

    return _factory
