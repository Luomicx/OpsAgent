import pytest

from ops_agent.kernel import WILDCARD, EventBus


@pytest.mark.asyncio
async def test_emit_reaches_handler() -> None:
    bus = EventBus()
    seen: list[str] = []

    async def handler(event):
        seen.append(event.type)

    bus.on("tool.before", handler)
    await bus.emit("tool.before", tool="ssh_execute")
    assert seen == ["tool.before"]


@pytest.mark.asyncio
async def test_off_removes_handler() -> None:
    bus = EventBus()
    seen: list[str] = []

    def handler(event):
        seen.append(event.type)

    handle = bus.on("tool.before", handler)
    await bus.emit("tool.before")
    bus.off(handle)
    await bus.emit("tool.before")
    assert seen == ["tool.before"]  # 退订后不再收到


@pytest.mark.asyncio
async def test_wildcard_subscriber() -> None:
    bus = EventBus()
    seen: list[str] = []

    def handler(event):
        seen.append(event.type)

    bus.on(WILDCARD, handler)
    await bus.emit("ssh.connect")
    await bus.emit("tool.after")
    assert seen == ["ssh.connect", "tool.after"]


@pytest.mark.asyncio
async def test_sync_handler_supported() -> None:
    """同步 handler 也必须能被 await 的 emit 正常调用。"""
    bus = EventBus()
    seen: list[str] = []
    bus.on("x", lambda e: seen.append(e.data["v"]))
    await bus.emit("x", v=1)
    assert seen == [1]


@pytest.mark.asyncio
async def test_handler_exception_does_not_break_others() -> None:
    bus = EventBus()
    seen: list[str] = []

    def bad(event):
        raise RuntimeError("boom")

    def good(event):
        seen.append("ok")

    bus.on("x", bad)
    bus.on("x", good)
    await bus.emit("x")
    assert seen == ["ok"]


def test_listeners_count() -> None:
    bus = EventBus()
    bus.on("x", lambda e: None)
    bus.on(WILDCARD, lambda e: None)
    assert bus.listeners("x") == 2
    assert bus.listeners("y") == 1


def test_emit_sync_skips_async_handlers() -> None:
    bus = EventBus()
    called = False

    async def handler(event):
        nonlocal called
        called = True

    bus.on("x", handler)
    bus.emit_sync("x")
    assert called is False
