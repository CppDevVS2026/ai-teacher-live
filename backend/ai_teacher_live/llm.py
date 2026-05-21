"""LLM client — talks to any OpenAI-compatible chat-completions endpoint.

See ``providers.py`` for how the active provider is selected. The teacher
backend uses Cerebras by default (free tier, very fast Llama 3.3 70B) but
falls back to HF, Groq, OpenRouter, OpenAI, or a fully custom endpoint
based on which API keys are set.
"""

from __future__ import annotations

import json
from collections.abc import AsyncIterator
from typing import Any

import httpx

from .providers import Provider, api_key, current


class LLMError(RuntimeError):
    """Raised when the LLM backend returns an error."""


def _build_client(provider: Provider, timeout: float = 60.0) -> httpx.AsyncClient:
    key = api_key(provider)
    if not key:
        raise LLMError(
            f"No API key found for provider {provider.name!r}. "
            f"Set ${provider.env_key} (or LLM_API_KEY) and restart the server."
        )
    headers: dict[str, str] = {
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    }
    if provider.extra_headers:
        headers.update(provider.extra_headers)
    return httpx.AsyncClient(
        base_url=provider.base_url,
        timeout=timeout,
        headers=headers,
    )


async def chat(
    messages: list[dict[str, str]],
    *,
    model: str | None = None,
    temperature: float = 0.8,
    max_tokens: int = 512,
) -> str:
    """Send a single chat-completion request and return the assistant text."""
    provider = current()
    payload: dict[str, Any] = {
        "model": model or provider.default_model,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "stream": False,
    }
    async with _build_client(provider) as c:
        resp = await c.post("/chat/completions", json=payload)
    if resp.status_code >= 400:
        raise LLMError(
            f"{provider.name} error {resp.status_code}: {resp.text[:500]}"
        )
    data = resp.json()
    try:
        return data["choices"][0]["message"]["content"].strip()
    except (KeyError, IndexError, TypeError) as e:
        raise LLMError(f"Unexpected {provider.name} response shape: {data!r}") from e


async def chat_stream(
    messages: list[dict[str, str]],
    *,
    model: str | None = None,
    temperature: float = 0.8,
    max_tokens: int = 512,
) -> AsyncIterator[str]:
    """Yield assistant text deltas as they arrive (Server-Sent Events)."""
    provider = current()
    payload: dict[str, Any] = {
        "model": model or provider.default_model,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "stream": True,
    }
    async with _build_client(provider) as c:
        async with c.stream("POST", "/chat/completions", json=payload) as resp:
            if resp.status_code >= 400:
                body = await resp.aread()
                raise LLMError(
                    f"{provider.name} error {resp.status_code}: {body[:500]!r}"
                )
            async for line in resp.aiter_lines():
                if not line or not line.startswith("data:"):
                    continue
                data = line[5:].strip()
                if data == "[DONE]":
                    return
                try:
                    obj = json.loads(data)
                except json.JSONDecodeError:
                    continue
                try:
                    delta = obj["choices"][0]["delta"].get("content")
                except (KeyError, IndexError, TypeError):
                    delta = None
                if delta:
                    yield delta


__all__ = ["chat", "chat_stream", "LLMError"]
