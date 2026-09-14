"""SSH 引擎：连接、连接池与离线假连接。"""

from .client import CommandResult, SSHConnection, SSHConnectionLike, SSHHostConfig
from .fake import FakeSSHConnection, fake_factory
from .pool import SSH_POOL, PoolConfig, SSHPool, ssh_pool_plugin

__all__ = [
    "SSH_POOL",
    "CommandResult",
    "FakeSSHConnection",
    "PoolConfig",
    "SSHConnection",
    "SSHConnectionLike",
    "SSHHostConfig",
    "SSHPool",
    "fake_factory",
    "ssh_pool_plugin",
]
