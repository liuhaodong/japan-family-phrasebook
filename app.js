// Japan Family Phrasebook & Roleplay Web App Controller
// Powered by Studio Neural Japanese Audio (ja-JP-NanamiNeural & ja-JP-KeitaNeural) + In-App Editor & Couple Sync
(function () {
  const BASE_MODULES = [
    ...(window.PHRASE_MODULES_1_6 || []),
    ...(window.PHRASE_MODULES_7_12 || []),
    ...(window.PHRASE_MODULES_13_18 || [])
  ];
  const ITINERARY = window.TRIP_ITINERARY;
  const AUDIO_MANIFEST = window.AUDIO_MANIFEST || {};

  // App State
  const state = {
    appMode: "itinerary", // 'itinerary' | 'phrasebook'
    mapRegion: "all", // 'all' | 'tokyo' | 'ginza' | 'karuizawa' | 'kyushu'
    activeLeg: "all",
    viewMode: "all", // 'all' | 'sentences' | 'dialogues' | 'starred' | 'unmastered'
    searchQuery: "",
    showFurigana: true,
    showRomaji: true,
    showCn: true,
    practiceMode: false,
    darkMode: false,
    starred: JSON.parse(localStorage.getItem("jp_phrasebook_starred_v1") || "{}"),
    mastered: JSON.parse(localStorage.getItem("jp_phrasebook_mastered_v1") || "{}"),
    edits: JSON.parse(localStorage.getItem("jp_phrasebook_edits_v1") || "{}"),
    customItems: JSON.parse(localStorage.getItem("jp_phrasebook_custom_v1") || "[]"),
    playingDialogueId: null,
    stopDialogueRequested: false
  };

  function saveUserState() {
    localStorage.setItem("jp_phrasebook_starred_v1", JSON.stringify(state.starred));
    localStorage.setItem("jp_phrasebook_mastered_v1", JSON.stringify(state.mastered));
    localStorage.setItem("jp_phrasebook_edits_v1", JSON.stringify(state.edits));
    localStorage.setItem("jp_phrasebook_custom_v1", JSON.stringify(state.customItems));
  }

  // Merge BASE_MODULES with state.edits and state.customItems dynamically
  function getEffectiveModules() {
    return BASE_MODULES.map((mod) => {
      const sections = (mod.sections || []).map((sec) => {
        const items = (sec.items || []).map((it) => {
          if (state.edits[it.id]) {
            return { ...it, ...state.edits[it.id], isEdited: true };
          }
          return it;
        });
        return { ...sec, items };
      });

      const modCustom = state.customItems.filter((c) => Number(c.moduleId) === mod.id);
      if (modCustom.length > 0) {
        sections.unshift({
          title: `${mod.id}.0 ✨ 夫妻新增实用句 & 专属备忘 (Custom Added)`,
          items: modCustom.map((c) => ({ ...c, isCustom: true }))
        });
      }

      return { ...mod, sections };
    });
  }

  // Convert parenthetical furigana (both Hiragana and Katakana) e.g. 漢字（かんじ） or Google（グーグル） into <ruby>
  function formatRuby(text) {
    if (!text) return "";
    return text.replace(
      /([一-龯々ヶ0-9０-９a-zA-Z]+)\（([\u3040-\u309F\u30A0-\u30FFー・]+)\）/g,
      "<ruby>$1<rt>$2</rt></ruby>"
    );
  }

  // Clean display Japanese into pure spoken Japanese (for copying & fallback TTS)
  function stripFurigana(text) {
    if (!text) return "";
    if (text.includes("【洗衣机】")) {
      return "洗濯、洗濯乾燥、洗剤自動投入。ふろ自動、追いだき。暖房、加湿。";
    }
    return text
      .replace(/【[^】]*】/g, "")
      .replace(/→/g, "。 ")
      .replace(/［[^］]*］/g, "")
      .replace(/（※[^）]*）/g, "")
      .replace(/（[\u3040-\u309F\u30A0-\u30FFー・〜0-9０-９a-zA-Z\s/／]+）/g, "")
      .replace(/\s*／\s*/g, "。 ")
      .replace(/〇〇/g, "まるまる")
      .replace(/。+/g, "。")
      .replace(/\s+/g, " ")
      .trim();
  }

  function escapeHtml(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // Toast helper
  let toastTimer = null;
  function showToast(msg) {
    const el = document.getElementById("app-toast");
    if (!el) return;
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 2500);
  }

  // Check URL hash for incoming Couple Sync payload (#sync=...)
  function checkIncomingSyncHash() {
    if (!location.hash.startsWith("#sync=")) return;
    try {
      const encoded = location.hash.slice(6);
      const jsonStr = decodeURIComponent(escape(atob(encoded)));
      const payload = JSON.parse(jsonStr);
      if (payload && typeof payload === "object") {
        if (payload.starred) state.starred = { ...state.starred, ...payload.starred };
        if (payload.edits) state.edits = { ...state.edits, ...payload.edits };
        if (Array.isArray(payload.customItems)) {
          const existingIds = new Set(state.customItems.map((x) => x.id));
          payload.customItems.forEach((ci) => {
            const idx = state.customItems.findIndex((x) => x.id === ci.id);
            if (idx >= 0) state.customItems[idx] = ci;
            else if (!existingIds.has(ci.id)) state.customItems.push(ci);
          });
        }
        saveUserState();
        history.replaceState(null, "", location.pathname + location.search);
        setTimeout(() => showToast("🎉 已成功同步来自伴侣的最新收藏与新增日语句子！"), 400);
      }
    } catch (e) {
      console.warn("Sync hash parse error:", e);
    }
  }

  function generateSyncUrl() {
    const baseUrl = location.origin + location.pathname;
    const payload = {
      starred: state.starred,
      edits: state.edits,
      customItems: state.customItems
    };
    const hasCustomData =
      Object.keys(state.starred).length > 0 ||
      Object.keys(state.edits).length > 0 ||
      state.customItems.length > 0;
    if (!hasCustomData) return baseUrl;
    const b64 = btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
    return `${baseUrl}#sync=${b64}`;
  }

  // =========================================================================
  // Studio Neural Audio Engine (HTML5 Audio MP3 + Fallback Web Speech API)
  // =========================================================================
  const neuralAudioPlayer = new Audio();
  neuralAudioPlayer.preload = "auto";

  let jpVoice = null;
  function loadJapaneseVoice() {
    if (!("speechSynthesis" in window)) return;
    const voices = window.speechSynthesis.getVoices();
    const jaVoices = voices.filter((v) => v.lang && (v.lang === "ja-JP" || v.lang.startsWith("ja")));
    // Prefer Google 日本語 or Enhanced/Premium Apple voices over compact robotic voices
    jpVoice =
      jaVoices.find((v) => /Google|Enhanced|Premium|Natural|Siri/i.test(v.name)) ||
      jaVoices.find((v) => /Kyoko|Otoya|O-Ren|Haruka/i.test(v.name)) ||
      jaVoices[0] ||
      null;
  }

  if ("speechSynthesis" in window) {
    loadJapaneseVoice();
    window.speechSynthesis.onvoiceschanged = loadJapaneseVoice;
  }

  function stopAllAudio() {
    try {
      neuralAudioPlayer.pause();
      neuralAudioPlayer.currentTime = 0;
    } catch (e) {}
    if ("speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    document.querySelectorAll(".action-btn.speaking, .icon-btn.speaking").forEach((b) => b.classList.remove("speaking"));
  }

  function speakJapanese(rawJpText, rate = 1.0, btnEl = null, onEndCallback = null, audioKey = null) {
    stopAllAudio();

    // Check if we have a pre-generated Studio Neural MP3 (and item wasn't custom-edited in JP text)
    const manifestEntry = audioKey && !state.edits[audioKey] ? AUDIO_MANIFEST[audioKey] : null;

    if (manifestEntry && manifestEntry.file) {
      if (btnEl) btnEl.classList.add("speaking");
      neuralAudioPlayer.src = manifestEntry.file;
      // Preserve natural human pitch even when slowed down (0.78x is optimal for shadowing)
      const targetRate = rate < 1.0 ? 0.78 : 1.0;
      neuralAudioPlayer.playbackRate = targetRate;
      neuralAudioPlayer.defaultPlaybackRate = targetRate;
      if ("preservesPitch" in neuralAudioPlayer) neuralAudioPlayer.preservesPitch = true;
      if ("webkitPreservesPitch" in neuralAudioPlayer) neuralAudioPlayer.webkitPreservesPitch = true;
      if ("mozPreservesPitch" in neuralAudioPlayer) neuralAudioPlayer.mozPreservesPitch = true;

      neuralAudioPlayer.onended = () => {
        if (btnEl) btnEl.classList.remove("speaking");
        if (onEndCallback) onEndCallback();
      };
      neuralAudioPlayer.onerror = () => {
        if (btnEl) btnEl.classList.remove("speaking");
        // Fallback to Web Speech API if offline and MP3 not cached yet
        speakFallbackBrowserTTS(rawJpText, rate, btnEl, onEndCallback);
      };

      neuralAudioPlayer.play().catch(() => {
        speakFallbackBrowserTTS(rawJpText, rate, btnEl, onEndCallback);
      });
      return;
    }

    speakFallbackBrowserTTS(rawJpText, rate, btnEl, onEndCallback);
  }

  function speakFallbackBrowserTTS(rawJpText, rate = 1.0, btnEl = null, onEndCallback = null) {
    if (!("speechSynthesis" in window)) {
      showToast("⚠️ 当前浏览器不支持语音合成");
      if (onEndCallback) onEndCallback();
      return;
    }
    const cleanText = stripFurigana(rawJpText);
    const utter = new SpeechSynthesisUtterance(cleanText);
    utter.lang = "ja-JP";
    if (jpVoice) utter.voice = jpVoice;
    utter.rate = rate < 1.0 ? 0.8 : 1.0;
    utter.pitch = 1.0;

    if (btnEl) btnEl.classList.add("speaking");
    utter.onend = () => {
      if (btnEl) btnEl.classList.remove("speaking");
      if (onEndCallback) onEndCallback();
    };
    utter.onerror = () => {
      if (btnEl) btnEl.classList.remove("speaking");
      if (onEndCallback) onEndCallback();
    };
    window.speechSynthesis.speak(utter);
  }

  // Play an entire multi-turn dialogue sequentially with multi-character Neural Voices
  function playDialogue(dialogueId) {
    if (state.playingDialogueId === dialogueId) {
      state.stopDialogueRequested = true;
      state.playingDialogueId = null;
      stopAllAudio();
      document.querySelectorAll(".dialogue-turn.active-playing").forEach((el) => el.classList.remove("active-playing"));
      renderAll();
      return;
    }

    const allMods = getEffectiveModules();
    let foundDialogue = null;
    for (const mod of allMods) {
      const d = (mod.dialogues || []).find((x) => x.id === dialogueId);
      if (d) {
        foundDialogue = d;
        break;
      }
    }
    if (!foundDialogue || !foundDialogue.turns.length) return;

    state.playingDialogueId = dialogueId;
    state.stopDialogueRequested = false;
    renderAll();

    let idx = 0;
    function playNextTurn() {
      if (state.stopDialogueRequested || state.playingDialogueId !== dialogueId || idx >= foundDialogue.turns.length) {
        state.playingDialogueId = null;
        document.querySelectorAll(".dialogue-turn.active-playing").forEach((el) => el.classList.remove("active-playing"));
        renderAll();
        return;
      }
      const turn = foundDialogue.turns[idx];
      const turnAudioKey = `${dialogueId}-turn-${idx}`;
      const turnDomId = `turn-${dialogueId}-${idx}`;
      document.querySelectorAll(".dialogue-turn.active-playing").forEach((el) => el.classList.remove("active-playing"));
      const turnEl = document.getElementById(turnDomId);
      if (turnEl) {
        turnEl.classList.add("active-playing");
        turnEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
      idx++;
      speakJapanese(turn.jp, 1.0, null, () => {
        setTimeout(playNextTurn, 420);
      }, turnAudioKey);
    }

    playNextTurn();
  }

  // Toggle Starred / Mastered
  function toggleStar(itemId) {
    if (state.starred[itemId]) {
      delete state.starred[itemId];
      showToast("已取消收藏");
    } else {
      state.starred[itemId] = true;
      showToast("⭐ 已加入「必背收藏夹」");
    }
    saveUserState();
    renderAll();
  }

  function toggleMastered(itemId) {
    if (state.mastered[itemId]) {
      delete state.mastered[itemId];
    } else {
      state.mastered[itemId] = true;
      showToast("✅ 太棒了！已标记为背熟");
    }
    saveUserState();
    renderAll();
  }

  // Find item by ID across effective modules
  function findPhraseById(itemId) {
    for (const mod of getEffectiveModules()) {
      for (const sec of mod.sections || []) {
        for (const it of sec.items || []) {
          if (it.id === itemId) return { item: it, mod };
        }
      }
    }
    return null;
  }

  // Open In-App Add / Edit Phrase Modal
  function openPhraseEditorModal(editItemId = null) {
    const modal = document.getElementById("app-modal");
    const body = document.getElementById("modal-body-content");
    if (!modal || !body) return;

    const existing = editItemId ? findPhraseById(editItemId) : null;
    const item = existing ? existing.item : null;
    const defaultModId = existing ? existing.mod.id : 1;

    const modOptionsHtml = BASE_MODULES.map(
      (m) => `<option value="${m.id}" ${m.id === defaultModId ? "selected" : ""}>${m.id}. ${escapeHtml(m.title)}</option>`
    ).join("");

    body.innerHTML = `
      <div>
        <h2 style="font-size:1.28rem;font-weight:800;margin-bottom:0.2rem;">
          ${item ? "✏️ 编辑日语句子 / 添加专属备忘" : "➕ 新增自定义日语句子 / 旅途笔记"}
        </h2>
        <p style="font-size:0.84rem;color:var(--text-secondary);">
          支持在汉字后加全角括号假名（如：<code>東京（とうきょう）</code>），系统会自动渲染为汉字上方注音并支持语音朗读！
        </p>
        <div class="form-grid">
          ${
            !item || item.isCustom
              ? `
            <div class="form-group">
              <label>所属场景模块 (Module)</label>
              <select id="editor-mod-id">${modOptionsHtml}</select>
            </div>
          `
              : ""
          }
          <div class="form-group">
            <label>场景标签 (Tag · 如：保育园交代 / 滑雪柜号 / 点餐备注)</label>
            <input type="text" id="editor-tag" value="${escapeHtml(item ? item.tag : "夫妻新增")}" placeholder="例如：给 Jaycie 热牛奶" />
          </div>
          <div class="form-group">
            <label>日文句子 (Japanese · 可带 漢字（かな） 注音)</label>
            <textarea id="editor-jp" rows="3" placeholder="例如：すみません、子（こ）どものミルクを温（あたた）めていただけますか？">${escapeHtml(item ? item.jp : "")}</textarea>
          </div>
          <div class="form-group">
            <label>罗马音发音 (Romaji · 选填)</label>
            <input type="text" id="editor-romaji" value="${escapeHtml(item ? item.romaji : "")}" placeholder="例如：Sumimasen, kodomo no miruku wo atatamete itadakemasu ka?" />
          </div>
          <div class="form-group">
            <label>中文意思 (Chinese Meaning)</label>
            <input type="text" id="editor-cn" value="${escapeHtml(item ? item.cn : "")}" placeholder="例如：不好意思，能帮我热一下孩子的牛奶吗？" />
          </div>
          <div class="form-group">
            <label>💡 实用提示 / 个人备忘 (如：预约号、密码、尺码等 · 选填)</label>
            <textarea id="editor-tip" rows="2" placeholder="例如：12/16 银座山科包厢，记得提醒服务员 Sherry 的生牛肉改炙烤">${escapeHtml(item && item.tip ? item.tip : "")}</textarea>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:0.5rem;margin-top:0.35rem;">
            <div style="display:flex;gap:0.5rem;">
              <button class="action-btn primary-audio" id="editor-save-btn">💾 保存修改</button>
              <button class="action-btn" id="editor-test-audio-btn">🔊 试听日文发音</button>
            </div>
            <div>
              ${
                item && item.isCustom
                  ? `<button class="action-btn" id="editor-delete-btn" style="color:var(--accent-red);border-color:var(--accent-red);">🗑 删除此句</button>`
                  : item && item.isEdited
                  ? `<button class="action-btn" id="editor-reset-btn">↺ 恢复默认内容</button>`
                  : ""
              }
            </div>
          </div>
        </div>
      </div>
    `;
    modal.classList.add("open");

    document.getElementById("editor-test-audio-btn").onclick = function () {
      const jpVal = document.getElementById("editor-jp").value.trim();
      if (jpVal) speakJapanese(jpVal, 1.0, this);
    };

    document.getElementById("editor-save-btn").onclick = () => {
      const tag = document.getElementById("editor-tag").value.trim() || "实用句";
      const jp = document.getElementById("editor-jp").value.trim();
      const romaji = document.getElementById("editor-romaji").value.trim();
      const cn = document.getElementById("editor-cn").value.trim();
      const tip = document.getElementById("editor-tip").value.trim();

      if (!jp || !cn) {
        showToast("⚠️ 请至少填写「日文句子」和「中文意思」");
        return;
      }

      if (!item) {
        const modId = Number(document.getElementById("editor-mod-id").value);
        const newId = "custom-" + Date.now();
        state.customItems.unshift({
          id: newId,
          moduleId: modId,
          tag,
          jp,
          romaji,
          cn,
          tip
        });
        state.starred[newId] = true;
        showToast("✨ 已新增句子并自动加入「必背收藏夹」！");
      } else if (item.isCustom) {
        const modId = Number(document.getElementById("editor-mod-id").value);
        const idx = state.customItems.findIndex((x) => x.id === item.id);
        if (idx >= 0) {
          state.customItems[idx] = { ...state.customItems[idx], moduleId: modId, tag, jp, romaji, cn, tip };
        }
        showToast("✅ 已更新自定义句子");
      } else {
        state.edits[item.id] = { tag, jp, romaji, cn, tip };
        showToast("✅ 已保存对该句子的修改");
      }

      saveUserState();
      modal.classList.remove("open");
      renderAll();
    };

    const delBtn = document.getElementById("editor-delete-btn");
    if (delBtn) {
      delBtn.onclick = () => {
        state.customItems = state.customItems.filter((x) => x.id !== item.id);
        delete state.starred[item.id];
        delete state.mastered[item.id];
        saveUserState();
        modal.classList.remove("open");
        showToast("🗑 已删除自定义句子");
        renderAll();
      };
    }

    const resetBtn = document.getElementById("editor-reset-btn");
    if (resetBtn) {
      resetBtn.onclick = () => {
        delete state.edits[item.id];
        saveUserState();
        modal.classList.remove("open");
        showToast("↺ 已恢复默认句子内容");
        renderAll();
      };
    }
  }

  // Open Share with Sherry & Couple Sync Modal
  function openShareSyncModal() {
    const modal = document.getElementById("app-modal");
    const body = document.getElementById("modal-body-content");
    if (!modal || !body) return;

    const baseUrl = location.origin + location.pathname;
    const qrImgUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(baseUrl)}`;

    const customCount = state.customItems.length;
    const editCount = Object.keys(state.edits).length;
    const starCount = Object.keys(state.starred).length;

    body.innerHTML = `
      <div>
        <h2 style="font-size:1.3rem;font-weight:800;margin-bottom:0.25rem;">📲 分享给 Sherry & 夫妻双向同步</h2>
        <p style="font-size:0.86rem;color:var(--text-secondary);">
          让 Sherry 用手机扫码或点击链接即可打开。把网页<strong>「添加到手机主屏幕」</strong>后，即使在飞机上或日本地下铁无网也能 100% 离线使用！
        </p>

        <div class="share-box" style="display:flex;flex-wrap:wrap;gap:1.2rem;align-items:center;">
          <img src="${qrImgUrl}" alt="Web App QR Code" style="width:135px;height:135px;border-radius:10px;border:1px solid var(--border-color);background:#fff;padding:6px;" />
          <div style="flex:1;min-width:210px;">
            <div style="font-weight:800;font-size:0.96rem;margin-bottom:0.35rem;">📱 iPhone / Android 离线安装三步法：</div>
            <ol style="font-size:0.83rem;color:var(--text-secondary);padding-left:1.1rem;line-height:1.7;">
              <li>用手机相机扫描左侧二维码（或点击下方按钮发送给 Sherry）</li>
              <li>在 iPhone Safari 点击底部中间的<strong>「分享按钮 ⬆️」</strong></li>
              <li>向上滑选择<strong>「添加到主屏幕 (Add to Home Screen)」</strong>即可像原生 App 一样秒开！</li>
            </ol>
          </div>
        </div>

        <div class="share-box">
          <div style="font-weight:800;font-size:0.95rem;margin-bottom:0.25rem;">
            🔄 一键把我的「新增句子 / 修改 / ⭐收藏」同步给伴侣
          </div>
          <p style="font-size:0.82rem;color:var(--text-secondary);margin-bottom:0.65rem;">
            当前包含：<strong>${customCount} 条新增句</strong> · <strong>${editCount} 处修改</strong> · <strong>${starCount} 条 ⭐ 必背收藏</strong>。点击下方按钮生成专属同步链接发给对方，对方点开即自动合并！
          </p>
          <div style="display:flex;flex-wrap:wrap;gap:0.5rem;">
            <button class="action-btn primary-audio" id="btn-native-share">📤 发送同步链接给 Sherry (微信 / iMessage)</button>
            <button class="action-btn" id="btn-copy-sync-url">📋 复制同步链接</button>
            <button class="action-btn" id="btn-export-json">⬇️ 导出备份 JSON</button>
            <label class="action-btn" style="cursor:pointer;">
              ⬆️ 导入备份 JSON
              <input type="file" id="input-import-json" accept=".json" style="display:none;" />
            </label>
          </div>
        </div>
      </div>
    `;
    modal.classList.add("open");

    document.getElementById("btn-native-share").onclick = async () => {
      const url = generateSyncUrl();
      if (navigator.share) {
        try {
          await navigator.share({
            title: "日本家庭35晚旅行日语手册 (Haodong & Sherry)",
            text: "这是我们去日本35天旅行的全场景日语手册和最新收藏句子：",
            url
          });
          return;
        } catch (e) {}
      }
      navigator.clipboard.writeText(url);
      showToast("📋 已复制同步链接！可直接粘贴发给 Sherry");
    };

    document.getElementById("btn-copy-sync-url").onclick = () => {
      navigator.clipboard.writeText(generateSyncUrl());
      showToast("📋 已复制包含最新修改的同步链接！");
    };

    document.getElementById("btn-export-json").onclick = () => {
      const blob = new Blob(
        [
          JSON.stringify(
            {
              exportedAt: new Date().toISOString(),
              starred: state.starred,
              mastered: state.mastered,
              edits: state.edits,
              customItems: state.customItems
            },
            null,
            2
          )
        ],
        { type: "application/json" }
      );
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "japan-family-phrasebook-backup.json";
      a.click();
      showToast("⬇️ 已导出 JSON 备份文件");
    };

    document.getElementById("input-import-json").onchange = (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const data = JSON.parse(reader.result);
          if (data.starred) state.starred = { ...state.starred, ...data.starred };
          if (data.mastered) state.mastered = { ...state.mastered, ...data.mastered };
          if (data.edits) state.edits = { ...state.edits, ...data.edits };
          if (Array.isArray(data.customItems)) state.customItems = data.customItems;
          saveUserState();
          modal.classList.remove("open");
          showToast("🎉 成功导入备份数据！");
          renderAll();
        } catch (err) {
          showToast("⚠️ JSON 文件格式有误");
        }
      };
      reader.readAsText(file);
    };
  }

  // Open Fullscreen "Show to Staff" Card
  function openStaffCard(jp, cn, tag, audioKey = null) {
    const modal = document.getElementById("app-modal");
    const body = document.getElementById("modal-body-content");
    if (!modal || !body) return;

    const cleanJp = stripFurigana(jp);
    body.innerHTML = `
      <div>
        <span class="staff-card-badge">📱 指差し会話カード · 请直接出示给日本工作人员</span>
        <div style="font-size:0.85rem;color:var(--text-muted);margin-bottom:0.4rem;">${escapeHtml(tag || "日本人工作人员阅读区")}</div>
        <div class="staff-jp-huge">${formatRuby(jp)}</div>
        <div class="staff-cn-sub">🇨🇳 中文意思：${escapeHtml(cn)}</div>
        <div style="display:flex;gap:0.65rem;flex-wrap:wrap;">
          <button class="action-btn primary-audio" id="modal-speak-normal">🔊 真人发音朗读 (1.0x)</button>
          <button class="action-btn" id="modal-speak-slow">🐢 慢速朗读 (0.78x)</button>
          <button class="action-btn" id="modal-copy-jp">📋 复制纯日文</button>
        </div>
      </div>
    `;
    modal.classList.add("open");

    document.getElementById("modal-speak-normal").onclick = function () {
      speakJapanese(jp, 1.0, this, null, audioKey);
    };
    document.getElementById("modal-speak-slow").onclick = function () {
      speakJapanese(jp, 0.78, this, null, audioKey);
    };
    document.getElementById("modal-copy-jp").onclick = function () {
      navigator.clipboard.writeText(cleanJp);
      showToast("📋 已复制日文到剪贴板");
    };
  }

  // Open Hotel & Taxi Vault Modal
  function openHotelsVault() {
    const modal = document.getElementById("app-modal");
    const body = document.getElementById("modal-body-content");
    if (!modal || !body) return;

    const cardsHtml = ITINERARY.accommodations
      .map(
        (h, i) => `
      <div class="vault-item">
        <div class="vault-item-date">📅 ${escapeHtml(h.dates)}</div>
        <div class="vault-item-title">${escapeHtml(h.jpName)} <span style="font-weight:500;font-size:0.86rem;color:var(--text-muted);">(${escapeHtml(h.name)})</span></div>
        <div class="vault-item-address">📍 ${escapeHtml(h.address)}</div>
        <div style="font-size:0.82rem;color:var(--text-secondary);margin-bottom:0.6rem;">💡 ${escapeHtml(h.note)}</div>
        <div style="display:flex;gap:0.5rem;flex-wrap:wrap;">
          <button class="action-btn primary-audio vault-taxi-show" data-idx="${i}">📱 全屏出示给司机</button>
          <button class="action-btn vault-taxi-speak" data-idx="${i}">🔊 真人语音读给司机</button>
          <button class="action-btn vault-copy-addr" data-addr="${escapeHtml(h.address)}">📋 复制地址</button>
        </div>
      </div>
    `
      )
      .join("");

    body.innerHTML = `
      <div>
        <h2 style="font-size:1.3rem;font-weight:800;margin-bottom:0.25rem;">📍 全程7家酒店地址 & 出租车司机出示卡</h2>
        <p style="font-size:0.86rem;color:var(--text-secondary);">上出租车后点击「📱 全屏出示给司机」或「🔊 真人语音读给司机」即可一键直达酒店正门。</p>
        <div class="vault-grid">${cardsHtml}</div>
      </div>
    `;
    modal.classList.add("open");

    body.querySelectorAll(".vault-taxi-show").forEach((btn) => {
      btn.onclick = () => {
        const idx = Number(btn.dataset.idx);
        const h = ITINERARY.accommodations[idx];
        openStaffCard(
          `${h.taxiDriverText}（住所：${h.address}）`,
          `司机您好，麻烦去 ${h.jpName}（${h.address}）。`,
          `${h.dates} · 出租车目的地卡`,
          `taxi-${idx}`
        );
      };
    });
    body.querySelectorAll(".vault-taxi-speak").forEach((btn) => {
      btn.onclick = function () {
        const idx = Number(btn.dataset.idx);
        const h = ITINERARY.accommodations[idx];
        speakJapanese(h.taxiDriverText, 1.0, this, null, `taxi-${idx}`);
      };
    });
    body.querySelectorAll(".vault-copy-addr").forEach((btn) => {
      btn.onclick = () => {
        navigator.clipboard.writeText(btn.dataset.addr);
        showToast("📋 已复制酒店日文地址");
      };
    });
  }

  // Open Ginza 7th Anniversary Lunches Vault Modal
  function openGinzaVault() {
    const modal = document.getElementById("app-modal");
    const body = document.getElementById("modal-body-content");
    if (!modal || !body) return;

    const cardsHtml = ITINERARY.ginzaLunches
      .map(
        (g, i) => `
      <div class="vault-item">
        <div class="vault-item-date">🥂 ${escapeHtml(g.date)} · 预约号：${escapeHtml(g.resCode)}</div>
        <div class="vault-item-title">${escapeHtml(g.name)}</div>
        <div class="vault-item-address">📍 ${escapeHtml(g.address)}<br>🍽️ ${escapeHtml(g.course)}</div>
        <div style="font-size:0.82rem;color:var(--text-secondary);margin-bottom:0.6rem;">✨ ${escapeHtml(g.highlight)}</div>
        <div style="display:flex;gap:0.5rem;flex-wrap:wrap;">
          <button class="action-btn primary-audio ginza-checkin-btn" data-idx="${i}">📱 进店报预约出示卡</button>
          <button class="action-btn ginza-anniv-btn">🥂 7周年纪念日破冰神句</button>
        </div>
      </div>
    `
      )
      .join("");

    body.innerHTML = `
      <div>
        <h2 style="font-size:1.3rem;font-weight:800;margin-bottom:0.25rem;">🍣 银座夫妻结婚7周年 Omakase 午餐预约夹 (12/14–12/18)</h2>
        <p style="font-size:0.86rem;color:var(--text-secondary);">Jinny 和 Jaycie 在保育园期间的5场银座二人世界午餐预约信息与一键进店出示卡。</p>
        <div class="vault-grid">${cardsHtml}</div>
      </div>
    `;
    modal.classList.add("open");

    body.querySelectorAll(".ginza-checkin-btn").forEach((btn) => {
      btn.onclick = () => {
        const g = ITINERARY.ginzaLunches[Number(btn.dataset.idx)];
        openStaffCard(
          `こんにちは。本日予約（よやく）している劉（りゅう）［LIU Haodong］です。2名（にめい）です。（予約番号：${g.resCode}）`,
          `您好，我是今天有预约的刘 (LIU Haodong)，2位。（预约号：${g.resCode}）`,
          `${g.date} · ${g.name}`,
          "m7-s1-1"
        );
      };
    });
    body.querySelectorAll(".ginza-anniv-btn").forEach((btn) => {
      btn.onclick = () => {
        openStaffCard(
          "実（じつ）は今回（こんかい）、私（わたし）たちの結婚（けっこん）7周年（ななしゅうねん）のお祝（いわ）いでサンフランシスコから来（き）ました。普段（ふだん）は小（ちい）さい娘（むすめ）が2人（ふたり）いるのですが、今週（こんしゅう）は東京（とうきょう）の保育園（ほいくえん）に預（あず）けているので、夫婦（ふうふ）でゆっくりランチを楽（たの）しんでいます！",
          "其实这次我们是为了庆祝结婚7周年从旧金山来的。平时有两个小女儿，这周把她们送去了东京的保育园，夫妻俩才能悠闲地享受午餐！",
          "🥂 结婚7周年板前破冰神句",
          "m7-s1-3"
        );
      };
    });
  }

  // Filtering Logic
  function getFilteredModules() {
    const q = state.searchQuery.trim().toLowerCase();
    const legObj = ITINERARY.legs.find((l) => l.id === state.activeLeg) || ITINERARY.legs[0];
    const allowedModIds = new Set(legObj.modules);

    return getEffectiveModules()
      .filter((mod) => allowedModIds.has(mod.id))
      .map((mod) => {
        const filteredSections = (mod.sections || [])
          .map((sec) => {
            const items = (sec.items || []).filter((item) => {
              if (state.viewMode === "dialogues") return false;
              if (state.viewMode === "starred" && !state.starred[item.id]) return false;
              if (state.viewMode === "unmastered" && state.mastered[item.id]) return false;
              if (!q) return true;
              const hay = `${item.tag} ${item.jp} ${stripFurigana(item.jp)} ${item.romaji} ${item.cn} ${item.tip || ""}`.toLowerCase();
              return hay.includes(q);
            });
            return { ...sec, items };
          })
          .filter((sec) => sec.items.length > 0);

        const filteredDialogues = (mod.dialogues || []).filter((d) => {
          if (state.viewMode === "sentences" || state.viewMode === "starred" || state.viewMode === "unmastered") {
            return false;
          }
          if (!q) return true;
          const turnsText = d.turns.map((t) => `${t.speakerName} ${t.jp} ${stripFurigana(t.jp)} ${t.romaji} ${t.cn}`).join(" ");
          return `${d.title} ${d.context} ${turnsText}`.toLowerCase().includes(q);
        });

        return {
          ...mod,
          filteredSections,
          filteredDialogues
        };
      })
      .filter((mod) => mod.filteredSections.length > 0 || mod.filteredDialogues.length > 0);
  }

  // Render Leg Tabs & Context Banner (Updates in-place without destroying DOM or resetting scrollLeft)
  function renderLegTabs() {
    const container = document.getElementById("leg-tabs-container");
    const banner = document.getElementById("leg-context-banner");
    if (!container) return;

    if (container.children.length === 0) {
      container.innerHTML = ITINERARY.legs
        .map(
          (leg) => `
        <button type="button" class="leg-tab ${state.activeLeg === leg.id ? "active" : ""}" data-leg="${leg.id}">
          <span>${leg.icon}</span>
          <span>${escapeHtml(leg.shortTitle)}</span>
          <span class="leg-dates">(${escapeHtml(leg.dates)})</span>
        </button>
      `
        )
        .join("");

      container.querySelectorAll(".leg-tab").forEach((btn) => {
        btn.onclick = () => {
          state.activeLeg = btn.dataset.leg;
          renderAll();
          btn.scrollIntoView({ behavior: "smooth", inline: "nearest", block: "nearest" });
          if (state.appMode === "itinerary") {
            focusMapByLeg(state.activeLeg);
          }
        };
      });
    } else {
      container.querySelectorAll(".leg-tab").forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.leg === state.activeLeg);
      });
    }

    if (!banner) return;
    const currentLeg = ITINERARY.legs.find((l) => l.id === state.activeLeg);
    if (currentLeg && currentLeg.id !== "all") {
      banner.classList.add("visible");
      banner.innerHTML = `
        <div>
          <strong>${currentLeg.icon} ${escapeHtml(currentLeg.shortTitle)} (${escapeHtml(currentLeg.dates)}) · ${escapeHtml(currentLeg.hotel)}</strong>
          <div style="margin-top:0.15rem;color:var(--text-secondary);">${escapeHtml(currentLeg.summary)}</div>
        </div>
        <button type="button" class="action-btn" id="reset-leg-btn" style="flex-shrink:0;">查看全部18个模块</button>
      `;
      document.getElementById("reset-leg-btn").onclick = () => {
        state.activeLeg = "all";
        renderAll();
      };
    } else {
      banner.classList.remove("visible");
    }
  }

  // Render Sidebar Navigation & Progress
  function renderSidebar(filteredModules) {
    const listEl = document.getElementById("sidebar-module-list");
    const statsEl = document.getElementById("sidebar-total-stats");
    const mobileSelectEl = document.getElementById("mobile-module-select");

    const allMods = getEffectiveModules();
    let totalItems = 0;
    let totalMastered = 0;
    allMods.forEach((m) => {
      (m.sections || []).forEach((s) => {
        (s.items || []).forEach((it) => {
          totalItems++;
          if (state.mastered[it.id]) totalMastered++;
        });
      });
    });

    if (statsEl) {
      statsEl.textContent = `已背熟 ${totalMastered} / ${totalItems} 句`;
    }

    if (mobileSelectEl) {
      mobileSelectEl.innerHTML =
        `<option value="">📂 跳至模块 (${filteredModules.length}个 · 已背${totalMastered}/${totalItems})...</option>` +
        filteredModules
          .map(
            (mod) =>
              `<option value="module-${mod.id}">${mod.icon} ${mod.id}. ${escapeHtml(mod.title.replace(/（.*）/, ""))}</option>`
          )
          .join("");
    }

    if (!listEl) return;

    listEl.innerHTML = filteredModules
      .map((mod) => {
        let modTotal = 0;
        let modDone = 0;
        (mod.sections || []).forEach((s) =>
          (s.items || []).forEach((it) => {
            modTotal++;
            if (state.mastered[it.id]) modDone++;
          })
        );
        return `
        <li class="sidebar-item" data-target="module-${mod.id}">
          <span class="sidebar-item-title">
            <span>${mod.icon}</span>
            <span>${mod.id}. ${escapeHtml(mod.title.replace(/（.*）/, ""))}</span>
          </span>
          <span class="sidebar-progress">${modDone}/${modTotal}</span>
        </li>
      `;
      })
      .join("");

    listEl.querySelectorAll(".sidebar-item").forEach((li) => {
      li.onclick = () => {
        const el = document.getElementById(li.dataset.target);
        if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
      };
    });
  }

  // Render Main Modules & Dialogues
  function renderModules(filteredModules) {
    const mainEl = document.getElementById("modules-main-container");
    if (!mainEl) return;

    if (filteredModules.length === 0) {
      mainEl.innerHTML = `
        <div class="module-block" style="padding:2.5rem;text-align:center;">
          <div style="font-size:2.2rem;margin-bottom:0.5rem;">🔍</div>
          <h3 style="font-size:1.1rem;margin-bottom:0.35rem;">没有找到匹配的日语句子或对话</h3>
          <p style="font-size:0.88rem;color:var(--text-muted);margin-bottom:1rem;">请尝试更换搜索关键词，或点击右上角「➕ 新增句子」添加。</p>
          <button class="action-btn primary-audio" id="clear-filters-btn">重置所有筛选条件</button>
        </div>
      `;
      document.getElementById("clear-filters-btn").onclick = () => {
        state.activeLeg = "all";
        state.viewMode = "all";
        state.searchQuery = "";
        const searchInput = document.getElementById("search-input");
        if (searchInput) searchInput.value = "";
        renderAll();
      };
      return;
    }

    mainEl.innerHTML = filteredModules
      .map((mod) => {
        const sectionsHtml = mod.filteredSections
          .map(
            (sec) => `
          <div class="section-block">
            <h3 class="section-title">📌 ${escapeHtml(sec.title)}</h3>
            <div class="phrases-grid">
              ${sec.items
                .map((item) => {
                  const isStar = !!state.starred[item.id];
                  const isMast = !!state.mastered[item.id];
                  const voiceMeta = AUDIO_MANIFEST[item.id];
                  const voiceBadge = voiceMeta ? `<span style="font-size:0.72rem;color:var(--text-muted);margin-left:0.4rem;">🎙️ ${escapeHtml(voiceMeta.voice)}</span>` : "";
                  const badgeHtml = item.isCustom
                    ? `<span class="custom-badge">✨ 夫妻新增</span>`
                    : item.isEdited
                    ? `<span class="custom-badge">✏️ 已修改</span>`
                    : "";
                  const repliesHtml =
                    item.replies && item.replies.length
                      ? `
                    <div class="phrase-replies">
                      <div class="reply-label">👂 对方常见回答（听力预判 · 真人分角色发音）：</div>
                      ${item.replies
                        .map(
                          (rep, rIdx) => `
                        <div class="reply-item">
                          <div>
                            <div class="reply-jp">${formatRuby(rep.jp)}</div>
                            <div class="reply-cn">${escapeHtml(rep.cn)}</div>
                          </div>
                          <button class="action-btn speak-reply-btn" data-jp="${escapeHtml(rep.jp)}" data-akey="${item.id}-rep-${rIdx}">🔊 听对方说</button>
                        </div>
                      `
                        )
                        .join("")}
                    </div>
                  `
                      : "";

                  return `
                  <div class="phrase-card ${isMast ? "mastered" : ""} ${isStar ? "starred" : ""}" id="card-${item.id}">
                    <div class="phrase-top-bar">
                      <div>
                        <span class="phrase-tag">${escapeHtml(item.tag)}</span>
                        ${badgeHtml}
                        ${voiceBadge}
                      </div>
                      <div class="phrase-status-btns">
                        <button class="icon-btn edit-phrase-btn" data-edit="${item.id}" title="编辑此句或添加个人备忘">
                          ✏️ 编辑
                        </button>
                        <button class="icon-btn ${isStar ? "starred-active" : ""}" data-star="${item.id}" title="加入必背收藏">
                          ${isStar ? "⭐ 已收藏" : "☆ 收藏"}
                        </button>
                        <button class="icon-btn ${isMast ? "mastered-active" : ""}" data-master="${item.id}" title="标记为已背熟">
                          ${isMast ? "✅ 已背熟" : "○ 标记背熟"}
                        </button>
                      </div>
                    </div>
                    <div class="jp-text">${formatRuby(item.jp)}</div>
                    ${item.romaji ? `<div class="romaji-text">${escapeHtml(item.romaji)}</div>` : ""}
                    <div class="cn-text" title="点击显示中文">${escapeHtml(item.cn)}</div>
                    ${item.tip ? `<div class="phrase-tip">💡 <strong>实用提示：</strong>${escapeHtml(item.tip)}</div>` : ""}
                    ${repliesHtml}
                    <div class="phrase-actions">
                      <button class="action-btn primary-audio speak-normal-btn" data-jp="${escapeHtml(item.jp)}" data-akey="${item.id}">🔊 真人朗读 (1.0x)</button>
                      <button class="action-btn speak-slow-btn" data-jp="${escapeHtml(item.jp)}" data-akey="${item.id}">🐢 慢速跟读 (0.78x)</button>
                      <button class="action-btn show-staff-btn" data-jp="${escapeHtml(item.jp)}" data-cn="${escapeHtml(item.cn)}" data-tag="${escapeHtml(item.tag)}" data-akey="${item.id}">📱 出示给店员 (大字卡)</button>
                      <button class="action-btn copy-jp-btn" data-jp="${escapeHtml(item.jp)}">📋 复制</button>
                    </div>
                  </div>
                `;
                })
                .join("")}
            </div>
          </div>
        `
          )
          .join("");

        const dialoguesHtml =
          mod.filteredDialogues && mod.filteredDialogues.length
            ? `
          <div class="dialogues-section">
            <div class="dialogues-header">
              <div class="dialogues-heading">💬 实战双人情景对话演练 (男女声分角色真人发音)</div>
              <div style="font-size:0.8rem;color:var(--text-secondary);">点击「▶ 连续播放整段对话」聆听男女分角色对答；开启顶部「🎭 遮盖我方台词」可实战自测</div>
            </div>
            ${mod.filteredDialogues
              .map((dlg) => {
                const isPlaying = state.playingDialogueId === dlg.id;
                return `
                <div class="dialogue-box" id="dlg-${dlg.id}">
                  <div class="dialogue-box-top">
                    <div>
                      <div class="dialogue-title">${escapeHtml(dlg.title)}</div>
                      <div class="dialogue-context">📍 ${escapeHtml(dlg.context)}</div>
                    </div>
                    <button class="action-btn ${isPlaying ? "speaking" : "primary-audio"} play-dialogue-btn" data-dlg="${dlg.id}">
                      ${isPlaying ? "⏹ 停止连续播放" : "▶ 连续播放整段对话"}
                    </button>
                  </div>
                  <div class="dialogue-turns">
                    ${dlg.turns
                      .map((turn, tIdx) => {
                        const turnKey = `${dlg.id}-turn-${tIdx}`;
                        const vMeta = AUDIO_MANIFEST[turnKey];
                        const vLabel = vMeta ? ` · ${vMeta.voice}` : "";
                        return `
                      <div class="dialogue-turn ${turn.speaker === "us" ? "turn-us" : "turn-them"}" id="turn-${dlg.id}-${tIdx}">
                        <div class="turn-speaker">
                          <span>${turn.speaker === "us" ? "👨‍👩‍👧‍👧 " : "🇯🇵 "}${escapeHtml(turn.speakerName)}<span style="font-weight:500;opacity:0.78;">${escapeHtml(vLabel)}</span></span>
                          <span style="display:flex;gap:0.35rem;">
                            <button class="icon-btn speak-normal-btn" data-jp="${escapeHtml(turn.jp)}" data-akey="${turnKey}">🔊 1.0x</button>
                            <button class="icon-btn speak-slow-btn" data-jp="${escapeHtml(turn.jp)}" data-akey="${turnKey}">🐢 0.78x</button>
                            <button class="icon-btn show-staff-btn" data-jp="${escapeHtml(turn.jp)}" data-cn="${escapeHtml(turn.cn)}" data-tag="${escapeHtml(dlg.title)}" data-akey="${turnKey}">📱 大字</button>
                          </span>
                        </div>
                        <div class="jp-text" style="font-size:1.08rem;margin:0.15rem 0;">${formatRuby(turn.jp)}</div>
                        <div class="romaji-text" style="margin-bottom:0.2rem;">${escapeHtml(turn.romaji)}</div>
                        <div class="cn-text" style="margin-bottom:0;">${escapeHtml(turn.cn)}</div>
                        ${turn.note ? `<div class="turn-note">💡 ${escapeHtml(turn.note)}</div>` : ""}
                      </div>
                    `;
                      })
                      .join("")}
                  </div>
                </div>
              `;
              })
              .join("")}
          </div>
        `
            : "";

        return `
        <article class="module-block" id="module-${mod.id}">
          <header class="module-header">
            <div class="module-title-row">
              <span class="module-badge">${escapeHtml(mod.number)}</span>
              <h2 class="module-title">${mod.icon} ${escapeHtml(mod.title)}</h2>
              <span class="module-en-title">${escapeHtml(mod.enTitle)}</span>
            </div>
            <p class="module-summary">${escapeHtml(mod.summary)}</p>
          </header>
          ${sectionsHtml}
          ${dialoguesHtml}
        </article>
      `;
      })
      .join("");

    // Bind events inside modules
    mainEl.querySelectorAll(".speak-normal-btn").forEach((btn) => {
      btn.onclick = function () {
        speakJapanese(this.dataset.jp, 1.0, this, null, this.dataset.akey);
      };
    });
    mainEl.querySelectorAll(".speak-slow-btn").forEach((btn) => {
      btn.onclick = function () {
        speakJapanese(this.dataset.jp, 0.78, this, null, this.dataset.akey);
      };
    });
    mainEl.querySelectorAll(".speak-reply-btn").forEach((btn) => {
      btn.onclick = function () {
        speakJapanese(this.dataset.jp, 1.0, this, null, this.dataset.akey);
      };
    });
    mainEl.querySelectorAll(".show-staff-btn").forEach((btn) => {
      btn.onclick = function () {
        openStaffCard(this.dataset.jp, this.dataset.cn, this.dataset.tag, this.dataset.akey);
      };
    });
    mainEl.querySelectorAll(".copy-jp-btn").forEach((btn) => {
      btn.onclick = function () {
        navigator.clipboard.writeText(stripFurigana(this.dataset.jp));
        showToast("📋 已复制日文句子");
      };
    });
    mainEl.querySelectorAll(".edit-phrase-btn").forEach((btn) => {
      btn.onclick = function () {
        openPhraseEditorModal(this.dataset.edit);
      };
    });
    mainEl.querySelectorAll("[data-star]").forEach((btn) => {
      btn.onclick = function () {
        toggleStar(this.dataset.star);
      };
    });
    mainEl.querySelectorAll("[data-master]").forEach((btn) => {
      btn.onclick = function () {
        toggleMastered(this.dataset.master);
      };
    });
    mainEl.querySelectorAll(".play-dialogue-btn").forEach((btn) => {
      btn.onclick = function () {
        playDialogue(this.dataset.dlg);
      };
    });
    mainEl.querySelectorAll(".dialogue-turn.turn-us").forEach((turnEl) => {
      turnEl.onclick = function (e) {
        if (e.target.closest("button")) return;
        this.classList.toggle("revealed");
      };
    });
  }

  // =========================================================================
  // VISUAL ITINERARY & INTERACTIVE LEAFLET MAP ENGINE
  // =========================================================================
  let leafletMap = null;
  let leafletMarkers = {};
  let itineraryInitialized = false;

  function getGoogleMapsUrl(name, address) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(name + " " + address)}`;
  }

  function getAppleMapsUrl(name, address) {
    return `https://maps.apple.com/?q=${encodeURIComponent(name + " " + address)}`;
  }

  function buildAllMapPins() {
    const pins = [];

    // 7 Hotels
    (ITINERARY.accommodations || []).forEach((h, idx) => {
      pins.push({
        id: h.id || `hotel-${idx}`,
        legId: h.legId || "leg1",
        type: "hotel",
        badge: `🏨 住宿 · ${h.dates}`,
        icon: "🏨",
        color: "#2563eb",
        title: `${h.jpName} (${h.name})`,
        address: h.address,
        note: h.note,
        lat: h.lat,
        lng: h.lng,
        taxiText: h.taxiDriverText,
        audioKey: `taxi-${idx}`
      });
    });

    // 5 Ginza Anniversary Restaurants
    (ITINERARY.ginzaLunches || []).forEach((g, idx) => {
      pins.push({
        id: g.id || `ginza-${idx}`,
        legId: "leg4",
        type: "ginza",
        badge: `🍣 7周年午餐 · ${g.date}`,
        icon: "🍣",
        color: "#db2777",
        title: g.name,
        address: g.address,
        note: `${g.statusLabel} · ${g.resCode} · ${g.course}`,
        lat: g.lat,
        lng: g.lng,
        taxiText: `運転手さん、銀座の「${g.jpName}」（${g.address}）までお願いします。`,
        audioKey: "m7-s1-1"
      });
    });

    // Key Landmarks & Airports
    (ITINERARY.landmarks || []).forEach((lm) => {
      pins.push({
        id: lm.id,
        legId: lm.legId,
        type: lm.category,
        badge: `${lm.icon} 枢纽/地标`,
        icon: lm.icon,
        color: "#059669",
        title: lm.name,
        address: lm.address,
        note: lm.note,
        lat: lm.lat,
        lng: lm.lng,
        taxiText: `運転手さん、「${lm.jpName}」（${lm.address}）までお願いします。`,
        audioKey: null
      });
    });

    return pins;
  }

  function initOrUpdateMap() {
    const mapEl = document.getElementById("trip-leaflet-map");
    const listEl = document.getElementById("map-pin-list");
    if (!mapEl || !listEl) return;

    const allPins = buildAllMapPins();

    // Filter pins for sidebar directory
    const visiblePins = allPins.filter((p) => {
      if (state.activeLeg !== "all") return p.legId === state.activeLeg;
      if (state.mapRegion === "ginza") return p.type === "ginza";
      if (state.mapRegion === "karuizawa") return p.legId === "leg3";
      if (state.mapRegion === "kyushu") return p.legId === "leg5";
      if (state.mapRegion === "tokyo") return ["leg1", "leg2", "leg4", "leg6"].includes(p.legId);
      return true;
    });

    listEl.innerHTML = visiblePins
      .map(
        (p) => `
      <div class="map-pin-item" data-pinid="${p.id}">
        <div class="map-pin-item-top">
          <span>${escapeHtml(p.badge)}</span>
        </div>
        <div class="map-pin-item-title">${p.icon} ${escapeHtml(p.title)}</div>
        <div class="map-pin-item-addr">📍 ${escapeHtml(p.address)}</div>
        <div style="font-size:0.72rem;color:var(--text-secondary);margin-bottom:0.38rem;">${escapeHtml(p.note)}</div>
        <div class="map-pin-item-actions">
          <button type="button" class="mini-link-btn pin-focus-btn" data-pinid="${p.id}">🎯 地图定位</button>
          <a class="mini-link-btn" href="${getGoogleMapsUrl(p.title, p.address)}" target="_blank" rel="noopener">🗺️ Google Maps</a>
          <a class="mini-link-btn" href="${getAppleMapsUrl(p.title, p.address)}" target="_blank" rel="noopener">🍎 Apple Maps</a>
          <button type="button" class="mini-link-btn pin-taxi-btn" data-pinid="${p.id}">🚕 给司机看</button>
        </div>
      </div>
    `
      )
      .join("");

    listEl.querySelectorAll(".pin-focus-btn").forEach((btn) => {
      btn.onclick = (e) => {
        e.stopPropagation();
        focusSinglePin(btn.dataset.pinid);
      };
    });

    listEl.querySelectorAll(".map-pin-item").forEach((card) => {
      card.onclick = (e) => {
        if (e.target.closest("a, button")) return;
        focusSinglePin(card.dataset.pinid);
      };
    });

    listEl.querySelectorAll(".pin-taxi-btn").forEach((btn) => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const pin = allPins.find((x) => x.id === btn.dataset.pinid);
        if (pin) {
          openStaffCard(
            `${pin.taxiText}（住所：${pin.address}）`,
            `司机您好，麻烦去 ${pin.title}（${pin.address}）。`,
            pin.badge,
            pin.audioKey
          );
        }
      };
    });

    // Initialize Leaflet Map once if Leaflet is loaded
    if (typeof window.L === "undefined") {
      mapEl.innerHTML = `<div style="padding:2rem;text-align:center;color:var(--text-secondary);">📡 离线模式下地图瓦片暂不可用，请使用右侧地标列表一键唤起 Google/Apple Maps 或出租车地址卡。</div>`;
      return;
    }

    if (!leafletMap) {
      leafletMap = L.map("trip-leaflet-map", {
        center: [35.65, 139.75],
        zoom: 10,
        scrollWheelZoom: false
      });

      L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>',
        subdomains: "abcd",
        maxZoom: 19
      }).addTo(leafletMap);

      allPins.forEach((p) => {
        if (!p.lat || !p.lng) return;
        const icon = L.divIcon({
          className: "",
          html: `<div class="custom-map-pin" style="background:${p.color};">${p.icon}</div>`,
          iconSize: [32, 32],
          iconAnchor: [16, 16],
          popupAnchor: [0, -16]
        });

        const popupHtml = `
          <div style="min-width:210px;font-family:sans-serif;">
            <div style="font-size:11px;font-weight:700;color:#4f46e5;margin-bottom:2px;">${escapeHtml(p.badge)}</div>
            <div style="font-size:14px;font-weight:800;margin-bottom:4px;">${escapeHtml(p.title)}</div>
            <div style="font-size:12px;color:#475569;margin-bottom:4px;">📍 ${escapeHtml(p.address)}</div>
            <div style="font-size:11px;color:#64748b;margin-bottom:8px;">${escapeHtml(p.note)}</div>
            <div style="display:flex;gap:6px;flex-wrap:wrap;">
              <a href="${getGoogleMapsUrl(p.title, p.address)}" target="_blank" rel="noopener" style="font-size:11px;font-weight:700;padding:3px 7px;background:#eef2ff;color:#4338ca;border-radius:5px;text-decoration:none;">🗺️ Google Maps</a>
              <a href="${getAppleMapsUrl(p.title, p.address)}" target="_blank" rel="noopener" style="font-size:11px;font-weight:700;padding:3px 7px;background:#f1f5f9;color:#1e293b;border-radius:5px;text-decoration:none;">🍎 Apple Maps</a>
            </div>
          </div>
        `;

        const marker = L.marker([p.lat, p.lng], { icon }).addTo(leafletMap).bindPopup(popupHtml);
        leafletMarkers[p.id] = { marker, pin: p };
      });

      // Draw route polyline connecting the 7 stays in chronological order
      const routeCoords = [
        [35.7647, 140.3863], // NRT T1
        [35.7825, 140.3802], // Nikko Narita
        [35.6267, 139.7361], // Prince Sakura Tower
        [36.3402, 138.6416], // Karuizawa Prince East
        [35.6258, 139.7347], // Grand Prince Shin Takanawa
        [35.6695, 139.764],  // Ginza
        [33.5902, 130.4111], // Grand Hyatt Fukuoka
        [33.2669, 131.3688], // Yufuin Kamenoi Bessou
        [33.5902, 130.4111], // Grand Hyatt Fukuoka
        [35.6554, 139.7547]  // Hamamatsucho Airbnb
      ];
      L.polyline(routeCoords, {
        color: "#4f46e5",
        weight: 3,
        opacity: 0.65,
        dashArray: "6, 8"
      }).addTo(leafletMap);
    }

    setTimeout(() => {
      if (leafletMap) leafletMap.invalidateSize();
    }, 120);
  }

  function focusSinglePin(pinId) {
    if (!leafletMap || !leafletMarkers[pinId]) return;
    const { marker, pin } = leafletMarkers[pinId];
    leafletMap.flyTo([pin.lat, pin.lng], 16, { duration: 0.7 });
    marker.openPopup();
    const mapCard = document.getElementById("trip-leaflet-map");
    if (mapCard && window.innerWidth < 768) {
      mapCard.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }

  function focusMapByRegion(region) {
    state.mapRegion = region;
    document.querySelectorAll("[data-mapregion]").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.mapregion === region);
    });
    initOrUpdateMap();
    if (!leafletMap) return;
    if (region === "all") leafletMap.flyTo([35.1, 135.8], 5, { duration: 0.8 });
    else if (region === "tokyo") leafletMap.flyTo([35.68, 139.92], 10, { duration: 0.8 });
    else if (region === "ginza") leafletMap.flyTo([35.6695, 139.7642], 16, { duration: 0.8 });
    else if (region === "karuizawa") leafletMap.flyTo([36.341, 138.638], 14, { duration: 0.8 });
    else if (region === "kyushu") leafletMap.flyTo([33.43, 130.89], 9, { duration: 0.8 });
  }

  function focusMapByLeg(legId) {
    if (!leafletMap) return;
    const leg = ITINERARY.legs.find((l) => l.id === legId);
    if (leg && leg.mapCenter) {
      leafletMap.flyTo(leg.mapCenter, leg.mapZoom || 12, { duration: 0.8 });
    }
  }

  function build36DaysCalendar() {
    const days = [
      { d: "12/5", dow: "周六", leg: "leg1", color: "#2563eb", city: "✈️ 旧金山出发", sub: "ZG025 15:35起飞" },
      { d: "12/6", dow: "周日", leg: "leg1", color: "#2563eb", city: "✈️ 抵达成田", sub: "19:55抵 · 日航成田" },
      { d: "12/7", dow: "周一", leg: "leg2", color: "#4f46e5", city: "🗼 东京高轮", sub: "N'EX→品川樱花塔" },
      { d: "12/8", dow: "周二", leg: "leg2", color: "#4f46e5", city: "🗼 东京高轮", sub: "庭园散步·倒时差" },
      { d: "12/9", dow: "周三", leg: "leg3", color: "#0284c7", city: "⛷️ 轻井泽滑雪", sub: "寄大箱→新干线" },
      { d: "12/10", dow: "周四", leg: "leg3", color: "#0284c7", city: "⛷️ 轻井泽滑雪", sub: "Jinny滑雪课·玩雪" },
      { d: "12/11", dow: "周五", leg: "leg3", color: "#0284c7", city: "⛷️ 轻井泽滑雪", sub: "滑雪·温泉·奥莱" },
      { d: "12/12", dow: "周六", leg: "leg4", color: "#db2777", city: "🗼 返东京高轮", sub: "入住新高轮王子" },
      { d: "12/13", dow: "周日", leg: "leg4", color: "#db2777", city: "👨‍👩‍👧‍👧 东京亲子日", sub: "保育园行前准备" },
      { d: "12/14", dow: "周一", leg: "leg4", color: "#db2777", city: "🍣 银座おのでら", sub: "保育园D1·11:00(待绑卡)" },
      { d: "12/15", dow: "周二", leg: "leg4", color: "#db2777", city: "🍤 银座よこ田", sub: "保育园D2·11:30天妇罗" },
      { d: "12/16", dow: "周三", leg: "leg4", color: "#db2777", city: "🥩 银座山科(包厢)", sub: "保育园D3·12:00牛排" },
      { d: "12/17", dow: "周四", leg: "leg4", color: "#db2777", city: "🥩 银座五明铁板", sub: "保育园D4·12:00秋田牛" },
      { d: "12/18", dow: "周五", leg: "leg4", color: "#db2777", city: "🍶 银座Ukai割烹", sub: "保育园D5·12:00收官" },
      { d: "12/19", dow: "周六", leg: "leg5", color: "#ea580c", city: "✈️ 飞九州福冈", sub: "HND→FUK·福冈君悦" },
      { d: "12/20", dow: "周日", leg: "leg5", color: "#ea580c", city: "🍜 福冈博多", sub: "运河城·博多豚骨拉面" },
      { d: "12/21", dow: "周一", leg: "leg5", color: "#ea580c", city: "♨️ 由布院温泉", sub: "寄大箱→龟之井别庄" },
      { d: "12/22", dow: "周二", leg: "leg5", color: "#ea580c", city: "♨️ 金鳞湖→福冈", sub: "晨雾散步→回福冈君悦" },
      { d: "12/23", dow: "周三", leg: "leg5", color: "#ea580c", city: "🎄 福冈圣诞周", sub: "福冈君悦·九州慢游" },
      { d: "12/24", dow: "周四", leg: "leg5", color: "#ea580c", city: "🎄 平安夜福冈", sub: "博多圣诞市集灯光秀" },
      { d: "12/25", dow: "周五", leg: "leg5", color: "#ea580c", city: "🎅 圣诞节九州", sub: "熊本/门司港或市内游" },
      { d: "12/26", dow: "周六", leg: "leg5", color: "#ea580c", city: "🍜 福冈收官日", sub: "屋台美食·伴手礼采购" },
      { d: "12/27", dow: "周日", leg: "leg6", color: "#059669", city: "🚝 飞羽田→浜松町", sub: "单轨15m直达Airbnb" },
      { d: "12/28", dow: "周一", leg: "leg6", color: "#059669", city: "🗼 浜松町·芝公园", sub: "东京塔散步·超市采购" },
      { d: "12/29", dow: "周二", leg: "leg6", color: "#059669", city: "🗼 东京深度游", sub: "山手线/大江户线溜娃" },
      { d: "12/30", dow: "周三", leg: "leg6", color: "#059669", city: "🗼 岁末东京", sub: "年末采买·亲子乐园" },
      { d: "12/31", dow: "周四", leg: "leg6", color: "#059669", city: "⛩️ 除夕大晦日", sub: "年越荞麦面·增上寺跨年" },
      { d: "1/1", dow: "周五", leg: "leg6", color: "#059669", city: "🎍 元旦初诣", sub: "增上寺新年参拜求御守" },
      { d: "1/2", dow: "周六", leg: "leg6", color: "#059669", city: "🛍️ 新年初卖福袋", sub: "百货初売り·皇居新年" },
      { d: "1/3", dow: "周日", leg: "leg6", color: "#059669", city: "🗼 东京新年周", sub: "浜松町温馨公寓生活" },
      { d: "1/4", dow: "周一", leg: "leg6", color: "#059669", city: "🗼 东京探索", sub: "美术馆/亲子博物馆" },
      { d: "1/5", dow: "周二", leg: "leg6", color: "#059669", city: "🗼 东京探索", sub: "浅草/上野/台场溜娃" },
      { d: "1/6", dow: "周三", leg: "leg6", color: "#059669", city: "🗼 东京探索", sub: "渋谷/新宿/银座逛街" },
      { d: "1/7", dow: "周四", leg: "leg6", color: "#059669", city: "🥣 七草粥之日", sub: "东京社区慢生活" },
      { d: "1/8", dow: "周五", leg: "leg6", color: "#059669", city: "🛍️ 伴手礼采购", sub: "药妆/免税店打包整理" },
      { d: "1/9", dow: "周六", leg: "leg6", color: "#059669", city: "🧳 返程前夕整理", sub: "检查2×30kg托运行李" },
      { d: "1/10", dow: "周日", leg: "leg6", color: "#059669", city: "✈️ 21:25返旧金山", sub: "ZG026同日13:45抵SFO" }
    ];
    return days;
  }

  function renderItineraryView() {
    // 1. KPI Strip
    const kpiEl = document.getElementById("itin-kpi-strip");
    if (kpiEl && !itineraryInitialized) {
      kpiEl.innerHTML = `
        <div class="kpi-card">
          <div class="kpi-icon">🗓️</div>
          <div>
            <div class="kpi-val">35 晚 / 37 天</div>
            <div class="kpi-label">2026.12.5 – 2027.1.10</div>
          </div>
        </div>
        <div class="kpi-card">
          <div class="kpi-icon">🏨</div>
          <div>
            <div class="kpi-val">7 家精选酒店/公寓</div>
            <div class="kpi-label">成田·高轮·轻井泽·福冈·由布院·浜松町</div>
          </div>
        </div>
        <div class="kpi-card">
          <div class="kpi-icon">🥂</div>
          <div>
            <div class="kpi-val">5 场银座7周年午餐</div>
            <div class="kpi-label">12/14–12/18 姐妹保育园周</div>
          </div>
        </div>
        <div class="kpi-card">
          <div class="kpi-icon">✈️</div>
          <div>
            <div class="kpi-val">ZIPAIR #CYBNOT</div>
            <div class="kpi-label">SFO ⇄ NRT T1 · 2×30kg行李</div>
          </div>
        </div>
      `;
    }

    // 2. Interactive Map & Directory
    initOrUpdateMap();

    // 3. 36-Day Calendar Strip
    const calEl = document.getElementById("itin-calendar-grid");
    if (calEl) {
      const days = build36DaysCalendar().filter((x) => state.activeLeg === "all" || x.leg === state.activeLeg);
      calEl.innerHTML = days
        .map(
          (day) => `
        <div class="cal-day-cell" style="border-top-color:${day.color};" data-targetleg="${day.leg}">
          <div class="cal-day-top">
            <span>${day.d}</span>
            <span class="cal-day-dow">${day.dow}</span>
          </div>
          <div class="cal-day-city">${escapeHtml(day.city)}</div>
          <div class="cal-day-sub">${escapeHtml(day.sub)}</div>
        </div>
      `
        )
        .join("");

      calEl.querySelectorAll(".cal-day-cell").forEach((cell) => {
        cell.onclick = () => {
          const target = document.getElementById(`itin-card-${cell.dataset.targetleg}`);
          if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
        };
      });
    }

    // 4. Leg-by-Leg Visual Timeline Cards
    const timelineEl = document.getElementById("itin-legs-timeline");
    if (timelineEl) {
      const legsToRender = ITINERARY.legs.filter(
        (l) => l.id !== "all" && (state.activeLeg === "all" || l.id === state.activeLeg)
      );

      timelineEl.innerHTML = legsToRender
        .map((leg) => {
          const modChips = (leg.modules || [])
            .map((mId) => {
              const modObj = BASE_MODULES.find((x) => x.id === mId);
              if (!modObj) return "";
              return `<button type="button" class="jump-module-chip" data-jumpmod="${mId}">${modObj.icon} ${mId}. ${escapeHtml(modObj.title.replace(/（.*）/, ""))}</button>`;
            })
            .join("");

          const hotelAcc = (ITINERARY.accommodations || []).find((a) => a.legId === leg.id);
          const gmapUrl = hotelAcc ? getGoogleMapsUrl(hotelAcc.jpName, hotelAcc.address) : "#";

          return `
          <article class="itin-leg-card" id="itin-card-${leg.id}">
            <div class="itin-leg-banner" style="border-left:5px solid ${leg.color || "#4f46e5"};">
              <div>
                <div class="itin-leg-title">
                  <span>${leg.icon}</span>
                  <span>${escapeHtml(leg.shortTitle)} · ${escapeHtml(leg.city)}</span>
                </div>
                <div style="font-size:0.82rem;color:var(--text-secondary);margin-top:0.2rem;">
                  ${escapeHtml(leg.summary)}
                </div>
              </div>
              <span class="itin-leg-dates-badge">${escapeHtml(leg.dates)}</span>
            </div>

            <div class="itin-leg-hotel-bar">
              <div>
                <strong>🏨 驻地酒店：${escapeHtml(leg.hotel)}</strong>
                <div style="font-size:0.76rem;color:var(--text-secondary);margin-top:0.1rem;">
                  📋 ${escapeHtml(leg.hotelConf || "")} · 📍 ${escapeHtml(leg.roomType || "")}
                </div>
              </div>
              <div style="display:flex;gap:0.4rem;flex-wrap:wrap;">
                <button type="button" class="mini-link-btn leg-map-focus-btn" data-leg="${leg.id}">🎯 地图聚焦本阶段</button>
                ${
                  hotelAcc
                    ? `<a class="mini-link-btn" href="${gmapUrl}" target="_blank" rel="noopener">🗺️ 酒店导航</a>`
                    : ""
                }
              </div>
            </div>

            <div class="itin-schedule-list">
              ${(leg.schedule || [])
                .map(
                  (s) => `
                <div class="itin-schedule-row">
                  <div>
                    <div class="itin-schedule-time">🕒 ${escapeHtml(s.time)}</div>
                    <span class="itin-schedule-tag">${escapeHtml(s.tag)}</span>
                  </div>
                  <div>
                    <div class="itin-schedule-title">${escapeHtml(s.title)}</div>
                    <div class="itin-schedule-desc">${escapeHtml(s.desc)}</div>
                  </div>
                </div>
              `
                )
                .join("")}
            </div>

            <div class="itin-leg-footer">
              <span style="font-size:0.76rem;font-weight:800;color:var(--text-secondary);">🗣️ 一键打开本阶段高频日语：</span>
              ${modChips}
            </div>
          </article>
        `;
        })
        .join("");

      timelineEl.querySelectorAll(".leg-map-focus-btn").forEach((btn) => {
        btn.onclick = () => {
          focusMapByLeg(btn.dataset.leg);
          const mapEl = document.getElementById("trip-leaflet-map");
          if (mapEl) mapEl.scrollIntoView({ behavior: "smooth", block: "center" });
        };
      });

      timelineEl.querySelectorAll(".jump-module-chip").forEach((chip) => {
        chip.onclick = () => {
          const modId = chip.dataset.jumpmod;
          state.appMode = "phrasebook";
          state.activeLeg = "all";
          renderAll();
          setTimeout(() => {
            const target = document.getElementById(`module-${modId}`);
            if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
          }, 80);
        };
      });
    }

    // 5. Ginza 7th Anniversary Lunch Deck
    const ginzaGrid = document.getElementById("itin-ginza-grid");
    if (ginzaGrid) {
      ginzaGrid.innerHTML = (ITINERARY.ginzaLunches || [])
        .map(
          (g, idx) => `
        <div class="ginza-card ${g.status}">
          <div>
            <div style="display:flex;justify-content:space-between;align-items:center;gap:0.4rem;margin-bottom:0.35rem;">
              <span style="font-size:0.8rem;font-weight:800;color:var(--accent-indigo);">📅 ${escapeHtml(g.date)}</span>
              <span class="ginza-status-badge ${g.status}">${escapeHtml(g.statusLabel)}</span>
            </div>
            <div style="font-size:1rem;font-weight:800;color:var(--text-primary);margin-bottom:0.25rem;">
              ${escapeHtml(g.name)}
            </div>
            <div style="font-size:0.78rem;color:var(--text-secondary);margin-bottom:0.25rem;">
              📍 ${escapeHtml(g.address)}
            </div>
            <div style="font-size:0.8rem;font-weight:700;color:var(--text-primary);margin-bottom:0.2rem;">
              🍽️ ${escapeHtml(g.course)}
            </div>
            <div style="font-size:0.78rem;color:var(--accent-emerald);font-weight:700;margin-bottom:0.2rem;">
              💴 ${escapeHtml(g.price)}
            </div>
            <div style="font-size:0.74rem;color:var(--text-muted);margin-bottom:0.35rem;">
              🎫 预约号：<strong>${escapeHtml(g.resCode)}</strong> · 取消政策：${escapeHtml(g.cancelPolicy || "")}
            </div>
            <div style="font-size:0.78rem;color:var(--text-secondary);background:var(--bg-card);padding:0.45rem 0.6rem;border-radius:6px;border:1px solid var(--border-color);">
              ✨ ${escapeHtml(g.highlight)}
            </div>
          </div>
          <div style="display:flex;flex-wrap:wrap;gap:0.4rem;margin-top:0.3rem;">
            <a class="mini-link-btn" href="${getGoogleMapsUrl(g.jpName, g.address)}" target="_blank" rel="noopener">🗺️ Google Maps</a>
            <button type="button" class="mini-link-btn ginza-card-checkin" data-idx="${idx}">📱 进店报预约卡</button>
            <button type="button" class="mini-link-btn ginza-card-map" data-pinid="${g.id}">🎯 地图定位</button>
          </div>
        </div>
      `
        )
        .join("");

      ginzaGrid.querySelectorAll(".ginza-card-checkin").forEach((btn) => {
        btn.onclick = () => {
          const g = ITINERARY.ginzaLunches[Number(btn.dataset.idx)];
          openStaffCard(
            `こんにちは。本日予約（よやく）している劉（りゅう）［LIU Haodong］です。2名（にめい）です。（予約番号：${g.resCode}）`,
            `您好，我是今天有预约的刘 (LIU Haodong)，2位。（预约号：${g.resCode}）`,
            `${g.date} · ${g.name}`,
            "m7-s1-1"
          );
        };
      });

      ginzaGrid.querySelectorAll(".ginza-card-map").forEach((btn) => {
        btn.onclick = () => {
          focusSinglePin(btn.dataset.pinid);
          const mapEl = document.getElementById("trip-leaflet-map");
          if (mapEl) mapEl.scrollIntoView({ behavior: "smooth", block: "center" });
        };
      });
    }

    // 6. Flights & 3 Smart Luggage Hacks
    const flightsEl = document.getElementById("itin-flights-list");
    if (flightsEl && !itineraryInitialized) {
      flightsEl.innerHTML = (ITINERARY.flights || [])
        .map(
          (f) => `
        <div class="flight-card">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.3rem;">
            <span style="font-size:0.78rem;font-weight:800;color:var(--accent-indigo);">${escapeHtml(f.direction)} · ${escapeHtml(f.date)}</span>
            <span class="ginza-status-badge booked">Conf #${escapeHtml(f.confCode)}</span>
          </div>
          <div style="font-size:0.98rem;font-weight:800;margin-bottom:0.25rem;">
            ✈️ ${escapeHtml(f.airline)} ${escapeHtml(f.flightNo)}: ${escapeHtml(f.depAirport)} ➔ ${escapeHtml(f.arrAirport)}
          </div>
          <div style="font-size:0.82rem;font-weight:700;color:var(--text-primary);margin-bottom:0.25rem;">
            🕒 起飞 ${escapeHtml(f.depTime)} ➔ 抵达 ${escapeHtml(f.arrTime)}
          </div>
          <div style="font-size:0.78rem;color:var(--text-secondary);margin-bottom:0.35rem;">
            💺 座位：<strong>${escapeHtml(f.seats)}</strong> · 🧳 托运：<strong>${escapeHtml(f.baggage)}</strong>
          </div>
          <div style="font-size:0.78rem;color:var(--text-secondary);background:var(--bg-card);padding:0.45rem 0.6rem;border-radius:6px;border:1px solid var(--border-color);">
            💡 ${escapeHtml(f.note)}
          </div>
        </div>
      `
        )
        .join("");
    }

    const luggageEl = document.getElementById("itin-luggage-list");
    if (luggageEl && !itineraryInitialized) {
      luggageEl.innerHTML = (ITINERARY.luggageHacks || [])
        .map(
          (lh) => `
        <div class="luggage-card">
          <div style="font-size:0.76rem;font-weight:800;color:var(--accent-indigo);margin-bottom:0.2rem;">
            📅 ${escapeHtml(lh.date)}
          </div>
          <div style="font-size:0.94rem;font-weight:800;margin-bottom:0.2rem;">
            ${lh.icon} ${escapeHtml(lh.title)}
          </div>
          <div style="font-size:0.78rem;font-weight:700;color:var(--accent-emerald);margin-bottom:0.3rem;">
            📍 ${escapeHtml(lh.route)}
          </div>
          <div style="font-size:0.8rem;color:var(--text-secondary);line-height:1.5;">
            ${escapeHtml(lh.detail)}
          </div>
        </div>
      `
        )
        .join("");
    }

    itineraryInitialized = true;
  }

  // Sync body classes & toolbar buttons
  function syncToolbarUI() {
    document.body.classList.toggle("hide-furigana", !state.showFurigana);
    document.body.classList.toggle("hide-romaji", !state.showRomaji);
    document.body.classList.toggle("hide-cn", !state.showCn);
    document.body.classList.toggle("practice-mode", state.practiceMode);
    document.body.classList.toggle("dark-mode", state.darkMode);

    // Sync Primary App Mode (Itinerary & Map vs Phrasebook)
    const itinView = document.getElementById("itinerary-view-container");
    const phraseView = document.getElementById("phrasebook-view-container");
    const phraseToolbar = document.getElementById("phrasebook-toolbar-row");
    const toolbarCollapsible = document.getElementById("toolbar-collapsible");

    const isItin = state.appMode === "itinerary";
    if (itinView) itinView.style.display = isItin ? "flex" : "none";
    if (phraseView) phraseView.style.display = isItin ? "none" : "grid";
    if (phraseToolbar) phraseToolbar.style.display = isItin ? "none" : "flex";
    if (toolbarCollapsible && isItin) toolbarCollapsible.style.display = "none";
    else if (toolbarCollapsible && !isItin) toolbarCollapsible.style.display = "";

    document.querySelectorAll("[data-appmode]").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.appmode === state.appMode);
    });

    const setChip = (id, active, cls = "active") => {
      const el = document.getElementById(id);
      if (el) el.classList.toggle(cls, active);
    };

    setChip("toggle-furigana", state.showFurigana);
    setChip("toggle-romaji", state.showRomaji);
    setChip("toggle-cn", state.showCn);
    setChip("toggle-practice", state.practiceMode, "practice-active");
    setChip("toggle-dark", state.darkMode);

    document.querySelectorAll("[data-viewmode]").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.viewmode === state.viewMode);
    });
  }

  function renderAll() {
    syncToolbarUI();
    renderLegTabs();
    if (state.appMode === "itinerary") {
      renderItineraryView();
    } else {
      const filtered = getFilteredModules();
      renderSidebar(filtered);
      renderModules(filtered);
    }
  }

  // Initialize App
  window.addEventListener("DOMContentLoaded", () => {
    checkIncomingSyncHash();

    const searchInput = document.getElementById("search-input");
    const searchClear = document.getElementById("search-clear");
    if (searchInput) {
      searchInput.addEventListener("input", (e) => {
        state.searchQuery = e.target.value;
        if (searchClear) searchClear.style.display = state.searchQuery ? "block" : "none";
        renderAll();
      });
    }
    if (searchClear) {
      searchClear.onclick = () => {
        state.searchQuery = "";
        searchInput.value = "";
        searchClear.style.display = "none";
        renderAll();
      };
    }

    document.querySelectorAll("[data-viewmode]").forEach((btn) => {
      btn.onclick = () => {
        state.viewMode = btn.dataset.viewmode;
        renderAll();
      };
    });

    const bindToggle = (id, key) => {
      const el = document.getElementById(id);
      if (el) {
        el.onclick = () => {
          state[key] = !state[key];
          renderAll();
        };
      }
    };
    bindToggle("toggle-furigana", "showFurigana");
    bindToggle("toggle-romaji", "showRomaji");
    bindToggle("toggle-cn", "showCn");
    bindToggle("toggle-practice", "practiceMode");
    bindToggle("toggle-dark", "darkMode");

    const btnHotels = document.getElementById("btn-open-hotels");
    if (btnHotels) btnHotels.onclick = openHotelsVault;

    const btnGinza = document.getElementById("btn-open-ginza");
    if (btnGinza) btnGinza.onclick = openGinzaVault;

    const btnAddPhrase = document.getElementById("btn-add-phrase");
    if (btnAddPhrase) btnAddPhrase.onclick = () => openPhraseEditorModal(null);

    const btnShareSync = document.getElementById("btn-share-sync");
    if (btnShareSync) btnShareSync.onclick = openShareSyncModal;

    const btnStarred = document.getElementById("btn-filter-starred");
    if (btnStarred) {
      btnStarred.onclick = () => {
        state.appMode = "phrasebook";
        state.viewMode = state.viewMode === "starred" ? "all" : "starred";
        renderAll();
      };
    }

    // Bind Top-Level App Mode Switcher (Itinerary & Map vs Phrasebook)
    document.querySelectorAll("[data-appmode]").forEach((btn) => {
      btn.onclick = () => {
        state.appMode = btn.dataset.appmode;
        renderAll();
      };
    });

    // Bind Map Region Pills
    document.querySelectorAll("[data-mapregion]").forEach((btn) => {
      btn.onclick = () => {
        state.activeLeg = "all";
        renderLegTabs();
        focusMapByRegion(btn.dataset.mapregion);
      };
    });

    // Mobile Trip Info Drawer Toggle
    const btnToggleTripInfo = document.getElementById("btn-toggle-trip-info");
    const heroDetailsDrawer = document.getElementById("hero-details-drawer");
    if (btnToggleTripInfo && heroDetailsDrawer) {
      btnToggleTripInfo.onclick = () => {
        const isOpen = heroDetailsDrawer.classList.toggle("open");
        btnToggleTripInfo.textContent = isOpen ? "🔼 收起家庭行程简介" : "ℹ️ 行程简介";
      };
    }

    // Mobile Filter & Display Settings Drawer Toggle
    const btnToggleFilters = document.getElementById("btn-toggle-filters");
    const toolbarCollapsible = document.getElementById("toolbar-collapsible");
    if (btnToggleFilters && toolbarCollapsible) {
      btnToggleFilters.onclick = () => {
        const isOpen = toolbarCollapsible.classList.toggle("open");
        btnToggleFilters.classList.toggle("active", isOpen);
      };
    }

    // Mobile Quick-Jump Module Select
    const mobileModuleSelect = document.getElementById("mobile-module-select");
    if (mobileModuleSelect) {
      mobileModuleSelect.onchange = (e) => {
        const targetId = e.target.value;
        if (targetId) {
          const el = document.getElementById(targetId);
          if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
          e.target.value = "";
        }
      };
    }

    const modal = document.getElementById("app-modal");
    const modalClose = document.getElementById("modal-close-btn");
    if (modalClose) modalClose.onclick = () => modal.classList.remove("open");
    if (modal) {
      modal.onclick = (e) => {
        if (e.target === modal) modal.classList.remove("open");
      };
    }

    renderAll();
  });
})();
