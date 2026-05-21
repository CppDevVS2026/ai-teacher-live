---
name: testing-ai-teacher-live
description: Test the ai-teacher-live app end-to-end with a mock LLM. Use when verifying frontend/backend changes to the Maya AI teacher.
---

# Testing ai-teacher-live

## Prerequisites

- Backend installed: `pip install -e backend/`
- `ruff` installed for linting: `pip install ruff`

## Devin Secrets Needed

None required for testing — a local mock LLM server replaces the real LLM provider.

For live integration testing (optional), one of:
- `CEREBRAS_API_KEY` (default, free tier)
- `HF_TOKEN`
- `GROQ_API_KEY`
- `OPENROUTER_API_KEY`
- `OPENAI_API_KEY`

## Architecture

- **Frontend**: Static SPA in `frontend/` (index.html, app.js, styles.css). Serve with any static server on port 5173.
- **Backend**: FastAPI in `backend/ai_teacher_live/`. Runs on port 8000. Talks to any OpenAI-compatible LLM endpoint.
- **Provider config**: Set via env vars. `LLM_PROVIDER=custom` + `LLM_BASE_URL` + `LLM_API_KEY` + `LLM_MODEL` for custom endpoints.

## Mock LLM Setup

Create a mock OpenAI-compatible server (FastAPI on port 9999) that:
- Implements `POST /v1/chat/completions` (streaming and non-streaming)
- Supports trigger keywords in message content for testing specific paths:
  - `TRIGGER_ERROR` → returns HTTP 500 (tests error handling)
  - `TRIGGER_CR_ERROR` → returns HTTP 500 with `\r\n` in body (tests SSE framing)
  - `SLOW_STREAM` → streams with 1.5s delay per word (tests AbortController/Stop button)
  - Default → streams a short reply word-by-word (tests happy path)

Example mock server: see `/home/ubuntu/mock_llm.py` pattern (FastAPI + StreamingResponse).

## Starting Services

```bash
# 1. Mock LLM (port 9999)
python mock_llm.py  # run in background shell

# 2. Backend (port 8000) — pointing to mock
LLM_PROVIDER=custom LLM_BASE_URL=http://localhost:9999/v1 LLM_API_KEY=fake-key LLM_MODEL=mock-model ai-teacher-live

# 3. Frontend (port 5173)
cd frontend && python -m http.server 5173
```

Verify: `curl http://localhost:8000/api/health` should show `has_token: true` and `provider: custom`.

## Key Test Scenarios

### 1. defaultBackend URL
- Open `http://localhost:5173` in browser
- Footer should show `backend: http://localhost:8000` (NOT `:5173`)
- The fix is in `frontend/app.js` — `defaultBackend` excludes `localhost` and `127.0.0.1` from same-origin detection

### 2. Normal Chat Streaming
- Type a message and press Enter
- Teacher bubble should populate with streamed reply
- Status bar should transition: "thinking..." → "speaking..." → "tap the mic for your next question"

### 3. AbortController (Stop Button)
- Send a message containing `SLOW_STREAM` (triggers 1.5s/word delay)
- Wait for partial text to appear in teacher bubble
- Click the Stop button (square icon)
- Stream should stop mid-reply; status shows "stopped — tap the mic when you're ready"
- Note: Be careful with typing — ensure the trigger keyword is spelled correctly

### 4. Error Handling
- Send message containing `TRIGGER_ERROR` → error bubble should show clean decoded text, no `b'...'` bytes prefix
- Send message containing `TRIGGER_CR_ERROR` → SSE error event should be received intact despite `\r` in body

### 5. History Cap
- Verify deployed `app.js` contains `history.slice(-20)` (not unbounded `messages: history,`)
- Can verify via browser console: `fetch('/app.js').then(r=>r.text()).then(s=>console.log(s.includes('history.slice(-20)')))`
- For full runtime verification, send 11+ messages and check POST body via fetch interceptor

### 6. smoke_test.py Provider Name
- Restart backend WITHOUT `LLM_API_KEY` to test skip path
- Run `python backend/smoke_test.py`
- Output should show actual provider name (e.g. `'custom'`), not hardcoded "HF_TOKEN"

## Linting

```bash
ruff check backend/ai_teacher_live/
```

Note: `backend/smoke_test.py` may have a pre-existing I001 (import ordering) lint issue on `main` — this is outside scope of most PRs.

## Tips

- The app uses Web Speech API for TTS — this may cause audio playback during testing. Click Stop to silence.
- The `autocomplete="off"` on the text input might still trigger browser suggestions. Use the browser console to set input values if typing issues occur.
- For testing the history cap with >20 messages, a programmatic approach via console is faster than manual UI input.
- No CI is configured on this repo — linting is the primary code quality check.
