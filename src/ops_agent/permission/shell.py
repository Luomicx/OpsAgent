"""shell 命令解析工具。

权限层要能看穿各种"变形写法"，这里的三个函数是所有层共用的地基：

* ``normalize`` —— 还原被混淆的命令（``$IFS``、反斜杠、引号、多余空格）
* ``split_segments`` —— 按 ``;`` ``&&`` ``||`` ``|`` 拆成多条子命令
* ``first_token`` —— 取子命令的可执行文件名，用于白名单比对
"""

from __future__ import annotations

import re
import shlex

# 命令替换 / 后台执行 / 重定向 / 控制字符
DANGEROUS_TOKENS: tuple[str, ...] = ("$(", "`", "\n", "\r", "\x00", ">&", "<&")
REDIRECT_PATTERN = re.compile(r"(?<!\\)(>|<)")
BACKGROUND_PATTERN = re.compile(r"&\s*$")
SEGMENT_SPLIT_PATTERN = re.compile(r";|&&|\|\||\||\n|\r")
IFS_PATTERN = re.compile(r"\$\{?IFS\}?")
ESCAPE_PATTERN = re.compile(r"\\(.)")
QUOTE_CHARS = "'\"`"


def normalize(command: str) -> str:
    """把命令还原成"容易比对"的形态，但不改变其语义。

    处理：``$IFS`` 变空格、去掉反斜杠转义、去掉引号、小写、压缩空白。
    """
    text = IFS_PATTERN.sub(" ", command)
    text = ESCAPE_PATTERN.sub(r"\1", text)
    text = "".join(ch for ch in text if ch not in QUOTE_CHARS)
    text = text.lower()
    return re.sub(r"\s+", " ", text).strip()


def split_segments(command: str) -> list[str]:
    """按 shell 分隔符拆成子命令列表（去掉空段）。"""
    return [seg.strip() for seg in SEGMENT_SPLIT_PATTERN.split(command) if seg.strip()]


def first_token(segment: str) -> str:
    """取子命令的可执行文件名（去掉路径前缀）。"""
    segment = segment.strip()
    if not segment:
        return ""
    try:
        tokens = shlex.split(segment)
    except ValueError:
        tokens = segment.split()
    if not tokens:
        return ""
    token = tokens[0]
    if token in {"sudo", "env", "nohup", "time", "nice"}:  # 前缀命令：看它们后面跟什么
        rest = tokens[1:] if len(tokens) > 1 else []
        return first_token(" ".join(rest)) if rest else token
    return token.rsplit("/", 1)[-1]


def quote(value: str) -> str:
    """拼接进 shell 前的强制转义（AGENTS.md 4.2）。"""
    return shlex.quote(value)


def parse_safely(command: str) -> list[str] | None:
    """尝试按 shell 词法解析；引号不闭合等畸形命令返回 ``None``（典型注入特征）。"""
    try:
        return shlex.split(command)
    except ValueError:
        return None
