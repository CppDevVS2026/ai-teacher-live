"""FastAPI server for the live AI teacher.

Endpoints:
    GET  /                 - health/version JSON.
    GET  /api/health       - { ok: true, model, has_token }.
    POST /api/chat         - { messages, student_name?, subject?, temperature? } -> { reply }.
    POST /api/chat/stream  - same body, returns Server-Sent Events with text deltas.
"""

from __future__ import annotations

import asyncio
import logging
import os
from collections.abc import AsyncIterator
from typing import Literal

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from . import __version__
from .llm import LLMError, chat, chat_stream
from .persona import build_system_prompt
from .providers import api_key, current

log = logging.getLogger("ai_teacher_live")

app = FastAPI(title="ai-teacher-live", version=__version__)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


class ChatMessage(BaseModel):
    role: Literal["system", "user", "assistant"]
    content: str


class ChatRequest(BaseModel):
    messages: list[ChatMessage] = Field(default_factory=list)
    student_name: str | None = None
    subject: str | None = None
    temperature: float = 0.8
    max_tokens: int = 512


class ChatResponse(BaseModel):
    reply: str
    model: str


def _build_messages(req: ChatRequest) -> list[dict[str, str]]:
    """Prepend the teacher system prompt, dropping any client-supplied system messages."""
    system_prompt = build_system_prompt(
        student_name=req.student_name or "friend",
        subject=req.subject,
    )
    out: list[dict[str, str]] = [{"role": "system", "content": system_prompt}]
    for m in req.messages:
        if m.role == "system":
            continue
        out.append({"role": m.role, "content": m.content})
    return out


@app.get("/")
async def root() -> dict[str, str]:
    return {
        "name": "ai-teacher-live",
        "version": __version__,
        "docs": "/docs",
    }


@app.get("/api/health")
async def health() -> dict[str, object]:
    p = current()
    return {
        "ok": True,
        "provider": p.name,
        "model": p.default_model,
        "base_url": p.base_url,
        "has_token": bool(api_key(p)),
    }


@app.post("/api/chat", response_model=ChatResponse)
async def api_chat(req: ChatRequest) -> ChatResponse:
    messages = _build_messages(req)
    try:
        reply = await chat(
            messages,
            temperature=req.temperature,
            max_tokens=req.max_tokens,
        )
    except LLMError as e:
        raise HTTPException(status_code=502, detail=str(e)) from e
    return ChatResponse(reply=reply, model=current().default_model)


@app.post("/api/chat/stream")
async def api_chat_stream(req: ChatRequest) -> StreamingResponse:
    messages = _build_messages(req)

    async def gen() -> AsyncIterator[bytes]:
        try:
            async for chunk in chat_stream(
                messages,
                temperature=req.temperature,
                max_tokens=req.max_tokens,
            ):
                # SSE event: "data: <text>\n\n"
                # The text payload is JSON-safe (escape newlines) so the client
                # can reconstruct it without ambiguity.
                payload = chunk.replace("\\", "\\\\").replace("\n", "\\n")
                yield f"data: {payload}\n\n".encode()
                # Let the event loop flush.
                await asyncio.sleep(0)
            yield b"event: done\ndata: [DONE]\n\n"
        except LLMError as e:
            payload = str(e).replace("\n", " ")
            yield f"event: error\ndata: {payload}\n\n".encode()

    return StreamingResponse(gen(), media_type="text/event-stream")


def main() -> None:
    """Console entry point. Run with `ai-teacher-live`."""
    import uvicorn

    host = os.environ.get("HOST", "0.0.0.0")
    port = int(os.environ.get("PORT", "8000"))
    uvicorn.run("ai_teacher_live.server:app", host=host, port=port, reload=False)


if __name__ == "__main__":
    main()
