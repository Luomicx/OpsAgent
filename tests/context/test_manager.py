from ops_agent.adapters.base import Message
from ops_agent.context import ContextManager, KeepRecentCompressor


def test_build_includes_system_and_user() -> None:
    manager = ContextManager(system_prompt="SYS")
    messages = manager.build("你好")
    assert [m.role for m in messages] == ["system", "user"]
    assert messages[0].content == "SYS"


def test_history_accumulates() -> None:
    manager = ContextManager(system_prompt="SYS")
    manager.add_user("q1")
    manager.add_assistant(Message.assistant("a1"))
    manager.add_tool_result("c1", "ssh_execute", "out")
    assert [m.role for m in manager.snapshot()] == ["user", "assistant", "tool"]


def test_truncate_long_output() -> None:
    compressor = KeepRecentCompressor(keep_recent=2, max_output_chars=20)
    assert "已截断" in compressor.truncate("x" * 100, 20)
    assert compressor.truncate("short") == "short"


def test_compaction_keeps_recent_and_first_question() -> None:
    manager = ContextManager(
        system_prompt="SYS",
        compressor=KeepRecentCompressor(keep_recent=3),
        max_messages=3,
    )
    manager.add_user("最初的问题")
    for i in range(10):
        manager.add(Message.assistant(f"a{i}"))
    snapshot = manager.snapshot()
    assert len(snapshot) <= 4
    assert snapshot[0].content == "最初的问题"


def test_reset_clears_history() -> None:
    manager = ContextManager(system_prompt="SYS")
    manager.add_user("x")
    manager.reset()
    assert manager.snapshot() == []


def test_estimate_chars() -> None:
    manager = ContextManager(system_prompt="SYS")
    manager.add_user("hello")
    assert manager.estimate_chars() >= 8
