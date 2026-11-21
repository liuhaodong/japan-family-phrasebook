// Interactive Japanese Learning Engine:
// 1. Top 200 High-Frequency Verbs & Conjugations (#verbs-view-container)
// 2. JLPT N5 / N4 / N3 Grammar Guide Ordered by Importance (#grammar-view-container)
// 3. Interactive Practice Lab: SRS Flashcards, Conjugation Drill, Grammar & Listening Quiz, Shadowing (#practice-view-container)
(function () {
  const VERBS = window.JP_TOP_VERBS || [];
  const GRAMMAR = window.JP_GRAMMAR_LIST || [];

  const GROUP_LABELS = {
    godan: "五段 (u-verb)",
    ichidan: "一段 (ru-verb)",
    irregular: "不规则"
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
    { key: "causative", label: "使役形", sub: "让做" }
  ];

  // Local view states for the 3 learning tabs
  const vState = {
    search: "",
    jlpt: "all",
    group: "all",
    category: "all",
    status: "all",
    range: "1-50", // '1-50' | '51-100' | '101-150' | '151-200' | 'all'
    showCheatSheet: false
  };

  const gState = {
    search: "",
    level: "all", // 'all' | 'N5' | 'N4' | 'N3'
    importance: "all", // 'all' | '5' | '4' | '3'
    status: "all",
    orderMode: "n5_first", // 'n5_first' | 'n3_first' | 'importance_all'
    openQuizIds: {}
  };

  const pState = {
    subMode: "srs", // 'srs' | 'conj' | 'quiz' | 'shadow'
    // SRS Flashcards
    srsDeck: "verbs", // 'due' | 'verbs' | 'grammar' | 'phrases' | 'starred'
    srsJlpt: "all",
    srsListenFirst: false,
    srsAutoPlay: true,
    srsFlipped: false,
    srsCurrentCard: null,
    // Conjugation Drill
    conjJlpt: "all",
    conjForm: "mixed", // 'mixed' | 'te' | 'masu' | 'nai' | 'ta' | 'tai' | 'potential' | 'volitional'
    conjInputMode: "choice", // 'choice' | 'type'
    conjQuestion: null,
    conjAnswered: null,
    conjStreak: 0,
    conjCorrect: 0,
    conjTotal: 0,
    // Grammar & Listening Quiz
    quizKind: "grammar", // 'grammar' | 'listening'
    quizLevel: "all",
    quizQuestion: null,
    quizAnswered: null,
    quizStreak: 0,
    quizCorrect: 0,
    quizTotal: 0,
    // Shadowing
    shadowDeck: "phrases", // 'phrases' | 'verbs' | 'grammar'
    shadowIndex: 0,
    shadowRunning: false,
    shadowPhase: "",
    shadowTimer: null,
    shadowTranscript: "",
    shadowScore: null
  };

  function app() {
    return window.JP_APP;
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

  // Explain conjugation rule concisely for drill feedback
  function getConjugationRuleHint(verb, formKey) {
    if (verb.group === "irregular") {
      if (verb.dict.endsWith("する")) return "サ变动词「〜する」：します / して / した / しない / できる / しよう";
      return "カ变动词「来る（くる）」：きます / きて / きた / こない / こられる / こよう";
    }
    if (verb.group === "ichidan") {
      return "一段动词（ru-verb）：直接去掉末尾「る」再接 ます / て / た / ない / たい / られる / よう！";
    }
    const last = verb.dict.slice(-1);
    if (verb.dict === "行く" && (formKey === "te" || formKey === "ta")) {
      return "⚠️ 五段特例：「行く」的て/た形不是いいて，而是促音变「行って / 行った」！";
    }
    if (verb.dict === "ある" && formKey === "nai") {
      return "⚠️ 特例：「ある」的否定不是あらない，而是直接用「ない」！";
    }
    if (formKey === "te" || formKey === "ta") {
      if ("うつる".includes(last)) return `五段「う・つ・る」音变 → 促音「って / った」`;
      if ("むぶぬ".includes(last)) return `五段「む・ぶ・ぬ」音变 → 拨音「んで / んだ」`;
      if (last === "く") return `五段「く」音变 →「いて / いた」`;
      if (last === "ぐ") return `五段「ぐ」音变 →「いで / いだ」`;
      if (last === "す") return `五段「す」音变 →「して / した」`;
    }
    if (formKey === "masu" || formKey === "tai") return `五段动词把词尾「${last}」移到同行的い段，再接 ます / たい`;
    if (formKey === "nai") return `五段动词把词尾「${last}」移到同行的あ段（う→わ），再接 ない`;
    if (formKey === "potential") return `五段动词把词尾「${last}」移到同行的え段，再接 る`;
    if (formKey === "volitional") return `五段动词把词尾「${last}」移到同行的お段，再接 う`;
    return `五段动词变形规则（词尾：${last}）`;
  }

  // =========================================================================
  // TAB 3: TOP 200 HIGH-FREQUENCY JAPANESE VERBS
  // =========================================================================
  function openVerbConjugationModal(verbId) {
    const verb = VERBS.find((v) => v.id === verbId);
    if (!verb) return;
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
        <div style="display:flex;align-items:center;gap:0.45rem;flex-wrap:wrap;margin-bottom:0.35rem;">
          <span class="jlpt-pill jlpt-${verb.jlpt.toLowerCase()}">${verb.jlpt}</span>
          <span class="verb-rank-pill">#${verb.rank}</span>
          <span class="verb-group-pill grp-${verb.group}">${GROUP_LABELS[verb.group]}</span>
          <span class="phrase-tag">${escapeHtml(verb.category)}</span>
        </div>
        <div style="display:flex;align-items:center;justify-content:space-between;gap:0.75rem;flex-wrap:wrap;margin-bottom:0.4rem;">
          <div>
            <div class="jp-text" style="font-size:1.55rem;margin:0;">${formatRuby(verb.jp)}</div>
            <div style="font-size:0.9rem;color:var(--accent-indigo);font-weight:700;">
              ${escapeHtml(verb.cn)} <span style="color:var(--text-muted);font-weight:500;">(${escapeHtml(verb.kana)} · ${escapeHtml(verb.romaji)})</span>
            </div>
          </div>
          <div style="display:flex;gap:0.4rem;">
            <button type="button" class="action-btn primary-audio modal-v-speak" data-jp="${escapeHtml(verb.kana)}">🔊 读原形</button>
            <button type="button" class="action-btn modal-v-speak-slow" data-jp="${escapeHtml(verb.kana)}">🐢 慢读</button>
          </div>
        </div>
        <div class="tb-rule-banner" style="margin:0.6rem 0;">
          💡 ${escapeHtml(getConjugationRuleHint(verb, "te"))}
        </div>

        <h3 style="font-size:0.92rem;font-weight:800;margin:0.8rem 0 0.45rem;">📐 全套核心变形表（点击任意格朗读）</h3>
        <div class="conj-modal-grid">
          ${FORM_META.map((fm) => {
            const f = verb.forms[fm.key];
            const disabled = !f || f.jp.startsWith("—");
            return `
              <button type="button" class="conj-modal-cell ${disabled ? "disabled" : "modal-v-speak"}" ${disabled ? "disabled" : `data-jp="${escapeHtml(f.kana || f.jp)}"`}>
                <div class="conj-cell-label">${fm.label} <span>${fm.sub}</span></div>
                <div class="conj-cell-jp">${escapeHtml(f ? f.jp : "—")}</div>
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
                <div style="font-size:0.95rem;font-weight:800;color:var(--text-primary);">${escapeHtml(dp.jp)}</div>
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
      btn.onclick = function () {
        speakJapanese(this.dataset.jp, 1.0, this);
      };
    });
    body.querySelectorAll(".modal-v-speak-slow").forEach((btn) => {
      btn.onclick = function () {
        speakJapanese(this.dataset.jp, 0.78, this);
      };
    });
  }

  function renderVerbsView() {
    const container = document.getElementById("verbs-view-container");
    if (!container) return;
    const { state, formatRuby, escapeHtml, speakJapanese, toggleStar, toggleMastered, openStaffCard, switchAppMode } = app();

    const masteredCount = VERBS.filter((v) => state.mastered[v.id]).length;
    const pct = VERBS.length ? Math.round((masteredCount / VERBS.length) * 100) : 0;
    const categories = ["all", ...Array.from(new Set(VERBS.map((v) => v.category)))];

    const q = vState.search.trim().toLowerCase();
    const filtered = VERBS.filter((v) => {
      if (vState.jlpt !== "all" && v.jlpt !== vState.jlpt) return false;
      if (vState.group !== "all" && v.group !== vState.group) return false;
      if (vState.category !== "all" && v.category !== vState.category) return false;
      if (vState.status === "starred" && !state.starred[v.id]) return false;
      if (vState.status === "mastered" && !state.mastered[v.id]) return false;
      if (vState.status === "unmastered" && state.mastered[v.id]) return false;
      if (q) {
        const exText = v.examples.map((e) => `${e.jp} ${e.romaji} ${e.cn}`).join(" ");
        const formText = Object.values(v.forms).map((f) => `${f.jp} ${f.kana}`).join(" ");
        const hay = `${v.rank} ${v.dict} ${v.kana} ${v.romaji} ${v.cn} ${v.category} ${v.jlpt} ${formText} ${exText}`.toLowerCase();
        return hay.includes(q);
      }
      if (vState.jlpt === "all" && vState.group === "all" && vState.category === "all" && vState.status === "all" && vState.range !== "all") {
        const [lo, hi] = vState.range.split("-").map(Number);
        return v.rank >= lo && v.rank <= hi;
      }
      return true;
    });

    const isFilteredActive = q || vState.jlpt !== "all" || vState.group !== "all" || vState.category !== "all" || vState.status !== "all";

    container.innerHTML = `
      <!-- Top Summary & Progress Banner -->
      <div class="learning-hero-card">
        <div class="learning-hero-top">
          <div>
            <h2 class="itin-section-title">⚡ 日语最高频 Top 200 动词 · 常用变形与 400 句日常例句</h2>
            <p class="itin-section-sub">按真实生活出现频率排序 (#1–#200)，覆盖 N5/N4/N3 核心动词；点击任意变形标签或例句均可一键真人语速/慢速跟读！</p>
          </div>
          <div style="display:flex;gap:0.45rem;flex-wrap:wrap;">
            <button type="button" class="action-btn ${vState.showCheatSheet ? "primary-audio" : ""}" id="btn-toggle-conj-sheet">
              📐 ${vState.showCheatSheet ? "收起变形口诀" : "动词变形黄金口诀"}
            </button>
            <button type="button" class="action-btn primary-audio" id="btn-jump-conj-drill">
              ⚡ 去练动词变形闪电战 →
            </button>
          </div>
        </div>

        <div class="learning-progress-row">
          <div class="progress-text-meta">
            <span>🎯 动词掌握进度：<strong>${masteredCount} / ${VERBS.length}</strong> (${pct}%)</span>
            <span>当前筛选显示：<strong>${filtered.length}</strong> 个动词</span>
          </div>
          <div class="progress-bar-track"><div class="progress-bar-fill" style="width:${pct}%;"></div></div>
        </div>

        ${
          vState.showCheatSheet
            ? `
          <div class="conj-cheatsheet-box">
            <div class="cheat-col">
              <div class="cheat-col-title">🔵 五段动词 (u-verb · 113个)</div>
              <ul>
                <li><strong>ます形 / たい形：</strong>词尾 u段 → <strong>i段</strong> ＋ ます / たい（書く→書きます）</li>
                <li><strong>て形 / た形（音变口诀）：</strong>
                  <br>• <code>う・つ・る</code> → <strong>って / った</strong>（買う→買って）
                  <br>• <code>む・ぶ・ぬ</code> → <strong>んで / んだ</strong>（飲む→飲んで）
                  <br>• <code>く</code> → <strong>いて / いた</strong>（書く→書いて；⚠️ <strong>行く→行って</strong>）
                  <br>• <code>ぐ</code> → <strong>いで / いだ</strong>（急ぐ→急いで）
                  <br>• <code>す</code> → <strong>して / した</strong>（話す→話して）
                </li>
                <li><strong>ない形：</strong>词尾 u段 → <strong>a段</strong> ＋ ない（う→わ；⚠️ <strong>ある→ない</strong>）</li>
                <li><strong>可能形：</strong>词尾 u段 → <strong>e段</strong> ＋ る（話す→話せる）</li>
              </ul>
            </div>
            <div class="cheat-col">
              <div class="cheat-col-title">🟢 一段动词 (ru-verb · 58个)</div>
              <ul>
                <li>特点：以 <code>い段/え段 + る</code> 结尾（例：食べる、見る、起きる）。</li>
                <li><strong>超级简单：直接去「る」</strong>再接对应词尾！
                  <br>• ます形：去る＋<strong>ます</strong>（食べます）
                  <br>• て/た形：去る＋<strong>て / た</strong>（食べて / 食べた）
                  <br>• ない形：去る＋<strong>ない</strong>（食べない）
                  <br>• 可能形：去る＋<strong>られる</strong>（食べられる）
                  <br>• 意向形：去る＋<strong>よう</strong>（食べよう）
                </li>
                <li>⚠️ 注意少数伪一段五段动词：<code>帰る・走る・入る・切る・知る・減る</code> 都是五段！</li>
              </ul>
            </div>
            <div class="cheat-col">
              <div class="cheat-col-title">🟣 不规则动词 (29个)</div>
              <ul>
                <li><strong>する（做）</strong>及所有 <code>汉字+する</code>（勉強する、予約する等）：
                  <br>します / して / した / しない / したい / <strong>できる</strong> / しよう</li>
                <li><strong>来る（くる · 来）：</strong>
                  <br>来ます(きます) / 来て(きて) / 来た(きた) / 来ない(こない) / 来られる(こられる) / 来よう(こよう)</li>
              </ul>
            </div>
          </div>
        `
            : ""
        }
      </div>

      <!-- Filter Bar -->
      <div class="learning-filter-card">
        <div class="lf-row-top">
          <div class="search-box" style="flex:1 1 240px;">
            <span class="search-icon">🔍</span>
            <input type="text" id="verb-search-input" value="${escapeHtml(vState.search)}" placeholder="搜动词汉字、假名、罗马音、中文或变形（如：食べる、taberu、行って、预订）..." />
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
              .map(
                (lvl) => `
              <button type="button" class="toggle-chip ${vState.jlpt === lvl ? "active" : ""}" data-vjlpt="${lvl}">
                ${lvl === "all" ? "全部级别" : lvl}
              </button>
            `
              )
              .join("")}
          </div>
          <div class="toggle-group">
            ${[
              ["all", "📚 全部"],
              ["unmastered", "⏳ 未掌握"],
              ["mastered", "✅ 已掌握"],
              ["starred", "⭐ 收藏"]
            ]
              .map(
                ([k, lbl]) => `
              <button type="button" class="toggle-chip ${vState.status === k ? "active" : ""}" data-vstatus="${k}">${lbl}</button>
            `
              )
              .join("")}
          </div>
        </div>

        ${
          !isFilteredActive
            ? `
          <div class="lf-range-row">
            <span style="font-size:0.75rem;font-weight:700;color:var(--text-muted);">高频分段：</span>
            ${[
              ["1-50", "🔥 Top 1–50 (最核心)"],
              ["51-100", "⭐ Top 51–100 (日常高频)"],
              ["101-150", "📘 Top 101–150 (旅行生活)"],
              ["151-200", "💎 Top 151–200 (进阶流利)"],
              ["all", "📋 展开全部 200"]
            ]
              .map(
                ([rk, rlbl]) => `
              <button type="button" class="map-pill ${vState.range === rk ? "active" : ""}" data-vrange="${rk}">${rlbl}</button>
            `
              )
              .join("")}
          </div>
        `
            : ""
        }
      </div>

      <!-- Verb Cards Grid -->
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
                  const top6 = FORM_META.slice(0, 6);
                  return `
                  <article class="verb-card ${isMast ? "mastered" : ""} ${isStar ? "starred" : ""}">
                    <div class="verb-card-head">
                      <div class="verb-badges">
                        <span class="verb-rank-pill">#${v.rank}</span>
                        <span class="jlpt-pill jlpt-${v.jlpt.toLowerCase()}">${v.jlpt}</span>
                        <span class="verb-group-pill grp-${v.group}">${GROUP_LABELS[v.group]}</span>
                        <span class="phrase-tag">${escapeHtml(v.category)}</span>
                      </div>
                      <div class="phrase-status-btns">
                        <button type="button" class="icon-btn ${isStar ? "starred-active" : ""}" data-vstar="${v.id}">${isStar ? "⭐" : "☆"}</button>
                        <button type="button" class="icon-btn ${isMast ? "mastered-active" : ""}" data-vmaster="${v.id}">${isMast ? "✅ 已掌握" : "○ 掌握"}</button>
                      </div>
                    </div>

                    <div class="verb-main-row">
                      <div style="flex:1;min-width:170px;">
                        <div class="jp-text verb-jp-title">${formatRuby(v.jp)}</div>
                        <div class="romaji-text" style="margin-bottom:0.12rem;">${escapeHtml(v.kana)} · ${escapeHtml(v.romaji)}</div>
                        <div class="cn-text" style="margin-bottom:0;">${escapeHtml(v.cn)}</div>
                      </div>
                      <div style="display:flex;gap:0.35rem;flex-wrap:wrap;align-items:center;">
                        <button type="button" class="action-btn primary-audio v-speak-btn" data-jp="${escapeHtml(v.kana)}">🔊 朗读</button>
                        <button type="button" class="action-btn v-speak-slow-btn" data-jp="${escapeHtml(v.kana)}">🐢</button>
                        <button type="button" class="action-btn v-allforms-btn" data-vid="${v.id}">📋 11种变形</button>
                      </div>
                    </div>

                    <!-- 6 Most Frequently Used Forms (Tap any to speak!) -->
                    <div class="verb-forms-strip">
                      ${top6
                        .map((fm) => {
                          const f = v.forms[fm.key];
                          const disabled = !f || f.jp.startsWith("—");
                          return `
                          <button type="button" class="verb-form-chip ${disabled ? "disabled" : "v-speak-btn"}" ${disabled ? "disabled" : `data-jp="${escapeHtml(f.kana || f.jp)}"`} title="点击听「${fm.label}」发音">
                            <span class="vf-lbl">${fm.label}</span>
                            <span class="vf-val">${escapeHtml(f ? f.jp : "—")}</span>
                          </button>
                        `;
                        })
                        .join("")}
                    </div>

                    <!-- 2 Daily Example Sentences -->
                    <div class="verb-examples-list">
                      ${v.examples
                        .map(
                          (ex) => `
                        <div class="verb-example-item">
                          <div style="flex:1;min-width:0;">
                            <div class="vex-top">
                              <span class="vex-form-badge">${escapeHtml(ex.form)}</span>
                            </div>
                            <div class="jp-text vex-jp">${formatRuby(ex.jp)}</div>
                            <div class="romaji-text" style="margin-bottom:0.15rem;">${escapeHtml(ex.romaji)}</div>
                            <div class="cn-text" style="font-size:0.84rem;margin-bottom:0;">${escapeHtml(ex.cn)}</div>
                          </div>
                          <div class="vex-btns">
                            <button type="button" class="icon-btn v-speak-btn" data-jp="${escapeHtml(ex.jp)}" title="常速朗读">🔊</button>
                            <button type="button" class="icon-btn v-speak-slow-btn" data-jp="${escapeHtml(ex.jp)}" title="慢速跟读">🐢</button>
                            <button type="button" class="icon-btn v-staff-btn" data-jp="${escapeHtml(ex.jp)}" data-cn="${escapeHtml(ex.cn)}" data-tag="动词 #${v.rank} ${escapeHtml(v.dict)} · ${escapeHtml(ex.form)}" title="大字出示卡">📱</button>
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

    // Bind Verb View Events
    const toggleSheet = document.getElementById("btn-toggle-conj-sheet");
    if (toggleSheet) {
      toggleSheet.onclick = () => {
        vState.showCheatSheet = !vState.showCheatSheet;
        renderVerbsView();
      };
    }
    const jumpDrill = document.getElementById("btn-jump-conj-drill");
    if (jumpDrill) {
      jumpDrill.onclick = () => {
        pState.subMode = "conj";
        pState.conjQuestion = null;
        switchAppMode("practice");
      };
    }
    const searchEl = document.getElementById("verb-search-input");
    if (searchEl) {
      searchEl.oninput = (e) => {
        vState.search = e.target.value;
        const pos = e.target.selectionStart;
        renderVerbsView();
        const next = document.getElementById("verb-search-input");
        if (next) {
          next.focus();
          next.setSelectionRange(pos, pos);
        }
      };
    }
    const searchClr = document.getElementById("verb-search-clear");
    if (searchClr) {
      searchClr.onclick = () => {
        vState.search = "";
        renderVerbsView();
      };
    }
    const catSel = document.getElementById("verb-cat-select");
    if (catSel) catSel.onchange = (e) => { vState.category = e.target.value; renderVerbsView(); };
    const grpSel = document.getElementById("verb-group-select");
    if (grpSel) grpSel.onchange = (e) => { vState.group = e.target.value; renderVerbsView(); };

    container.querySelectorAll("[data-vjlpt]").forEach((b) => {
      b.onclick = () => { vState.jlpt = b.dataset.vjlpt; renderVerbsView(); };
    });
    container.querySelectorAll("[data-vstatus]").forEach((b) => {
      b.onclick = () => { vState.status = b.dataset.vstatus; renderVerbsView(); };
    });
    container.querySelectorAll("[data-vrange]").forEach((b) => {
      b.onclick = () => { vState.range = b.dataset.vrange; renderVerbsView(); };
    });
    container.querySelectorAll("[data-vstar]").forEach((b) => {
      b.onclick = () => toggleStar(b.dataset.vstar);
    });
    container.querySelectorAll("[data-vmaster]").forEach((b) => {
      b.onclick = () => toggleMastered(b.dataset.vmaster);
    });
    container.querySelectorAll(".v-speak-btn").forEach((b) => {
      b.onclick = function () { speakJapanese(this.dataset.jp, 1.0, this); };
    });
    container.querySelectorAll(".v-speak-slow-btn").forEach((b) => {
      b.onclick = function () { speakJapanese(this.dataset.jp, 0.78, this); };
    });
    container.querySelectorAll(".v-allforms-btn").forEach((b) => {
      b.onclick = () => openVerbConjugationModal(b.dataset.vid);
    });
    container.querySelectorAll(".v-staff-btn").forEach((b) => {
      b.onclick = () => openStaffCard(b.dataset.jp, b.dataset.cn, b.dataset.tag);
    });
    const resetBtn = document.getElementById("btn-reset-verb-filters");
    if (resetBtn) {
      resetBtn.onclick = () => {
        vState.search = "";
        vState.jlpt = "all";
        vState.group = "all";
        vState.category = "all";
        vState.status = "all";
        renderVerbsView();
      };
    }
  }

  // =========================================================================
  // TAB 4: JAPANESE GRAMMAR GUIDE (GROUPED BY N5 / N4 / N3, ORDERED BY IMPORTANCE)
  // =========================================================================
  function renderGrammarCard(g) {
    const { state, formatRuby, escapeHtml } = app();
    const isStar = !!state.starred[g.id];
    const isMast = !!state.mastered[g.id];
    const starsStr = "★".repeat(g.importance) + "☆".repeat(5 - g.importance);
    const quizOpen = !!gState.openQuizIds[g.id];
    const qState = gState.openQuizIds[g.id];

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
          <div class="grammar-pattern-title">${escapeHtml(g.pattern)}</div>
          <div class="romaji-text" style="margin:0;">${escapeHtml(g.reading)}</div>
        </div>

        <div class="grammar-meaning">${escapeHtml(g.meaning)}</div>

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
            <div class="jp-text" style="font-size:1.05rem;margin-bottom:0.2rem;">${formatRuby(g.quiz.promptJp)}</div>
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

        <!-- Daily Use Examples -->
        <div class="grammar-examples">
          <div class="gex-heading">🗣️ 日常高频例句（点击朗读跟读）：</div>
          ${g.dailyExamples
            .map(
              (ex) => `
            <div class="verb-example-item">
              <div style="flex:1;min-width:0;">
                <span class="vex-form-badge">${escapeHtml(ex.ctx)}</span>
                <div class="jp-text vex-jp">${formatRuby(ex.jp)}</div>
                <div class="romaji-text" style="margin-bottom:0.15rem;">${escapeHtml(ex.romaji)}</div>
                <div class="cn-text" style="font-size:0.85rem;margin-bottom:0;">${escapeHtml(ex.cn)}</div>
              </div>
              <div class="vex-btns">
                <button type="button" class="icon-btn g-speak-btn" data-jp="${escapeHtml(ex.jp)}" title="常速朗读">🔊</button>
                <button type="button" class="icon-btn g-speak-slow-btn" data-jp="${escapeHtml(ex.jp)}" title="慢速跟读">🐢</button>
                <button type="button" class="icon-btn g-staff-btn" data-jp="${escapeHtml(ex.jp)}" data-cn="${escapeHtml(ex.cn)}" data-tag="${g.level} 语法 · ${escapeHtml(g.pattern)}" title="大字出示卡">📱</button>
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
    const { state, escapeHtml, speakJapanese, toggleStar, toggleMastered, openStaffCard, recordStudyActivity, switchAppMode } = app();

    const statsByLvl = ["N5", "N4", "N3"].map((lvl) => {
      const list = GRAMMAR.filter((g) => g.level === lvl);
      const done = list.filter((g) => state.mastered[g.id]).length;
      return { lvl, total: list.length, done };
    });
    const totalDone = statsByLvl.reduce((s, x) => s + x.done, 0);
    const totalPct = GRAMMAR.length ? Math.round((totalDone / GRAMMAR.length) * 100) : 0;

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

    const levelMeta = {
      N5: { title: "🟢 JLPT N5 · 基础核心语法（按日常重要度排序）", sub: "涵盖日常交流 70% 骨架句型：请求、许可、时间地点助词、意愿、必须与禁止，建议优先全背熟！", cls: "grp-banner-n5" },
      N4: { title: "🔵 JLPT N4 · 进阶实用语法（按日常重要度排序）", sub: "让日语立刻从“能沟通”升级为“自然礼貌”：敬语请求、四大条件句、授受表达、尝试与提前准备！", cls: "grp-banner-n4" },
      N3: { title: "🟣 JLPT N3 · 地道流利语法（按日常重要度排序）", sub: "日本人每天挂在嘴边的高阶细腻表达：おかげで、わけではない、ついでに、うちに、わりに、てよかった！", cls: "grp-banner-n3" }
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
      <!-- Top Summary & N5/N4/N3 Breakdown -->
      <div class="learning-hero-card">
        <div class="learning-hero-top">
          <div>
            <h2 class="itin-section-title">📖 日语核心语法精讲 · 按 N5 / N4 / N3 分组 & 重要度排序</h2>
            <p class="itin-section-sub">精选 ${GRAMMAR.length} 条最高频实用语法与 258 句日常例句（涵盖家庭、餐厅、交通、旅行、职场），每条配接续公式、易错辨析与随堂小测！</p>
          </div>
          <button type="button" class="action-btn primary-audio" id="btn-jump-grammar-quiz">
            🧩 进入语法填空测验 →
          </button>
        </div>

        <div class="grammar-kpi-row">
          ${statsByLvl
            .map(
              (s) => `
            <button type="button" class="gkpi-card ${gState.level === s.lvl ? "active" : ""}" data-glevel="${s.lvl}">
              <span class="jlpt-pill jlpt-${s.lvl.toLowerCase()}">${s.lvl}</span>
              <div>
                <div style="font-weight:800;font-size:0.95rem;">已掌握 ${s.done} / ${s.total}</div>
                <div style="font-size:0.73rem;color:var(--text-muted);">${s.lvl === "N5" ? "基础核心必背" : s.lvl === "N4" ? "日常流利进阶" : "地道细腻表达"}</div>
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
      </div>

      <!-- Filter Bar -->
      <div class="learning-filter-card">
        <div class="lf-row-top">
          <div class="search-box" style="flex:1 1 240px;">
            <span class="search-icon">🔍</span>
            <input type="text" id="grammar-search-input" value="${escapeHtml(gState.search)}" placeholder="搜语法句型、中文意思或场景（如：てもいい、おかげで、条件、顺便、敬语）..." />
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
              ["all", "全部级别 (N5–N3)"],
              ["N5", "🟢 N5"],
              ["N4", "🔵 N4"],
              ["N3", "🟣 N3"]
            ]
              .map(
                ([k, lbl]) => `
              <button type="button" class="toggle-chip ${gState.level === k ? "active" : ""}" data-glevel="${k}">${lbl}</button>
            `
              )
              .join("")}
          </div>
          <div class="toggle-group">
            ${[
              ["all", "全部重要度"],
              ["5", "🔥 5★每日必用"],
              ["4", "⭐ 4★高频实用"],
              ["3", "💎 3★进阶地道"]
            ]
              .map(
                ([k, lbl]) => `
              <button type="button" class="toggle-chip ${gState.importance === k ? "active" : ""}" data-gimp="${k}">${lbl}</button>
            `
              )
              .join("")}
          </div>
          <div class="toggle-group">
            ${[
              ["all", "全部"],
              ["unmastered", "⏳ 未掌握"],
              ["mastered", "✅ 已掌握"],
              ["starred", "⭐ 收藏"]
            ]
              .map(
                ([k, lbl]) => `
              <button type="button" class="toggle-chip ${gState.status === k ? "active" : ""}" data-gstatus="${k}">${lbl}</button>
            `
              )
              .join("")}
          </div>
        </div>
      </div>

      ${contentHtml}
    `;

    // Bind Grammar Events
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
        if (next) {
          next.focus();
          next.setSelectionRange(pos, pos);
        }
      };
    }
    const searchClr = document.getElementById("grammar-search-clear");
    if (searchClr) searchClr.onclick = () => { gState.search = ""; renderGrammarView(); };
    const orderSel = document.getElementById("grammar-order-select");
    if (orderSel) orderSel.onchange = (e) => { gState.orderMode = e.target.value; renderGrammarView(); };

    container.querySelectorAll("[data-glevel]").forEach((b) => {
      b.onclick = () => {
        gState.level = gState.level === b.dataset.glevel && b.classList.contains("gkpi-card") ? "all" : b.dataset.glevel;
        renderGrammarView();
      };
    });
    container.querySelectorAll("[data-gimp]").forEach((b) => {
      b.onclick = () => { gState.importance = b.dataset.gimp; renderGrammarView(); };
    });
    container.querySelectorAll("[data-gstatus]").forEach((b) => {
      b.onclick = () => { gState.status = b.dataset.gstatus; renderGrammarView(); };
    });
    container.querySelectorAll("[data-gstar]").forEach((b) => {
      b.onclick = () => toggleStar(b.dataset.gstar);
    });
    container.querySelectorAll("[data-gmaster]").forEach((b) => {
      b.onclick = () => toggleMastered(b.dataset.gmaster);
    });
    container.querySelectorAll(".g-speak-btn").forEach((b) => {
      b.onclick = function () { speakJapanese(this.dataset.jp, 1.0, this); };
    });
    container.querySelectorAll(".g-speak-slow-btn").forEach((b) => {
      b.onclick = function () { speakJapanese(this.dataset.jp, 0.78, this); };
    });
    container.querySelectorAll(".g-staff-btn").forEach((b) => {
      b.onclick = () => openStaffCard(b.dataset.jp, b.dataset.cn, b.dataset.tag);
    });
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
        const gObj = GRAMMAR.find((x) => x.id === gid);
        gState.openQuizIds[gid] = { picked: opt };
        if (gObj && opt === gObj.quiz.answer) {
          recordStudyActivity(1);
          const fullSentence = gObj.quiz.promptJp.replace("＿＿", opt);
          speakJapanese(fullSentence, 1.0);
        }
        renderGrammarView();
      };
    });
    const resetBtn = document.getElementById("btn-reset-grammar-filters");
    if (resetBtn) {
      resetBtn.onclick = () => {
        gState.search = "";
        gState.level = "all";
        gState.importance = "all";
        gState.status = "all";
        renderGrammarView();
      };
    }
  }

  // =========================================================================
  // TAB 5: INTERACTIVE PRACTICE & SPACED-REPETITION LAB
  // =========================================================================

  // Build unified card list for SRS Flashcards
  function buildSrsPool(deck, jlptFilter) {
    const { state } = app();
    const verbCards = VERBS.filter((v) => jlptFilter === "all" || v.jlpt === jlptFilter).map((v) => ({
      id: v.id,
      kind: "⚡ 动词",
      badge: `${v.jlpt} · #${v.rank} · ${GROUP_LABELS[v.group]}`,
      frontJp: v.jp,
      frontKana: v.kana,
      romaji: v.romaji,
      backCn: v.cn,
      extraHtml: `ます形: <strong>${v.forms.masu.jp}</strong> ｜ て形: <strong>${v.forms.te.jp}</strong> ｜ ない形: <strong>${v.forms.nai.jp}</strong>`,
      exampleJp: v.examples[0] ? v.examples[0].jp : "",
      exampleCn: v.examples[0] ? v.examples[0].cn : "",
      audioText: v.kana,
      audioKey: null
    }));

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

    const phraseCards = getAllPhraseItems().map((it) => ({
      id: it.id,
      kind: "🗣️ 短语",
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

    if (deck === "verbs") return verbCards;
    if (deck === "grammar") return grammarCards;
    if (deck === "phrases") return phraseCards;
    const all = [...verbCards, ...grammarCards, ...phraseCards];
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
    // Priority: due cards -> unseen cards -> lowest SRS box
    const due = pool.filter((c) => state.srs[c.id] && state.srs[c.id].nextDue <= now);
    const unseen = pool.filter((c) => !state.srs[c.id] && !state.mastered[c.id]);
    let candidates = due.length ? due : unseen.length ? unseen : pool;
    // Avoid immediate repeat
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

  // Conjugation Drill Question Generator
  const DRILL_FORMS = [
    { key: "te", label: "て形（请求/连接）" },
    { key: "masu", label: "ます形（礼貌体）" },
    { key: "nai", label: "ない形（否定）" },
    { key: "ta", label: "た形（过去简体）" },
    { key: "tai", label: "たい形（想要做）" },
    { key: "potential", label: "可能形（能够做）" },
    { key: "volitional", label: "意向形（一起做吧）" }
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

    // Build plausible distractors using other forms of same verb + similar-stem distortions
    const distractors = new Set();
    const otherKeys = shuffle(["masu", "te", "ta", "nai", "tai", "potential", "volitional", "ba", "passive"]);
    for (const k of otherKeys) {
      if (k !== targetFormObj.key && verb.forms[k] && !verb.forms[k].jp.startsWith("—") && verb.forms[k].jp !== correctObj.jp) {
        distractors.add(verb.forms[k].jp);
      }
      if (distractors.size >= 2) break;
    }
    // Add one tricky wrong conjugation for the same target form
    const stem = verb.dict.slice(0, -1);
    const trickyGuesses = {
      te: [stem + "て", stem + "って", stem + "いて", stem + "んで", stem + "して"],
      ta: [stem + "た", stem + "った", stem + "いた", stem + "んだ", stem + "した"],
      nai: [stem + "ない", stem + "らない", stem + "わない", stem + "かない"],
      masu: [stem + "ます", stem + "ります", stem + "います", stem + "きます"],
      tai: [stem + "たい", stem + "りたい", stem + "いたい"],
      potential: [stem + "られる", stem + "える", stem + "れる"],
      volitional: [stem + "よう", stem + "ろう", stem + "おう"]
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

  // Grammar & Listening Quiz Generator
  function generateQuizQuestion() {
    if (pState.quizKind === "grammar") {
      const pool = GRAMMAR.filter((g) => (pState.quizLevel === "all" || g.level === pState.quizLevel) && g.quiz);
      const pick = pool[Math.floor(Math.random() * pool.length)];
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
    } else {
      // Listening Comprehension Quiz: mix of phrasebook + verb examples
      const items = [
        ...getAllPhraseItems().map((it) => ({ jp: it.jp, cn: it.cn, tag: it.tag, audioKey: it.id })),
        ...VERBS.slice(0, 120).map((v) => ({ jp: v.examples[0].jp, cn: v.examples[0].cn, tag: `动词 #${v.rank} ${v.dict}`, audioKey: null }))
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

  // Shadowing Deck Builder
  function getShadowItems() {
    if (pState.shadowDeck === "verbs") {
      return VERBS.map((v) => ({
        tag: `动词 #${v.rank} · ${v.dict} (${v.examples[0].form})`,
        jp: v.examples[0].jp,
        romaji: v.examples[0].romaji,
        cn: v.examples[0].cn,
        audioKey: null
      }));
    }
    if (pState.shadowDeck === "grammar") {
      return GRAMMAR.map((g) => ({
        tag: `${g.level} 语法 · ${g.pattern}`,
        jp: g.dailyExamples[0].jp,
        romaji: g.dailyExamples[0].romaji,
        cn: g.dailyExamples[0].cn,
        audioKey: null
      }));
    }
    return getAllPhraseItems().map((it) => ({
      tag: it.tag || "场景日语",
      jp: it.jp,
      romaji: it.romaji || "",
      cn: it.cn,
      audioKey: it.id
    }));
  }

  function stopShadowingLoop() {
    pState.shadowRunning = false;
    pState.shadowPhase = "";
    clearTimeout(pState.shadowTimer);
    app().stopAllAudio();
  }

  function startShadowingLoop(item) {
    stopShadowingLoop();
    pState.shadowRunning = true;
    pState.shadowPhase = "🐢 第 1 步：慢速聆听 (0.78x)...";
    renderPracticeView();
    app().speakJapanese(
      item.jp,
      0.78,
      null,
      () => {
        if (!pState.shadowRunning) return;
        pState.shadowPhase = "🎤 第 2 步：轮到你了！请大声跟读...";
        renderPracticeView();
        pState.shadowTimer = setTimeout(() => {
          if (!pState.shadowRunning) return;
          pState.shadowPhase = "🔊 第 3 步：原速示范对比 (1.0x)...";
          renderPracticeView();
          app().speakJapanese(
            item.jp,
            1.0,
            null,
            () => {
              pState.shadowRunning = false;
              pState.shadowPhase = "✅ 完成一轮跟读！可以再来一遍或切下一句";
              app().recordStudyActivity(1);
              renderPracticeView();
            },
            item.audioKey
          );
        }, 2600);
      },
      item.audioKey
    );
  }

  function startSpeechCheck(item) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      app().showToast("⚠️ 当前浏览器不支持语音识别（推荐 Chrome / Edge / Safari）");
      return;
    }
    stopShadowingLoop();
    const rec = new SR();
    rec.lang = "ja-JP";
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    pState.shadowPhase = "🎙️ 正在聆听你的日语发音，请开始朗读...";
    pState.shadowTranscript = "";
    pState.shadowScore = null;
    renderPracticeView();

    rec.onresult = (event) => {
      const heard = (event.results[0] && event.results[0][0] && event.results[0][0].transcript) || "";
      const targetClean = app().stripFurigana(item.jp).replace(/[。、！？\s・「」『』（）()]/g, "");
      const heardClean = heard.replace(/[。、！？\s・「」『』（）()]/g, "");
      let overlap = 0;
      const tChars = Array.from(targetClean);
      const hSet = new Set(Array.from(heardClean));
      tChars.forEach((ch) => {
        if (hSet.has(ch)) overlap++;
      });
      const score = tChars.length ? Math.min(100, Math.round((overlap / tChars.length) * 100)) : 0;
      pState.shadowTranscript = heard;
      pState.shadowScore = score;
      pState.shadowPhase = score >= 70 ? "🎉 发音很清晰！" : "💪 再跟读听一遍试试！";
      app().recordStudyActivity(1);
      renderPracticeView();
    };
    rec.onerror = () => {
      pState.shadowPhase = "⚠️ 未检测到清晰语音，请靠近麦克风重试";
      renderPracticeView();
    };
    rec.start();
  }

  function renderPracticeView() {
    const container = document.getElementById("practice-view-container");
    if (!container) return;
    const { state, formatRuby, escapeHtml, speakJapanese, recordStudyActivity } = app();

    // Dashboard metrics
    const allPhrases = getAllPhraseItems();
    const pDone = allPhrases.filter((x) => state.mastered[x.id]).length;
    const vDone = VERBS.filter((x) => state.mastered[x.id]).length;
    const gDone = GRAMMAR.filter((x) => state.mastered[x.id]).length;
    const now = Date.now();
    const dueCount = Object.values(state.srs || {}).filter((s) => s && s.nextDue <= now).length;
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
                ["due", `⏰ 今日到期 (${dueCount})`],
                ["verbs", "⚡ 动词200"],
                ["grammar", "📖 语法N5–N3"],
                ["phrases", "🗣️ 场景短语"],
                ["starred", "⭐ 我的收藏"]
              ]
                .map(
                  ([k, lbl]) => `
                <button type="button" class="toggle-chip ${pState.srsDeck === k ? "active" : ""}" data-srsdeck="${k}">${lbl}</button>
              `
                )
                .join("")}
            </div>
            <div class="toggle-group">
              ${
                pState.srsDeck === "verbs" || pState.srsDeck === "grammar"
                  ? ["all", "N5", "N4", "N3"]
                      .map((l) => `<button type="button" class="toggle-chip ${pState.srsJlpt === l ? "active" : ""}" data-srsjlpt="${l}">${l === "all" ? "全部级别" : l}</button>`)
                      .join("")
                  : ""
              }
              <button type="button" class="toggle-chip ${pState.srsListenFirst ? "active" : ""}" id="btn-srs-listenfirst" title="隐藏文字，先靠耳朵听辨">👂 听音优先</button>
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
                  <p style="font-size:0.84rem;color:var(--text-secondary);margin-bottom:1rem;">切换到「⚡ 动词200」「📖 语法N5–N3」或「🗣️ 场景短语」继续学习新卡片吧！</p>
                  <button type="button" class="action-btn primary-audio" id="btn-srs-switch-verbs">开始刷高频动词闪卡</button>
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
                        <div style="font-size:2.3rem;margin-bottom:0.4rem;">👂</div>
                        <div style="font-weight:700;color:var(--text-secondary);margin-bottom:0.8rem;">先听发音，回想日文与中文含义！</div>
                        <button type="button" class="action-btn primary-audio" id="btn-fc-play-front">🔊 播放日语发音</button>
                      </div>`
                    : `<div class="jp-text fc-jp-main">${formatRuby(card.frontJp)}</div>
                       <div class="romaji-text" style="text-align:center;">${escapeHtml(card.romaji)}</div>`
                }
              </div>

              ${
                pState.srsFlipped
                  ? `
                <div class="fc-back-area">
                  <div class="fc-cn-answer">${escapeHtml(card.backCn)}</div>
                  ${card.extraHtml ? `<div class="fc-extra-info">${card.extraHtml}</div>` : ""}
                  ${
                    card.exampleJp
                      ? `<div class="fc-example-box">
                          <div style="flex:1;">
                            <div class="jp-text" style="font-size:0.96rem;margin:0;">${formatRuby(card.exampleJp)}</div>
                            <div style="font-size:0.8rem;color:var(--text-secondary);">${escapeHtml(card.exampleCn)}</div>
                          </div>
                          <button type="button" class="icon-btn" id="btn-fc-play-ex">🔊 听例句</button>
                        </div>`
                      : ""
                  }
                </div>
              `
                  : `<div class="fc-tap-hint">👆 点击卡片或下方按钮翻看答案</div>`
              }
            </div>

            <div class="fc-controls-row">
              <button type="button" class="action-btn" id="btn-fc-speak-1x">🔊 朗读 (1.0x)</button>
              <button type="button" class="action-btn" id="btn-fc-speak-slow">🐢 慢读 (0.78x)</button>
              ${
                !pState.srsFlipped
                  ? `<button type="button" class="action-btn primary-audio" id="btn-fc-flip" style="flex:1;max-width:260px;">👀 显示答案</button>`
                  : `
                  <button type="button" class="action-btn srs-btn-again" id="btn-srs-again">😰 忘记了 (10分钟后再练)</button>
                  <button type="button" class="action-btn srs-btn-hard" id="btn-srs-hard">🤔 有点模糊 (明天复习)</button>
                  <button type="button" class="action-btn srs-btn-good" id="btn-srs-good">✅ 记牢了 (间隔翻倍)</button>
                `
              }
            </div>
          `
          }
        </div>
      `;
    }

    // --- SUB-MODE 2: VERB CONJUGATION DRILL ---
    else if (pState.subMode === "conj") {
      if (!pState.conjQuestion) generateConjQuestion();
      const q = pState.conjQuestion;
      const acc = pState.conjTotal ? Math.round((pState.conjCorrect / pState.conjTotal) * 100) : 0;

      stageHtml = `
        <div class="practice-stage-card">
          <div class="practice-toolbar-row">
            <div class="toggle-group">
              ${["all", "N5", "N4", "N3"]
                .map((l) => `<button type="button" class="toggle-chip ${pState.conjJlpt === l ? "active" : ""}" data-cjjlpt="${l}">${l === "all" ? "全部级别" : l}</button>`)
                .join("")}
            </div>
            <div class="toggle-group">
              <select id="conj-form-select" class="lf-select" style="padding:0.28rem 0.55rem;font-size:0.78rem;">
                <option value="mixed" ${pState.conjForm === "mixed" ? "selected" : ""}>🎲 随机混合变形</option>
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
            <div class="jp-text" style="font-size:1.75rem;text-align:center;margin:0.15rem 0;">${formatRuby(q.verb.jp)}</div>
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
                  .map((opt) => {
                    let cls = "";
                    if (pState.conjAnswered) {
                      if (opt === q.answerJp) cls = "opt-correct";
                      else if (opt === pState.conjAnswered.picked) cls = "opt-wrong";
                    }
                    return `<button type="button" class="quiz-opt-btn conj-choice-btn ${cls}" data-opt="${escapeHtml(opt)}" ${pState.conjAnswered ? "disabled" : ""}>${escapeHtml(opt)}</button>`;
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
                  <button type="button" class="action-btn primary-audio" id="btn-conj-next">下一题 →</button>
                </div>
              </div>
            `
                : ""
            }
          </div>
        </div>
      `;
    }

    // --- SUB-MODE 3: GRAMMAR FILL-IN & LISTENING QUIZ ---
    else if (pState.subMode === "quiz") {
      if (!pState.quizQuestion || pState.quizQuestion.kind !== pState.quizKind) generateQuizQuestion();
      const q = pState.quizQuestion;
      const acc = pState.quizTotal ? Math.round((pState.quizCorrect / pState.quizTotal) * 100) : 0;

      stageHtml = `
        <div class="practice-stage-card">
          <div class="practice-toolbar-row">
            <div class="toggle-group">
              <button type="button" class="toggle-chip ${pState.quizKind === "grammar" ? "active" : ""}" data-qkind="grammar">🧩 N5–N3 语法填空</button>
              <button type="button" class="toggle-chip ${pState.quizKind === "listening" ? "active" : ""}" data-qkind="listening">👂 听音辨意挑战</button>
            </div>
            ${
              pState.quizKind === "grammar"
                ? `<div class="toggle-group">
                    ${["all", "N5", "N4", "N3"]
                      .map((l) => `<button type="button" class="toggle-chip ${pState.quizLevel === l ? "active" : ""}" data-qlvl="${l}">${l === "all" ? "全部级别" : l}</button>`)
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
              <div style="display:flex;justify-content:center;gap:0.4rem;margin-bottom:0.45rem;">
                <span class="jlpt-pill jlpt-${q.grammar.level.toLowerCase()}">${q.grammar.level}</span>
                <span class="imp-pill imp-${q.grammar.importance}">${escapeHtml(q.grammar.importanceLabel)}</span>
              </div>
              <div class="jp-text" style="font-size:1.35rem;text-align:center;margin:0.35rem 0;">${formatRuby(q.promptJp)}</div>
              <div style="text-align:center;font-size:0.9rem;color:var(--accent-indigo);font-weight:700;margin-bottom:0.9rem;">
                🇨🇳 ${escapeHtml(q.cn)}
              </div>
              <div class="quiz-options-grid">
                ${q.options
                  .map((opt) => {
                    let cls = "";
                    if (pState.quizAnswered) {
                      if (opt === q.answer) cls = "opt-correct";
                      else if (opt === pState.quizAnswered.picked) cls = "opt-wrong";
                    }
                    return `<button type="button" class="quiz-opt-btn main-quiz-pick ${cls}" data-opt="${escapeHtml(opt)}" ${pState.quizAnswered ? "disabled" : ""}>${escapeHtml(opt)}</button>`;
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
                    <button type="button" class="action-btn primary-audio" id="btn-quiz-next">下一题 →</button>
                  </div>
                </div>
              `
                  : ""
              }
            </div>
          `
              : q
              ? `
            <div class="drill-question-box">
              <div style="text-align:center;margin-bottom:0.75rem;">
                <span class="phrase-tag">${escapeHtml(q.tag)}</span>
                <div style="font-size:2.4rem;margin:0.5rem 0 0.35rem;">🎧</div>
                <div style="font-size:0.88rem;color:var(--text-secondary);margin-bottom:0.7rem;">点击播放日语语音，选出最准确的中文意思！</div>
                <div style="display:flex;justify-content:center;gap:0.5rem;">
                  <button type="button" class="action-btn primary-audio" id="btn-listen-play-1x">🔊 常速播放 (1.0x)</button>
                  <button type="button" class="action-btn" id="btn-listen-play-slow">🐢 慢速播放 (0.78x)</button>
                </div>
              </div>
              <div class="quiz-options-grid" style="grid-template-columns:1fr;">
                ${q.options
                  .map((opt) => {
                    let cls = "";
                    if (pState.quizAnswered) {
                      if (opt === q.answer) cls = "opt-correct";
                      else if (opt === pState.quizAnswered.picked) cls = "opt-wrong";
                    }
                    return `<button type="button" class="quiz-opt-btn main-quiz-pick ${cls}" data-opt="${escapeHtml(opt)}" ${pState.quizAnswered ? "disabled" : ""} style="text-align:left;">${escapeHtml(opt)}</button>`;
                  })
                  .join("")}
              </div>
              ${
                pState.quizAnswered
                  ? `
                <div class="drill-feedback ${pState.quizAnswered.ok ? "fb-ok" : "fb-err"}">
                  <div style="font-weight:800;margin-bottom:0.25rem;">${pState.quizAnswered.ok ? "🎉 听力满分！" : "❌ 再听一遍记住它！"}</div>
                  <div class="jp-text" style="font-size:1.05rem;margin:0.2rem 0;">${formatRuby(q.jp)}</div>
                  <div style="font-size:0.84rem;margin-bottom:0.55rem;">🇨🇳 ${escapeHtml(q.cn)}</div>
                  <button type="button" class="action-btn primary-audio" id="btn-quiz-next">下一题 →</button>
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

    // --- SUB-MODE 4: SHADOWING & SPEECH CHECK ---
    else if (pState.subMode === "shadow") {
      const items = getShadowItems();
      if (pState.shadowIndex >= items.length) pState.shadowIndex = 0;
      const item = items[pState.shadowIndex];
      const hasSR = !!(window.SpeechRecognition || window.webkitSpeechRecognition);

      stageHtml = `
        <div class="practice-stage-card">
          <div class="practice-toolbar-row">
            <div class="toggle-group">
              ${[
                ["phrases", "🗣️ 场景短语"],
                ["verbs", "⚡ 动词例句"],
                ["grammar", "📖 语法日常句"]
              ]
                .map(
                  ([k, lbl]) => `
                <button type="button" class="toggle-chip ${pState.shadowDeck === k ? "active" : ""}" data-shdeck="${k}">${lbl}</button>
              `
                )
                .join("")}
            </div>
            <span style="font-size:0.78rem;color:var(--text-muted);font-weight:700;">第 ${pState.shadowIndex + 1} / ${items.length} 句</span>
          </div>

          <div class="drill-question-box">
            <div style="text-align:center;margin-bottom:0.4rem;"><span class="phrase-tag">${escapeHtml(item.tag)}</span></div>
            <div class="jp-text" style="font-size:1.38rem;text-align:center;margin:0.45rem 0;">${formatRuby(item.jp)}</div>
            <div class="romaji-text" style="text-align:center;">${escapeHtml(item.romaji)}</div>
            <div class="cn-text" style="text-align:center;margin-bottom:0.85rem;">${escapeHtml(item.cn)}</div>

            ${
              pState.shadowPhase
                ? `<div class="shadow-status-banner">${escapeHtml(pState.shadowPhase)}</div>`
                : `<div style="text-align:center;font-size:0.8rem;color:var(--text-secondary);margin-bottom:0.8rem;">
                    💡 点击「🔁 三步跟读循环」：先 0.78x 慢速聆听 → 停顿 2.5 秒留给你大声跟读 → 自动 1.0x 常速示范对比！
                  </div>`
            }

            ${
              pState.shadowTranscript
                ? `<div class="shadow-rec-result">
                    <div>🎙️ 识别到你说的是：<strong>${escapeHtml(pState.shadowTranscript)}</strong></div>
                    <div style="margin-top:0.2rem;">匹配度参考：<strong>${pState.shadowScore}%</strong></div>
                  </div>`
                : ""
            }

            <div class="fc-controls-row" style="margin-top:0.85rem;">
              <button type="button" class="action-btn" id="btn-sh-prev">← 上一句</button>
              <button type="button" class="action-btn ${pState.shadowRunning ? "speaking" : "primary-audio"}" id="btn-sh-loop">
                ${pState.shadowRunning ? "⏹ 停止跟读" : "🔁 三步跟读循环"}
              </button>
              ${hasSR ? `<button type="button" class="action-btn" id="btn-sh-mic">🎙️ 开口语音识别</button>` : ""}
              <button type="button" class="action-btn" id="btn-sh-rand">🎲 随机一句</button>
              <button type="button" class="action-btn" id="btn-sh-next">下一句 →</button>
            </div>
          </div>
        </div>
      `;
    }

    container.innerHTML = `
      <!-- Personal Learning Dashboard & Daily Streak -->
      <div class="learning-hero-card">
        <div class="learning-hero-top">
          <div>
            <h2 class="itin-section-title">🎯 日语实战训练场 & 个人学习仪表盘</h2>
            <p class="itin-section-sub">结合间隔重复闪卡 (SRS)、动词变形闪电战、N5–N3 语法填空、听音辨意与三步影子跟读，每天 10 分钟快速开口！</p>
          </div>
          <div class="dash-streak-badge">
            <div style="font-size:1.35rem;font-weight:900;">🔥 ${state.streak.count || 0} 天</div>
            <div style="font-size:0.72rem;opacity:0.9;">今日已完成 ${todayCount} 题/卡</div>
          </div>
        </div>

        <div class="dash-metrics-grid">
          <div class="dash-metric">
            <div class="dm-top"><span>🗣️ 场景短语</span><strong>${pDone} / ${allPhrases.length}</strong></div>
            <div class="progress-bar-track"><div class="progress-bar-fill" style="width:${allPhrases.length ? Math.round((pDone / allPhrases.length) * 100) : 0}%;"></div></div>
          </div>
          <div class="dash-metric">
            <div class="dm-top"><span>⚡ 高频动词200</span><strong>${vDone} / ${VERBS.length}</strong></div>
            <div class="progress-bar-track"><div class="progress-bar-fill" style="width:${VERBS.length ? Math.round((vDone / VERBS.length) * 100) : 0}%;background:#0284c7;"></div></div>
          </div>
          <div class="dash-metric">
            <div class="dm-top"><span>📖 语法 N5–N3</span><strong>${gDone} / ${GRAMMAR.length}</strong></div>
            <div class="progress-bar-track"><div class="progress-bar-fill" style="width:${GRAMMAR.length ? Math.round((gDone / GRAMMAR.length) * 100) : 0}%;background:#7c3aed;"></div></div>
          </div>
          <div class="dash-metric">
            <div class="dm-top"><span>⏰ 闪卡待复习</span><strong style="color:${dueCount > 0 ? "var(--accent-red)" : "var(--accent-emerald)"};">${dueCount} 张</strong></div>
            <div style="font-size:0.72rem;color:var(--text-muted);margin-top:0.2rem;">已加入 SRS 追踪：${Object.keys(state.srs || {}).length} 项</div>
          </div>
        </div>

        <!-- 4 Practice Sub-Mode Switcher -->
        <div class="practice-subtabs">
          <button type="button" class="map-pill ${pState.subMode === "srs" ? "active" : ""}" data-psub="srs">🃏 间隔复习闪卡 (SRS)</button>
          <button type="button" class="map-pill ${pState.subMode === "conj" ? "active" : ""}" data-psub="conj">⚡ 动词变形闪电战</button>
          <button type="button" class="map-pill ${pState.subMode === "quiz" ? "active" : ""}" data-psub="quiz">🧩 语法填空 & 听音测验</button>
          <button type="button" class="map-pill ${pState.subMode === "shadow" ? "active" : ""}" data-psub="shadow">🎙️ 影子跟读实验室</button>
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
    const btnSwitchVerbs = document.getElementById("btn-srs-switch-verbs");
    if (btnSwitchVerbs) btnSwitchVerbs.onclick = () => { pState.srsDeck = "verbs"; pickNextSrsCard(); renderPracticeView(); };

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
      if (ok) {
        pState.conjCorrect++;
        pState.conjStreak++;
        recordStudyActivity(1);
      } else {
        pState.conjStreak = 0;
      }
      speakJapanese(q.answerKana || q.answerJp, 1.0);
      renderPracticeView();
    }

    container.querySelectorAll(".conj-choice-btn").forEach((b) => {
      b.onclick = () => checkConjAnswer(b.dataset.opt);
    });
    const btnSubmitType = document.getElementById("btn-conj-submit-type");
    const typeInput = document.getElementById("conj-type-input");
    if (btnSubmitType && typeInput) {
      btnSubmitType.onclick = () => {
        if (typeInput.value.trim()) checkConjAnswer(typeInput.value);
      };
      typeInput.onkeydown = (e) => {
        if (e.key === "Enter" && typeInput.value.trim()) checkConjAnswer(typeInput.value);
      };
    }
    const btnCjPlay = document.getElementById("btn-conj-play-ans");
    if (btnCjPlay && pState.conjQuestion) btnCjPlay.onclick = function () { speakJapanese(pState.conjQuestion.answerKana || pState.conjQuestion.answerJp, 1.0, this); };
    const btnCjNext = document.getElementById("btn-conj-next");
    if (btnCjNext) btnCjNext.onclick = () => { generateConjQuestion(); renderPracticeView(); };

    // Bind Grammar & Listening Quiz Events
    container.querySelectorAll("[data-qkind]").forEach((b) => {
      b.onclick = () => { pState.quizKind = b.dataset.qkind; generateQuizQuestion(); renderPracticeView(); };
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
        if (ok) {
          pState.quizCorrect++;
          pState.quizStreak++;
          recordStudyActivity(1);
        } else {
          pState.quizStreak = 0;
        }
        if (q.kind === "grammar") {
          speakJapanese(q.promptJp.replace("＿＿", q.answer), 1.0);
        }
        renderPracticeView();
      };
    });
    const btnQuizSent = document.getElementById("btn-quiz-play-sent");
    if (btnQuizSent && pState.quizQuestion && pState.quizQuestion.kind === "grammar") {
      btnQuizSent.onclick = function () {
        speakJapanese(pState.quizQuestion.promptJp.replace("＿＿", pState.quizQuestion.answer), 1.0, this);
      };
    }
    const btnL1 = document.getElementById("btn-listen-play-1x");
    if (btnL1 && pState.quizQuestion) btnL1.onclick = function () { speakJapanese(pState.quizQuestion.jp, 1.0, this, null, pState.quizQuestion.audioKey); };
    const btnLSlow = document.getElementById("btn-listen-play-slow");
    if (btnLSlow && pState.quizQuestion) btnLSlow.onclick = function () { speakJapanese(pState.quizQuestion.jp, 0.78, this, null, pState.quizQuestion.audioKey); };
    const btnQNext = document.getElementById("btn-quiz-next");
    if (btnQNext) {
      btnQNext.onclick = () => {
        generateQuizQuestion();
        renderPracticeView();
        if (pState.quizKind === "listening" && pState.quizQuestion) {
          setTimeout(() => speakJapanese(pState.quizQuestion.jp, 1.0, null, null, pState.quizQuestion.audioKey), 150);
        }
      };
    }

    // Bind Shadowing Lab Events
    container.querySelectorAll("[data-shdeck]").forEach((b) => {
      b.onclick = () => {
        stopShadowingLoop();
        pState.shadowDeck = b.dataset.shdeck;
        pState.shadowIndex = 0;
        pState.shadowTranscript = "";
        pState.shadowScore = null;
        renderPracticeView();
      };
    });
    const shItems = getShadowItems();
    const curSh = shItems[pState.shadowIndex];
    const btnShLoop = document.getElementById("btn-sh-loop");
    if (btnShLoop && curSh) {
      btnShLoop.onclick = () => {
        if (pState.shadowRunning) {
          stopShadowingLoop();
          renderPracticeView();
        } else {
          startShadowingLoop(curSh);
        }
      };
    }
    const btnShMic = document.getElementById("btn-sh-mic");
    if (btnShMic && curSh) btnShMic.onclick = () => startSpeechCheck(curSh);
    const btnShPrev = document.getElementById("btn-sh-prev");
    if (btnShPrev) btnShPrev.onclick = () => { stopShadowingLoop(); pState.shadowIndex = (pState.shadowIndex - 1 + shItems.length) % shItems.length; pState.shadowTranscript = ""; renderPracticeView(); };
    const btnShNext = document.getElementById("btn-sh-next");
    if (btnShNext) btnShNext.onclick = () => { stopShadowingLoop(); pState.shadowIndex = (pState.shadowIndex + 1) % shItems.length; pState.shadowTranscript = ""; renderPracticeView(); };
    const btnShRand = document.getElementById("btn-sh-rand");
    if (btnShRand) btnShRand.onclick = () => { stopShadowingLoop(); pState.shadowIndex = Math.floor(Math.random() * shItems.length); pState.shadowTranscript = ""; renderPracticeView(); };
  }

  // Register global renderer
  window.JP_LEARNING = {
    renderMode(mode) {
      if (mode === "verbs") renderVerbsView();
      else if (mode === "grammar") renderGrammarView();
      else if (mode === "practice") renderPracticeView();
    }
  };
})();
