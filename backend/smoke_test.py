"""Quick end-to-end smoke test for the local backend.

Run with HF_TOKEN set and the server running on http://localhost:8000:

    HF_TOKEN=hf_xxx ai-teacher-live &
    python smoke_test.py
"""

from __future__ import annotations

import os
import sys
import urllib.error
import urllib.request
import json


BASE = os.environ.get("BACKEND_URL", "http://localhost:8000").rstrip("/")


def get(path: str) -> dict:
    with urllib.request.urlopen(f"{BASE}{path}", timeout=15) as r:
        return json.loads(r.read().decode())


def post(path: str, body: dict) -> dict:
    data = json.dumps(body).encode()
    req = urllib.request.Request(
        f"{BASE}{path}",
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        return {"_status": e.code, "_body": e.read().decode()[:500]}


def main() -> int:
    print(f"[smoke] backend = {BASE}")
    health = get("/api/health")
    print(f"[smoke] /api/health -> {health}")
    if not health.get("has_token"):
        provider = health.get("provider", "unknown")
        print(f"[smoke] No API key for provider {provider!r}; skipping live chat call.")
        return 0

    print("[smoke] POST /api/chat ...")
    reply = post(
        "/api/chat",
        {
            "messages": [{"role": "user", "content": "In one short sentence, what is recursion?"}],
            "student_name": "Alex",
            "subject": "computer science",
            "max_tokens": 80,
        },
    )
    print(f"[smoke] reply = {reply}")
    if reply.get("_status"):
        print(f"[smoke] FAILED with status {reply['_status']}")
        return 1
    text = (reply.get("reply") or "").strip()
    if not text:
        print("[smoke] FAILED: empty reply")
        return 1
    print(f"[smoke] OK ({len(text)} chars): {text[:200]!r}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
