import pytest

from ops_agent.permission import PERMISSION_PIPELINE, PermissionPipeline, ToolCall


def test_pipeline_allows_readonly() -> None:
    pipeline = PermissionPipeline.default()
    decision = pipeline.check(ToolCall(tool="ssh_execute", command="df -h", host="h1"))
    assert decision.allowed
    assert decision.layer == "ALL"


def test_pipeline_short_circuits_on_first_denial() -> None:
    pipeline = PermissionPipeline.default()
    # L1 命中黑名单后不应再走 L2/L3
    decision = pipeline.check(ToolCall(tool="ssh_execute", command="rm -rf /", host="h1"))
    assert not decision.allowed
    assert decision.layer == "L1"


@pytest.mark.asyncio
async def test_acheck_emits_denied_event() -> None:
    events: list[tuple[str, dict]] = []

    async def emit(event_type: str, **data):
        events.append((event_type, data))

    pipeline = PermissionPipeline.default(emit=emit)
    decision = await pipeline.acheck(
        ToolCall(tool="ssh_execute", command="sudo rm -rf /", host="10.0.0.1")
    )
    assert not decision.allowed
    assert events
    event_type, data = events[0]
    assert event_type == "permission.denied"
    assert data["host"] == "10.0.0.1"
    assert data["layer"] == "L1"
    assert data["reason"]


@pytest.mark.asyncio
async def test_acheck_emits_allowed_event() -> None:
    events: list[str] = []

    async def emit(event_type: str, **data):
        events.append(event_type)

    pipeline = PermissionPipeline.default(emit=emit)
    await pipeline.acheck(ToolCall(tool="ssh_execute", command="df -h", host="h1"))
    assert events == ["permission.allowed"]


def test_check_command_helper() -> None:
    pipeline = PermissionPipeline.default()
    assert pipeline.check_command("df -h").allowed
    assert not pipeline.check_command("rm -rf /").allowed


def test_describe_lists_all_layers() -> None:
    pipeline = PermissionPipeline.default()
    layers = pipeline.describe()
    assert [x["layer"] for x in layers] == ["L1", "L2", "L3"]
    assert all(x["rules"] for x in layers)


def test_capability_name_is_stable() -> None:
    assert PERMISSION_PIPELINE.name == "permission_pipeline"
