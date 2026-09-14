"""配置加载。

把 ``configs/*.yaml`` 的顶层段落映射到各插件的私有配置（Kernel 按插件名分发），
并支持 ``${ENV_VAR}`` 展开 —— 密钥只写占位符，不进仓库。
"""

from __future__ import annotations

import os
import re
from pathlib import Path
from typing import Any

import yaml

PROJECT_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_CONFIG_PATH = PROJECT_ROOT / "configs" / "default.yaml"
DEFAULT_RULES_PATH = PROJECT_ROOT / "configs" / "permission_rules.yaml"

# 插件名 -> 配置文件中的顶层段落
PLUGIN_SECTIONS: dict[str, str] = {
    "ssh_pool": "ssh",
    "permission_pipeline": "permission",
    "session_store": "session",
    "agent_loop": "agent",
    "deepseek_adapter": "model",
    "mock_adapter": "model",
}

ENV_PATTERN = re.compile(r"\$\{([A-Za-z_][A-Za-z0-9_]*)\}")


def load_yaml(path: str | Path) -> dict[str, Any]:
    p = Path(path)
    if not p.exists():
        return {}
    with p.open("r", encoding="utf-8") as f:
        return dict(yaml.safe_load(f) or {})


def load_config(path: str | Path | None = None) -> dict[str, Any]:
    """加载主配置；文件不存在时返回空配置（全部走代码默认值）。"""
    return load_yaml(path or DEFAULT_CONFIG_PATH)


def expand_env(value: Any) -> Any:
    """递归展开 ``${VAR}``；未定义的环境变量原样保留。"""
    if isinstance(value, str):

        def _sub(match: re.Match[str]) -> str:
            return os.environ.get(match.group(1), match.group(0))

        return ENV_PATTERN.sub(_sub, value)
    if isinstance(value, dict):
        return {k: expand_env(v) for k, v in value.items()}
    if isinstance(value, list):
        return [expand_env(v) for v in value]
    return value


def kernel_config(raw: dict[str, Any] | None = None) -> dict[str, dict[str, Any]]:
    """把扁平配置转换成 Kernel 期望的 ``{插件名: 配置}``。"""
    raw = raw or {}
    cfg: dict[str, dict[str, Any]] = {}
    for plugin_name, section in PLUGIN_SECTIONS.items():
        cfg[plugin_name] = dict(raw.get(section) or {})
    return cfg


def load_permission_rules(
    path: str | Path | None = None, base: dict[str, Any] | None = None
) -> dict[str, Any]:
    """合并权限规则文件与默认配置（文件优先）。"""
    merged = dict(base or {})
    rules = load_yaml(path or DEFAULT_RULES_PATH)
    for key, value in rules.items():
        merged[key] = value
    return merged
