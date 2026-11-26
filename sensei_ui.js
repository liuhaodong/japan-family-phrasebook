// Nihongo Sensei AI Studio Frontend (window.JP_SENSEI)
// Powers:
//   1. Guided 10-Min Sensei Lesson & Repeat-Until-Good Audio Mirror + Oral Substitution Drills
//   2. Real-Time Gemini 3.8 Live Voice Call (/ws/live, 16kHz PCM in / 24kHz PCM ring buffer out, <10ms barge-in)
//   3. Sensei's Notebook (Weakness Radar + Unified FSRS Deck + Post-Call Scorecards + Legacy Sync)
//   4. Personalized Graded AI Audio Stories
//   5. Universal Tap-Any-Word SudachiPy Token Popover

(function () {
  const BACKEND_URL_STORAGE = "jp_sensei_backend_url_v1";
  const PASSCODE_STORAGE = "jp_sensei_passcode_v1";
  const USER_STORAGE = "jp_sensei_user_id_v1";
  const VOICE_STORAGE = "jp_sensei_voice_v1";
  const COACH_MODEL_STORAGE = "jp_sensei_coach_model_v1";
  const INCLUDE_REVIEW_STORAGE = "jp_sensei_include_review_v1";
  const GEMINI_KEY_STORAGE = "jp_phrasebook_gemini_key_v1";

  const DEFAULT_CLOUD_BACKEND = "https://nihongo-sensei-production-5d273b95.up.railway.app";

  const state = {
    subTab: "lesson", // lesson | call | notebook | story
    backendBase: (localStorage.getItem(BACKEND_URL_STORAGE) || "").replace(/\/+$/, ""),
    passcode: localStorage.getItem(PASSCODE_STORAGE) || "",
    passcodeVerified: false,
    userId: localStorage.getItem(USER_STORAGE) || "haodong",
    voice: localStorage.getItem(VOICE_STORAGE) || "Aoede",
    coachModel: localStorage.getItem(COACH_MODEL_STORAGE) || "",
    includeReview: localStorage.getItem(INCLUDE_REVIEW_STORAGE) === "true",
    health: null,
    healthChecked: false,
    backendOnline: false,
    users: [],
    scenarios: [],
    syllabus: null,
    curriculumMode: "sensei_syllabus", // sensei_syllabus | custom_topic | travel_scenario
    selectedLessonId: "",
    customTopic: "",
    selectedScenarioId: "1",
    lessonType: "guided_10min",
    jlptTarget: "N4",

    // Guided Lesson state
    lessonSession: null,
    isGeneratingLesson: false,
    lessonStepIdx: 0,
    attempt: 1,
    drillChunkJp: "",
    drillChunkTokens: [],
    peekHint: false,
    mirrorPlayback: true,
    autoReopenMic: true,
    autoStopSilence: true,
    autoAdvanceOnPass: true,
    isRecordingTurn: false,
    isEvaluatingTurn: false,
    mirrorPhase: "", // "" | "user_mirror_eval" | "user_mirror" | "teacher_explain" | "ready_retry" | "auto_next"
    lastTurnResult: null,
    turnHistory: [],

    // Live Call state
    callActive: false,
    callStatus: "idle", // idle | connecting | listening | ai_speaking
    correctionMode: "strict", // strict | flow
    audioOutputMode: "headset", // headset | speaker (speaker gates mic while AI speaks)
    liveSessionId: null,
    liveMessages: [],
    liveHints: [],
    liveStartedAt: 0,
    liveReport: null,

    // Memory & FSRS state
    memoryData: null,
    srsCards: [],
    reviewQueue: [],
    reviewIdx: 0,
    reviewShowBack: false,

    // Stories state
    stories: [],
    generatingStory: false,

    // Word popover state
    activeTokenEntry: null,
    loadingToken: false,
  };

  const isIOSDevice =
    /iPad|iPhone|iPod/.test(navigator.userAgent || "") ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

  let containerEl = null;
  let currentAudioEl = null;
  let currentAudioDoneResolve = null;
  let sharedAudioEl = null;
  let sharedAudioUnlocked = false;
  let localMirrorBlobUrl = "";
  let lastMirrorBlob = null;
  let activeMirrorPlayId = 0;
  let turnChoreographySeq = 0;
  let mediaRecorder = null;
  let mediaStream = null;
  let audioChunks = [];
  let micLevelRaf = 0;
  let lessonAudioCtx = null;
  let lessonTtsCtx = null;
  let vadAnalyser = null;
  let vadSourceNode = null;
  let vadSilentGain = null;
  let vadDataArray = null;
  let suppressNextStopSubmit = false;
  let autoAdvanceTimer = null;
  let activeTurnAbortCtrl = null;
  let evalTimerInterval = null;
  let lessonStreamSources = [];
  let lessonStreamAbort = null;
  let lessonStreamNextTime = 0;
  let lessonStreamDoneResolve = null;

  // Live Call Web Audio objects
  let liveWs = null;
  let liveCtx = null;
  let liveWorkletNode = null;
  let liveScriptNode = null;
  let liveMicStream = null;
  let liveSourceNode = null;
  let liveAiSources = [];
  let liveNextPlayTime = 0;
  let liveAiSpeakingTimer = null;

  function escapeHtml(str) {
    if (window.JP_APP && window.JP_APP.escapeHtml) {
      return window.JP_APP.escapeHtml(str || "");
    }
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function showToast(msg) {
    if (window.JP_APP && window.JP_APP.showToast) {
      window.JP_APP.showToast(msg);
    }
  }

  function apiBase() {
    if (state.backendBase) return state.backendBase;
    if (location.hostname.endsWith("github.io")) {
      return DEFAULT_CLOUD_BACKEND;
    }
    if (location.protocol === "file:") {
      return "http://127.0.0.1:8000";
    }
    return "";
  }

  function resolveUrl(path) {
    if (!path) return "";
    if (/^(https?|blob|data):/i.test(path)) return path;
    return `${apiBase()}${path.startsWith("/") ? path : "/" + path}`;
  }

  function wsUrl(path) {
    const base = apiBase();
    if (base) {
      return base.replace(/^http:/i, "ws:").replace(/^https:/i, "wss:") + path;
    }
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${location.host}${path}`;
  }

  function getHeaders(extra = {}) {
    const headers = { ...extra };
    const localKey = (localStorage.getItem(GEMINI_KEY_STORAGE) || "").trim();
    if (localKey) headers["X-Gemini-Api-Key"] = localKey;
    if (state.passcode) headers["X-App-Passcode"] = state.passcode;
    return headers;
  }

  async function apiJson(path, options = {}) {
    const resp = await fetch(resolveUrl(path), {
      ...options,
      headers: getHeaders({
        ...(options.body && !(options.body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
        ...(options.headers || {}),
      }),
    });
    const text = await resp.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { detail: text };
    }
    if (!resp.ok) {
      if (resp.status === 401) {
        state.passcodeVerified = false;
        renderView();
      }
      throw new Error(data.detail || `HTTP ${resp.status}`);
    }
    return data;
  }

  function getSharedAudioEl() {
    if (!sharedAudioEl) {
      sharedAudioEl = new Audio();
      sharedAudioEl.playsInline = true;
      sharedAudioEl.setAttribute("playsinline", "");
      sharedAudioEl.preload = "auto";
    }
    return sharedAudioEl;
  }

  function unlockSharedAudioEl() {
    try {
      const el = getSharedAudioEl();
      if (sharedAudioUnlocked || currentAudioEl === el || !el.paused) return;
      // iOS WebKit requires an unmuted play() inside a user gesture to grant autoplay for future clips.
      el.muted = false;
      el.volume = 1;
      el.src = "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA";
      const p = el.play();
      if (p && typeof p.then === "function") {
        p.then(() => {
          try {
            el.pause();
            el.currentTime = 0;
            sharedAudioUnlocked = true;
          } catch {}
        }).catch(() => {});
      } else {
        sharedAudioUnlocked = true;
      }
    } catch {}
  }

  function stopSimpleAudio() {
    activeMirrorPlayId += 1;
    if (lessonStreamAbort) {
      try {
        lessonStreamAbort.abort();
      } catch {}
      lessonStreamAbort = null;
    }
    for (const src of lessonStreamSources) {
      try {
        src.onended = null;
        src.stop();
      } catch {}
    }
    lessonStreamSources = [];
    lessonStreamNextTime = 0;
    if (lessonStreamDoneResolve) {
      const done = lessonStreamDoneResolve;
      lessonStreamDoneResolve = null;
      done();
    }
    if (currentAudioEl) {
      try {
        currentAudioEl.onended = null;
        currentAudioEl.onerror = null;
        currentAudioEl.pause();
      } catch {}
      currentAudioEl = null;
    }
    if (currentAudioDoneResolve) {
      const resolveAudio = currentAudioDoneResolve;
      currentAudioDoneResolve = null;
      resolveAudio(true);
    }
  }

  function playUrlAsync(url) {
    return new Promise((resolve) => {
      stopSimpleAudio();
      if (!url) {
        resolve(false);
        return;
      }
      const audio = getSharedAudioEl();
      audio.playsInline = true;
      audio.setAttribute("playsinline", "");
      audio.muted = false;
      audio.volume = 1;
      currentAudioEl = audio;
      let finished = false;
      const done = (ok = true) => {
        if (finished) return;
        finished = true;
        audio.onended = null;
        audio.onerror = null;
        if (currentAudioEl === audio) currentAudioEl = null;
        if (currentAudioDoneResolve === done) currentAudioDoneResolve = null;
        resolve(Boolean(ok));
      };
      currentAudioDoneResolve = done;
      audio.onended = () => done(true);
      audio.onerror = () => done(false);
      try {
        audio.src = resolveUrl(url);
        const p = audio.play();
        if (p && typeof p.then === "function") {
          p.then(() => {
            sharedAudioUnlocked = true;
          }).catch(() => done(false));
        }
      } catch {
        done(false);
      }
    });
  }

  async function playMirrorAudio(audioBlob, blobUrl = "") {
    if (!audioBlob || !audioBlob.size) return;
    if (isIOSDevice) {
      const targetUrl = blobUrl || URL.createObjectURL(audioBlob);
      const ok = await playUrlAsync(targetUrl);
      if (ok) return;
    }
    await playBlobViaWebAudio(audioBlob, blobUrl);
  }

  async function playBlobViaWebAudio(audioBlob, fallbackUrl = "") {
    stopSimpleAudio();
    const playId = ++activeMirrorPlayId;
    if (!audioBlob || !audioBlob.size) return;

    const ctx = ensureLessonTtsCtx(24000) || ensureLessonAudioCtx();
    if (ctx) {
      try {
        if (ctx.state === "suspended" || ctx.state === "interrupted") {
          await ctx.resume().catch(() => {});
        }
        const arrayBuf = await audioBlob.arrayBuffer();
        if (playId !== activeMirrorPlayId) return;
        const audioBuf = await ctx.decodeAudioData(arrayBuf.slice(0));
        if (playId !== activeMirrorPlayId) return;

        await new Promise((resolve) => {
          let finished = false;
          let safetyTimer = null;
          const finish = () => {
            if (finished) return;
            finished = true;
            if (safetyTimer) clearTimeout(safetyTimer);
            if (lessonStreamDoneResolve === finish) {
              lessonStreamDoneResolve = null;
            }
            resolve();
          };
          const src = ctx.createBufferSource();
          src.buffer = audioBuf;
          src.connect(ctx.destination);
          lessonStreamSources.push(src);
          lessonStreamDoneResolve = finish;
          src.onended = () => {
            lessonStreamSources = lessonStreamSources.filter((s) => s !== src);
            finish();
          };
          safetyTimer = setTimeout(finish, Math.max(400, Math.ceil(audioBuf.duration * 1000) + 500));
          src.start(0);
        });
        return;
      } catch {
        // Fall back to pre-unlocked HTMLAudioElement below if decodeAudioData fails.
      }
    }

    if (playId !== activeMirrorPlayId) return;
    await playUrlAsync(fallbackUrl || URL.createObjectURL(audioBlob));
  }

  function flushLiveAiAudio() {
    for (const src of liveAiSources) {
      try {
        src.onended = null;
        src.stop();
      } catch {}
    }
    liveAiSources = [];
    if (liveCtx) {
      liveNextPlayTime = liveCtx.currentTime;
    }
    if (liveAiSpeakingTimer) {
      clearTimeout(liveAiSpeakingTimer);
      liveAiSpeakingTimer = null;
    }
    if (state.callActive && state.callStatus === "ai_speaking") {
      state.callStatus = "listening";
      updateCallStatusDom();
    }
  }

  function enqueueLivePcm24k(arrayBuffer) {
    if (!liveCtx || !arrayBuffer || arrayBuffer.byteLength < 2) return;
    const int16 = new Int16Array(arrayBuffer);
    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) {
      float32[i] = int16[i] / 32768;
    }
    const audioBuf = liveCtx.createBuffer(1, float32.length, 24000);
    audioBuf.copyToChannel(float32, 0);

    const src = liveCtx.createBufferSource();
    src.buffer = audioBuf;
    src.connect(liveCtx.destination);

    const now = liveCtx.currentTime;
    if (liveNextPlayTime < now + 0.015) {
      liveNextPlayTime = now + 0.025;
    }
    src.start(liveNextPlayTime);
    liveNextPlayTime += audioBuf.duration;
    liveAiSources.push(src);

    if (state.callStatus !== "ai_speaking") {
      state.callStatus = "ai_speaking";
      updateCallStatusDom();
    }

    src.onended = () => {
      liveAiSources = liveAiSources.filter((s) => s !== src);
      if (liveAiSources.length === 0 && state.callActive) {
        liveAiSpeakingTimer = setTimeout(() => {
          if (liveAiSources.length === 0 && state.callActive) {
            state.callStatus = "listening";
            updateCallStatusDom();
          }
        }, 120);
      }
    };
  }

  async function initBackend(force = false) {
    if (state.healthChecked && !force) return;
    try {
      const h = await apiJson("/api/health");
      state.health = h;
      state.backendOnline = !!h.ok;
      state.healthChecked = true;
      if (!h.auth_required) {
        state.passcodeVerified = true;
      } else if (state.passcode) {
        try {
          await apiJson("/api/auth/verify", { method: "POST" });
          state.passcodeVerified = true;
        } catch {
          state.passcode = "";
          state.passcodeVerified = false;
          localStorage.removeItem(PASSCODE_STORAGE);
        }
      } else {
        state.passcodeVerified = false;
      }
      const [usersRes, scenRes] = await Promise.all([apiJson("/api/users"), apiJson("/api/scenarios")]);
      state.users = usersRes.users || [];
      state.scenarios = scenRes.scenarios || [];
      if (state.scenarios.length && !state.scenarios.some((s) => String(s.id) === String(state.selectedScenarioId))) {
        state.selectedScenarioId = String(state.scenarios[0].id);
      }
      const activeUser = state.users.find((u) => u.id === state.userId);
      if (activeUser) {
        state.jlptTarget = activeUser.jlpt_target || state.jlptTarget;
        state.voice = activeUser.preferred_voice || state.voice;
      }
      await loadSyllabus();
    } catch {
      state.backendOnline = false;
      state.healthChecked = true;
    }
  }

  async function loadSyllabus() {
    try {
      const res = await apiJson(
        `/api/sensei/syllabus?user_id=${encodeURIComponent(state.userId)}&jlpt_target=${encodeURIComponent(state.jlptTarget)}`
      );
      state.syllabus = res;
      if (!state.selectedLessonId && res?.recommendedLesson?.id) {
        state.selectedLessonId = res.recommendedLesson.id;
      }
    } catch {}
  }

  const KANJI_CHAR_RE = /[\u4e00-\u9fff\u3400-\u4dbf々〆ヵヶ]/;

  function formatTokenRubyHtml(surface, reading) {
    if (!surface || !KANJI_CHAR_RE.test(surface) || !reading || reading === surface) {
      return escapeHtml(surface || "");
    }
    const sChars = Array.from(surface);
    const rChars = Array.from(reading);
    let lead = 0;
    while (
      lead < sChars.length &&
      lead < rChars.length &&
      !KANJI_CHAR_RE.test(sChars[lead]) &&
      sChars[lead] === rChars[lead]
    ) {
      lead += 1;
    }
    let sEnd = sChars.length;
    let rEnd = rChars.length;
    while (
      sEnd > lead &&
      rEnd > lead &&
      !KANJI_CHAR_RE.test(sChars[sEnd - 1]) &&
      sChars[sEnd - 1] === rChars[rEnd - 1]
    ) {
      sEnd -= 1;
      rEnd -= 1;
    }
    const pre = sChars.slice(0, lead).join("");
    const core = sChars.slice(lead, sEnd).join("");
    const coreRead = rChars.slice(lead, rEnd).join("");
    const suf = sChars.slice(sEnd).join("");
    if (!core || !coreRead || core === coreRead) {
      return `<ruby>${escapeHtml(surface)}<rt>${escapeHtml(reading)}</rt></ruby>`;
    }
    return `${escapeHtml(pre)}<ruby>${escapeHtml(core)}<rt>${escapeHtml(coreRead)}</rt></ruby>${escapeHtml(suf)}`;
  }

  function renderTokensHtml(tokens, contextJp) {
    if (!Array.isArray(tokens) || tokens.length === 0) {
      return `<span>${escapeHtml(contextJp)}</span>`;
    }
    return tokens
      .map((tk) => {
        const surf = escapeHtml(tk.surface || "");
        if (!tk.surface || tk.pos === "補助記号" || tk.pos === "空白") {
          return `<span class="sensei-tok-punct">${surf}</span>`;
        }
        const labelHtml = formatTokenRubyHtml(tk.surface, tk.reading || "");
        return `<button type="button" class="sensei-tok ${tk.is_content_word ? "content" : "func"}"
          data-tok-surface="${surf}"
          data-tok-lemma="${escapeHtml(tk.lemma || tk.surface)}"
          data-tok-reading="${escapeHtml(tk.reading || "")}"
          data-tok-context="${escapeHtml(contextJp || "")}"
          title="${escapeHtml(tk.reading ? tk.reading + (tk.meaning_cn ? " · " + tk.meaning_cn : "") : "点击查词")}">${labelHtml}</button>`;
      })
      .join("");
  }

  async function openWordLookup(surface, lemma, reading, contextJp) {
    state.loadingToken = true;
    state.activeTokenEntry = { surface, lemma, reading, context_jp: contextJp, meaning_cn: "查询词典中..." };
    renderView();
    try {
      const res = await apiJson("/api/dict/define", {
        method: "POST",
        body: JSON.stringify({ surface, lemma, reading, context_jp: contextJp }),
      });
      state.activeTokenEntry = res.entry || state.activeTokenEntry;
    } catch (err) {
      state.activeTokenEntry = {
        surface,
        lemma,
        reading,
        context_jp: contextJp,
        meaning_cn: `查词提示：${err.message}`,
      };
    } finally {
      state.loadingToken = false;
      renderView();
    }
  }

  async function saveTokenToSrs(entry) {
    if (!entry || !entry.surface) return;
    try {
      await apiJson("/api/srs/cards", {
        method: "POST",
        body: JSON.stringify({
          user_id: state.userId,
          surface: entry.surface,
          lemma: entry.lemma || entry.surface,
          reading: entry.reading || "",
          pitch_accent: entry.pitch_accent || entry.pitchAccent || "",
          meaning_cn: entry.meaning_cn || entry.meaningCn || "",
          jlpt: entry.jlpt || "N4",
          context_jp: entry.context_jp || entry.example_jp || "",
          source_type: state.subTab,
        }),
      });
      showToast(`✅ 已将「${entry.lemma || entry.surface}」加入 FSRS 记忆本`);
    } catch (err) {
      showToast(`❌ 存卡失败：${err.message}`);
    }
  }

  function ensureLessonTtsCtx(sampleRate = 24000) {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return null;
      if (!lessonTtsCtx || lessonTtsCtx.state === "closed") {
        try {
          lessonTtsCtx = new AudioCtx({ sampleRate });
        } catch {
          lessonTtsCtx = new AudioCtx();
        }
      }
      if (lessonTtsCtx.state === "suspended" || lessonTtsCtx.state === "interrupted") {
        lessonTtsCtx.resume().catch(() => {});
      }
      return lessonTtsCtx;
    } catch {
      return null;
    }
  }

  async function playTextTtsStream(text, opts = {}) {
    if (!text) return;
    stopSimpleAudio();

    const ctrl = opts.abortCtrl || new AbortController();
    if (ctrl.signal.aborted) return;
    lessonStreamAbort = ctrl;

    const reqPayload = { text, voice: state.voice };
    if (opts.lang) reqPayload.lang = opts.lang;

    // On iOS Safari / PWA, Web Audio contexts stall or mute opening syllables right after getUserMedia().
    // Complete WAV playback via the pre-unlocked <audio> element preserves loudspeaker volume and the full opening.
    if (isIOSDevice) {
      try {
        const res = opts.prefetchedTtsJsonPromise
          ? await opts.prefetchedTtsJsonPromise
          : await apiJson("/api/tts", {
              method: "POST",
              body: JSON.stringify(reqPayload),
              signal: ctrl.signal,
            });
        if (!ctrl.signal.aborted && res && res.audio_url) {
          if (typeof opts.onCacheUrl === "function") opts.onCacheUrl(res.audio_url);
          const played = await playUrlAsync(res.audio_url);
          if (!played && !ctrl.signal.aborted && window.JP_APP && window.JP_APP.speakJapanese) {
            window.JP_APP.speakJapanese(text, 0.92);
          }
        } else if (!ctrl.signal.aborted && !res) {
          const retryRes = await apiJson("/api/tts", {
            method: "POST",
            body: JSON.stringify(reqPayload),
            signal: ctrl.signal,
          });
          if (!ctrl.signal.aborted && retryRes && retryRes.audio_url) {
            if (typeof opts.onCacheUrl === "function") opts.onCacheUrl(retryRes.audio_url);
            await playUrlAsync(retryRes.audio_url);
          }
        }
      } catch (err) {
        if (err && (err.name === "AbortError" || ctrl.signal.aborted)) return;
        if (window.JP_APP && window.JP_APP.speakJapanese) {
          window.JP_APP.speakJapanese(text, 0.92);
        } else {
          showToast(`语音播报失败：${err.message}`);
        }
      } finally {
        if (lessonStreamAbort === ctrl) lessonStreamAbort = null;
      }
      return;
    }

    const ctx = ensureLessonTtsCtx(24000);
    if (!ctx || typeof ReadableStream === "undefined") {
      lessonStreamAbort = null;
      try {
        const res = opts.prefetchedTtsJsonPromise
          ? await opts.prefetchedTtsJsonPromise
          : await apiJson("/api/tts", {
              method: "POST",
              body: JSON.stringify(reqPayload),
              signal: ctrl.signal,
            });
        if (!ctrl.signal.aborted && res) {
          if (res.audio_url && typeof opts.onCacheUrl === "function") opts.onCacheUrl(res.audio_url);
          await playUrlAsync(res.audio_url);
        }
      } catch (err) {
        if (err.name === "AbortError") return;
        if (window.JP_APP && window.JP_APP.speakJapanese) {
          window.JP_APP.speakJapanese(text, 0.92);
        } else {
          showToast(`语音播报失败：${err.message}`);
        }
      }
      return;
    }

    if (ctx.state === "suspended" || ctx.state === "interrupted") {
      await ctx.resume().catch(() => {});
    }

    let finishTimer = null;
    try {
      const resp = opts.prefetchedRespPromise
        ? await opts.prefetchedRespPromise
        : await fetch(resolveUrl("/api/tts/stream"), {
            method: "POST",
            headers: getHeaders({ "Content-Type": "application/json" }),
            body: JSON.stringify(reqPayload),
            signal: ctrl.signal,
          });
      if (ctrl.signal.aborted) return;
      if (!resp || !resp.ok || !resp.body) {
        throw new Error(resp ? `HTTP ${resp.status}` : "stream fetch failed");
      }

      const sampleRate = parseInt(resp.headers.get("X-TTS-Sample-Rate") || "24000", 10) || 24000;
      const cacheUrl = resp.headers.get("X-TTS-Cache-Url") || "";
      if (cacheUrl && typeof opts.onCacheUrl === "function") {
        opts.onCacheUrl(cacheUrl);
      }

      const reader = resp.body.getReader();
      let leftover = null;
      let streamEnded = false;
      let pendingParts = [];
      let pendingBytes = 0;
      let blocksScheduled = 0;
      lessonStreamNextTime = 0;

      const playbackPromise = new Promise((resolve) => {
        lessonStreamDoneResolve = resolve;
      });

      const maybeFinish = () => {
        if (lessonStreamSources.length === 0 && lessonStreamDoneResolve) {
          const resolve = lessonStreamDoneResolve;
          lessonStreamDoneResolve = null;
          resolve();
        }
      };

      const targetBytesForBlock = (blk) => {
        if (blk === 0) return 10560; // ~220ms initial cushion at 24kHz 16-bit mono
        if (blk === 1) return 28800; // ~600ms
        if (blk === 2) return 57600; // ~1.2s
        return 96000; // ~2.0s
      };

      const flushBufferedPcm = (force = false) => {
        const minBytes = targetBytesForBlock(blocksScheduled);
        if (pendingBytes < 2 || (!force && pendingBytes < minBytes)) return;

        const combined = new Uint8Array(pendingBytes);
        let off = 0;
        for (const part of pendingParts) {
          combined.set(part, off);
          off += part.byteLength;
        }
        pendingParts = [];
        pendingBytes = 0;

        const usableBytes = combined.byteLength - (combined.byteLength % 2);
        if (usableBytes < combined.byteLength) {
          leftover = combined.slice(usableBytes);
        }
        if (usableBytes < 2) return;

        const sampleCount = usableBytes / 2;
        const float32 = new Float32Array(sampleCount);
        const view = new DataView(combined.buffer, combined.byteOffset, usableBytes);
        for (let i = 0; i < sampleCount; i++) {
          float32[i] = view.getInt16(i * 2, true) / 32768;
        }

        const audioBuf = ctx.createBuffer(1, sampleCount, sampleRate);
        audioBuf.copyToChannel(float32, 0);

        const src = ctx.createBufferSource();
        src.buffer = audioBuf;
        src.connect(ctx.destination);

        const now = ctx.currentTime;
        if (lessonStreamNextTime === 0) {
          lessonStreamNextTime = now + 0.12;
        } else if (lessonStreamNextTime < now) {
          // Only re-anchor on genuine underrun, never while already scheduled ahead of `now`.
          lessonStreamNextTime = now + 0.04;
        }
        src.start(lessonStreamNextTime);
        lessonStreamNextTime += audioBuf.duration;
        lessonStreamSources.push(src);
        blocksScheduled += 1;

        src.onended = () => {
          lessonStreamSources = lessonStreamSources.filter((s) => s !== src);
          if (streamEnded && lessonStreamSources.length === 0) {
            maybeFinish();
          }
        };
      };

      while (true) {
        const { done, value } = await reader.read();
        if (ctrl.signal.aborted) {
          try {
            await reader.cancel();
          } catch {}
          break;
        }
        if (done) break;
        if (!value || !value.byteLength) continue;

        let chunk = value;
        if (leftover && leftover.byteLength) {
          const merged = new Uint8Array(leftover.byteLength + value.byteLength);
          merged.set(leftover, 0);
          merged.set(value, leftover.byteLength);
          chunk = merged;
          leftover = null;
        }
        pendingParts.push(chunk);
        pendingBytes += chunk.byteLength;
        flushBufferedPcm(false);
      }

      if (!ctrl.signal.aborted) {
        flushBufferedPcm(true);
      }

      streamEnded = true;
      if (!ctrl.signal.aborted && lessonStreamSources.length > 0) {
        const remainMs = Math.max(80, Math.round((lessonStreamNextTime - ctx.currentTime) * 1000) + 180);
        finishTimer = setTimeout(maybeFinish, remainMs);
        await playbackPromise;
      } else {
        maybeFinish();
      }
      if (lessonStreamAbort === ctrl) lessonStreamAbort = null;
    } catch (err) {
      if (finishTimer) clearTimeout(finishTimer);
      if (lessonStreamAbort === ctrl) lessonStreamAbort = null;
      if (lessonStreamDoneResolve) {
        const r = lessonStreamDoneResolve;
        lessonStreamDoneResolve = null;
        r();
      }
      if (err.name === "AbortError" || ctrl.signal.aborted) return;

      // Graceful fallback to non-streaming /api/tts -> Web Speech API
      try {
        const res = await apiJson("/api/tts", {
          method: "POST",
          body: JSON.stringify(reqPayload),
          signal: ctrl.signal,
        });
        if (!ctrl.signal.aborted) {
          if (res.audio_url && typeof opts.onCacheUrl === "function") opts.onCacheUrl(res.audio_url);
          await playUrlAsync(res.audio_url);
        }
      } catch (err2) {
        if (err2.name === "AbortError" || ctrl.signal.aborted) return;
        if (window.JP_APP && window.JP_APP.speakJapanese) {
          window.JP_APP.speakJapanese(text, 0.92);
        } else {
          showToast(`语音播报失败：${err2.message}`);
        }
      }
    } finally {
      if (finishTimer) clearTimeout(finishTimer);
    }
  }

  async function playTextTts(text, opts = {}) {
    return playTextTtsStream(text, opts);
  }

  // ==================== Guided Lesson & Audio Mirror Loop ====================
  function ensureLessonAudioCtx() {
    unlockSharedAudioEl();
    ensureLessonTtsCtx(24000);
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return null;
      if (!lessonAudioCtx || lessonAudioCtx.state === "closed") {
        lessonAudioCtx = new AudioCtx();
      }
      if (lessonAudioCtx.state === "suspended" || lessonAudioCtx.state === "interrupted") {
        lessonAudioCtx.resume().catch(() => {});
      }
      return lessonAudioCtx;
    } catch {
      return null;
    }
  }

  function playSoftChime(kind = "open") {
    try {
      const ctx = ensureLessonAudioCtx();
      if (!ctx) return;
      const notes =
        kind === "close"
          ? [659.25, 440.0]
          : kind === "pass"
          ? [587.33, 880.0]
          : [523.25, 659.25];
      notes.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const t = ctx.currentTime + i * 0.085;
        osc.type = "sine";
        osc.frequency.setValueAtTime(freq, t);
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(0.075, t + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(t);
        osc.stop(t + 0.15);
      });
    } catch {}
  }

  function clearAutoAdvanceTimer() {
    if (autoAdvanceTimer) {
      clearTimeout(autoAdvanceTimer);
      autoAdvanceTimer = null;
    }
  }

  async function maybeAutoOpenMic(seq) {
    if (seq !== turnChoreographySeq || !state.autoReopenMic || state.subTab !== "lesson") return;
    if (state.isRecordingTurn || state.isEvaluatingTurn) return;
    state.mirrorPhase = "ready_retry";
    updateMirrorPhaseDom();
    await new Promise((r) => setTimeout(r, 260));
    if (seq !== turnChoreographySeq || !state.autoReopenMic || state.subTab !== "lesson") return;
    if (!state.isRecordingTurn && !state.isEvaluatingTurn) {
      await toggleLessonRecording({ autoTriggered: true });
    }
  }

  async function startGuidedLesson(opts = {}) {
    ensureLessonAudioCtx();
    clearAutoAdvanceTimer();
    const seq = ++turnChoreographySeq;
    if (state.isRecordingTurn) cancelLessonRecording();
    stopSimpleAudio();

    const mode = opts.curriculumMode || state.curriculumMode;
    const lessonId = opts.lessonId !== undefined ? opts.lessonId : state.selectedLessonId;
    const customTopic = opts.customTopic !== undefined ? opts.customTopic : state.customTopic;
    if (mode === "custom_topic" && !(customTopic || "").trim()) {
      showToast("请先输入或点选一个想学的主题");
      return;
    }

    state.curriculumMode = mode;
    if (lessonId) state.selectedLessonId = lessonId;
    state.isGeneratingLesson = true;
    renderView();

    showToast(
      mode === "travel_scenario"
        ? "正在编排情景私教课..."
        : "👩‍🏫 老师正在结合你的记忆本与弱点现场编写今日原创教材..."
    );
    try {
      const data = await apiJson("/api/sensei/lesson/start", {
        method: "POST",
        body: JSON.stringify({
          user_id: state.userId,
          scenario_id: state.selectedScenarioId,
          lesson_type: state.lessonType,
          jlpt_target: state.jlptTarget,
          voice: state.voice,
          curriculum_mode: mode,
          lesson_id: lessonId || null,
          custom_topic: (customTopic || "").trim() || null,
          defer_opening_tts: true,
          coach_model: state.coachModel || null,
          include_review: state.includeReview,
        }),
      });
      state.isGeneratingLesson = false;
      if (seq !== turnChoreographySeq) return;
      state.lessonSession = data;
      state.lessonStepIdx = 0;
      state.attempt = 1;
      state.drillChunkJp = "";
      state.drillChunkTokens = [];
      state.peekHint = false;
      state.lastTurnResult = null;
      state.turnHistory = [];
      state.mirrorPhase = data.openingAudioUrl || data.steps?.[0]?.teacherPrompt ? "teacher_explain" : "";
      renderView();
      if (data.openingAudioUrl) {
        await playUrlAsync(data.openingAudioUrl);
      } else if (data.steps?.[0]?.teacherPromptTts || data.steps?.[0]?.teacherPrompt) {
        await playTextTts(data.steps[0].teacherPromptTts || data.steps[0].teacherPrompt);
      }
      await maybeAutoOpenMic(seq);
    } catch (err) {
      state.isGeneratingLesson = false;
      renderView();
      showToast(`❌ 开课失败：${err.message}`);
    }
  }

  function currentLessonStep() {
    const steps = state.lessonSession?.steps || [];
    return steps[state.lessonStepIdx] || null;
  }

  async function advanceLessonStep(delta = 1) {
    const steps = state.lessonSession?.steps || [];
    const next = state.lessonStepIdx + delta;
    if (next < 0 || next >= steps.length) return;
    ensureLessonAudioCtx();
    clearAutoAdvanceTimer();
    const seq = ++turnChoreographySeq;
    if (state.isRecordingTurn) cancelLessonRecording();
    stopSimpleAudio();

    state.lessonStepIdx = next;
    state.attempt = 1;
    state.drillChunkJp = "";
    state.peekHint = false;
    state.lastTurnResult = null;
    const step = steps[next];
    state.mirrorPhase = step && step.teacherPrompt ? "teacher_explain" : "";
    renderView();
    if (step && (step.teacherPromptTts || step.teacherPrompt)) {
      await playTextTts(step.teacherPromptTts || step.teacherPrompt);
    }
    await maybeAutoOpenMic(seq);
  }

  function cleanupTurnRecorder() {
    if (micLevelRaf) {
      cancelAnimationFrame(micLevelRaf);
      micLevelRaf = 0;
    }
    if (vadSourceNode) {
      try {
        vadSourceNode.disconnect();
      } catch {}
      vadSourceNode = null;
    }
    if (vadAnalyser) {
      try {
        vadAnalyser.disconnect();
      } catch {}
      vadAnalyser = null;
    }
    if (vadSilentGain) {
      try {
        vadSilentGain.disconnect();
      } catch {}
      vadSilentGain = null;
    }
    vadDataArray = null;
    if (mediaStream) {
      mediaStream.getTracks().forEach((t) => t.stop());
      mediaStream = null;
    }
    if (isIOSDevice && lessonAudioCtx) {
      try {
        lessonAudioCtx.close().catch(() => {});
      } catch {}
      lessonAudioCtx = null;
    }
    mediaRecorder = null;
    audioChunks = [];
  }

  function cancelLessonRecording() {
    suppressNextStopSubmit = true;
    state.isRecordingTurn = false;
    state.mirrorPhase = "";
    if (mediaRecorder && mediaRecorder.state !== "inactive") {
      try {
        mediaRecorder.stop();
      } catch {
        cleanupTurnRecorder();
      }
    } else {
      cleanupTurnRecorder();
    }
    renderView();
  }

  function startLessonVadMonitor(stream, recorder) {
    const ctx = ensureLessonAudioCtx();
    if (!ctx) return;
    try {
      vadSourceNode = ctx.createMediaStreamSource(stream);
      vadAnalyser = ctx.createAnalyser();
      vadAnalyser.fftSize = 1024;
      vadAnalyser.smoothingTimeConstant = 0.2;
      vadDataArray = new Float32Array(vadAnalyser.fftSize);
      vadSilentGain = ctx.createGain();
      vadSilentGain.gain.value = 0;
      vadSourceNode.connect(vadAnalyser);
      vadAnalyser.connect(vadSilentGain);
      vadSilentGain.connect(ctx.destination);
    } catch {
      return;
    }

    const startedAt = performance.now();
    let calSum = 0;
    let calCount = 0;
    let noiseFloor = 0.008;
    let speechStreakMs = 0;
    let hasSpoken = false;
    let sawNonZeroSample = false;
    let lastSpeechAt = startedAt;
    let lastFrameAt = startedAt;
    let stopTriggered = false;

    const tick = (now) => {
      if (!state.isRecordingTurn || stopTriggered || !vadAnalyser || !vadDataArray) return;
      const dt = Math.max(8, now - lastFrameAt);
      lastFrameAt = now;

      vadAnalyser.getFloatTimeDomainData(vadDataArray);
      let sq = 0;
      for (let i = 0; i < vadDataArray.length; i++) {
        const s = vadDataArray[i];
        sq += s * s;
      }
      const rms = Math.sqrt(sq / vadDataArray.length);
      if (rms > 0.0005) {
        sawNonZeroSample = true;
      }
      const elapsed = now - startedAt;
      const vadUnavailable = elapsed >= 1500 && !sawNonZeroSample;

      if (elapsed < 350) {
        calSum += rms;
        calCount += 1;
        noiseFloor = calSum / Math.max(1, calCount);
      }

      const speechThreshold = Math.max(0.018, Math.min(0.075, noiseFloor * 2.4));
      const silenceThreshold = speechThreshold * 0.68;

      if (rms >= speechThreshold) {
        speechStreakMs += dt;
        if (speechStreakMs >= 140) {
          hasSpoken = true;
          lastSpeechAt = now;
        }
      } else {
        speechStreakMs = Math.max(0, speechStreakMs - dt * 0.5);
        if (hasSpoken && rms >= silenceThreshold) {
          lastSpeechAt = now;
        }
      }

      const fillEl = document.getElementById("sensei-vad-fill");
      if (fillEl) {
        const pct = Math.min(100, Math.round((rms / 0.14) * 100));
        fillEl.style.width = `${pct}%`;
        fillEl.classList.toggle("active", rms >= speechThreshold);
      }

      const step = currentLessonStep();
      const isThinkingStage =
        !state.drillChunkJp &&
        step &&
        ["FREE_OUTPUT", "TRANSFORM_DRILL", "SUBSTITUTION_DRILL"].includes(step.stage);
      const silenceLimitMs = isThinkingStage ? 1150 : 850;
      const silenceSecLabel = (silenceLimitMs / 1000).toFixed(1);

      const silenceMs = now - lastSpeechAt;
      const hintEl = document.getElementById("sensei-vad-hint");
      if (hintEl) {
        if (!state.autoStopSilence) {
          hintEl.textContent = "🎙️ 手动控制录音中，说完请点击上方按钮结束";
        } else if (vadUnavailable) {
          hintEl.textContent = "🎙️ 录音中，说完请点击上方按钮结束并提交";
        } else if (!hasSpoken) {
          hintEl.textContent = "🎙️ 正在聆听，请直接开口说话...";
        } else if (silenceMs < 350) {
          hintEl.textContent = `🗣️ 正在录音中，说完停顿约 ${silenceSecLabel} 秒将自动提交`;
        } else {
          const remain = Math.max(0, (silenceLimitMs - silenceMs) / 1000).toFixed(1);
          hintEl.textContent = `⏳ 检测到停顿，${remain}s 后自动提交...`;
        }
      }

      if (state.autoStopSilence && !vadUnavailable) {
        if (hasSpoken && silenceMs >= silenceLimitMs) {
          stopTriggered = true;
          suppressNextStopSubmit = false;
          playSoftChime("close");
          if (recorder && recorder.state !== "inactive") {
            recorder.stop();
          }
          state.isRecordingTurn = false;
          renderView();
          return;
        }
        if (!hasSpoken && elapsed >= 8500) {
          stopTriggered = true;
          suppressNextStopSubmit = true;
          if (recorder && recorder.state !== "inactive") {
            recorder.stop();
          }
          state.isRecordingTurn = false;
          state.mirrorPhase = "";
          renderView();
          showToast("⏳ 暂未检测到开口，可随时点击麦克风继续");
          return;
        }
        if (elapsed >= 18000) {
          stopTriggered = true;
          suppressNextStopSubmit = !hasSpoken;
          playSoftChime("close");
          if (recorder && recorder.state !== "inactive") {
            recorder.stop();
          }
          state.isRecordingTurn = false;
          renderView();
          return;
        }
      }

      micLevelRaf = requestAnimationFrame(tick);
    };

    micLevelRaf = requestAnimationFrame(tick);
  }

  async function toggleLessonRecording(opts = {}) {
    if (state.isEvaluatingTurn) return;
    clearAutoAdvanceTimer();
    ensureLessonAudioCtx();

    if (state.isRecordingTurn) {
      suppressNextStopSubmit = false;
      if (!isIOSDevice) playSoftChime("close");
      if (mediaRecorder && mediaRecorder.state !== "inactive") {
        mediaRecorder.stop();
      }
      state.isRecordingTurn = false;
      renderView();
      return;
    }

    stopSimpleAudio();
    if (!opts.autoTriggered) {
      turnChoreographySeq += 1;
    }
    state.mirrorPhase = "";
    const step = currentLessonStep();
    if (!step) return;

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      showToast("❌ 当前浏览器不支持麦克风录音，请用 HTTPS / Safari 或 Chrome 打开");
      return;
    }
    if (typeof MediaRecorder === "undefined") {
      showToast("❌ 当前浏览器不支持录音，请使用 Safari 或 Chrome");
      return;
    }

    try {
      const audioConstraints = isIOSDevice
        ? {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          }
        : {
            channelCount: 1,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          };

      try {
        mediaStream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
      } catch (constraintErr) {
        if (constraintErr && (constraintErr.name === "OverconstrainedError" || constraintErr.name === "TypeError")) {
          mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        } else {
          throw constraintErr;
        }
      }

      // iOS Safari may suspend or interrupt AudioContexts while the permission sheet is shown.
      const actx = ensureLessonAudioCtx();
      if (actx && (actx.state === "suspended" || actx.state === "interrupted")) {
        await actx.resume().catch(() => {});
      }
      if (lessonTtsCtx && (lessonTtsCtx.state === "suspended" || lessonTtsCtx.state === "interrupted")) {
        await lessonTtsCtx.resume().catch(() => {});
      }

      audioChunks = [];
      suppressNextStopSubmit = false;
      const mimeTypes = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4;codecs=mp4a.40.2", "audio/mp4"];
      const chosenMime =
        typeof MediaRecorder.isTypeSupported === "function"
          ? mimeTypes.find((m) => MediaRecorder.isTypeSupported(m)) || ""
          : "";
      const isMp4OrIOS = isIOSDevice || !chosenMime || chosenMime.includes("mp4");

      let rec;
      try {
        if (!isMp4OrIOS) {
          rec = new MediaRecorder(mediaStream, { mimeType: chosenMime, audioBitsPerSecond: 24000 });
        } else if (chosenMime) {
          rec = new MediaRecorder(mediaStream, { mimeType: chosenMime });
        } else {
          rec = new MediaRecorder(mediaStream);
        }
      } catch {
        try {
          rec = chosenMime ? new MediaRecorder(mediaStream, { mimeType: chosenMime }) : new MediaRecorder(mediaStream);
        } catch {
          rec = new MediaRecorder(mediaStream);
        }
      }
      mediaRecorder = rec;

      rec.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) audioChunks.push(ev.data);
      };
      rec.onerror = () => {
        cleanupTurnRecorder();
        state.isRecordingTurn = false;
        state.mirrorPhase = "";
        renderView();
        showToast("⚠️ 录音中断，请重新点击麦克风");
      };
      rec.onstop = async () => {
        const shouldSkip = suppressNextStopSubmit;
        suppressNextStopSubmit = false;
        const actualMime =
          (rec && rec.mimeType) ||
          chosenMime ||
          (audioChunks[0] && audioChunks[0].type) ||
          (isIOSDevice ? "audio/mp4" : "audio/webm");
        const blob = new Blob(audioChunks, { type: actualMime });
        cleanupTurnRecorder();
        if (shouldSkip) {
          return;
        }
        if (blob.size < 400) {
          state.isRecordingTurn = false;
          state.mirrorPhase = "";
          renderView();
          showToast("⚠️ 录音时间太短或未采集到声音，请靠近麦克风重试");
          return;
        }
        if (isIOSDevice) {
          await new Promise((r) => setTimeout(r, 220));
        }
        await submitLessonAudioTurn(blob);
      };

      if (isMp4OrIOS) {
        rec.start();
      } else {
        rec.start(100);
      }
      state.isRecordingTurn = true;
      state.mirrorPhase = "";
      if (!isIOSDevice) {
        playSoftChime("open");
      }
      renderView();
      startLessonVadMonitor(mediaStream, rec);
    } catch (err) {
      cleanupTurnRecorder();
      state.isRecordingTurn = false;
      renderView();
      if (opts.autoTriggered) {
        showToast("🎙️ 请点击蓝色麦克风按钮开始说话");
      } else {
        showToast(`❌ 无法打开麦克风：${err.message || err.name}`);
      }
    }
  }

  function clearEvalProgress() {
    if (evalTimerInterval) {
      clearInterval(evalTimerInterval);
      evalTimerInterval = null;
    }
    if (activeTurnAbortCtrl) {
      activeTurnAbortCtrl = null;
    }
  }

  function cancelTurnEvaluation() {
    turnChoreographySeq += 1;
    if (activeTurnAbortCtrl) {
      try {
        activeTurnAbortCtrl.abort();
      } catch {}
    }
    clearEvalProgress();
    stopSimpleAudio();
    state.isEvaluatingTurn = false;
    state.mirrorPhase = "";
    renderView();
    showToast("已取消本次诊断，可直接重新开口");
  }

  async function submitLessonAudioTurn(audioBlob) {
    const step = currentLessonStep();
    if (!step || !state.lessonSession) return;
    const seq = ++turnChoreographySeq;
    clearEvalProgress();
    if (localMirrorBlobUrl) {
      try {
        URL.revokeObjectURL(localMirrorBlobUrl);
      } catch {}
    }
    lastMirrorBlob = audioBlob;
    localMirrorBlobUrl = URL.createObjectURL(audioBlob);
    const mirrorSnapshotUrl = localMirrorBlobUrl;

    const evalStartedAt = performance.now();
    const ctrl = new AbortController();
    activeTurnAbortCtrl = ctrl;
    const abortTimeoutId = setTimeout(() => {
      try {
        ctrl.abort("timeout");
      } catch {}
    }, 28000);

    state.isEvaluatingTurn = true;
    // Play user's own recording IMMEDIATELY (0ms wait) in parallel with Gemini diagnosis!
    state.mirrorPhase = state.mirrorPlayback ? "user_mirror_eval" : "";
    renderView();

    evalTimerInterval = setInterval(() => {
      const el = document.getElementById("sensei-eval-elapsed");
      if (el) {
        const s = ((performance.now() - evalStartedAt) / 1000).toFixed(1);
        el.textContent = `⏳ 老师正在逐拍倾听诊断... (${s}s)`;
      }
    }, 200);

    const mirrorPlayPromise =
      state.mirrorPlayback && audioBlob
        ? playMirrorAudio(audioBlob, mirrorSnapshotUrl)
        : Promise.resolve();

    try {
      const fd = new FormData();
      const mimeLower = (audioBlob.type || "").toLowerCase();
      const uploadExt =
        mimeLower.includes("mp4") || mimeLower.includes("m4a") || mimeLower.includes("aac")
          ? "m4a"
          : mimeLower.includes("ogg")
          ? "ogg"
          : mimeLower.includes("wav")
          ? "wav"
          : "webm";
      fd.append("audio", audioBlob, `student_turn.${uploadExt}`);
      fd.append("session_id", state.lessonSession.sessionId);
      fd.append("user_id", state.userId);
      fd.append("step_index", String(step.stepIndex));
      fd.append("stage", step.stage);
      fd.append("target_jp", step.targetJp);
      fd.append("target_cn", step.targetCn || "");
      fd.append("cue_cn", step.cueCn || "");
      fd.append("attempt", String(state.attempt));
      fd.append("drill_chunk_jp", state.drillChunkJp || "");
      fd.append("voice", state.voice);
      if (state.coachModel) fd.append("coach_model", state.coachModel);
      fd.append("defer_tts", "true");
      const meta = state.lessonSession?.lessonMeta || {};
      if (meta.lessonId) fd.append("lesson_id", meta.lessonId);
      if (meta.grammarFocus) fd.append("grammar_focus", meta.grammarFocus);
      if (step.questionJp) fd.append("question_jp", step.questionJp);

      const res = await apiJson("/api/sensei/turn", {
        method: "POST",
        body: fd,
        signal: ctrl.signal,
      });
      clearTimeout(abortTimeoutId);
      clearEvalProgress();
      if (seq !== turnChoreographySeq) return;

      res.localMirrorUrl = mirrorSnapshotUrl;
      state.lastTurnResult = res;
      state.turnHistory.push(res);
      state.isEvaluatingTurn = false;

      if (res.decision === "retry_chunk" && res.drillChunkJp) {
        state.drillChunkJp = res.drillChunkJp;
        state.drillChunkTokens = res.drillChunkTokens || [];
        state.attempt += 1;
      } else if (res.decision === "retry_full") {
        state.drillChunkJp = "";
        state.drillChunkTokens = [];
        state.attempt += 1;
      } else {
        state.drillChunkJp = "";
        state.drillChunkTokens = [];
      }

      // Immediately prefetch TTS in parallel while local mirror finishes playing
      const spokenTtsText = res.teacherSpokenTts || res.teacherSpokenScript || "";
      let ttsAbort = null;
      let ttsStreamRespPromise = null;
      let ttsJsonPromise = null;
      if (!res.teacherAudioUrl && spokenTtsText) {
        ttsAbort = new AbortController();
        if (isIOSDevice) {
          ttsJsonPromise = apiJson("/api/tts", {
            method: "POST",
            body: JSON.stringify({ text: spokenTtsText, voice: state.voice }),
            signal: ttsAbort.signal,
          }).catch(() => null);
        } else {
          ttsStreamRespPromise = fetch(resolveUrl("/api/tts/stream"), {
            method: "POST",
            headers: getHeaders({ "Content-Type": "application/json" }),
            body: JSON.stringify({ text: spokenTtsText, voice: state.voice }),
            signal: ttsAbort.signal,
          }).catch(() => null);
        }
      }

      renderView();

      // Finish hearing user's mirror clip (started at t=0s) without cutting it off, then play Sensei TTS!
      await mirrorPlayPromise;
      if (seq !== turnChoreographySeq) {
        if (ttsAbort) ttsAbort.abort();
        return;
      }

      const attachTeacherCacheUrl = (teacherUrl) => {
        if (!teacherUrl) return;
        res.teacherAudioUrl = teacherUrl;
        const tBtn = document.getElementById("sensei-diag-teacher-play");
        if (tBtn) {
          tBtn.dataset.playUrl = teacherUrl;
          tBtn.removeAttribute("data-tts-text");
          tBtn.onclick = () => playUrlAsync(teacherUrl);
        }
      };

      if (res.teacherAudioUrl) {
        state.mirrorPhase = "teacher_explain";
        updateMirrorPhaseDom();
        await playUrlAsync(res.teacherAudioUrl);
        if (seq !== turnChoreographySeq) return;
      } else if (spokenTtsText) {
        state.mirrorPhase = "teacher_explain";
        updateMirrorPhaseDom();
        await playTextTtsStream(spokenTtsText, {
          prefetchedRespPromise: ttsStreamRespPromise,
          prefetchedTtsJsonPromise: ttsJsonPromise,
          abortCtrl: ttsAbort,
          onCacheUrl: attachTeacherCacheUrl,
        });
        if (seq !== turnChoreographySeq) return;
      }

      if (
        (res.decision === "pass" || res.decision === "advance") &&
        state.lessonSession?.lessonMeta?.lessonId &&
        step.stepIndex >= (state.lessonSession.steps || []).length - 1
      ) {
        loadSyllabus();
      }

      if ((res.decision === "retry_chunk" || res.decision === "retry_full") && state.autoReopenMic) {
        await maybeAutoOpenMic(seq);
      } else if (
        (res.decision === "pass" || res.decision === "advance") &&
        state.autoAdvanceOnPass &&
        state.lessonSession &&
        state.lessonStepIdx < state.lessonSession.steps.length - 1
      ) {
        if (!isIOSDevice) playSoftChime("pass");
        state.mirrorPhase = "auto_next";
        updateMirrorPhaseDom();
        clearAutoAdvanceTimer();
        autoAdvanceTimer = setTimeout(() => {
          if (seq === turnChoreographySeq && state.subTab === "lesson" && !state.isRecordingTurn && !state.isEvaluatingTurn) {
            advanceLessonStep(1);
          }
        }, 1200);
      } else {
        state.mirrorPhase = "";
        updateMirrorPhaseDom();
      }
    } catch (err) {
      clearTimeout(abortTimeoutId);
      clearEvalProgress();
      if (seq !== turnChoreographySeq) return;
      state.isEvaluatingTurn = false;
      state.mirrorPhase = "";
      renderView();
      const isTimeout = err.name === "AbortError";
      showToast(isTimeout ? "⏳ 网络或模型响应超时（已自动释放），请再读一次或切到极速模型" : `❌ 私教评估失败：${err.message}`);
    }
  }

  function updateMirrorPhaseDom() {
    const el = document.getElementById("sensei-mirror-banner");
    if (!el) return;
    if (state.mirrorPhase === "user_mirror_eval") {
      el.textContent = "1️⃣ 声学镜子：正立即回放你的原声，老师同步逐拍诊断中...";
      el.style.display = "block";
    } else if (state.mirrorPhase === "user_mirror") {
      el.textContent = "1️⃣ 声学镜子：正在回放你刚才的录音，仔细听一听...";
      el.style.display = "block";
    } else if (state.mirrorPhase === "teacher_explain") {
      el.textContent = "2️⃣ 私教讲解示范中，听完将自动为你开麦...";
      el.style.display = "block";
    } else if (state.mirrorPhase === "ready_retry") {
      el.textContent = "3️⃣ 自动开麦：叮！请直接开口，说完停顿 1.3 秒自动结束";
      el.style.display = "block";
    } else if (state.mirrorPhase === "auto_next") {
      el.textContent = "🎉 本步过关！1.2 秒后自动进入下一步并开麦...";
      el.style.display = "block";
    } else {
      el.style.display = "none";
    }
  }

  // ==================== Real-Time Live Voice Call Mode (/ws/live) ====================
  function updateCallStatusDom() {
    const orb = document.getElementById("sensei-call-orb");
    const lbl = document.getElementById("sensei-call-status-label");
    if (orb) {
      orb.className = `sensei-call-orb state-${state.callStatus}`;
    }
    if (lbl) {
      const map = {
        idle: "待命 · 点击下方「开始实时通话」立即连线",
        connecting: "正在建立超低延迟语音通道 (Gemini Live)...",
        listening: state.audioOutputMode === "speaker" ? "外放模式就绪 · 请直接开口说话" : "全双工聆听中 · 可随时开口或打断老师",
        ai_speaking: state.audioOutputMode === "speaker" ? "老师正在说话（外放防回音已暂闭麦，可点下方插话）" : "老师正在说话 · 你可以随时开口插话打断",
      };
      lbl.textContent = map[state.callStatus] || "";
    }
  }

  async function startLiveCall() {
    if (state.callActive) return;
    stopSimpleAudio();

    try {
      // Single user-gesture unlock for iPhone Safari & Chrome Web Audio
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      liveCtx = new AudioCtx({ sampleRate: 48000 });
      if (liveCtx.state === "suspended") {
        await liveCtx.resume();
      }
      liveNextPlayTime = liveCtx.currentTime;

      liveMicStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      state.callActive = true;
      state.callStatus = "connecting";
      state.liveMessages = [];
      state.liveHints = [];
      state.liveReport = null;
      state.liveStartedAt = Date.now();
      renderView();

      const ws = new WebSocket(wsUrl("/ws/live"));
      ws.binaryType = "arraybuffer";
      liveWs = ws;

      ws.onopen = async () => {
        const localKey = (localStorage.getItem(GEMINI_KEY_STORAGE) || "").trim();
        ws.send(
          JSON.stringify({
            type: "start_session",
            userId: state.userId,
            scenarioId: state.selectedScenarioId,
            correctionMode: state.correctionMode,
            voice: state.voice,
            jlptTarget: state.jlptTarget,
            apiKey: localKey,
            passcode: state.passcode,
          })
        );
        await attachMicPipeline(ws);
      };

      ws.onmessage = (ev) => {
        if (ev.data instanceof ArrayBuffer) {
          enqueueLivePcm24k(ev.data);
          return;
        }
        let msg = {};
        try {
          msg = JSON.parse(ev.data);
        } catch {
          return;
        }
        handleLiveServerEvent(msg);
      };

      ws.onerror = () => {
        showToast("❌ 实时语音连接异常，请确认后端和网络。");
      };

      ws.onclose = () => {
        if (state.callActive) {
          stopLiveCall(false);
        }
      };
    } catch (err) {
      await stopLiveCall(false);
      showToast(`❌ 无法启动通话：${err.message}`);
    }
  }

  async function attachMicPipeline(ws) {
    if (!liveCtx || !liveMicStream) return;
    liveSourceNode = liveCtx.createMediaStreamSource(liveMicStream);

    const forwardPcm = (buf) => {
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      if (state.audioOutputMode === "speaker" && state.callStatus === "ai_speaking") {
        return; // Anti-echo speaker gating
      }
      ws.send(buf);
    };

    if (liveCtx.audioWorklet && liveCtx.audioWorklet.addModule) {
      try {
        await liveCtx.audioWorklet.addModule(resolveUrl("/live_audio_worklet.js?v=18"));
        liveWorkletNode = new AudioWorkletNode(liveCtx, "pcm16-capture-processor");
        liveWorkletNode.port.onmessage = (e) => {
          if (e.data && e.data.type === "pcm") {
            forwardPcm(e.data.buffer);
          }
        };
        liveSourceNode.connect(liveWorkletNode);
        return;
      } catch {
        // Fall through to ScriptProcessor fallback
      }
    }

    // Legacy fallback if AudioWorklet unavailable
    const proc = liveCtx.createScriptProcessor(4096, 1, 1);
    const ratio = liveCtx.sampleRate / 16000;
    proc.onaudioprocess = (ev) => {
      const inp = ev.inputBuffer.getChannelData(0);
      const outLen = Math.floor(inp.length / ratio);
      const out = new Int16Array(outLen);
      for (let i = 0; i < outLen; i++) {
        const s = Math.max(-1, Math.min(1, inp[Math.floor(i * ratio)] || 0));
        out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }
      forwardPcm(out.buffer);
    };
    liveScriptNode = proc;
    liveSourceNode.connect(proc);
    proc.connect(liveCtx.destination);
  }

  function upsertLiveMessage(role, msgData) {
    const lastIdx = state.liveMessages.length - 1;
    if (!msgData.final && lastIdx >= 0 && state.liveMessages[lastIdx].role === role && !state.liveMessages[lastIdx].final) {
      state.liveMessages[lastIdx] = { ...state.liveMessages[lastIdx], ...msgData };
      return;
    }
    if (msgData.final && lastIdx >= 0 && state.liveMessages[lastIdx].role === role && !state.liveMessages[lastIdx].final) {
      state.liveMessages[lastIdx] = { ...state.liveMessages[lastIdx], ...msgData, final: true };
      return;
    }
    state.liveMessages.push({ role, ...msgData });
  }

  function handleLiveServerEvent(msg) {
    if (msg.type === "error") {
      showToast(`❌ ${msg.message}`);
      stopLiveCall(false);
      return;
    }
    if (msg.type === "session_ready") {
      state.liveSessionId = msg.sessionId;
      state.callStatus = "listening";
      renderView();
      return;
    }
    if (msg.type === "interrupted") {
      flushLiveAiAudio();
      return;
    }
    if (msg.type === "transcript_user") {
      upsertLiveMessage("user", {
        turnId: msg.turnId,
        text: msg.text,
        final: !!msg.final,
        tokens: msg.tokens || [],
        userAudioUrl: msg.userAudioUrl || "",
      });
      renderLiveChatLog();
      return;
    }
    if (msg.type === "transcript_ai") {
      upsertLiveMessage("sensei", {
        turnId: msg.turnId,
        text: msg.text,
        final: !!msg.final,
        tokens: msg.tokens || [],
      });
      renderLiveChatLog();
      return;
    }
    if (msg.type === "turn_correction") {
      const target = state.liveMessages.find((m) => m.turnId === msg.turnId);
      if (target) {
        target.evaluation = msg.evaluation;
        target.naturalTokens = msg.naturalTokens || [];
        if (msg.userAudioUrl) target.userAudioUrl = msg.userAudioUrl;
        renderLiveChatLog();
      }
      return;
    }
    if (msg.type === "hint_suggestions") {
      state.liveHints = msg.hints || [];
      renderView();
      return;
    }
    if (msg.type === "turn_complete") {
      if (liveAiSources.length === 0 && state.callActive) {
        state.callStatus = "listening";
        updateCallStatusDom();
      }
    }
  }

  function triggerLiveBargeIn() {
    flushLiveAiAudio();
    if (liveWs && liveWs.readyState === WebSocket.OPEN) {
      liveWs.send(JSON.stringify({ type: "barge_in" }));
    }
    state.callStatus = "listening";
    updateCallStatusDom();
  }

  function sendLiveControl(type, extra = {}) {
    if (!liveWs || liveWs.readyState !== WebSocket.OPEN) return;
    liveWs.send(JSON.stringify({ type, ...extra }));
  }

  async function stopLiveCall(generateReport = true) {
    const finishedSessionId = state.liveSessionId;
    const elapsedSec = state.liveStartedAt ? Math.max(1, Math.round((Date.now() - state.liveStartedAt) / 1000)) : 0;

    state.callActive = false;
    state.callStatus = "idle";
    flushLiveAiAudio();

    if (liveWorkletNode) {
      try {
        liveWorkletNode.disconnect();
      } catch {}
      liveWorkletNode = null;
    }
    if (liveScriptNode) {
      try {
        liveScriptNode.disconnect();
      } catch {}
      liveScriptNode = null;
    }
    if (liveSourceNode) {
      try {
        liveSourceNode.disconnect();
      } catch {}
      liveSourceNode = null;
    }
    if (liveMicStream) {
      liveMicStream.getTracks().forEach((t) => t.stop());
      liveMicStream = null;
    }
    if (liveCtx) {
      try {
        await liveCtx.close();
      } catch {}
      liveCtx = null;
    }
    if (liveWs) {
      try {
        if (liveWs.readyState === WebSocket.OPEN) {
          liveWs.send(JSON.stringify({ type: "end_session" }));
        }
        liveWs.close();
      } catch {}
      liveWs = null;
    }

    renderView();

    if (generateReport && finishedSessionId && state.liveMessages.length > 0) {
      showToast("正在生成课后私教战报...");
      try {
        const res = await apiJson(`/api/sessions/${finishedSessionId}/report`, {
          method: "POST",
          body: JSON.stringify({ user_id: state.userId, duration_sec: elapsedSec }),
        });
        state.liveReport = res.report;
        renderView();
      } catch (err) {
        showToast(`战报生成提示：${err.message}`);
      }
    }
  }

  // ==================== Notebook (FSRS + Weaknesses) & Stories ====================
  async function loadNotebookData() {
    try {
      const [mem, cards] = await Promise.all([
        apiJson(`/api/memory?user_id=${encodeURIComponent(state.userId)}`),
        apiJson(`/api/srs/cards?user_id=${encodeURIComponent(state.userId)}`),
      ]);
      state.memoryData = mem;
      state.srsCards = cards.cards || [];
      const nowIso = new Date().toISOString();
      state.reviewQueue = state.srsCards.filter((c) => !c.next_due || c.next_due <= nowIso);
      if (state.reviewQueue.length === 0) {
        state.reviewQueue = state.srsCards.slice(0, 10);
      }
      state.reviewIdx = 0;
      state.reviewShowBack = false;
      renderView();
    } catch (err) {
      showToast(`读取记忆本失败：${err.message}`);
    }
  }

  async function importLegacyToFsrs() {
    const appState = window.JP_APP?.state;
    const modules = window.JP_APP?.getEffectiveModules ? window.JP_APP.getEffectiveModules() : [];
    const items = [];
    if (appState && modules.length) {
      modules.forEach((m) => {
        (m.sections || []).forEach((s) => {
          (s.items || []).forEach((it) => {
            if (appState.starred?.[it.id] || appState.srs?.[it.id]) {
              items.push({ jp: it.jp.replace(/[（(][^()（）]+[）)]/g, ""), cn: it.cn, reading: it.romaji, jlpt: "Travel" });
            }
          });
        });
      });
    }
    if (items.length === 0) {
      items.push(
        { jp: "預ける", lemma: "預ける", reading: "あずける", cn: "寄存、托付", jlpt: "N4" },
        { jp: "予約する", lemma: "予約", reading: "よやく", cn: "预约、预订", jlpt: "N4" }
      );
    }
    try {
      const res = await apiJson("/api/srs/import", {
        method: "POST",
        body: JSON.stringify({ user_id: state.userId, items }),
      });
      showToast(`✅ 成功导入 ${res.imported} 条句子/生词到 FSRS 记忆本`);
      await loadNotebookData();
    } catch (err) {
      showToast(`❌ 导入失败：${err.message}`);
    }
  }

  async function submitFSRSReview(rating) {
    const card = state.reviewQueue[state.reviewIdx];
    if (!card) return;
    try {
      await apiJson("/api/srs/review", {
        method: "POST",
        body: JSON.stringify({ user_id: state.userId, card_id: card.id, rating }),
      });
      state.reviewIdx += 1;
      state.reviewShowBack = false;
      if (state.reviewIdx >= state.reviewQueue.length) {
        showToast("🎉 本轮记忆本复习完成！");
        await loadNotebookData();
      } else {
        renderView();
      }
    } catch (err) {
      showToast(`❌ 复习提交失败：${err.message}`);
    }
  }

  async function loadStories() {
    try {
      const res = await apiJson(`/api/stories?user_id=${encodeURIComponent(state.userId)}`);
      state.stories = res.stories || [];
      renderView();
    } catch {}
  }

  async function createGradedStory() {
    state.generatingStory = true;
    renderView();
    try {
      const res = await apiJson("/api/stories/generate", {
        method: "POST",
        body: JSON.stringify({
          user_id: state.userId,
          jlpt_level: state.jlptTarget,
          scenario_id: state.selectedScenarioId,
          voice: state.voice,
        }),
      });
      if (res.story) {
        state.stories = [res.story, ...state.stories];
      }
      state.generatingStory = false;
      renderView();
      if (res.story?.audio_url) {
        await playUrlAsync(res.story.audio_url);
      }
    } catch (err) {
      state.generatingStory = false;
      renderView();
      showToast(`❌ 生成故事失败：${err.message}`);
    }
  }

  // ==================== Rendering Helpers ====================
  function renderLiveChatLog() {
    const box = document.getElementById("sensei-live-chat");
    if (!box) return;
    if (state.liveMessages.length === 0) {
      box.innerHTML = `<div class="sensei-empty-chat">通话建立后，你与美咲老师的每句对话都会实时转写，支持<strong>点击任意日语词</strong>查释义存卡；右侧异步气泡会在几秒内给出更地道的表达建议。</div>`;
      return;
    }
    box.innerHTML = state.liveMessages
      .map((m) => {
        const isUser = m.role === "user";
        const ev = m.evaluation;
        return `
          <div class="sensei-chat-item ${isUser ? "user" : "ai"}">
            <div class="sensei-chat-meta">${isUser ? "🗣️ 你" : "👩‍🏫 美咲先生"} ${!m.final ? "<span class='sensei-live-dot'>识别中…</span>" : ""}</div>
            <div class="sensei-chat-bubble">
              ${m.tokens && m.tokens.length ? renderTokensHtml(m.tokens, m.text) : escapeHtml(m.text)}
            </div>
            ${
              ev
                ? `<div class="sensei-corr-card ${ev.score >= 88 ? "good" : "fix"}">
                    <div class="sensei-corr-head">
                      <span>${ev.score >= 88 ? "✅ 地道自然" : "🔧 私教润色"} · ${ev.score || 80}分</span>
                      <div class="sensei-corr-btns">
                        ${m.userAudioUrl ? `<button type="button" class="sensei-mini-btn" data-play-url="${escapeHtml(m.userAudioUrl)}">🪞 听我原声</button>` : ""}
                        ${ev.naturalJp ? `<button type="button" class="sensei-mini-btn" data-tts-lang="ja" data-tts-text="${escapeHtml(ev.naturalJp)}">🔊 示范音</button>` : ""}
                      </div>
                    </div>
                    ${ev.naturalJp ? `<div class="sensei-corr-better">${m.naturalTokens?.length ? renderTokensHtml(m.naturalTokens, ev.naturalJp) : escapeHtml(ev.naturalJp)}</div>` : ""}
                    ${ev.pitchTip && ev.pitchTip !== "无" ? `<div class="sensei-corr-note">🎵 音调：${escapeHtml(ev.pitchTip)}</div>` : ""}
                    ${ev.grammarTip ? `<div class="sensei-corr-note">📘 建议：${escapeHtml(ev.grammarTip)}</div>` : ""}
                  </div>`
                : ""
            }
          </div>
        `;
      })
      .join("");
    box.scrollTop = box.scrollHeight;
  }

  function renderOfflineSetupCard() {
    return `
      <div class="sensei-card sensei-offline-card">
        <h3>🧑‍🏫 AI 日语私教工作室（需要连接 FastAPI 私教后端）</h3>
        <p>实时双向语音通话（Gemini 3.8 Live）、声学镜子原声对比纠音、SudachiPy 点词查义与跨设备 FSRS 记忆本由 FastAPI 后端驱动。</p>
        <div class="sensei-code-box">
          <div>1. 在项目根目录运行私教服务：</div>
          <code>.\\server\\.venv\\Scripts\\python.exe -m uvicorn server.main:app --host 127.0.0.1 --port 8000</code>
          <div>2. 打开 <code>http://127.0.0.1:8000</code>，或在下方填入后端地址（支持 Cloud Run HTTPS）：</div>
        </div>
        <div class="sensei-offline-form">
          <input type="text" id="sensei-backend-url-input" class="sensei-input" placeholder="如 http://127.0.0.1:8000 或 https://your-sensei.run.app" value="${escapeHtml(state.backendBase || "http://127.0.0.1:8000")}" />
          <button type="button" class="sensei-btn primary" id="sensei-connect-backend-btn">🔄 连接后端</button>
        </div>
        <p class="sensei-muted-note">💡 提示：现有的「🎙️ 口语跟读」「📚 词汇·动词」「📖 语法」「🗣️ 场景对话」与「📅 行程地图」在纯静态离线模式中仍可继续使用。</p>
      </div>
    `;
  }

  function renderBlackboardHtml(meta) {
    const bb = meta?.blackboard;
    if (!bb || !bb.titleCn) return "";
    return `
      <div class="sensei-blackboard">
        <div class="sensei-bb-head">
          <span>🧑‍🏫 私教黑板 · ${escapeHtml(bb.titleCn)}</span>
          ${meta.level ? `<span class="sensei-badge">${escapeHtml(meta.level)}</span>` : ""}
        </div>
        ${bb.formulaJp ? `<div class="sensei-bb-formula">${escapeHtml(bb.formulaJp)}</div>` : ""}
        ${bb.cnPitfallCn ? `<div class="sensei-bb-pitfall">⚠️ <strong>避坑点拨：</strong>${escapeHtml(bb.cnPitfallCn)}</div>` : ""}
        ${
          bb.contrastBadJp || bb.contrastGoodJp
            ? `<div class="sensei-contrast-row">
                ${bb.contrastBadJp ? `<span class="bad">❌ ${bb.contrastBadTokens?.length ? renderTokensHtml(bb.contrastBadTokens, bb.contrastBadJp) : escapeHtml(bb.contrastBadJp)}</span>` : ""}
                ${bb.contrastGoodJp ? `<span class="good">✅ ${bb.contrastGoodTokens?.length ? renderTokensHtml(bb.contrastGoodTokens, bb.contrastGoodJp) : escapeHtml(bb.contrastGoodJp)}</span>` : ""}
                ${bb.contrastNoteCn ? `<span class="note">（${escapeHtml(bb.contrastNoteCn)}）</span>` : ""}
              </div>`
            : ""
        }
      </div>
    `;
  }

  function renderLessonTab() {
    const step = currentLessonStep();
    const res = state.lastTurnResult;
    const syl = state.syllabus;
    const rec = syl?.recommendedLesson;
    const scenarioOptions = state.scenarios
      .map(
        (s) =>
          `<option value="${escapeHtml(s.id)}" ${s.id === state.selectedScenarioId ? "selected" : ""}>${escapeHtml(s.icon)} ${escapeHtml(s.title)}（${s.category === "daily" ? "日常" : "旅行"}）</option>`
      )
      .join("");

    const trackOptGroups = (syl?.tracks || [])
      .map(
        (tr) => `
        <optgroup label="${escapeHtml(tr.title)}">
          ${(tr.lessons || [])
            .map((l) => {
              const badge = l.status === "completed" ? `✅ ${l.bestScore}分 · ` : rec?.id === l.id ? "🎯 推荐 · " : "";
              return `<option value="${escapeHtml(l.id)}" ${l.id === (state.selectedLessonId || rec?.id) ? "selected" : ""}>${badge}[${escapeHtml(l.level)}] ${escapeHtml(l.title)}</option>`;
            })
            .join("")}
        </optgroup>`
      )
      .join("");

    let selectorBody = "";
    if (state.curriculumMode === "sensei_syllabus") {
      selectorBody = `
        ${
          rec
            ? `<div class="sensei-rec-banner">
                <div class="sensei-rec-info">
                  <div class="sensei-rec-kicker">✨ 老师为你安排的今日课程 · 进度 ${syl.completedCount}/${syl.totalCount} 课</div>
                  <div class="sensei-rec-title">[${escapeHtml(rec.level)}] ${escapeHtml(rec.title)}</div>
                  <div class="sensei-rec-sub">${escapeHtml(rec.subtitle)} · ${escapeHtml(rec.cnPitfall)}</div>
                </div>
                <button type="button" class="sensei-btn primary" id="sensei-start-rec-btn" ${state.isGeneratingLesson ? "disabled" : ""}>
                  ${state.isGeneratingLesson ? "⏳ 老师正在现编教材..." : "🚀 开始今日推荐课"}
                </button>
              </div>`
            : ""
        }
        <div class="sensei-setup-grid">
          <div style="grid-column: span 2;">
            <label class="sensei-lbl">📚 或自选体系化私教大纲（6大进阶阶段 · 16课 · 每次开课现场生成鲜活生活例句）</label>
            <select id="sensei-lesson-select" class="sensei-select">${trackOptGroups}</select>
          </div>
          <div class="sensei-setup-cta">
            <button type="button" class="sensei-btn primary" id="sensei-start-lesson-btn" ${state.isGeneratingLesson ? "disabled" : ""}>
              ${state.isGeneratingLesson ? "⏳ 老师正在现编教材..." : state.lessonSession ? "🔄 用选定课重开一堂" : "🎓 开始选定课程"}
            </button>
          </div>
        </div>
      `;
    } else if (state.curriculumMode === "custom_topic") {
      const chips = [
        "彻底搞懂 あげる / もらう / くれる 的视角",
        "日式委婉拒绝与缓冲语 〜んですけど",
        "和日本同事聊AI科技、工作与周末",
        "真人口语缩略 〜てる / 〜ちゃう / 〜なきゃ",
      ];
      selectorBody = `
        <div class="sensei-custom-box">
          <label class="sensei-lbl">✨ 告诉老师你今天想攻克的任意语法、痛点或生活聊天话题（不限任何固定课本）</label>
          <div class="sensei-offline-form">
            <input type="text" id="sensei-custom-topic-input" class="sensei-input" placeholder="如：区分 わけ / はず；或在东京咖啡店与陌生人聊养娃和编程..." value="${escapeHtml(state.customTopic)}" />
            <button type="button" class="sensei-btn primary" id="sensei-start-lesson-btn" ${state.isGeneratingLesson ? "disabled" : ""}>
              ${state.isGeneratingLesson ? "⏳ 老师正在现场备课..." : "📝 现编教材并开课"}
            </button>
          </div>
          <div class="sensei-quick-chips">
            <span>💡 灵感直选：</span>
            ${chips.map((c) => `<button type="button" class="sensei-mini-btn" data-quick-topic="${escapeHtml(c)}">${escapeHtml(c)}</button>`).join("")}
          </div>
        </div>
      `;
    } else {
      selectorBody = `
        <div class="sensei-setup-grid">
          <div>
            <label class="sensei-lbl">🗺️ 选择旅行/日常专项场景（原有18大旅行场景 + 5大日常高频话题）</label>
            <select id="sensei-scenario-select" class="sensei-select">${scenarioOptions}</select>
          </div>
          <div>
            <label class="sensei-lbl">🎯 训练模式</label>
            <select id="sensei-lesson-type-select" class="sensei-select">
              <option value="guided_10min" ${state.lessonType === "guided_10min" ? "selected" : ""}>完整 10 分钟私教课（热身→微课→纠音→替换）</option>
              <option value="pronunciation_drill" ${state.lessonType === "pronunciation_drill" ? "selected" : ""}>专注声学镜子发音过关特训</option>
              <option value="substitution_drill" ${state.lessonType === "substitution_drill" ? "selected" : ""}>动词槽位口头替换操练（不看答案说日语）</option>
            </select>
          </div>
          <div class="sensei-setup-cta">
            <button type="button" class="sensei-btn primary" id="sensei-start-lesson-btn" ${state.isGeneratingLesson ? "disabled" : ""}>
              ${state.lessonSession ? "🔄 重新生成本课" : "🚀 开始场景私教课"}
            </button>
          </div>
        </div>
      `;
    }

    const isFreeOutput = step?.stage === "FREE_OUTPUT";

    return `
      <div class="sensei-card">
        <div class="sensei-mode-pills">
          <button type="button" class="sensei-mode-pill ${state.curriculumMode === "sensei_syllabus" ? "active" : ""}" data-curmode="sensei_syllabus">👩‍🏫 资深老师体系课 (16课进阶)</button>
          <button type="button" class="sensei-mode-pill ${state.curriculumMode === "custom_topic" ? "active" : ""}" data-curmode="custom_topic">✨ 自由命题现编教材</button>
          <button type="button" class="sensei-mode-pill ${state.curriculumMode === "travel_scenario" ? "active" : ""}" data-curmode="travel_scenario">🗺️ 原旅行场景专项</button>
        </div>

        ${selectorBody}

        <div class="sensei-toggles-row">
          <label class="sensei-chk"><input type="checkbox" id="chk-include-review" ${state.includeReview ? "checked" : ""} /> 🔁 穿插旧词与错题复习</label>
          <label class="sensei-chk"><input type="checkbox" id="chk-mirror-playback" ${state.mirrorPlayback ? "checked" : ""} /> 🪞 立刻回放我的原声</label>
          <label class="sensei-chk"><input type="checkbox" id="chk-auto-reopen" ${state.autoReopenMic ? "checked" : ""} /> 🎙️ 老师说完自动开麦</label>
          <label class="sensei-chk"><input type="checkbox" id="chk-auto-stop" ${state.autoStopSilence ? "checked" : ""} /> 🔇 说完停顿自动结束</label>
          <label class="sensei-chk"><input type="checkbox" id="chk-auto-next" ${state.autoAdvanceOnPass ? "checked" : ""} /> ⏭️ 过关自动下一题</label>
        </div>
      </div>

      ${
        !step
          ? `<div class="sensei-card sensei-welcome-empty">
              <div class="sensei-orb-mini">👩‍🏫</div>
              <h4>资深私教体系已就位：声音地基 → 助词直觉 → 动词反射 → 日常叙事</h4>
              <p>老师不再只绕着旅行句打转，而是像真实 1 对 1 老师那样系统带你突破中文母语盲区，每堂课现编鲜活东京日常教材，并结合你的记忆本弱点动态出题。</p>
            </div>`
          : `
            <div class="sensei-card">
              ${renderBlackboardHtml(state.lessonSession?.lessonMeta)}

              <div class="sensei-stepper">
                ${(state.lessonSession.steps || [])
                  .map(
                    (st, i) =>
                      `<button type="button" class="sensei-step-pill ${i === state.lessonStepIdx ? "active" : i < state.lessonStepIdx ? "done" : ""}" data-jump-step="${i}">${escapeHtml(st.stageLabel)}</button>`
                  )
                  .join("")}
              </div>

              <div class="sensei-stage-head">
                <span class="sensei-badge">${escapeHtml(step.stageLabel)}</span>
                <span class="sensei-attempt-pill">第 ${state.attempt} 次尝试 ${state.drillChunkJp ? "· 拆词单练中" : ""}</span>
              </div>

              <div class="sensei-cue-box">${escapeHtml(step.cueCn)}</div>

              ${
                isFreeOutput && step.questionJp
                  ? `<div class="sensei-free-q">
                      <div class="sensei-free-q-lbl">🗣️ 老师向你提问（请用自己的话直接开口作答）：</div>
                      <div class="sensei-jp-line">${renderTokensHtml(step.questionTokens, step.questionJp)}</div>
                      ${step.questionCn ? `<div class="sensei-cn-line">${escapeHtml(step.questionCn)}</div>` : ""}
                      <div class="sensei-target-actions">
                        <button type="button" class="sensei-mini-btn" data-tts-lang="ja" data-tts-text="${escapeHtml(step.questionJp)}">🔊 重听老师提问</button>
                      </div>
                    </div>`
                  : ""
              }

              ${
                step.hideTarget && !state.peekHint && !res
                  ? `<div class="sensei-hidden-target">
                      <p>${
                        isFreeOutput
                          ? "🌟 <strong>自由表达时间：</strong>没有唯一标准答案！说完直接听老师如何给你润色。"
                          : "🙈 <strong>口头反射挑战：</strong>目标日语已隐藏，请根据上方提示直接用日语说出来！"
                      }</p>
                      <button type="button" class="sensei-mini-btn" id="sensei-peek-btn">${isFreeOutput ? "💡 看一个参考答法" : "💡 实在想不起来，偷看提示"}</button>
                    </div>`
                  : `<div class="sensei-target-card">
                      ${
                        state.drillChunkJp
                          ? `<div class="sensei-chunk-focus">🎯 当前聚焦拆词重练：<strong class="sensei-chunk-word">${state.drillChunkTokens?.length ? renderTokensHtml(state.drillChunkTokens, state.drillChunkJp) : escapeHtml(state.drillChunkJp)}</strong> <button type="button" class="sensei-mini-btn" data-tts-lang="ja" data-tts-text="${escapeHtml(state.drillChunkJp)}">🔊 听词块示范</button></div>`
                          : ""
                      }
                      <div class="sensei-jp-line">${renderTokensHtml(step.tokens, step.targetJp)}</div>
                      <div class="sensei-cn-line">${escapeHtml(step.targetCn)}</div>
                      ${step.tipCn ? `<div class="sensei-tip-line">💡 ${escapeHtml(step.tipCn)}</div>` : ""}
                      <div class="sensei-target-actions">
                        <button type="button" class="sensei-mini-btn" data-tts-lang="ja" data-tts-text="${escapeHtml(step.targetJp)}">🔊 听原生标准示范</button>
                        ${step.teacherPrompt ? `<button type="button" class="sensei-mini-btn" data-tts-text="${escapeHtml(step.teacherPromptTts || step.teacherPrompt)}">👩‍🏫 听老师讲解导入</button>` : ""}
                      </div>
                    </div>`
              }

              <div id="sensei-mirror-banner" class="sensei-mirror-banner" style="display:none;"></div>

              <div class="sensei-mic-dock">
                <button type="button" class="sensei-mic-btn ${state.isRecordingTurn ? "recording" : ""}" id="sensei-record-turn-btn" ${state.isEvaluatingTurn ? "disabled" : ""}>
                  ${
                    state.isEvaluatingTurn
                      ? `<span id="sensei-eval-elapsed">⏳ 老师正在逐拍倾听诊断... (0.0s)</span>`
                      : state.isRecordingTurn
                      ? "⏹️ 正在聆听（说完自动结束 / 点击立即提交）"
                      : state.drillChunkJp
                      ? `🎙️ 跟读词块「${escapeHtml(state.drillChunkJp)}」`
                      : "🎙️ 点击开口回答 / 跟读"
                  }
                </button>
                ${
                  state.isEvaluatingTurn
                    ? `<button type="button" class="sensei-mini-btn" id="sensei-cancel-eval-btn">✕ 取消本次诊断</button>`
                    : ""
                }
                ${
                  state.isRecordingTurn
                    ? `<div class="sensei-vad-wrap">
                        <div class="sensei-vad-track"><div id="sensei-vad-fill" class="sensei-vad-fill"></div></div>
                        <div class="sensei-vad-meta">
                          <span id="sensei-vad-hint" class="sensei-vad-hint">🎙️ 正在聆听，请直接开口说话...</span>
                          <button type="button" class="sensei-mini-btn" id="sensei-cancel-rec-btn">✕ 取消录音</button>
                        </div>
                      </div>`
                    : ""
                }
                <div class="sensei-step-nav">
                  <button type="button" class="sensei-btn ghost" id="sensei-prev-step-btn" ${state.lessonStepIdx === 0 ? "disabled" : ""}>⬅️ 上一步</button>
                  <button type="button" class="sensei-btn ghost" id="sensei-next-step-btn" ${state.lessonStepIdx >= state.lessonSession.steps.length - 1 ? "disabled" : ""}>跳过 / 下一步 ➡️</button>
                </div>
              </div>
            </div>

            ${res ? renderTurnDiagnosisCard(res) : ""}
          `
      }
    `;
  }

  function renderTurnDiagnosisCard(res) {
    const passed = res.decision === "pass";
    const advanced = res.decision === "advance";
    const badgeClass = passed ? "pass" : advanced ? "warn" : "retry";
    const badgeText = passed
      ? "🎉 过关！音调与节奏很稳"
      : advanced
      ? "📝 已记录错题本，建议先继续下一步"
      : res.decision === "retry_chunk"
      ? `🔍 拆词重读中：先读准「${res.drillChunkJp}」`
      : "🔁 请根据老师语音纠音再试一次";

    return `
      <div class="sensei-card sensei-diagnosis-card ${badgeClass}">
        <div class="sensei-diag-top">
          <span class="sensei-diag-badge ${badgeClass}">${badgeText}</span>
          <span class="sensei-score-pill" title="纠音模型：${escapeHtml(res.modelUsed || "")}">总分 ${res.overallScore} · 音调 ${res.pitchScore} · 语法 ${res.grammarScore}${res.evalMs ? ` · ⚡ ${(res.evalMs / 1000).toFixed(1)}s` : ""}</span>
        </div>

        <div class="sensei-diff-grid">
          <div class="sensei-diff-col">
            <div class="sensei-diff-lbl">🗣️ 老师真实听到的你：</div>
            <div class="sensei-diff-val">${renderTokensHtml(res.heardTokens, res.heardJp || "（无清晰人声）")}</div>
            ${res.localMirrorUrl || res.userAudioUrl ? `<button type="button" class="sensei-mini-btn" data-play-url="${escapeHtml(res.localMirrorUrl || res.userAudioUrl)}">🪞 重听我刚才原声</button>` : ""}
          </div>
          <div class="sensei-diff-col">
            <div class="sensei-diff-lbl">🎯 目标标准读法：</div>
            <div class="sensei-diff-val">${renderTokensHtml(res.betterTokens || res.targetTokens, res.betterJp || res.targetJp)}</div>
            <button type="button" class="sensei-mini-btn" id="sensei-diag-teacher-play" ${res.teacherAudioUrl ? `data-play-url="${escapeHtml(res.teacherAudioUrl)}"` : `data-tts-text="${escapeHtml(res.teacherSpokenTts || res.teacherSpokenScript || res.betterJp || res.targetJp)}"`}>👩‍🏫 重听老师纠音示范</button>
          </div>
        </div>

        <div class="sensei-teacher-speech">
          <strong>👩‍🏫 老师纠音口述：</strong>${escapeHtml(res.teacherSpokenScript)}
        </div>

        ${res.pitchNote ? `<div class="sensei-note-row">🎵 <strong>音调诊断：</strong>${escapeHtml(res.pitchNote)}</div>` : ""}
        ${res.grammarNote ? `<div class="sensei-note-row">📘 <strong>语法礼貌：</strong>${escapeHtml(res.grammarNote)}</div>` : ""}

        ${
          (res.extractedVocab || []).length
            ? `<div class="sensei-vocab-chips">
                <span>🔖 重点词汇一键存卡：</span>
                ${res.extractedVocab
                  .map(
                    (v, i) =>
                      `<button type="button" class="sensei-save-vocab-btn" data-save-diag-vocab="${i}">➕ ${escapeHtml(v.surface || v.lemma)} (${escapeHtml(v.meaningCn || v.reading || "")})</button>`
                  )
                  .join("")}
              </div>`
            : ""
        }

        ${
          (passed || advanced) && state.lessonSession && state.lessonStepIdx < state.lessonSession.steps.length - 1
            ? `<div style="margin-top:0.75rem;"><button type="button" class="sensei-btn primary" id="sensei-pass-next-btn">✅ 进入下一步训练 ➡️</button></div>`
            : ""
        }
      </div>
    `;
  }

  function renderCallTab() {
    const scenarioOptions = state.scenarios
      .map(
        (s) =>
          `<option value="${escapeHtml(s.id)}" ${s.id === state.selectedScenarioId ? "selected" : ""}>${escapeHtml(s.icon)} ${escapeHtml(s.title)}</option>`
      )
      .join("");

    return `
      <div class="sensei-card">
        <div class="sensei-setup-grid">
          <div>
            <label class="sensei-lbl">🎭 实时角色扮演场景</label>
            <select id="sensei-call-scenario" class="sensei-select" ${state.callActive ? "disabled" : ""}>${scenarioOptions}</select>
          </div>
          <div>
            <label class="sensei-lbl">👩‍🏫 纠错教学风格</label>
            <select id="sensei-corr-mode" class="sensei-select" ${state.callActive ? "disabled" : ""}>
              <option value="strict" ${state.correctionMode === "strict" ? "selected" : ""}>👩‍🏫 严格私教（出错温柔打断纠音）</option>
              <option value="flow" ${state.correctionMode === "flow" ? "selected" : ""}>🌊 流畅聊天（保持自然，气泡旁微批注）</option>
            </select>
          </div>
          <div>
            <label class="sensei-lbl">📱 手机端声音/回音模式</label>
            <select id="sensei-audio-output-mode" class="sensei-select">
              <option value="headset" ${state.audioOutputMode === "headset" ? "selected" : ""}>🎧 耳机全双工 (AirPods · 随时插话)</option>
              <option value="speaker" ${state.audioOutputMode === "speaker" ? "selected" : ""}>📢 手机外放防回音 (AI说时暂闭麦)</option>
            </select>
          </div>
        </div>

        <div class="sensei-call-stage">
          <div id="sensei-call-orb" class="sensei-call-orb state-${state.callStatus}">🎙️</div>
          <div id="sensei-call-status-label" class="sensei-call-status"></div>
          <div class="sensei-call-controls">
            ${
              !state.callActive
                ? `<button type="button" class="sensei-btn primary big" id="sensei-start-call-btn">📞 开始实时日语语音通话</button>`
                : `
                  <button type="button" class="sensei-btn warn" id="sensei-bargein-btn">✋ 立刻插话 / 打断老师</button>
                  <button type="button" class="sensei-btn ghost" id="sensei-hint-btn">💡 帮我接话</button>
                  <button type="button" class="sensei-btn ghost" id="sensei-slow-btn">🐢 慢点说</button>
                  <button type="button" class="sensei-btn danger" id="sensei-stop-call-btn">📴 挂断并生成战报</button>
                `
            }
          </div>
        </div>

        ${
          state.liveHints.length
            ? `<div class="sensei-hints-drawer">
                <div class="sensei-hints-title">💡 救急接话灵感（直接念出来，或点 🔊 先听一遍）：</div>
                ${state.liveHints
                  .map(
                    (h) => `
                    <div class="sensei-hint-row">
                      <div><strong>${escapeHtml(h.jp)}</strong> <span class="sensei-hint-read">${escapeHtml(h.reading)}</span> · ${escapeHtml(h.cn)}</div>
                      <button type="button" class="sensei-mini-btn" data-tts-lang="ja" data-tts-text="${escapeHtml(h.jp)}">🔊 示范</button>
                    </div>`
                  )
                  .join("")}
              </div>`
            : ""
        }
      </div>

      <div class="sensei-card">
        <div class="sensei-chat-head">💬 实时双轨字幕与异步私教纠错（点击任意日语单词即可查义存卡）</div>
        <div id="sensei-live-chat" class="sensei-live-chat"></div>
      </div>

      ${state.liveReport ? renderReportCard(state.liveReport) : ""}
    `;
  }

  function renderReportCard(r) {
    return `
      <div class="sensei-card sensei-report-card">
        <h4>📊 本场通话私教战报 (Gemini 4 Neon)</h4>
        <div class="sensei-report-scores">
          <span>流利度 <strong>${r.fluencyScore ?? "-"}</strong></span>
          <span>音调 <strong>${r.pitchScore ?? "-"}</strong></span>
          <span>敬语 <strong>${r.keigoScore ?? "-"}</strong></span>
          <span>语法 <strong>${r.grammarScore ?? "-"}</strong></span>
        </div>
        <p>${escapeHtml(r.summaryCn || "")}</p>
        ${
          (r.topMistakes || []).length
            ? `<div class="sensei-report-mistakes"><strong>📌 已自动录入记忆本的重点薄弱项：</strong><ul>${r.topMistakes
                .map((m) => `<li><strong>${escapeHtml(m.patternKey)}</strong>：${escapeHtml(m.detailCn)}（建议：<code>${escapeHtml(m.betterJp)}</code>）</li>`)
                .join("")}</ul></div>`
            : ""
        }
        ${r.nextFocusCn ? `<div class="sensei-note-row">🎯 <strong>下节建议：</strong>${escapeHtml(r.nextFocusCn)}</div>` : ""}
      </div>
    `;
  }

  function renderNotebookTab() {
    const mem = state.memoryData || {};
    const weaknesses = mem.weaknesses || [];
    const currentCard = state.reviewQueue[state.reviewIdx];

    return `
      <div class="sensei-card">
        <div class="sensei-nb-head">
          <div>
            <h4>🧠 统一 FSRS 长期记忆本</h4>
            <p class="sensei-muted-note">总词卡 ${state.srsCards.length} 张 · 当前待复习 ${mem.dueCount ?? 0} 张</p>
          </div>
          <div class="sensei-nb-actions">
            <button type="button" class="sensei-btn ghost" id="sensei-import-legacy-btn">📥 同步原有收藏句</button>
            <button type="button" class="sensei-btn ghost" id="sensei-refresh-nb-btn">🔄 刷新</button>
          </div>
        </div>

        ${
          currentCard
            ? `<div class="sensei-fsrs-card">
                <div class="sensei-fsrs-progress">待复习第 ${state.reviewIdx + 1} / ${state.reviewQueue.length} 张 · ${escapeHtml(currentCard.jlpt || "N4")}</div>
                <div class="sensei-fsrs-front">${escapeHtml(currentCard.surface)}</div>
                <div class="sensei-fsrs-read">${escapeHtml(currentCard.reading || "")} ${escapeHtml(currentCard.pitch_accent || "")}</div>
                ${
                  !state.reviewShowBack
                    ? `<button type="button" class="sensei-btn primary" id="sensei-fsrs-flip-btn">👀 显示中文释义与原例句</button>`
                    : `
                      <div class="sensei-fsrs-back">
                        <div class="sensei-fsrs-meaning">${escapeHtml(currentCard.meaning_cn || "暂无释义")}</div>
                        ${currentCard.context_jp ? `<div class="sensei-fsrs-ctx">📖 ${escapeHtml(currentCard.context_jp)}</div>` : ""}
                        <button type="button" class="sensei-mini-btn" data-tts-lang="ja" data-tts-text="${escapeHtml(currentCard.context_jp || currentCard.surface)}">🔊 朗读例句</button>
                      </div>
                      <div class="sensei-fsrs-ratings">
                        <button type="button" class="sensei-rate-btn r1" data-fsrs-rate="1">😵 忘了 (Again)</button>
                        <button type="button" class="sensei-rate-btn r2" data-fsrs-rate="2">😅 困难 (Hard)</button>
                        <button type="button" class="sensei-rate-btn r3" data-fsrs-rate="3">🙂 记住 (Good)</button>
                        <button type="button" class="sensei-rate-btn r4" data-fsrs-rate="4">⚡ 秒答 (Easy)</button>
                      </div>
                    `
                }
              </div>`
            : `<div class="sensei-empty-chat">暂无待复习词卡。你在任何私教对话或故事中点击任意日语词并「存入记忆本」，或点击右上角「同步原有收藏句」，这里就会自动用 FSRS 算法安排复习！</div>`
        }
      </div>

      <div class="sensei-card">
        <h4>📡 老师长期错题雷达（下次开课优先考这些）</h4>
        ${
          weaknesses.length === 0
            ? `<p class="sensei-muted-note">暂时还没有累积错题。一旦你在跟读或通话中出现促音、音调或助词习惯性失误，老师会自动帮你建档。</p>`
            : `<div class="sensei-weakness-list">
                ${weaknesses
                  .map(
                    (w) => `<div class="sensei-weak-row">
                      <div>
                        <span class="sensei-weak-tag">${escapeHtml(w.issue_type)}</span>
                        <strong>${escapeHtml(w.pattern_key)}</strong>
                        <span class="sensei-weak-count">累计 ${w.occurrences} 次</span>
                      </div>
                      <div class="sensei-weak-note">${escapeHtml(w.note_cn || "")} ${w.example_jp ? `· <code>${escapeHtml(w.example_jp)}</code>` : ""}</div>
                    </div>`
                  )
                  .join("")}
              </div>`
        }
      </div>
    `;
  }

  function renderStoryTab() {
    return `
      <div class="sensei-card">
        <div class="sensei-nb-head">
          <div>
            <h4>🎧 个性化分级日语故事（嵌入你的记忆本生词）</h4>
            <p class="sensei-muted-note">由 Gemini 4 Neon 编剧 + Gemini 3.8 Flash TTS 倾情演绎，点击任意日语单词即可查词存卡。</p>
          </div>
          <button type="button" class="sensei-btn primary" id="sensei-gen-story-btn" ${state.generatingStory ? "disabled" : ""}>
            ${state.generatingStory ? "⏳ 正在创作并录制音频..." : "✨ 为我生成今日专属有声故事"}
          </button>
        </div>
      </div>

      ${
        state.stories.length === 0
          ? `<div class="sensei-card sensei-empty-chat">还没有生成过故事，点击上方「为我生成今日专属有声故事」，把你的 FSRS 生词串成一段 1 分钟日本家庭旅行短剧！</div>`
          : state.stories
              .map(
                (st) => `
              <div class="sensei-card sensei-story-card">
                <div class="sensei-story-head">
                  <div>
                    <span class="sensei-badge">${escapeHtml(st.jlpt_level)}</span>
                    <strong>${escapeHtml(st.title_jp)}</strong>
                    <span class="sensei-muted-note">（${escapeHtml(st.title_cn)}）</span>
                  </div>
                  ${st.audio_url ? `<button type="button" class="sensei-mini-btn" data-play-url="${escapeHtml(st.audio_url)}">▶️ 播放完整有声故事</button>` : ""}
                </div>
                <div class="sensei-story-lines">
                  ${(st.script || [])
                    .map(
                      (seg) => `
                    <div class="sensei-story-seg">
                      <span class="sensei-story-spk">${escapeHtml(seg.speaker)}</span>
                      <div class="sensei-story-body">
                        <div>${renderTokensHtml(seg.tokens, seg.jp)}</div>
                        <div class="sensei-story-cn">${escapeHtml(seg.cn)}</div>
                      </div>
                    </div>`
                    )
                    .join("")}
                </div>
                ${
                  st.comprehension?.question_jp
                    ? `<div class="sensei-story-quiz">
                        <strong>🗣️ 听后思考提问：</strong>${escapeHtml(st.comprehension.question_jp)}
                        <div class="sensei-muted-note">${escapeHtml(st.comprehension.question_cn)} · 参考回答：${escapeHtml(st.comprehension.sample_answer_jp)}</div>
                      </div>`
                    : ""
                }
              </div>`
              )
              .join("")
      }
    `;
  }

  function renderTokenPopover() {
    const tk = state.activeTokenEntry;
    if (!tk) return "";
    return `
      <div class="sensei-dict-backdrop" id="sensei-dict-backdrop">
        <div class="sensei-dict-popover">
          <div class="sensei-dict-top">
            <div>
              <span class="sensei-dict-surface">${escapeHtml(tk.surface)}</span>
              ${tk.lemma && tk.lemma !== tk.surface ? `<span class="sensei-dict-lemma">→ 辞书形：${escapeHtml(tk.lemma)}</span>` : ""}
              ${tk.jlpt ? `<span class="sensei-badge">${escapeHtml(tk.jlpt)}</span>` : ""}
            </div>
            <button type="button" class="sensei-mini-btn" id="sensei-dict-close">✕</button>
          </div>
          <div class="sensei-dict-reading">
            あ ${escapeHtml(tk.reading || "")} ${tk.pitch_accent ? `· 🎵 ${escapeHtml(tk.pitch_accent)}` : ""}
          </div>
          <div class="sensei-dict-meaning">${escapeHtml(tk.meaning_cn || "")}</div>
          ${tk.grammar_note ? `<div class="sensei-dict-note">📘 ${escapeHtml(tk.grammar_note)}</div>` : ""}
          ${tk.example_jp ? `<div class="sensei-dict-ex">例：${escapeHtml(tk.example_jp)} ${tk.example_cn ? `（${escapeHtml(tk.example_cn)}）` : ""}</div>` : ""}
          <div class="sensei-dict-actions">
            <button type="button" class="sensei-btn ghost" data-tts-lang="ja" data-tts-text="${escapeHtml(tk.lemma || tk.surface)}">🔊 听发音</button>
            <button type="button" class="sensei-btn primary" id="sensei-dict-save-btn">➕ 存入 FSRS 记忆本</button>
          </div>
        </div>
      </div>
    `;
  }

  async function render(targetEl) {
    if (targetEl) containerEl = targetEl;
    if (!containerEl) return;

    if (!state.healthChecked) {
      containerEl.innerHTML = `<div class="sensei-shell"><div class="sensei-card">⏳ 正在连接 Nihongo Sensei 私教引擎...</div></div>`;
      await initBackend(false);
    }

    if (!state.backendOnline) {
      containerEl.innerHTML = `<div class="sensei-shell">${renderOfflineSetupCard()}</div>`;
      bindEvents();
      return;
    }

    const userOptions = (state.users.length ? state.users : [{ id: "haodong", display_name: "刘浩东", jlpt_target: "N4" }, { id: "sherry", display_name: "Sherry", jlpt_target: "N5" }])
      .map((u) => `<option value="${escapeHtml(u.id)}" ${u.id === state.userId ? "selected" : ""}>👤 ${escapeHtml(u.display_name)} (${escapeHtml(u.jlpt_target)})</option>`)
      .join("");

    const voices = state.health?.voices || [
      { id: "Aoede", label: "Aoede（温柔女老师）" },
      { id: "Kore", label: "Kore（知性女声）" },
      { id: "Puck", label: "Puck（男老师）" },
    ];
    const voiceOptions = voices
      .map((v) => `<option value="${escapeHtml(v.id)}" ${v.id === state.voice ? "selected" : ""}>🎙️ ${escapeHtml(v.label)}</option>`)
      .join("");

    const defaultCoach = state.health?.models?.coach || "gemini-4-hydrogen";
    const activeCoach = state.coachModel || defaultCoach;
    const coachModels = state.health?.coach_models || [
      { id: "gemini-4-hydrogen", label: "🎯 Gemini 4 Hydrogen（均衡精准 · ~4s · 推荐）" },
      { id: "gemini-3.5-flash-lite", label: "⚡ Gemini 3.5 Flash Lite（极速刷句 · ~1.5s）" },
      { id: "gemini-4-neon", label: "🧠 Gemini 4 Neon（深度精评 · ~10s）" },
    ];
    const coachOptions = coachModels
      .map((m) => `<option value="${escapeHtml(m.id)}" ${m.id === activeCoach ? "selected" : ""}>${escapeHtml(m.label)}</option>`)
      .join("");

    const missingKeyWarning =
      state.health && !state.health.has_server_key && !(localStorage.getItem(GEMINI_KEY_STORAGE) || "").trim()
        ? `<div class="sensei-key-banner">
            ⚠️ 服务端未设置 <code>GEMINI_API_KEY</code>，请临时填入你的本地 Key 测试（仅存本机浏览器或改配 <code>server/.env</code>）：
            <input type="password" id="sensei-inline-key-input" class="sensei-input small" placeholder="AIza..." />
            <button type="button" class="sensei-mini-btn" id="sensei-save-inline-key-btn">保存 Key</button>
          </div>`
        : "";

    const passcodeBanner =
      state.health?.auth_required && !state.passcodeVerified
        ? `<div class="sensei-key-banner">
            🔒 <strong>家庭口令验证：</strong>请输入口令解锁 AI 私教与语音功能（本设备仅需输入一次）：
            <input type="password" inputmode="numeric" id="sensei-passcode-input" class="sensei-input small" placeholder="输入家庭口令..." value="${escapeHtml(state.passcode)}" />
            <button type="button" class="sensei-mini-btn" id="sensei-save-passcode-btn">🔓 解锁</button>
          </div>`
        : "";

    let bodyHtml = "";
    if (state.subTab === "lesson") bodyHtml = renderLessonTab();
    else if (state.subTab === "call") bodyHtml = renderCallTab();
    else if (state.subTab === "notebook") bodyHtml = renderNotebookTab();
    else bodyHtml = renderStoryTab();

    containerEl.innerHTML = `
      <div class="sensei-shell">
        <div class="sensei-topbar">
          <div class="sensei-brand">
            <span class="sensei-status-dot online" title="FastAPI 私教后端已就绪"></span>
            <div>
              <h2>🧑‍🏫 Nihongo Sensei AI 语音私教工作室</h2>
              <div class="sensei-model-pills">
                <span>Live: ${escapeHtml(state.health?.models?.live || "gemini-3.8-live")}</span>
                <span>纠音裁判: ${escapeHtml(activeCoach)}</span>
                <span>语音合成: ${escapeHtml(state.health?.models?.tts_fast || "gemini-3.8-flash-lite-tts")}</span>
              </div>
            </div>
          </div>
          <div class="sensei-profile-bar">
            <select id="sensei-user-select" class="sensei-select compact">${userOptions}</select>
            <select id="sensei-coach-select" class="sensei-select compact" title="切换纠音裁判模型">${coachOptions}</select>
            <select id="sensei-voice-select" class="sensei-select compact">${voiceOptions}</select>
          </div>
        </div>

        ${missingKeyWarning}
        ${passcodeBanner}

        <div class="sensei-subtabs">
          <button type="button" class="sensei-subtab ${state.subTab === "lesson" ? "active" : ""}" data-subtab="lesson">🎓 10分钟私教课 & 纠音</button>
          <button type="button" class="sensei-subtab ${state.subTab === "call" ? "active" : ""}" data-subtab="call">📞 实时语音通话</button>
          <button type="button" class="sensei-subtab ${state.subTab === "notebook" ? "active" : ""}" data-subtab="notebook">📒 老师记忆本 (FSRS)</button>
          <button type="button" class="sensei-subtab ${state.subTab === "story" ? "active" : ""}" data-subtab="story">🎧 分级有声故事</button>
        </div>

        ${bodyHtml}
        ${renderTokenPopover()}
      </div>
    `;

    bindEvents();
    updateMirrorPhaseDom();
    if (state.subTab === "call") {
      updateCallStatusDom();
      renderLiveChatLog();
    }
  }

  function renderView() {
    render(containerEl);
  }

  function bindEvents() {
    if (!containerEl) return;

    const connBtn = containerEl.querySelector("#sensei-connect-backend-btn");
    if (connBtn) {
      connBtn.onclick = async () => {
        const val = (containerEl.querySelector("#sensei-backend-url-input")?.value || "").trim().replace(/\/+$/, "");
        state.backendBase = val;
        localStorage.setItem(BACKEND_URL_STORAGE, val);
        state.healthChecked = false;
        await renderView();
      };
    }

    const saveKeyBtn = containerEl.querySelector("#sensei-save-inline-key-btn");
    if (saveKeyBtn) {
      saveKeyBtn.onclick = () => {
        const key = (containerEl.querySelector("#sensei-inline-key-input")?.value || "").trim();
        if (!key) return;
        localStorage.setItem(GEMINI_KEY_STORAGE, key);
        showToast("✅ 已保存本地 Gemini Key");
        renderView();
      };
    }

    const passcodeInput = containerEl.querySelector("#sensei-passcode-input");
    const savePasscodeBtn = containerEl.querySelector("#sensei-save-passcode-btn");
    const submitPasscode = async () => {
      const code = (passcodeInput?.value || "").trim();
      if (!code) return;
      state.passcode = code;
      try {
        await apiJson("/api/auth/verify", { method: "POST" });
        localStorage.setItem(PASSCODE_STORAGE, code);
        state.passcodeVerified = true;
        showToast("✅ 家庭口令已解锁");
        renderView();
      } catch {
        state.passcode = "";
        state.passcodeVerified = false;
        localStorage.removeItem(PASSCODE_STORAGE);
        showToast("❌ 口令错误，请重试");
      }
    };
    if (savePasscodeBtn) savePasscodeBtn.onclick = submitPasscode;
    if (passcodeInput) {
      passcodeInput.onkeydown = (e) => {
        if (e.key === "Enter") submitPasscode();
      };
    }

    const userSel = containerEl.querySelector("#sensei-user-select");
    if (userSel) {
      userSel.onchange = async () => {
        state.userId = userSel.value;
        localStorage.setItem(USER_STORAGE, state.userId);
        const u = state.users.find((x) => x.id === state.userId);
        if (u) state.jlptTarget = u.jlpt_target || state.jlptTarget;
        state.selectedLessonId = "";
        await loadSyllabus();
        if (state.subTab === "notebook") await loadNotebookData();
        else if (state.subTab === "story") await loadStories();
        else renderView();
      };
    }

    const coachSel = containerEl.querySelector("#sensei-coach-select");
    if (coachSel) {
      coachSel.onchange = () => {
        state.coachModel = coachSel.value;
        localStorage.setItem(COACH_MODEL_STORAGE, state.coachModel);
        renderView();
      };
    }

    const voiceSel = containerEl.querySelector("#sensei-voice-select");
    if (voiceSel) {
      voiceSel.onchange = () => {
        state.voice = voiceSel.value;
        localStorage.setItem(VOICE_STORAGE, state.voice);
      };
    }

    containerEl.querySelectorAll("[data-subtab]").forEach((btn) => {
      btn.onclick = async () => {
        const tab = btn.dataset.subtab;
        if (state.subTab === tab) return;
        if (state.callActive && tab !== "call") {
          await stopLiveCall(true);
        }
        state.subTab = tab;
        renderView();
        if (tab === "notebook") await loadNotebookData();
        else if (tab === "story") await loadStories();
      };
    });

    // Guided lesson bindings
    containerEl.querySelectorAll("[data-curmode]").forEach((btn) => {
      btn.onclick = () => {
        state.curriculumMode = btn.dataset.curmode;
        renderView();
      };
    });
    const lessonSel = containerEl.querySelector("#sensei-lesson-select");
    if (lessonSel) lessonSel.onchange = () => { state.selectedLessonId = lessonSel.value; };
    const customInput = containerEl.querySelector("#sensei-custom-topic-input");
    if (customInput) customInput.oninput = () => { state.customTopic = customInput.value; };
    containerEl.querySelectorAll("[data-quick-topic]").forEach((btn) => {
      btn.onclick = () => {
        state.customTopic = btn.dataset.quickTopic;
        startGuidedLesson({ curriculumMode: "custom_topic", customTopic: state.customTopic });
      };
    });
    const startRecBtn = containerEl.querySelector("#sensei-start-rec-btn");
    if (startRecBtn) {
      startRecBtn.onclick = () =>
        startGuidedLesson({
          curriculumMode: "sensei_syllabus",
          lessonId: state.syllabus?.recommendedLesson?.id,
        });
    }

    const scSel = containerEl.querySelector("#sensei-scenario-select");
    if (scSel) scSel.onchange = () => { state.selectedScenarioId = scSel.value; };
    const ltSel = containerEl.querySelector("#sensei-lesson-type-select");
    if (ltSel) ltSel.onchange = () => { state.lessonType = ltSel.value; };
    const chkReview = containerEl.querySelector("#chk-include-review");
    if (chkReview) {
      chkReview.onchange = () => {
        state.includeReview = chkReview.checked;
        localStorage.setItem(INCLUDE_REVIEW_STORAGE, state.includeReview ? "true" : "false");
      };
    }
    const chkMirror = containerEl.querySelector("#chk-mirror-playback");
    if (chkMirror) chkMirror.onchange = () => { state.mirrorPlayback = chkMirror.checked; };
    const chkAuto = containerEl.querySelector("#chk-auto-reopen");
    if (chkAuto) chkAuto.onchange = () => { state.autoReopenMic = chkAuto.checked; };
    const chkAutoStop = containerEl.querySelector("#chk-auto-stop");
    if (chkAutoStop) chkAutoStop.onchange = () => { state.autoStopSilence = chkAutoStop.checked; };
    const chkAutoNext = containerEl.querySelector("#chk-auto-next");
    if (chkAutoNext) chkAutoNext.onchange = () => { state.autoAdvanceOnPass = chkAutoNext.checked; };

    const startLessonBtn = containerEl.querySelector("#sensei-start-lesson-btn");
    if (startLessonBtn) startLessonBtn.onclick = () => startGuidedLesson();

    const peekBtn = containerEl.querySelector("#sensei-peek-btn");
    if (peekBtn) peekBtn.onclick = () => { state.peekHint = true; renderView(); };

    const recBtn = containerEl.querySelector("#sensei-record-turn-btn");
    if (recBtn) recBtn.onclick = () => toggleLessonRecording();

    const cancelRecBtn = containerEl.querySelector("#sensei-cancel-rec-btn");
    if (cancelRecBtn) cancelRecBtn.onclick = cancelLessonRecording;

    const cancelEvalBtn = containerEl.querySelector("#sensei-cancel-eval-btn");
    if (cancelEvalBtn) cancelEvalBtn.onclick = cancelTurnEvaluation;

    const prevBtn = containerEl.querySelector("#sensei-prev-step-btn");
    if (prevBtn) prevBtn.onclick = () => advanceLessonStep(-1);
    const nextBtn = containerEl.querySelector("#sensei-next-step-btn");
    if (nextBtn) nextBtn.onclick = () => advanceLessonStep(1);
    const passNextBtn = containerEl.querySelector("#sensei-pass-next-btn");
    if (passNextBtn) passNextBtn.onclick = () => advanceLessonStep(1);

    containerEl.querySelectorAll("[data-jump-step]").forEach((btn) => {
      btn.onclick = () => {
        const idx = Number(btn.dataset.jumpStep);
        if (!Number.isNaN(idx)) advanceLessonStep(idx - state.lessonStepIdx);
      };
    });

    containerEl.querySelectorAll("[data-save-diag-vocab]").forEach((btn) => {
      btn.onclick = () => {
        const v = (state.lastTurnResult?.extractedVocab || [])[Number(btn.dataset.saveDiagVocab)];
        if (v) saveTokenToSrs({ ...v, context_jp: state.lastTurnResult?.targetJp || "" });
      };
    });

    // Live Call bindings
    const callScSel = containerEl.querySelector("#sensei-call-scenario");
    if (callScSel) callScSel.onchange = () => { state.selectedScenarioId = callScSel.value; };
    const corrModeSel = containerEl.querySelector("#sensei-corr-mode");
    if (corrModeSel) corrModeSel.onchange = () => { state.correctionMode = corrModeSel.value; };
    const outModeSel = containerEl.querySelector("#sensei-audio-output-mode");
    if (outModeSel) outModeSel.onchange = () => { state.audioOutputMode = outModeSel.value; updateCallStatusDom(); };

    const startCallBtn = containerEl.querySelector("#sensei-start-call-btn");
    if (startCallBtn) startCallBtn.onclick = startLiveCall;
    const stopCallBtn = containerEl.querySelector("#sensei-stop-call-btn");
    if (stopCallBtn) stopCallBtn.onclick = () => stopLiveCall(true);
    const bargeBtn = containerEl.querySelector("#sensei-bargein-btn");
    if (bargeBtn) bargeBtn.onclick = triggerLiveBargeIn;
    const hintBtn = containerEl.querySelector("#sensei-hint-btn");
    if (hintBtn) hintBtn.onclick = () => sendLiveControl("hint_request");
    const slowBtn = containerEl.querySelector("#sensei-slow-btn");
    if (slowBtn) slowBtn.onclick = () => sendLiveControl("slow_down");

    // Notebook & Story bindings
    const impBtn = containerEl.querySelector("#sensei-import-legacy-btn");
    if (impBtn) impBtn.onclick = importLegacyToFsrs;
    const refBtn = containerEl.querySelector("#sensei-refresh-nb-btn");
    if (refBtn) refBtn.onclick = loadNotebookData;
    const flipBtn = containerEl.querySelector("#sensei-fsrs-flip-btn");
    if (flipBtn) flipBtn.onclick = () => { state.reviewShowBack = true; renderView(); };
    containerEl.querySelectorAll("[data-fsrs-rate]").forEach((btn) => {
      btn.onclick = () => submitFSRSReview(Number(btn.dataset.fsrsRate));
    });

    const genStoryBtn = containerEl.querySelector("#sensei-gen-story-btn");
    if (genStoryBtn) genStoryBtn.onclick = createGradedStory;

    // Shared audio & Tap-Any-Word token popover bindings
    containerEl.querySelectorAll("[data-play-url]").forEach((btn) => {
      btn.onclick = () => {
        ensureLessonAudioCtx();
        const url = btn.dataset.playUrl;
        if (!isIOSDevice && url && url === localMirrorBlobUrl && lastMirrorBlob) {
          return playBlobViaWebAudio(lastMirrorBlob, url);
        }
        return playUrlAsync(url);
      };
    });
    containerEl.querySelectorAll("[data-tts-text]").forEach((btn) => {
      btn.onclick = () => playTextTts(btn.dataset.ttsText, { lang: btn.dataset.ttsLang || null });
    });
    containerEl.querySelectorAll("[data-tok-surface]").forEach((btn) => {
      btn.onclick = () =>
        openWordLookup(
          btn.dataset.tokSurface,
          btn.dataset.tokLemma,
          btn.dataset.tokReading,
          btn.dataset.tokContext
        );
    });

    const dictClose = containerEl.querySelector("#sensei-dict-close");
    if (dictClose) dictClose.onclick = () => { state.activeTokenEntry = null; renderView(); };
    const dictBackdrop = containerEl.querySelector("#sensei-dict-backdrop");
    if (dictBackdrop) {
      dictBackdrop.onclick = (e) => {
        if (e.target === dictBackdrop) {
          state.activeTokenEntry = null;
          renderView();
        }
      };
    }
    const dictSave = containerEl.querySelector("#sensei-dict-save-btn");
    if (dictSave) {
      dictSave.onclick = async () => {
        await saveTokenToSrs(state.activeTokenEntry);
        state.activeTokenEntry = null;
        renderView();
      };
    }
  }

  function stopAll() {
    clearAutoAdvanceTimer();
    turnChoreographySeq += 1;
    state.mirrorPhase = "";
    stopSimpleAudio();
    if (state.isEvaluatingTurn) {
      cancelTurnEvaluation();
    }
    if (state.isRecordingTurn) {
      cancelLessonRecording();
    }
    if (state.callActive) {
      stopLiveCall(false);
    }
  }

  if (typeof document !== "undefined") {
    const primeIosAudioOnce = () => {
      unlockSharedAudioEl();
      if (!isIOSDevice) {
        ensureLessonTtsCtx(24000);
      }
      if (sharedAudioUnlocked) {
        document.removeEventListener("touchstart", primeIosAudioOnce, true);
        document.removeEventListener("click", primeIosAudioOnce, true);
      }
    };
    document.addEventListener("touchstart", primeIosAudioOnce, { capture: true, passive: true });
    document.addEventListener("click", primeIosAudioOnce, { capture: true, passive: true });
  }

  window.JP_SENSEI = {
    render,
    stopAll,
    initBackend,
  };
})();
