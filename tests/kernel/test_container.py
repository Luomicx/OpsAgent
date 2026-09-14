import pytest

from ops_agent.kernel import Kernel, MissingCapabilityError, PluginContext, plugin
from ops_agent.kernel.capability import capability

FOO = capability("foo", str, "测试能力")
BAR = capability("bar", str, "依赖 foo 的能力")


def _foo_plugin() -> object:
    def setup(ctx: PluginContext) -> None:
        ctx.provide(FOO, "foo-value")

    return plugin(name="foo", setup=setup, provides=(FOO,))


def _bar_plugin() -> object:
    def setup(ctx: PluginContext) -> None:
        value = ctx.require(FOO)
        ctx.provide(BAR, f"bar+{value}")

    return plugin(name="bar", setup=setup, requires=(FOO,), provides=(BAR,))


@pytest.mark.asyncio
async def test_load_and_resolve_capability() -> None:
    kernel = Kernel()
    await kernel.load(_foo_plugin())
    assert kernel.get(FOO) == "foo-value"
    assert kernel.capabilities["foo"] == "foo"


@pytest.mark.asyncio
async def test_missing_dependency_raises() -> None:
    kernel = Kernel()
    with pytest.raises(MissingCapabilityError):
        await kernel.load(_bar_plugin())


@pytest.mark.asyncio
async def test_load_all_topological_order() -> None:
    """乱序传入也要能按依赖加载成功。"""
    kernel = Kernel()
    await kernel.load_all([_bar_plugin(), _foo_plugin()])
    assert kernel.get(BAR) == "bar+foo-value"


@pytest.mark.asyncio
async def test_unload_reverts_side_effects() -> None:
    kernel = Kernel()
    seen: list[str] = []
    unloaded: list[str] = []

    def setup(ctx: PluginContext) -> None:
        ctx.on("tool.before", lambda e: seen.append(e.type))
        ctx.on_unload(lambda: unloaded.append("cleaned"))
        ctx.provide(FOO, "value")

    await kernel.load(plugin(name="foo", setup=setup, provides=(FOO,)))
    await kernel.emit("tool.before")

    await kernel.unload("foo")

    # 卸载后：事件退订 + 清理钩子执行 + 能力摘除
    await kernel.emit("tool.before")
    assert seen == ["tool.before"]
    assert unloaded == ["cleaned"]
    assert not kernel.has(FOO)


@pytest.mark.asyncio
async def test_duplicate_plugin_rejected() -> None:
    kernel = Kernel()
    await kernel.load(_foo_plugin())
    with pytest.raises(ValueError):
        await kernel.load(_foo_plugin())


@pytest.mark.asyncio
async def test_contract_violation_detected() -> None:
    class Contract:
        pass

    cap = capability("typed", Contract, "带契约的能力")

    def setup(ctx: PluginContext) -> None:
        ctx.provide(cap, "not-a-contract-instance")

    kernel = Kernel()
    with pytest.raises(TypeError):
        await kernel.load(plugin(name="typed", setup=setup, provides=(cap,)))


@pytest.mark.asyncio
async def test_shutdown_unloads_all() -> None:
    kernel = Kernel()
    await kernel.load_all([_foo_plugin(), _bar_plugin()])
    await kernel.shutdown()
    assert kernel.plugins == []
    assert not kernel.has(FOO)


@pytest.mark.asyncio
async def test_async_setup_supported() -> None:
    async def setup(ctx: PluginContext) -> None:
        ctx.provide(FOO, "async-value")

    kernel = Kernel()
    await kernel.load(plugin(name="foo", setup=setup, provides=(FOO,)))
    assert kernel.get(FOO) == "async-value"


@pytest.mark.asyncio
async def test_try_get_returns_default() -> None:
    kernel = Kernel()
    assert kernel.try_get(FOO, "fallback") == "fallback"
