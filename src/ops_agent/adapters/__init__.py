"""模型适配器：统一消息格式 + 各厂商实现。"""

from .base import MODEL_ADAPTER, AdapterError, Message, ModelAdapter, Response, ToolCallRequest
from .deepseek import DeepSeekAdapter, deepseek_adapter_plugin
from .mock import MockAdapter, demo_adapter, mock_adapter_plugin

__all__ = [
    "MODEL_ADAPTER",
    "AdapterError",
    "DeepSeekAdapter",
    "Message",
    "MockAdapter",
    "ModelAdapter",
    "Response",
    "ToolCallRequest",
    "deepseek_adapter_plugin",
    "demo_adapter",
    "mock_adapter_plugin",
]
