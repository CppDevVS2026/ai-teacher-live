/* Maya — your live AI teacher.
 *
 * Voice in (Web Speech API SpeechRecognition)
 *   -> backend /api/chat/stream (any OpenAI-compatible LLM)
 *   -> voice out (speechSynthesis), chunked per sentence so it starts speaking fast.
 *
 * On top of the voice loop we run a learning game:
 *   - XP / level / streak (header + Progress tab)
 *   - Per-subject mastery bars (auto-detected from the question)
 *   - Badges for milestones
 *   - Persona switching (Maya / Professor Chen / Coach Vega)
 *   - Quick-start topic chips and ELI5/Deeper/Example/Quiz modifier chips
 *   - Replay button on each teacher bubble
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
  const speechRateIn = $("speechRate");
  const speechRateLabel = $("speechRateLabel");
  const backendUrlIn = $("backendUrl");
  const autoListenIn = $("autoListen");
  const saveSettingsBtn = $("saveSettings");
  const modelLabel = $("modelLabel");
  const backendLabel = $("backendLabel");
  const appEl = document.querySelector(".app");

  const avatarEmojiEl = $("avatarEmoji");
  const teacherNameEl = $("teacherName");
  const levelNumEl = $("levelNum");
  const levelTitleEl = $("levelTitle");
  const levelFillEl = $("levelFill");
  const levelXpEl = $("levelXp");
  const streakCountEl = $("streakCount");

  const introTextEl = $("introText");
  const personaGridEl = $("personaGrid");
  const masteryListEl = $("masteryList");
  const badgesListEl = $("badgesList");
  const badgeCountEl = $("badgeCount");
  const toastStackEl = $("toastStack");
  const quickstartEl = $("quickstart");
  const modifiersEl = $("modifiers");

  const progressLevelNumEl = $("progressLevelNum");
  const progressLevelTitleEl = $("progressLevelTitle");
  const progressXpTotalEl = $("progressXpTotal");
  const progressStreakNumEl = $("progressStreakNum");
  const progressQuestionsNumEl = $("progressQuestionsNum");
  const resetProgressBtn = $("resetProgress");

  // ---------- Settings ----------
  const SETTINGS_KEY = "ai-teacher-live:settings:v2";
  const PROGRESS_KEY = "ai-teacher-live:progress:v1";
  const defaultBackend = (() => {
    // Prefer same-origin if served from a real host; otherwise localhost dev default.
    const { protocol, host, hostname } = window.location;
    if (hostname && hostname !== "" && !hostname.endsWith(".devinapps.com")) {
      return `${protocol}//${host}`;
    }
    return "http://localhost:8000";
  })();

  const settings = Object.assign(
    {
      studentName: "",
      subject: "",
      voiceName: "",
      speechRate: 1.0,
      backendUrl: defaultBackend,
      autoListen: false,
      persona: "maya",
    },
    safeParse(localStorage.getItem(SETTINGS_KEY)) ||
      // soft-migrate from v1 if present
      safeParse(localStorage.getItem("ai-teacher-live:settings:v1")) ||
      {}
  );

  function safeParse(s) {
    try { return JSON.parse(s); } catch { return null; }
  }

  function saveSettings() {
    settings.studentName = studentNameIn.value.trim();
    settings.subject = subjectIn.value.trim();
    settings.voiceName = voiceSelect.value;
    settings.speechRate = Number(speechRateIn.value) || 1.0;
    settings.backendUrl = (backendUrlIn.value || defaultBackend).trim().replace(/\/+$/, "");
    settings.autoListen = autoListenIn.checked;
    // selected persona is committed by clicking a persona card; nothing to read here.
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    refreshFooter();
    applyPersonaToUI();
  }

  function loadSettingsIntoForm() {
    studentNameIn.value = settings.studentName || "";
    subjectIn.value = settings.subject || "";
    speechRateIn.value = String(settings.speechRate || 1.0);
    speechRateLabel.textContent = (settings.speechRate || 1.0).toFixed(2);
    backendUrlIn.value = settings.backendUrl || defaultBackend;
    autoListenIn.checked = !!settings.autoListen;
    populateVoiceSelect();
    renderPersonaGrid();
    renderProgressTab();
  }

  // ---------- Personas ----------
  /** @type {{key: string, name: string, full_name: string, avatar: string, tagline: string}[]} */
  let personas = [];
  // Fallback so the UI still works if /api/personas isn't reachable.
  const DEFAULT_PERSONAS = [
    { key: "maya",  name: "Maya",            full_name: "Maya Chen",          avatar: "👩‍🏫",   tagline: "Warm, patient, Socratic." },
    { key: "chen",  name: "Professor Chen",  full_name: "Prof. David Chen",   avatar: "👨‍🏫",   tagline: "Formal, precise, first-principles." },
    { key: "vega",  name: "Coach Vega",      full_name: "Coach Maria Vega",   avatar: "🏋️‍♀️", tagline: "High-energy, no-nonsense, reps over theory." },
  ];

  async function loadPersonas() {
    try {
      const r = await fetch(endpoint("/api/personas"));
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      if (Array.isArray(j.personas) && j.personas.length) {
        personas = j.personas;
        return;
      }
    } catch {}
    personas = DEFAULT_PERSONAS.slice();
  }

  function currentPersona() {
    return (
      personas.find((p) => p.key === settings.persona) ||
      personas.find((p) => p.key === "maya") ||
      DEFAULT_PERSONAS[0]
    );
  }

  function applyPersonaToUI() {
    const p = currentPersona();
    avatarEmojiEl.textContent = p.avatar;
    teacherNameEl.textContent = p.name;
    // Intro text adapts to the persona so it matches their vibe.
    if (introTextEl) introTextEl.textContent = introForPersona(p);
    document.title = `${p.name} — your live AI teacher`;
  }

  function introForPersona(p) {
    switch (p.key) {
      case "chen":
        return "Welcome. I'm Professor Chen. Consider me your office hours — we'll build up ideas from first principles, slowly and precisely. What are we studying today?";
      case "vega":
        return "Eyes up, rookie. I'm Coach Vega. We're gonna stack reps until this thing clicks. Pick a topic and let's lock in.";
      case "maya":
      default:
        return "Hey, I'm Maya. I'll teach you basically anything — math, code, languages, history, you name it. Tap the mic and ask me a question, or pick a topic and we'll dive in. What's on your mind?";
    }
  }

  function renderPersonaGrid() {
    if (!personaGridEl) return;
    personaGridEl.innerHTML = "";
    personas.forEach((p) => {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "persona-card" + (p.key === settings.persona ? " persona-card--active" : "");
      card.dataset.persona = p.key;
      card.innerHTML = `
        <div class="persona-card__avatar">${p.avatar}</div>
        <div class="persona-card__name">${p.name}</div>
        <div class="persona-card__tag muted">${p.tagline || ""}</div>
      `;
      card.addEventListener("click", () => {
        settings.persona = p.key;
        renderPersonaGrid();
        applyPersonaToUI();
      });
      personaGridEl.appendChild(card);
    });
  }

  // ---------- Leveling ----------
  // (lvl, xp threshold to reach it, title)
  const LEVELS = [
    { lvl: 1,  xp: 0,    title: "Curious Cat" },
    { lvl: 2,  xp: 50,   title: "Sprout" },
    { lvl: 3,  xp: 150,  title: "Apprentice" },
    { lvl: 4,  xp: 350,  title: "Pupil" },
    { lvl: 5,  xp: 700,  title: "Scholar" },
    { lvl: 6,  xp: 1200, title: "Adept" },
    { lvl: 7,  xp: 2000, title: "Mentor" },
    { lvl: 8,  xp: 3500, title: "Sage" },
    { lvl: 9,  xp: 5000, title: "Polymath" },
    { lvl: 10, xp: 10000, title: "Luminary" },
  ];

  function levelStateFor(xp) {
    let current = LEVELS[0];
    let next = LEVELS[LEVELS.length - 1];
    for (let i = 0; i < LEVELS.length; i++) {
      if (LEVELS[i].xp <= xp) current = LEVELS[i];
      if (LEVELS[i].xp > xp) { next = LEVELS[i]; break; }
    }
    const into = xp - current.xp;
    const span = Math.max(1, next.xp - current.xp);
    const pct = current.lvl === LEVELS[LEVELS.length - 1].lvl
      ? 1.0
      : Math.max(0, Math.min(1, into / span));
    return { lvl: current.lvl, title: current.title, into, span, pct, nextXp: next.xp };
  }

  // ---------- Subject detection ----------
  const SUBJECT_KEYWORDS = {
    math: [
      "math","algebra","calculus","geometry","trig","trigonometry","equation","integral","derivative",
      "matrix","matrices","vector","probability","statistics","limit","number theory","linear","logarithm",
    ],
    code: [
      "code","coding","program","programming","python","javascript","typescript","java ","rust","c++","golang",
      "function","variable","recursion","algorithm","data structure","array","linked list","tree","graph",
      "database","sql","api","react","html","css","compile","debug","regex","async","thread","memory",
    ],
    languages: [
      "spanish","french","german","italian","portuguese","mandarin","chinese","japanese","korean","arabic",
      "russian","grammar","verb","tense","pronunciation","conjugat","vocabulary","translate","translation",
    ],
    history: [
      "history","ancient","medieval","renaissance","revolution","empire","war","battle","civilization","dynasty",
      "rome","roman","greece","greek","egypt","civil war","wwii","ww2","wwi","ww1","cold war","colonial",
    ],
    science: [
      "physics","chemistry","biology","quantum","atom","molecule","cell","evolution","genetics","dna","rna",
      "ecology","ecosystem","gravity","relativity","newton","einstein","periodic","reaction","photosynthesis",
    ],
    art: [
      "art","painting","drawing","sculpture","color theory","composition","perspective","watercolor","oil paint",
      "renaissance art","impressionism","abstract","picasso","van gogh","monet","line art","shading",
    ],
    music: [
      "music","scale","chord","melody","rhythm","tempo","key signature","harmony","piano","guitar","violin",
      "composition","beat","arpeggio","jazz","classical music","music theory","note","octave",
    ],
    philosophy: [
      "philosophy","ethics","metaphysics","epistemology","logic","plato","aristotle","kant","nietzsche",
      "stoic","existential","meaning of life","consciousness","free will",
    ],
    business: [
      "business","economics","marketing","finance","accounting","startup","supply","demand","inflation","stock",
      "bond","macro","micro","profit","revenue","strategy",
    ],
  };

  const SUBJECT_LABELS = {
    math: "🧮 Math",
    code: "💻 Code",
    languages: "🌍 Languages",
    history: "🏛️ History",
    science: "🧪 Science",
    art: "🎨 Art",
    music: "🎵 Music",
    philosophy: "🧠 Philosophy",
    business: "📈 Business",
    general: "📚 General",
  };

  function detectSubject(text) {
    const t = (text || "").toLowerCase();
    let best = null;
    let bestScore = 0;
    for (const [key, words] of Object.entries(SUBJECT_KEYWORDS)) {
      let score = 0;
      for (const w of words) {
        if (t.includes(w)) score += w.length > 5 ? 2 : 1;
      }
      if (score > bestScore) { best = key; bestScore = score; }
    }
    return best || "general";
  }

  // ---------- Badges ----------
  const BADGES = [
    { id: "first_q",        emoji: "🌱", title: "First question",        desc: "Asked your first question." },
    { id: "ten_q",          emoji: "📚", title: "Bookworm",              desc: "Asked 10 questions." },
    { id: "hundred_q",      emoji: "🧠", title: "Hundo",                 desc: "Asked 100 questions." },
    { id: "streak_3",       emoji: "🔥", title: "On a roll",             desc: "3-day learning streak." },
    { id: "streak_7",       emoji: "🔥🔥", title: "Hot streak",          desc: "7-day learning streak." },
    { id: "streak_30",      emoji: "🔥🔥🔥", title: "Unstoppable",       desc: "30-day learning streak." },
    { id: "level_5",        emoji: "🎓", title: "Scholar",               desc: "Reached level 5." },
    { id: "level_10",       emoji: "🏆", title: "Luminary",              desc: "Reached level 10." },
    { id: "subject_master", emoji: "🏅", title: "Subject master",        desc: "Earned 500 XP in one subject." },
    { id: "polyglot",       emoji: "🌐", title: "Polyglot",              desc: "Asked about 5 different subjects." },
    { id: "persona_switch", emoji: "🎭", title: "Cast crew",             desc: "Tried a non-default teacher." },
    { id: "deep_dive",      emoji: "🔬", title: "Deep diver",            desc: "Used the Go deeper modifier." },
    { id: "eli5_used",      emoji: "🍼", title: "Beginner's mind",       desc: "Used the ELI5 modifier." },
    { id: "quiz_taker",     emoji: "🎯", title: "Quiz taker",            desc: "Asked Maya to quiz you." },
    { id: "replay_used",    emoji: "🔁", title: "Re-listener",           desc: "Replayed a reply." },
  ];
  const BADGE_BY_ID = Object.fromEntries(BADGES.map((b) => [b.id, b]));

  // ---------- Progress ----------
  const progress = Object.assign(
    {
      xp: 0,
      streak: 0,
      lastDate: "",           // YYYY-MM-DD of last question
      questionsAsked: 0,
      subjects: {},           // { math: 120, code: 30, ... }
      badges: [],             // ["first_q", ...]
    },
    safeParse(localStorage.getItem(PROGRESS_KEY)) || {}
  );

  function saveProgress() {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress));
  }

  function todayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  }

  function tickStreak(onQuestion = false) {
    const today = todayStr();
    if (!progress.lastDate) {
      if (onQuestion) {
        progress.streak = 1;
        progress.lastDate = today;
      }
    } else if (progress.lastDate === today) {
      // already counted today
    } else {
      // compare dates
      const last = new Date(progress.lastDate);
      const cur = new Date(today);
      const diff = Math.round((cur - last) / 86400000);
      if (diff === 1) {
        if (onQuestion) {
          progress.streak += 1;
          progress.lastDate = today;
        }
      } else if (diff > 1) {
        // streak broken; only reset to 1 when a new question fires
        if (onQuestion) {
          progress.streak = 1;
          progress.lastDate = today;
        } else {
          // visually show 0 until they ask again
          progress.streak = 0;
        }
      }
    }
    if (progress.streak >= 3) maybeAwardBadge("streak_3");
    if (progress.streak >= 7) maybeAwardBadge("streak_7");
    if (progress.streak >= 30) maybeAwardBadge("streak_30");
  }

  function gainXp(n, subject = null) {
    const before = levelStateFor(progress.xp).lvl;
    progress.xp += n;
    if (subject) {
      progress.subjects[subject] = (progress.subjects[subject] || 0) + n;
      if (progress.subjects[subject] >= 500) maybeAwardBadge("subject_master");
      if (Object.keys(progress.subjects).length >= 5) maybeAwardBadge("polyglot");
    }
    saveProgress();
    renderHeader();
    const after = levelStateFor(progress.xp).lvl;
    if (after > before) {
      const st = levelStateFor(progress.xp);
      showToast(`Level up! Lvl ${st.lvl} — ${st.title} 🎉`, "level");
    }
    if (after >= 5) maybeAwardBadge("level_5");
    if (after >= 10) maybeAwardBadge("level_10");
  }

  function maybeAwardBadge(id) {
    if (progress.badges.includes(id)) return;
    const b = BADGE_BY_ID[id];
    if (!b) return;
    progress.badges.push(id);
    saveProgress();
    showToast(`${b.emoji} Badge unlocked — ${b.title}`, "badge");
    renderProgressTab();
  }

  // ---------- Header / progress rendering ----------
  function renderHeader() {
    const st = levelStateFor(progress.xp);
    levelNumEl.textContent = String(st.lvl);
    levelTitleEl.textContent = st.title;
    levelFillEl.style.width = (st.pct * 100).toFixed(1) + "%";
    if (st.lvl >= LEVELS[LEVELS.length - 1].lvl) {
      levelXpEl.textContent = `${progress.xp} XP · max level`;
    } else {
      levelXpEl.textContent = `${progress.xp} / ${st.nextXp} XP`;
    }
    streakCountEl.textContent = String(progress.streak);
    const streakBadge = $("streakBadge");
    streakBadge.classList.toggle("streak--dim", progress.streak <= 0);
  }

  function renderProgressTab() {
    const st = levelStateFor(progress.xp);
    if (progressLevelNumEl) progressLevelNumEl.textContent = String(st.lvl);
    if (progressLevelTitleEl) progressLevelTitleEl.textContent = st.title;
    if (progressXpTotalEl) progressXpTotalEl.textContent = String(progress.xp);
    if (progressStreakNumEl) progressStreakNumEl.textContent = String(progress.streak);
    if (progressQuestionsNumEl) progressQuestionsNumEl.textContent = String(progress.questionsAsked);

    // Mastery bars (sorted desc by XP)
    if (masteryListEl) {
      const entries = Object.entries(progress.subjects).sort((a, b) => b[1] - a[1]);
      if (!entries.length) {
        masteryListEl.innerHTML = '<p class="muted">Ask Maya about a topic to start a mastery bar.</p>';
      } else {
        masteryListEl.innerHTML = "";
        for (const [key, xp] of entries) {
          const label = SUBJECT_LABELS[key] || key;
          // Use the same level math, scaled to subject xp.
          const sst = levelStateFor(xp);
          const row = document.createElement("div");
          row.className = "mastery-row";
          row.innerHTML = `
            <div class="mastery-row__label">${label}</div>
            <div class="mastery-row__bar"><span style="width:${(sst.pct*100).toFixed(1)}%"></span></div>
            <div class="mastery-row__xp muted">lvl ${sst.lvl} · ${xp} XP</div>
          `;
          masteryListEl.appendChild(row);
        }
      }
    }

    // Badges
    if (badgesListEl) {
      const owned = progress.badges;
      badgeCountEl.textContent = ` (${owned.length}/${BADGES.length})`;
      badgesListEl.innerHTML = "";
      BADGES.forEach((b) => {
        const got = owned.includes(b.id);
        const item = document.createElement("div");
        item.className = "badge" + (got ? " badge--got" : " badge--locked");
        item.title = b.desc;
        item.innerHTML = `
          <div class="badge__emoji">${got ? b.emoji : "🔒"}</div>
          <div class="badge__title">${b.title}</div>
          <div class="badge__desc muted">${b.desc}</div>
        `;
        badgesListEl.appendChild(item);
      });
    }
  }

  function showToast(msg, kind = "info") {
    if (!toastStackEl) return;
    const t = document.createElement("div");
    t.className = `toast toast--${kind}`;
    t.textContent = msg;
    toastStackEl.appendChild(t);
    requestAnimationFrame(() => t.classList.add("toast--in"));
    setTimeout(() => {
      t.classList.remove("toast--in");
      setTimeout(() => t.remove(), 400);
    }, 4200);
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
    // Persona-aware preference: deeper voice for Chen, more energetic for Vega.
    const persona = currentPersona();
    const englishVoices = voices.filter((v) => /^en[-_]/i.test(v.lang));
    const candidates = englishVoices.length ? englishVoices : voices;
    let preferred = [
      /Google US English/i,
      /Microsoft Aria/i,
      /Microsoft Jenny/i,
      /Samantha/i,
      /Karen/i,
      /Serena/i,
      /female/i,
    ];
    if (persona.key === "chen") {
      preferred = [
        /Daniel/i, /Alex/i, /Microsoft Guy/i, /Google UK English Male/i, /male/i, ...preferred,
      ];
    } else if (persona.key === "vega") {
      preferred = [
        /Microsoft Aria/i, /Microsoft Jenny/i, /Karen/i, /Tessa/i, ...preferred,
      ];
    }
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
    if (role === "teacher" && !opts.error && !opts.interim) {
      const replay = document.createElement("button");
      replay.type = "button";
      replay.className = "bubble__replay";
      replay.title = "Replay this reply";
      replay.setAttribute("aria-label", "Replay this reply");
      replay.textContent = "🔁";
      replay.addEventListener("click", () => {
        const txt = b.querySelector("p")?.textContent?.trim();
        if (!txt) return;
        cancelSpeech();
        sayQueue.length = 0;
        enqueueSpeech(txt);
        maybeAwardBadge("replay_used");
      });
      b.appendChild(replay);
    }
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

  function speakUtterance(text) {
    return new Promise((resolve) => {
      if (!window.speechSynthesis) { resolve(); return; }
      const u = new SpeechSynthesisUtterance(text);
      const voice = pickVoice();
      if (voice) { u.voice = voice; u.lang = voice.lang; }
      const persona = currentPersona();
      const baseRate = settings.speechRate || 1.0;
      const personaRate = persona.key === "vega" ? 1.1 : persona.key === "chen" ? 0.95 : 1.02;
      const personaPitch = persona.key === "vega" ? 1.15 : persona.key === "chen" ? 0.92 : 1.05;
      u.rate = baseRate * personaRate;
      u.pitch = personaPitch;
      u.onstart = () => setSpeaking(true);
      u.onend = () => { setSpeaking(false); resolve(); };
      u.onerror = () => { setSpeaking(false); resolve(); };
      window.speechSynthesis.speak(u);
    });
  }

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

  // ---------- Modifier chips ----------
  /** @type {Set<string>} */
  const activeMods = new Set();

  function setModActive(mod, on) {
    if (on) activeMods.add(mod); else activeMods.delete(mod);
    document.querySelectorAll(".chip--mod").forEach((el) => {
      el.classList.toggle("chip--active", activeMods.has(el.dataset.mod));
    });
  }

  function applyModifiers(text) {
    if (!activeMods.size) return text;
    const prefixes = [];
    if (activeMods.has("eli5"))    { prefixes.push("Explain this like I'm five:"); maybeAwardBadge("eli5_used"); }
    if (activeMods.has("deeper"))  { prefixes.push("Go deeper, more technically:"); maybeAwardBadge("deep_dive"); }
    if (activeMods.has("example")) { prefixes.push("Give me a concrete example of:"); }
    if (activeMods.has("quiz"))    { prefixes.push("Quiz me on:"); maybeAwardBadge("quiz_taker"); }
    return `${prefixes.join(" ")} ${text}`;
  }

  function clearModifiers() {
    if (!activeMods.size) return;
    activeMods.clear();
    document.querySelectorAll(".chip--mod").forEach((el) => el.classList.remove("chip--active"));
  }

  // ---------- Submit a question ----------
  async function submitQuestion(rawText) {
    const text = rawText.trim();
    if (!text) return;
    const decorated = applyModifiers(text);
    addBubble("student", text);
    clearModifiers();

    // Progress: XP + subject + streak.
    const subj = detectSubject(text);
    progress.questionsAsked += 1;
    tickStreak(true);
    gainXp(10, subj);
    if (progress.questionsAsked === 1) maybeAwardBadge("first_q");
    if (progress.questionsAsked >= 10) maybeAwardBadge("ten_q");
    if (progress.questionsAsked >= 100) maybeAwardBadge("hundred_q");
    saveProgress();

    // Make the quickstart chips disappear after the first real interaction.
    if (quickstartEl) quickstartEl.classList.add("quickstart--hidden");

    await askTeacher(decorated, { rawForHistory: text });
  }

  async function askTeacher(userText, { rawForHistory } = {}) {
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
          persona: settings.persona || undefined,
        }),
      });
      if (!resp.ok || !resp.body) {
        const txt = await resp.text().catch(() => `HTTP ${resp.status}`);
        throw new Error(txt || `HTTP ${resp.status}`);
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
      if (buf.trim()) handleSSE(buf);
    } catch (e) {
      addBubble("teacher", `${currentPersona().name} couldn't reach the backend: ${e.message}`, { error: true });
      setStatus("offline — check Backend URL in settings");
      return;
    }

    drainSentences(true);
    history.push({ role: "assistant", content: fullReply.trim() });
    // Bonus XP for a real reply (e.g. she actually said something).
    if (fullReply.trim().length > 40) gainXp(5);

    await waitForSpeechToFinish();
    setStatus(settings.autoListen ? "your turn — listening…" : "tap the mic for your next question");
    if (settings.autoListen) startListening();

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
      } else if (ev.error === "audio-capture") {
        addBubble("teacher", "I don't see a microphone on this device. You can still type your question below.", { error: true });
        setStatus("no microphone detected — type your question instead");
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
        // route through submitQuestion so XP / modifiers fire
        submitQuestion(said);
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
    } catch {}
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
      submitQuestion(t);
    }
  });
  settingsBtn.addEventListener("click", () => {
    loadSettingsIntoForm();
    settingsDialog.showModal();
  });
  saveSettingsBtn.addEventListener("click", () => {
    const prevPersona = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}").persona;
    saveSettings();
    if (settings.persona !== prevPersona && settings.persona !== "maya") {
      maybeAwardBadge("persona_switch");
    }
    fetchHealth();
    renderHeader();
  });

  // Settings dialog tabs
  document.querySelectorAll(".settings__tabs .tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      const name = tab.dataset.tab;
      document.querySelectorAll(".settings__tabs .tab").forEach((t) =>
        t.classList.toggle("tab--active", t === tab)
      );
      document.querySelectorAll(".tabpane").forEach((p) =>
        p.classList.toggle("tabpane--active", p.dataset.tabpane === name)
      );
      if (name === "progress") renderProgressTab();
    });
  });

  speechRateIn.addEventListener("input", () => {
    speechRateLabel.textContent = Number(speechRateIn.value).toFixed(2);
  });

  // Quick-start chips: prefill text input with a topic-shaped question and submit.
  quickstartEl?.addEventListener("click", (ev) => {
    const btn = ev.target.closest(".chip[data-topic]");
    if (!btn) return;
    const topic = btn.dataset.topic;
    const question = TOPIC_STARTERS[topic] || `Teach me about ${topic}.`;
    submitQuestion(question);
  });

  const TOPIC_STARTERS = {
    math:        "Teach me one really cool idea from math I might not have seen before.",
    code:        "Teach me how recursion actually works in code — assume I know variables.",
    languages:   "Teach me how to introduce myself in Spanish, naturally — like a real person would.",
    history:     "Teach me one underrated turning point in world history I should know about.",
    science:     "Teach me what entropy actually means, in plain language.",
    art:         "Teach me how to start sketching as a complete beginner.",
    music:       "Teach me what a key signature is — assume I'm new to music.",
    philosophy:  "Teach me one big idea from philosophy that changed how people think.",
  };

  // Modifier chips: toggle on/off.
  modifiersEl?.addEventListener("click", (ev) => {
    const btn = ev.target.closest(".chip--mod");
    if (!btn) return;
    const mod = btn.dataset.mod;
    setModActive(mod, !activeMods.has(mod));
  });

  // Reset progress
  resetProgressBtn?.addEventListener("click", () => {
    if (!confirm("Reset your XP, level, streak, mastery, and badges? This can't be undone.")) return;
    progress.xp = 0;
    progress.streak = 0;
    progress.lastDate = "";
    progress.questionsAsked = 0;
    progress.subjects = {};
    progress.badges = [];
    saveProgress();
    renderHeader();
    renderProgressTab();
    showToast("Progress reset.", "info");
  });

  // ---------- Boot ----------
  if (window.speechSynthesis) {
    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;
  } else {
    voiceSelect.innerHTML = '<option value="">(no TTS in this browser)</option>';
  }

  // Streak check on load (does NOT auto-bump — only a question bumps).
  tickStreak(false);
  saveProgress();

  applyPersonaToUI();
  renderHeader();
  refreshFooter();
  fetchHealth();
  loadPersonas().then(renderPersonaGrid);

  if (!SR) {
    addBubble(
      "teacher",
      "Heads up — your browser doesn't expose speech recognition. Chrome on desktop is best. You can still type below and you'll hear me speak back.",
      { error: false }
    );
  }
})();
