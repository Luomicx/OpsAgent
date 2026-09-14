"""插件内核：容器、上下文、事件总线、能力三角色。"""

from .capability import (
    Capability,
    MissingCapabilityError,
    Provider,
    ProviderFn,
    capability,
    consumer,
)
from .container import Kernel, Plugin, plugin
from .context import PluginContext
from .events import WILDCARD, Event, EventBus, Handle

__all__ = [
    "WILDCARD",
    "Capability",
    "Event",
    "EventBus",
    "Handle",
    "Kernel",
    "MissingCapabilityError",
    "Plugin",
    "PluginContext",
    "Provider",
    "ProviderFn",
    "capability",
    "consumer",
    "plugin",
]
