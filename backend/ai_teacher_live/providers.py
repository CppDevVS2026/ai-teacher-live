"""LLM provider configuration.

The teacher backend is provider-agnostic: any OpenAI-compatible chat-completions
endpoint works. The active provider is chosen at startup, in this order:

  1. The ``LLM_PROVIDER`` environment variable, if set (e.g. "cerebras", "hf",
     "groq", "openrouter", "openai", or "custom").
  2. Otherwise, the first provider whose API key env var is set, in this order:
     cerebras, groq, openrouter, openai, hf.
  3. Otherwise, "hf" — and ``chat()`` will raise a friendly error.

Per-provider overrides:
  ``LLM_BASE_URL``  - override the base URL (handy for self-hosted / custom).
  ``LLM_MODEL``     - override the model id.
  ``LLM_API_KEY``   - override the auth token (otherwise the provider's env var is used).
"""

from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Provider:
    name: str
    base_url: str            # OpenAI-compatible base, ending in /v1
    env_key: str             # env var that holds the API token
    default_model: str
    extra_headers: dict[str, str] | None = None


PROVIDERS: dict[str, Provider] = {
    "cerebras": Provider(
        name="cerebras",
        base_url="https://api.cerebras.ai/v1",
        env_key="CEREBRAS_API_KEY",
        # Llama 3.3 70B is hosted free on Cerebras with very high throughput.
        default_model="llama-3.3-70b",
    ),
    "groq": Provider(
        name="groq",
        base_url="https://api.groq.com/openai/v1",
        env_key="GROQ_API_KEY",
        default_model="llama-3.3-70b-versatile",
    ),
    "openrouter": Provider(
        name="openrouter",
        base_url="https://openrouter.ai/api/v1",
        env_key="OPENROUTER_API_KEY",
        # OpenRouter's free Llama variant; users can pick others via LLM_MODEL.
        default_model="meta-llama/llama-3.1-8b-instruct:free",
        extra_headers={
            "HTTP-Referer": "https://github.com/CppDevVS2026/ai-teacher-live",
            "X-Title": "ai-teacher-live",
        },
    ),
    "openai": Provider(
        name="openai",
        base_url="https://api.openai.com/v1",
        env_key="OPENAI_API_KEY",
        default_model="gpt-4o-mini",
    ),
    "hf": Provider(
        name="hf",
        base_url="https://router.huggingface.co/v1",
        env_key="HF_TOKEN",
        default_model="meta-llama/Llama-3.1-8B-Instruct",
    ),
    "custom": Provider(
        name="custom",
        # Custom must supply LLM_BASE_URL + LLM_API_KEY + LLM_MODEL.
        base_url="",
        env_key="LLM_API_KEY",
        default_model="",
    ),
}

# Order in which we auto-pick a provider when LLM_PROVIDER is not set.
_AUTODETECT_ORDER: tuple[str, ...] = ("cerebras", "groq", "openrouter", "openai", "hf")


def _resolve_name() -> str:
    name = (os.environ.get("LLM_PROVIDER") or "").strip().lower()
    if name:
        if name not in PROVIDERS:
            valid = ", ".join(sorted(PROVIDERS))
            raise RuntimeError(
                f"Unknown LLM_PROVIDER={name!r}. Valid values: {valid}."
            )
        return name
    for candidate in _AUTODETECT_ORDER:
        if os.environ.get(PROVIDERS[candidate].env_key):
            return candidate
    return "hf"  # last resort; will error on first call


def current() -> Provider:
    """Return the active provider, with overrides from LLM_BASE_URL/LLM_MODEL."""
    base = PROVIDERS[_resolve_name()]
    override_url = os.environ.get("LLM_BASE_URL")
    override_model = os.environ.get("LLM_MODEL")
    if base.name == "custom" and not override_url:
        raise RuntimeError(
            "LLM_PROVIDER=custom requires LLM_BASE_URL (and LLM_MODEL)."
        )
    return Provider(
        name=base.name,
        base_url=override_url or base.base_url,
        env_key=base.env_key,
        default_model=override_model or base.default_model,
        extra_headers=base.extra_headers,
    )


def api_key(p: Provider | None = None) -> str | None:
    p = p or current()
    # Honor a generic LLM_API_KEY override.
    return os.environ.get("LLM_API_KEY") or os.environ.get(p.env_key)


__all__ = ["Provider", "PROVIDERS", "current", "api_key"]
