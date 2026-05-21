# ai-teacher-live — Maya, your voice-first AI tutor

A live, human-feeling AI teacher. Tap the mic, talk to her, and she'll teach you
**anything** — math, code, languages, history, music theory, you name it. Built
on the [Hugging Face Inference API](https://huggingface.co/inference-api) for
the language model, and the browser's [Web Speech
API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API) for
real-time speech-to-text and text-to-speech.

> **Persona:** "Maya Chen" — patient, warm, Socratic. Uses analogies from
> everyday life. Never breaks character into "as an AI…". Tuned for *spoken*
> conversation: short sentences, no markdown, no bullets.

## How it works

```
🎤 mic ─▶ Web Speech (STT) ─▶ FastAPI /api/chat/stream ─▶ HF Inference (LLM)
                                                              │
🔊 speaker ◀── Web Speech (TTS) ◀── sentence-chunked stream ◀┘
```

The browser handles voice in and voice out (free, no API key, no audio uploads).
The backend is a thin streaming wrapper around a Hugging Face chat-completions
endpoint, with the teacher system prompt enforced server-side.

## Repo layout

```
ai-teacher-live/
├── backend/
│   ├── pyproject.toml
│   └── ai_teacher_live/
│       ├── server.py     # FastAPI app: /api/health, /api/chat, /api/chat/stream
│       ├── llm.py        # Hugging Face Inference client (streaming + non-streaming)
│       └── persona.py    # Teacher system prompt, tuned for voice output
├── frontend/
│   ├── index.html        # Single-page app
│   ├── styles.css        # Dark, cozy UI
│   └── app.js            # STT + streaming chat + TTS queueing
└── README.md
```

## Run locally

You'll need Python 3.10+, a [free Hugging Face token](https://huggingface.co/settings/tokens)
(Read access), and a Chromium-based browser (Chrome / Edge / Brave) for the
Web Speech API.

```bash
# 1) install + run the backend
cd backend
pip install -e .
export HF_TOKEN="hf_xxx_your_token_here"
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

| Var          | Default                                    | Notes |
|--------------|--------------------------------------------|-------|
| `HF_TOKEN`   | _required_                                 | Read-access token. |
| `HF_MODEL`   | `meta-llama/Llama-3.1-8B-Instruct`         | Any chat-completions-compatible model on HF Inference Providers. |
| `HF_BASE_URL`| `https://router.huggingface.co/v1`         | Override if you want a specific provider. |
| `HOST`       | `0.0.0.0`                                  | uvicorn bind host. |
| `PORT`       | `8000`                                     | uvicorn bind port. |

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
  # Then set HF_TOKEN as a Fly secret:
  flyctl secrets set HF_TOKEN=hf_xxx
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
