"""L2 命令白名单。

默认策略是 **whitelist_only**：只有明确列出的只读诊断命令才能过。
命令串会先按 ``;`` ``&&`` ``||`` ``|`` 拆成多条子命令，**每一条**都必须过关。
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass, field
from typing import Any

from .base import Decision, PermissionLayer, ToolCall
from .shell import first_token, parse_safely, split_segments

DEFAULT_READONLY_COMMANDS: frozenset[str] = frozenset(
    {
        # 资源与负载
        "df", "du", "free", "ps", "pgrep", "pstree", "top", "htop", "uptime",
        "vmstat", "iostat", "mpstat", "sar", "nproc", "lscpu", "numactl",
        # 系统信息
        "uname", "hostname", "hostnamectl", "whoami", "id", "date", "lsb_release",
        "printenv", "env", "which", "getconf", "ulimit", "timedatectl",
        # 文件与日志
        "ls", "cat", "head", "tail", "grep", "egrep", "fgrep", "zgrep", "zcat",
        "awk", "sed", "wc", "sort", "uniq", "cut", "tr", "stat", "file", "find",
        "journalctl", "less", "more", "tailf", "realpath", "readlink",
        # 网络
        "ss", "netstat", "ip", "ifconfig", "ping", "traceroute", "dig", "nslookup",
        "curl", "wget", "nc", "ethtool", "route", "arp",
        # 存储与内核
        "lsblk", "blkid", "mount", "dmesg", "lsof", "sysctl", "swapon",
        # 服务与容器（只读子命令）
        "systemctl", "service", "docker", "kubectl", "crictl",
    }
)

# 特定命令被禁止使用的参数（多半是会阻塞会话或产生副作用）
FORBIDDEN_ARGS: dict[str, tuple[str, ...]] = {
    "sed": ("-i", "--in-place"),
    "find": ("-delete", "-exec", "-execdir", "-ok"),
    "tail": ("-f", "--follow", "-f1"),
    "journalctl": ("-f", "--follow", "--rotate", "--vacuum-size", "--vacuum-time", "--header"),
    "docker": ("exec", "run", "rm", "rmi", "kill", "stop", "cp", "commit"),
    "kubectl": ("exec", "delete", "apply", "edit", "scale", "drain", "cordon"),
    "less": (),
    "more": (),
}

# 必须携带的参数（避免交互式/阻塞命令把 Agent 挂死）
REQUIRED_ARGS: dict[str, tuple[str, ...]] = {
    "top": ("-b",),
    "htop": ("-b",),
}

# 允许的子命令白名单（命令 -> 允许的子命令集合），None 表示不限制子命令
ALLOWED_SUBCOMMANDS: dict[str, frozenset[str] | None] = {
    "systemctl": frozenset(
        {
            "status",
            "is-active",
            "is-enabled",
            "is-failed",
            "show",
            "list-units",
            "list-unit-files",
            "cat",
        }
    ),
    "service": frozenset({"status"}),
    "docker": frozenset({"ps", "images", "logs", "inspect", "stats", "info", "version", "top"}),
    "kubectl": frozenset({"get", "describe", "logs", "top", "version", "cluster-info"}),
    "swapon": frozenset({"--show", "-s"}),
    "mount": frozenset({"--show"}),
    "wget": frozenset({"-o", "-q", "-t", "-T"}),
}

PRIVILEGE_PREFIXES = ("sudo", "su", "pkexec", "doas")


@dataclass
class Layer2Whitelist(PermissionLayer):
    """L2：命令白名单层。"""

    layer_id: str = "L2"
    name: str = "命令白名单"
    description: str = "只放行只读诊断命令；管道/串联的每一段都要单独过审"
    whitelist: frozenset[str] = field(default=DEFAULT_READONLY_COMMANDS)
    whitelist_only: bool = True

    @classmethod
    def from_config(cls, cfg: dict[str, Any] | None = None) -> Layer2Whitelist:
        cfg = cfg or {}
        commands = frozenset(cfg.get("commands") or ()) or DEFAULT_READONLY_COMMANDS
        extra: Iterable[str] = cfg.get("extra_commands") or ()
        return cls(
            whitelist=frozenset(commands) | frozenset(extra),
            whitelist_only=bool(cfg.get("whitelist_only", True)),
        )

    def check(self, call: ToolCall) -> Decision:
        command = call.command.strip()
        if not command:
            return Decision.allow(self.layer_id, "非命令类工具，白名单不适用")
        if not self.whitelist_only:
            return Decision.allow(self.layer_id, "whitelist_only=false，白名单层放行")

        for segment in split_segments(command):
            decision = self._check_segment(segment)
            if not decision.allowed:
                return decision
        return Decision.allow(self.layer_id, "全部子命令均在白名单内")

    def _check_segment(self, segment: str) -> Decision:
        tokens = parse_safely(segment)
        head = segment.strip().split()[0] if segment.strip() else ""

        if head in PRIVILEGE_PREFIXES:
            return Decision.deny(self.layer_id, f"禁止提权执行（{head}）", rule=head)

        command = first_token(segment)
        if not command:
            return Decision.deny(self.layer_id, "无法解析命令", rule=segment[:80])
        if command not in self.whitelist:
            return Decision.deny(
                self.layer_id, f"命令 '{command}' 不在只读白名单内", rule=command
            )

        if tokens is None:
            return Decision.deny(self.layer_id, "命令引号未闭合，疑似注入", rule=segment[:80])

        for arg in FORBIDDEN_ARGS.get(command, ()):
            if arg and any(tok == arg or tok.startswith(arg) for tok in tokens[1:]):
                return Decision.deny(
                    self.layer_id, f"命令 '{command}' 禁止使用参数 '{arg}'", rule=arg
                )

        for arg in REQUIRED_ARGS.get(command, ()):
            if not any(tok == arg or tok.startswith(arg) for tok in tokens[1:]):
                return Decision.deny(
                    self.layer_id,
                    f"命令 '{command}' 必须带参数 '{arg}'（避免阻塞会话）",
                    rule=arg,
                )

        allowed_subs = ALLOWED_SUBCOMMANDS.get(command)
        if allowed_subs is not None:
            subs = [t for t in tokens[1:] if not t.startswith("-")]
            bad = [s for s in subs if s not in allowed_subs]
            if bad:
                return Decision.deny(
                    self.layer_id,
                    f"'{command}' 只允许只读子命令，拒绝：{', '.join(bad)}",
                    rule=bad[0],
                )
            if not subs and command in {"systemctl", "docker", "kubectl"}:
                return Decision.deny(
                    self.layer_id, f"'{command}' 缺少子命令", rule=command
                )

        return Decision.allow(self.layer_id)

    def rules(self) -> list[str]:
        head = [f"command:{c}" for c in sorted(self.whitelist)]
        return [*head, f"whitelist_only:{self.whitelist_only}"]
