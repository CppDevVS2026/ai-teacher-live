/* Maya — your live AI teacher.
 *
 * Voice in (Web Speech API SpeechRecognition)
 *   -> backend /api/chat/stream (Hugging Face)
 *   -> voice out (speechSynthesis), chunked per sentence so it starts speaking fast.
 */

(() => {
  "use strict";

  // ---------- DOM ----------
  const $ = (id) => document.getElementById(id);
  const transcriptEl = $("transcript");
  const statusEl = $("status");
  const micBtn = $("micBtn");
  const stopBtn = $("stopBtn");
  const textInput = $("textInput");
  const settingsBtn = $("settingsBtn");
  const settingsDialog = $("settingsDialog");
  const studentNameIn = $("studentName");
  const subjectIn = $("subject");
  const voiceSelect = $("voiceSelect");
  const backendUrlIn = $("backendUrl");
  const autoListenIn = $("autoListen");
  const saveSettingsBtn = $("saveSettings");
  const modelLabel = $("modelLabel");
  const backendLabel = $("backendLabel");
  const appEl = document.querySelector(".app");

  // ---------- Settings ----------
  const SETTINGS_KEY = "ai-teacher-live:settings:v1";
  const defaultBackend = (() => {
    // Prefer same-origin if served from a real host; otherwise localhost dev default.
    const { protocol, host, hostname } = window.location;
    if (hostname && hostname !== "" && !hostname.endsWith(".devinapps.com")) {
      // If we're on a real domain (not a static preview), assume the backend is co-located.
      return `${protocol}//${host}`;
    }
    return "http://localhost:8000";
  })();

  const settings = Object.assign(
    {
      studentName: "",
      subject: "",
      voiceName: "",
      backendUrl: defaultBackend,
      autoListen: false,
    },
    safeParse(localStorage.getItem(SETTINGS_KEY)) || {}
  );

  function safeParse(s) {
    try { return JSON.parse(s); } catch { return null; }
  }
  function saveSettings() {
    settings.studentName = studentNameIn.value.trim();
    settings.subject = subjectIn.value.trim();
    settings.voiceName = voiceSelect.value;
    settings.backendUrl = (backendUrlIn.value || defaultBackend).trim().replace(/\/+$/, "");
    settings.autoListen = autoListenIn.checked;
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    refreshFooter();
  }
  function loadSettingsIntoForm() {
    studentNameIn.value = settings.studentName || "";
    subjectIn.value = settings.subject || "";
    backendUrlIn.value = settings.backendUrl || defaultBackend;
    autoListenIn.checked = !!settings.autoListen;
    populateVoiceSelect();
  }

  // ---------- Voices ----------
  let voices = [];
  function loadVoices() {
    voices = window.speechSynthesis ? window.speechSynthesis.getVoices() : [];
    if (!voices.length) return;
    populateVoiceSelect();
  }
  function populateVoiceSelect() {
    voiceSelect.innerHTML = "";
    const optDefault = document.createElement("option");
    optDefault.value = "";
    optDefault.textContent = "Auto (best English voice)";
    voiceSelect.appendChild(optDefault);
    voices.forEach((v) => {
      const opt = document.createElement("option");
      opt.value = v.name;
      opt.textContent = `${v.name} — ${v.lang}${v.default ? " (default)" : ""}`;
      voiceSelect.appendChild(opt);
    });
    if (settings.voiceName) voiceSelect.value = settings.voiceName;
  }
  function pickVoice() {
    if (!voices.length) return null;
    if (settings.voiceName) {
      const m = voices.find((v) => v.name === settings.voiceName);
      if (m) return m;
    }
    // Prefer a natural-sounding English female voice if one is present.
    const englishVoices = voices.filter((v) => /^en[-_]/i.test(v.lang));
    const candidates = englishVoices.length ? englishVoices : voices;
    const preferred = [
      /Google US English/i,
      /Microsoft Aria/i,
      /Microsoft Jenny/i,
      /Samantha/i,
      /Karen/i,
      /Serena/i,
      /female/i,
    ];
    for (const re of preferred) {
      const m = candidates.find((v) => re.test(v.name));
      if (m) return m;
    }
    return candidates[0] || voices[0];
  }

  // ---------- Conversation state ----------
  /** @type {{role: "user"|"assistant", content: string}[]} */
  const history = [];
  let interimBubble = null;
  let teacherBubble = null;
  let speaking = false;
  let listening = false;
  let pendingSpeak = "";
  let lastUserActivity = Date.now();

  function refreshFooter() {
    backendLabel.textContent = `backend: ${settings.backendUrl || "(unset)"}`;
  }

  function setStatus(text) {
    statusEl.textContent = text;
  }

  function setSpeaking(on) {
    speaking = on;
    appEl.classList.toggle("speaking", on);
  }

  function setListening(on) {
    listening = on;
    micBtn.setAttribute("aria-pressed", on ? "true" : "false");
  }

  function addBubble(role, text, opts = {}) {
    const b = document.createElement("div");
    b.className = `bubble bubble--${role}${opts.interim ? " bubble--interim" : ""}${opts.error ? " bubble--error" : ""}`;
    const p = document.createElement("p");
    p.textContent = text;
    b.appendChild(p);
    transcriptEl.appendChild(b);
    transcriptEl.scrollTop = transcriptEl.scrollHeight;
    return b;
  }

  function appendToBubble(bubble, text) {
    const p = bubble.querySelector("p");
    p.textContent = (p.textContent || "") + text;
    transcriptEl.scrollTop = transcriptEl.scrollHeight;
  }

  // ---------- Speech synthesis (TTS) ----------
  function cancelSpeech() {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    setSpeaking(false);
  }

  // Speak a single utterance; returns a promise that resolves when done.
  function speakUtterance(text) {
    return new Promise((resolve) => {
      if (!window.speechSynthesis) { resolve(); return; }
      const u = new SpeechSynthesisUtterance(text);
      const voice = pickVoice();
      if (voice) { u.voice = voice; u.lang = voice.lang; }
      u.rate = 1.02;
      u.pitch = 1.05;
      u.onstart = () => setSpeaking(true);
      u.onend = () => { setSpeaking(false); resolve(); };
      u.onerror = () => { setSpeaking(false); resolve(); };
      window.speechSynthesis.speak(u);
    });
  }

  // Queue text for TTS, sentence-by-sentence as it arrives from the stream.
  const sayQueue = [];
  let speakerRunning = false;
  function enqueueSpeech(text) {
    const cleaned = text.trim();
    if (!cleaned) return;
    sayQueue.push(cleaned);
    runSpeaker();
  }
  async function runSpeaker() {
    if (speakerRunning) return;
    speakerRunning = true;
    while (sayQueue.length) {
      const next = sayQueue.shift();
      await speakUtterance(next);
    }
    speakerRunning = false;
  }

  // Pull complete sentences off the pending buffer; the trailing fragment stays.
  const SENTENCE_RE = /[^.!?…\n]+[.!?…]+["')\]]*\s*|[^.!?…\n]+\n+/g;
  function drainSentences(flush = false) {
    if (flush) {
      const remaining = pendingSpeak.trim();
      if (remaining) enqueueSpeech(remaining);
      pendingSpeak = "";
      return;
    }
    const matches = pendingSpeak.match(SENTENCE_RE);
    if (!matches) return;
    const consumed = matches.join("");
    pendingSpeak = pendingSpeak.slice(consumed.length);
    matches.forEach(enqueueSpeech);
  }

  // ---------- Backend call ----------
  function endpoint(path) {
    const base = settings.backendUrl || defaultBackend;
    return base.replace(/\/+$/, "") + path;
  }

  async function fetchHealth() {
    try {
      const r = await fetch(endpoint("/api/health"), { method: "GET" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      const tokenWarn = j.has_token ? "" : " (no api key!)";
      const provider = j.provider ? `${j.provider}: ` : "";
      modelLabel.textContent = `model: ${provider}${j.model || "?"}${tokenWarn}`;
    } catch (e) {
      modelLabel.textContent = `model: (backend unreachable)`;
    }
  }

  async function askTeacher(userText) {
    history.push({ role: "user", content: userText });
    teacherBubble = addBubble("teacher", "");
    setStatus("thinking…");
    pendingSpeak = "";

    let fullReply = "";
    try {
      const resp = await fetch(endpoint("/api/chat/stream"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: history,
          student_name: settings.studentName || undefined,
          subject: settings.subject || undefined,
        }),
      });
      if (!resp.ok || !resp.body) {
        const text = await resp.text().catch(() => `HTTP ${resp.status}`);
        throw new Error(text || `HTTP ${resp.status}`);
      }
      setStatus("speaking…");
      const reader = resp.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let buf = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf("\n\n")) !== -1) {
          const event = buf.slice(0, nl);
          buf = buf.slice(nl + 2);
          handleSSE(event);
        }
      }
      // Flush any trailing event.
      if (buf.trim()) handleSSE(buf);
    } catch (e) {
      addBubble("teacher", `Maya couldn't reach the backend: ${e.message}`, { error: true });
      setStatus("offline — check Backend URL in settings");
      return;
    }

    // Flush remaining text to TTS.
    drainSentences(true);
    history.push({ role: "assistant", content: fullReply.trim() });

    // Wait until TTS finishes before auto-listening.
    await waitForSpeechToFinish();
    setStatus(settings.autoListen ? "your turn — listening…" : "tap the mic for your next question");
    if (settings.autoListen) {
      startListening();
    }

    function handleSSE(raw) {
      const lines = raw.split("\n");
      let eventName = "message";
      let dataLines = [];
      for (const line of lines) {
        if (line.startsWith("event:")) eventName = line.slice(6).trim();
        else if (line.startsWith("data:")) dataLines.push(line.slice(5).replace(/^\s/, ""));
      }
      const data = dataLines.join("\n");
      if (eventName === "done") return;
      if (eventName === "error") {
        addBubble("teacher", `(backend error) ${data}`, { error: true });
        setStatus("error — see settings");
        return;
      }
      // Decode the escape we did server-side: backslash-n -> newline, backslash-backslash -> backslash.
      const chunk = data.replace(/\\n/g, "\n").replace(/\\\\/g, "\\");
      if (!chunk) return;
      fullReply += chunk;
      appendToBubble(teacherBubble, chunk);
      pendingSpeak += chunk;
      drainSentences(false);
    }
  }

  function waitForSpeechToFinish() {
    return new Promise((resolve) => {
      const tick = () => {
        if (!speaking && !sayQueue.length && !speakerRunning) resolve();
        else setTimeout(tick, 120);
      };
      tick();
    });
  }

  // ---------- Speech recognition (STT) ----------
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let recognition = null;
  let recognizing = false;
  let interimText = "";

  function initRecognition() {
    if (!SR) return null;
    const r = new SR();
    r.lang = "en-US";
    r.continuous = false;
    r.interimResults = true;
    r.maxAlternatives = 1;
    r.onstart = () => {
      recognizing = true;
      setListening(true);
      interimText = "";
      interimBubble = addBubble("student", "…", { interim: true });
      setStatus("listening…");
    };
    r.onresult = (ev) => {
      let interim = "";
      let finalText = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const res = ev.results[i];
        if (res.isFinal) finalText += res[0].transcript;
        else interim += res[0].transcript;
      }
      interimText = (finalText || interim).trim();
      if (interimBubble) {
        const p = interimBubble.querySelector("p");
        p.textContent = interimText || "…";
      }
      lastUserActivity = Date.now();
    };
    r.onerror = (ev) => {
      recognizing = false;
      setListening(false);
      if (interimBubble) interimBubble.remove();
      interimBubble = null;
      if (ev.error === "not-allowed" || ev.error === "service-not-allowed") {
        addBubble("teacher", "I can't hear you — please allow microphone access in your browser.", { error: true });
        setStatus("mic blocked — allow microphone access in your browser");
      } else if (ev.error === "no-speech") {
        setStatus("didn't catch that — tap the mic to try again");
      } else {
        setStatus(`mic error: ${ev.error}`);
      }
    };
    r.onend = () => {
      recognizing = false;
      setListening(false);
      const said = interimText.trim();
      if (interimBubble) interimBubble.remove();
      interimBubble = null;
      if (said) {
        addBubble("student", said);
        askTeacher(said);
      } else {
        setStatus("tap the mic and ask me anything");
      }
    };
    return r;
  }

  function startListening() {
    if (!SR) {
      addBubble(
        "teacher",
        "Your browser doesn't support speech recognition. Chrome on desktop works best. You can still type below.",
        { error: true }
      );
      return;
    }
    cancelSpeech();
    if (!recognition) recognition = initRecognition();
    if (recognizing) return;
    try {
      recognition.start();
    } catch (e) {
      // start() throws if it's already started — ignore.
    }
  }

  function stopListening() {
    if (recognition && recognizing) {
      try { recognition.stop(); } catch {}
    }
  }

  function toggleListening() {
    if (recognizing) stopListening();
    else startListening();
  }

  // ---------- Wire up UI ----------
  micBtn.addEventListener("click", toggleListening);
  stopBtn.addEventListener("click", () => {
    stopListening();
    cancelSpeech();
    sayQueue.length = 0;
    setStatus("stopped — tap the mic when you're ready");
  });
  textInput.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" && textInput.value.trim()) {
      const t = textInput.value.trim();
      textInput.value = "";
      addBubble("student", t);
      askTeacher(t);
    }
  });
  settingsBtn.addEventListener("click", () => {
    loadSettingsIntoForm();
    settingsDialog.showModal();
  });
  saveSettingsBtn.addEventListener("click", (e) => {
    saveSettings();
    fetchHealth();
  });

  // Cancel button just closes the dialog (form method="dialog" handles it).

  // Pre-warm voice list (Chrome loads voices asynchronously).
  if (window.speechSynthesis) {
    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;
  } else {
    voiceSelect.innerHTML = '<option value="">(no TTS in this browser)</option>';
  }

  refreshFooter();
  fetchHealth();
  // Surface a hint for browsers without SpeechRecognition.
  if (!SR) {
    setStatus("voice input not supported in this browser — try Chrome desktop");
  }
})();
