"""Hugging Face Inference client.

Uses the OpenAI-compatible chat-completions endpoint exposed by Hugging Face
Inference Providers (the "router"). Falls back to an explicit hf-inference
model endpoint if needed.

Env vars:
    HF_TOKEN          - required, read-access token from huggingface.co/settings/tokens
    HF_MODEL          - optional, override default model
    HF_BASE_URL       - optional, override the API base (advanced)
"""

from __future__ import annotations

import json
import os
from collections.abc import AsyncIterator
from typing import Any

import httpx

# A small, fast, instruct-tuned model that works reliably on HF Inference Providers.
DEFAULT_MODEL = os.environ.get("HF_MODEL", "meta-llama/Llama-3.1-8B-Instruct")

# HF Inference Providers OpenAI-compatible router.
DEFAULT_BASE_URL = os.environ.get("HF_BASE_URL", "https://router.huggingface.co/v1")


class LLMError(RuntimeError):
    """Raised when the LLM backend returns an error."""


def _client(timeout: float = 60.0) -> httpx.AsyncClient:
    token = os.environ.get("HF_TOKEN", "").strip()
    if not token:
        raise LLMError(
            "HF_TOKEN is not set. Create a free token at "
            "https://huggingface.co/settings/tokens (Read access) and export it."
        )
    return httpx.AsyncClient(
        base_url=DEFAULT_BASE_URL,
        timeout=timeout,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
    )


async def chat(
    messages: list[dict[str, str]],
    *,
    model: str | None = None,
    temperature: float = 0.8,
    max_tokens: int = 512,
) -> str:
    """Send a single chat-completion request and return the assistant text."""
    model = model or DEFAULT_MODEL
    payload: dict[str, Any] = {
        "model": model,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "stream": False,
    }
    async with _client() as c:
        resp = await c.post("/chat/completions", json=payload)
    if resp.status_code >= 400:
        raise LLMError(
            f"HF inference error {resp.status_code}: {resp.text[:500]}"
        )
    data = resp.json()
    try:
        return data["choices"][0]["message"]["content"].strip()
    except (KeyError, IndexError, TypeError) as e:
        raise LLMError(f"Unexpected HF response shape: {data!r}") from e


async def chat_stream(
    messages: list[dict[str, str]],
    *,
    model: str | None = None,
    temperature: float = 0.8,
    max_tokens: int = 512,
) -> AsyncIterator[str]:
    """Yield chunks of assistant text as they arrive (Server-Sent Events)."""
    model = model or DEFAULT_MODEL
    payload: dict[str, Any] = {
        "model": model,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "stream": True,
    }
    async with _client() as c:
        async with c.stream("POST", "/chat/completions", json=payload) as resp:
            if resp.status_code >= 400:
                body = await resp.aread()
                raise LLMError(
                    f"HF inference error {resp.status_code}: {body[:500]!r}"
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


__all__ = ["chat", "chat_stream", "LLMError", "DEFAULT_MODEL"]
