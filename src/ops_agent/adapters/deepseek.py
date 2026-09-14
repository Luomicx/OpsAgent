"""DeepSeek 适配器（OpenAI 兼容协议）。"""

from __future__ import annotations

import os
from typing import Any

import httpx

from ..kernel.container import Plugin, plugin
from ..kernel.context import PluginContext
from .base import MODEL_ADAPTER, AdapterError, Message, Response, ToolCallRequest

DEFAULT_BASE_URL = "https://api.deepseek.com"
DEFAULT_MODEL = "deepseek-chat"
DEFAULT_TIMEOUT = 60.0


class DeepSeekAdapter:
    """DeepSeek / OpenAI 兼容接口的实现。

    API Key 只从环境变量读取，绝不落日志（AGENTS.md 4.1）。
    """

    name = "deepseek"

    def __init__(
        self,
        *,
        api_key: str | None = None,
        model: str = DEFAULT_MODEL,
        base_url: str = DEFAULT_BASE_URL,
        timeout: float = DEFAULT_TIMEOUT,
        temperature: float = 0.0,
        client: httpx.AsyncClient | None = None,
    ) -> None:
        self.api_key = api_key or os.environ.get("DEEPSEEK_API_KEY", "")
        if not self.api_key:
            raise AdapterError("缺少 DEEPSEEK_API_KEY（环境变量或配置）")
        self.model = model
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self.temperature = temperature
        self._client = client
        self._owns_client = client is None

    # -- 生命周期 ---------------------------------------------------------
    async def aclose(self) -> None:
        if self._client is not None and self._owns_client:
            await self._client.aclose()

    def supports_function_calling(self) -> bool:
        return True

    # -- 主入口 -----------------------------------------------------------
    async def chat(
        self, messages: list[Message], tools: list[dict[str, Any]] | None = None
    ) -> Response:
        payload: dict[str, Any] = {
            "model": self.model,
            "messages": [m.to_dict() for m in messages],
            "temperature": self.temperature,
            "stream": False,
        }
        if tools:
            payload["tools"] = tools
            payload["tool_choice"] = "auto"

        data = await self._post(payload)
        try:
            choice = data["choices"][0]
            raw_message = choice["message"]
        except (KeyError, IndexError) as exc:
            raise AdapterError(f"模型响应格式异常: {str(data)[:300]}") from exc

        tool_calls = [
            ToolCallRequest.from_openai(call, fallback_id=f"call_{i}")
            for i, call in enumerate(raw_message.get("tool_calls") or [])
        ]
        message = Message.assistant(content=raw_message.get("content") or "", tool_calls=tool_calls)
        usage = data.get("usage") or {}
        return Response(
            message=message,
            finish_reason=str(choice.get("finish_reason") or "stop"),
            usage={
                "prompt_tokens": int(usage.get("prompt_tokens", 0)),
                "completion_tokens": int(usage.get("completion_tokens", 0)),
                "total_tokens": int(usage.get("total_tokens", 0)),
            },
            raw=data,
        )

    async def _post(self, payload: dict[str, Any]) -> dict[str, Any]:
        client = self._client or httpx.AsyncClient(timeout=self.timeout)
        try:
            resp = await client.post(
                f"{self.base_url}/chat/completions",
                json=payload,
                headers={
                    "Authorization": f"Bearer {self.api_key}",
                    "Content-Type": "application/json",
                },
            )
            resp.raise_for_status()
            return dict(resp.json())
        except httpx.HTTPError as exc:
            raise AdapterError(f"模型请求失败: {type(exc).__name__}: {exc}") from exc
        finally:
            if self._client is None:
                await client.aclose()


def _setup(ctx: PluginContext) -> None:
    cfg = dict(ctx.config)
    adapter = DeepSeekAdapter(
        api_key=cfg.get("api_key"),
        model=str(cfg.get("model", DEFAULT_MODEL)),
        base_url=str(cfg.get("base_url", DEFAULT_BASE_URL)),
        timeout=float(cfg.get("timeout", DEFAULT_TIMEOUT)),
        temperature=float(cfg.get("temperature", 0.0)),
    )
    ctx.provide(MODEL_ADAPTER, adapter)
    ctx.on_unload(lambda: _close(adapter))


_BACKGROUND_TASKS: set[Any] = set()


def _close(adapter: DeepSeekAdapter) -> None:
    """卸载时关闭 HTTP 客户端；持有 task 引用避免被 GC 提前回收。"""
    import asyncio

    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        asyncio.run(adapter.aclose())
    else:
        task = loop.create_task(adapter.aclose())
        _BACKGROUND_TASKS.add(task)
        task.add_done_callback(_BACKGROUND_TASKS.discard)


deepseek_adapter_plugin: Plugin = plugin(
    name="deepseek_adapter",
    setup=_setup,
    provides=(MODEL_ADAPTER,),
)
