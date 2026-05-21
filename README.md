# ai-teacher-live — Maya, your voice-first AI tutor

A live, human-feeling AI teacher. Tap the mic, talk to her, and she'll teach you
**anything** — math, code, languages, history, music theory, you name it.
Voice in and voice out happen in the browser via the [Web Speech
API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API) (free,
no API key, no audio uploads). The language model is provider-agnostic:
any OpenAI-compatible chat-completions endpoint works
— **Cerebras (default, free + very fast Llama 3.3 70B)**, Hugging Face, Groq,
OpenRouter, OpenAI, or your own custom endpoint.

> **Persona:** "Maya Chen" — patient, warm, Socratic. Uses analogies from
> everyday life. Never breaks character into "as an AI…". Tuned for *spoken*
> conversation: short sentences, no markdown, no bullets.

## How it works

```
🎤 mic ─▶ Web Speech (STT) ─▶ FastAPI /api/chat/stream ─▶ LLM provider
                                                              │
🔊 speaker ◀── Web Speech (TTS) ◀── sentence-chunked stream ◀┘
```

The browser handles voice in and voice out (free, no API key, no audio uploads).
The backend is a thin streaming wrapper around an OpenAI-compatible chat
completions endpoint, with the teacher system prompt enforced server-side.

## Repo layout

```
ai-teacher-live/
├── backend/
│   ├── pyproject.toml
│   └── ai_teacher_live/
│       ├── server.py     # FastAPI app: /api/health, /api/chat, /api/chat/stream
│       ├── llm.py        # OpenAI-compatible chat client (streaming + non-streaming)
│       ├── providers.py  # Provider registry (Cerebras, HF, Groq, OpenRouter, OpenAI, custom)
│       └── persona.py    # Teacher system prompt, tuned for voice output
├── frontend/
│   ├── index.html        # Single-page app
│   ├── styles.css        # Dark, cozy UI
│   └── app.js            # STT + streaming chat + TTS queueing
└── README.md
```

## Run locally

You'll need Python 3.10+, an API key from one of the supported providers, and a
Chromium-based browser (Chrome / Edge / Brave) for the Web Speech API.

```bash
# 1) install + run the backend
cd backend
pip install -e .

# Pick ONE provider — Cerebras is the recommended free option.
export CEREBRAS_API_KEY="cb_xxx_your_key"   # https://cloud.cerebras.ai
# (or HF_TOKEN / GROQ_API_KEY / OPENROUTER_API_KEY / OPENAI_API_KEY)

ai-teacher-live   # listens on http://localhost:8000

# 2) serve the frontend (any static server works)
cd ../frontend
python -m http.server 5173
# open http://localhost:5173
```

Open the gear icon in the top-right of the app, set **Backend URL** to
`http://localhost:8000`, save, and tap the mic.

## Configuration

Environment variables for the backend:

| Var                 | Default                | Notes |
|---------------------|------------------------|-------|
| `LLM_PROVIDER`      | auto-detect            | One of `cerebras`, `groq`, `openrouter`, `openai`, `hf`, `custom`. |
| `CEREBRAS_API_KEY`  | _required for cerebras_| Cerebras Cloud key (https://cloud.cerebras.ai). |
| `GROQ_API_KEY`      | _required for groq_    | Groq Cloud key (https://console.groq.com). |
| `OPENROUTER_API_KEY`| _required for openrouter_ | OpenRouter key (https://openrouter.ai). |
| `OPENAI_API_KEY`    | _required for openai_  | OpenAI key. |
| `HF_TOKEN`          | _required for hf_      | Hugging Face Read token. |
| `LLM_MODEL`         | provider default       | Override the model id. |
| `LLM_BASE_URL`      | provider default       | Override the OpenAI-compatible base URL. |
| `LLM_API_KEY`       | (uses provider's key)  | Generic override for the auth token. |
| `HOST`              | `0.0.0.0`              | uvicorn bind host. |
| `PORT`              | `8000`                 | uvicorn bind port. |

**Auto-detect order:** if `LLM_PROVIDER` is unset, the server picks the first
provider whose API key env var is present, in this order: `cerebras`, `groq`,
`openrouter`, `openai`, `hf`.

**Default models (good starting points):**

| Provider     | Default model                              |
|--------------|--------------------------------------------|
| `cerebras`   | `llama-3.3-70b`                            |
| `groq`       | `llama-3.3-70b-versatile`                  |
| `openrouter` | `meta-llama/llama-3.1-8b-instruct:free`    |
| `openai`     | `gpt-4o-mini`                              |
| `hf`         | `meta-llama/Llama-3.1-8B-Instruct`         |

Frontend settings (saved to `localStorage`):

- **Your name** — Maya will call you by it.
- **Topic focus** — optional subject hint passed to the system prompt.
- **Voice** — pick any of your browser's installed TTS voices.
- **Backend URL** — point the app at your local or deployed backend.
- **Auto-listen after Maya speaks** — turn the whole thing into a back-and-forth conversation.

## Deploy

- **Backend (Fly.io):**
  ```bash
  # From the repo root, with the Devin deploy tool:
  #   deploy({ command: "backend", dir: "/path/to/ai-teacher-live/backend" })
  # Then set your provider key as a Fly secret, e.g.:
  flyctl secrets set CEREBRAS_API_KEY=cb_xxx
  ```
- **Frontend (any static host):** the `frontend/` directory is fully static — drop it on devinapps, Cloudflare Pages, Netlify, Vercel, GitHub Pages, etc.

## Why is the response a stream?

`/api/chat/stream` returns Server-Sent Events. The frontend splits the incoming
text into sentences and hands each completed sentence to `speechSynthesis` —
so Maya **starts speaking within ~1 sentence** of generation rather than
waiting for the whole reply.

## Browser support

| Feature                | Chrome | Edge | Safari | Firefox |
|------------------------|:------:|:----:|:------:|:-------:|
| SpeechRecognition (STT)|   ✓    |  ✓   |   ✓†   |    ✗    |
| speechSynthesis  (TTS) |   ✓    |  ✓   |   ✓    |    ✓    |

† Safari supports SpeechRecognition but with quirks. Chrome on desktop is the
smoothest experience. If your browser has no SpeechRecognition, you can still
type questions in the text box at the bottom.

## License

MIT.
