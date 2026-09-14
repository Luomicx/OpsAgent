"""命令行入口。

    ops-agent --host 192.168.1.10 -p "看看磁盘和内存"
    ops-agent --adapter mock --host demo-host        # 离线演示（含一次被拦截的写操作）
    ops-agent --check-command "rm -rf /"             # 只做权限校验
    ops-agent --show-permission                      # 打印各层规则
"""

from __future__ import annotations

import argparse
import asyncio
import contextlib
import sys
from typing import Any

from .agent.loop import AGENT_LOOP, AgentLoopFactory
from .config import DEFAULT_CONFIG_PATH, load_config
from .permission.pipeline import PERMISSION_PIPELINE
from .runtime import build_kernel
from .session.store import SESSION_STORE
from .tools.registry import TOOL_REGISTRY

BANNER = "OpsAgent · 只读运维诊断（默认拒绝一切写操作）"


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="ops-agent",
        description="基于 SSH 的智能运维 Agent：插件化内核 + 五层权限 + 可审计事件流",
    )
    parser.add_argument("--host", help="目标主机 IP 或域名")
    parser.add_argument("--user", help="SSH 用户，默认取配置中的 ssh.default_user")
    parser.add_argument("-p", "--prompt", help="单条指令；省略则进入交互式会话")
    parser.add_argument(
        "--adapter", default="deepseek", choices=["deepseek", "mock"], help="模型适配器"
    )
    parser.add_argument("--config", default=str(DEFAULT_CONFIG_PATH), help="配置文件路径")
    parser.add_argument("--rules", default=None, help="权限规则文件路径")
    parser.add_argument("--session-log", default=None, help="事件流落盘路径（JSONL）")
    parser.add_argument(
        "--check-command", default=None, help="只做权限校验，不连接主机"
    )
    parser.add_argument(
        "--dry-run", action="store_true", help="用假 SSH 连接跑通链路，不连真实主机"
    )
    parser.add_argument("--show-permission", action="store_true", help="打印各权限层规则")
    parser.add_argument("--quiet", action="store_true", help="只输出最终结论")
    return parser


# ---------------------------------------------------------------- 输出辅助
def _print(*args: Any) -> None:
    print(*args, flush=True)


def _attach_logger(kernel: Any, quiet: bool) -> None:
    """订阅事件流，把工具调用过程实时打印出来（体现事件流的价值）。"""
    if quiet:
        return

    async def on_tool_before(event: Any) -> None:
        command = event.data.get("command") or ""
        _print(f"  · 调用 {event.data.get('tool')}: {command}")

    async def on_denied(event: Any) -> None:
        _print(f"    ✗ 拒绝 [{event.data.get('layer')}] {event.data.get('reason')}")

    async def on_allowed(event: Any) -> None:
        _print("    ✓ 权限通过")

    async def on_tool_after(event: Any) -> None:
        if event.data.get("ok"):
            _print(f"    ← 完成（{event.data.get('length', 0)} 字符）")

    events = kernel.events
    events.on("tool.before", on_tool_before)
    events.on("permission.denied", on_denied)
    events.on("permission.allowed", on_allowed)
    events.on("tool.after", on_tool_after)


# ---------------------------------------------------------------- 子命令
async def _cmd_check_command(args: argparse.Namespace, raw: dict[str, Any]) -> int:
    kernel = await build_kernel(raw, adapter=args.adapter, rules_path=args.rules)
    pipeline = kernel.get(PERMISSION_PIPELINE)
    decision = pipeline.check_command(args.check_command, host=args.host or "")
    _print(f"命令：{args.check_command}")
    _print(f"结果：{'允许' if decision.allowed else '拒绝'}  [{decision.layer}] {decision.reason}")
    if decision.rule:
        _print(f"命中：{decision.rule}")
    await kernel.shutdown()
    return 0 if decision.allowed else 2


async def _cmd_show_permission(args: argparse.Namespace, raw: dict[str, Any]) -> int:
    kernel = await build_kernel(raw, adapter=args.adapter, rules_path=args.rules)
    pipeline = kernel.get(PERMISSION_PIPELINE)
    for layer in pipeline.describe():
        _print(f"[{layer['layer']}] {layer['name']} — {layer['description']}")
        _print(f"    规则数: {len(layer['rules'])}")
    await kernel.shutdown()
    return 0


async def _cmd_agent(args: argparse.Namespace, raw: dict[str, Any]) -> int:
    kernel = await build_kernel(
        raw,
        adapter=args.adapter,
        session_path=args.session_log,
        rules_path=args.rules,
        dry_run=args.dry_run,
    )
    _attach_logger(kernel, args.quiet)
    factory: AgentLoopFactory = kernel.get(AGENT_LOOP)
    loop = factory.create(args.host or "unknown-host", user=args.user)

    prompts = [args.prompt] if args.prompt else []

    tools = kernel.get(TOOL_REGISTRY).names()
    _print(BANNER)
    _print(
        f"主机: {args.host or 'unknown-host'}  适配器: {args.adapter}  工具: {', '.join(tools)}"
    )

    try:
        if prompts:
            for prompt in prompts:
                _print(f"\n> {prompt}")
                result = await loop.run(prompt)
                _print(f"\n{result.text}")
                if result.denied_steps:
                    _print(f"（本次有 {len(result.denied_steps)} 次调用被安全策略拦截）")
        else:
            _print("输入 exit / quit 退出\n")
            while True:
                try:
                    user_input = await asyncio.to_thread(input, "> ")
                except (EOFError, KeyboardInterrupt):
                    break
                if user_input.strip().lower() in {"exit", "quit", "q"}:
                    break
                if not user_input.strip():
                    continue
                result = await loop.run(user_input)
                _print(f"\n{result.text}\n")
    finally:
        store = kernel.try_get(SESSION_STORE)
        if store is not None:
            _print(f"\n事件流: {store.path or '(内存)'}  共 {len(store.all())} 条")
        await kernel.shutdown()
    return 0


# ---------------------------------------------------------------- 入口
async def _run(args: argparse.Namespace) -> int:
    raw = load_config(args.config)
    if args.check_command:
        return await _cmd_check_command(args, raw)
    if args.show_permission:
        return await _cmd_show_permission(args, raw)
    return await _cmd_agent(args, raw)


def main(argv: list[str] | None = None) -> int:
    with contextlib.suppress(AttributeError, ValueError):
        for stream in (sys.stdout, sys.stderr):
            stream.reconfigure(encoding="utf-8")  # type: ignore[union-attr]
    args = build_parser().parse_args(argv)
    if not (args.check_command or args.show_permission) and not args.host:
        build_parser().error("需要 --host（或使用 --check-command / --show-permission）")
    try:
        return asyncio.run(_run(args))
    except KeyboardInterrupt:  # pragma: no cover
        _print("\n已中断")
        return 130


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
