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

  const isIOSDevice =
    /iPad|iPhone|iPod/.test(navigator.userAgent || "") ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

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
    curriculumMode: "sensei_syllabus", // sensei_syllabus | grammar_point | custom_topic | travel_scenario
    selectedLessonId: "",
    syllabusLevelFilter: "all",
    selectedGrammarId: "",
    grammarLevelFilter: "all",
    grammarQuery: "",
    customTopic: "",
    selectedScenarioId: "1",
    lessonType: "guided_10min",
    jlptTarget: "N4",

    // Guided Lesson state
    lessonSession: null,
    isGeneratingLesson: false,
    isExtendingLesson: false,
    previewChapter: null,
    loadingChapter: false,
    lessonStepIdx: 0,
    attempt: 1,
    drillChunkJp: "",
    drillChunkTokens: [],
    peekHint: false,
    mirrorPlayback: true,
    autoReopenMic: !isIOSDevice,
    autoStopSilence: true,
    autoAdvanceOnPass: true,
    isRecordingTurn: false,
    isEvaluatingTurn: false,
    mirrorPhase: "", // "" | "user_mirror_eval" | "user_mirror" | "teacher_explain" | "ready_retry" | "auto_next"
    lastTurnResult: null,
    turnHistory: [],
    favorites: [],
    lastStepAttemptCtx: null,
    consolidatingFull: false,
    followupAnswer: null,
    followupLoading: false,
    followupInput: "",

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

    // Word popover & Editorial Drawer UI state
    activeTokenEntry: null,
    loadingToken: false,
    drawerOpen: false,
    showBlackboard: false,
    showCallSettings: false,
  };

  let containerEl = null;
  let notebookContainerEl = null;
  let currentAudioEl = null;
  let currentAudioDoneResolve = null;
  let sharedAudioEl = null;
  let sharedAudioUnlocked = false;
  let localMirrorBlobUrl = "";
  let lastMirrorBlob = null;
  let activeMirrorPlayId = 0;
  let isStartingRecording = false;
  let iosRecTimerInterval = null;
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

  function encodeMonoPcmWavBlob(samples, sampleRate, gain = 1.0) {
    const len = samples?.length || 0;
    const sr = Math.max(8000, Math.round(sampleRate || 16000));
    const buf = new ArrayBuffer(44 + len * 2);
    const view = new DataView(buf);
    const writeStr = (off, str) => {
      for (let i = 0; i < str.length; i++) view.setUint8(off + i, str.charCodeAt(i));
    };
    writeStr(0, "RIFF");
    view.setUint32(4, 36 + len * 2, true);
    writeStr(8, "WAVE");
    writeStr(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sr, true);
    view.setUint32(28, sr * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeStr(36, "data");
    view.setUint32(40, len * 2, true);
    for (let i = 0; i < len; i++) {
      let v = samples[i] * gain;
      const absV = Math.abs(v);
      if (absV > 0.9) {
        const sgn = v < 0 ? -1 : 1;
        v = sgn * (0.9 + 0.08 * Math.tanh((absV - 0.9) * 3.0));
      }
      const s16 = Math.max(-32767, Math.min(32767, Math.round(v * 32767)));
      view.setInt16(44 + i * 2, s16, true);
    }
    return new Blob([buf], { type: "audio/wav" });
  }

  async function inspectRecordedAudioBlob(blob) {
    if (!blob || !blob.size) {
      return { analyzed: true, hasSpeech: false, reason: "empty" };
    }
    const OfflineCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const ctx =
      isIOSDevice && OfflineCtx
        ? new OfflineCtx(1, 1, 24000)
        : ensureLessonTtsCtx(24000) || ensureLessonAudioCtx();
    if (!ctx || typeof ctx.decodeAudioData !== "function") {
      return { analyzed: false, hasSpeech: true, reason: "no_ctx" };
    }
    try {
      if (ctx.state === "suspended" || ctx.state === "interrupted") {
        await ctx.resume().catch(() => {});
      }
      const arrayBuf = await blob.arrayBuffer();
      const audioBuf = await ctx.decodeAudioData(arrayBuf.slice(0));
      const duration = audioBuf.duration || 0;
      const samples = audioBuf.getChannelData(0);
      const sr = audioBuf.sampleRate || 16000;
      if (!samples || !samples.length) {
        return { analyzed: true, hasSpeech: false, reason: "empty" };
      }

      let peak = 0;
      let sqSum = 0;
      for (let i = 0; i < samples.length; i++) {
        const s = samples[i];
        const a = Math.abs(s);
        if (a > peak) peak = a;
        sqSum += s * s;
      }
      const rms = Math.sqrt(sqSum / samples.length);

      const frameLen = Math.max(1, Math.round(sr * 0.02));
      const frameStats = [];
      for (let i = 0; i < samples.length; i += frameLen) {
        const end = Math.min(samples.length, i + frameLen);
        let fSq = 0;
        let fPeak = 0;
        for (let j = i; j < end; j++) {
          const s = samples[j];
          const a = Math.abs(s);
          if (a > fPeak) fPeak = a;
          fSq += s * s;
        }
        frameStats.push({ rms: Math.sqrt(fSq / (end - i)), peak: fPeak });
      }
      const sortedRms = frameStats.map((f) => f.rms).sort((a, b) => a - b);
      const p10Rms = sortedRms.length >= 5 ? sortedRms[Math.floor(sortedRms.length / 10)] : 0;
      const topRms = sortedRms[sortedRms.length - 1] || 0;
      const rmsThresh = p10Rms < 0.0035 ? Math.max(0.0025, p10Rms * 1.6) : 0.0035;
      const peakFrameThresh = Math.max(0.006, rmsThresh * 1.6);
      let activeFrames = 0;
      for (const f of frameStats) {
        if (f.rms >= rmsThresh && f.peak >= peakFrameThresh) activeFrames += 1;
      }
      const activeSpeechMs = Math.round(activeFrames * (frameLen / sr) * 1000);
      const hasSpeech = !(
        duration < 0.20 ||
        peak < 0.005 ||
        topRms < 0.002 ||
        activeSpeechMs < 60
      );
      let boostedBlob = null;
      if (hasSpeech && peak > 0.002 && peak < 0.55) {
        const gain = Math.min(18.0, 0.72 / peak);
        boostedBlob = encodeMonoPcmWavBlob(samples, sr, gain);
      }
      return {
        analyzed: true,
        hasSpeech,
        duration,
        peak,
        rms,
        activeSpeechMs,
        boostedBlob,
      };
    } catch {
      return { analyzed: false, hasSpeech: true, reason: "decode_skipped" };
    }
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
      await Promise.all([loadSyllabus(), loadFavorites()]);
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

  function normalizeFavJp(jp) {
    return String(jp || "")
      .replace(/[（(][^()（）]+[）)]/g, "")
      .replace(/\s+/g, "")
      .trim();
  }

  function findFavoriteByJp(jp) {
    const key = normalizeFavJp(jp);
    if (!key) return null;
    return (state.favorites || []).find((f) => normalizeFavJp(f.jp) === key) || null;
  }

  async function loadFavorites() {
    try {
      const res = await apiJson(`/api/favorites?user_id=${encodeURIComponent(state.userId)}`);
      state.favorites = res.favorites || [];
    } catch {}
  }

  async function toggleFavoriteSentence(payload) {
    const rawJp = String(payload?.jp || "")
      .replace(/[（(][^()（）]+[）)]/g, "")
      .trim();
    if (!rawJp) return;
    const existing = findFavoriteByJp(rawJp);
    try {
      if (existing) {
        await apiJson(
          `/api/favorites/${encodeURIComponent(existing.id)}?user_id=${encodeURIComponent(state.userId)}`,
          { method: "DELETE" }
        );
        state.favorites = (state.favorites || []).filter((f) => f.id !== existing.id);
        showToast("已从常练收藏中移除");
      } else {
        const res = await apiJson("/api/favorites", {
          method: "POST",
          body: JSON.stringify({
            user_id: state.userId,
            jp: rawJp,
            cn: payload?.cn || "",
            reading: payload?.reading || "",
            tip_cn: payload?.tipCn || "",
            lesson_title: payload?.lessonTitle || "",
            level: payload?.level || state.jlptTarget || "N4",
            grammar_focus: payload?.grammarFocus || "",
          }),
        });
        if (res && res.favorite) {
          state.favorites = [
            res.favorite,
            ...(state.favorites || []).filter((f) => f.id !== res.favorite.id),
          ];
        }
        showToast("⭐ 已收藏该句，可随时在「收藏常练句」重练");
      }
      renderView();
    } catch (err) {
      showToast(`❌ 收藏操作失败：${err.message}`);
    }
  }

  async function startFavoritesPractice(singleFavId = "") {
    if (!state.healthChecked) {
      await initBackend(false);
    }
    const senseiNavBtn = document.getElementById("mode-btn-sensei");
    if (senseiNavBtn && !senseiNavBtn.classList.contains("active")) {
      senseiNavBtn.click();
    }
    state.subTab = "lesson";
    state.drawerOpen = false;
    await startGuidedLesson({
      curriculumMode: "favorites",
      lessonId: singleFavId ? `fav:${singleFavId}` : "",
    });
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
        const diffCls =
          tk.status === "sub"
            ? " diff-sub"
            : tk.status === "extra"
            ? " diff-extra"
            : tk.status === "missing"
            ? " diff-missing"
            : "";
        return `<button type="button" class="sensei-tok ${tk.is_content_word ? "content" : "func"}${diffCls}"
          data-tok-surface="${surf}"
          data-tok-lemma="${escapeHtml(tk.lemma || tk.surface)}"
          data-tok-reading="${escapeHtml(tk.reading || "")}"
          data-tok-context="${escapeHtml(contextJp || "")}"
          title="${escapeHtml(tk.reading ? tk.reading + (tk.meaning_cn ? " · " + tk.meaning_cn : "") : "点击查词")}">${labelHtml}</button>`;
      })
      .join("");
  }

  function renderDiffTokensHtml(diffItems, fallbackTokens, contextJp) {
    const list = Array.isArray(diffItems) && diffItems.length ? diffItems : fallbackTokens;
    return renderTokensHtml(list, contextJp);
  }

  function renderPitchSparklineHtml(audioStats) {
    if (!audioStats || !audioStats.analyzed) return "";
    const activeSec = ((audioStats.activeSpeechMs || 0) / 1000).toFixed(1);
    const pauseCnt = Number(audioStats.internalPauseCount || 0);
    const spread = Number(audioStats.pitchSpreadSemitones || 0);
    const contour = Array.isArray(audioStats.pitchContour) ? audioStats.pitchContour : [];

    const statsParts = [`发声 ${activeSec}s`];
    if (pauseCnt > 0) {
      statsParts.push(`停顿 ${pauseCnt}次`);
    }
    if (spread > 0) {
      statsParts.push(`音高起伏 ${spread.toFixed(1)}半音`);
    }

    let svgHtml = "";
    const validPts = contour
      .map((v, i) => (typeof v === "number" ? { x: i, y: v } : null))
      .filter(Boolean);
    if (validPts.length >= 2) {
      const denom = Math.max(1, contour.length - 1);
      const ptsAttr = validPts
        .map((p) => {
          const x = (4 + (p.x / denom) * 88).toFixed(1);
          const y = (22 - (p.y / 100) * 18).toFixed(1);
          return `${x},${y}`;
        })
        .join(" ");
      svgHtml = `<svg class="sensei-pitch-svg" viewBox="0 0 96 26" aria-label="声调起伏曲线">
        <polyline fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" points="${ptsAttr}" style="color:var(--accent-indigo);" />
      </svg>`;
    }

    return `
      <div class="sensei-acoustic-row">
        <span>${escapeHtml(statsParts.join(" · "))}</span>
        ${svgHtml}
      </div>
    `;
  }

  async function askSenseiFollowup(questionText) {
    const q = (questionText || "").trim();
    const res = state.lastTurnResult;
    if (!q || !res || state.followupLoading) return;
    const meta = state.lessonSession?.lessonMeta || {};
    state.followupLoading = true;
    state.followupInput = q;
    renderView();
    try {
      const data = await apiJson("/api/sensei/ask", {
        method: "POST",
        body: JSON.stringify({
          question_cn: q,
          target_jp: res.targetJp || "",
          heard_jp: res.heardJp || "",
          better_jp: res.betterJp || "",
          grammar_focus: meta.grammarFocus || "",
          jlpt_target: res.jlptLevel || meta.level || state.jlptTarget || "N4",
          pitch_note: res.pitchNote || "",
          grammar_note: res.grammarNote || "",
          action_tip: res.actionTipCn || "",
          coach_model: state.coachModel || null,
        }),
      });
      state.followupLoading = false;
      state.followupAnswer = data;
      renderView();
    } catch (err) {
      state.followupLoading = false;
      renderView();
      showToast(`❌ 追问老师失败：${err.message}`);
    }
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
    if (isIOSDevice) return null;
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
    if (isIOSDevice) return;
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
    if (seq !== turnChoreographySeq || state.subTab !== "lesson") return;
    if (state.isRecordingTurn || state.isEvaluatingTurn) return;
    if (isIOSDevice || !state.autoReopenMic) {
      if (isIOSDevice) {
        state.mirrorPhase = "ready_retry";
        updateMirrorPhaseDom();
      }
      return;
    }
    state.mirrorPhase = "ready_retry";
    updateMirrorPhaseDom();
    await new Promise((r) => setTimeout(r, 260));
    if (seq !== turnChoreographySeq || !state.autoReopenMic || state.subTab !== "lesson") return;
    if (!state.isRecordingTurn && !state.isEvaluatingTurn) {
      await toggleLessonRecording({ autoTriggered: true });
    }
  }

  function getAllGrammarItems() {
    const core = (typeof window !== "undefined" && window.JP_GRAMMAR_LIST) || [];
    const video = (typeof window !== "undefined" && window.JP_VIDEO_GRAMMAR) || [];
    const out = [];
    for (const g of core) {
      out.push({
        id: g.id,
        source: "core",
        level: (g.level || "N5").toUpperCase(),
        pattern: g.pattern || "",
        reading: g.reading || "",
        meaning: g.meaning || "",
      });
    }
    for (const vg of video) {
      out.push({
        id: vg.id,
        source: "video",
        level: (vg.level || "N4").toUpperCase(),
        pattern: vg.pattern || "",
        reading: vg.reading || "",
        meaning: vg.meaning || "",
      });
    }
    return out;
  }

  async function startGuidedLesson(opts = {}) {
    ensureLessonAudioCtx();
    clearAutoAdvanceTimer();
    const seq = ++turnChoreographySeq;
    if (state.isRecordingTurn) cancelLessonRecording();
    stopSimpleAudio();

    const mode = opts.curriculumMode || state.curriculumMode;
    const lessonId = opts.lessonId !== undefined ? opts.lessonId : state.selectedLessonId;
    const grammarId = opts.grammarId !== undefined ? opts.grammarId : state.selectedGrammarId;
    const customTopic = opts.customTopic !== undefined ? opts.customTopic : state.customTopic;
    const scenarioId = opts.scenarioId !== undefined ? opts.scenarioId : state.selectedScenarioId;
    const aiGenerate = opts.aiGenerate !== undefined ? Boolean(opts.aiGenerate) : true;
    const resolvedGrammarId = grammarId || getAllGrammarItems()[0]?.id || "";
    if (mode === "custom_topic" && !(customTopic || "").trim()) {
      showToast("请先输入或点选一个想学的主题");
      return;
    }
    if (mode === "grammar_point" && !resolvedGrammarId) {
      showToast("未找到可选语法知识点");
      return;
    }

    state.curriculumMode = mode;
    if (lessonId) state.selectedLessonId = lessonId;
    if (resolvedGrammarId) state.selectedGrammarId = resolvedGrammarId;
    if (scenarioId) state.selectedScenarioId = scenarioId;
    state.isGeneratingLesson = true;
    renderView();

    showToast(
      mode === "travel_scenario"
        ? "正在为你们一家现编家庭旅行对话教材..."
        : mode === "grammar_point"
        ? "正在围绕该语法点编写老师精讲与递进操练..."
        : "老师正在结合你的记忆本与弱点现场编写原创教材..."
    );
    try {
      const data = await apiJson("/api/sensei/lesson/start", {
        method: "POST",
        body: JSON.stringify({
          user_id: state.userId,
          scenario_id: scenarioId || state.selectedScenarioId,
          lesson_type: state.lessonType,
          jlpt_target: state.jlptTarget,
          voice: state.voice,
          curriculum_mode: mode,
          lesson_id: lessonId || null,
          grammar_id: resolvedGrammarId || null,
          custom_topic: (customTopic || "").trim() || null,
          ai_generate: aiGenerate,
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
      state.lastStepAttemptCtx = null;
      state.consolidatingFull = false;
      state.followupAnswer = null;
      state.followupLoading = false;
      state.followupInput = "";
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

  async function startGrammarLesson(grammarId) {
    if (!grammarId) return;
    if (!state.healthChecked) {
      await initBackend(false);
    }
    state.subTab = "lesson";
    state.drawerOpen = false;
    state.curriculumMode = "grammar_point";
    state.selectedGrammarId = grammarId;
    if (!state.backendOnline) {
      renderView();
      return;
    }
    await startGuidedLesson({ curriculumMode: "grammar_point", grammarId });
  }

  async function regenerateCurrentLesson() {
    const meta = state.lessonSession?.lessonMeta || {};
    const mode = meta.curriculumMode || state.curriculumMode;
    await startGuidedLesson({
      curriculumMode: mode,
      lessonId: meta.lessonId || state.selectedLessonId,
      grammarId: meta.grammarId || state.selectedGrammarId,
      customTopic: mode === "custom_topic" ? meta.grammarFocus || state.customTopic : undefined,
      scenarioId: state.lessonSession?.scenario?.id || state.selectedScenarioId,
      aiGenerate: true,
    });
  }

  async function extendCurrentLesson() {
    if (state.isExtendingLesson || !state.lessonSession) return;
    ensureLessonAudioCtx();
    clearAutoAdvanceTimer();
    const seq = ++turnChoreographySeq;
    if (state.isRecordingTurn) cancelLessonRecording();
    stopSimpleAudio();

    const meta = state.lessonSession.lessonMeta || {};
    const steps = state.lessonSession.steps || [];
    state.isExtendingLesson = true;
    renderView();
    showToast("老师正在根据本课内容继续加编进阶练习...");
    try {
      const data = await apiJson("/api/sensei/lesson/extend", {
        method: "POST",
        body: JSON.stringify({
          session_id: state.lessonSession.sessionId,
          user_id: state.userId,
          curriculum_mode: meta.curriculumMode || state.curriculumMode,
          lesson_title: meta.title || state.lessonSession.scenario?.title || "",
          grammar_focus: meta.grammarFocus || "",
          jlpt_target: meta.level || state.jlptTarget,
          voice: state.voice,
          existing_targets: steps.map((s) => s.targetJp).filter(Boolean),
          start_index: steps.length,
          scenario_id: state.lessonSession.scenario?.id || state.selectedScenarioId,
          grammar_id: meta.grammarId || state.selectedGrammarId || null,
          coach_model: state.coachModel || null,
        }),
      });
      state.isExtendingLesson = false;
      if (seq !== turnChoreographySeq) return;
      const newSteps = data.steps || [];
      if (!newSteps.length) {
        renderView();
        showToast("暂未生成新的加练步骤，请重试");
        return;
      }
      const firstNewIdx = steps.length;
      state.lessonSession.steps = [...steps, ...newSteps];
      state.lessonStepIdx = firstNewIdx;
      state.attempt = 1;
      state.drillChunkJp = "";
      state.drillChunkTokens = [];
      state.peekHint = false;
      state.lastTurnResult = null;
      state.lastStepAttemptCtx = null;
      state.consolidatingFull = false;
      state.followupAnswer = null;
      state.followupLoading = false;
      state.followupInput = "";
      const step = state.lessonSession.steps[firstNewIdx];
      state.mirrorPhase = step && step.teacherPrompt ? "teacher_explain" : "";
      renderView();
      if (step && (step.teacherPromptTts || step.teacherPrompt)) {
        await playTextTts(step.teacherPromptTts || step.teacherPrompt);
      }
      await maybeAutoOpenMic(seq);
    } catch (err) {
      state.isExtendingLesson = false;
      renderView();
      showToast(`❌ 继续加练失败：${err.message}`);
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
    state.drillChunkTokens = [];
    state.peekHint = false;
    state.lastTurnResult = null;
    state.lastStepAttemptCtx = null;
    state.consolidatingFull = false;
    state.followupAnswer = null;
    state.followupLoading = false;
    state.followupInput = "";
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
    if (iosRecTimerInterval) {
      clearInterval(iosRecTimerInterval);
      iosRecTimerInterval = null;
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

  function startIosRecordingTimer() {
    if (iosRecTimerInterval) {
      clearInterval(iosRecTimerInterval);
      iosRecTimerInterval = null;
    }
    const startedAt = performance.now();
    iosRecTimerInterval = setInterval(() => {
      if (!state.isRecordingTurn) {
        clearInterval(iosRecTimerInterval);
        iosRecTimerInterval = null;
        return;
      }
      const elapsedSec = (performance.now() - startedAt) / 1000;
      const hintEl = document.getElementById("sensei-vad-hint");
      if (hintEl) {
        hintEl.textContent = `🎙️ 正在录音 (${elapsedSec.toFixed(1)}s)... 说完请点击上方按钮结束并提交`;
      }
      const fillEl = document.getElementById("sensei-vad-fill");
      if (fillEl) {
        const pct = Math.round(45 + 17 * Math.sin(elapsedSec * 6.5));
        fillEl.style.width = `${pct}%`;
        fillEl.classList.add("active");
      }
    }, 150);
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
    let noiseFloor = 0.005;
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
      if (rms > 0.0002) {
        sawNonZeroSample = true;
      }
      const elapsed = now - startedAt;
      const vadUnavailable = elapsed >= 1500 && !sawNonZeroSample;

      // Track quiet floor conservatively without letting an immediate start spike the threshold
      if (elapsed < 350 && rms > 0.0005 && rms < 0.014) {
        noiseFloor = Math.min(noiseFloor, rms);
      }

      const speechThreshold = Math.max(0.009, Math.min(0.032, noiseFloor * 2.1));
      const silenceThreshold = speechThreshold * 0.65;

      if (rms >= speechThreshold) {
        speechStreakMs += dt;
        if (speechStreakMs >= 90) {
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
        const pct = Math.min(100, Math.round((rms / 0.08) * 100));
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
    if (state.isEvaluatingTurn || isStartingRecording) return;
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

    const wasPlayingAudio = Boolean(currentAudioEl && !currentAudioEl.paused);
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

    isStartingRecording = true;
    try {
      // Allow iOS AVAudioSession to finish tearing down <audio> playback before capturing mic.
      if (isIOSDevice && wasPlayingAudio) {
        await new Promise((r) => setTimeout(r, 120));
      }

      const audioConstraints = isIOSDevice
        ? {
            echoCancellation: false,
            noiseSuppression: false,
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
        if (
          constraintErr &&
          (constraintErr.name === "OverconstrainedError" ||
            constraintErr.name === "TypeError" ||
            constraintErr.name === "NotReadableError")
        ) {
          mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        } else {
          throw constraintErr;
        }
      }

      let track = mediaStream.getAudioTracks()[0];
      if (!track || track.readyState !== "live") {
        mediaStream.getTracks().forEach((t) => t.stop());
        mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        track = mediaStream.getAudioTracks()[0];
      }
      if (isIOSDevice && track && track.muted) {
        await new Promise((resolve) => {
          let settled = false;
          const done = () => {
            if (settled) return;
            settled = true;
            try {
              track.removeEventListener("unmute", done);
            } catch {}
            resolve();
          };
          try {
            track.addEventListener("unmute", done, { once: true });
          } catch {}
          setTimeout(done, 450);
        });
      }

      // Desktop uses Web Audio VAD monitor; iOS keeps AudioContext completely detached so MediaRecorder never stalls.
      if (!isIOSDevice) {
        const actx = ensureLessonAudioCtx();
        if (actx && (actx.state === "suspended" || actx.state === "interrupted")) {
          await actx.resume().catch(() => {});
        }
        if (lessonTtsCtx && (lessonTtsCtx.state === "suspended" || lessonTtsCtx.state === "interrupted")) {
          await lessonTtsCtx.resume().catch(() => {});
        }
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
          await new Promise((r) => setTimeout(r, 420));
        }
        const audioCheck = await inspectRecordedAudioBlob(blob);
        if (audioCheck.analyzed && !audioCheck.hasSpeech) {
          state.isRecordingTurn = false;
          state.mirrorPhase = "";
          renderView();
          showToast("🔇 未检测到有效人声（可能静音或离麦克风太远），请清晰朗读后再试");
          return;
        }
        await submitLessonAudioTurn(blob, audioCheck.boostedBlob || null);
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
      if (isIOSDevice) {
        startIosRecordingTimer();
      } else {
        startLessonVadMonitor(mediaStream, rec);
      }
    } catch (err) {
      cleanupTurnRecorder();
      state.isRecordingTurn = false;
      renderView();
      if (opts.autoTriggered) {
        showToast("🎙️ 请点击蓝色麦克风按钮开始说话");
      } else {
        showToast(`❌ 无法打开麦克风：${err.message || err.name}`);
      }
    } finally {
      isStartingRecording = false;
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

  async function submitLessonAudioTurn(audioBlob, mirrorBlob = null) {
    const step = currentLessonStep();
    if (!step || !state.lessonSession) return;
    const seq = ++turnChoreographySeq;
    clearEvalProgress();
    if (localMirrorBlobUrl) {
      try {
        URL.revokeObjectURL(localMirrorBlobUrl);
      } catch {}
    }
    const playbackBlob = mirrorBlob || audioBlob;
    lastMirrorBlob = playbackBlob;
    localMirrorBlobUrl = URL.createObjectURL(playbackBlob);
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
    state.followupAnswer = null;
    state.followupLoading = false;
    state.followupInput = "";
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
      state.mirrorPlayback && playbackBlob
        ? playMirrorAudio(playbackBlob, mirrorSnapshotUrl)
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
      fd.append("total_steps", String((state.lessonSession?.steps || []).length));
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
      fd.append("jlpt_target", meta.level || state.jlptTarget || "N4");
      if (state.lastStepAttemptCtx && state.lastStepAttemptCtx.stepIndex === step.stepIndex) {
        if (state.lastStepAttemptCtx.heardJp) {
          fd.append("previous_heard_jp", state.lastStepAttemptCtx.heardJp);
        }
        if (typeof state.lastStepAttemptCtx.overallScore === "number") {
          fd.append("previous_score", String(state.lastStepAttemptCtx.overallScore));
        }
        if (state.lastStepAttemptCtx.issuesSummary) {
          fd.append("previous_issues_summary", state.lastStepAttemptCtx.issuesSummary);
        }
      }

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
      const isNoSpeech = Boolean(res.noSpeech || res.decision === "no_speech");
      if (!isNoSpeech) {
        state.turnHistory.push(res);
        state.lastStepAttemptCtx = {
          stepIndex: step.stepIndex,
          heardJp: res.heardJp || "",
          overallScore: Number(res.overallScore || 0),
          issuesSummary: (res.issues || [])
            .map((it) => `${it.patternKey || it.type || ""}:${it.detailCn || ""}`)
            .filter(Boolean)
            .join("；"),
        };
      }
      state.isEvaluatingTurn = false;

      if (isNoSpeech) {
        // Keep current step & drill chunk intact without penalizing attempt count.
      } else if (res.decision === "retry_chunk" && res.drillChunkJp) {
        state.drillChunkJp = res.drillChunkJp;
        state.drillChunkTokens = res.drillChunkTokens || [];
        state.consolidatingFull = false;
        state.attempt += 1;
      } else if (res.decision === "consolidate_full") {
        state.drillChunkJp = "";
        state.drillChunkTokens = [];
        state.consolidatingFull = true;
        state.attempt += 1;
      } else if (res.decision === "retry_full") {
        state.drillChunkJp = "";
        state.drillChunkTokens = [];
        state.consolidatingFull = false;
        state.attempt += 1;
      } else {
        state.drillChunkJp = "";
        state.drillChunkTokens = [];
        state.consolidatingFull = false;
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

      if ((res.decision === "retry_chunk" || res.decision === "retry_full" || res.decision === "consolidate_full") && state.autoReopenMic) {
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
      el.textContent = "声学镜子回放原声中，老师同步逐拍诊断...";
      el.style.display = "block";
    } else if (state.mirrorPhase === "user_mirror") {
      el.textContent = "声学镜子正在回放你刚才的录音...";
      el.style.display = "block";
    } else if (state.mirrorPhase === "teacher_explain") {
      el.textContent = isIOSDevice
        ? "老师讲解示范中，听完请点击下方按钮开口跟读..."
        : "老师讲解示范中，听完将自动为你开麦...";
      el.style.display = "block";
    } else if (state.mirrorPhase === "ready_retry") {
      el.textContent = isIOSDevice
        ? "请点击下方「点击开口说」开始跟读，说完再点一次提交"
        : "已自动开麦：请直接开口，说完停顿约 1 秒将自动提交";
      el.style.display = "block";
    } else if (state.mirrorPhase === "auto_next") {
      el.textContent = "本步过关，即将进入下一步...";
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
      const [mem, cards, favRes] = await Promise.all([
        apiJson(`/api/memory?user_id=${encodeURIComponent(state.userId)}`),
        apiJson(`/api/srs/cards?user_id=${encodeURIComponent(state.userId)}`),
        apiJson(`/api/favorites?user_id=${encodeURIComponent(state.userId)}`).catch(() => ({ favorites: state.favorites })),
      ]);
      state.memoryData = mem;
      state.srsCards = cards.cards || [];
      state.favorites = favRes?.favorites || [];
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

  async function openTextbookPreview(lessonId) {
    if (!lessonId) return;
    state.loadingChapter = true;
    try {
      const res = await apiJson(`/api/sensei/syllabus/${encodeURIComponent(lessonId)}`);
      state.previewChapter = res.lesson || null;
    } catch (err) {
      showToast(`❌ 读取教材章节失败：${err.message}`);
    } finally {
      state.loadingChapter = false;
      renderView();
    }
  }

  function renderTextbookBodyHtml(tb, bb, level) {
    const ico = (name) => (window.JP_APP && window.JP_APP.icon ? window.JP_APP.icon(name) : "");
    const vocabList = tb?.vocabList || [];
    const grammarNotes = tb?.grammarNotes || [];
    const dlg = tb?.dialogue;
    const rp = tb?.readingPassage;

    const bbHtml =
      bb && bb.titleCn
        ? `<div class="sensei-blackboard">
            <div class="sensei-bb-head">
              <span>🧑‍🏫 私教黑板 · ${escapeHtml(bb.titleCn)}</span>
              ${level ? `<span class="sensei-badge">${escapeHtml(level)}</span>` : ""}
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
          </div>`
        : "";

    if (!tb) return bbHtml;

    return `
      <div class="sensei-textbook-panel">
        ${tb.canDoCn ? `<div class="tb-cando">🎯 <strong>本课目标：</strong>${escapeHtml(tb.canDoCn)}</div>` : ""}
        ${bbHtml}
        ${
          vocabList.length
            ? `<div class="tb-section">
                <div class="tb-section-title">📚 本课核心生词（${vocabList.length}）</div>
                <div class="tb-vocab-grid">
                  ${vocabList
                    .map(
                      (v, idx) => `
                    <div class="tb-vocab-item">
                      <div class="tb-vocab-main">
                        <div class="tb-vocab-jp" lang="ja">${escapeHtml(v.jp)}</div>
                        <div class="tb-vocab-reading">${escapeHtml(v.reading || "")}${v.pos ? ` · ${escapeHtml(v.pos)}` : ""}</div>
                        <div class="tb-vocab-cn">${escapeHtml(v.cn || "")}</div>
                      </div>
                      <div class="tb-vocab-btns">
                        <button type="button" class="sensei-mini-btn" data-tts-lang="ja" data-tts-text="${escapeHtml(v.jp)}" title="听发音">${ico("speaker")}</button>
                        <button type="button" class="sensei-mini-btn" data-save-tb-vocab="${idx}" title="存入 FSRS 记忆本">+</button>
                      </div>
                    </div>`
                    )
                    .join("")}
                </div>
              </div>`
            : ""
        }
        ${
          grammarNotes.length
            ? `<div class="tb-section">
                <div class="tb-section-title">📐 文法精讲（${grammarNotes.length}）</div>
                ${grammarNotes
                  .map(
                    (g) => `
                  <div class="tb-grammar-item">
                    <div class="tb-grammar-pat">${escapeHtml(g.pattern || "")}</div>
                    ${g.formation ? `<div class="tb-grammar-form">接续：${escapeHtml(g.formation)}</div>` : ""}
                    ${g.explanation ? `<div class="tb-grammar-expl">${escapeHtml(g.explanation)}</div>` : ""}
                    ${
                      g.exampleJp
                        ? `<div class="tb-grammar-ex">
                            <div>
                              <span lang="ja" style="font-weight:600;">${escapeHtml(g.exampleJp)}</span>
                              ${g.exampleCn ? `<div class="tb-vocab-cn">${escapeHtml(g.exampleCn)}</div>` : ""}
                            </div>
                            <button type="button" class="sensei-mini-btn" data-tts-lang="ja" data-tts-text="${escapeHtml(g.exampleJp)}">${ico("speaker")}</button>
                          </div>`
                        : ""
                    }
                  </div>`
                  )
                  .join("")}
              </div>`
            : ""
        }
        ${
          dlg && (dlg.turns || []).length
            ? `<div class="tb-section">
                <div class="tb-section-title">💬 课文示范对话 · ${escapeHtml(dlg.title || "")}${dlg.setting ? `（${escapeHtml(dlg.setting)}）` : ""}</div>
                <div class="tb-dialogue-list">
                  ${dlg.turns
                    .map(
                      (t) => `
                    <div class="tb-dialogue-turn">
                      <div>
                        <span class="tb-dialogue-spk">${escapeHtml(t.speaker || "")}</span>
                        <span class="tb-dialogue-jp" lang="ja">${escapeHtml(t.jp || "")}</span>
                        ${t.cn ? `<div class="tb-dialogue-cn">${escapeHtml(t.cn)}</div>` : ""}
                      </div>
                      <button type="button" class="sensei-mini-btn" data-tts-lang="ja" data-tts-text="${escapeHtml(t.jp || "")}">${ico("speaker")}</button>
                    </div>`
                    )
                    .join("")}
                </div>
              </div>`
            : ""
        }
        ${
          rp && rp.jp
            ? `<div class="tb-section">
                <div class="tb-section-title">📰 精读短文（${escapeHtml(level || "N4")}）</div>
                <div class="tb-reading-box">
                  <div class="tb-reading-head">
                    <span>《${escapeHtml(rp.title || "课文阅读")}》</span>
                    <button type="button" class="sensei-mini-btn" data-tts-lang="ja" data-tts-text="${escapeHtml(rp.jp)}">${ico("speaker")} 朗读全文</button>
                  </div>
                  <div class="tb-reading-jp" lang="ja">${escapeHtml(rp.jp)}</div>
                  ${rp.cn ? `<div class="tb-reading-cn">${escapeHtml(rp.cn)}</div>` : ""}
                </div>
              </div>`
            : ""
        }
      </div>
    `;
  }

  function renderTextbookPanel(meta) {
    return renderTextbookBodyHtml(meta?.textbook || null, meta?.blackboard || null, meta?.level || "");
  }

  function renderTextbookPreviewModal() {
    const ch = state.previewChapter;
    if (!ch) return "";
    return `
      <div class="sensei-tb-modal-backdrop" id="sensei-tb-modal-backdrop">
        <div class="sensei-tb-modal" role="dialog" aria-modal="true" aria-label="课程教材正文">
          <div class="sensei-tb-modal-head">
            <div>
              <div style="display:flex;align-items:center;gap:0.4rem;">
                <span class="sensei-badge">${escapeHtml(ch.level || "N4")}</span>
                <strong style="font-size:0.96rem;">${escapeHtml(ch.title || "")}</strong>
              </div>
              <div style="font-size:0.76rem;color:var(--text-muted);margin-top:0.15rem;">${escapeHtml(ch.trackTitle || "")}</div>
            </div>
            <button type="button" class="sensei-mini-btn" id="sensei-tb-modal-close" aria-label="关闭教材">✕</button>
          </div>
          <div class="sensei-tb-modal-body">
            ${renderTextbookBodyHtml(ch, ch.blackboard, ch.level)}
          </div>
          <div class="sensei-tb-modal-foot">
            <button type="button" class="sensei-btn ghost" id="sensei-tb-modal-close-foot">返回</button>
            <button type="button" class="sensei-btn primary" id="sensei-tb-start-btn" data-lesson-id="${escapeHtml(ch.id)}" ${state.isGeneratingLesson ? "disabled" : ""}>
              ${state.isGeneratingLesson ? "正在编排带练..." : "开始本课 AI 私教带练"}
            </button>
          </div>
        </div>
      </div>
    `;
  }

  function renderLessonTab() {
    const step = currentLessonStep();
    const res = state.lastTurnResult;
    const syl = state.syllabus;
    const rec = syl?.recommendedLesson;
    const ico = (name) => (window.JP_APP && window.JP_APP.icon ? window.JP_APP.icon(name) : "");

    // STATE A — Clean Editorial Overview before a lesson starts
    if (!step) {
      const doneCnt = syl?.completedCount ?? 0;
      const totalCnt = syl?.totalCount ?? 40;
      const modeNames = {
        sensei_syllabus: rec ? `[${escapeHtml(rec.level)}] ${escapeHtml(rec.title)}` : "资深私教体系课",
        custom_topic: state.customTopic ? `自由命题：${escapeHtml(state.customTopic)}` : "自由命题现编教材",
        travel_scenario: "旅行与日常情景专项",
      };
      return `
        <div class="sensei-hero-stage">
          <div class="sensei-hero-eyebrow">
            <span>今日私教</span>
            <span class="dot-sep">·</span>
            <span>教材进度 ${doneCnt} / ${totalCnt} 课</span>
          </div>
          <h2 class="sensei-hero-title">${rec ? modeNames.sensei_syllabus : "1 对 1 日语发音与口语反射"}</h2>
          <p class="sensei-hero-sub">
            ${
              rec
                ? `${escapeHtml(rec.canDoCn || rec.subtitle)} · ${escapeHtml(rec.cnPitfall)}`
                : "覆盖 N5 地基 → N4 进阶 → N3 中级 40 课体系教材，支持精读、文法黑板、原声镜像与随时加练。"
            }
          </p>
          <div class="sensei-hero-level-pills">
            <button type="button" class="sensei-mini-btn" data-jump-level="N5">N5 地基 (13课)</button>
            <button type="button" class="sensei-mini-btn" data-jump-level="N4">N4 进阶 (12课)</button>
            <button type="button" class="sensei-mini-btn" data-jump-level="N3">N3 中级 (15课)</button>
            ${
              (state.favorites || []).length
                ? `<button type="button" class="sensei-mini-btn sensei-fav-btn active" id="sensei-hero-fav-btn">★ 复练收藏句 (${state.favorites.length})</button>`
                : ""
            }
          </div>
          <div class="sensei-hero-cta-row">
            <div style="display:flex;flex-wrap:wrap;justify-content:center;gap:0.55rem;">
              ${
                rec
                  ? `<button type="button" class="sensei-btn ghost" id="sensei-hero-preview-btn" data-lesson-id="${escapeHtml(rec.id)}">📖 预习本课教材</button>`
                  : ""
              }
              <button type="button" class="sensei-btn primary big" id="${rec ? "sensei-start-rec-btn" : "sensei-start-lesson-btn"}" ${state.isGeneratingLesson ? "disabled" : ""}>
                ${state.isGeneratingLesson ? "正在现场备课..." : "开始今日私教课"}
              </button>
            </div>
            <button type="button" class="sensei-link-btn" id="sensei-open-course-picker">
              自选 40 课教材 / 语法库 / 旅行场景 / 自由命题 ${ico("chevronRight")}
            </button>
          </div>
        </div>
      `;
    }

    // STATE B — Active Lesson Focus Mode (zero setup clutter)
    const steps = state.lessonSession?.steps || [];
    const meta = state.lessonSession?.lessonMeta || {};
    const bb = meta?.blackboard;
    const hasBb = Boolean((bb && bb.titleCn) || meta?.textbook);
    const isFreeOutput = step.stage === "FREE_OUTPUT";

    return `
      <div class="focus-shell">
        <div class="focus-header">
          <button type="button" class="sensei-link-btn" id="sensei-exit-lesson-btn">
            ${ico("chevronLeft")} <span>返回</span>
          </button>
          <div class="focus-title-meta">
            ${meta.level ? `<span class="sensei-badge">${escapeHtml(meta.level)}</span>` : ""}
            <span class="focus-lesson-name">${escapeHtml(meta.title || state.lessonSession?.scenario?.title || "私教训练")}</span>
          </div>
          <div class="focus-head-actions">
            ${
              hasBb
                ? `<button type="button" class="sensei-mini-btn ${state.showBlackboard ? "active" : ""}" id="sensei-toggle-bb-btn">📖 教材</button>`
                : ""
            }
            <button type="button" class="sensei-mini-btn" id="sensei-open-drawer-focus" aria-label="选课与偏好">
              ${ico("sliders")}
            </button>
          </div>
        </div>

        <div class="focus-progress-wrap">
          <div class="focus-progress-track" role="tablist" aria-label="课程步骤进度">
            ${steps
              .map(
                (st, i) =>
                  `<button type="button" class="focus-progress-seg ${i === state.lessonStepIdx ? "active" : i < state.lessonStepIdx ? "done" : ""}" data-jump-step="${i}" title="${escapeHtml(st.stageLabel)}"></button>`
              )
              .join("")}
          </div>
          <div class="focus-progress-meta">
            <span>第 ${state.lessonStepIdx + 1} / ${steps.length} 步 · ${escapeHtml(step.stageLabel)}</span>
            <span>第 ${state.attempt} 次尝试${state.drillChunkJp ? " · 拆词重练" : state.consolidatingFull ? " · 合句验收" : ""}</span>
          </div>
        </div>

        ${hasBb && state.showBlackboard ? renderTextbookPanel(meta) : ""}

        <div class="focus-stage-card">
          <div class="focus-cue">${escapeHtml(step.cueCn)}</div>

          ${
            step.questionJp
              ? `<div class="sensei-free-q">
                  <div class="sensei-free-q-lbl">${isFreeOutput ? "老师向你提问（请用自己的话直接回答）" : "对方说（请听清并自然回应）"}</div>
                  <div class="sensei-jp-line">${renderTokensHtml(step.questionTokens, step.questionJp)}</div>
                  ${step.questionCn ? `<div class="sensei-cn-line">${escapeHtml(step.questionCn)}</div>` : ""}
                  <div class="sensei-target-actions">
                    <button type="button" class="sensei-mini-btn" data-tts-lang="ja" data-tts-text="${escapeHtml(step.questionJp)}">${ico("speaker")} ${isFreeOutput ? "重听提问" : "重听对方说"}</button>
                  </div>
                </div>`
              : ""
          }

          ${
            step.hideTarget && !state.peekHint && !res
              ? `<div class="sensei-hidden-target">
                  <p>${
                    isFreeOutput
                      ? "自由表达练习：用你自己的日语直接回答，听老师润色。"
                      : "口头反射挑战：参考句已隐藏，请根据上方提示直接开口说。"
                  }</p>
                  <button type="button" class="sensei-mini-btn" id="sensei-peek-btn">${isFreeOutput ? "查看参考答法" : "显示提示句"}</button>
                </div>`
              : `<div class="focus-target-body">
                  ${
                    state.drillChunkJp
                      ? `<div class="sensei-chunk-focus">
                          <span>拆词聚焦：</span>
                          <strong class="sensei-chunk-word">${state.drillChunkTokens?.length ? renderTokensHtml(state.drillChunkTokens, state.drillChunkJp) : escapeHtml(state.drillChunkJp)}</strong>
                          <button type="button" class="sensei-mini-btn" data-tts-lang="ja" data-tts-text="${escapeHtml(state.drillChunkJp)}">${ico("speaker")} 示范</button>
                        </div>`
                      : ""
                  }
                  <div class="focus-jp-hero">${renderTokensHtml(step.tokens, step.targetJp)}</div>
                  <div class="focus-cn">${escapeHtml(step.targetCn)}</div>
                  ${step.tipCn ? `<div class="focus-tip">${escapeHtml(step.tipCn)}</div>` : ""}
                  <div class="focus-inline-audio">
                    <button type="button" class="sensei-mini-btn" data-tts-lang="ja" data-tts-text="${escapeHtml(step.targetJp)}">${ico("speaker")} 标准示范</button>
                    ${step.teacherPrompt ? `<button type="button" class="sensei-mini-btn" data-tts-text="${escapeHtml(step.teacherPromptTts || step.teacherPrompt)}">老师讲解</button>` : ""}
                    ${(() => {
                      const isFav = Boolean(findFavoriteByJp(step.targetJp));
                      return `<button type="button" class="sensei-mini-btn sensei-fav-btn ${isFav ? "active" : ""}" id="sensei-fav-step-btn">${isFav ? "★ 已收藏" : "☆ 收藏句子"}</button>`;
                    })()}
                  </div>
                </div>`
          }

          <div id="sensei-mirror-banner" class="sensei-mirror-banner" style="display:none;"></div>
        </div>

        <div class="focus-voice-dock">
          <div class="focus-dock-row">
            <button type="button" class="sensei-btn ghost" id="sensei-prev-step-btn" ${state.lessonStepIdx === 0 ? "disabled" : ""}>
              ${ico("chevronLeft")} 上一步
            </button>
            <button type="button" class="sensei-mic-btn ${state.isRecordingTurn ? "recording" : ""}" id="sensei-record-turn-btn" ${state.isEvaluatingTurn ? "disabled" : ""}>
              ${
                state.isEvaluatingTurn
                  ? `<span id="sensei-eval-elapsed">正在诊断... (0.0s)</span>`
                  : state.isRecordingTurn
                  ? `${ico("stop")} <span>结束并提交</span>`
                  : state.drillChunkJp
                  ? `${ico("mic")} <span>跟读「${escapeHtml(state.drillChunkJp)}」</span>`
                  : `${ico("mic")} <span>点击开口说</span>`
              }
            </button>
            <button type="button" class="sensei-btn ghost" id="sensei-next-step-btn" ${state.lessonStepIdx >= steps.length - 1 ? "disabled" : ""}>
              下一步 ${ico("chevronRight")}
            </button>
          </div>
          ${
            state.isEvaluatingTurn
              ? `<button type="button" class="sensei-link-btn" id="sensei-cancel-eval-btn">取消本次诊断</button>`
              : ""
          }
          ${
            state.isRecordingTurn
              ? `<div class="sensei-vad-wrap">
                  <div class="sensei-vad-track"><div id="sensei-vad-fill" class="sensei-vad-fill"></div></div>
                  <div class="sensei-vad-meta">
                    <span id="sensei-vad-hint" class="sensei-vad-hint">正在聆听，请直接开口...</span>
                    <button type="button" class="sensei-mini-btn" id="sensei-cancel-rec-btn">取消</button>
                  </div>
                </div>`
              : ""
          }
        </div>

        <div class="focus-footer-links">
          <button type="button" class="sensei-link-btn" id="sensei-regen-lesson-btn" ${state.isGeneratingLesson || state.isExtendingLesson ? "disabled" : ""}>
            ${state.isGeneratingLesson ? "正在重新生成..." : "🔄 重新 AI 生成教材"}
          </button>
          <button type="button" class="sensei-link-btn" id="sensei-extend-lesson-btn" ${state.isExtendingLesson || state.isGeneratingLesson ? "disabled" : ""}>
            ${state.isExtendingLesson ? "正在加编练习..." : "➕ 继续深入加练"}
          </button>
        </div>

        ${res ? renderTurnDiagnosisCard(res) : ""}
      </div>
    `;
  }

  function renderTurnDiagnosisCard(res) {
    const isNoSpeech = Boolean(res.noSpeech || res.decision === "no_speech");
    const passed = !isNoSpeech && res.decision === "pass";
    const advanced = !isNoSpeech && res.decision === "advance";
    const consolidated = !isNoSpeech && res.decision === "consolidate_full";
    const badgeClass = isNoSpeech
      ? "warn"
      : passed
      ? "pass"
      : consolidated
      ? "consolidate"
      : advanced
      ? "warn"
      : "retry";
    const badgeText = isNoSpeech
      ? "未检测到清晰日语人声 · 请再试一次"
      : passed
      ? "过关 · 节奏与音调稳定"
      : consolidated
      ? "拆词已过关 · 回整句合练验收"
      : advanced
      ? "已记入错题 · 建议进入下一步"
      : res.decision === "retry_chunk"
      ? `拆词重练：先读准「${res.drillChunkJp}」`
      : "请听纠音示范再试一次";
    const scorePillText = isNoSpeech
      ? `未收音 · 请重读${res.audioStats && res.audioStats.analyzed ? ` · 峰值 ${res.audioStats.peakDb}dB` : ""}`
      : `总分 ${res.overallScore}${res.jlptLevel ? ` · ${res.jlptLevel}标尺` : ""}${res.evalMs ? ` · ${(res.evalMs / 1000).toFixed(1)}s` : ""}`;
    const ico = (name) => (window.JP_APP && window.JP_APP.icon ? window.JP_APP.icon(name) : "");

    const dimBar = (lbl, val) => {
      const n = Number(val || 0);
      const tone = n >= 88 ? "good" : n >= 75 ? "mid" : "low";
      return `
        <div class="sensei-dim-item">
          <div class="sensei-dim-head"><span>${lbl}</span><strong>${n}</strong></div>
          <div class="sensei-dim-bar"><div class="sensei-dim-fill ${tone}" style="width:${Math.max(4, Math.min(100, n))}%"></div></div>
        </div>
      `;
    };

    const issuesList = Array.isArray(res.issues) ? res.issues.filter((it) => it && (it.detailCn || it.patternKey)) : [];
    const issueTypeMap = {
      pitch: "音调",
      sokuon: "促音",
      long_vowel: "长音",
      voicing: "浊音",
      consonant: "辅音",
      ending: "句尾",
      particle: "助词",
      grammar: "语法",
      keigo: "得体",
    };

    const pitchBadge = res.pitchNotation || res.drillChunkReading || "";
    const followupHtml = !isNoSpeech
      ? `
        <div class="sensei-followup-box">
          <div style="font-size:0.78rem;font-weight:800;color:var(--text-muted);">❓ 对这句有疑问？直接追问私教老师</div>
          <div class="sensei-followup-chips">
            <button type="button" class="sensei-mini-btn" data-ask-quick="为什么这里要这样读/这样改？">为什么这样改</button>
            <button type="button" class="sensei-mini-btn" data-ask-quick="这句话有更礼貌或更像日本本地人的说法吗？">换更地道/礼貌说法</button>
            <button type="button" class="sensei-mini-btn" data-ask-quick="音调的高低转折怎么把握才不像中文腔？">怎么练准音调</button>
          </div>
          <div class="sensei-followup-form">
            <input type="text" id="sensei-ask-input" value="${escapeHtml(state.followupInput || "")}" placeholder="比如：助词用に还是で？ / 还能怎么委婉拒绝？" ${state.followupLoading ? "disabled" : ""} />
            <button type="button" class="sensei-btn ghost" id="sensei-ask-submit-btn" ${state.followupLoading ? "disabled" : ""}>
              ${state.followupLoading ? "老师思考中..." : "问老师"}
            </button>
          </div>
          ${
            state.followupAnswer
              ? `<div class="sensei-followup-reply">
                  <div style="display:flex;align-items:center;justify-content:space-between;gap:0.5rem;">
                    <strong style="color:var(--accent-indigo);">👩‍🏫 东京私教解答</strong>
                    ${
                      state.followupAnswer.spokenSummaryCn
                        ? `<button type="button" class="sensei-mini-btn" data-tts-text="${escapeHtml(state.followupAnswer.spokenSummaryTts || state.followupAnswer.spokenSummaryCn)}">${ico("speaker")} 听老师回答</button>`
                        : ""
                    }
                  </div>
                  <div>${escapeHtml(state.followupAnswer.answerCn || "")}</div>
                  ${(state.followupAnswer.examples || [])
                    .map(
                      (ex) => `
                      <div class="sensei-followup-ex">
                        <div style="display:flex;align-items:center;justify-content:space-between;gap:0.4rem;">
                          <div style="font-weight:700;">${renderTokensHtml(ex.tokens, ex.jp)}</div>
                          <button type="button" class="sensei-mini-btn" data-tts-lang="ja" data-tts-text="${escapeHtml(ex.jp)}">${ico("speaker")}</button>
                        </div>
                        <div style="font-size:0.76rem;color:var(--text-secondary);">${escapeHtml(ex.cn || "")}</div>
                      </div>`
                    )
                    .join("")}
                </div>`
              : ""
          }
        </div>
      `
      : "";

    return `
      <div class="sensei-card sensei-diagnosis-card ${badgeClass}">
        <div class="sensei-diag-top">
          <span class="sensei-diag-badge ${badgeClass}">${escapeHtml(badgeText)}</span>
          <span class="sensei-score-pill" title="模型：${escapeHtml(res.modelUsed || "")}">${escapeHtml(scorePillText)}</span>
        </div>

        ${
          !isNoSpeech
            ? `<div class="sensei-dim-grid">
                ${dimBar("音调", res.pitchScore)}
                ${dimBar("拍感", res.rhythmScore)}
                ${dimBar("语法", res.grammarScore)}
                ${dimBar("得体", res.politenessScore ?? res.grammarScore)}
              </div>`
            : ""
        }

        ${res.progressNoteCn ? `<div class="sensei-progress-banner">📈 较上次进步：${escapeHtml(res.progressNoteCn)}</div>` : ""}
        ${res.praiseCn ? `<div class="sensei-praise-banner">👍 具体亮点：${escapeHtml(res.praiseCn)}</div>` : ""}
        ${
          (res.resolvedWeaknesses || []).length
            ? `<div class="sensei-grad-badges">${res.resolvedWeaknesses
                .map((k) => `<span class="sensei-grad-pill">🏆 攻克弱项：${escapeHtml(k)}</span>`)
                .join("")}</div>`
            : ""
        }

        <div class="sensei-diff-grid">
          <div class="sensei-diff-col">
            <div class="sensei-diff-lbl">老师听到的你</div>
            <div class="sensei-diff-val">${renderDiffTokensHtml(res.heardDiff, res.heardTokens, res.heardJp || "（未识别出清晰日语）")}</div>
            ${renderPitchSparklineHtml(res.audioStats)}
            ${res.localMirrorUrl || res.userAudioUrl ? `<button type="button" class="sensei-mini-btn" data-play-url="${escapeHtml(res.localMirrorUrl || res.userAudioUrl)}">${ico("speaker")} 重听原声</button>` : ""}
          </div>
          <div class="sensei-diff-col">
            <div class="sensei-diff-lbl">标准示范读法</div>
            <div class="sensei-diff-val">${renderDiffTokensHtml(res.targetDiff, res.betterTokens || res.targetTokens, res.betterJp || res.targetJp)}</div>
            <div style="display:flex;flex-wrap:wrap;gap:0.35rem;align-items:center;">
              <button type="button" class="sensei-mini-btn" id="sensei-diag-teacher-play" ${res.teacherAudioUrl ? `data-play-url="${escapeHtml(res.teacherAudioUrl)}"` : `data-tts-text="${escapeHtml(res.teacherSpokenTts || res.teacherSpokenScript || res.betterJp || res.targetJp)}"`}>${ico("speaker")} 纠音示范</button>
              ${
                res.betterJp && (normalizeFavJp(res.betterJp) !== normalizeFavJp(res.targetJp) || res.stage === "FREE_OUTPUT")
                  ? (() => {
                      const fBetter = Boolean(findFavoriteByJp(res.betterJp));
                      return `<button type="button" class="sensei-mini-btn sensei-fav-btn ${fBetter ? "active" : ""}" data-fav-diag="better">${fBetter ? "★ 已收藏示范" : "☆ 收藏示范句"}</button>`;
                    })()
                  : ""
              }
            </div>
          </div>
        </div>

        <div class="sensei-teacher-speech">
          <strong>老师口播点评：</strong>${escapeHtml(res.teacherSpokenScript)}
        </div>

        ${
          res.actionTipCn || pitchBadge
            ? `<div class="sensei-action-box">
                <strong>🎯 口腔动作处方：</strong>${escapeHtml(res.actionTipCn || res.pitchNote || "")}
                ${pitchBadge ? `<span class="sensei-pitch-chip">音调 ${escapeHtml(pitchBadge)}</span>` : ""}
              </div>`
            : ""
        }

        ${
          issuesList.length
            ? `<div class="sensei-issue-list">${issuesList
                .map(
                  (it) => `<div class="sensei-issue-item">
                    <span class="sensei-issue-tag ${it.severity === "critical" ? "critical" : ""}">${escapeHtml(it.patternKey || issueTypeMap[it.type] || "纠音")}</span>
                    <span>${escapeHtml(it.detailCn || "")}</span>
                  </div>`
                )
                .join("")}</div>`
            : ""
        }

        ${res.pitchNote && res.actionTipCn && res.pitchNote !== res.actionTipCn ? `<div class="sensei-note-row"><strong>音调：</strong>${escapeHtml(res.pitchNote)}</div>` : ""}
        ${res.grammarNote ? `<div class="sensei-note-row"><strong>语法：</strong>${escapeHtml(res.grammarNote)}</div>` : ""}
        ${res.pragmaticNoteCn ? `<div class="sensei-note-row"><strong>得体度：</strong>${escapeHtml(res.pragmaticNoteCn)}</div>` : ""}

        ${
          res.nativeUpgradeJp
            ? `<div class="sensei-native-upgrade">
                <div class="sensei-native-upgrade-head">
                  <span>✨ 东京地道升级表达</span>
                  <div style="display:flex;gap:0.35rem;align-items:center;">
                    <button type="button" class="sensei-mini-btn" data-tts-lang="ja" data-tts-text="${escapeHtml(res.nativeUpgradeJp)}">${ico("speaker")} 听地道版</button>
                    ${(() => {
                      const fNat = Boolean(findFavoriteByJp(res.nativeUpgradeJp));
                      return `<button type="button" class="sensei-mini-btn sensei-fav-btn ${fNat ? "active" : ""}" data-fav-diag="native">${fNat ? "★ 已收藏" : "☆ 收藏"}</button>`;
                    })()}
                  </div>
                </div>
                <div style="font-size:0.95rem;font-weight:700;line-height:1.95;">${renderTokensHtml(res.nativeUpgradeTokens, res.nativeUpgradeJp)}</div>
                ${res.nativeUpgradeNoteCn ? `<div style="font-size:0.78rem;color:var(--text-secondary);margin-top:0.15rem;">${escapeHtml(res.nativeUpgradeNoteCn)}</div>` : ""}
              </div>`
            : ""
        }

        ${
          (res.extractedVocab || []).length
            ? `<div class="sensei-vocab-chips">
                <span>重点词汇：</span>
                ${res.extractedVocab
                  .map(
                    (v, i) =>
                      `<button type="button" class="sensei-save-vocab-btn" data-save-diag-vocab="${i}">+ ${escapeHtml(v.surface || v.lemma)} (${escapeHtml(v.meaningCn || v.reading || "")})</button>`
                  )
                  .join("")}
              </div>`
            : ""
        }

        ${followupHtml}

        ${
          consolidated && state.lessonSession && state.lessonStepIdx < state.lessonSession.steps.length - 1
            ? `<div style="margin-top:0.75rem;display:flex;flex-wrap:wrap;gap:0.45rem;">
                <button type="button" class="sensei-btn ghost" id="sensei-skip-consolidate-btn">跳过合练，直接下一步 ${ico("chevronRight")}</button>
              </div>`
            : ""
        }

        ${
          (passed || advanced) && state.lessonSession
            ? state.lessonStepIdx < state.lessonSession.steps.length - 1
              ? `<div style="margin-top:0.75rem;"><button type="button" class="sensei-btn primary" id="sensei-pass-next-btn">进入下一步 ${ico("chevronRight")}</button></div>`
              : `<div style="margin-top:0.75rem;"><button type="button" class="sensei-btn primary" id="sensei-pass-extend-btn" ${state.isExtendingLesson ? "disabled" : ""}>${state.isExtendingLesson ? "正在加编练习..." : "➕ 继续深入加练"}</button></div>`
            : ""
        }
      </div>
    `;
  }

  function renderCallTab() {
    const scenarioOptions = state.scenarios
      .map(
        (s) =>
          `<option value="${escapeHtml(s.id)}" ${s.id === state.selectedScenarioId ? "selected" : ""}>${escapeHtml(s.title)}</option>`
      )
      .join("");
    const activeSc = state.scenarios.find((s) => s.id === state.selectedScenarioId);
    const ico = (name) => (window.JP_APP && window.JP_APP.icon ? window.JP_APP.icon(name) : "");

    return `
      <div class="sensei-card">
        <div class="sensei-call-top">
          <div class="sensei-call-scene-label">
            <span class="sensei-badge">场景</span>
            <strong>${escapeHtml(activeSc ? activeSc.title : "日常对话练习")}</strong>
          </div>
          ${
            !state.callActive
              ? `<button type="button" class="sensei-mini-btn ${state.showCallSettings ? "active" : ""}" id="sensei-toggle-call-cfg">${ico("sliders")} 通话设置</button>`
              : ""
          }
        </div>

        ${
          !state.callActive && state.showCallSettings
            ? `<div class="sensei-setup-grid" style="margin-top:0.75rem;">
                <div>
                  <label class="sensei-lbl">角色扮演场景</label>
                  <select id="sensei-call-scenario" class="sensei-select">${scenarioOptions}</select>
                </div>
                <div>
                  <label class="sensei-lbl">纠错教学风格</label>
                  <select id="sensei-corr-mode" class="sensei-select">
                    <option value="strict" ${state.correctionMode === "strict" ? "selected" : ""}>严格私教（出错温柔打断纠音）</option>
                    <option value="flow" ${state.correctionMode === "flow" ? "selected" : ""}>流畅聊天（气泡旁微批注）</option>
                  </select>
                </div>
                <div>
                  <label class="sensei-lbl">手机回音模式</label>
                  <select id="sensei-audio-output-mode" class="sensei-select">
                    <option value="headset" ${state.audioOutputMode === "headset" ? "selected" : ""}>耳机全双工（随时插话）</option>
                    <option value="speaker" ${state.audioOutputMode === "speaker" ? "selected" : ""}>手机外放防回音（AI说时闭麦）</option>
                  </select>
                </div>
              </div>`
            : ""
        }

        <div class="sensei-call-stage">
          <div id="sensei-call-orb" class="sensei-call-orb state-${state.callStatus}">${ico("phone")}</div>
          <div id="sensei-call-status-label" class="sensei-call-status"></div>
          <div class="sensei-call-controls">
            ${
              !state.callActive
                ? `<button type="button" class="sensei-btn primary big" id="sensei-start-call-btn">开始实时日语通话</button>`
                : `
                  <button type="button" class="sensei-btn warn" id="sensei-bargein-btn">插话打断</button>
                  <button type="button" class="sensei-btn ghost" id="sensei-hint-btn">帮我接话</button>
                  <button type="button" class="sensei-btn ghost" id="sensei-slow-btn">慢点说</button>
                  <button type="button" class="sensei-btn danger" id="sensei-stop-call-btn">挂断并生成战报</button>
                `
            }
          </div>
        </div>

        ${
          state.liveHints.length
            ? `<div class="sensei-hints-drawer">
                <div class="sensei-hints-title">接话灵感（直接开口念，或点击听示范）：</div>
                ${state.liveHints
                  .map(
                    (h) => `
                    <div class="sensei-hint-row">
                      <div><strong>${escapeHtml(h.jp)}</strong> <span class="sensei-hint-read">${escapeHtml(h.reading)}</span> · ${escapeHtml(h.cn)}</div>
                      <button type="button" class="sensei-mini-btn" data-tts-lang="ja" data-tts-text="${escapeHtml(h.jp)}">${ico("speaker")} 示范</button>
                    </div>`
                  )
                  .join("")}
              </div>`
            : ""
        }
      </div>

      <div class="sensei-card">
        <div class="sensei-chat-head">实时双轨字幕（点击任意日语词查义存卡）</div>
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
    const favs = state.favorites || [];
    const ico = (name) => (window.JP_APP && window.JP_APP.icon ? window.JP_APP.icon(name) : "");

    const favCardHtml = `
      <div class="sensei-card">
        <div class="sensei-nb-head">
          <div>
            <h4>⭐ 我的收藏常练句</h4>
            <p class="sensei-muted-note">已收藏 ${favs.length} 句 · 在私教跟读时点击 ☆ 即可存入，随时重点复练</p>
          </div>
          ${
            favs.length
              ? `<button type="button" class="sensei-btn primary" id="sensei-practice-all-favs-btn" ${state.isGeneratingLesson ? "disabled" : ""}>🎯 全部用 AI 私教重练</button>`
              : ""
          }
        </div>
        ${
          favs.length === 0
            ? `<div class="sensei-empty-chat">暂无收藏句。练习过程中点击目标句或老师推荐说法旁的「☆ 收藏句子」，就可以单独建本反复跟读纠音。</div>`
            : `<div class="sensei-fav-list">
                ${favs
                  .map(
                    (f) => `<div class="sensei-fav-item">
                      <div class="sensei-fav-item-top">
                        <div style="min-width:0;flex:1;">
                          <div class="sensei-fav-item-jp">${renderTokensHtml(f.tokens, f.jp)}</div>
                          ${f.cn ? `<div class="sensei-fav-item-cn">${escapeHtml(f.cn)}</div>` : ""}
                        </div>
                        <div class="sensei-fav-item-actions">
                          <button type="button" class="sensei-mini-btn" data-tts-lang="ja" data-tts-text="${escapeHtml(f.jp)}" title="标准示范">${ico("speaker")}</button>
                          <button type="button" class="sensei-mini-btn sensei-fav-btn active" data-practice-fav="${escapeHtml(f.id)}">🎙️ 重练</button>
                          <button type="button" class="sensei-mini-btn" data-del-fav="${escapeHtml(f.id)}" aria-label="删除收藏">✕</button>
                        </div>
                      </div>
                      <div class="sensei-fav-item-meta">
                        ${f.level ? `<span class="sensei-badge">${escapeHtml(f.level)}</span>` : ""}
                        ${f.lesson_title ? `<span>来源：${escapeHtml(f.lesson_title)}</span>` : ""}
                        <span>已复练 ${Number(f.practice_count || 0)} 次${Number(f.last_score || 0) > 0 ? ` · 最高 ${f.last_score} 分` : ""}</span>
                      </div>
                    </div>`
                  )
                  .join("")}
              </div>`
        }
      </div>
    `;

    return `
      ${favCardHtml}

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
            ${escapeHtml(tk.reading || "")}${tk.pitch_accent ? ` · ${escapeHtml(tk.pitch_accent)}` : ""}
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

  function renderSettingsDrawer(userOptions, voiceOptions, coachOptions) {
    if (!state.drawerOpen) return "";
    const syl = state.syllabus;
    const rec = syl?.recommendedLesson;
    const scenarioOptions = state.scenarios
      .map(
        (s) =>
          `<option value="${escapeHtml(s.id)}" ${s.id === state.selectedScenarioId ? "selected" : ""}>${escapeHtml(s.title)}（${s.category === "daily" ? "日常" : "旅行"}）</option>`
      )
      .join("");
    const activeLvl = state.syllabusLevelFilter || "all";
    const filteredTracks = (syl?.tracks || [])
      .map((tr) => {
        const lessons = (tr.lessons || []).filter((l) => activeLvl === "all" || l.level === activeLvl);
        return { ...tr, lessons };
      })
      .filter((tr) => tr.lessons.length > 0);
    const flatFiltered = filteredTracks.flatMap((tr) => tr.lessons);
    const selectedLessonObj =
      flatFiltered.find((l) => l.id === state.selectedLessonId) ||
      (activeLvl !== "all" ? syl?.recommendedByLevel?.[activeLvl] : null) ||
      flatFiltered.find((l) => l.id === rec?.id) ||
      flatFiltered[0] ||
      rec;
    const currentLessonId = selectedLessonObj?.id || "";
    const trackOptGroups = filteredTracks
      .map(
        (tr) => `
        <optgroup label="${escapeHtml(tr.title)}">
          ${(tr.lessons || [])
            .map((l) => {
              const badge = l.status === "completed" ? `已学 ${l.bestScore}分 · ` : rec?.id === l.id ? "推荐 · " : "";
              const rBadge = l.hasReading ? " · 含精读" : "";
              return `<option value="${escapeHtml(l.id)}" ${l.id === currentLessonId ? "selected" : ""}>${badge}[${escapeHtml(l.level)}] ${escapeHtml(l.title)}${rBadge}</option>`;
            })
            .join("")}
        </optgroup>`
      )
      .join("");

    const levelTabs = [
      { id: "all", label: `全部 (${syl?.totalCount || 40})` },
      { id: "N5", label: "N5 基础" },
      { id: "N4", label: "N4 进阶" },
      { id: "N3", label: "N3 实战" },
    ]
      .map(
        (t) =>
          `<button type="button" class="sensei-pill ${activeLvl === t.id ? "active" : ""}" data-slevel="${t.id}">${t.label}</button>`
      )
      .join("");

    const previewBox = selectedLessonObj
      ? `
        <div class="tb-drawer-preview">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:0.4rem;">
            <strong style="color:var(--text-primary);font-size:0.81rem;">[${escapeHtml(selectedLessonObj.level)}] ${escapeHtml(selectedLessonObj.title)}</strong>
            <span class="sensei-badge">${selectedLessonObj.grammarCount || 2} 语法${selectedLessonObj.hasReading ? " · 长文精读" : ""}</span>
          </div>
          ${selectedLessonObj.canDoCn ? `<div><strong>学习目标：</strong>${escapeHtml(selectedLessonObj.canDoCn)}</div>` : ""}
          ${(selectedLessonObj.vocabPreview || []).length ? `<div><strong>核心词：</strong>${escapeHtml(selectedLessonObj.vocabPreview.join(" / "))}</div>` : ""}
        </div>`
      : "";

    let courseBody = "";
    if (state.curriculumMode === "sensei_syllabus") {
      courseBody = `
        <label class="sensei-lbl">${syl?.totalCount || 40} 课标准阶梯教材 (N5→N3)</label>
        <div class="sensei-pill-group" style="margin-bottom:0.5rem;flex-wrap:wrap;">${levelTabs}</div>
        <select id="sensei-lesson-select" class="sensei-select">${trackOptGroups}</select>
        ${previewBox}
        <div style="display:flex;gap:0.45rem;margin-top:0.65rem;">
          <button type="button" class="sensei-btn ghost" id="sensei-preview-textbook-btn" data-lesson-id="${escapeHtml(currentLessonId)}" style="flex:1;" ${!currentLessonId ? "disabled" : ""}>
            📖 精读教材
          </button>
          <button type="button" class="sensei-btn primary" id="sensei-start-lesson-btn" style="flex:1.35;" ${state.isGeneratingLesson ? "disabled" : ""}>
            ${state.isGeneratingLesson ? "正在现场备课..." : "开始本课私教"}
          </button>
        </div>
      `;
    } else if (state.curriculumMode === "grammar_point") {
      const allGrammar = getAllGrammarItems();
      const lvlFilter = (state.grammarLevelFilter || "all").toUpperCase();
      const qFilter = (state.grammarQuery || "").trim().toLowerCase();
      const filteredGrammar = allGrammar.filter((g) => {
        if (lvlFilter !== "ALL" && g.level !== lvlFilter) return false;
        if (qFilter) {
          const hay = `${g.pattern} ${g.reading} ${g.meaning}`.toLowerCase();
          if (!hay.includes(qFilter)) return false;
        }
        return true;
      });
      const activeGid = filteredGrammar.some((g) => g.id === state.selectedGrammarId)
        ? state.selectedGrammarId
        : filteredGrammar[0]?.id || "";
      const grammarOptions = filteredGrammar.length
        ? filteredGrammar
            .map(
              (g) =>
                `<option value="${escapeHtml(g.id)}" ${g.id === activeGid ? "selected" : ""}>[${escapeHtml(g.level)}] ${escapeHtml(g.pattern)} — ${escapeHtml(g.meaning)}</option>`
            )
            .join("")
        : `<option value="">未匹配到语法条目</option>`;
      courseBody = `
        <div class="drawer-grammar-toolbar">
          <div class="drawer-grammar-pills">
            ${["all", "N5", "N4", "N3"]
              .map(
                (lvl) =>
                  `<button type="button" class="sensei-mini-btn ${(state.grammarLevelFilter || "all") === lvl ? "active" : ""}" data-glevel="${lvl}">${lvl === "all" ? `全部 (${allGrammar.length})` : lvl}</button>`
              )
              .join("")}
          </div>
          <input type="text" id="sensei-grammar-search" class="sensei-input" style="width:100%;" placeholder="搜语法关键词（如：ている、てもいい、はず、わけ）..." value="${escapeHtml(state.grammarQuery || "")}" />
        </div>
        <select id="sensei-grammar-select" class="sensei-select">${grammarOptions}</select>
        <button type="button" class="sensei-btn primary" id="sensei-start-lesson-btn" style="margin-top:0.65rem;width:100%;" ${state.isGeneratingLesson || !filteredGrammar.length ? "disabled" : ""}>
          ${state.isGeneratingLesson ? "正在编写语法私教课..." : "开始 AI 语法精讲"}
        </button>
      `;
    } else if (state.curriculumMode === "custom_topic") {
      const chips = [
        "彻底搞懂 あげる / もらう / くれる 的视角",
        "日式委婉拒绝与缓冲语 〜んですけど",
        "和日本同事聊AI科技、工作与周末",
        "真人口语缩略 〜てる / 〜ちゃう / 〜なきゃ",
      ];
      courseBody = `
        <label class="sensei-lbl">输入任意语法或生活聊天话题</label>
        <input type="text" id="sensei-custom-topic-input" class="sensei-input" style="width:100%;" placeholder="如：区分 わけ / はず；或在东京咖啡店聊工作..." value="${escapeHtml(state.customTopic)}" />
        <button type="button" class="sensei-btn primary" id="sensei-start-lesson-btn" style="margin-top:0.65rem;width:100%;" ${state.isGeneratingLesson ? "disabled" : ""}>
          ${state.isGeneratingLesson ? "正在现场备课..." : "现编教材并开课"}
        </button>
        <div class="sensei-quick-chips" style="margin-top:0.65rem;">
          ${chips.map((c) => `<button type="button" class="sensei-mini-btn" data-quick-topic="${escapeHtml(c)}">${escapeHtml(c)}</button>`).join("")}
        </div>
      `;
    } else {
      courseBody = `
        <label class="sensei-lbl">选择旅行或日常专项场景</label>
        <select id="sensei-scenario-select" class="sensei-select">${scenarioOptions}</select>
        <label class="sensei-lbl" style="margin-top:0.6rem;">训练模式</label>
        <select id="sensei-lesson-type-select" class="sensei-select">
          <option value="guided_10min" ${state.lessonType === "guided_10min" ? "selected" : ""}>完整 AI 场景对话课（现编教材）</option>
          <option value="pronunciation_drill" ${state.lessonType === "pronunciation_drill" ? "selected" : ""}>专注声学镜子发音过关</option>
          <option value="substitution_drill" ${state.lessonType === "substitution_drill" ? "selected" : ""}>动词槽位口头替换操练</option>
        </select>
        <button type="button" class="sensei-btn primary" id="sensei-start-lesson-btn" style="margin-top:0.65rem;width:100%;" ${state.isGeneratingLesson ? "disabled" : ""}>
          ${state.isGeneratingLesson ? "正在编排家庭场景对话..." : "AI 生成家庭场景对话课"}
        </button>
      `;
    }

    return `
      <div class="ui-drawer-backdrop" id="sensei-drawer-backdrop">
        <aside class="ui-drawer" role="dialog" aria-modal="true" aria-label="选课与私教偏好">
          <div class="ui-drawer-head">
            <h3>选课与私教偏好</h3>
            <button type="button" class="sensei-mini-btn" id="sensei-drawer-close-btn" aria-label="关闭抽屉">✕</button>
          </div>
          <div class="ui-drawer-body">
            <div class="ui-drawer-section">
              <div class="ui-drawer-sec-title">切换课程</div>
              <div class="ui-segmented" style="width:100%;margin-bottom:0.75rem;">
                <button type="button" class="ui-seg-btn ${state.curriculumMode === "sensei_syllabus" ? "active" : ""}" data-curmode="sensei_syllabus">体系大纲</button>
                <button type="button" class="ui-seg-btn ${state.curriculumMode === "grammar_point" ? "active" : ""}" data-curmode="grammar_point">语法库</button>
                <button type="button" class="ui-seg-btn ${state.curriculumMode === "travel_scenario" ? "active" : ""}" data-curmode="travel_scenario">旅行场景</button>
                <button type="button" class="ui-seg-btn ${state.curriculumMode === "custom_topic" ? "active" : ""}" data-curmode="custom_topic">自由命题</button>
              </div>
              ${courseBody}
              ${
                (state.favorites || []).length
                  ? `<button type="button" class="sensei-btn ghost sensei-fav-btn active" id="sensei-drawer-fav-btn" style="margin-top:0.65rem;width:100%;">★ 复练我的收藏句 (${state.favorites.length} 句)</button>`
                  : ""
              }
            </div>

            <div class="ui-drawer-section">
              <div class="ui-drawer-sec-title">课堂偏好</div>
              <label class="ui-switch-row">
                <span>立刻回放我的原声（声学镜子）</span>
                <input type="checkbox" class="ui-switch" id="chk-mirror-playback" ${state.mirrorPlayback ? "checked" : ""} />
              </label>
              <label class="ui-switch-row">
                <span>穿插旧词与错题复习</span>
                <input type="checkbox" class="ui-switch" id="chk-include-review" ${state.includeReview ? "checked" : ""} />
              </label>
              <label class="ui-switch-row">
                <span>说完停顿自动提交</span>
                <input type="checkbox" class="ui-switch" id="chk-auto-stop" ${state.autoStopSilence ? "checked" : ""} />
              </label>
              <label class="ui-switch-row">
                <span>过关后自动进入下一步</span>
                <input type="checkbox" class="ui-switch" id="chk-auto-next" ${state.autoAdvanceOnPass ? "checked" : ""} />
              </label>
              <label class="ui-switch-row">
                <span>老师说完自动开麦（桌面端）</span>
                <input type="checkbox" class="ui-switch" id="chk-auto-reopen" ${state.autoReopenMic ? "checked" : ""} />
              </label>
            </div>

            <div class="ui-drawer-section">
              <div class="ui-drawer-sec-title">档案与语音引擎</div>
              <label class="sensei-lbl">当前学习成员</label>
              <select id="sensei-user-select" class="sensei-select">${userOptions}</select>
              <label class="sensei-lbl" style="margin-top:0.6rem;">老师声线</label>
              <select id="sensei-voice-select" class="sensei-select">${voiceOptions}</select>
              <label class="sensei-lbl" style="margin-top:0.6rem;">纠音裁判模型</label>
              <select id="sensei-coach-select" class="sensei-select">${coachOptions}</select>
            </div>
          </div>
        </aside>
      </div>
    `;
  }

  async function render(targetEl) {
    if (targetEl) containerEl = targetEl;
    if (!containerEl) return;

    if (!state.healthChecked) {
      containerEl.innerHTML = `<div class="sensei-shell"><div class="sensei-card">正在连接 Nihongo Sensei 私教引擎...</div></div>`;
      await initBackend(false);
    }

    if (!state.backendOnline) {
      containerEl.innerHTML = `<div class="sensei-shell">${renderOfflineSetupCard()}</div>`;
      bindEvents(containerEl);
      return;
    }

    if (state.subTab === "notebook") {
      state.subTab = "lesson";
    }

    const users = state.users.length
      ? state.users
      : [{ id: "haodong", display_name: "刘浩东", jlpt_target: "N4" }, { id: "sherry", display_name: "Sherry", jlpt_target: "N5" }];
    const activeUser = users.find((u) => u.id === state.userId) || users[0];
    const userOptions = users
      .map((u) => `<option value="${escapeHtml(u.id)}" ${u.id === state.userId ? "selected" : ""}>${escapeHtml(u.display_name)} (${escapeHtml(u.jlpt_target)})</option>`)
      .join("");

    const voices = state.health?.voices || [
      { id: "Aoede", label: "Aoede（温柔女老师）" },
      { id: "Kore", label: "Kore（知性女声）" },
      { id: "Puck", label: "Puck（男老师）" },
    ];
    const voiceOptions = voices
      .map((v) => `<option value="${escapeHtml(v.id)}" ${v.id === state.voice ? "selected" : ""}>${escapeHtml(v.label)}</option>`)
      .join("");

    const defaultCoach = state.health?.models?.coach || "gemini-4-hydrogen";
    const activeCoach = state.coachModel || defaultCoach;
    const coachModels = state.health?.coach_models || [
      { id: "gemini-4-hydrogen", label: "Gemini 4 Hydrogen（均衡推荐 · ~4s）" },
      { id: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash Lite（极速 · ~1.5s）" },
      { id: "gemini-4-neon", label: "Gemini 4 Neon（深度精评 · ~10s）" },
    ];
    const coachOptions = coachModels
      .map((m) => `<option value="${escapeHtml(m.id)}" ${m.id === activeCoach ? "selected" : ""}>${escapeHtml(m.label)}</option>`)
      .join("");

    const missingKeyWarning =
      state.health && !state.health.has_server_key && !(localStorage.getItem(GEMINI_KEY_STORAGE) || "").trim()
        ? `<div class="sensei-key-banner">
            服务端未设置 <code>GEMINI_API_KEY</code>，请填入本地 Key：
            <input type="password" id="sensei-inline-key-input" class="sensei-input small" placeholder="AIza..." />
            <button type="button" class="sensei-mini-btn" id="sensei-save-inline-key-btn">保存 Key</button>
          </div>`
        : "";

    const passcodeBanner =
      state.health?.auth_required && !state.passcodeVerified
        ? `<div class="sensei-lock-card">
            <div class="sensei-lock-title">输入家庭口令以解锁 AI 私教</div>
            <div class="sensei-lock-row">
              <input type="password" inputmode="numeric" id="sensei-passcode-input" class="sensei-input small" placeholder="输入家庭口令..." value="${escapeHtml(state.passcode)}" />
              <button type="button" class="sensei-btn primary" id="sensei-save-passcode-btn">解锁</button>
            </div>
          </div>`
        : "";

    const isFocusLesson = state.subTab === "lesson" && !!currentLessonStep();
    const ico = (name) => (window.JP_APP && window.JP_APP.icon ? window.JP_APP.icon(name) : "");

    let bodyHtml = "";
    if (state.subTab === "lesson") bodyHtml = renderLessonTab();
    else if (state.subTab === "call") bodyHtml = renderCallTab();
    else bodyHtml = renderStoryTab();

    containerEl.innerHTML = `
      <div class="sensei-shell ${isFocusLesson ? "focus-mode" : ""}">
        ${
          !isFocusLesson
            ? `<div class="sensei-studio-header">
                <div class="ui-segmented" role="tablist" aria-label="AI 私教模式">
                  <button type="button" class="ui-seg-btn ${state.subTab === "lesson" ? "active" : ""}" data-subtab="lesson">私教课</button>
                  <button type="button" class="ui-seg-btn ${state.subTab === "call" ? "active" : ""}" data-subtab="call">实时通话</button>
                  <button type="button" class="ui-seg-btn ${state.subTab === "story" ? "active" : ""}" data-subtab="story">有声故事</button>
                </div>
                <div class="sensei-studio-actions">
                  <span class="sensei-user-chip">${escapeHtml(activeUser.display_name)} · ${escapeHtml(activeUser.jlpt_target || "N4")}</span>
                  <button type="button" class="sensei-mini-btn" id="sensei-open-drawer-btn">${ico("sliders")} 选课与偏好</button>
                </div>
              </div>`
            : ""
        }

        ${missingKeyWarning}
        ${passcodeBanner}

        ${bodyHtml}
        ${renderSettingsDrawer(userOptions, voiceOptions, coachOptions)}
        ${renderTextbookPreviewModal()}
        ${renderTokenPopover()}
      </div>
    `;

    bindEvents(containerEl);
    updateMirrorPhaseDom();
    if (state.subTab === "call") {
      updateCallStatusDom();
      renderLiveChatLog();
    }
  }

  async function renderNotebook(targetEl) {
    if (targetEl) notebookContainerEl = targetEl;
    const host = notebookContainerEl || containerEl;
    if (!host) return;

    if (!state.healthChecked) {
      host.innerHTML = `<div class="sensei-shell"><div class="sensei-card">正在读取 AI 记忆本...</div></div>`;
      await initBackend(false);
    }
    if (!state.backendOnline) {
      host.innerHTML = `<div class="sensei-shell">${renderOfflineSetupCard()}</div>`;
      bindEvents(host);
      return;
    }
    if (!state.memoryData) {
      try {
        const [mem, cards] = await Promise.all([
          apiJson(`/api/memory?user_id=${encodeURIComponent(state.userId)}`),
          apiJson(`/api/srs/cards?user_id=${encodeURIComponent(state.userId)}`),
        ]);
        state.memoryData = mem;
        state.srsCards = cards.cards || [];
        const nowIso = new Date().toISOString();
        state.reviewQueue = state.srsCards.filter((c) => !c.next_due || c.next_due <= nowIso);
        if (state.reviewQueue.length === 0) state.reviewQueue = state.srsCards.slice(0, 10);
        state.reviewIdx = 0;
        state.reviewShowBack = false;
      } catch {}
    }

    const passcodeBanner =
      state.health?.auth_required && !state.passcodeVerified
        ? `<div class="sensei-lock-card">
            <div class="sensei-lock-title">输入家庭口令以解锁 AI 记忆本</div>
            <div class="sensei-lock-row">
              <input type="password" inputmode="numeric" id="sensei-passcode-input" class="sensei-input small" placeholder="输入家庭口令..." value="${escapeHtml(state.passcode)}" />
              <button type="button" class="sensei-btn primary" id="sensei-save-passcode-btn">解锁</button>
            </div>
          </div>`
        : "";

    host.innerHTML = `
      <div class="sensei-shell">
        ${passcodeBanner}
        ${renderNotebookTab()}
        ${renderTokenPopover()}
      </div>
    `;
    bindEvents(host);
  }

  function renderView() {
    if (containerEl && containerEl.style.display !== "none") {
      render(containerEl);
    }
    if (notebookContainerEl && notebookContainerEl.style.display !== "none") {
      renderNotebook(notebookContainerEl);
    }
  }

  function bindEvents(root = containerEl) {
    if (!root) return;

    const connBtn = root.querySelector("#sensei-connect-backend-btn");
    if (connBtn) {
      connBtn.onclick = async () => {
        const val = (root.querySelector("#sensei-backend-url-input")?.value || "").trim().replace(/\/+$/, "");
        state.backendBase = val;
        localStorage.setItem(BACKEND_URL_STORAGE, val);
        state.healthChecked = false;
        await renderView();
      };
    }

    const saveKeyBtn = root.querySelector("#sensei-save-inline-key-btn");
    if (saveKeyBtn) {
      saveKeyBtn.onclick = () => {
        const key = (root.querySelector("#sensei-inline-key-input")?.value || "").trim();
        if (!key) return;
        localStorage.setItem(GEMINI_KEY_STORAGE, key);
        showToast("✅ 已保存本地 Gemini Key");
        renderView();
      };
    }

    const passcodeInput = root.querySelector("#sensei-passcode-input");
    const savePasscodeBtn = root.querySelector("#sensei-save-passcode-btn");
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

    // Drawer & Focus Header Controls
    const openDrawer = () => { state.drawerOpen = true; renderView(); };
    const closeDrawer = () => { state.drawerOpen = false; renderView(); };
    const openDrawerBtn = root.querySelector("#sensei-open-drawer-btn");
    if (openDrawerBtn) openDrawerBtn.onclick = openDrawer;
    const openDrawerFocus = root.querySelector("#sensei-open-drawer-focus");
    if (openDrawerFocus) openDrawerFocus.onclick = openDrawer;
    const openCoursePicker = root.querySelector("#sensei-open-course-picker");
    if (openCoursePicker) openCoursePicker.onclick = openDrawer;
    const drawerCloseBtn = root.querySelector("#sensei-drawer-close-btn");
    if (drawerCloseBtn) drawerCloseBtn.onclick = closeDrawer;
    const drawerBackdrop = root.querySelector("#sensei-drawer-backdrop");
    if (drawerBackdrop) {
      drawerBackdrop.onclick = (e) => {
        if (e.target === drawerBackdrop) closeDrawer();
      };
    }

    const exitLessonBtn = root.querySelector("#sensei-exit-lesson-btn");
    if (exitLessonBtn) {
      exitLessonBtn.onclick = () => {
        clearAutoAdvanceTimer();
        turnChoreographySeq += 1;
        stopSimpleAudio();
        if (state.isRecordingTurn) cancelLessonRecording();
        state.lessonSession = null;
        state.lastTurnResult = null;
        state.mirrorPhase = "";
        renderView();
      };
    }

    const toggleBbBtn = root.querySelector("#sensei-toggle-bb-btn");
    if (toggleBbBtn) {
      toggleBbBtn.onclick = () => {
        state.showBlackboard = !state.showBlackboard;
        renderView();
      };
    }

    const toggleCallCfg = root.querySelector("#sensei-toggle-call-cfg");
    if (toggleCallCfg) {
      toggleCallCfg.onclick = () => {
        state.showCallSettings = !state.showCallSettings;
        renderView();
      };
    }

    const userSel = root.querySelector("#sensei-user-select");
    if (userSel) {
      userSel.onchange = async () => {
        state.userId = userSel.value;
        localStorage.setItem(USER_STORAGE, state.userId);
        const u = state.users.find((x) => x.id === state.userId);
        if (u) state.jlptTarget = u.jlpt_target || state.jlptTarget;
        state.selectedLessonId = "";
        state.memoryData = null;
        state.favorites = [];
        await Promise.all([loadSyllabus(), loadFavorites()]);
        if (notebookContainerEl && notebookContainerEl.style.display !== "none") await loadNotebookData();
        else if (state.subTab === "story") await loadStories();
        else renderView();
      };
    }

    const coachSel = root.querySelector("#sensei-coach-select");
    if (coachSel) {
      coachSel.onchange = () => {
        state.coachModel = coachSel.value;
        localStorage.setItem(COACH_MODEL_STORAGE, state.coachModel);
        renderView();
      };
    }

    const voiceSel = root.querySelector("#sensei-voice-select");
    if (voiceSel) {
      voiceSel.onchange = () => {
        state.voice = voiceSel.value;
        localStorage.setItem(VOICE_STORAGE, state.voice);
      };
    }

    root.querySelectorAll("[data-subtab]").forEach((btn) => {
      btn.onclick = async () => {
        const tab = btn.dataset.subtab;
        if (state.subTab === tab) return;
        if (state.callActive && tab !== "call") {
          await stopLiveCall(true);
        }
        state.subTab = tab;
        renderView();
        if (tab === "story") await loadStories();
      };
    });

    // Guided lesson bindings
    root.querySelectorAll("[data-curmode]").forEach((btn) => {
      btn.onclick = () => {
        state.curriculumMode = btn.dataset.curmode;
        renderView();
      };
    });
    root.querySelectorAll("[data-slevel]").forEach((btn) => {
      btn.onclick = () => {
        const lvl = btn.dataset.slevel || "all";
        state.syllabusLevelFilter = lvl;
        const tracks = state.syllabus?.tracks || [];
        const matches = tracks
          .flatMap((tr) => tr.lessons || [])
          .filter((l) => lvl === "all" || l.level === lvl);
        if (matches.length && !matches.some((l) => l.id === state.selectedLessonId)) {
          state.selectedLessonId =
            (lvl !== "all" ? state.syllabus?.recommendedByLevel?.[lvl]?.id : null) ||
            matches[0].id;
        }
        renderView();
      };
    });
    const lessonSel = root.querySelector("#sensei-lesson-select");
    if (lessonSel) {
      lessonSel.onchange = () => {
        state.selectedLessonId = lessonSel.value;
        renderView();
      };
    }
    const previewTbBtn = root.querySelector("#sensei-preview-textbook-btn");
    if (previewTbBtn) {
      previewTbBtn.onclick = () => {
        const lid =
          previewTbBtn.dataset.lessonId ||
          lessonSel?.value ||
          state.selectedLessonId ||
          state.syllabus?.recommendedLesson?.id;
        if (lid) openTextbookPreview(lid);
      };
    }
    const grammarSel = root.querySelector("#sensei-grammar-select");
    if (grammarSel) grammarSel.onchange = () => { state.selectedGrammarId = grammarSel.value; };
    root.querySelectorAll("[data-glevel]").forEach((btn) => {
      btn.onclick = () => {
        state.grammarLevelFilter = btn.dataset.glevel || "all";
        renderView();
      };
    });
    const grammarSearch = root.querySelector("#sensei-grammar-search");
    if (grammarSearch) {
      grammarSearch.oninput = () => {
        state.grammarQuery = grammarSearch.value;
        const gSel = root.querySelector("#sensei-grammar-select");
        if (!gSel) return;
        const allG = getAllGrammarItems();
        const lvlFilter = (state.grammarLevelFilter || "all").toUpperCase();
        const q = (state.grammarQuery || "").trim().toLowerCase();
        const matches = allG.filter((g) => {
          if (lvlFilter !== "ALL" && g.level !== lvlFilter) return false;
          if (q) return `${g.pattern} ${g.reading} ${g.meaning}`.toLowerCase().includes(q);
          return true;
        });
        gSel.innerHTML = matches.length
          ? matches
              .map(
                (g) =>
                  `<option value="${escapeHtml(g.id)}" ${g.id === state.selectedGrammarId ? "selected" : ""}>[${escapeHtml(g.level)}] ${escapeHtml(g.pattern)} — ${escapeHtml(g.meaning)}</option>`
              )
              .join("")
          : `<option value="">未匹配到语法条目</option>`;
        state.selectedGrammarId = gSel.value;
        const startBtn = root.querySelector("#sensei-start-lesson-btn");
        if (startBtn) startBtn.disabled = state.isGeneratingLesson || !matches.length;
      };
    }
    const customInput = root.querySelector("#sensei-custom-topic-input");
    if (customInput) customInput.oninput = () => { state.customTopic = customInput.value; };
    root.querySelectorAll("[data-quick-topic]").forEach((btn) => {
      btn.onclick = () => {
        state.customTopic = btn.dataset.quickTopic;
        state.drawerOpen = false;
        startGuidedLesson({ curriculumMode: "custom_topic", customTopic: state.customTopic });
      };
    });
    const startRecBtn = root.querySelector("#sensei-start-rec-btn");
    if (startRecBtn) {
      startRecBtn.onclick = () =>
        startGuidedLesson({
          curriculumMode: "sensei_syllabus",
          lessonId: state.syllabus?.recommendedLesson?.id,
        });
    }
    const heroPreviewBtn = root.querySelector("#sensei-hero-preview-btn");
    if (heroPreviewBtn) {
      heroPreviewBtn.onclick = () => {
        const lid = heroPreviewBtn.dataset.lessonId || state.syllabus?.recommendedLesson?.id;
        if (lid) openTextbookPreview(lid);
      };
    }
    root.querySelectorAll("[data-jump-level]").forEach((btn) => {
      btn.onclick = () => {
        const lvl = btn.dataset.jumpLevel || "all";
        state.curriculumMode = "sensei_syllabus";
        state.syllabusLevelFilter = lvl;
        const recByLvl = state.syllabus?.recommendedByLevel?.[lvl]?.id;
        const firstByLvl = (state.syllabus?.tracks || [])
          .flatMap((tr) => tr.lessons || [])
          .find((l) => lvl === "all" || l.level === lvl)?.id;
        state.selectedLessonId = recByLvl || firstByLvl || "";
        state.drawerOpen = true;
        renderView();
      };
    });

    const scSel = root.querySelector("#sensei-scenario-select");
    if (scSel) scSel.onchange = () => { state.selectedScenarioId = scSel.value; };
    const ltSel = root.querySelector("#sensei-lesson-type-select");
    if (ltSel) ltSel.onchange = () => { state.lessonType = ltSel.value; };
    const chkReview = root.querySelector("#chk-include-review");
    if (chkReview) {
      chkReview.onchange = () => {
        state.includeReview = chkReview.checked;
        localStorage.setItem(INCLUDE_REVIEW_STORAGE, state.includeReview ? "true" : "false");
      };
    }
    const chkMirror = root.querySelector("#chk-mirror-playback");
    if (chkMirror) chkMirror.onchange = () => { state.mirrorPlayback = chkMirror.checked; };
    const chkAuto = root.querySelector("#chk-auto-reopen");
    if (chkAuto) chkAuto.onchange = () => { state.autoReopenMic = chkAuto.checked; };
    const chkAutoStop = root.querySelector("#chk-auto-stop");
    if (chkAutoStop) chkAutoStop.onchange = () => { state.autoStopSilence = chkAutoStop.checked; };
    const chkAutoNext = root.querySelector("#chk-auto-next");
    if (chkAutoNext) chkAutoNext.onchange = () => { state.autoAdvanceOnPass = chkAutoNext.checked; };

    const startLessonBtn = root.querySelector("#sensei-start-lesson-btn");
    if (startLessonBtn) {
      startLessonBtn.onclick = () => {
        if (state.curriculumMode === "grammar_point") {
          const gSel = root.querySelector("#sensei-grammar-select");
          if (gSel && gSel.value) state.selectedGrammarId = gSel.value;
        }
        state.drawerOpen = false;
        startGuidedLesson();
      };
    }

    const peekBtn = root.querySelector("#sensei-peek-btn");
    if (peekBtn) peekBtn.onclick = () => { state.peekHint = true; renderView(); };

    const recBtn = root.querySelector("#sensei-record-turn-btn");
    if (recBtn) recBtn.onclick = () => toggleLessonRecording();

    const cancelRecBtn = root.querySelector("#sensei-cancel-rec-btn");
    if (cancelRecBtn) cancelRecBtn.onclick = cancelLessonRecording;

    const cancelEvalBtn = root.querySelector("#sensei-cancel-eval-btn");
    if (cancelEvalBtn) cancelEvalBtn.onclick = cancelTurnEvaluation;

    const prevBtn = root.querySelector("#sensei-prev-step-btn");
    if (prevBtn) prevBtn.onclick = () => advanceLessonStep(-1);
    const nextBtn = root.querySelector("#sensei-next-step-btn");
    if (nextBtn) nextBtn.onclick = () => advanceLessonStep(1);
    const passNextBtn = root.querySelector("#sensei-pass-next-btn");
    if (passNextBtn) passNextBtn.onclick = () => advanceLessonStep(1);
    const skipConsBtn = root.querySelector("#sensei-skip-consolidate-btn");
    if (skipConsBtn) skipConsBtn.onclick = () => advanceLessonStep(1);
    root.querySelectorAll("[data-ask-quick]").forEach((btn) => {
      btn.onclick = () => askSenseiFollowup(btn.dataset.askQuick);
    });
    const askInput = root.querySelector("#sensei-ask-input");
    if (askInput) {
      askInput.oninput = () => {
        state.followupInput = askInput.value;
      };
      askInput.onkeydown = (e) => {
        if (e.key === "Enter" && !e.isComposing) {
          e.preventDefault();
          askSenseiFollowup(askInput.value);
        }
      };
    }
    const askSubmitBtn = root.querySelector("#sensei-ask-submit-btn");
    if (askSubmitBtn) {
      askSubmitBtn.onclick = () => askSenseiFollowup(askInput ? askInput.value : state.followupInput);
    }
    const regenBtn = root.querySelector("#sensei-regen-lesson-btn");
    if (regenBtn) regenBtn.onclick = regenerateCurrentLesson;
    const extendBtn = root.querySelector("#sensei-extend-lesson-btn");
    if (extendBtn) extendBtn.onclick = extendCurrentLesson;
    const passExtendBtn = root.querySelector("#sensei-pass-extend-btn");
    if (passExtendBtn) passExtendBtn.onclick = extendCurrentLesson;

    root.querySelectorAll("[data-jump-step]").forEach((btn) => {
      btn.onclick = () => {
        const idx = Number(btn.dataset.jumpStep);
        if (!Number.isNaN(idx)) advanceLessonStep(idx - state.lessonStepIdx);
      };
    });

    root.querySelectorAll("[data-save-diag-vocab]").forEach((btn) => {
      btn.onclick = () => {
        const v = (state.lastTurnResult?.extractedVocab || [])[Number(btn.dataset.saveDiagVocab)];
        if (v) saveTokenToSrs({ ...v, context_jp: state.lastTurnResult?.targetJp || "" });
      };
    });

    // Live Call bindings
    const callScSel = root.querySelector("#sensei-call-scenario");
    if (callScSel) callScSel.onchange = () => { state.selectedScenarioId = callScSel.value; };
    const corrModeSel = root.querySelector("#sensei-corr-mode");
    if (corrModeSel) corrModeSel.onchange = () => { state.correctionMode = corrModeSel.value; };
    const outModeSel = root.querySelector("#sensei-audio-output-mode");
    if (outModeSel) outModeSel.onchange = () => { state.audioOutputMode = outModeSel.value; updateCallStatusDom(); };

    const startCallBtn = root.querySelector("#sensei-start-call-btn");
    if (startCallBtn) {
      startCallBtn.onclick = () => {
        state.showCallSettings = false;
        startLiveCall();
      };
    }
    const stopCallBtn = root.querySelector("#sensei-stop-call-btn");
    if (stopCallBtn) stopCallBtn.onclick = () => stopLiveCall(true);
    const bargeBtn = root.querySelector("#sensei-bargein-btn");
    if (bargeBtn) bargeBtn.onclick = triggerLiveBargeIn;
    const hintBtn = root.querySelector("#sensei-hint-btn");
    if (hintBtn) hintBtn.onclick = () => sendLiveControl("hint_request");
    const slowBtn = root.querySelector("#sensei-slow-btn");
    if (slowBtn) slowBtn.onclick = () => sendLiveControl("slow_down");

    // Notebook & Story bindings
    const impBtn = root.querySelector("#sensei-import-legacy-btn");
    if (impBtn) impBtn.onclick = importLegacyToFsrs;
    const refBtn = root.querySelector("#sensei-refresh-nb-btn");
    if (refBtn) refBtn.onclick = loadNotebookData;
    const flipBtn = root.querySelector("#sensei-fsrs-flip-btn");
    if (flipBtn) flipBtn.onclick = () => { state.reviewShowBack = true; renderView(); };
    root.querySelectorAll("[data-fsrs-rate]").forEach((btn) => {
      btn.onclick = () => submitFSRSReview(Number(btn.dataset.fsrsRate));
    });

    const genStoryBtn = root.querySelector("#sensei-gen-story-btn");
    if (genStoryBtn) genStoryBtn.onclick = createGradedStory;

    // Shared audio & Tap-Any-Word token popover bindings
    root.querySelectorAll("[data-play-url]").forEach((btn) => {
      btn.onclick = () => {
        ensureLessonAudioCtx();
        const url = btn.dataset.playUrl;
        if (!isIOSDevice && url && url === localMirrorBlobUrl && lastMirrorBlob) {
          return playBlobViaWebAudio(lastMirrorBlob, url);
        }
        return playUrlAsync(url);
      };
    });
    root.querySelectorAll("[data-tts-text]").forEach((btn) => {
      btn.onclick = () => playTextTts(btn.dataset.ttsText, { lang: btn.dataset.ttsLang || null });
    });
    root.querySelectorAll("[data-tok-surface]").forEach((btn) => {
      btn.onclick = () =>
        openWordLookup(
          btn.dataset.tokSurface,
          btn.dataset.tokLemma,
          btn.dataset.tokReading,
          btn.dataset.tokContext
        );
    });

    const dictClose = root.querySelector("#sensei-dict-close");
    if (dictClose) dictClose.onclick = () => { state.activeTokenEntry = null; renderView(); };
    const dictBackdrop = root.querySelector("#sensei-dict-backdrop");
    if (dictBackdrop) {
      dictBackdrop.onclick = (e) => {
        if (e.target === dictBackdrop) {
          state.activeTokenEntry = null;
          renderView();
        }
      };
    }
    const dictSave = root.querySelector("#sensei-dict-save-btn");
    if (dictSave) {
      dictSave.onclick = async () => {
        await saveTokenToSrs(state.activeTokenEntry);
        state.activeTokenEntry = null;
        renderView();
      };
    }
    const closeTbModal = () => {
      state.previewChapter = null;
      renderView();
    };
    const tbCloseBtn = root.querySelector("#sensei-tb-modal-close");
    if (tbCloseBtn) tbCloseBtn.onclick = closeTbModal;
    const tbCloseFootBtn = root.querySelector("#sensei-tb-modal-close-foot");
    if (tbCloseFootBtn) tbCloseFootBtn.onclick = closeTbModal;
    const tbBackdrop = root.querySelector("#sensei-tb-modal-backdrop");
    if (tbBackdrop) {
      tbBackdrop.onclick = (e) => {
        if (e.target === tbBackdrop) closeTbModal();
      };
    }
    const tbStartBtn = root.querySelector("#sensei-tb-start-btn");
    if (tbStartBtn) {
      tbStartBtn.onclick = () => {
        const lid = tbStartBtn.dataset.lessonId || state.previewChapter?.id || state.selectedLessonId;
        state.previewChapter = null;
        state.drawerOpen = false;
        if (lid) startGuidedLesson({ curriculumMode: "sensei_syllabus", lessonId: lid });
        else renderView();
      };
    }
    root.querySelectorAll("[data-save-tb-vocab]").forEach((btn) => {
      btn.onclick = async () => {
        const idx = Number(btn.dataset.saveTbVocab);
        const chapter = state.previewChapter || state.lessonSession?.lessonMeta?.textbook;
        const v = (chapter?.vocabList || [])[idx];
        if (!v) return;
        await saveTokenToSrs({
          surface: v.jp,
          lemma: v.jp,
          reading: v.reading || "",
          meaning_cn: v.cn || "",
          jlpt: chapter?.level || state.lessonSession?.lessonMeta?.level || "N4",
          context_jp: "",
        });
      };
    });

    const favStepBtn = root.querySelector("#sensei-fav-step-btn");
    if (favStepBtn) {
      favStepBtn.onclick = () => {
        const step = currentLessonStep();
        const meta = state.lessonSession?.lessonMeta || {};
        if (!step || !step.targetJp) return;
        toggleFavoriteSentence({
          jp: step.targetJp,
          cn: step.targetCn || "",
          tipCn: step.tipCn || "",
          lessonTitle: meta.title || "",
          level: meta.level || state.jlptTarget || "N4",
          grammarFocus: meta.grammarFocus || "",
        });
      };
    }
    root.querySelectorAll("[data-fav-diag]").forEach((btn) => {
      btn.onclick = () => {
        const res = state.lastTurnResult;
        const meta = state.lessonSession?.lessonMeta || {};
        const step = currentLessonStep();
        if (!res) return;
        if (btn.dataset.favDiag === "native" && res.nativeUpgradeJp) {
          toggleFavoriteSentence({
            jp: res.nativeUpgradeJp,
            cn: res.nativeUpgradeNoteCn || step?.targetCn || "",
            tipCn: res.nativeUpgradeNoteCn || "",
            lessonTitle: meta.title || "",
            level: res.jlptLevel || meta.level || state.jlptTarget || "N4",
            grammarFocus: meta.grammarFocus || "",
          });
        } else if (btn.dataset.favDiag === "better" && res.betterJp) {
          toggleFavoriteSentence({
            jp: res.betterJp,
            cn: step?.targetCn || "",
            tipCn: res.actionTipCn || res.grammarNote || "",
            lessonTitle: meta.title || "",
            level: res.jlptLevel || meta.level || state.jlptTarget || "N4",
            grammarFocus: meta.grammarFocus || "",
          });
        }
      };
    });
    const heroFavBtn = root.querySelector("#sensei-hero-fav-btn");
    if (heroFavBtn) heroFavBtn.onclick = () => startFavoritesPractice("");
    const drawerFavBtn = root.querySelector("#sensei-drawer-fav-btn");
    if (drawerFavBtn) drawerFavBtn.onclick = () => startFavoritesPractice("");
    const allFavBtn = root.querySelector("#sensei-practice-all-favs-btn");
    if (allFavBtn) allFavBtn.onclick = () => startFavoritesPractice("");
    root.querySelectorAll("[data-practice-fav]").forEach((btn) => {
      btn.onclick = () => startFavoritesPractice(btn.dataset.practiceFav || "");
    });
    root.querySelectorAll("[data-del-fav]").forEach((btn) => {
      btn.onclick = async () => {
        const fid = btn.dataset.delFav;
        if (!fid) return;
        try {
          await apiJson(`/api/favorites/${encodeURIComponent(fid)}?user_id=${encodeURIComponent(state.userId)}`, {
            method: "DELETE",
          });
          state.favorites = (state.favorites || []).filter((f) => f.id !== fid);
          showToast("已删除该收藏句");
          renderView();
        } catch (err) {
          showToast(`❌ 删除失败：${err.message}`);
        }
      };
    });
  }

  if (typeof document !== "undefined") {
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && (state.drawerOpen || state.activeTokenEntry || state.previewChapter)) {
        state.drawerOpen = false;
        state.activeTokenEntry = null;
        state.previewChapter = null;
        renderView();
      }
    });
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
    renderNotebook,
    startGrammarLesson,
    startFavoritesPractice,
    stopAll,
    initBackend,
  };
})();
