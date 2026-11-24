// Interactive Japanese Learning Engine (N5 Review + N4->N3 Fluency):
// 1. Vocabulary & Verbs Hub: Top 300 Verbs (Vi/Vt Pairs & 13 Forms), N5 Core Vocab (250 + 75 Adj), N4-N3 Library
// 2. JLPT N5 / N4 / N3 Grammar Guide (132 Patterns + 6 Confusable Comparisons)
// 3. Interactive Practice Lab: SRS (incl. N5 Vocab & Blind Mode), Vi/Vt & Particle Blitz, Conjugation Blitz, Grammar/Listening/Staff Quiz, Shadowing
(function () {
  const VERBS = window.JP_TOP_VERBS || [];
  const GRAMMAR = window.JP_GRAMMAR_LIST || [];
  const VIDEO_GRAMMAR = window.JP_VIDEO_GRAMMAR || [];
  const VIDEO_SOURCES = window.JP_VIDEO_GRAMMAR_SOURCES || {};
  const EXTRAS = window.JP_LEARNING_EXTRAS || {};

  const GROUP_LABELS = {
    godan: "五段 (u-verb)",
    ichidan: "一段 (ru-verb)",
    irregular: "不规则"
  };

  const TRANS_LABELS = {
    vi: "🔵 自动词 (が)",
    vt: "🟠 他动词 (を)",
    both: "🟣 自他两用"
  };

  const FORM_META = [
    { key: "masu", label: "ます形", sub: "礼貌" },
    { key: "te", label: "て形", sub: "请/连接" },
    { key: "ta", label: "た形", sub: "过去" },
    { key: "nai", label: "ない形", sub: "否定" },
    { key: "tai", label: "たい形", sub: "想做" },
    { key: "potential", label: "可能形", sub: "能做" },
    { key: "volitional", label: "意向形", sub: "一起吧" },
    { key: "ba", label: "ば形", sub: "如果" },
    { key: "passive", label: "受身形", sub: "被动" },
    { key: "causative", label: "使役形", sub: "让做" },
    { key: "causative_passive", label: "使役被动", sub: "被迫做" },
    { key: "imperative", label: "命令形", sub: "命令/标牌" }
  ];

  // Local view states for the 3 learning tabs
  const vState = {
    subTab: "verbs300", // 'verbs300' | 'n5vocab' | 'n4n3lib'
    // Verbs 300
    search: "",
    jlpt: "all",
    group: "all",
    transitivity: "all", // 'all' | 'vi' | 'vt' | 'paired'
    category: "all",
    status: "all",
    range: "1-50", // '1-50' .. '251-300' | 'all'
    showCheatSheet: false,
    // N5 Core Vocabulary (250 words + 75 adjectives)
    n5Cat: "all",
    n5Search: "",
    n5Status: "all",
    // N4-N3 Practical Library
    libTab: "contractions", // 'contractions' | 'adverbs' | 'onomatopoeia' | 'keigo' | 'staff' | 'signs'
    libSearch: ""
  };

  const gState = {
    subTab: "core", // 'core' | 'voylin-n4' | 'voylin-n3'
    search: "",
    level: "all", // 'all' | 'N5' | 'N4' | 'N3'
    importance: "all", // 'all' | '5' | '4' | '3'
    status: "all",
    videoFilter: "all", // 'all' | 'new_only' | 'linked'
    videoEmbedOpen: false,
    orderMode: "n5_first", // 'n5_first' | 'n3_first' | 'importance_all'
    showComparisons: false,
    openQuizIds: {}
  };

  const pState = {
    subMode: "srs", // 'srs' | 'vivt' | 'conj' | 'quiz' | 'shadow'
    // SRS Flashcards
    srsDeck: "verbs", // 'due' | 'n5vocab' | 'verbs' | 'pairs' | 'grammar' | 'video_grammar' | 'phrases' | 'starred'
    srsJlpt: "all",
    srsListenFirst: false,
    srsAutoPlay: true,
    srsFlipped: false,
    srsCurrentCard: null,
    // Vi/Vt & Particle Blitz
    vivtKind: "all", // 'all' | 'vivt' | 'particle'
    vivtQuestion: null,
    vivtAnswered: null,
    vivtStreak: 0,
    vivtCorrect: 0,
    vivtTotal: 0,
    // Conjugation Drill
    conjJlpt: "all",
    conjForm: "mixed",
    conjInputMode: "choice", // 'choice' | 'type'
    conjQuestion: null,
    conjAnswered: null,
    conjStreak: 0,
    conjCorrect: 0,
    conjTotal: 0,
    // Grammar, Listening & Staff Decoder Quiz
    quizKind: "grammar", // 'grammar' | 'listening' | 'staff'
    quizSource: "all", // 'all' | 'core' | 'video'
    quizLevel: "all",
    quizQuestion: null,
    quizAnswered: null,
    quizStreak: 0,
    quizCorrect: 0,
    quizTotal: 0
  };

  function app() {
    return window.JP_APP;
  }

  function bindQuickOralButtons(container) {
    if (!container) return;
    container.querySelectorAll(".quick-oral-btn").forEach((b) => {
      b.onclick = function () {
        if (window.JP_ORAL_COACH) {
          window.JP_ORAL_COACH.openQuickModal({
            id: this.dataset.oid,
            tag: this.dataset.otag || "🎙️ 跟读",
            jp: this.dataset.ojp,
            romaji: this.dataset.oromaji || "",
            cn: this.dataset.ocn || "",
            audioKey: this.dataset.oakey || null
          });
        }
      };
    });
  }

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function getAllPhraseItems() {
    const items = [];
    (app().getEffectiveModules() || []).forEach((m) => {
      (m.sections || []).forEach((s) => {
        (s.items || []).forEach((it) => {
          items.push({ ...it, modTitle: m.title });
        });
      });
    });
    return items;
  }

  function getN5VocabUnified() {
    const words = (EXTRAS.n5Vocab || []).map((w) => ({
      id: w.id,
      kind: "word",
      cat: w.cat,
      jp: w.jp,
      kana: w.kana,
      romaji: w.romaji,
      cn: w.cn,
      subMeta: "",
      ex: w.ex,
      exCn: w.exCn
    }));
    const adjs = (EXTRAS.adjectives || []).map((a, idx) => ({
      id: a.id || `adj-${String(idx + 1).padStart(3, "0")}`,
      kind: "adj",
      cat: "✨ 核心形容词 (75)",
      jp: a.jp,
      kana: a.kana,
      romaji: a.romaji,
      cn: a.cn,
      subMeta: `${a.type} · 否定: ${a.neg} · 过去: ${a.past}`,
      ex: a.ex,
      exCn: a.exCn
    }));
    return [...words, ...adjs];
  }

  // Explain conjugation rule concisely for drill feedback
  function getConjugationRuleHint(verb, formKey) {
    if (verb.group === "irregular") {
      if (verb.dict.endsWith("する")) return "サ变动词「〜する」：します / して / した / しない / できる / しよう / させられる";
      return "カ变动词「来る（くる）」：きます / きて / きた / こない / こられる / こよう / こい";
    }
    if (verb.group === "ichidan") {
      return "一段动词（ru-verb）：直接去掉末尾「る」再接 ます / て / た / ない / れば / られる / させる / させられる / ろ！";
    }
    const last = verb.dict.slice(-1);
    if (verb.dict === "行く" && (formKey === "te" || formKey === "ta")) {
      return "⚠️ 五段特例：「行く」的て/た形不是いいて，而是促音变「行って / 行った」！";
    }
    if (verb.dict === "ある" && formKey === "nai") {
      return "⚠️ 特例：「ある」的否定不是あらない，而是直接用「ない」！";
    }
    if (formKey === "te" || formKey === "ta") {
      if ("うつる".includes(last)) return "五段「う・つ・る」音变 → 促音「って / った」";
      if ("むぶぬ".includes(last)) return "五段「む・ぶ・ぬ」音变 → 拨音「んで / んだ」";
      if (last === "く") return "五段「く」音变 →「いて / いた」";
      if (last === "ぐ") return "五段「ぐ」音变 →「いで / いだ」";
      if (last === "す") return "五段「す」音变 →「して / した」";
    }
    if (formKey === "masu" || formKey === "tai") return `五段动词把词尾「${last}」移到同行的い段，再接 ます / たい`;
    if (formKey === "nai") return `五段动词把词尾「${last}」移到同行的あ段（う→わ），再接 ない`;
    if (formKey === "potential") return `五段动词把词尾「${last}」移到同行的え段，再接 る`;
    if (formKey === "volitional") return `五段动词把词尾「${last}」移到同行的お段，再接 う`;
    if (formKey === "ba") return `五段动词把词尾「${last}」移到同行的え段，再接 ば`;
    if (formKey === "passive") return `五段动词把词尾「${last}」移到同行的あ段，再接 れる`;
    if (formKey === "causative") return `五段动词把词尾「${last}」移到同行的あ段，再接 せる`;
    if (formKey === "causative_passive") {
      return last === "す"
        ? "⚠️ 五段「す」结尾不能缩短，使役被动必须用完整形「さ＋せられる」（如：話させられる）"
        : `五段动词（非す）使役被动常用短缩形：词尾「${last}」→ あ段 ＋ される（例：待たされる）`;
    }
    if (formKey === "imperative") return `五段动词把词尾「${last}」直接变为同行的え段即可（如：待て / 行け）`;
    return `五段动词变形规则（词尾：${last}）`;
  }

  // =========================================================================
  // MODALS: 13-FORM CONJUGATION & VI/VT PAIR SIDE-BY-SIDE COMPARISON
  // =========================================================================
  function openViVtCompareModal(vid1, vid2) {
    const vA = VERBS.find((v) => v.id === vid1);
    const vB = VERBS.find((v) => v.id === vid2);
    if (!vA || !vB) return;
    const viVerb = vA.transitivity === "vi" ? vA : vB;
    const vtVerb = viVerb === vA ? vB : vA;
    const { formatRuby, escapeHtml, speakJapanese, openModalHtml } = app();

    const renderSide = (v, isVi) => `
      <div class="vivt-side-card ${isVi ? "side-vi" : "side-vt"}">
        <div class="vivt-side-top">
          <span class="trans-pill ${isVi ? "trans-vi" : "trans-vt"}">${isVi ? "🔵 自动词 (〜が)" : "🟠 他动词 (〜を)"}</span>
          <span class="verb-group-pill">${GROUP_LABELS[v.group]}</span>
        </div>
        <div class="jp-text" lang="ja" style="font-size:1.45rem;margin:0.2rem 0;">${formatRuby(v.jp)}</div>
        <div style="font-size:0.84rem;color:var(--text-muted);">${escapeHtml(v.kana)} · ${escapeHtml(v.romaji)}</div>
        <div style="font-size:0.95rem;font-weight:800;color:var(--accent-indigo);margin:0.2rem 0;">${escapeHtml(v.cn)}</div>
        <div class="particle-hint-chip" style="margin-bottom:0.5rem;">🔗 ${escapeHtml(v.particles || "")}</div>
        <div style="display:flex;gap:0.35rem;margin-bottom:0.6rem;">
          <button type="button" class="action-btn primary-audio modal-c-speak" data-jp="${escapeHtml(v.dict)}">🔊 朗读</button>
          <button type="button" class="action-btn modal-c-slow" data-jp="${escapeHtml(v.dict)}">🐢 慢速</button>
        </div>
        <div class="vivt-side-examples">
          ${(v.examples || [])
            .slice(0, 3)
            .map(
              (ex) => `
            <div class="vivt-ex-mini">
              <div style="flex:1;min-width:0;">
                <div class="jp-text" lang="ja" style="font-size:0.92rem;margin:0;">${formatRuby(ex.jp)}</div>
                <div style="font-size:0.78rem;color:var(--text-secondary);">${escapeHtml(ex.cn)}</div>
              </div>
              <button type="button" class="icon-btn modal-c-speak" data-jp="${escapeHtml(ex.jp)}">🔊</button>
            </div>
          `
            )
            .join("")}
        </div>
      </div>
    `;

    const body = openModalHtml(`
      <div>
        <h2 style="font-size:1.25rem;font-weight:800;margin-bottom:0.25rem;">⇄ 自动词 vs 他动词成对对比</h2>
        <p style="font-size:0.82rem;color:var(--text-secondary);margin-bottom:0.75rem;">
          💡 核心口诀：<strong>「〜が ＋ 自动词」</strong>描述事物自然发生或眼前状态（〜ている）；<strong>「〜を ＋ 他动词」</strong>表示人主动做出改变（〜てある / 〜ておく）。
        </p>
        <div class="vivt-compare-grid">
          ${renderSide(viVerb, true)}
          ${renderSide(vtVerb, false)}
        </div>
      </div>
    `);
    if (!body) return;
    body.querySelectorAll(".modal-c-speak").forEach((b) => {
      b.onclick = function () { speakJapanese(this.dataset.jp, 1.0, this); };
    });
    body.querySelectorAll(".modal-c-slow").forEach((b) => {
      b.onclick = function () { speakJapanese(this.dataset.jp, 0.78, this); };
    });
  }

  function openVerbConjugationModal(verbId) {
    const verb = VERBS.find((v) => v.id === verbId);
    if (!verb) return;
    const partner = verb.pairId ? VERBS.find((v) => v.id === verb.pairId) : null;
    const { formatRuby, escapeHtml, speakJapanese, openModalHtml } = app();

    const teForm = verb.forms.te.jp;
    const naiStem = verb.forms.nai.jp.endsWith("ない") ? verb.forms.nai.jp.slice(0, -1) : verb.forms.nai.jp;
    const derivedPatterns = [
      { label: "正在进行 / 状态 (〜ています)", jp: `${teForm}います`, cn: `正在${verb.cn} / ${verb.cn}着` },
      { label: "礼貌请求 (〜てください)", jp: `${teForm}ください`, cn: `请${verb.cn}` },
      { label: "征求许可 (〜てもいいですか)", jp: `${teForm}もいいですか？`, cn: `可以${verb.cn}吗？` },
      { label: "必须做 (〜なければなりません)", jp: `${naiStem}ければなりません`, cn: `必须${verb.cn}` },
      { label: "试着做 (〜てみる)", jp: `${teForm}みます`, cn: `试着${verb.cn}看看` }
    ];

    const body = openModalHtml(`
      <div>
        <div style="display:flex;align-items:center;gap:0.4rem;flex-wrap:wrap;margin-bottom:0.35rem;">
          <span class="jlpt-pill jlpt-${verb.jlpt.toLowerCase()}">${verb.jlpt}</span>
          <span class="verb-rank-pill">#${verb.rank}</span>
          <span class="verb-group-pill grp-${verb.group}">${GROUP_LABELS[verb.group]}</span>
          <span class="trans-pill trans-${verb.transitivity}">${TRANS_LABELS[verb.transitivity]}</span>
          <span class="phrase-tag">${escapeHtml(verb.category)}</span>
        </div>
        <div style="display:flex;align-items:center;justify-content:space-between;gap:0.75rem;flex-wrap:wrap;margin-bottom:0.4rem;">
          <div>
            <div class="jp-text" lang="ja" style="font-size:1.55rem;margin:0;">${formatRuby(verb.jp)}</div>
            <div style="font-size:0.9rem;color:var(--accent-indigo);font-weight:700;">
              ${escapeHtml(verb.cn)} <span style="color:var(--text-muted);font-weight:500;">(${escapeHtml(verb.kana)} · ${escapeHtml(verb.romaji)})</span>
            </div>
            ${verb.particles ? `<div class="particle-hint-chip" style="margin-top:0.3rem;">🔗 常见搭配：${escapeHtml(verb.particles)}</div>` : ""}
          </div>
          <div style="display:flex;gap:0.4rem;flex-wrap:wrap;">
            <button type="button" class="action-btn primary-audio modal-v-speak" data-jp="${escapeHtml(verb.dict)}">🔊 读原形</button>
            <button type="button" class="action-btn modal-v-speak-slow" data-jp="${escapeHtml(verb.dict)}">🐢 慢读</button>
            ${
              partner
                ? `<button type="button" class="action-btn" id="modal-open-vivt-pair">⇄ 对照${partner.transitivity === "vi" ? "自动词" : "他动词"}：${escapeHtml(partner.dict)}</button>`
                : ""
            }
          </div>
        </div>
        <div class="tb-rule-banner" style="margin:0.6rem 0;">
          💡 ${escapeHtml(getConjugationRuleHint(verb, "te"))}
        </div>

        <h3 style="font-size:0.92rem;font-weight:800;margin:0.8rem 0 0.45rem;">📐 全套 13 种核心变形表（含使役被动 & 命令形，点击朗读）</h3>
        <div class="conj-modal-grid">
          ${FORM_META.map((fm) => {
            const f = verb.forms[fm.key];
            const disabled = !f || f.jp.startsWith("—");
            return `
              <button type="button" class="conj-modal-cell ${disabled ? "disabled" : "modal-v-speak"}" ${disabled ? "disabled" : `data-jp="${escapeHtml(f.jp)}"`}>
                <div class="conj-cell-label">${fm.label} <span>${fm.sub}</span></div>
                <div class="conj-cell-jp" lang="ja">${escapeHtml(f ? f.jp : "—")}</div>
                <div class="conj-cell-kana">${escapeHtml(f && f.kana ? f.kana : "")}</div>
              </button>
            `;
          }).join("")}
        </div>

        <h3 style="font-size:0.92rem;font-weight:800;margin:0.95rem 0 0.45rem;">🔥 高频衍生日常句型（一键跟读）</h3>
        <div class="derived-pattern-list">
          ${derivedPatterns
            .map(
              (dp) => `
            <div class="derived-pattern-row">
              <div>
                <div style="font-size:0.72rem;font-weight:700;color:var(--text-muted);">${escapeHtml(dp.label)}</div>
                <div style="font-size:0.95rem;font-weight:800;color:var(--text-primary);" lang="ja">${escapeHtml(dp.jp)}</div>
                <div style="font-size:0.78rem;color:var(--accent-indigo);">${escapeHtml(dp.cn)}</div>
              </div>
              <button type="button" class="icon-btn modal-v-speak" data-jp="${escapeHtml(dp.jp)}">🔊 朗读</button>
            </div>
          `
            )
            .join("")}
        </div>
      </div>
    `);

    if (!body) return;
    body.querySelectorAll(".modal-v-speak").forEach((btn) => {
      btn.onclick = function () { speakJapanese(this.dataset.jp, 1.0, this); };
    });
    body.querySelectorAll(".modal-v-speak-slow").forEach((btn) => {
      btn.onclick = function () { speakJapanese(this.dataset.jp, 0.78, this); };
    });
    const pairBtn = document.getElementById("modal-open-vivt-pair");
    if (pairBtn && partner) {
      pairBtn.onclick = () => openViVtCompareModal(verb.id, partner.id);
    }
  }

  // =========================================================================
  // TAB 1: VOCABULARY & TOP 300 VERBS HUB
  // =========================================================================
  function renderVerbsView() {
    const container = document.getElementById("verbs-view-container");
    if (!container) return;
    const { state, formatRuby, escapeHtml, speakJapanese, toggleStar, toggleMastered, switchAppMode } = app();

    const n5List = getN5VocabUnified();
    const verbsMastered = VERBS.filter((v) => state.mastered[v.id]).length;
    const n5Mastered = n5List.filter((w) => state.mastered[w.id]).length;

    const subTabBar = `
      <div class="vocab-hub-switcher scroll-fade-x">
        <button type="button" class="map-pill ${vState.subTab === "verbs300" ? "active" : ""}" data-vhub="verbs300">
          ⚡ 高频动词 ${VERBS.length} (${verbsMastered}/${VERBS.length})
        </button>
        <button type="button" class="map-pill ${vState.subTab === "n5vocab" ? "active" : ""}" data-vhub="n5vocab">
          🟢 N5 核心词汇 (${n5Mastered}/${n5List.length})
        </button>
        <button type="button" class="map-pill ${vState.subTab === "n4n3lib" ? "active" : ""}" data-vhub="n4n3lib">
          🚀 N4–N3 进阶词库 (缩略·副词·拟态·敬语)
        </button>
      </div>
    `;

    // -----------------------------------------------------------------------
    // SUB-TAB A: TOP 300 VERBS
    // -----------------------------------------------------------------------
    if (vState.subTab === "verbs300") {
      const pct = VERBS.length ? Math.round((verbsMastered / VERBS.length) * 100) : 0;
      const categories = ["all", ...Array.from(new Set(VERBS.map((v) => v.category)))];
      const byId = {};
      VERBS.forEach((v) => { byId[v.id] = v; });

      const q = vState.search.trim().toLowerCase();
      const filtered = VERBS.filter((v) => {
        if (vState.jlpt !== "all" && v.jlpt !== vState.jlpt) return false;
        if (vState.group !== "all" && v.group !== vState.group) return false;
        if (vState.transitivity === "paired" && !v.pairId) return false;
        if ((vState.transitivity === "vi" || vState.transitivity === "vt") && v.transitivity !== vState.transitivity) return false;
        if (vState.category !== "all" && v.category !== vState.category) return false;
        if (vState.status === "starred" && !state.starred[v.id]) return false;
        if (vState.status === "mastered" && !state.mastered[v.id]) return false;
        if (vState.status === "unmastered" && state.mastered[v.id]) return false;
        if (q) {
          const exText = v.examples.map((e) => `${e.jp} ${e.romaji} ${e.cn}`).join(" ");
          const formText = Object.values(v.forms).map((f) => `${f.jp} ${f.kana}`).join(" ");
          const hay = `${v.rank} ${v.dict} ${v.kana} ${v.romaji} ${v.cn} ${v.category} ${v.jlpt} ${v.particles || ""} ${formText} ${exText}`.toLowerCase();
          return hay.includes(q);
        }
        if (
          vState.jlpt === "all" &&
          vState.group === "all" &&
          vState.transitivity === "all" &&
          vState.category === "all" &&
          vState.status === "all" &&
          vState.range !== "all"
        ) {
          const [lo, hi] = vState.range.split("-").map(Number);
          return v.rank >= lo && v.rank <= hi;
        }
        return true;
      });

      const isFilteredActive =
        q ||
        vState.jlpt !== "all" ||
        vState.group !== "all" ||
        vState.transitivity !== "all" ||
        vState.category !== "all" ||
        vState.status !== "all";

      container.innerHTML = `
        <div class="learning-hero-card">
          ${subTabBar}
          <div class="learning-hero-top" style="margin-top:0.75rem;">
            <div>
              <h2 class="itin-section-title">⚡ 日语高频 Top 300 动词 · 自他成对对照 & 13 种变形</h2>
              <p class="itin-section-sub">涵盖 N5 核心、56 组自他成对动词、N3 复合动词与服务业敬语动词，配助词搭配与 900 句日常/口语缩略例句。</p>
            </div>
            <div style="display:flex;gap:0.45rem;flex-wrap:wrap;">
              <button type="button" class="action-btn ${vState.showCheatSheet ? "primary-audio" : ""}" id="btn-toggle-conj-sheet">
                📐 ${vState.showCheatSheet ? "收起变形口诀" : "变形 & 自他口诀"}
              </button>
              <button type="button" class="action-btn primary-audio" id="btn-jump-conj-drill">
                ⚡ 动词变形闪电战 →
              </button>
            </div>
          </div>

          <div class="learning-progress-row">
            <div class="progress-text-meta">
              <span>🎯 动词掌握进度：<strong>${verbsMastered} / ${VERBS.length}</strong> (${pct}%)</span>
              <span>当前显示：<strong>${filtered.length}</strong> 个动词</span>
            </div>
            <div class="progress-bar-track"><div class="progress-bar-fill" style="width:${pct}%;"></div></div>
          </div>

          ${
            vState.showCheatSheet
              ? `
            <div class="conj-cheatsheet-box">
              <div class="cheat-col">
                <div class="cheat-col-title">🔵 五段动词 (u-verb)</div>
                <ul>
                  <li><strong>ます/たい：</strong>词尾 u段 → <strong>i段</strong>＋ます/たい</li>
                  <li><strong>て/た音变：</strong><code>うつる</code>→って｜<code>むぶぬ</code>→んで｜<code>く</code>→いて(⚠️行く→行って)｜<code>ぐ</code>→いで｜<code>す</code>→して</li>
                  <li><strong>ない/可能/ば：</strong>あ段＋ない（う→わ）；え段＋る / ば</li>
                  <li><strong>使役被动：</strong>非す结尾短缩「あ段＋される」（待たされる）；す结尾「さ＋せられる」</li>
                </ul>
              </div>
              <div class="cheat-col">
                <div class="cheat-col-title">🟢 一段动词 (ru-verb)</div>
                <ul>
                  <li>直接<strong>去「る」</strong>接词尾！</li>
                  <li>ます / て・た / ない / たい / よう / れば / ろ(命令)</li>
                  <li>可能・被动：去る＋<strong>られる</strong>｜使役：<strong>させる</strong>｜使役被动：<strong>させられる</strong></li>
                  <li>⚠️ 伪一段五段：<code>帰る・走る・入る・切る・知る・減る・滑る・参る</code></li>
                </ul>
              </div>
              <div class="cheat-col">
                <div class="cheat-col-title">🟣 不规则动词</div>
                <ul>
                  <li><strong>〜する：</strong>します / して / した / しない / できる / しよう / され / させ / しろ</li>
                  <li><strong>来る(くる)：</strong>きます / きて / きた / こない / こられる / こよう / こい</li>
                </ul>
              </div>
              <div class="cheat-col">
                <div class="cheat-col-title">🔗 自他动词成对规律</div>
                <ul>
                  <li><strong>-aru(自) ↔ -eru(他)：</strong>閉まる/閉める · 決まる/決める · 集まる/集める</li>
                  <li><strong>-reru(自) ↔ -su(他)：</strong>壊れる/壊す · 汚れる/汚す · 外れる/外す</li>
                  <li><strong>-u(自) ↔ -eru(他)：</strong>開く/開ける · 続く/続ける · 並ぶ/並べる</li>
                  <li><strong>助词铁律：</strong>自动词配 <code>〜が</code>（〜ている）；他动词配 <code>〜を</code>（〜てある/〜ておく）</li>
                </ul>
              </div>
            </div>
          `
              : ""
          }
        </div>

        <div class="learning-filter-card">
          <div class="lf-row-top">
            <div class="search-box" style="flex:1 1 240px;">
              <span class="search-icon">🔍</span>
              <input type="text" id="verb-search-input" value="${escapeHtml(vState.search)}" placeholder="搜动词、假名、罗马音、中文、助词搭配或例句..." />
              <button type="button" class="search-clear" id="verb-search-clear" style="display:${vState.search ? "block" : "none"};">✕</button>
            </div>
            <select id="verb-cat-select" class="lf-select" aria-label="按场景分类筛选">
              ${categories.map((c) => `<option value="${escapeHtml(c)}" ${vState.category === c ? "selected" : ""}>${c === "all" ? "📂 全部分类" : `📂 ${escapeHtml(c)}`}</option>`).join("")}
            </select>
            <select id="verb-group-select" class="lf-select" aria-label="按变形组筛选">
              <option value="all" ${vState.group === "all" ? "selected" : ""}>📐 全部变形类</option>
              <option value="godan" ${vState.group === "godan" ? "selected" : ""}>五段 (u-verb)</option>
              <option value="ichidan" ${vState.group === "ichidan" ? "selected" : ""}>一段 (ru-verb)</option>
              <option value="irregular" ${vState.group === "irregular" ? "selected" : ""}>不规则 (する/来る)</option>
            </select>
          </div>

          <div class="lf-chips-row">
            <div class="toggle-group">
              ${["all", "N5", "N4", "N3"]
                .map((lvl) => `<button type="button" class="toggle-chip ${vState.jlpt === lvl ? "active" : ""}" data-vjlpt="${lvl}">${lvl === "all" ? "全部级别" : lvl}</button>`)
                .join("")}
            </div>
            <div class="toggle-group">
              ${[
                ["all", "全部自他"],
                ["paired", "⇄ 仅看自他成对"],
                ["vi", "🔵 自动词"],
                ["vt", "🟠 他动词"]
              ]
                .map(([tk, tlbl]) => `<button type="button" class="toggle-chip ${vState.transitivity === tk ? "active" : ""}" data-vtrans="${tk}">${tlbl}</button>`)
                .join("")}
            </div>
            <div class="toggle-group">
              ${[
                ["all", "📚 全部"],
                ["unmastered", "⏳ 未掌握"],
                ["mastered", "✅ 已掌握"],
                ["starred", "⭐ 收藏"]
              ]
                .map(([k, lbl]) => `<button type="button" class="toggle-chip ${vState.status === k ? "active" : ""}" data-vstatus="${k}">${lbl}</button>`)
                .join("")}
            </div>
          </div>

          ${
            !isFilteredActive
              ? `
            <div class="lf-range-row">
              <span style="font-size:0.75rem;font-weight:700;color:var(--text-muted);">高频分段：</span>
              ${[
                ["1-50", "🔥 1–50"],
                ["51-100", "⭐ 51–100"],
                ["101-150", "📘 101–150"],
                ["151-200", "💎 151–200"],
                ["201-250", "⇄ 201–250 (自他补完)"],
                ["251-300", "🚀 251–300 (复合/敬语)"],
                ["all", "📋 全部 300"]
              ]
                .map(([rk, rlbl]) => `<button type="button" class="map-pill ${vState.range === rk ? "active" : ""}" data-vrange="${rk}">${rlbl}</button>`)
                .join("")}
            </div>
          `
              : ""
          }
        </div>

        <div class="verbs-grid">
          ${
            filtered.length === 0
              ? `<div class="itin-card-block" style="text-align:center;padding:2rem;">
                  <div style="font-size:2rem;margin-bottom:0.4rem;">🔍</div>
                  <div style="font-weight:700;margin-bottom:0.4rem;">没有找到匹配的动词</div>
                  <button type="button" class="action-btn primary-audio" id="btn-reset-verb-filters">重置动词筛选</button>
                </div>`
              : filtered
                  .map((v) => {
                    const isStar = !!state.starred[v.id];
                    const isMast = !!state.mastered[v.id];
                    const partner = v.pairId ? byId[v.pairId] : null;
                    const top6 = FORM_META.slice(0, 6);
                    return `
                    <article class="verb-card ${isMast ? "mastered" : ""} ${isStar ? "starred" : ""}">
                      <div class="verb-card-head">
                        <div class="verb-badges">
                          <span class="verb-rank-pill">#${v.rank}</span>
                          <span class="jlpt-pill jlpt-${v.jlpt.toLowerCase()}">${v.jlpt}</span>
                          <span class="verb-group-pill grp-${v.group}">${GROUP_LABELS[v.group]}</span>
                          <span class="trans-pill trans-${v.transitivity}">${TRANS_LABELS[v.transitivity]}</span>
                        </div>
                        <div class="phrase-status-btns">
                          <button type="button" class="icon-btn ${isStar ? "starred-active" : ""}" data-vstar="${v.id}">${isStar ? "⭐" : "☆"}</button>
                          <button type="button" class="icon-btn ${isMast ? "mastered-active" : ""}" data-vmaster="${v.id}">${isMast ? "✅ 已掌握" : "○ 掌握"}</button>
                        </div>
                      </div>

                      <div class="verb-main-row">
                        <div style="flex:1;min-width:170px;">
                          <div class="jp-text verb-jp-title" lang="ja">${formatRuby(v.jp)}</div>
                          <div class="romaji-text" style="margin-bottom:0.12rem;">${escapeHtml(v.kana)} · ${escapeHtml(v.romaji)}</div>
                          <div class="cn-text" style="margin-bottom:0.2rem;">${escapeHtml(v.cn)}</div>
                          <div class="verb-meta-chips">
                            ${v.particles ? `<span class="particle-hint-chip">🔗 ${escapeHtml(v.particles)}</span>` : ""}
                            ${
                              partner
                                ? `<button type="button" class="pair-jump-btn v-pair-btn" data-v1="${v.id}" data-v2="${partner.id}">⇄ 对照${partner.transitivity === "vi" ? "自" : "他"}：${escapeHtml(partner.dict)}</button>`
                                : ""
                            }
                          </div>
                        </div>
                        <div style="display:flex;gap:0.35rem;flex-wrap:wrap;align-items:center;">
                          <button type="button" class="action-btn primary-audio v-speak-btn" data-jp="${escapeHtml(v.dict)}">🔊 朗读</button>
                          <button type="button" class="action-btn v-speak-slow-btn" data-jp="${escapeHtml(v.dict)}">🐢</button>
                          <button type="button" class="action-btn v-allforms-btn" data-vid="${v.id}">📋 13种变形</button>
                        </div>
                      </div>

                      <div class="verb-forms-strip">
                        ${top6
                          .map((fm) => {
                            const f = v.forms[fm.key];
                            const disabled = !f || f.jp.startsWith("—");
                            return `
                            <button type="button" class="verb-form-chip ${disabled ? "disabled" : "v-speak-btn"}" ${disabled ? "disabled" : `data-jp="${escapeHtml(f.jp)}"`} title="点击听「${fm.label}」发音">
                              <span class="vf-lbl">${fm.label}</span>
                              <span class="vf-val" lang="ja">${escapeHtml(f ? f.jp : "—")}</span>
                            </button>
                          `;
                          })
                          .join("")}
                      </div>

                      <div class="verb-examples-list">
                        ${v.examples
                          .map(
                            (ex, exIdx) => `
                          <div class="verb-example-item">
                            <div style="flex:1 1 190px;min-width:0;">
                              <div class="vex-top">
                                <span class="vex-form-badge">${escapeHtml(ex.form)}</span>
                              </div>
                              <div class="jp-text vex-jp" lang="ja">${formatRuby(ex.jp)}</div>
                              <div class="romaji-text" style="margin-bottom:0.15rem;">${escapeHtml(ex.romaji)}</div>
                              <div class="cn-text" style="font-size:0.84rem;margin-bottom:0;">${escapeHtml(ex.cn)}</div>
                            </div>
                            <div class="vex-btns">
                              <button type="button" class="icon-btn v-speak-btn" data-jp="${escapeHtml(ex.jp)}" title="常速朗读">🔊</button>
                              <button type="button" class="icon-btn v-speak-slow-btn" data-jp="${escapeHtml(ex.jp)}" title="慢速跟读">🐢</button>
                              <button type="button" class="icon-btn quick-oral-btn" data-oid="${v.id}-ex${exIdx}" data-ojp="${escapeHtml(ex.jp)}" data-oromaji="${escapeHtml(ex.romaji || "")}" data-ocn="${escapeHtml(ex.cn)}" data-otag="⚡ #${v.rank} ${escapeHtml(v.dict)} (${escapeHtml(ex.form)})" title="开口跟读发音评测">🎙️</button>
                            </div>
                          </div>
                        `
                          )
                          .join("")}
                      </div>
                    </article>
                  `;
                  })
                  .join("")
          }
        </div>
      `;

      // Bind Verbs 300 Events
      const toggleSheet = document.getElementById("btn-toggle-conj-sheet");
      if (toggleSheet) toggleSheet.onclick = () => { vState.showCheatSheet = !vState.showCheatSheet; renderVerbsView(); };
      const jumpDrill = document.getElementById("btn-jump-conj-drill");
      if (jumpDrill) jumpDrill.onclick = () => { pState.subMode = "conj"; pState.conjQuestion = null; switchAppMode("practice"); };
      const searchEl = document.getElementById("verb-search-input");
      if (searchEl) {
        searchEl.oninput = (e) => {
          vState.search = e.target.value;
          const pos = e.target.selectionStart;
          renderVerbsView();
          const next = document.getElementById("verb-search-input");
          if (next) { next.focus(); next.setSelectionRange(pos, pos); }
        };
      }
      const searchClr = document.getElementById("verb-search-clear");
      if (searchClr) searchClr.onclick = () => { vState.search = ""; renderVerbsView(); };
      const catSel = document.getElementById("verb-cat-select");
      if (catSel) catSel.onchange = (e) => { vState.category = e.target.value; renderVerbsView(); };
      const grpSel = document.getElementById("verb-group-select");
      if (grpSel) grpSel.onchange = (e) => { vState.group = e.target.value; renderVerbsView(); };
      container.querySelectorAll("[data-vjlpt]").forEach((b) => { b.onclick = () => { vState.jlpt = b.dataset.vjlpt; renderVerbsView(); }; });
      container.querySelectorAll("[data-vtrans]").forEach((b) => { b.onclick = () => { vState.transitivity = b.dataset.vtrans; renderVerbsView(); }; });
      container.querySelectorAll("[data-vstatus]").forEach((b) => { b.onclick = () => { vState.status = b.dataset.vstatus; renderVerbsView(); }; });
      container.querySelectorAll("[data-vrange]").forEach((b) => { b.onclick = () => { vState.range = b.dataset.vrange; renderVerbsView(); }; });
      container.querySelectorAll(".v-allforms-btn").forEach((b) => { b.onclick = () => openVerbConjugationModal(b.dataset.vid); });
      container.querySelectorAll(".v-pair-btn").forEach((b) => { b.onclick = () => openViVtCompareModal(b.dataset.v1, b.dataset.v2); });
      const resetBtn = document.getElementById("btn-reset-verb-filters");
      if (resetBtn) {
        resetBtn.onclick = () => {
          vState.search = ""; vState.jlpt = "all"; vState.group = "all";
          vState.transitivity = "all"; vState.category = "all"; vState.status = "all";
          renderVerbsView();
        };
      }
    }

    // -----------------------------------------------------------------------
    // SUB-TAB B: N5 CORE VOCABULARY (250 Words + 75 Adjectives = 325)
    // -----------------------------------------------------------------------
    else if (vState.subTab === "n5vocab") {
      const pct = n5List.length ? Math.round((n5Mastered / n5List.length) * 100) : 0;
      const cats = ["all", ...Array.from(new Set(n5List.map((w) => w.cat)))];
      const q = vState.n5Search.trim().toLowerCase();

      const filtered = n5List.filter((w) => {
        if (vState.n5Cat !== "all" && w.cat !== vState.n5Cat) return false;
        if (vState.n5Status === "starred" && !state.starred[w.id]) return false;
        if (vState.n5Status === "mastered" && !state.mastered[w.id]) return false;
        if (vState.n5Status === "unmastered" && state.mastered[w.id]) return false;
        if (q) {
          return `${w.jp} ${w.kana} ${w.romaji} ${w.cn} ${w.cat} ${w.ex} ${w.exCn} ${w.subMeta}`.toLowerCase().includes(q);
        }
        return true;
      });

      container.innerHTML = `
        <div class="learning-hero-card">
          ${subTabBar}
          <div class="learning-hero-top" style="margin-top:0.75rem;">
            <div>
              <h2 class="itin-section-title">🟢 JLPT N5 核心词汇总复习 (${n5List.length} 词 · 含 75 核心形容词)</h2>
              <p class="itin-section-sub">完整覆盖指示词、时间日期、家人、方位场所、交通、饮食、身体日用品、天气颜色及 い/な 形容词四态变化，每词配 Studio 真人例句！</p>
            </div>
            <button type="button" class="action-btn primary-audio" id="btn-jump-n5-srs">
              🃏 去刷 N5 词汇闪卡 →
            </button>
          </div>
          <div class="learning-progress-row">
            <div class="progress-text-meta">
              <span>🎯 N5 词汇掌握进度：<strong>${n5Mastered} / ${n5List.length}</strong> (${pct}%)</span>
              <span>当前显示：<strong>${filtered.length}</strong> 个词条</span>
            </div>
            <div class="progress-bar-track"><div class="progress-bar-fill" style="width:${pct}%;background:#059669;"></div></div>
          </div>
        </div>

        <div class="learning-filter-card">
          <div class="lf-row-top">
            <div class="search-box" style="flex:1 1 240px;">
              <span class="search-icon">🔍</span>
              <input type="text" id="n5-search-input" value="${escapeHtml(vState.n5Search)}" placeholder="搜 N5 单词、假名、罗马音、中文（如：今日、駅、おいし、天気）..." />
              <button type="button" class="search-clear" id="n5-search-clear" style="display:${vState.n5Search ? "block" : "none"};">✕</button>
            </div>
            <div class="toggle-group">
              ${[
                ["all", "📚 全部"],
                ["unmastered", "⏳ 未掌握"],
                ["mastered", "✅ 已掌握"],
                ["starred", "⭐ 收藏"]
              ]
                .map(([k, lbl]) => `<button type="button" class="toggle-chip ${vState.n5Status === k ? "active" : ""}" data-n5status="${k}">${lbl}</button>`)
                .join("")}
            </div>
          </div>
          <div class="lf-range-row">
            ${cats
              .map((c) => `<button type="button" class="map-pill ${vState.n5Cat === c ? "active" : ""}" data-n5cat="${escapeHtml(c)}">${c === "all" ? `全部 (${n5List.length})` : escapeHtml(c)}</button>`)
              .join("")}
          </div>
        </div>

        <div class="vocab-grid">
          ${
            filtered.length === 0
              ? `<div class="itin-card-block" style="text-align:center;padding:2rem;grid-column:1/-1;">
                  <div style="font-size:2rem;margin-bottom:0.4rem;">🔍</div>
                  <div style="font-weight:700;margin-bottom:0.4rem;">没有找到匹配的 N5 词汇</div>
                  <button type="button" class="action-btn primary-audio" id="btn-reset-n5-filters">重置筛选</button>
                </div>`
              : filtered
                  .map((w) => {
                    const isStar = !!state.starred[w.id];
                    const isMast = !!state.mastered[w.id];
                    return `
                    <article class="vocab-card ${isMast ? "mastered" : ""} ${isStar ? "starred" : ""}">
                      <div class="verb-card-head">
                        <div class="verb-badges">
                          <span class="jlpt-pill jlpt-n5">${escapeHtml(w.cat)}</span>
                        </div>
                        <div class="phrase-status-btns">
                          <button type="button" class="icon-btn ${isStar ? "starred-active" : ""}" data-vstar="${w.id}">${isStar ? "⭐" : "☆"}</button>
                          <button type="button" class="icon-btn ${isMast ? "mastered-active" : ""}" data-vmaster="${w.id}">${isMast ? "✅ 已掌握" : "○ 掌握"}</button>
                        </div>
                      </div>
                      <div class="vocab-main-row">
                        <div style="flex:1;min-width:0;">
                          <div class="jp-text vocab-jp-title" lang="ja">${formatRuby(w.jp)}</div>
                          <div class="romaji-text" style="margin-bottom:0.1rem;">${escapeHtml(w.kana)} · ${escapeHtml(w.romaji)}</div>
                          <div class="cn-text" style="margin-bottom:0;">${escapeHtml(w.cn)}</div>
                          ${w.subMeta ? `<div style="font-size:0.75rem;color:var(--text-secondary);margin-top:0.2rem;">${escapeHtml(w.subMeta)}</div>` : ""}
                        </div>
                        <button type="button" class="action-btn primary-audio v-speak-btn" data-jp="${escapeHtml(w.kana)}">🔊 读词</button>
                      </div>
                      ${
                        w.ex
                          ? `<div class="verb-example-item" style="margin-top:0.15rem;">
                              <div style="flex:1 1 180px;min-width:0;">
                                <div class="jp-text vex-jp" lang="ja">${formatRuby(w.ex)}</div>
                                <div class="cn-text" style="font-size:0.82rem;margin-bottom:0;">${escapeHtml(w.exCn)}</div>
                              </div>
                              <div class="vex-btns">
                                <button type="button" class="icon-btn v-speak-btn" data-jp="${escapeHtml(w.ex)}" title="朗读例句">🔊</button>
                                <button type="button" class="icon-btn v-speak-slow-btn" data-jp="${escapeHtml(w.ex)}" title="慢速跟读">🐢</button>
                                <button type="button" class="icon-btn quick-oral-btn" data-oid="${w.id}-ex" data-ojp="${escapeHtml(w.ex)}" data-oromaji="${escapeHtml(w.romaji || "")}" data-ocn="${escapeHtml(w.exCn)}" data-otag="🟢 N5 · ${escapeHtml(w.cat)}" title="开口跟读发音评测">🎙️</button>
                              </div>
                            </div>`
                          : ""
                      }
                    </article>
                  `;
                  })
                  .join("")
          }
        </div>
      `;

      const jumpN5Srs = document.getElementById("btn-jump-n5-srs");
      if (jumpN5Srs) {
        jumpN5Srs.onclick = () => {
          pState.subMode = "srs";
          pState.srsDeck = "n5vocab";
          pState.srsCurrentCard = null;
          switchAppMode("practice");
        };
      }
      const n5SearchEl = document.getElementById("n5-search-input");
      if (n5SearchEl) {
        n5SearchEl.oninput = (e) => {
          vState.n5Search = e.target.value;
          const pos = e.target.selectionStart;
          renderVerbsView();
          const next = document.getElementById("n5-search-input");
          if (next) { next.focus(); next.setSelectionRange(pos, pos); }
        };
      }
      const n5Clr = document.getElementById("n5-search-clear");
      if (n5Clr) n5Clr.onclick = () => { vState.n5Search = ""; renderVerbsView(); };
      container.querySelectorAll("[data-n5cat]").forEach((b) => { b.onclick = () => { vState.n5Cat = b.dataset.n5cat; renderVerbsView(); }; });
      container.querySelectorAll("[data-n5status]").forEach((b) => { b.onclick = () => { vState.n5Status = b.dataset.n5status; renderVerbsView(); }; });
      const resetN5 = document.getElementById("btn-reset-n5-filters");
      if (resetN5) resetN5.onclick = () => { vState.n5Cat = "all"; vState.n5Search = ""; vState.n5Status = "all"; renderVerbsView(); };
    }

    // -----------------------------------------------------------------------
    // SUB-TAB C: N4-N3 PRACTICAL FLUENCY LIBRARY
    // -----------------------------------------------------------------------
    else {
      const q = vState.libSearch.trim().toLowerCase();
      let libContentHtml = "";

      if (vState.libTab === "contractions") {
        const list = (EXTRAS.contractions || []).filter((c) => !q || `${c.formal} ${c.casual} ${c.rule} ${c.exCasual} ${c.exCn}`.toLowerCase().includes(q));
        libContentHtml = `
          <div class="tb-rule-banner">💡 日本日常口语 80% 都会缩略！重点掌握 <strong>〜てる / 〜ちゃう / 〜とく / 〜なきゃ / 〜んだ</strong>，瞬间打通日剧与街谈听力。</div>
          <div class="vocab-grid">
            ${list
              .map(
                (c) => `
              <article class="vocab-card">
                <div style="display:flex;justify-content:space-between;align-items:center;gap:0.4rem;flex-wrap:wrap;">
                  <span class="phrase-tag" lang="ja">${escapeHtml(c.formal)} ➔ <strong style="color:var(--accent-red);">${escapeHtml(c.casual)}</strong></span>
                  <span style="font-size:0.75rem;color:var(--text-muted);">${escapeHtml(c.rule)}</span>
                </div>
                <div class="verb-example-item">
                  <div style="flex:1;">
                    <div style="font-size:0.72rem;font-weight:700;color:var(--text-muted);">📖 书面对照：</div>
                    <div class="jp-text vex-jp" lang="ja">${formatRuby(c.exFormal)}</div>
                  </div>
                  <button type="button" class="icon-btn v-speak-btn" data-jp="${escapeHtml(c.exFormal)}">🔊</button>
                </div>
                <div class="verb-example-item" style="background:var(--bg-indigo-soft);">
                  <div style="flex:1;">
                    <div style="font-size:0.72rem;font-weight:800;color:var(--accent-indigo);">💬 地道口语：</div>
                    <div class="jp-text vex-jp" lang="ja">${formatRuby(c.exCasual)}</div>
                    <div class="cn-text" style="font-size:0.83rem;margin:0;">${escapeHtml(c.exCn)}</div>
                  </div>
                  <div class="vex-btns">
                    <button type="button" class="icon-btn v-speak-btn" data-jp="${escapeHtml(c.exCasual)}">🔊</button>
                    <button type="button" class="icon-btn v-speak-slow-btn" data-jp="${escapeHtml(c.exCasual)}">🐢</button>
                  </div>
                </div>
              </article>
            `
              )
              .join("")}
          </div>
        `;
      } else if (vState.libTab === "adverbs") {
        const list = (EXTRAS.adverbs || []).filter((a) => !q || `${a.jp} ${a.kana} ${a.romaji} ${a.cn} ${a.pairing} ${a.ex} ${a.exCn}`.toLowerCase().includes(q));
        libContentHtml = `
          <div class="vocab-grid">
            ${list
              .map(
                (a) => `
              <article class="vocab-card">
                <div class="verb-card-head">
                  <div class="verb-badges">
                    <span class="jlpt-pill jlpt-${a.jlpt.toLowerCase()}">${a.jlpt}</span>
                    <span class="particle-hint-chip">🔗 ${escapeHtml(a.pairing)}</span>
                  </div>
                  <button type="button" class="icon-btn v-speak-btn" data-jp="${escapeHtml(a.kana)}">🔊 读词</button>
                </div>
                <div class="jp-text vocab-jp-title" lang="ja">${formatRuby(a.jp)}</div>
                <div class="romaji-text">${escapeHtml(a.kana)} · ${escapeHtml(a.romaji)}</div>
                <div class="cn-text">${escapeHtml(a.cn)}</div>
                <div class="verb-example-item">
                  <div style="flex:1;">
                    <div class="jp-text vex-jp" lang="ja">${formatRuby(a.ex)}</div>
                    <div class="cn-text" style="font-size:0.83rem;margin:0;">${escapeHtml(a.exCn)}</div>
                  </div>
                  <div class="vex-btns">
                    <button type="button" class="icon-btn v-speak-btn" data-jp="${escapeHtml(a.ex)}">🔊</button>
                    <button type="button" class="icon-btn v-speak-slow-btn" data-jp="${escapeHtml(a.ex)}">🐢</button>
                  </div>
                </div>
              </article>
            `
              )
              .join("")}
          </div>
        `;
      } else if (vState.libTab === "onomatopoeia") {
        const list = (EXTRAS.onomatopoeia || []).filter((o) => !q || `${o.cat} ${o.jp} ${o.romaji} ${o.cn} ${o.ex} ${o.exCn}`.toLowerCase().includes(q));
        libContentHtml = `
          <div class="vocab-grid">
            ${list
              .map(
                (o) => `
              <article class="vocab-card">
                <div class="verb-card-head">
                  <span class="phrase-tag">${escapeHtml(o.cat)}</span>
                  <button type="button" class="icon-btn v-speak-btn" data-jp="${escapeHtml(o.jp)}">🔊 读词</button>
                </div>
                <div class="jp-text vocab-jp-title" lang="ja">${escapeHtml(o.jp)}</div>
                <div class="romaji-text">${escapeHtml(o.romaji)}</div>
                <div class="cn-text">${escapeHtml(o.cn)}</div>
                <div class="verb-example-item">
                  <div style="flex:1;">
                    <div class="jp-text vex-jp" lang="ja">${formatRuby(o.ex)}</div>
                    <div class="cn-text" style="font-size:0.83rem;margin:0;">${escapeHtml(o.exCn)}</div>
                  </div>
                  <button type="button" class="icon-btn v-speak-btn" data-jp="${escapeHtml(o.ex)}">🔊</button>
                </div>
              </article>
            `
              )
              .join("")}
          </div>
        `;
      } else if (vState.libTab === "keigo") {
        const list = (EXTRAS.keigoVerbs || []).filter((k) => !q || `${k.plain} ${k.cn} ${k.sonkeigo} ${k.kenjougo} ${k.tip} ${k.ex}`.toLowerCase().includes(q));
        libContentHtml = `
          <div class="tb-rule-banner">💡 去日本餐厅和酒店听懂服务员敬语秘诀：别人动作（尊他语 <strong>いらっしゃる / 召し上がる</strong>）；我方动作（自谦语 <strong>伺う / いただく / 致す</strong>）。</div>
          <div class="vocab-grid">
            ${list
              .map(
                (k) => `
              <article class="vocab-card">
                <div class="verb-card-head">
                  <span class="verb-rank-pill" lang="ja">基本：${escapeHtml(k.plain)}</span>
                  <span style="font-weight:800;color:var(--accent-indigo);">${escapeHtml(k.cn)}</span>
                </div>
                <div class="keigo-pair-box">
                  <div class="keigo-cell">
                    <span class="keigo-lbl">👑 尊他语（对方/店员说）</span>
                    <div style="display:flex;justify-content:space-between;align-items:center;gap:0.35rem;">
                      <strong lang="ja">${formatRuby(k.sonkeigo)}</strong>
                      <button type="button" class="icon-btn v-speak-btn" data-jp="${escapeHtml(k.sonkeigo)}">🔊</button>
                    </div>
                  </div>
                  <div class="keigo-cell">
                    <span class="keigo-lbl">🙇 自谦语（我方谦称）</span>
                    <div style="display:flex;justify-content:space-between;align-items:center;gap:0.35rem;">
                      <strong lang="ja">${formatRuby(k.kenjougo)}</strong>
                      <button type="button" class="icon-btn v-speak-btn" data-jp="${escapeHtml(k.kenjougo)}">🔊</button>
                    </div>
                  </div>
                </div>
                <div class="phrase-tip" style="margin:0;">💡 ${escapeHtml(k.tip)}</div>
                <div class="verb-example-item">
                  <div style="flex:1;">
                    <div class="jp-text vex-jp" lang="ja">${formatRuby(k.ex)}</div>
                    <div class="cn-text" style="font-size:0.83rem;margin:0;">${escapeHtml(k.exCn)}</div>
                  </div>
                  <button type="button" class="icon-btn v-speak-btn" data-jp="${escapeHtml(k.ex)}">🔊</button>
                </div>
              </article>
            `
              )
              .join("")}
          </div>
        `;
      } else if (vState.libTab === "staff") {
        const list = (EXTRAS.staffDecoder || []).filter((s) => !q || `${s.scene} ${s.hearJp} ${s.keyword} ${s.cn} ${s.replyJp} ${s.replyCn}`.toLowerCase().includes(q));
        libContentHtml = `
          <div class="tb-rule-banner">👂 <strong>听力抓关键词：</strong>不用每个字听懂！只要听清红色高亮的核心关键词，就能用绿色极简答句 1 秒接住！可去「🎯 实战练习 → 🏪 店员快语速听解」做盲听测验。</div>
          <div class="vocab-grid">
            ${list
              .map(
                (s) => `
              <article class="vocab-card">
                <div class="verb-card-head">
                  <span class="phrase-tag">${escapeHtml(s.scene)}</span>
                  <span class="imp-pill imp-5" lang="ja">🔑 ${escapeHtml(s.keyword)}</span>
                </div>
                <div class="verb-example-item">
                  <div style="flex:1;">
                    <div style="font-size:0.72rem;font-weight:800;color:var(--accent-red);">🗣️ 店员问：</div>
                    <div class="jp-text vex-jp" lang="ja">${formatRuby(s.hearJp)}</div>
                    <div class="romaji-text" style="margin-bottom:0.1rem;">${escapeHtml(s.hearRomaji)}</div>
                    <div class="cn-text" style="font-size:0.84rem;margin:0;">${escapeHtml(s.cn)}</div>
                  </div>
                  <div class="vex-btns">
                    <button type="button" class="icon-btn v-speak-btn" data-jp="${escapeHtml(s.hearJp)}">🔊</button>
                    <button type="button" class="icon-btn v-speak-slow-btn" data-jp="${escapeHtml(s.hearJp)}">🐢</button>
                  </div>
                </div>
                <div class="phrase-replies" style="margin-top:0;">
                  <div class="reply-label">✅ 我方 1 秒快答：</div>
                  <div class="reply-item">
                    <div>
                      <div class="reply-jp" lang="ja">${formatRuby(s.replyJp)}</div>
                      <div class="reply-cn">${escapeHtml(s.replyCn)}</div>
                    </div>
                    <button type="button" class="icon-btn v-speak-btn" data-jp="${escapeHtml(s.replyJp)}">🔊 跟读</button>
                  </div>
                </div>
              </article>
            `
              )
              .join("")}
          </div>
        `;
      } else {
        const traps = (EXTRAS.kanjiTraps || []).filter((t) => !q || `${t.type} ${t.jp} ${t.kana} ${t.realCn} ${t.wrongGuess} ${t.ex}`.toLowerCase().includes(q));
        const signs = (EXTRAS.streetSigns || []).filter((s) => !q || `${s.cat} ${s.jp} ${s.kana} ${s.cn} ${s.tip}`.toLowerCase().includes(q));
        libContentHtml = `
          <h3 class="section-title" style="margin-top:0.2rem;">🚧 中日汉字避坑 & 高频片假名 (${traps.length})</h3>
          <div class="vocab-grid" style="margin-bottom:1.1rem;">
            ${traps
              .map(
                (t) => `
              <article class="vocab-card">
                <div class="verb-card-head">
                  <span class="phrase-tag">${escapeHtml(t.type)}</span>
                  <button type="button" class="icon-btn v-speak-btn" data-jp="${escapeHtml(t.kana)}">🔊 读词</button>
                </div>
                <div class="jp-text vocab-jp-title" lang="ja">${formatRuby(t.jp)}</div>
                <div class="romaji-text">${escapeHtml(t.kana)} · ${escapeHtml(t.romaji)}</div>
                <div style="font-size:0.78rem;color:var(--accent-red);margin-bottom:0.15rem;">❌ 容易误猜：${escapeHtml(t.wrongGuess)}</div>
                <div class="cn-text">✅ 真实意思：${escapeHtml(t.realCn)}</div>
                <div class="verb-example-item">
                  <div style="flex:1;">
                    <div class="jp-text vex-jp" lang="ja">${formatRuby(t.ex)}</div>
                    <div class="cn-text" style="font-size:0.82rem;margin:0;">${escapeHtml(t.exCn)}</div>
                  </div>
                  <button type="button" class="icon-btn v-speak-btn" data-jp="${escapeHtml(t.ex)}">🔊</button>
                </div>
              </article>
            `
              )
              .join("")}
          </div>
          <h3 class="section-title">🪧 日本街头·餐厅·车站常见标识看板 (${signs.length})</h3>
          <div class="vocab-grid">
            ${signs
              .map(
                (s) => `
              <article class="vocab-card">
                <div class="verb-card-head">
                  <span class="phrase-tag">${escapeHtml(s.cat)}</span>
                  <button type="button" class="icon-btn v-speak-btn" data-jp="${escapeHtml(s.kana)}">🔊 听读音</button>
                </div>
                <div class="jp-text vocab-jp-title" lang="ja">${formatRuby(s.jp)}</div>
                <div class="romaji-text">${escapeHtml(s.kana)} · ${escapeHtml(s.romaji)}</div>
                <div class="cn-text">${escapeHtml(s.cn)}</div>
                <div class="phrase-tip" style="margin:0;">💡 ${escapeHtml(s.tip)}</div>
              </article>
            `
              )
              .join("")}
          </div>
        `;
      }

      container.innerHTML = `
        <div class="learning-hero-card">
          ${subTabBar}
          <div class="learning-hero-top" style="margin-top:0.75rem;">
            <div>
              <h2 class="itin-section-title">🚀 N4–N3 地道日语实战词库（突破课本，听懂真实日本）</h2>
              <p class="itin-section-sub">覆盖口语缩略、N3 高频副词、美食与育儿拟态词、服务业敬语动词、店员快语速听力解码、汉字避坑与街头看板。</p>
            </div>
            <button type="button" class="action-btn primary-audio" id="btn-jump-staff-quiz">
              🏪 去测店员听力解码 →
            </button>
          </div>
        </div>

        <div class="learning-filter-card">
          <div class="lf-row-top">
            <div class="search-box" style="flex:1 1 240px;">
              <span class="search-icon">🔍</span>
              <input type="text" id="lib-search-input" value="${escapeHtml(vState.libSearch)}" placeholder="在当前词库中搜索日文/中文关键词..." />
              <button type="button" class="search-clear" id="lib-search-clear" style="display:${vState.libSearch ? "block" : "none"};">✕</button>
            </div>
          </div>
          <div class="lf-range-row" style="border-top:none;padding-top:0;">
            ${[
              ["contractions", `💬 口语缩略 (${(EXTRAS.contractions || []).length})`],
              ["adverbs", `🎯 N3副词 (${(EXTRAS.adverbs || []).length})`],
              ["onomatopoeia", `🍜 拟声拟态 (${(EXTRAS.onomatopoeia || []).length})`],
              ["keigo", `🙇 敬语动词 (${(EXTRAS.keigoVerbs || []).length})`],
              ["staff", `🏪 店员听力 (${(EXTRAS.staffDecoder || []).length})`],
              ["signs", `🚧 陷阱与看板 (${(EXTRAS.kanjiTraps || []).length + (EXTRAS.streetSigns || []).length})`]
            ]
              .map(([k, lbl]) => `<button type="button" class="map-pill ${vState.libTab === k ? "active" : ""}" data-libtab="${k}">${lbl}</button>`)
              .join("")}
          </div>
        </div>

        ${libContentHtml}
      `;

      const jumpStaff = document.getElementById("btn-jump-staff-quiz");
      if (jumpStaff) {
        jumpStaff.onclick = () => {
          pState.subMode = "quiz";
          pState.quizKind = "staff";
          pState.quizQuestion = null;
          switchAppMode("practice");
        };
      }
      const libSearchEl = document.getElementById("lib-search-input");
      if (libSearchEl) {
        libSearchEl.oninput = (e) => {
          vState.libSearch = e.target.value;
          const pos = e.target.selectionStart;
          renderVerbsView();
          const next = document.getElementById("lib-search-input");
          if (next) { next.focus(); next.setSelectionRange(pos, pos); }
        };
      }
      const libClr = document.getElementById("lib-search-clear");
      if (libClr) libClr.onclick = () => { vState.libSearch = ""; renderVerbsView(); };
      container.querySelectorAll("[data-libtab]").forEach((b) => {
        b.onclick = () => { vState.libTab = b.dataset.libtab; renderVerbsView(); };
      });
    }

    // Shared bindings across all 3 sub-tabs
    container.querySelectorAll("[data-vhub]").forEach((b) => {
      b.onclick = () => { vState.subTab = b.dataset.vhub; renderVerbsView(); };
    });
    container.querySelectorAll("[data-vstar]").forEach((b) => { b.onclick = () => toggleStar(b.dataset.vstar); });
    container.querySelectorAll("[data-vmaster]").forEach((b) => { b.onclick = () => toggleMastered(b.dataset.vmaster); });
    container.querySelectorAll(".v-speak-btn").forEach((b) => { b.onclick = function () { speakJapanese(this.dataset.jp, 1.0, this); }; });
    container.querySelectorAll(".v-speak-slow-btn").forEach((b) => { b.onclick = function () { speakJapanese(this.dataset.jp, 0.78, this); }; });
    bindQuickOralButtons(container);
  }

  // =========================================================================
  // TAB 2: JAPANESE GRAMMAR GUIDE (132 CORE + 160 VIDEO COMPANION PATTERNS)
  // =========================================================================
  const VIDEO_LINKS_BY_CORE = {};
  VIDEO_GRAMMAR.forEach((vg) => {
    if (vg.linkedCoreId) {
      if (!VIDEO_LINKS_BY_CORE[vg.linkedCoreId]) VIDEO_LINKS_BY_CORE[vg.linkedCoreId] = [];
      VIDEO_LINKS_BY_CORE[vg.linkedCoreId].push(vg);
    }
  });

  function renderGrammarCard(g) {
    const { state, formatRuby, escapeHtml } = app();
    const isStar = !!state.starred[g.id];
    const isMast = !!state.mastered[g.id];
    const starsStr = "★".repeat(g.importance) + "☆".repeat(5 - g.importance);
    const quizOpen = !!gState.openQuizIds[g.id];
    const qState = gState.openQuizIds[g.id];
    const linkedVideos = VIDEO_LINKS_BY_CORE[g.id] || [];

    return `
      <article class="grammar-card ${isMast ? "mastered" : ""} ${isStar ? "starred" : ""}" id="gcard-${g.id}">
        <div class="grammar-card-top">
          <div class="verb-badges">
            <span class="jlpt-pill jlpt-${g.level.toLowerCase()}">${g.level}</span>
            <span class="verb-rank-pill">#${g.order}</span>
            <span class="imp-pill imp-${g.importance}" title="日常实用重要度">${starsStr} ${escapeHtml(g.importanceLabel)}</span>
          </div>
          <div class="phrase-status-btns">
            <button type="button" class="icon-btn g-quiz-toggle-btn" data-gid="${g.id}">🧩 ${quizOpen ? "收起小测" : "随堂小测"}</button>
            <button type="button" class="icon-btn ${isStar ? "starred-active" : ""}" data-gstar="${g.id}">${isStar ? "⭐" : "☆"}</button>
            <button type="button" class="icon-btn ${isMast ? "mastered-active" : ""}" data-gmaster="${g.id}">${isMast ? "✅ 已掌握" : "○ 掌握"}</button>
          </div>
        </div>

        <div class="grammar-pattern-row">
          <div class="grammar-pattern-title" lang="ja">${escapeHtml(g.pattern)}</div>
          <div class="romaji-text" style="margin:0;">${escapeHtml(g.reading)}</div>
        </div>

        <div class="grammar-meaning">${escapeHtml(g.meaning)}</div>
        ${
          linkedVideos.length
            ? `<div class="vg-core-links-row">
                ${linkedVideos
                  .map(
                    (v) =>
                      `<button type="button" class="vg-link-btn" data-jump-vg="${v.id}" data-jump-vsrc="${v.source}">🎬 视频联动 ${v.level} #${v.videoOrder} (${escapeHtml(v.timestampLabel)})</button>`
                  )
                  .join("")}
              </div>`
            : ""
        }

        <div class="grammar-formation">
          <span class="gf-tag">📐 接续</span>
          <span>${escapeHtml(g.formation)}</span>
        </div>

        <div class="grammar-expl">${escapeHtml(g.explanation)}</div>
        ${g.tip ? `<div class="phrase-tip" style="margin-top:0.45rem;">💡 <strong>避坑/区分贴士：</strong>${escapeHtml(g.tip)}</div>` : ""}

        ${
          quizOpen && g.quiz
            ? `
          <div class="inline-gquiz-box">
            <div style="font-size:0.78rem;font-weight:800;color:var(--accent-indigo);margin-bottom:0.35rem;">🧩 随堂即练：请选择正确的填空项</div>
            <div class="jp-text" lang="ja" style="font-size:1.05rem;margin-bottom:0.2rem;">${formatRuby(g.quiz.promptJp)}</div>
            <div style="font-size:0.8rem;color:var(--text-secondary);margin-bottom:0.55rem;">🇨🇳 ${escapeHtml(g.quiz.cn)}</div>
            <div class="inline-gquiz-opts">
              ${g.quiz.options
                .map((opt) => {
                  let cls = "";
                  if (qState && qState.picked) {
                    if (opt === g.quiz.answer) cls = "opt-correct";
                    else if (opt === qState.picked) cls = "opt-wrong";
                  }
                  return `<button type="button" class="quiz-opt-btn inline-gquiz-pick ${cls}" data-gid="${g.id}" data-opt="${escapeHtml(opt)}">${escapeHtml(opt)}</button>`;
                })
                .join("")}
            </div>
            ${
              qState && qState.picked
                ? `<div style="margin-top:0.45rem;font-size:0.8rem;font-weight:700;color:${qState.picked === g.quiz.answer ? "var(--accent-emerald)" : "var(--accent-red)"};">
                    ${qState.picked === g.quiz.answer ? "🎉 回答正确！掌握得很扎实！" : `❌ 正确答案是「${escapeHtml(g.quiz.answer)}」`}
                  </div>`
                : ""
            }
          </div>
        `
            : ""
        }

        <div class="grammar-examples">
          <div class="gex-heading">🗣️ 日常高频例句（点击朗读或开口跟读）：</div>
          ${g.dailyExamples
            .map(
              (ex, exIdx) => `
            <div class="verb-example-item">
              <div style="flex:1 1 190px;min-width:0;">
                <span class="vex-form-badge">${escapeHtml(ex.ctx)}</span>
                <div class="jp-text vex-jp" lang="ja">${formatRuby(ex.jp)}</div>
                <div class="romaji-text" style="margin-bottom:0.15rem;">${escapeHtml(ex.romaji)}</div>
                <div class="cn-text" style="font-size:0.85rem;margin-bottom:0;">${escapeHtml(ex.cn)}</div>
              </div>
              <div class="vex-btns">
                <button type="button" class="icon-btn g-speak-btn" data-jp="${escapeHtml(ex.jp)}" title="常速朗读">🔊</button>
                <button type="button" class="icon-btn g-speak-slow-btn" data-jp="${escapeHtml(ex.jp)}" title="慢速跟读">🐢</button>
                <button type="button" class="icon-btn quick-oral-btn" data-oid="${g.id}-ex${exIdx}" data-ojp="${escapeHtml(ex.jp)}" data-oromaji="${escapeHtml(ex.romaji || "")}" data-ocn="${escapeHtml(ex.cn)}" data-otag="📖 ${g.level} · ${escapeHtml(g.pattern)}" title="开口跟读发音评测">🎙️</button>
              </div>
            </div>
          `
            )
            .join("")}
        </div>
      </article>
    `;
  }

  function renderVideoGrammarCard(vg) {
    const { state, formatRuby, escapeHtml } = app();
    const isStar = !!state.starred[vg.id];
    const isMast = !!state.mastered[vg.id];
    const quizOpen = !!gState.openQuizIds[vg.id];
    const qState = gState.openQuizIds[vg.id];
    const tsUrl = `https://youtu.be/${vg.videoId}?t=${vg.timestampSec}`;

    return `
      <article class="grammar-card ${isMast ? "mastered" : ""} ${isStar ? "starred" : ""}" id="vgcard-${vg.id}">
        <div class="grammar-card-top">
          <div class="verb-badges">
            <span class="jlpt-pill jlpt-${vg.level.toLowerCase()}">${vg.level}</span>
            <span class="verb-rank-pill">#${vg.videoOrder}</span>
            <a class="vg-ts-link" href="${escapeHtml(tsUrl)}" target="_blank" rel="noopener" title="跳转至 YouTube 原片对应时间点">▶ ${escapeHtml(vg.timestampLabel)} 看原片</a>
            ${
              vg.linkedCoreId
                ? `<button type="button" class="vg-link-btn" data-jump-core="${vg.linkedCoreId}">🔗 关联精讲</button>`
                : `<span class="vg-new-pill">🆕 扩展新句型</span>`
            }
          </div>
          <div class="phrase-status-btns">
            <button type="button" class="icon-btn g-quiz-toggle-btn" data-gid="${vg.id}">🧩 ${quizOpen ? "收起小测" : "随堂小测"}</button>
            <button type="button" class="icon-btn ${isStar ? "starred-active" : ""}" data-gstar="${vg.id}">${isStar ? "⭐" : "☆"}</button>
            <button type="button" class="icon-btn ${isMast ? "mastered-active" : ""}" data-gmaster="${vg.id}">${isMast ? "✅ 已掌握" : "○ 掌握"}</button>
          </div>
        </div>

        <div class="grammar-pattern-row">
          <div class="grammar-pattern-title" lang="ja">${escapeHtml(vg.pattern)}</div>
          <div class="romaji-text" style="margin:0;">${escapeHtml(vg.reading)}</div>
        </div>

        <div class="grammar-meaning">${escapeHtml(vg.meaning)}</div>
        ${vg.meaningEn ? `<div class="vg-en-gloss">EN: ${escapeHtml(vg.meaningEn)}</div>` : ""}

        <div class="grammar-formation">
          <span class="gf-tag">📐 接续</span>
          <span>${escapeHtml(vg.formation)}</span>
        </div>

        ${vg.tip ? `<div class="phrase-tip" style="margin-top:0.45rem;">💡 <strong>笔记/用法贴士：</strong>${escapeHtml(vg.tip)}</div>` : ""}

        ${
          quizOpen && vg.quiz
            ? `
          <div class="inline-gquiz-box">
            <div style="font-size:0.78rem;font-weight:800;color:var(--accent-indigo);margin-bottom:0.35rem;">🧩 随堂即练：请选择正确的填空项</div>
            <div class="jp-text" lang="ja" style="font-size:1.05rem;margin-bottom:0.2rem;">${formatRuby(vg.quiz.promptJp)}</div>
            <div style="font-size:0.8rem;color:var(--text-secondary);margin-bottom:0.55rem;">🇨🇳 ${escapeHtml(vg.quiz.cn)}</div>
            <div class="inline-gquiz-opts">
              ${vg.quiz.options
                .map((opt) => {
                  let cls = "";
                  if (qState && qState.picked) {
                    if (opt === vg.quiz.answer) cls = "opt-correct";
                    else if (opt === qState.picked) cls = "opt-wrong";
                  }
                  return `<button type="button" class="quiz-opt-btn inline-gquiz-pick ${cls}" data-gid="${vg.id}" data-opt="${escapeHtml(opt)}">${escapeHtml(opt)}</button>`;
                })
                .join("")}
            </div>
            ${
              qState && qState.picked
                ? `<div style="margin-top:0.45rem;font-size:0.8rem;font-weight:700;color:${qState.picked === vg.quiz.answer ? "var(--accent-emerald)" : "var(--accent-red)"};">
                    ${qState.picked === vg.quiz.answer ? "🎉 回答正确！掌握得很扎实！" : `❌ 正确答案是「${escapeHtml(vg.quiz.answer)}」`}
                  </div>`
                : ""
            }
          </div>
        `
            : ""
        }

        <div class="grammar-examples">
          <div class="gex-heading">🗣️ 视频原句跟读（点击朗读或开口评测）：</div>
          ${(vg.examples || [])
            .map(
              (ex, exIdx) => `
            <div class="verb-example-item">
              <div style="flex:1 1 190px;min-width:0;">
                <span class="vex-form-badge">${escapeHtml(ex.ctx)}</span>
                <div class="jp-text vex-jp" lang="ja">${formatRuby(ex.jp)}</div>
                <div class="romaji-text" style="margin-bottom:0.15rem;">${escapeHtml(ex.romaji)}</div>
                <div class="cn-text" style="font-size:0.85rem;margin-bottom:0;">${escapeHtml(ex.cn)}</div>
                ${ex.en ? `<div class="vg-ex-en">${escapeHtml(ex.en)}</div>` : ""}
              </div>
              <div class="vex-btns">
                <button type="button" class="icon-btn g-speak-btn" data-jp="${escapeHtml(ex.jp)}" title="常速朗读">🔊</button>
                <button type="button" class="icon-btn g-speak-slow-btn" data-jp="${escapeHtml(ex.jp)}" title="慢速跟读">🐢</button>
                <button type="button" class="icon-btn quick-oral-btn" data-oid="${vg.id}-ex${exIdx}" data-ojp="${escapeHtml(ex.jp)}" data-oromaji="${escapeHtml(ex.romaji || "")}" data-ocn="${escapeHtml(ex.cn)}" data-otag="🎬 ${vg.level} 视频 #${vg.videoOrder} · ${escapeHtml(vg.pattern)}" title="开口跟读发音评测">🎙️</button>
              </div>
            </div>
          `
            )
            .join("")}
        </div>
      </article>
    `;
  }

  function renderGrammarView() {
    const container = document.getElementById("grammar-view-container");
    if (!container) return;
    const { state, formatRuby, escapeHtml, speakJapanese, toggleStar, toggleMastered, recordStudyActivity, switchAppMode } = app();

    const n4VideoAll = VIDEO_GRAMMAR.filter((v) => v.source === "voylin-n4");
    const n3VideoAll = VIDEO_GRAMMAR.filter((v) => v.source === "voylin-n3");
    const coreDoneAll = GRAMMAR.filter((g) => state.mastered[g.id]).length;
    const n4VideoDone = n4VideoAll.filter((v) => state.mastered[v.id]).length;
    const n3VideoDone = n3VideoAll.filter((v) => state.mastered[v.id]).length;

    const subTabBar = `
      <div class="vocab-hub-switcher scroll-fade-x">
        <button type="button" class="map-pill ${gState.subTab === "core" ? "active" : ""}" data-ghub="core">
          📘 精选精讲 ${GRAMMAR.length} (${coreDoneAll}/${GRAMMAR.length})
        </button>
        <button type="button" class="map-pill ${gState.subTab === "voylin-n4" ? "active" : ""}" data-ghub="voylin-n4">
          🎬 视频 N4 ${n4VideoAll.length} (${n4VideoDone}/${n4VideoAll.length})
        </button>
        <button type="button" class="map-pill ${gState.subTab === "voylin-n3" ? "active" : ""}" data-ghub="voylin-n3">
          🎬 视频 N3 ${n3VideoAll.length} (${n3VideoDone}/${n3VideoAll.length})
        </button>
      </div>
    `;

    const isVideoTab = gState.subTab === "voylin-n4" || gState.subTab === "voylin-n3";

    if (isVideoTab) {
      const srcKey = gState.subTab;
      const srcMeta = VIDEO_SOURCES[srcKey] || {
        id: srcKey,
        level: srcKey === "voylin-n4" ? "N4" : "N3",
        videoId: srcKey === "voylin-n4" ? "lqFAs-RE5AU" : "kQx3gndHZbA",
        url: srcKey === "voylin-n4" ? "https://youtu.be/lqFAs-RE5AU" : "https://youtu.be/kQx3gndHZbA",
        title: srcKey === "voylin-n4" ? "All JLPT N4 Grammar - Quick Japanese [UPDATED]" : "[JP only version] All JLPT N3 Grammar - Quick Japanese",
        author: "Voylin Sensei",
        durationLabel: srcKey === "voylin-n4" ? "29:06" : "47:31"
      };
      const courseItems = VIDEO_GRAMMAR.filter((v) => v.source === srcKey);
      const courseDone = courseItems.filter((v) => state.mastered[v.id]).length;
      const coursePct = courseItems.length ? Math.round((courseDone / courseItems.length) * 100) : 0;
      const newCount = courseItems.filter((v) => !v.linkedCoreId).length;
      const linkedCount = courseItems.length - newCount;
      const exampleCount = courseItems.reduce((s, v) => s + ((v.examples && v.examples.length) || 0), 0);

      const q = gState.search.trim().toLowerCase();
      const filtered = courseItems.filter((vg) => {
        if (gState.videoFilter === "new_only" && vg.linkedCoreId) return false;
        if (gState.videoFilter === "linked" && !vg.linkedCoreId) return false;
        if (gState.status === "starred" && !state.starred[vg.id]) return false;
        if (gState.status === "mastered" && !state.mastered[vg.id]) return false;
        if (gState.status === "unmastered" && state.mastered[vg.id]) return false;
        if (q) {
          const exText = (vg.examples || []).map((e) => `${e.jp} ${e.romaji} ${e.cn} ${e.en || ""}`).join(" ");
          const hay = `${vg.level} ${vg.videoOrder} ${vg.pattern} ${vg.reading} ${vg.meaning} ${vg.meaningEn || ""} ${vg.formation} ${vg.tip} ${exText}`.toLowerCase();
          return hay.includes(q);
        }
        return true;
      });

      const listHtml =
        filtered.length === 0
          ? `<div class="itin-card-block" style="text-align:center;padding:2rem;">
              <div style="font-size:2rem;margin-bottom:0.4rem;">🔍</div>
              <div style="font-weight:700;margin-bottom:0.4rem;">当前筛选下暂无匹配的视频语法</div>
              <button type="button" class="action-btn primary-audio" id="btn-reset-vg-filters">重置视频筛选</button>
            </div>`
          : `<div class="grammar-list">${filtered.map(renderVideoGrammarCard).join("")}</div>`;

      container.innerHTML = `
        <div class="learning-hero-card">
          ${subTabBar}
          <div class="vg-course-banner ${srcKey === "voylin-n3" ? "vg-n3" : ""}">
            <div class="vg-course-top">
              <div>
                <h2 class="itin-section-title">🎬 ${escapeHtml(srcMeta.title)}</h2>
                <div class="vg-course-meta">
                  <span>👤 ${escapeHtml(srcMeta.author || "Voylin Sensei")}</span>
                  <span>·</span>
                  <span>⏱️ 时长 ${escapeHtml(srcMeta.durationLabel)}</span>
                  <span>·</span>
                  <span>📚 <strong>${courseItems.length}</strong> 条语法 / <strong>${exampleCount}</strong> 句原声例句</span>
                  <span>·</span>
                  <span style="color:var(--accent-emerald);font-weight:700;">🆕 扩展新句型 ${newCount} 条</span>
                </div>
              </div>
              <div class="vg-course-actions">
                <button type="button" class="action-btn primary-audio" id="btn-vg-go-oral">🎙️ 去口语跟读本视频 (${exampleCount}句) →</button>
                <button type="button" class="action-btn ${gState.videoEmbedOpen ? "primary-audio" : ""}" id="btn-vg-toggle-embed">
                  ${gState.videoEmbedOpen ? "🔼 收起原视频" : "▶️ 页内观看原视频"}
                </button>
                <a class="action-btn" href="${escapeHtml(srcMeta.url)}" target="_blank" rel="noopener" style="text-decoration:none;">↗ YouTube</a>
              </div>
            </div>

            ${
              gState.videoEmbedOpen
                ? `<div class="vg-embed-wrap">
                    <iframe src="https://www.youtube.com/embed/${escapeHtml(srcMeta.videoId)}" title="${escapeHtml(srcMeta.title)}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen loading="lazy"></iframe>
                  </div>`
                : ""
            }

            <div class="learning-progress-row" style="margin-top:0.2rem;">
              <div class="progress-text-meta">
                <span>🎯 本视频掌握进度：<strong>${courseDone} / ${courseItems.length}</strong> (${coursePct}%)</span>
                <span>当前显示：<strong>${filtered.length}</strong> 条语法</span>
              </div>
              <div class="progress-bar-track"><div class="progress-bar-fill" style="width:${coursePct}%;"></div></div>
            </div>
          </div>
        </div>

        <div class="learning-filter-card">
          <div class="lf-row-top">
            <div class="search-box" style="flex:1 1 240px;">
              <span class="search-icon">🔍</span>
              <input type="text" id="vg-search-input" value="${escapeHtml(gState.search)}" placeholder="搜索本视频语法、英文/中文意思或日语例句..." />
              <button type="button" class="search-clear" id="vg-search-clear" style="display:${gState.search ? "block" : "none"};">✕</button>
            </div>
          </div>
          <div class="lf-chips-row">
            <div class="toggle-group">
              ${[
                ["all", `全部 (${courseItems.length})`],
                ["new_only", `🆕 仅新增扩展 (${newCount})`],
                ["linked", `🔗 核心联动 (${linkedCount})`]
              ]
                .map(([k, lbl]) => `<button type="button" class="toggle-chip ${gState.videoFilter === k ? "active" : ""}" data-vgfilter="${k}">${lbl}</button>`)
                .join("")}
            </div>
            <div class="toggle-group">
              ${[
                ["all", "全部"],
                ["unmastered", "⏳ 未掌握"],
                ["mastered", "✅ 已掌握"],
                ["starred", "⭐ 收藏"]
              ]
                .map(([k, lbl]) => `<button type="button" class="toggle-chip ${gState.status === k ? "active" : ""}" data-gstatus="${k}">${lbl}</button>`)
                .join("")}
            </div>
          </div>
        </div>

        ${listHtml}
      `;

      const goOralBtn = document.getElementById("btn-vg-go-oral");
      if (goOralBtn) {
        goOralBtn.onclick = () => {
          if (window.JP_ORAL_COACH && window.JP_ORAL_COACH.openVideoDeck) {
            window.JP_ORAL_COACH.openVideoDeck(srcKey, true);
          }
          switchAppMode("oral");
        };
      }
      const toggleEmbedBtn = document.getElementById("btn-vg-toggle-embed");
      if (toggleEmbedBtn) {
        toggleEmbedBtn.onclick = () => {
          gState.videoEmbedOpen = !gState.videoEmbedOpen;
          renderGrammarView();
        };
      }
      const vgSearchEl = document.getElementById("vg-search-input");
      if (vgSearchEl) {
        vgSearchEl.oninput = (e) => {
          gState.search = e.target.value;
          const pos = e.target.selectionStart;
          renderGrammarView();
          const next = document.getElementById("vg-search-input");
          if (next) { next.focus(); next.setSelectionRange(pos, pos); }
        };
      }
      const vgClr = document.getElementById("vg-search-clear");
      if (vgClr) vgClr.onclick = () => { gState.search = ""; renderGrammarView(); };
      const vgReset = document.getElementById("btn-reset-vg-filters");
      if (vgReset) {
        vgReset.onclick = () => {
          gState.search = "";
          gState.videoFilter = "all";
          gState.status = "all";
          renderGrammarView();
        };
      }
      container.querySelectorAll("[data-vgfilter]").forEach((b) => {
        b.onclick = () => { gState.videoFilter = b.dataset.vgfilter; renderGrammarView(); };
      });
      container.querySelectorAll("[data-jump-core]").forEach((b) => {
        b.onclick = () => {
          const cid = b.dataset.jumpCore;
          gState.subTab = "core";
          gState.search = "";
          gState.level = "all";
          gState.importance = "all";
          gState.status = "all";
          renderGrammarView();
          setTimeout(() => {
            const el = document.getElementById(`gcard-${cid}`);
            if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
          }, 40);
        };
      });
    } else {
      const statsByLvl = ["N5", "N4", "N3"].map((lvl) => {
        const list = GRAMMAR.filter((g) => g.level === lvl);
        const done = list.filter((g) => state.mastered[g.id]).length;
        return { lvl, total: list.length, done };
      });
      const totalDone = statsByLvl.reduce((s, x) => s + x.done, 0);
      const totalPct = GRAMMAR.length ? Math.round((totalDone / GRAMMAR.length) * 100) : 0;
      const comparisons = EXTRAS.grammarComparisons || [];

      const q = gState.search.trim().toLowerCase();
      const filtered = GRAMMAR.filter((g) => {
        if (gState.level !== "all" && g.level !== gState.level) return false;
        if (gState.importance !== "all" && String(g.importance) !== gState.importance) return false;
        if (gState.status === "starred" && !state.starred[g.id]) return false;
        if (gState.status === "mastered" && !state.mastered[g.id]) return false;
        if (gState.status === "unmastered" && state.mastered[g.id]) return false;
        if (q) {
          const exText = g.dailyExamples.map((e) => `${e.jp} ${e.romaji} ${e.cn} ${e.ctx}`).join(" ");
          const hay = `${g.level} ${g.pattern} ${g.reading} ${g.meaning} ${g.formation} ${g.explanation} ${g.tip} ${exText}`.toLowerCase();
          return hay.includes(q);
        }
        return true;
      });

      const videoMatchesN4 = q
        ? n4VideoAll.filter((vg) => `${vg.pattern} ${vg.reading} ${vg.meaning} ${vg.meaningEn || ""} ${(vg.examples || []).map((e) => `${e.jp} ${e.cn} ${e.en || ""}`).join(" ")}`.toLowerCase().includes(q)).length
        : 0;
      const videoMatchesN3 = q
        ? n3VideoAll.filter((vg) => `${vg.pattern} ${vg.reading} ${vg.meaning} ${vg.meaningEn || ""} ${(vg.examples || []).map((e) => `${e.jp} ${e.cn} ${e.en || ""}`).join(" ")}`.toLowerCase().includes(q)).length
        : 0;

      const crossSearchBanner =
        q && (videoMatchesN4 > 0 || videoMatchesN3 > 0)
          ? `<div class="vg-cross-search-banner">
              <span>🎬 在<strong>视频语法 companion</strong>中也找到匹配项：${videoMatchesN4 > 0 ? `N4视频 (${videoMatchesN4}条)` : ""}${videoMatchesN4 > 0 && videoMatchesN3 > 0 ? " · " : ""}${videoMatchesN3 > 0 ? `N3视频 (${videoMatchesN3}条)` : ""}</span>
              <div style="display:flex;gap:0.35rem;flex-wrap:wrap;">
                ${videoMatchesN4 > 0 ? `<button type="button" class="vg-link-btn" data-cross-vg="voylin-n4">查看视频 N4 (${videoMatchesN4}) →</button>` : ""}
                ${videoMatchesN3 > 0 ? `<button type="button" class="vg-link-btn" data-cross-vg="voylin-n3">查看视频 N3 (${videoMatchesN3}) →</button>` : ""}
              </div>
            </div>`
          : "";

      const levelMeta = {
        N5: { title: "🟢 JLPT N5 · 基础骨架语法全集 (50 条)", sub: "包含指示代词、四态变形、て形连用、移动目的、もう/まだ、普通形简体转换，夯实根基必背！", cls: "grp-banner-n5" },
        N4: { title: "🔵 JLPT N4 · 进阶自然语法 (36 条)", sub: "敬语指示(お〜ください)、授受敬语、口语缩略(ちゃう/とく/なきゃ)、条件句与使役被动！", cls: "grp-banner-n4" },
        N3: { title: "🟣 JLPT N3 · 地道流利语法 (46 条)", sub: "に違いない、わけがない、ことはない、てたまらない、おかげで、うちに、っけ、最中に等高频表达！", cls: "grp-banner-n3" }
      };

      let contentHtml = "";
      if (filtered.length === 0) {
        contentHtml = `
          <div class="itin-card-block" style="text-align:center;padding:2rem;">
            <div style="font-size:2rem;margin-bottom:0.4rem;">🔍</div>
            <div style="font-weight:700;margin-bottom:0.4rem;">没有找到匹配的语法点</div>
            <button type="button" class="action-btn primary-audio" id="btn-reset-grammar-filters">重置语法筛选</button>
          </div>
        `;
      } else if (gState.orderMode === "importance_all") {
        const sortedAll = filtered.slice().sort((a, b) => b.importance - a.importance || a.order - b.order);
        contentHtml = `<div class="grammar-list">${sortedAll.map(renderGrammarCard).join("")}</div>`;
      } else {
        const levelOrder = gState.orderMode === "n3_first" ? ["N3", "N4", "N5"] : ["N5", "N4", "N3"];
        contentHtml = levelOrder
          .map((lvl) => {
            const items = filtered.filter((g) => g.level === lvl);
            if (!items.length) return "";
            const meta = levelMeta[lvl];
            return `
              <div class="grammar-level-section" id="grammar-sec-${lvl.toLowerCase()}">
                <div class="grammar-level-banner ${meta.cls}">
                  <div>
                    <h3 class="grammar-level-title">${meta.title}</h3>
                    <p class="grammar-level-sub">${meta.sub}</p>
                  </div>
                  <span class="grammar-level-count">${items.length} 条语法</span>
                </div>
                <div class="grammar-list">
                  ${items.map(renderGrammarCard).join("")}
                </div>
              </div>
            `;
          })
          .join("");
      }

      container.innerHTML = `
        <div class="learning-hero-card">
          ${subTabBar}
          <div class="learning-hero-top" style="margin-top:0.75rem;">
            <div>
              <h2 class="itin-section-title">📖 日语核心语法精讲 · N5 夯基 + N4/N3 进阶 (${GRAMMAR.length} 条)</h2>
              <p class="itin-section-sub">点击下方级别卡直接切换筛选；上方可切换「🎬 视频 N4 / 视频 N3 全集 (160条·320原句)」联动精练！</p>
            </div>
            <div style="display:flex;gap:0.45rem;flex-wrap:wrap;">
              <button type="button" class="action-btn ${gState.showComparisons ? "primary-audio" : ""}" id="btn-toggle-gcomp">
                ⚖️ ${gState.showComparisons ? "收起对比卡" : `易混语法对比 (${comparisons.length}组)`}
              </button>
              <button type="button" class="action-btn primary-audio" id="btn-jump-grammar-quiz">
                🧩 语法填空测验 →
              </button>
            </div>
          </div>

          <div class="grammar-kpi-row">
            <button type="button" class="gkpi-card ${gState.level === "all" ? "active" : ""}" data-glevel="all">
              <span class="verb-rank-pill">ALL</span>
              <div>
                <div style="font-weight:800;font-size:0.95rem;">全部 ${totalDone} / ${GRAMMAR.length}</div>
                <div style="font-size:0.73rem;color:var(--text-muted);">N5–N3 完整总览</div>
              </div>
            </button>
            ${statsByLvl
              .map(
                (s) => `
              <button type="button" class="gkpi-card ${gState.level === s.lvl ? "active" : ""}" data-glevel="${s.lvl}">
                <span class="jlpt-pill jlpt-${s.lvl.toLowerCase()}">${s.lvl}</span>
                <div>
                  <div style="font-weight:800;font-size:0.95rem;">已掌握 ${s.done} / ${s.total}</div>
                  <div style="font-size:0.73rem;color:var(--text-muted);">${s.lvl === "N5" ? "基础总复习" : s.lvl === "N4" ? "日常流利进阶" : "地道细腻表达"}</div>
                </div>
              </button>
            `
              )
              .join("")}
          </div>

          <div class="learning-progress-row">
            <div class="progress-text-meta">
              <span>🎯 语法总进度：<strong>${totalDone} / ${GRAMMAR.length}</strong> (${totalPct}%)</span>
              <span>当前显示：<strong>${filtered.length}</strong> 条语法</span>
            </div>
            <div class="progress-bar-track"><div class="progress-bar-fill" style="width:${totalPct}%;"></div></div>
          </div>

          ${
            gState.showComparisons
              ? `
            <div class="gcomp-grid">
              ${comparisons
                .map(
                  (cmp) => `
                <div class="gcomp-card">
                  <div class="gcomp-title">${escapeHtml(cmp.title)}</div>
                  <div class="gcomp-sub">${escapeHtml(cmp.summary)}</div>
                  <div class="gcomp-rows">
                    ${cmp.rows
                      .map(
                        (r) => `
                      <div class="gcomp-row">
                        <div style="flex:1;min-width:0;">
                          <div class="gcomp-form" lang="ja">${escapeHtml(r.form)}</div>
                          <div class="gcomp-nuance">${escapeHtml(r.nuance)}</div>
                          <div class="jp-text" lang="ja" style="font-size:0.92rem;margin:0.15rem 0 0.05rem;">${formatRuby(r.exJp)}</div>
                          <div style="font-size:0.78rem;color:var(--accent-indigo);font-weight:600;">${escapeHtml(r.exCn)}</div>
                        </div>
                        <button type="button" class="icon-btn g-speak-btn" data-jp="${escapeHtml(r.exJp)}">🔊</button>
                      </div>
                    `
                      )
                      .join("")}
                  </div>
                </div>
              `
                )
                .join("")}
            </div>
          `
              : ""
          }
        </div>

        <div class="learning-filter-card">
          <div class="lf-row-top">
            <div class="search-box" style="flex:1 1 240px;">
              <span class="search-icon">🔍</span>
              <input type="text" id="grammar-search-input" value="${escapeHtml(gState.search)}" placeholder="搜语法句型、中文意思或例句（如：てもいい、こそあど、おかげで、っけ）..." />
              <button type="button" class="search-clear" id="grammar-search-clear" style="display:${gState.search ? "block" : "none"};">✕</button>
            </div>
            <select id="grammar-order-select" class="lf-select" aria-label="分组与排序方式">
              <option value="n5_first" ${gState.orderMode === "n5_first" ? "selected" : ""}>📚 分组：N5 → N4 → N3 (由浅入深)</option>
              <option value="n3_first" ${gState.orderMode === "n3_first" ? "selected" : ""}>🚀 分组：N3 → N4 → N5 (高阶优先)</option>
              <option value="importance_all" ${gState.orderMode === "importance_all" ? "selected" : ""}>🔥 跨级别按重要度排序 (5★优先)</option>
            </select>
          </div>

          <div class="lf-chips-row">
            <div class="toggle-group">
              ${[
                ["all", "全部重要度"],
                ["5", "🔥 5★每日必用"],
                ["4", "⭐ 4★高频实用"],
                ["3", "💎 3★进阶地道"]
              ]
                .map(([k, lbl]) => `<button type="button" class="toggle-chip ${gState.importance === k ? "active" : ""}" data-gimp="${k}">${lbl}</button>`)
                .join("")}
            </div>
            <div class="toggle-group">
              ${[
                ["all", "全部"],
                ["unmastered", "⏳ 未掌握"],
                ["mastered", "✅ 已掌握"],
                ["starred", "⭐ 收藏"]
              ]
                .map(([k, lbl]) => `<button type="button" class="toggle-chip ${gState.status === k ? "active" : ""}" data-gstatus="${k}">${lbl}</button>`)
                .join("")}
            </div>
          </div>
        </div>

        ${crossSearchBanner}
        ${contentHtml}
      `;

      const toggleComp = document.getElementById("btn-toggle-gcomp");
      if (toggleComp) toggleComp.onclick = () => { gState.showComparisons = !gState.showComparisons; renderGrammarView(); };
      const jumpQuiz = document.getElementById("btn-jump-grammar-quiz");
      if (jumpQuiz) {
        jumpQuiz.onclick = () => {
          pState.subMode = "quiz";
          pState.quizKind = "grammar";
          pState.quizQuestion = null;
          switchAppMode("practice");
        };
      }
      const searchEl = document.getElementById("grammar-search-input");
      if (searchEl) {
        searchEl.oninput = (e) => {
          gState.search = e.target.value;
          const pos = e.target.selectionStart;
          renderGrammarView();
          const next = document.getElementById("grammar-search-input");
          if (next) { next.focus(); next.setSelectionRange(pos, pos); }
        };
      }
      const searchClr = document.getElementById("grammar-search-clear");
      if (searchClr) searchClr.onclick = () => { gState.search = ""; renderGrammarView(); };
      const orderSel = document.getElementById("grammar-order-select");
      if (orderSel) orderSel.onchange = (e) => { gState.orderMode = e.target.value; renderGrammarView(); };

      container.querySelectorAll("[data-glevel]").forEach((b) => {
        b.onclick = () => { gState.level = b.dataset.glevel; renderGrammarView(); };
      });
      container.querySelectorAll("[data-gimp]").forEach((b) => {
        b.onclick = () => { gState.importance = b.dataset.gimp; renderGrammarView(); };
      });
      container.querySelectorAll("[data-jump-vg]").forEach((b) => {
        b.onclick = () => {
          const vid = b.dataset.jumpVg;
          const vsrc = b.dataset.jumpVsrc || "voylin-n4";
          gState.subTab = vsrc;
          gState.videoFilter = "all";
          gState.status = "all";
          gState.search = "";
          renderGrammarView();
          setTimeout(() => {
            const el = document.getElementById(`vgcard-${vid}`);
            if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
          }, 40);
        };
      });
      container.querySelectorAll("[data-cross-vg]").forEach((b) => {
        b.onclick = () => {
          gState.subTab = b.dataset.crossVg;
          gState.videoFilter = "all";
          gState.status = "all";
          renderGrammarView();
        };
      });
      const resetBtn = document.getElementById("btn-reset-grammar-filters");
      if (resetBtn) {
        resetBtn.onclick = () => {
          gState.search = ""; gState.level = "all"; gState.importance = "all"; gState.status = "all";
          renderGrammarView();
        };
      }
    }

    // Shared bindings across core & video grammar sub-tabs
    container.querySelectorAll("[data-ghub]").forEach((b) => {
      b.onclick = () => { gState.subTab = b.dataset.ghub; renderGrammarView(); };
    });
    container.querySelectorAll("[data-gstatus]").forEach((b) => {
      b.onclick = () => { gState.status = b.dataset.gstatus; renderGrammarView(); };
    });
    container.querySelectorAll("[data-gstar]").forEach((b) => { b.onclick = () => toggleStar(b.dataset.gstar); });
    container.querySelectorAll("[data-gmaster]").forEach((b) => { b.onclick = () => toggleMastered(b.dataset.gmaster); });
    container.querySelectorAll(".g-speak-btn").forEach((b) => {
      b.onclick = function () { speakJapanese(this.dataset.jp, 1.0, this); };
    });
    container.querySelectorAll(".g-speak-slow-btn").forEach((b) => {
      b.onclick = function () { speakJapanese(this.dataset.jp, 0.78, this); };
    });
    bindQuickOralButtons(container);
    container.querySelectorAll(".g-quiz-toggle-btn").forEach((b) => {
      b.onclick = () => {
        const gid = b.dataset.gid;
        if (gState.openQuizIds[gid]) delete gState.openQuizIds[gid];
        else gState.openQuizIds[gid] = { picked: null };
        renderGrammarView();
      };
    });
    container.querySelectorAll(".inline-gquiz-pick").forEach((b) => {
      b.onclick = () => {
        const gid = b.dataset.gid;
        const opt = b.dataset.opt;
        const gObj = GRAMMAR.find((x) => x.id === gid) || VIDEO_GRAMMAR.find((x) => x.id === gid);
        gState.openQuizIds[gid] = { picked: opt };
        if (gObj && gObj.quiz && opt === gObj.quiz.answer) {
          recordStudyActivity(1);
          speakJapanese(gObj.quiz.promptJp.replace("＿＿", opt), 1.0);
        }
        renderGrammarView();
      };
    });
  }

  // =========================================================================
  // TAB 3: INTERACTIVE PRACTICE & SPACED-REPETITION LAB
  // =========================================================================
  function buildSrsPool(deck, jlptFilter) {
    const { state } = app();
    const n5VocabCards = getN5VocabUnified().map((w) => ({
      id: w.id,
      kind: "🟢 N5词汇",
      badge: w.cat,
      frontJp: w.jp,
      frontKana: w.kana,
      romaji: w.romaji,
      backCn: w.cn,
      extraHtml: w.subMeta || "",
      exampleJp: w.ex || "",
      exampleCn: w.exCn || "",
      audioText: w.kana,
      audioKey: null
    }));

    const verbCards = VERBS.filter((v) => jlptFilter === "all" || v.jlpt === jlptFilter).map((v) => ({
      id: v.id,
      kind: "⚡ 动词",
      badge: `${v.jlpt} · #${v.rank} · ${TRANS_LABELS[v.transitivity]}`,
      frontJp: v.jp,
      frontKana: v.kana,
      romaji: v.romaji,
      backCn: v.cn,
      extraHtml: `ます: <strong>${v.forms.masu.jp}</strong> ｜ て: <strong>${v.forms.te.jp}</strong> ｜ ない: <strong>${v.forms.nai.jp}</strong>${v.particles ? ` ｜ 🔗 ${v.particles}` : ""}`,
      exampleJp: v.examples[0] ? v.examples[0].jp : "",
      exampleCn: v.examples[0] ? v.examples[0].cn : "",
      audioText: v.kana,
      audioKey: null
    }));

    const byId = {};
    VERBS.forEach((v) => { byId[v.id] = v; });
    const pairCards = VERBS.filter((v) => v.pairId && v.transitivity === "vi").map((vi) => {
      const vt = byId[vi.pairId];
      return {
        id: `pair-${vi.id}`,
        kind: "🔗 自他动词对",
        badge: `${vi.jlpt} · 成对对照`,
        frontJp: `${vi.jp}（自） ⇄ ${vt ? vt.jp : ""}（他）`,
        frontKana: `${vi.kana}、${vt ? vt.kana : ""}`,
        romaji: `${vi.romaji}  ↔  ${vt ? vt.romaji : ""}`,
        backCn: `自：${vi.cn} ｜ 他：${vt ? vt.cn : ""}`,
        extraHtml: `🔵 ${vi.particles} ｜ 🟠 ${vt ? vt.particles : ""}`,
        exampleJp: (vi.examples[2] || vi.examples[0]).jp,
        exampleCn: (vi.examples[2] || vi.examples[0]).cn,
        audioText: vi.kana,
        audioKey: null
      };
    });

    const grammarCards = GRAMMAR.filter((g) => jlptFilter === "all" || g.level === jlptFilter).map((g) => ({
      id: g.id,
      kind: "📖 语法",
      badge: `${g.level} · ${g.importanceLabel}`,
      frontJp: g.pattern,
      frontKana: g.dailyExamples[0] ? g.dailyExamples[0].jp : g.pattern,
      romaji: g.reading,
      backCn: g.meaning,
      extraHtml: `📐 ${g.formation}`,
      exampleJp: g.dailyExamples[0] ? g.dailyExamples[0].jp : "",
      exampleCn: g.dailyExamples[0] ? g.dailyExamples[0].cn : "",
      audioText: g.dailyExamples[0] ? g.dailyExamples[0].jp : g.pattern,
      audioKey: null
    }));

    const videoGrammarCards = VIDEO_GRAMMAR.filter((vg) => jlptFilter === "all" || vg.level === jlptFilter).map((vg) => ({
      id: vg.id,
      kind: "🎬 视频语法",
      badge: `${vg.level} · #${vg.videoOrder} (${vg.timestampLabel})`,
      frontJp: vg.pattern,
      frontKana: vg.examples && vg.examples[0] ? vg.examples[0].jp : vg.pattern,
      romaji: vg.reading,
      backCn: vg.meaning + (vg.meaningEn ? ` (${vg.meaningEn})` : ""),
      extraHtml: `📐 ${vg.formation}`,
      exampleJp: vg.examples && vg.examples[0] ? vg.examples[0].jp : "",
      exampleCn: vg.examples && vg.examples[0] ? vg.examples[0].cn : "",
      audioText: vg.examples && vg.examples[0] ? vg.examples[0].jp : vg.pattern,
      audioKey: null
    }));

    const phraseCards = getAllPhraseItems().map((it) => ({
      id: it.id,
      kind: "🗣️ 场景短语",
      badge: it.tag || "场景短语",
      frontJp: it.jp,
      frontKana: it.jp,
      romaji: it.romaji || "",
      backCn: it.cn,
      extraHtml: it.tip ? `💡 ${it.tip}` : "",
      exampleJp: "",
      exampleCn: "",
      audioText: it.jp,
      audioKey: it.id
    }));

    if (deck === "n5vocab") return n5VocabCards;
    if (deck === "verbs") return verbCards;
    if (deck === "pairs") return pairCards;
    if (deck === "grammar") return grammarCards;
    if (deck === "video_grammar") return videoGrammarCards;
    if (deck === "phrases") return phraseCards;
    const all = [...n5VocabCards, ...verbCards, ...grammarCards, ...videoGrammarCards, ...phraseCards];
    if (deck === "starred") return all.filter((c) => state.starred[c.id]);
    if (deck === "due") {
      const now = Date.now();
      return all.filter((c) => state.srs[c.id] && state.srs[c.id].nextDue <= now);
    }
    return all;
  }

  function pickNextSrsCard() {
    const { state } = app();
    const pool = buildSrsPool(pState.srsDeck, pState.srsJlpt);
    if (!pool.length) {
      pState.srsCurrentCard = null;
      return;
    }
    const now = Date.now();
    const due = pool.filter((c) => state.srs[c.id] && state.srs[c.id].nextDue <= now);
    const unseen = pool.filter((c) => !state.srs[c.id] && !state.mastered[c.id]);
    let candidates = due.length ? due : unseen.length ? unseen : pool;
    if (pState.srsCurrentCard && candidates.length > 1) {
      candidates = candidates.filter((c) => c.id !== pState.srsCurrentCard.id);
    }
    pState.srsCurrentCard = candidates[Math.floor(Math.random() * candidates.length)];
    pState.srsFlipped = false;
  }

  function rateSrsCard(rating) {
    if (!pState.srsCurrentCard) return;
    const { state, saveUserState, recordStudyActivity } = app();
    const id = pState.srsCurrentCard.id;
    const prev = state.srs[id] || { box: 0, reviews: 0, nextDue: 0 };
    const DAY = 86400000;
    const intervals = [10 * 60000, DAY, 3 * DAY, 7 * DAY, 14 * DAY, 30 * DAY];

    let nextBox = prev.box;
    if (rating === "again") nextBox = 0;
    else if (rating === "hard") nextBox = Math.max(1, prev.box);
    else if (rating === "good") nextBox = Math.min(intervals.length - 1, prev.box + 1);

    state.srs[id] = {
      box: nextBox,
      reviews: (prev.reviews || 0) + 1,
      nextDue: Date.now() + intervals[nextBox]
    };
    if (rating === "good" && nextBox >= 2) {
      state.mastered[id] = true;
    } else if (rating === "again") {
      delete state.mastered[id];
    }
    saveUserState();
    recordStudyActivity(1);
    pickNextSrsCard();
    renderPracticeView();
    if (pState.srsAutoPlay && pState.srsCurrentCard) {
      setTimeout(() => {
        if (pState.srsCurrentCard) {
          app().speakJapanese(pState.srsCurrentCard.audioText, 1.0, null, null, pState.srsCurrentCard.audioKey);
        }
      }, 150);
    }
  }

  // Vi/Vt & Particle Blitz Question Generator
  function generateViVtQuestion() {
    const rawPool = EXTRAS.viVtQuizzes || [];
    const pool = rawPool.filter((q) => pState.vivtKind === "all" || q.kind === pState.vivtKind);
    const list = pool.length ? pool : rawPool;
    const pick = list[Math.floor(Math.random() * list.length)];
    if (!pick) return;
    pState.vivtQuestion = {
      ...pick,
      options: shuffle(pick.options)
    };
    pState.vivtAnswered = null;
  }

  // Conjugation Drill Question Generator
  const DRILL_FORMS = [
    { key: "te", label: "て形（请求/连接）" },
    { key: "masu", label: "ます形（礼貌体）" },
    { key: "nai", label: "ない形（否定）" },
    { key: "ta", label: "た形（过去简体）" },
    { key: "tai", label: "たい形（想要做）" },
    { key: "potential", label: "可能形（能够做）" },
    { key: "volitional", label: "意向形（一起做吧）" },
    { key: "ba", label: "ば形（如果……）" },
    { key: "passive", label: "受身形（被动）" },
    { key: "causative", label: "使役形（让做）" },
    { key: "causative_passive", label: "使役被动（被迫做）" }
  ];

  function generateConjQuestion() {
    const pool = VERBS.filter((v) => pState.conjJlpt === "all" || v.jlpt === pState.conjJlpt);
    const validPool = pool.length ? pool : VERBS;
    const targetFormObj =
      pState.conjForm === "mixed"
        ? DRILL_FORMS[Math.floor(Math.random() * DRILL_FORMS.length)]
        : DRILL_FORMS.find((f) => f.key === pState.conjForm) || DRILL_FORMS[0];

    const filtered = validPool.filter((v) => v.forms[targetFormObj.key] && !v.forms[targetFormObj.key].jp.startsWith("—"));
    const verb = filtered[Math.floor(Math.random() * filtered.length)];
    const correctObj = verb.forms[targetFormObj.key];

    const distractors = new Set();
    const otherKeys = shuffle(["masu", "te", "ta", "nai", "tai", "potential", "volitional", "ba", "passive", "causative"]);
    for (const k of otherKeys) {
      if (k !== targetFormObj.key && verb.forms[k] && !verb.forms[k].jp.startsWith("—") && verb.forms[k].jp !== correctObj.jp) {
        distractors.add(verb.forms[k].jp);
      }
      if (distractors.size >= 2) break;
    }
    const stem = verb.dict.slice(0, -1);
    const trickyGuesses = {
      te: [stem + "て", stem + "って", stem + "いて", stem + "んで", stem + "して"],
      ta: [stem + "た", stem + "った", stem + "いた", stem + "んだ", stem + "した"],
      nai: [stem + "ない", stem + "らない", stem + "わない", stem + "かない"],
      masu: [stem + "ます", stem + "ります", stem + "います", stem + "きます"],
      tai: [stem + "たい", stem + "りたい", stem + "いたい"],
      potential: [stem + "られる", stem + "える", stem + "れる"],
      volitional: [stem + "よう", stem + "ろう", stem + "おう"],
      ba: [stem + "れば", stem + "えば", stem + "け"],
      passive: [stem + "られる", stem + "れる", stem + "される"],
      causative: [stem + "させる", stem + "せる", stem + "らせる"],
      causative_passive: [stem + "させられる", stem + "される", stem + "らされる"]
    };
    for (const g of shuffle(trickyGuesses[targetFormObj.key] || [])) {
      if (g !== correctObj.jp && g.length >= 2) {
        distractors.add(g);
        if (distractors.size >= 3) break;
      }
    }
    const opts = shuffle([correctObj.jp, ...Array.from(distractors).slice(0, 3)]);
    pState.conjQuestion = {
      verb,
      formKey: targetFormObj.key,
      formLabel: targetFormObj.label,
      answerJp: correctObj.jp,
      answerKana: correctObj.kana,
      options: opts
    };
    pState.conjAnswered = null;
  }

  // Grammar, Listening & Staff Decoder Quiz Generator
  function generateQuizQuestion() {
    if (pState.quizKind === "grammar") {
      const srcPool =
        pState.quizSource === "core"
          ? GRAMMAR
          : pState.quizSource === "video"
          ? VIDEO_GRAMMAR
          : [...GRAMMAR, ...VIDEO_GRAMMAR];
      const pool = srcPool.filter((g) => (pState.quizLevel === "all" || g.level === pState.quizLevel) && g.quiz);
      const list = pool.length ? pool : srcPool.filter((g) => g.quiz);
      const pick = list[Math.floor(Math.random() * list.length)];
      if (!pick) return;
      pState.quizQuestion = {
        kind: "grammar",
        grammar: pick,
        promptJp: pick.quiz.promptJp,
        cn: pick.quiz.cn,
        answer: pick.quiz.answer,
        options: shuffle(pick.quiz.options)
      };
      pState.quizAnswered = null;
    } else if (pState.quizKind === "staff") {
      const list = EXTRAS.staffDecoder || [];
      if (!list.length) return;
      const target = list[Math.floor(Math.random() * list.length)];
      const wrong = shuffle(list.filter((x) => x.cn !== target.cn)).slice(0, 3).map((x) => x.cn);
      pState.quizQuestion = {
        kind: "staff",
        staff: target,
        jp: target.hearJp,
        cn: target.cn,
        answer: target.cn,
        options: shuffle([target.cn, ...wrong])
      };
      pState.quizAnswered = null;
    } else {
      const items = [
        ...getAllPhraseItems().map((it) => ({ jp: it.jp, cn: it.cn, tag: it.tag, audioKey: it.id })),
        ...VERBS.slice(0, 200).map((v) => ({ jp: v.examples[0].jp, cn: v.examples[0].cn, tag: `动词 #${v.rank} ${v.dict}`, audioKey: null })),
        ...(EXTRAS.n5Vocab || []).filter((nv) => nv.ex).map((nv) => ({ jp: nv.ex, cn: nv.exCn, tag: `N5词汇 · ${nv.cat}`, audioKey: null }))
      ];
      const target = items[Math.floor(Math.random() * items.length)];
      const wrong = shuffle(items.filter((x) => x.cn !== target.cn)).slice(0, 3).map((x) => x.cn);
      pState.quizQuestion = {
        kind: "listening",
        jp: target.jp,
        cn: target.cn,
        tag: target.tag,
        audioKey: target.audioKey,
        answer: target.cn,
        options: shuffle([target.cn, ...wrong])
      };
      pState.quizAnswered = null;
    }
  }

  function stopShadowingLoop() {
    if (window.JP_ORAL_COACH) window.JP_ORAL_COACH.stopAll();
    else if (app()) app().stopAllAudio();
  }

  function renderPracticeView() {
    const container = document.getElementById("practice-view-container");
    if (!container) return;
    if (pState.subMode === "shadow") pState.subMode = "srs";
    const { state, formatRuby, escapeHtml, speakJapanese, recordStudyActivity } = app();

    // Dashboard metrics
    const n5All = getN5VocabUnified();
    const n5Done = n5All.filter((x) => state.mastered[x.id]).length;
    const allPhrases = getAllPhraseItems();
    const pDone = allPhrases.filter((x) => state.mastered[x.id]).length;
    const vDone = VERBS.filter((x) => state.mastered[x.id]).length;
    const gDone = GRAMMAR.filter((x) => state.mastered[x.id]).length;
    const vgDone = VIDEO_GRAMMAR.filter((x) => state.mastered[x.id]).length;
    const now = Date.now();
    const dueCount = Object.values(state.srs || {}).filter((s) => s && s.nextDue <= now).length;
    const oralEntries = Object.values(state.oralStats || {});
    const oralPassed = oralEntries.filter((x) => x && x.bestScore >= 80).length;
    const oralWeak = oralEntries.filter((x) => x && x.bestScore < 80).length;
    const todayStr = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}-${String(new Date().getDate()).padStart(2, "0")}`;
    const todayCount = state.streak.todayDate === todayStr ? state.streak.todayCount || 0 : 0;

    let stageHtml = "";

    // --- SUB-MODE 1: SRS FLASHCARDS ---
    if (pState.subMode === "srs") {
      if (!pState.srsCurrentCard) pickNextSrsCard();
      const card = pState.srsCurrentCard;
      const poolSize = buildSrsPool(pState.srsDeck, pState.srsJlpt).length;
      const cardSrs = card ? state.srs[card.id] : null;

      stageHtml = `
        <div class="practice-stage-card">
          <div class="practice-toolbar-row">
            <div class="toggle-group">
              ${[
                ["due", `⏰ 待复习 (${dueCount})`],
                ["n5vocab", "🟢 N5词汇"],
                ["verbs", "⚡ 动词300"],
                ["pairs", "🔗 自他动词对"],
                ["grammar", `📖 语法${GRAMMAR.length}`],
                ["video_grammar", `🎬 视频语法${VIDEO_GRAMMAR.length}`],
                ["phrases", "🗣️ 场景"],
                ["starred", "⭐ 收藏"]
              ]
                .map(([k, lbl]) => `<button type="button" class="toggle-chip ${pState.srsDeck === k ? "active" : ""}" data-srsdeck="${k}">${lbl}</button>`)
                .join("")}
            </div>
            <div class="toggle-group">
              ${
                pState.srsDeck === "verbs" || pState.srsDeck === "grammar" || pState.srsDeck === "video_grammar"
                  ? (pState.srsDeck === "video_grammar" ? ["all", "N4", "N3"] : ["all", "N5", "N4", "N3"])
                      .map((l) => `<button type="button" class="toggle-chip ${pState.srsJlpt === l ? "active" : ""}" data-srsjlpt="${l}">${l === "all" ? "全级别" : l}</button>`)
                      .join("")
                  : ""
              }
              <button type="button" class="toggle-chip ${pState.srsListenFirst ? "active" : ""}" id="btn-srs-listenfirst" title="隐藏文字，先靠耳朵盲听辨意">🎧 盲听模式</button>
              <button type="button" class="toggle-chip ${pState.srsAutoPlay ? "active" : ""}" id="btn-srs-autoplay">🔊 自动发声</button>
            </div>
          </div>

          ${
            !card
              ? `<div style="text-align:center;padding:2.5rem 1rem;">
                  <div style="font-size:2.4rem;margin-bottom:0.4rem;">🎉</div>
                  <div style="font-weight:800;font-size:1.05rem;margin-bottom:0.35rem;">
                    ${pState.srsDeck === "due" ? "太棒了！今日到期复习卡片已全部清空！" : "当前卡组暂无卡片"}
                  </div>
                  <p style="font-size:0.84rem;color:var(--text-secondary);margin-bottom:1rem;">切换到「🟢 N5词汇」「⚡ 动词300」或「🔗 自他动词对」继续学习吧！</p>
                  <button type="button" class="action-btn primary-audio" id="btn-srs-switch-n5">开始刷 N5 核心词汇闪卡</button>
                </div>`
              : `
            <div class="flashcard-meta-strip">
              <span>当前卡组共 <strong>${poolSize}</strong> 张</span>
              <span>${cardSrs ? `已复习 ${cardSrs.reviews} 次 · 记忆盒 Lv.${cardSrs.box}` : "✨ 新卡片"}</span>
            </div>

            <div class="srs-flashcard ${pState.srsFlipped ? "flipped" : ""}" id="srs-flashcard-box">
              <div class="fc-top-badges">
                <span class="phrase-tag">${card.kind}</span>
                <span class="verb-rank-pill">${escapeHtml(card.badge)}</span>
              </div>

              <div class="fc-front-area">
                ${
                  pState.srsListenFirst && !pState.srsFlipped
                    ? `<div style="padding:1.4rem 0;text-align:center;">
                        <div style="font-size:2.3rem;margin-bottom:0.4rem;">🎧</div>
                        <div style="font-weight:700;color:var(--text-secondary);margin-bottom:0.8rem;">盲听模式：先听发音，在心里拼出日文和意思再翻面！</div>
                        <button type="button" class="action-btn primary-audio" id="btn-fc-play-front">🔊 播放日语发音</button>
                      </div>`
                    : `<div class="jp-text fc-jp-main" lang="ja">${formatRuby(card.frontJp)}</div>
                       <div class="romaji-text" style="text-align:center;">${escapeHtml(card.romaji)}</div>`
                }
              </div>

              ${
                pState.srsFlipped
                  ? `
                <div class="fc-back-area">
                  ${pState.srsListenFirst ? `<div class="jp-text" lang="ja" style="text-align:center;font-size:1.25rem;margin-bottom:0.3rem;">${formatRuby(card.frontJp)}</div>` : ""}
                  <div class="fc-cn-answer">${escapeHtml(card.backCn)}</div>
                  ${card.extraHtml ? `<div class="fc-extra-info">${card.extraHtml}</div>` : ""}
                  ${
                    card.exampleJp
                      ? `<div class="fc-example-box">
                          <div style="flex:1;">
                            <div class="jp-text" lang="ja" style="font-size:0.96rem;margin:0;">${formatRuby(card.exampleJp)}</div>
                            <div style="font-size:0.8rem;color:var(--text-secondary);">${escapeHtml(card.exampleCn)}</div>
                          </div>
                          <button type="button" class="icon-btn" id="btn-fc-play-ex">🔊 听例句</button>
                        </div>`
                      : ""
                  }
                </div>
              `
                  : `<div class="fc-tap-hint">👆 点击卡片、按 Space 键或点下方按钮翻看答案</div>`
              }
            </div>

            <div class="fc-controls-row">
              <button type="button" class="action-btn" id="btn-fc-speak-1x">🔊 朗读 (R)</button>
              <button type="button" class="action-btn" id="btn-fc-speak-slow">🐢 慢读 (S)</button>
              ${
                !pState.srsFlipped
                  ? `<button type="button" class="action-btn primary-audio" id="btn-fc-flip" style="flex:1;max-width:260px;">👀 显示答案 (Space)</button>`
                  : `
                  <button type="button" class="action-btn srs-btn-again" id="btn-srs-again">😰 忘了 (1)</button>
                  <button type="button" class="action-btn srs-btn-hard" id="btn-srs-hard">🤔 模糊 (2)</button>
                  <button type="button" class="action-btn srs-btn-good" id="btn-srs-good">✅ 记牢了 (3)</button>
                `
              }
            </div>
            <div class="kbd-shortcut-hint">⌨️ 键盘快捷键：Space 翻面 · R 重听 · S 慢速 · 1/2/3 快速评分</div>
          `
          }
        </div>
      `;
    }

    // --- SUB-MODE 2: VI/VT TRANSITIVITY & PARTICLE BLITZ ---
    else if (pState.subMode === "vivt") {
      if (!pState.vivtQuestion) generateViVtQuestion();
      const q = pState.vivtQuestion;
      const acc = pState.vivtTotal ? Math.round((pState.vivtCorrect / pState.vivtTotal) * 100) : 0;

      stageHtml = `
        <div class="practice-stage-card">
          <div class="practice-toolbar-row">
            <div class="toggle-group">
              ${[
                ["all", "🎯 混合专项 (36题)"],
                ["vivt", "⇄ 自他动词辨析"],
                ["particle", "🔗 动词格助词搭配"]
              ]
                .map(([k, lbl]) => `<button type="button" class="toggle-chip ${pState.vivtKind === k ? "active" : ""}" data-vivtkind="${k}">${lbl}</button>`)
                .join("")}
            </div>
          </div>

          <div class="drill-score-strip">
            <span>🔥 连对：<strong>${pState.vivtStreak}</strong></span>
            <span>📊 正确率：<strong>${pState.vivtCorrect} / ${pState.vivtTotal}</strong> (${acc}%)</span>
          </div>

          ${
            q
              ? `
            <div class="drill-question-box">
              <div style="display:flex;justify-content:center;gap:0.4rem;margin-bottom:0.45rem;">
                <span class="phrase-tag">${q.kind === "vivt" ? "⇄ 自动词 vs 他动词" : "🔗 核心助词填空"}</span>
              </div>
              <div class="jp-text" lang="ja" style="font-size:1.32rem;text-align:center;margin:0.35rem 0;">${formatRuby(q.promptJp)}</div>
              <div style="text-align:center;font-size:0.9rem;color:var(--accent-indigo);font-weight:700;margin-bottom:0.9rem;">
                🇨🇳 ${escapeHtml(q.cn)}
              </div>
              <div class="quiz-options-grid">
                ${q.options
                  .map((opt, idx) => {
                    let cls = "";
                    if (pState.vivtAnswered) {
                      if (opt === q.answer) cls = "opt-correct";
                      else if (opt === pState.vivtAnswered.picked) cls = "opt-wrong";
                    }
                    return `<button type="button" class="quiz-opt-btn vivt-pick-btn ${cls}" data-opt="${escapeHtml(opt)}" ${pState.vivtAnswered ? "disabled" : ""}><span class="opt-key-hint">${idx + 1}.</span> ${escapeHtml(opt)}</button>`;
                  })
                  .join("")}
              </div>
              ${
                pState.vivtAnswered
                  ? `
                <div class="drill-feedback ${pState.vivtAnswered.ok ? "fb-ok" : "fb-err"}">
                  <div style="font-weight:800;font-size:0.95rem;margin-bottom:0.25rem;">
                    ${pState.vivtAnswered.ok ? "🎉 完全正确！" : `❌ 正确答案：${escapeHtml(q.answer)}`}
                  </div>
                  <div style="font-size:0.83rem;margin-bottom:0.55rem;">💡 ${escapeHtml(q.ruleTip)}</div>
                  <div style="display:flex;gap:0.45rem;flex-wrap:wrap;">
                    <button type="button" class="action-btn" id="btn-vivt-play-sent">🔊 朗读完整句</button>
                    <button type="button" class="action-btn primary-audio" id="btn-vivt-next">下一题 (Enter) →</button>
                  </div>
                </div>
              `
                  : ""
              }
            </div>
          `
              : ""
          }
        </div>
      `;
    }

    // --- SUB-MODE 3: VERB CONJUGATION DRILL ---
    else if (pState.subMode === "conj") {
      if (!pState.conjQuestion) generateConjQuestion();
      const q = pState.conjQuestion;
      const acc = pState.conjTotal ? Math.round((pState.conjCorrect / pState.conjTotal) * 100) : 0;

      stageHtml = `
        <div class="practice-stage-card">
          <div class="practice-toolbar-row">
            <div class="toggle-group">
              ${["all", "N5", "N4", "N3"]
                .map((l) => `<button type="button" class="toggle-chip ${pState.conjJlpt === l ? "active" : ""}" data-cjjlpt="${l}">${l === "all" ? "全级别" : l}</button>`)
                .join("")}
            </div>
            <div class="toggle-group">
              <select id="conj-form-select" class="lf-select" style="padding:0.28rem 0.55rem;font-size:0.78rem;">
                <option value="mixed" ${pState.conjForm === "mixed" ? "selected" : ""}>🎲 随机混合变形 (11种)</option>
                ${DRILL_FORMS.map((f) => `<option value="${f.key}" ${pState.conjForm === f.key ? "selected" : ""}>${f.label}</option>`).join("")}
              </select>
              <button type="button" class="toggle-chip ${pState.conjInputMode === "choice" ? "active" : ""}" data-cjmode="choice">🔘 四选一</button>
              <button type="button" class="toggle-chip ${pState.conjInputMode === "type" ? "active" : ""}" data-cjmode="type">⌨️ 拼写输入</button>
            </div>
          </div>

          <div class="drill-score-strip">
            <span>🔥 当前连对：<strong>${pState.conjStreak}</strong></span>
            <span>📊 正确率：<strong>${pState.conjCorrect} / ${pState.conjTotal}</strong> (${acc}%)</span>
          </div>

          <div class="drill-question-box">
            <div style="display:flex;justify-content:center;gap:0.4rem;flex-wrap:wrap;margin-bottom:0.45rem;">
              <span class="jlpt-pill jlpt-${q.verb.jlpt.toLowerCase()}">${q.verb.jlpt}</span>
              <span class="verb-group-pill grp-${q.verb.group}">${GROUP_LABELS[q.verb.group]}</span>
              <span class="verb-rank-pill">#${q.verb.rank}</span>
            </div>
            <div class="jp-text" lang="ja" style="font-size:1.75rem;text-align:center;margin:0.15rem 0;">${formatRuby(q.verb.jp)}</div>
            <div style="text-align:center;font-size:0.9rem;color:var(--text-secondary);margin-bottom:0.85rem;">
              中文：<strong>${escapeHtml(q.verb.cn)}</strong> (${escapeHtml(q.verb.romaji)})
            </div>
            <div class="drill-target-pill">
              🎯 请变成：<strong>${escapeHtml(q.formLabel)}</strong>
            </div>

            ${
              pState.conjInputMode === "choice"
                ? `
              <div class="quiz-options-grid">
                ${q.options
                  .map((opt, idx) => {
                    let cls = "";
                    if (pState.conjAnswered) {
                      if (opt === q.answerJp) cls = "opt-correct";
                      else if (opt === pState.conjAnswered.picked) cls = "opt-wrong";
                    }
                    return `<button type="button" class="quiz-opt-btn conj-choice-btn ${cls}" data-opt="${escapeHtml(opt)}" ${pState.conjAnswered ? "disabled" : ""}><span class="opt-key-hint">${idx + 1}.</span> ${escapeHtml(opt)}</button>`;
                  })
                  .join("")}
              </div>
            `
                : `
              <div class="conj-type-row">
                <input type="text" id="conj-type-input" class="tb-input" placeholder="输入汉字或纯假名（如：${escapeHtml(q.formKey === "te" ? "食べて / たべて" : "食べます / たべます")}）..." ${pState.conjAnswered ? "disabled" : ""} value="${pState.conjAnswered ? escapeHtml(pState.conjAnswered.picked) : ""}" />
                <button type="button" class="action-btn primary-audio" id="btn-conj-submit-type" ${pState.conjAnswered ? "disabled" : ""}>提交检查</button>
              </div>
            `
            }

            ${
              pState.conjAnswered
                ? `
              <div class="drill-feedback ${pState.conjAnswered.ok ? "fb-ok" : "fb-err"}">
                <div style="font-weight:800;font-size:0.95rem;margin-bottom:0.25rem;">
                  ${pState.conjAnswered.ok ? "🎉 正确！变形丝滑！" : `❌ 正确答案：${escapeHtml(q.answerJp)}（${escapeHtml(q.answerKana)}）`}
                </div>
                <div style="font-size:0.82rem;margin-bottom:0.5rem;">💡 ${escapeHtml(getConjugationRuleHint(q.verb, q.formKey))}</div>
                <div style="display:flex;gap:0.45rem;flex-wrap:wrap;">
                  <button type="button" class="action-btn" id="btn-conj-play-ans">🔊 听正确发音</button>
                  <button type="button" class="action-btn primary-audio" id="btn-conj-next">下一题 (Enter) →</button>
                </div>
              </div>
            `
                : ""
            }
          </div>
        </div>
      `;
    }

    // --- SUB-MODE 4: GRAMMAR, LISTENING & STAFF DECODER QUIZ ---
    else if (pState.subMode === "quiz") {
      if (!pState.quizQuestion || pState.quizQuestion.kind !== pState.quizKind) generateQuizQuestion();
      const q = pState.quizQuestion;
      const acc = pState.quizTotal ? Math.round((pState.quizCorrect / pState.quizTotal) * 100) : 0;

      stageHtml = `
        <div class="practice-stage-card">
          <div class="practice-toolbar-row">
            <div class="toggle-group">
              <button type="button" class="toggle-chip ${pState.quizKind === "grammar" ? "active" : ""}" data-qkind="grammar">🧩 N5–N3 语法填空</button>
              <button type="button" class="toggle-chip ${pState.quizKind === "listening" ? "active" : ""}" data-qkind="listening">👂 句意盲听挑战</button>
              <button type="button" class="toggle-chip ${pState.quizKind === "staff" ? "active" : ""}" data-qkind="staff">🏪 店员快语速听解</button>
            </div>
            ${
              pState.quizKind === "grammar"
                ? `<div class="toggle-group">
                    ${[
                      ["all", "全部题库"],
                      ["core", `📘 精讲${GRAMMAR.length}`],
                      ["video", `🎬 视频${VIDEO_GRAMMAR.length}`]
                    ]
                      .map(([k, lbl]) => `<button type="button" class="toggle-chip ${pState.quizSource === k ? "active" : ""}" data-qsrc="${k}">${lbl}</button>`)
                      .join("")}
                  </div>
                  <div class="toggle-group">
                    ${(pState.quizSource === "video" ? ["all", "N4", "N3"] : ["all", "N5", "N4", "N3"])
                      .map((l) => `<button type="button" class="toggle-chip ${pState.quizLevel === l ? "active" : ""}" data-qlvl="${l}">${l === "all" ? "全级别" : l}</button>`)
                      .join("")}
                  </div>`
                : ""
            }
          </div>

          <div class="drill-score-strip">
            <span>🔥 连对：<strong>${pState.quizStreak}</strong></span>
            <span>📊 正确率：<strong>${pState.quizCorrect} / ${pState.quizTotal}</strong> (${acc}%)</span>
          </div>

          ${
            q && q.kind === "grammar"
              ? `
            <div class="drill-question-box">
              <div style="display:flex;justify-content:center;gap:0.4rem;flex-wrap:wrap;margin-bottom:0.45rem;">
                <span class="jlpt-pill jlpt-${q.grammar.level.toLowerCase()}">${q.grammar.level}</span>
                ${
                  q.grammar.importanceLabel
                    ? `<span class="imp-pill imp-${q.grammar.importance}">${escapeHtml(q.grammar.importanceLabel)}</span>`
                    : `<span class="verb-rank-pill">🎬 视频 #${q.grammar.videoOrder} (${escapeHtml(q.grammar.timestampLabel || "")})</span>`
                }
              </div>
              <div class="jp-text" lang="ja" style="font-size:1.35rem;text-align:center;margin:0.35rem 0;">${formatRuby(q.promptJp)}</div>
              <div style="text-align:center;font-size:0.9rem;color:var(--accent-indigo);font-weight:700;margin-bottom:0.9rem;">
                🇨🇳 ${escapeHtml(q.cn)}
              </div>
              <div class="quiz-options-grid">
                ${q.options
                  .map((opt, idx) => {
                    let cls = "";
                    if (pState.quizAnswered) {
                      if (opt === q.answer) cls = "opt-correct";
                      else if (opt === pState.quizAnswered.picked) cls = "opt-wrong";
                    }
                    return `<button type="button" class="quiz-opt-btn main-quiz-pick ${cls}" data-opt="${escapeHtml(opt)}" ${pState.quizAnswered ? "disabled" : ""}><span class="opt-key-hint">${idx + 1}.</span> ${escapeHtml(opt)}</button>`;
                  })
                  .join("")}
              </div>
              ${
                pState.quizAnswered
                  ? `
                <div class="drill-feedback ${pState.quizAnswered.ok ? "fb-ok" : "fb-err"}">
                  <div style="font-weight:800;font-size:0.95rem;margin-bottom:0.25rem;">
                    ${pState.quizAnswered.ok ? "🎉 回答正确！" : `❌ 正确答案是「${escapeHtml(q.answer)}」`}
                  </div>
                  <div style="font-size:0.84rem;font-weight:700;margin-bottom:0.2rem;">📖 考点：${escapeHtml(q.grammar.pattern)} — ${escapeHtml(q.grammar.meaning)}</div>
                  <div style="font-size:0.8rem;margin-bottom:0.55rem;">📐 ${escapeHtml(q.grammar.formation)} ｜ ${escapeHtml(q.grammar.tip)}</div>
                  <div style="display:flex;gap:0.45rem;flex-wrap:wrap;">
                    <button type="button" class="action-btn" id="btn-quiz-play-sent">🔊 朗读完整句</button>
                    <button type="button" class="action-btn primary-audio" id="btn-quiz-next">下一题 (Enter) →</button>
                  </div>
                </div>
              `
                  : ""
              }
            </div>
          `
              : q && (q.kind === "listening" || q.kind === "staff")
              ? `
            <div class="drill-question-box">
              <div style="text-align:center;margin-bottom:0.75rem;">
                <span class="phrase-tag">${q.kind === "staff" ? escapeHtml(q.staff.scene) + " · 真实店员敬语" : escapeHtml(q.tag)}</span>
                <div style="font-size:2.3rem;margin:0.45rem 0 0.3rem;">${q.kind === "staff" ? "🏪" : "🎧"}</div>
                <div style="font-size:0.88rem;color:var(--text-secondary);margin-bottom:0.7rem;">
                  ${q.kind === "staff" ? "听一遍日本店员说的话，快速选出对方在问什么！" : "点击播放日语语音，选出最准确的中文意思！"}
                </div>
                <div style="display:flex;justify-content:center;gap:0.5rem;">
                  <button type="button" class="action-btn primary-audio" id="btn-listen-play-1x">🔊 常速播放 (R)</button>
                  <button type="button" class="action-btn" id="btn-listen-play-slow">🐢 慢速播放 (S)</button>
                </div>
              </div>
              <div class="quiz-options-grid" style="grid-template-columns:1fr;">
                ${q.options
                  .map((opt, idx) => {
                    let cls = "";
                    if (pState.quizAnswered) {
                      if (opt === q.answer) cls = "opt-correct";
                      else if (opt === pState.quizAnswered.picked) cls = "opt-wrong";
                    }
                    return `<button type="button" class="quiz-opt-btn main-quiz-pick ${cls}" data-opt="${escapeHtml(opt)}" ${pState.quizAnswered ? "disabled" : ""} style="text-align:left;"><span class="opt-key-hint">${idx + 1}.</span> ${escapeHtml(opt)}</button>`;
                  })
                  .join("")}
              </div>
              ${
                pState.quizAnswered
                  ? `
                <div class="drill-feedback ${pState.quizAnswered.ok ? "fb-ok" : "fb-err"}">
                  <div style="font-weight:800;margin-bottom:0.25rem;">${pState.quizAnswered.ok ? "🎉 听力满分！" : "❌ 再听一遍记住关键词！"}</div>
                  ${q.kind === "staff" ? `<div style="font-size:0.8rem;font-weight:800;color:var(--accent-red);margin-bottom:0.2rem;">🔑 抓关键词：${escapeHtml(q.staff.keyword)}</div>` : ""}
                  <div class="jp-text" lang="ja" style="font-size:1.05rem;margin:0.2rem 0;">${formatRuby(q.jp)}</div>
                  <div style="font-size:0.84rem;margin-bottom:0.45rem;">🇨🇳 ${escapeHtml(q.cn)}</div>
                  ${
                    q.kind === "staff"
                      ? `<div class="phrase-replies" style="margin:0.35rem 0 0.6rem;">
                          <div class="reply-label">✅ 我方 1 秒快答：</div>
                          <div class="reply-item">
                            <div>
                              <div class="reply-jp" lang="ja">${formatRuby(q.staff.replyJp)}</div>
                              <div class="reply-cn">${escapeHtml(q.staff.replyCn)}</div>
                            </div>
                            <button type="button" class="icon-btn" id="btn-staff-play-reply">🔊 听回答</button>
                          </div>
                        </div>`
                      : ""
                  }
                  <button type="button" class="action-btn primary-audio" id="btn-quiz-next">下一题 (Enter) →</button>
                </div>
              `
                  : ""
              }
            </div>
          `
              : ""
          }
        </div>
      `;
    }

    container.innerHTML = `
      <div class="learning-hero-card">
        <div class="learning-hero-top">
          <div>
            <h2 class="itin-section-title">🎯 日语实战训练场 & 个人学习仪表盘</h2>
            <p class="itin-section-sub">覆盖 N5 词汇、自他动词与助词、动词变形、N5–N3 语法与店员快语速盲听；开口跟读请前往顶部「🎙️ 口语跟读」专栏！</p>
          </div>
          <div class="dash-streak-badge">
            <div style="font-size:1.35rem;font-weight:900;">🔥 ${state.streak.count || 0} 天</div>
            <div style="font-size:0.72rem;opacity:0.9;">今日已完成 ${todayCount} 题/卡</div>
          </div>
        </div>

        <div class="dash-metrics-grid">
          <div class="dash-metric">
            <div class="dm-top"><span>🟢 N5核心词汇</span><strong>${n5Done} / ${n5All.length}</strong></div>
            <div class="progress-bar-track"><div class="progress-bar-fill" style="width:${n5All.length ? Math.round((n5Done / n5All.length) * 100) : 0}%;background:#059669;"></div></div>
          </div>
          <div class="dash-metric">
            <div class="dm-top"><span>⚡ 高频动词300</span><strong>${vDone} / ${VERBS.length}</strong></div>
            <div class="progress-bar-track"><div class="progress-bar-fill" style="width:${VERBS.length ? Math.round((vDone / VERBS.length) * 100) : 0}%;background:#0284c7;"></div></div>
          </div>
          <div class="dash-metric">
            <div class="dm-top"><span>📖 语法${GRAMMAR.length}</span><strong>${gDone} / ${GRAMMAR.length}</strong></div>
            <div class="progress-bar-track"><div class="progress-bar-fill" style="width:${GRAMMAR.length ? Math.round((gDone / GRAMMAR.length) * 100) : 0}%;background:#7c3aed;"></div></div>
          </div>
          <div class="dash-metric">
            <div class="dm-top"><span>🎬 视频语法${VIDEO_GRAMMAR.length}</span><strong>${vgDone} / ${VIDEO_GRAMMAR.length}</strong></div>
            <div class="progress-bar-track"><div class="progress-bar-fill" style="width:${VIDEO_GRAMMAR.length ? Math.round((vgDone / VIDEO_GRAMMAR.length) * 100) : 0}%;background:#2563eb;"></div></div>
          </div>
          <div class="dash-metric">
            <div class="dm-top"><span>🗣️ 场景短语</span><strong>${pDone} / ${allPhrases.length}</strong></div>
            <div class="progress-bar-track"><div class="progress-bar-fill" style="width:${allPhrases.length ? Math.round((pDone / allPhrases.length) * 100) : 0}%;"></div></div>
          </div>
          <div class="dash-metric">
            <div class="dm-top"><span>🎙️ 口语达标</span><strong style="color:${oralWeak > 0 ? "#d97706" : "var(--accent-emerald)"};">${oralPassed} 句 (≥80分)</strong></div>
            <div style="font-size:0.72rem;color:var(--text-muted);margin-top:0.2rem;">待复训薄弱句：${oralWeak} 句</div>
          </div>
          <div class="dash-metric">
            <div class="dm-top"><span>⏰ 闪卡待复习</span><strong style="color:${dueCount > 0 ? "var(--accent-red)" : "var(--accent-emerald)"};">${dueCount} 张</strong></div>
            <div style="font-size:0.72rem;color:var(--text-muted);margin-top:0.2rem;">SRS追踪：${Object.keys(state.srs || {}).length} 项</div>
          </div>
        </div>

        <div class="practice-subtabs scroll-fade-x">
          <button type="button" class="map-pill ${pState.subMode === "srs" ? "active" : ""}" data-psub="srs">🃏 间隔复习闪卡 (SRS)</button>
          <button type="button" class="map-pill ${pState.subMode === "vivt" ? "active" : ""}" data-psub="vivt">🔗 自他动词 & 助词战</button>
          <button type="button" class="map-pill ${pState.subMode === "conj" ? "active" : ""}" data-psub="conj">⚡ 动词变形闪电战</button>
          <button type="button" class="map-pill ${pState.subMode === "quiz" ? "active" : ""}" data-psub="quiz">🧩 语法 & 听力测验</button>
        </div>
      </div>

      ${stageHtml}
    `;

    // Bind Practice Subtabs
    container.querySelectorAll("[data-psub]").forEach((b) => {
      b.onclick = () => {
        stopShadowingLoop();
        pState.subMode = b.dataset.psub;
        renderPracticeView();
      };
    });

    // Bind SRS Flashcard Events
    container.querySelectorAll("[data-srsdeck]").forEach((b) => {
      b.onclick = () => {
        pState.srsDeck = b.dataset.srsdeck;
        if (pState.srsDeck === "video_grammar" && pState.srsJlpt === "N5") pState.srsJlpt = "all";
        pState.srsCurrentCard = null;
        pickNextSrsCard();
        renderPracticeView();
      };
    });
    container.querySelectorAll("[data-srsjlpt]").forEach((b) => {
      b.onclick = () => {
        pState.srsJlpt = b.dataset.srsjlpt;
        pState.srsCurrentCard = null;
        pickNextSrsCard();
        renderPracticeView();
      };
    });
    const btnLF = document.getElementById("btn-srs-listenfirst");
    if (btnLF) btnLF.onclick = () => { pState.srsListenFirst = !pState.srsListenFirst; renderPracticeView(); };
    const btnAP = document.getElementById("btn-srs-autoplay");
    if (btnAP) btnAP.onclick = () => { pState.srsAutoPlay = !pState.srsAutoPlay; renderPracticeView(); };
    const btnSwitchN5 = document.getElementById("btn-srs-switch-n5");
    if (btnSwitchN5) btnSwitchN5.onclick = () => { pState.srsDeck = "n5vocab"; pickNextSrsCard(); renderPracticeView(); };

    const cardBox = document.getElementById("srs-flashcard-box");
    if (cardBox && pState.srsCurrentCard) {
      cardBox.onclick = (e) => {
        if (e.target.closest("button")) return;
        pState.srsFlipped = !pState.srsFlipped;
        renderPracticeView();
        if (pState.srsFlipped && pState.srsAutoPlay && pState.srsCurrentCard) {
          speakJapanese(pState.srsCurrentCard.audioText, 1.0, null, null, pState.srsCurrentCard.audioKey);
        }
      };
    }
    const btnFlip = document.getElementById("btn-fc-flip");
    if (btnFlip) {
      btnFlip.onclick = () => {
        pState.srsFlipped = true;
        renderPracticeView();
        if (pState.srsAutoPlay && pState.srsCurrentCard) {
          speakJapanese(pState.srsCurrentCard.audioText, 1.0, null, null, pState.srsCurrentCard.audioKey);
        }
      };
    }
    const btnFc1 = document.getElementById("btn-fc-speak-1x");
    if (btnFc1 && pState.srsCurrentCard) btnFc1.onclick = function () { speakJapanese(pState.srsCurrentCard.audioText, 1.0, this, null, pState.srsCurrentCard.audioKey); };
    const btnFcSlow = document.getElementById("btn-fc-speak-slow");
    if (btnFcSlow && pState.srsCurrentCard) btnFcSlow.onclick = function () { speakJapanese(pState.srsCurrentCard.audioText, 0.78, this, null, pState.srsCurrentCard.audioKey); };
    const btnFcFront = document.getElementById("btn-fc-play-front");
    if (btnFcFront && pState.srsCurrentCard) btnFcFront.onclick = function () { speakJapanese(pState.srsCurrentCard.audioText, 1.0, this, null, pState.srsCurrentCard.audioKey); };
    const btnFcEx = document.getElementById("btn-fc-play-ex");
    if (btnFcEx && pState.srsCurrentCard && pState.srsCurrentCard.exampleJp) btnFcEx.onclick = function () { speakJapanese(pState.srsCurrentCard.exampleJp, 1.0, this); };
    const btnAgain = document.getElementById("btn-srs-again");
    if (btnAgain) btnAgain.onclick = () => rateSrsCard("again");
    const btnHard = document.getElementById("btn-srs-hard");
    if (btnHard) btnHard.onclick = () => rateSrsCard("hard");
    const btnGood = document.getElementById("btn-srs-good");
    if (btnGood) btnGood.onclick = () => rateSrsCard("good");

    // Bind Vi/Vt & Particle Blitz Events
    container.querySelectorAll("[data-vivtkind]").forEach((b) => {
      b.onclick = () => { pState.vivtKind = b.dataset.vivtkind; generateViVtQuestion(); renderPracticeView(); };
    });
    container.querySelectorAll(".vivt-pick-btn").forEach((b) => {
      b.onclick = () => {
        const q = pState.vivtQuestion;
        if (!q || pState.vivtAnswered) return;
        const ok = b.dataset.opt === q.answer;
        pState.vivtAnswered = { picked: b.dataset.opt, ok };
        pState.vivtTotal++;
        if (ok) { pState.vivtCorrect++; pState.vivtStreak++; recordStudyActivity(1); }
        else { pState.vivtStreak = 0; }
        speakJapanese(q.promptJp.replace("＿＿", q.answer), 1.0);
        renderPracticeView();
      };
    });
    const btnVivtPlay = document.getElementById("btn-vivt-play-sent");
    if (btnVivtPlay && pState.vivtQuestion) {
      btnVivtPlay.onclick = function () {
        speakJapanese(pState.vivtQuestion.promptJp.replace("＿＿", pState.vivtQuestion.answer), 1.0, this);
      };
    }
    const btnVivtNext = document.getElementById("btn-vivt-next");
    if (btnVivtNext) btnVivtNext.onclick = () => { generateViVtQuestion(); renderPracticeView(); };

    // Bind Conjugation Drill Events
    container.querySelectorAll("[data-cjjlpt]").forEach((b) => {
      b.onclick = () => { pState.conjJlpt = b.dataset.cjjlpt; generateConjQuestion(); renderPracticeView(); };
    });
    container.querySelectorAll("[data-cjmode]").forEach((b) => {
      b.onclick = () => { pState.conjInputMode = b.dataset.cjmode; generateConjQuestion(); renderPracticeView(); };
    });
    const cjSel = document.getElementById("conj-form-select");
    if (cjSel) cjSel.onchange = (e) => { pState.conjForm = e.target.value; generateConjQuestion(); renderPracticeView(); };

    function checkConjAnswer(pickedRaw) {
      const q = pState.conjQuestion;
      if (!q || pState.conjAnswered) return;
      const clean = pickedRaw.trim();
      const ok = clean === q.answerJp || clean === q.answerKana;
      pState.conjAnswered = { picked: clean, ok };
      pState.conjTotal++;
      if (ok) { pState.conjCorrect++; pState.conjStreak++; recordStudyActivity(1); }
      else { pState.conjStreak = 0; }
      speakJapanese(q.answerJp || q.answerKana, 1.0);
      renderPracticeView();
    }

    container.querySelectorAll(".conj-choice-btn").forEach((b) => { b.onclick = () => checkConjAnswer(b.dataset.opt); });
    const btnSubmitType = document.getElementById("btn-conj-submit-type");
    const typeInput = document.getElementById("conj-type-input");
    if (btnSubmitType && typeInput) {
      btnSubmitType.onclick = () => { if (typeInput.value.trim()) checkConjAnswer(typeInput.value); };
      typeInput.onkeydown = (e) => { if (e.key === "Enter" && typeInput.value.trim()) checkConjAnswer(typeInput.value); };
    }
    const btnCjPlay = document.getElementById("btn-conj-play-ans");
    if (btnCjPlay && pState.conjQuestion) btnCjPlay.onclick = function () { speakJapanese(pState.conjQuestion.answerJp || pState.conjQuestion.answerKana, 1.0, this); };
    const btnCjNext = document.getElementById("btn-conj-next");
    if (btnCjNext) btnCjNext.onclick = () => { generateConjQuestion(); renderPracticeView(); };

    // Bind Grammar, Listening & Staff Quiz Events
    container.querySelectorAll("[data-qkind]").forEach((b) => {
      b.onclick = () => {
        pState.quizKind = b.dataset.qkind;
        generateQuizQuestion();
        renderPracticeView();
        if ((pState.quizKind === "listening" || pState.quizKind === "staff") && pState.quizQuestion) {
          setTimeout(() => speakJapanese(pState.quizQuestion.jp, 1.0, null, null, pState.quizQuestion.audioKey), 150);
        }
      };
    });
    container.querySelectorAll("[data-qsrc]").forEach((b) => {
      b.onclick = () => {
        pState.quizSource = b.dataset.qsrc;
        if (pState.quizSource === "video" && pState.quizLevel === "N5") pState.quizLevel = "all";
        generateQuizQuestion();
        renderPracticeView();
      };
    });
    container.querySelectorAll("[data-qlvl]").forEach((b) => {
      b.onclick = () => { pState.quizLevel = b.dataset.qlvl; generateQuizQuestion(); renderPracticeView(); };
    });
    container.querySelectorAll(".main-quiz-pick").forEach((b) => {
      b.onclick = () => {
        const q = pState.quizQuestion;
        if (!q || pState.quizAnswered) return;
        const ok = b.dataset.opt === q.answer;
        pState.quizAnswered = { picked: b.dataset.opt, ok };
        pState.quizTotal++;
        if (ok) { pState.quizCorrect++; pState.quizStreak++; recordStudyActivity(1); }
        else { pState.quizStreak = 0; }
        if (q.kind === "grammar") {
          speakJapanese(q.promptJp.replace("＿＿", q.answer), 1.0);
        }
        renderPracticeView();
      };
    });
    const btnQuizSent = document.getElementById("btn-quiz-play-sent");
    if (btnQuizSent && pState.quizQuestion && pState.quizQuestion.kind === "grammar") {
      btnQuizSent.onclick = function () { speakJapanese(pState.quizQuestion.promptJp.replace("＿＿", pState.quizQuestion.answer), 1.0, this); };
    }
    const btnL1 = document.getElementById("btn-listen-play-1x");
    if (btnL1 && pState.quizQuestion) btnL1.onclick = function () { speakJapanese(pState.quizQuestion.jp, 1.0, this, null, pState.quizQuestion.audioKey); };
    const btnLSlow = document.getElementById("btn-listen-play-slow");
    if (btnLSlow && pState.quizQuestion) btnLSlow.onclick = function () { speakJapanese(pState.quizQuestion.jp, 0.78, this, null, pState.quizQuestion.audioKey); };
    const btnStaffReply = document.getElementById("btn-staff-play-reply");
    if (btnStaffReply && pState.quizQuestion && pState.quizQuestion.staff) {
      btnStaffReply.onclick = function () { speakJapanese(pState.quizQuestion.staff.replyJp, 1.0, this); };
    }
    const btnQNext = document.getElementById("btn-quiz-next");
    if (btnQNext) {
      btnQNext.onclick = () => {
        generateQuizQuestion();
        renderPracticeView();
        if ((pState.quizKind === "listening" || pState.quizKind === "staff") && pState.quizQuestion) {
          setTimeout(() => speakJapanese(pState.quizQuestion.jp, 1.0, null, null, pState.quizQuestion.audioKey), 150);
        }
      };
    }
  }

  // Desktop Practice Keyboard Shortcuts
  document.addEventListener("keydown", (e) => {
    const a = app();
    if (!a || !a.state || a.state.appMode !== "practice") return;
    const modal = document.getElementById("app-modal");
    if (modal && modal.classList.contains("open")) return;
    const tag = (e.target && e.target.tagName) || "";
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (e.target && e.target.isContentEditable)) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    if (pState.subMode === "srs" && pState.srsCurrentCard) {
      if (e.code === "Space") {
        e.preventDefault();
        pState.srsFlipped = !pState.srsFlipped;
        renderPracticeView();
        if (pState.srsFlipped && pState.srsAutoPlay && pState.srsCurrentCard) {
          a.speakJapanese(pState.srsCurrentCard.audioText, 1.0, null, null, pState.srsCurrentCard.audioKey);
        }
      } else if (e.key === "r" || e.key === "R") {
        a.speakJapanese(pState.srsCurrentCard.audioText, 1.0, null, null, pState.srsCurrentCard.audioKey);
      } else if (e.key === "s" || e.key === "S") {
        a.speakJapanese(pState.srsCurrentCard.audioText, 0.78, null, null, pState.srsCurrentCard.audioKey);
      } else if (pState.srsFlipped && e.key === "1") {
        rateSrsCard("again");
      } else if (pState.srsFlipped && e.key === "2") {
        rateSrsCard("hard");
      } else if (pState.srsFlipped && e.key === "3") {
        rateSrsCard("good");
      }
      return;
    }

    if (pState.subMode === "vivt" || pState.subMode === "conj" || pState.subMode === "quiz") {
      if (e.key === "1" || e.key === "2" || e.key === "3" || e.key === "4") {
        const idx = Number(e.key) - 1;
        const selector = pState.subMode === "vivt" ? ".vivt-pick-btn" : pState.subMode === "conj" ? ".conj-choice-btn" : ".main-quiz-pick";
        const btns = document.querySelectorAll(selector);
        if (btns[idx] && !btns[idx].disabled) btns[idx].click();
      } else if (e.key === "Enter" || e.key === "ArrowRight") {
        const nextId = pState.subMode === "vivt" ? "btn-vivt-next" : pState.subMode === "conj" ? "btn-conj-next" : "btn-quiz-next";
        const nextBtn = document.getElementById(nextId);
        if (nextBtn) { e.preventDefault(); nextBtn.click(); }
      } else if ((e.key === "r" || e.key === "R") && pState.subMode === "quiz" && pState.quizQuestion && (pState.quizKind === "listening" || pState.quizKind === "staff")) {
        a.speakJapanese(pState.quizQuestion.jp, 1.0, null, null, pState.quizQuestion.audioKey);
      } else if ((e.key === "s" || e.key === "S") && pState.subMode === "quiz" && pState.quizQuestion && (pState.quizKind === "listening" || pState.quizKind === "staff")) {
        a.speakJapanese(pState.quizQuestion.jp, 0.78, null, null, pState.quizQuestion.audioKey);
      }
    }
  });

  // Register global renderer
  window.JP_LEARNING = {
    renderMode(mode) {
      if (mode === "verbs") renderVerbsView();
      else if (mode === "grammar") renderGrammarView();
      else if (mode === "practice") renderPracticeView();
    },
    openOralRoleplay(dlgId) {
      if (window.JP_ORAL_COACH) {
        window.JP_ORAL_COACH.openRoleplayDialogue(dlgId);
      }
      app().switchAppMode("oral");
    }
  };
})();
