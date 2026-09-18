"""领域对象 → 前端 JSON 的序列化。

GUI 需要的是**稳定、扁平、可直接渲染**的结构，而不是把 Python dataclass 原样
``asdict`` 出去（那样嵌套深、字段名是 snake_case、还夹带内部字段）。

所以每种对象都显式映射成一个前端 TypeScript 接口对应的字典。
一一对应关系见 ``desktop/src/lib/types.ts``。
"""

from __future__ import annotations

from typing import Any

from ..agent.loop import AgentResult, StepRecord
from ..kernel.events import Event
from ..session.event import SessionEvent


def step_to_dict(record: StepRecord) -> dict[str, Any]:
    """一次工具调用的留痕 —— 前端时间线的核心单元。"""
    return {
        "tool": record.tool,
        "command": record.command,
        "args": record.args,
        "allowed": record.allowed,
        "denied": record.denied,
        "layer": record.layer,
        "reason": record.reason,
        "output": record.output,
        "outputLength": len(record.output),
    }


def result_to_dict(result: AgentResult) -> dict[str, Any]:
    """一次 ``run`` 的最终产出。"""
    return {
        "text": result.text,
        "finished": result.finished,
        "stepsUsed": result.steps_used,
        "steps": [step_to_dict(s) for s in result.steps],
        "deniedCount": len(result.denied_steps),
    }


def event_to_dict(event: Event) -> dict[str, Any]:
    """运行时事件 → 实时推送用。"""
    return {
        "type": event.type,
        "ts": event.ts,
        "data": _redact(event.data),
    }


def session_event_to_dict(event: SessionEvent) -> dict[str, Any]:
    """已落盘事件 → 回放用（多一个 seq）。"""
    return {
        "seq": event.seq,
        "type": event.type,
        "ts": event.ts,
        "data": _redact(event.data),
    }


def layer_to_dict(layer: dict[str, Any]) -> dict[str, Any]:
    """权限层的描述信息（来自 ``PermissionPipeline.describe()``）。"""
    rules = layer.get("rules") or []
    return {
        "layer": layer.get("layer", ""),
        "name": layer.get("name", ""),
        "description": layer.get("description", ""),
        "ruleCount": len(rules),
        "rules": [_rule_preview(r) for r in rules],
    }


def _rule_preview(rule: Any) -> dict[str, Any]:
    """规则条目可能是字符串、正则对象或字典，统一成 {pattern, kind, description}。"""
    if isinstance(rule, dict):
        return {
            "pattern": str(rule.get("pattern", "")),
            "kind": str(rule.get("kind", "")),
            "description": str(rule.get("description", "")),
        }
    if isinstance(rule, str):
        return {"pattern": rule, "kind": "", "description": ""}

    # re.Pattern 或其它对象：取其 pattern 属性
    pattern = getattr(rule, "pattern", None)
    if isinstance(pattern, str):
        return {"pattern": pattern, "kind": "", "description": ""}
    return {"pattern": str(rule), "kind": "", "description": ""}


def decision_to_dict(decision: Any) -> dict[str, Any]:
    """权限判定结果 → 给命令行检查器用。"""
    return {
        "allowed": bool(decision.allowed),
        "layer": str(decision.layer),
        "reason": str(decision.reason),
        "rule": str(getattr(decision, "rule", "") or ""),
    }


# ------------------------------------------------------------------ 脱敏
#: 这些键的值绝不允许出现在推给前端（以及写入前端日志）的数据里。
_SENSITIVE_KEYS: frozenset[str] = frozenset(
    {"api_key", "apikey", "password", "passwd", "secret", "token", "private_key", "credential"}
)

_REDACTED = "***"


def _redact(data: dict[str, Any]) -> dict[str, Any]:
    """递归抹掉疑似凭据字段。

    事件流会被 GUI 原样展示、也会落盘，所以脱敏放在**出站边界**做一次，
    而不是指望每个调用点都记得处理（AGENTS.md 4.1：禁止在日志中打印密钥）。
    """
    out: dict[str, Any] = {}
    for key, value in data.items():
        if key.lower() in _SENSITIVE_KEYS:
            out[key] = _REDACTED
        elif isinstance(value, dict):
            out[key] = _redact(value)
        else:
            out[key] = value
    return out
