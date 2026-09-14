import pytest

from ops_agent.session import EVENT_TYPES, EventStore, SessionEvent
from ops_agent.session.event import TOOL_BEFORE


def test_record_assigns_monotonic_seq() -> None:
    store = EventStore()
    e1 = store.record(TOOL_BEFORE, tool="ssh_execute")
    e2 = store.record("tool.after", ok=True)
    assert (e1.seq, e2.seq) == (1, 2)


def test_unknown_event_type_rejected() -> None:
    with pytest.raises(ValueError):
        SessionEvent(seq=1, type="not.registered", data={})


@pytest.mark.asyncio
async def test_append_and_replay(tmp_path) -> None:
    path = tmp_path / "s.jsonl"
    store = EventStore(path)
    await store.emit(TOOL_BEFORE, tool="ssh_execute", command="df -h")
    await store.emit("tool.after", ok=True)

    assert path.exists()
    assert store.verify_integrity()

    loaded = EventStore.load(path)
    assert [e.type for e in loaded.all()] == [TOOL_BEFORE, "tool.after"]
    assert loaded.seq == 2


@pytest.mark.asyncio
async def test_append_only_no_mutation(tmp_path) -> None:
    """事件只能追加，历史不可改写。"""
    path = tmp_path / "s.jsonl"
    store = EventStore(path)
    await store.emit(TOOL_BEFORE, tool="a")
    await store.emit(TOOL_BEFORE, tool="b")

    loaded = EventStore.load(path)
    assert len(loaded.all()) == 2
    assert loaded.all()[0].data["tool"] == "a"


@pytest.mark.asyncio
async def test_replay_filters_by_type() -> None:
    store = EventStore()
    await store.emit(TOOL_BEFORE)
    await store.emit("tool.after")
    await store.emit("tool.after")
    assert len(list(store.replay({"tool.after"}))) == 2


def test_json_roundtrip() -> None:
    event = SessionEvent(seq=7, type=TOOL_BEFORE, data={"tool": "ssh_execute"})
    restored = SessionEvent.from_json(event.to_json())
    assert restored == event


def test_event_types_is_closed_set() -> None:
    assert TOOL_BEFORE in EVENT_TYPES
    assert "whatever" not in EVENT_TYPES
