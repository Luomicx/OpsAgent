"""L3 Shell 注入检测。

黑名单、白名单都是"看命令名"，L3 看的是**字符**：只要出现能让语义逃逸的元字符就拒绝。
它是纵深防御的最后一道 —— 即便 L2 被关掉（whitelist_only=false），L3 仍然兜底。
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

from .base import Decision, PermissionLayer, ToolCall
from .shell import parse_safely

BACKGROUND_PATTERN = re.compile(r"&\s*$")
CONTROL_CHARS = ("\x00", "\n", "\r", "\x1b")
# ${...} 可用于拼接 IFS 等绕过手段，一律拒绝
BRACE_EXPANSION = re.compile(r"\$\{")


@dataclass
class Layer3ShellInjection(PermissionLayer):
    """L3：Shell 注入与元字符扫描层。"""

    layer_id: str = "L3"
    name: str = "Shell 注入检测"
    description: str = "扫描元字符、命令替换、重定向与畸形引号"
    allow_pipes: bool = True
    allow_semicolon: bool = False

    @classmethod
    def from_config(cls, cfg: dict[str, Any] | None = None) -> Layer3ShellInjection:
        cfg = cfg or {}
        return cls(
            allow_pipes=bool(cfg.get("allow_pipes", True)),
            allow_semicolon=bool(cfg.get("allow_semicolon", False)),
        )

    def check(self, call: ToolCall) -> Decision:
        command = call.command.strip()
        if not command:
            return Decision.allow(self.layer_id, "非命令类工具，注入扫描不适用")

        for ch in CONTROL_CHARS:
            if ch in command:
                return Decision.deny(
                    self.layer_id, f"命令含控制字符（{ch!r}），疑似注入", rule=repr(ch)
                )

        if "$(" in command:
            return Decision.deny(self.layer_id, "禁止命令替换 $(...)", rule="$(")
        if "`" in command:
            return Decision.deny(self.layer_id, "禁止反引号命令替换", rule="`")

        if "<" in command or ">" in command:
            return Decision.deny(self.layer_id, "禁止输入输出重定向（< >）", rule="redirection")

        if BRACE_EXPANSION.search(command):
            return Decision.deny(self.layer_id, "禁止变量展开 ${...}", rule="${")

        if not self.allow_semicolon and ";" in command:
            return Decision.deny(self.layer_id, "禁止命令串联（;）", rule=";")
        if "&&" in command:
            return Decision.deny(self.layer_id, "禁止命令串联（&&）", rule="&&")
        if "||" in command:
            return Decision.deny(self.layer_id, "禁止命令串联（||）", rule="||")

        if "|" in command:
            if not self.allow_pipes:
                return Decision.deny(self.layer_id, "禁止管道", rule="|")
            if re.search(r"\|\s*$", command):
                return Decision.deny(self.layer_id, "管道末尾缺少命令", rule="|")

        if BACKGROUND_PATTERN.search(command):
            return Decision.deny(self.layer_id, "禁止后台执行（&）", rule="&")

        if parse_safely(command) is None:
            return Decision.deny(self.layer_id, "命令引号未闭合，疑似注入", rule="unbalanced quote")

        return Decision.allow(self.layer_id, "未发现注入特征")

    def rules(self) -> list[str]:
        return [
            "禁止:控制字符/空字节",
            "禁止:$(...) 与反引号",
            "禁止:重定向 < >",
            "禁止:${...} 变量展开",
            f"禁止:; (allow_semicolon={self.allow_semicolon})",
            f"管道:{'允许' if self.allow_pipes else '禁止'}",
            "禁止:后台执行 &",
            "要求:引号闭合",
        ]
