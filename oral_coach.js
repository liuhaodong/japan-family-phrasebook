// Oral Follow-Reading & Pronunciation Coach (V10)
// Dual-Engine:
//   1. Built-in Zero-Config Local Engine: Corpus Kanji->Kana + Japanese Mora DP Alignment
//      + Web Audio Live Waveform & VAD Pace + Sokuon/Long-Vowel/Voicing/Ending Coaching
//   2. Optional Gemini AI Audio Coach (BYOK, gemini-3.8-flash Interactions API over 16kHz WAV)
(function () {
  const GEMINI_KEY_STORAGE = "jp_phrasebook_gemini_key_v1";
  const GEMINI_ENABLED_STORAGE = "jp_phrasebook_gemini_enabled_v1";

  // High-frequency fallback readings for unannotated kanji / counters / city names
  const FALLBACK_READINGS = {
    "一緒": "いっしょ",
    "一番": "いちばん",
    "大丈夫": "だいじょうぶ",
    "お願い": "おねがい",
    "お願": "おねが",
    "会計": "かいけい",
    "新幹線": "しんかんせん",
    "軽井沢": "かるいざわ",
    "由布院": "ゆふいん",
    "東京": "とうきょう",
    "大阪": "おおさか",
    "京都": "きょうと",
    "福岡": "ふくおか",
    "成田": "なりた",
    "銀座": "ぎんざ",
    "日本": "にほん",
    "日本語": "にほんご",
    "中国語": "ちゅうごくご",
    "英語": "えいご",
    "子ども": "こども",
    "子供": "こども",
    "お姉ちゃん": "おねえちゃん",
    "お兄ちゃん": "おにいちゃん",
    "お父さん": "おとうさん",
    "お母さん": "おかあさん",
    "今日": "きょう",
    "明日": "あした",
    "昨日": "きのう",
    "今年": "ことし",
    "毎日": "まいにち",
    "今晩": "こんばん",
    "今週": "こんしゅう",
    "来週": "らいしゅう",
    "先週": "せんしゅう",
    "近く": "ちかく",
    "少し": "すこし",
    "急に": "きゅうに",
    "本当": "ほんとう",
    "静か": "しずか",
    "早く": "はやく",
    "速く": "はやく",
    "硬め": "かため",
    "柔らかめ": "やわらかめ",
    "使える": "つかえる",
    "使えます": "つかえます",
    "使って": "つかって",
    "電車": "でんしゃ",
    "空港": "くうこう",
    "駅": "えき",
    "今": "いま",
    "私": "わたし",
    "僕": "ぼく",
    "彼": "かれ",
    "彼女": "かのじょ",
    "水": "みず",
    "お茶": "おちゃ",
    "ご飯": "ごはん",
    "注文": "ちゅうもん",
    "写真": "しゃしん",
    "電話": "でんわ",
    "時間": "じかん",
    "家族": "かぞく",
    "友達": "ともだち",
    "好き": "すき",
    "嫌い": "きらい",
    "上手": "じょうず",
    "便利": "べんり",
    "元気": "げんき",
    "大切": "たいせつ",
    "大丈夫です": "だいじょうぶです",
    "ありがとうございます": "ありがとうございます",
    "ありがとう": "ありがとう",
    "すみません": "すみません",
    "ごめんなさい": "ごめんなさい",
    "ください": "ください",
    "お願いします": "おねがいします",
    "いただきます": "いただきます",
    "ごちそうさま": "ごちそうさま",
    "妹": "いもうと",
    "姉": "あね",
    "兄": "あに",
    "弟": "おとうと",
    "妻": "つま",
    "娘": "むすめ",
    "円": "えん",
    "時": "じ",
    "分": "ふん",
    "名": "めい",
    "人": "にん",
    "歳": "さい",
    "泊": "はく",
    "回": "かい",
    "階": "かい",
    "個": "こ",
    "本": "ほん",
    "枚": "まい",
    "杯": "はい",
    "冊": "さつ",
    "台": "だい"
  };

  const COUNTER_COMBO_NUMBERS = [
    [/4人/g, "よにん"],
    [/1人/g, "ひとり"],
    [/2人/g, "ふたり"],
    [/3人/g, "さんにん"],
    [/4時/g, "よじ"],
    [/7時/g, "しちじ"],
    [/9時/g, "くじ"],
    [/1つ/g, "ひとつ"],
    [/2つ/g, "ふたつ"],
    [/3つ/g, "みっつ"],
    [/4つ/g, "よっつ"],
    [/5つ/g, "いつつ"],
    [/6つ/g, "むっつ"],
    [/7つ/g, "ななつ"],
    [/8つ/g, "やっつ"],
    [/9つ/g, "ここのつ"],
    [/10個/g, "じゅっこ"],
    [/1個/g, "いっこ"],
    [/6個/g, "ろっこ"],
    [/8個/g, "はっこ"]
  ];

  const DIGIT_HIRA = ["ぜろ", "いち", "に", "さん", "よん", "ご", "ろく", "なな", "はち", "きゅう"];

  const GLIDE_KANA = new Set(["ゃ", "ゅ", "ょ", "ぁ", "ぃ", "ぅ", "ぇ", "ぉ", "ゎ"]);

  // Long vowel prolongation compatibility:
  // If previous mora ends in vowel V, these following morae act as length prolongers for V
  const O_ROW_LAST = new Set(["お", "こ", "ご", "そ", "ぞ", "と", "ど", "の", "ほ", "ぼ", "ぽ", "も", "よ", "ろ", "を"]);
  const E_ROW_LAST = new Set(["え", "け", "げ", "せ", "ぜ", "て", "で", "ね", "へ", "べ", "ぺ", "め", "れ"]);
  const A_ROW_LAST = new Set(["あ", "か", "が", "さ", "ざ", "た", "だ", "な", "は", "ば", "ぱ", "ま", "や", "ら", "わ"]);
  const I_ROW_LAST = new Set(["い", "き", "ぎ", "し", "じ", "ち", "ぢ", "に", "ひ", "び", "ぴ", "み", "り"]);
  const U_ROW_LAST = new Set(["う", "く", "ぐ", "す", "ず", "つ", "づ", "ぬ", "ふ", "ぶ", "ぷ", "む", "ゆ", "る"]);

  function getLastVowelGroup(mora) {
    if (!mora) return "";
    const last = mora.slice(-1);
    if (last === "ゃ" || A_ROW_LAST.has(last)) return "a";
    if (last === "ゅ" || U_ROW_LAST.has(last)) return "u";
    if (last === "ょ" || O_ROW_LAST.has(last)) return "o";
    if (I_ROW_LAST.has(last) || last === "ぃ") return "i";
    if (E_ROW_LAST.has(last) || last === "ぇ") return "e";
    return "";
  }

  function isProlongingMora(mora, prevMora) {
    if (!mora) return false;
    if (mora === "ー") return true;
    const vg = getLastVowelGroup(prevMora);
    if (!vg) return false;
    if (vg === "o" && (mora === "う" || mora === "お" || mora === "ー")) return true;
    if (vg === "e" && (mora === "い" || mora === "え" || mora === "ー")) return true;
    if (vg === "a" && (mora === "あ" || mora === "ー")) return true;
    if (vg === "i" && (mora === "い" || mora === "ー")) return true;
    if (vg === "u" && (mora === "う" || mora === "ー")) return true;
    return false;
  }

  // Orthographic equivalents in Japanese (0 cost)
  const EXACT_MORA_GROUPS = [
    new Set(["は", "わ"]),
    new Set(["へ", "え"]),
    new Set(["を", "お"]),
    new Set(["じ", "ぢ"]),
    new Set(["ず", "づ"]),
    new Set(["じゃ", "ぢゃ"]),
    new Set(["じゅ", "ぢゅ"]),
    new Set(["じょ", "ぢょ"])
  ];

  // Voicing / semi-voicing equivalence groups (0.35 cost -> 'voicing')
  const VOICING_GROUPS = [
    new Set(["か", "が"]), new Set(["き", "ぎ"]), new Set(["く", "ぐ"]), new Set(["け", "げ"]), new Set(["こ", "ご"]),
    new Set(["きゃ", "ぎゃ"]), new Set(["きゅ", "ぎゅ"]), new Set(["きょ", "ぎょ"]),
    new Set(["さ", "ざ"]), new Set(["し", "じ", "ぢ"]), new Set(["す", "ず", "づ"]), new Set(["せ", "ぜ"]), new Set(["そ", "ぞ"]),
    new Set(["しゃ", "じゃ", "ぢゃ"]), new Set(["しゅ", "じゅ", "ぢゅ"]), new Set(["しょ", "じょ", "ぢょ"]),
    new Set(["た", "だ"]), new Set(["ち", "ぢ", "じ"]), new Set(["つ", "づ", "ず"]), new Set(["て", "で"]), new Set(["と", "ど"]),
    new Set(["ちゃ", "ぢゃ", "じゃ"]), new Set(["ちゅ", "ぢゅ", "じゅ"]), new Set(["ちょ", "ぢょ", "じょ"]),
    new Set(["は", "ば", "ぱ"]), new Set(["ひ", "び", "ぴ"]), new Set(["ふ", "ぶ", "ぷ"]), new Set(["へ", "べ", "ぺ"]), new Set(["ほ", "ぼ", "ぽ"]),
    new Set(["ひゃ", "びゃ", "ぴゃ"]), new Set(["ひゅ", "びゅ", "ぴゅ"]), new Set(["ひょ", "びょ", "ぴょ"])
  ];

  // Common learner consonant confusions (0.45 cost -> 'consonant')
  const CONSONANT_CONFUSION_GROUPS = [
    new Set(["つ", "す", "ち", "ず", "づ"]),
    new Set(["し", "ち", "ひ"]),
    new Set(["ら", "だ", "な"]),
    new Set(["り", "に", "ぢ"]),
    new Set(["る", "づ", "ぬ"]),
    new Set(["れ", "で", "ね"]),
    new Set(["ろ", "ど", "の"]),
    new Set(["りゃ", "にゃ"]),
    new Set(["りゅ", "にゅ"]),
    new Set(["りょ", "にょ"]),
    new Set(["ざ", "だ"]),
    new Set(["ぜ", "で"]),
    new Set(["ぞ", "ど"]),
    new Set(["ふ", "ほ", "ひ"]),
    new Set(["ん", "む", "ぬ"])
  ];

  function app() {
    return window.JP_APP;
  }

  function katakanaToHiragana(str) {
    return String(str || "").replace(/[\u30A1-\u30F6]/g, (ch) =>
      String.fromCharCode(ch.charCodeAt(0) - 0x60)
    );
  }

  // Clean display metadata tags (preserving inline furigana 漢字（よみ）)
  function stripMetaAnnotations(raw) {
    if (!raw) return "";
    if (raw.includes("【洗衣机】")) {
      return "洗濯（せんたく）、洗濯乾燥（せんたくかんそう）、洗剤（せんざい）自動投入（じどうとうにゅう）。ふろ自動（じどう）、追（お）いだき。暖房（だんぼう）、加湿（かしつ）。";
    }
    return String(raw)
      .replace(/【[^】]*】/g, "")
      .replace(/［[^］]*］/g, "")
      .replace(/（※[^）]*）/g, "")
      .replace(/\(※[^\)]*\)/g, "")
      .replace(/→/g, "。")
      .replace(/〇〇/g, "まるまる")
      .replace(/\s+/g, " ")
      .trim();
  }

  let corpusKanjiMap = null;
  let sortedCorpusKeys = null;

  function collectRubyPairsFromText(text, targetMap) {
    if (!text) return;
    const re = /([一-龯々ヶ0-9０-９a-zA-Z]+)\（([\u3040-\u309F\u30A0-\u30FFー・]+)\）/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      const k = m[1];
      const yomi = katakanaToHiragana(m[2].replace(/・/g, ""));
      if (k && yomi && !targetMap[k]) {
        targetMap[k] = yomi;
      }
    }
  }

  function ensureCorpusKanjiMap() {
    if (corpusKanjiMap) return corpusKanjiMap;
    const map = { ...FALLBACK_READINGS };

    const mods = [
      ...(window.PHRASE_MODULES_1_6 || []),
      ...(window.PHRASE_MODULES_7_12 || []),
      ...(window.PHRASE_MODULES_13_18 || [])
    ];
    mods.forEach((mod) => {
      (mod.sections || []).forEach((sec) => {
        (sec.items || []).forEach((it) => {
          collectRubyPairsFromText(it.jp, map);
          (it.replies || []).forEach((rep) => collectRubyPairsFromText(rep.jp, map));
        });
      });
      (mod.dialogues || []).forEach((d) => {
        (d.turns || []).forEach((t) => collectRubyPairsFromText(t.jp, map));
      });
    });

    (window.JP_TOP_VERBS || []).forEach((v) => {
      collectRubyPairsFromText(v.jp, map);
      if (v.dict && v.kana && /[一-龯々ヶ]/.test(v.dict) && !map[v.dict]) {
        map[v.dict] = katakanaToHiragana(v.kana);
      }
      Object.values(v.forms || {}).forEach((f) => {
        if (f && f.jp && f.kana && /[一-龯々ヶ]/.test(f.jp) && !map[f.jp]) {
          map[f.jp] = katakanaToHiragana(f.kana);
        }
      });
      (v.examples || []).forEach((ex) => collectRubyPairsFromText(ex.jp, map));
    });

    (window.JP_GRAMMAR_LIST || []).forEach((g) => {
      (g.dailyExamples || []).forEach((ex) => collectRubyPairsFromText(ex.jp, map));
    });

    const ex = window.JP_LEARNING_EXTRAS || {};
    [...(ex.n5Vocab || []), ...(ex.adjectives || []), ...(ex.adverbs || []), ...(ex.kanjiTraps || []), ...(ex.streetSigns || [])].forEach((w) => {
      collectRubyPairsFromText(w.jp, map);
      if (w.jp && w.kana) {
        const clean = w.jp.replace(/\（[^）]*\）/g, "");
        if (clean && !map[clean]) map[clean] = katakanaToHiragana(w.kana);
      }
      if (w.ex) collectRubyPairsFromText(w.ex, map);
    });
    (ex.contractions || []).forEach((c) => {
      collectRubyPairsFromText(c.exCasual, map);
      collectRubyPairsFromText(c.exFormal, map);
    });
    (ex.keigoVerbs || []).forEach((k) => {
      collectRubyPairsFromText(k.ex, map);
    });
    (ex.staffDecoder || []).forEach((s) => {
      collectRubyPairsFromText(s.hearJp, map);
      collectRubyPairsFromText(s.replyJp, map);
    });

    corpusKanjiMap = map;
    sortedCorpusKeys = Object.keys(map).sort((a, b) => b.length - a.length);
    return corpusKanjiMap;
  }

  function tokenizeMorae(hiraStr) {
    const clean = katakanaToHiragana(hiraStr).replace(/[^ぁ-んー]/g, "");
    const morae = [];
    for (let i = 0; i < clean.length; i++) {
      const ch = clean[i];
      if (GLIDE_KANA.has(ch) && morae.length > 0) {
        morae[morae.length - 1] += ch;
      } else {
        morae.push(ch);
      }
    }
    return morae;
  }

  function toHiraganaReading(text, localKanjiMap = {}) {
    const globalMap = ensureCorpusKanjiMap();
    let s = String(text || "")
      .replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
      .replace(/[A-Za-z]/g, (ch) => ch.toLowerCase())
      .trim();

    // Remove inline parenthetical furigana if somehow passed raw
    s = s.replace(/\（([\u3040-\u309F\u30A0-\u30FFー・]+)\）/g, "");

    const localKeys = Object.keys(localKanjiMap || {}).sort((a, b) => b.length - a.length);
    let out = "";
    let i = 0;
    while (i < s.length) {
      let matched = false;
      for (let kIdx = 0; kIdx < localKeys.length; kIdx++) {
        const k = localKeys[kIdx];
        if (s.startsWith(k, i)) {
          out += localKanjiMap[k];
          i += k.length;
          matched = true;
          break;
        }
      }
      if (matched) continue;

      // Normalize common counter+number combos before global map fallback
      let counterMatched = false;
      const tail = s.slice(i);
      for (let cIdx = 0; cIdx < COUNTER_COMBO_NUMBERS.length; cIdx++) {
        const [re, yomi] = COUNTER_COMBO_NUMBERS[cIdx];
        const anchored = new RegExp("^" + re.source);
        const cm = tail.match(anchored);
        if (cm) {
          out += yomi;
          i += cm[0].length;
          counterMatched = true;
          break;
        }
      }
      if (counterMatched) continue;

      for (let gIdx = 0; gIdx < sortedCorpusKeys.length; gIdx++) {
        const k = sortedCorpusKeys[gIdx];
        if (s.startsWith(k, i)) {
          out += globalMap[k];
          i += k.length;
          matched = true;
          break;
        }
      }
      if (matched) continue;

      const ch = s[i];
      if (/^[0-9]$/.test(ch)) {
        out += DIGIT_HIRA[Number(ch)];
      } else {
        out += katakanaToHiragana(ch);
      }
      i++;
    }
    return out.replace(/[^ぁ-んー]/g, "");
  }

  // Parse raw Japanese phrase into display chunks with <ruby> intact & aligned kana/mora ranges
  function parseTargetChunks(rawJp) {
    const cleaned = stripMetaAnnotations(rawJp);
    const localKanjiMap = {};
    collectRubyPairsFromText(cleaned, localKanjiMap);
    ensureCorpusKanjiMap();

    const rubyOrTokenRe = /([一-龯々ヶ0-9０-９a-zA-Z]+)\（([\u3040-\u309F\u30A0-\u30FFー・]+)\）|([、。！？!?\s・「」『』()（）/／]+)|([^一-龯々ヶ0-9０-９a-zA-Z、。！？!?\s・「」『』()（）/／]+)|([一-龯々ヶ0-9０-９a-zA-Z]+)/g;
    const rawUnits = [];
    let m;
    while ((m = rubyOrTokenRe.exec(cleaned)) !== null) {
      if (m[1] && m[2]) {
        const yomi = katakanaToHiragana(m[2].replace(/・/g, ""));
        rawUnits.push({
          kind: "ruby",
          raw: m[0],
          html: `<ruby>${app().escapeHtml(m[1])}<rt>${app().escapeHtml(m[2])}</rt></ruby>`,
          kana: yomi,
          morae: tokenizeMorae(yomi)
        });
      } else if (m[3]) {
        rawUnits.push({ kind: "punct", raw: m[3], html: app().escapeHtml(m[3]), kana: "", morae: [] });
      } else if (m[4]) {
        const hira = katakanaToHiragana(m[4]);
        rawUnits.push({
          kind: "kana",
          raw: m[4],
          html: app().escapeHtml(m[4]),
          kana: hira.replace(/[^ぁ-んー]/g, ""),
          morae: tokenizeMorae(hira)
        });
      } else if (m[5]) {
        const hira = toHiraganaReading(m[5], localKanjiMap);
        rawUnits.push({
          kind: "bareKanji",
          raw: m[5],
          html: app().escapeHtml(m[5]),
          kana: hira,
          morae: tokenizeMorae(hira)
        });
      }
    }

    // Group units into readable word-sized display chunks (1..5 morae where possible)
    const chunks = [];
    let pending = null;

    function flushPending() {
      if (pending) {
        chunks.push(pending);
        pending = null;
      }
    }

    const BOUNDARY_KANA = [
      "ありがとうございます", "ありがとう", "ございます", "いただきます", "すみません", "ごめんなさい", "ちょっと",
      "おねがいします", "ください", "ましょう", "ました", "ません", "ですか", "ですね", "ですよ", "ですが", "ます", "です", "から", "まで", "だけ"
    ];

    rawUnits.forEach((u) => {
      if (u.kind === "punct") {
        flushPending();
        chunks.push({ displayHtml: u.html, raw: u.raw, kana: "", morae: [], isPunct: true });
        return;
      }
      if (u.kind === "ruby" || u.kind === "bareKanji") {
        flushPending();
        pending = { displayHtml: u.html, raw: u.raw, kana: u.kana, morae: [...u.morae], isPunct: false };
        return;
      }
      // Pure kana run: attach short okurigana to previous ruby stem if small, else split nicely
      const attachOkurigana = pending && u.morae.length <= 2 && pending.morae.length + u.morae.length <= 5;
      if (attachOkurigana) {
        pending.displayHtml += u.html;
        pending.raw += u.raw;
        pending.kana += u.kana;
        pending.morae.push(...u.morae);
        flushPending();
        return;
      }

      flushPending();
      // Split long pure-kana segment cleanly around grammatical markers without splitting morae/long vowels
      let rem = u.raw;
      let idx = 0;
      while (idx < rem.length) {
        const slice = rem.slice(idx);
        let cut = 0;
        for (let b = 0; b < BOUNDARY_KANA.length; b++) {
          const bk = BOUNDARY_KANA[b];
          const pos = slice.indexOf(bk);
          if (pos === 0) {
            cut = bk.length;
            break;
          } else if (pos > 0 && pos <= 5) {
            cut = pos;
            break;
          }
        }
        if (cut === 0) {
          cut = Math.min(4, slice.length);
          while (
            cut < slice.length &&
            (GLIDE_KANA.has(slice[cut]) || slice[cut] === "っ" || slice[cut] === "ん" || slice[cut] === "ー" || slice[cut] === "う")
          ) {
            cut++;
          }
        }
        const subRaw = slice.slice(0, cut);
        const subHira = katakanaToHiragana(subRaw);
        const subMorae = tokenizeMorae(subHira);
        if (subMorae.length > 0) {
          chunks.push({
            displayHtml: app().escapeHtml(subRaw),
            raw: subRaw,
            kana: subHira.replace(/[^ぁ-んー]/g, ""),
            morae: subMorae,
            isPunct: false
          });
        } else {
          chunks.push({ displayHtml: app().escapeHtml(subRaw), raw: subRaw, kana: "", morae: [], isPunct: true });
        }
        idx += cut;
      }
    });
    flushPending();

    // Assign flat target mora indices to each non-punct chunk
    const targetMorae = [];
    chunks.forEach((ch) => {
      if (ch.isPunct) return;
      ch.moraStart = targetMorae.length;
      ch.morae.forEach((mo) => targetMorae.push(mo));
      ch.moraEnd = targetMorae.length;
    });

    return { chunks, targetMorae, localKanjiMap };
  }

  function inSameSetGroup(a, b, groups) {
    for (let i = 0; i < groups.length; i++) {
      if (groups[i].has(a) && groups[i].has(b)) return true;
    }
    return false;
  }

  function getSubCost(tMora, tPrev, hMora, hPrev) {
    if (tMora === hMora) return { cost: 0, issue: null };
    if (inSameSetGroup(tMora, hMora, EXACT_MORA_GROUPS)) return { cost: 0, issue: null };
    // Prolonged vowel equivalence: both prolong previous mora's vowel (e.g. おう <-> おー <-> おお)
    if (isProlongingMora(tMora, tPrev) && isProlongingMora(hMora, hPrev)) {
      return { cost: 0, issue: null };
    }
    if (inSameSetGroup(tMora, hMora, VOICING_GROUPS)) return { cost: 0.55, issue: "voicing" };
    if (inSameSetGroup(tMora, hMora, CONSONANT_CONFUSION_GROUPS)) return { cost: 0.65, issue: "consonant" };
    if (tMora === "っ" || hMora === "っ") return { cost: 0.65, issue: "sokuon" };
    if (isProlongingMora(tMora, tPrev) || isProlongingMora(hMora, hPrev)) return { cost: 0.60, issue: "long_vowel" };
    return { cost: 1.0, issue: "miss" };
  }

  // Dynamic Programming Mora Alignment between Target Morae & Single ASR Hypothesis Morae
  function alignSingleHypothesis(targetMorae, heardMorae) {
    const n = targetMorae.length;
    const m = heardMorae.length;
    if (n === 0) {
      return { totalCost: 0, ops: [], totalWeight: 1 };
    }

    const dp = Array.from({ length: n + 1 }, () => new Float64Array(m + 1));
    const bt = Array.from({ length: n + 1 }, () => new Uint8Array(m + 1)); // 1=sub/match, 2=del(miss target), 3=ins(extra heard)
    const iss = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(null));

    for (let i = 1; i <= n; i++) {
      const tM = targetMorae[i - 1];
      const tPrev = i >= 2 ? targetMorae[i - 2] : "";
      let delCost = 1.0;
      let delIss = "miss";
      if (tM === "っ") {
        delCost = 0.65;
        delIss = "sokuon";
      } else if (isProlongingMora(tM, tPrev)) {
        delCost = 0.60;
        delIss = "long_vowel";
      }
      dp[i][0] = dp[i - 1][0] + delCost;
      bt[i][0] = 2;
      iss[i][0] = delIss;
    }

    for (let j = 1; j <= m; j++) {
      const hM = heardMorae[j - 1];
      const hPrev = j >= 2 ? heardMorae[j - 2] : "";
      const insCost = hM === "っ" ? 0.55 : isProlongingMora(hM, hPrev) ? 0.50 : 0.78;
      dp[0][j] = dp[0][j - 1] + insCost;
      bt[0][j] = 3;
      iss[0][j] = hM === "っ" ? "sokuon" : isProlongingMora(hM, hPrev) ? "long_vowel" : "extra";
    }

    for (let i = 1; i <= n; i++) {
      const tM = targetMorae[i - 1];
      const tPrev = i >= 2 ? targetMorae[i - 2] : "";
      let delCost = 1.0;
      let delIss = "miss";
      if (tM === "っ") {
        delCost = 0.65;
        delIss = "sokuon";
      } else if (isProlongingMora(tM, tPrev)) {
        delCost = 0.60;
        delIss = "long_vowel";
      }

      for (let j = 1; j <= m; j++) {
        const hM = heardMorae[j - 1];
        const hPrev = j >= 2 ? heardMorae[j - 2] : "";
        const { cost: subC, issue: subIss } = getSubCost(tM, tPrev, hM, hPrev);
        const insC = hM === "っ" ? 0.55 : isProlongingMora(hM, hPrev) ? 0.50 : 0.78;

        const cDiag = dp[i - 1][j - 1] + subC;
        const cDel = dp[i - 1][j] + delCost;
        const cIns = dp[i][j - 1] + insC;

        if (cDiag <= cDel && cDiag <= cIns) {
          dp[i][j] = cDiag;
          bt[i][j] = 1;
          iss[i][j] = subIss;
        } else if (cDel <= cIns) {
          dp[i][j] = cDel;
          bt[i][j] = 2;
          iss[i][j] = delIss;
        } else {
          dp[i][j] = cIns;
          bt[i][j] = 3;
          iss[i][j] = hM === "っ" ? "sokuon" : isProlongingMora(hM, hPrev) ? "long_vowel" : "extra";
        }
      }
    }

    // Backtrace
    const ops = [];
    let i = n;
    let j = m;
    while (i > 0 || j > 0) {
      const step = bt[i][j];
      if (step === 1) {
        const tM = targetMorae[i - 1];
        const hM = heardMorae[j - 1];
        const tPrev = i >= 2 ? targetMorae[i - 2] : "";
        const hPrev = j >= 2 ? heardMorae[j - 2] : "";
        const { cost } = getSubCost(tM, tPrev, hM, hPrev);
        ops.push({ tIdx: i - 1, tMora: tM, hMora: hM, cost, issue: iss[i][j] });
        i--;
        j--;
      } else if (step === 2) {
        const tM = targetMorae[i - 1];
        const tPrev = i >= 2 ? targetMorae[i - 2] : "";
        const dC = tM === "っ" ? 0.45 : isProlongingMora(tM, tPrev) ? 0.40 : 1.0;
        ops.push({ tIdx: i - 1, tMora: tM, hMora: "", cost: dC, issue: iss[i][j] });
        i--;
      } else {
        ops.push({ tIdx: -1, tMora: "", hMora: heardMorae[j - 1], cost: 0.5, issue: iss[i][j] });
        j--;
      }
    }
    ops.reverse();

    return { totalCost: dp[n][m], ops };
  }

  // Evaluate all ASR hypotheses (up to 5 alternatives) and select phonetically closest match
  function alignJapaneseMorae(targetJp, heardOrAlternatives) {
    const parsed = parseTargetChunks(targetJp);
    const alts = (Array.isArray(heardOrAlternatives) ? heardOrAlternatives : [heardOrAlternatives])
      .map((x) => String(x || "").trim())
      .filter(Boolean);

    if (alts.length === 0) {
      const chunkResults = parsed.chunks.map((ch) => ({
        ...ch,
        status: ch.isPunct ? "punct" : "miss",
        heardKana: "",
        issueTypes: ch.isPunct ? [] : ["miss"],
        pairs: []
      }));
      return {
        parsed,
        bestHeardRaw: "",
        bestHeardKana: "",
        accuracy: 0,
        completeness: 0,
        chunkResults,
        ops: []
      };
    }

    let bestResult = null;
    alts.forEach((altText) => {
      const hKana = toHiraganaReading(altText, parsed.localKanjiMap);
      const hMorae = tokenizeMorae(hKana);
      const aligned = alignSingleHypothesis(parsed.targetMorae, hMorae);
      if (!bestResult || aligned.totalCost < bestResult.aligned.totalCost) {
        bestResult = { altText, hKana, hMorae, aligned };
      }
    });

    const nMora = Math.max(1, parsed.targetMorae.length);
    const accuracy = Math.max(0, Math.min(100, Math.round((1 - bestResult.aligned.totalCost / (nMora * 1.05)) * 100)));

    // Map per-mora operations back onto target Display Chunks
    const opsByTargetIdx = new Map();
    bestResult.aligned.ops.forEach((op) => {
      if (op.tIdx >= 0) opsByTargetIdx.set(op.tIdx, op);
    });

    let compSum = 0;
    let realChunkCount = 0;
    const chunkResults = parsed.chunks.map((ch) => {
      if (ch.isPunct) {
        return { ...ch, status: "punct", heardKana: "", issueTypes: [], pairs: [] };
      }
      realChunkCount++;
      let chunkCost = 0;
      const issueSet = new Set();
      let heardKana = "";
      const pairs = [];
      for (let ti = ch.moraStart; ti < ch.moraEnd; ti++) {
        const op = opsByTargetIdx.get(ti);
        if (op) {
          chunkCost += op.cost;
          if (op.issue) issueSet.add(op.issue);
          if (op.hMora) heardKana += op.hMora;
          if (op.cost > 0) pairs.push({ target: op.tMora, heard: op.hMora, issue: op.issue });
        }
      }
      const len = Math.max(1, ch.morae.length);
      const avgCost = chunkCost / len;
      let status = "ok";
      if (chunkCost <= 0.05) {
        status = "ok";
        compSum += 1.0;
      } else if (avgCost <= 0.58 || (!issueSet.has("miss") && issueSet.size > 0)) {
        status = "close";
        compSum += 0.7;
      } else {
        status = "miss";
      }
      return {
        ...ch,
        status,
        heardKana,
        issueTypes: Array.from(issueSet),
        pairs
      };
    });

    const completeness = realChunkCount > 0 ? Math.round((compSum / realChunkCount) * 100) : 0;

    return {
      parsed,
      bestHeardRaw: bestResult.altText,
      bestHeardKana: bestResult.hKana,
      accuracy,
      completeness,
      chunkResults,
      ops: bestResult.aligned.ops
    };
  }

  // Generate 3-axis score + concrete Japanese/Chinese pronunciation coaching tips
  function evaluateOralAttempt(targetJp, heardOrAlternatives, nativeDurationMs = 0, userSpeechMs = 0) {
    const alignment = alignJapaneseMorae(targetJp, heardOrAlternatives);
    const targetMoraLen = Math.max(1, alignment.parsed.targetMorae.length);
    const refNativeMs = nativeDurationMs > 350 ? nativeDurationMs : targetMoraLen * 165;

    let fluency = 85;
    let paceRatio = null;
    if (userSpeechMs > 280 && alignment.bestHeardRaw) {
      paceRatio = userSpeechMs / refNativeMs;
      if (paceRatio >= 0.78 && paceRatio <= 1.28) {
        fluency = Math.round(100 - Math.abs(paceRatio - 1) * 32);
      } else if (paceRatio < 0.78) {
        fluency = Math.max(45, Math.round(92 - (0.78 - paceRatio) * 115));
      } else {
        fluency = Math.max(45, Math.round(92 - (paceRatio - 1.28) * 65));
      }
      fluency = Math.max(40, Math.min(100, fluency));
    }

    let overall = 0;
    if (!alignment.bestHeardRaw) {
      overall = 0;
      fluency = 0;
    } else {
      overall = Math.round(alignment.accuracy * 0.55 + alignment.completeness * 0.30 + fluency * 0.15);
      if (alignment.completeness < 20 && alignment.accuracy < 25) {
        overall = Math.min(25, overall);
      }
    }
    overall = Math.max(0, Math.min(100, overall));

    let grade = overall >= 92 ? "S" : overall >= 80 ? "A" : overall >= 65 ? "B" : "C";

    // Build concrete coaching tips
    const tips = [];
    const seenTypes = new Set();
    const realChunks = alignment.chunkResults.filter((c) => !c.isPunct);

    if (!alignment.bestHeardRaw) {
      tips.push({
        type: "silent",
        severity: "warn",
        icon: "🎙️",
        title: "未识别到清晰日语语音",
        detail: "请确认麦克风权限已开启，距离设备 15–30cm 音量洪亮地朗读完整句子后等待约 1.5 秒自动结束（或点击「说完了」）。"
      });
      return {
        ...alignment,
        fluency,
        overall,
        grade: "C",
        paceRatio,
        userSpeechMs,
        nativeDurationMs: refNativeMs,
        tips
      };
    }

    // 1. Sokuon (っ) guidance
    const sokuonChunks = realChunks.filter((c) => c.issueTypes.includes("sokuon"));
    if (sokuonChunks.length > 0 && !seenTypes.has("sokuon")) {
      seenTypes.add("sokuon");
      const ex = sokuonChunks[0];
      tips.push({
        type: "sokuon",
        severity: "warn",
        icon: "⏸️",
        title: `促音停顿提示（「${ex.raw}」）`,
        detail: `检测到「${ex.kana}」中的小「っ」停顿不够明显。先在喉咙或舌尖憋住半拍静音，再轻吐后面的音，才不会听起来像没带促音。`
      });
    }

    // 2. Long vowel guidance
    const longChunks = realChunks.filter((c) => c.issueTypes.includes("long_vowel"));
    if (longChunks.length > 0 && !seenTypes.has("long_vowel")) {
      seenTypes.add("long_vowel");
      const ex = longChunks[0];
      tips.push({
        type: "long_vowel",
        severity: "warn",
        icon: "〰️",
        title: `长音拍数偏短（「${ex.raw}」）`,
        detail: `日语长音（ー / おう / えい等）需占满「两拍」时长。「${ex.kana}」请平稳拉长母音半秒，避免收成短音导致意思变化。`
      });
    }

    // 3. Voicing / Semi-voicing guidance
    const voicingChunks = realChunks.filter((c) => c.issueTypes.includes("voicing"));
    if (voicingChunks.length > 0 && !seenTypes.has("voicing")) {
      seenTypes.add("voicing");
      const ex = voicingChunks[0];
      const pair = ex.pairs.find((p) => p.issue === "voicing") || ex.pairs[0];
      const pairHint = pair ? `（${pair.target} ↔ ${pair.heard || "清/浊互混"}）` : "";
      tips.push({
        type: "voicing",
        severity: "warn",
        icon: "🔔",
        title: `清音 / 浊音区分${pairHint}`,
        detail: `「${ex.raw} (${ex.kana})」清浊音略混。浊音（がざだば行）发声时摸喉咙应有明显声带震动；清音（かさたは行）在词中不送气且无震动。`
      });
    }

    // 4. Consonant / Tongue position guidance
    const consChunks = realChunks.filter((c) => c.issueTypes.includes("consonant"));
    if (consChunks.length > 0 && !seenTypes.has("consonant")) {
      seenTypes.add("consonant");
      const ex = consChunks[0];
      const pair = ex.pairs.find((p) => p.issue === "consonant");
      let mouthCue = "注意日语元音口型比中文更小、更稳定，避免带入儿化或重卷舌。";
      if (pair && /[らりるれろ]/.test(pair.target)) {
        mouthCue = "「ら行」舌尖轻弹一下上齿龈即可（介于 l 与短 d 之间），千万不要像中文“r”或英文翘舌音。";
      } else if (pair && pair.target === "つ") {
        mouthCue = "「つ (tsu)」舌尖先顶住上齿背阻塞气流，再顺势发出接近轻“次(ci)”但嘴唇更扁的音。";
      } else if (pair && pair.target === "ん") {
        mouthCue = "拨音「ん」请闭唇或舌根轻抵软腭做足一拍鼻音，不要省略。";
      }
      tips.push({
        type: "consonant",
        severity: "info",
        icon: "👄",
        title: `辅音口型纠偏（「${ex.raw}」）`,
        detail: mouthCue
      });
    }

    // 5. Ending completeness check
    const missedTail = realChunks.length >= 2 && realChunks.slice(-2).some((c) => c.status === "miss");
    if (missedTail && !seenTypes.has("ending")) {
      seenTypes.add("ending");
      const tailText = realChunks.slice(-2).map((c) => c.raw).join("");
      tips.push({
        type: "ending",
        severity: "warn",
        icon: "🏁",
        title: `句尾漏读 / 音量过轻（「${tailText}」）`,
        detail: "日语的时态、礼貌体与请求都在句尾（如 〜ます / 〜ました / 〜ください / 〜ですか）。句末不要吞音，咬字坚持到最后一个音节。"
      });
    }

    // 6. Speech pace guidance
    if (paceRatio !== null && !seenTypes.has("pace")) {
      if (paceRatio < 0.65) {
        seenTypes.add("pace");
        tips.push({
          type: "pace",
          severity: "info",
          icon: "🐇",
          title: `语速偏快（约为原声 ${paceRatio.toFixed(2)}x 时长）`,
          detail: "说得比示范快不少，容易把长音和助词吞掉。先点一次「🐢 慢速 (0.84x)」，跟着每个拍节稳稳踩准再提速。"
        });
      } else if (paceRatio > 1.45) {
        seenTypes.add("pace");
        tips.push({
          type: "pace",
          severity: "info",
          icon: "🐢",
          title: `语速略慢（约为原声 ${paceRatio.toFixed(2)}x 时长）`,
          detail: "发音很认真！建议按意群/词块一口气连读（例如动词+ます不要断开），能显著提升对话流利感。"
        });
      }
    }

    // 7. Generic fallback if missing chunks without specialized issue
    if (tips.length === 0 && overall < 80) {
      const missed = realChunks.filter((c) => c.status === "miss").slice(0, 2).map((c) => c.raw).join("、");
      tips.push({
        type: "clarity",
        severity: "info",
        icon: "🎧",
        title: missed ? `建议重点再跟读「${missed}」` : "建议对比原声再读一遍",
        detail: "点击下方「⚖️ 对比听：原声 → 我」，重点留意每个假名的清晰度与句间停顿。"
      });
    }

    // Reserve S-tier strictly for clean pronunciation + natural rhythm
    const hasPhonemicOrPaceIssue = tips.some((t) => t.type !== "praise" && t.type !== "clarity");
    if (hasPhonemicOrPaceIssue && grade === "S") grade = "A";
    if (fluency < 65 && (grade === "S" || grade === "A")) grade = "B";

    // 8. Praise card when score >= 80
    if (overall >= 80 && tips.length === 0) {
      tips.push({
        type: "praise",
        severity: "ok",
        icon: "🌟",
        title: grade === "S" ? "非常地道！发音准确度与节奏接近母语自然度" : "很棒！沟通已非常清晰自然",
        detail: "可以用「⚖️ 对比听：原声 → 我」再微调一下句尾语调起伏，或点击「下一句」继续练习！"
      });
    }

    return {
      ...alignment,
      fluency,
      overall,
      grade,
      paceRatio,
      userSpeechMs,
      nativeDurationMs: refNativeMs,
      tips: tips.slice(0, 4)
    };
  }

  // =========================================================================
  // Audio Context (Chimes + AnalyserNode Waveform + 16kHz WAV Export)
  // =========================================================================
  let sharedAudioCtx = null;
  function getAudioCtx() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    if (!sharedAudioCtx || sharedAudioCtx.state === "closed") {
      sharedAudioCtx = new AC();
    }
    if (sharedAudioCtx.state === "suspended") {
      sharedAudioCtx.resume().catch(() => {});
    }
    return sharedAudioCtx;
  }

  function playCueChime(kind = "start") {
    const ctx = getAudioCtx();
    if (!ctx) return;
    try {
      const now = ctx.currentTime;
      const notes =
        kind === "pass"
          ? [[587.33, 0, 0.11], [880, 0.1, 0.16]]
          : kind === "retry"
          ? [[440, 0, 0.12], [392, 0.12, 0.16]]
          : [[659.25, 0, 0.08], [880, 0.08, 0.1]];

      notes.forEach(([freq, offset, dur]) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(freq, now + offset);
        gain.gain.setValueAtTime(0.0001, now + offset);
        gain.gain.exponentialRampToValueAtTime(0.09, now + offset + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + dur);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + offset);
        osc.stop(now + offset + dur + 0.02);
      });
    } catch (e) {}
  }

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const res = String(reader.result || "");
        const comma = res.indexOf(",");
        resolve(comma >= 0 ? res.slice(comma + 1) : res);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  function writeAscii(view, offset, str) {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  }

  // Convert recorded Blob into compact 16kHz Mono 16-bit PCM WAV for Gemini Interactions API
  async function blobTo16kMonoWavBase64(blob) {
    try {
      const ctx = getAudioCtx();
      if (!ctx) throw new Error("No AudioContext");
      const arrBuf = await blob.arrayBuffer();
      const decoded = await ctx.decodeAudioData(arrBuf);
      const targetRate = 16000;
      const ratio = decoded.sampleRate / targetRate;
      const ch0 = decoded.getChannelData(0);
      const outLen = Math.max(1, Math.floor(ch0.length / ratio));
      const wavBuf = new ArrayBuffer(44 + outLen * 2);
      const view = new DataView(wavBuf);

      writeAscii(view, 0, "RIFF");
      view.setUint32(4, 36 + outLen * 2, true);
      writeAscii(view, 8, "WAVE");
      writeAscii(view, 12, "fmt ");
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true);
      view.setUint16(22, 1, true);
      view.setUint32(24, targetRate, true);
      view.setUint32(28, targetRate * 2, true);
      view.setUint16(32, 2, true);
      view.setUint16(34, 16, true);
      writeAscii(view, 36, "data");
      view.setUint32(40, outLen * 2, true);

      let offset = 44;
      for (let i = 0; i < outLen; i++) {
        const srcIdx = Math.min(ch0.length - 1, Math.floor(i * ratio));
        const sample = Math.max(-1, Math.min(1, ch0[srcIdx]));
        view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
        offset += 2;
      }

      const wavBlob = new Blob([wavBuf], { type: "audio/wav" });
      const b64 = await blobToBase64(wavBlob);
      return { base64: b64, mimeType: "audio/wav" };
    } catch (e) {
      const rawMime = (blob.type || "audio/webm").split(";")[0].trim() || "audio/webm";
      const b64 = await blobToBase64(blob);
      return { base64: b64, mimeType: rawMime };
    }
  }

  // =========================================================================
  // Coach Session State
  // =========================================================================
  const coachState = {
    deck: "phrases", // 'phrases' | 'roleplay' | 'staff' | 'verbs' | 'grammar' | 'n5vocab' | 'weak'
    index: 0,
    rate: 1.0,
    handsFree: false,
    autoRetries: 0,
    blindMode: false,

    // Roleplay specific
    roleplayDlgId: null,
    roleplayTurnIdx: 0,

    // Modal state
    isModalOpen: false,
    modalItem: null,

    // Runtime phase: 'idle' | 'model_playing' | 'listening' | 'evaluating' | 'result'
    phase: "idle",
    statusText: "",
    interimText: "",
    result: null,

    // Gemini AI Coach (BYOK)
    showAiSettings: false,
    aiLoading: false,
    aiResult: null,
    aiError: "",

    // Captured user audio & playback
    userBlob: null,
    userAudioUrl: null,
    compareMode: null, // null | 'user' | 'compare'
    lastNativeDurationMs: 0,

    // Active handles to tear down cleanly on stopAll()
    recognition: null,
    mediaRecorder: null,
    mediaStream: null,
    sourceNode: null,
    analyserNode: null,
    rafId: null,
    silenceTimer: null,
    maxCapTimer: null,
    nextActionTimer: null,
    userPlayer: new Audio(),

    // Speech VAD measurements
    recStartMs: 0,
    speechOnsetMs: 0,
    speechOffsetMs: 0,
    heardAnyVoice: false,
    asrHypotheses: []
  };

  function getGeminiKey() {
    return (localStorage.getItem(GEMINI_KEY_STORAGE) || "").trim();
  }

  function isGeminiEnabled() {
    return localStorage.getItem(GEMINI_ENABLED_STORAGE) === "1" && !!getGeminiKey();
  }

  function revokeUserAudioUrl() {
    if (coachState.userAudioUrl) {
      try { URL.revokeObjectURL(coachState.userAudioUrl); } catch (e) {}
      coachState.userAudioUrl = null;
    }
  }

  function releaseMicResources() {
    if (coachState.rafId) {
      cancelAnimationFrame(coachState.rafId);
      coachState.rafId = null;
    }
    if (coachState.recognition) {
      try {
        coachState.recognition.onresult = null;
        coachState.recognition.onerror = null;
        coachState.recognition.onend = null;
        coachState.recognition.abort();
      } catch (e) {}
      coachState.recognition = null;
    }
    if (coachState.mediaRecorder) {
      try {
        if (coachState.mediaRecorder.state !== "inactive") {
          coachState.mediaRecorder.onstop = null;
          coachState.mediaRecorder.stop();
        }
      } catch (e) {}
      coachState.mediaRecorder = null;
    }
    if (coachState.sourceNode) {
      try { coachState.sourceNode.disconnect(); } catch (e) {}
      coachState.sourceNode = null;
    }
    coachState.analyserNode = null;
    if (coachState.mediaStream) {
      try { coachState.mediaStream.getTracks().forEach((t) => t.stop()); } catch (e) {}
      coachState.mediaStream = null;
    }
  }

  function stopUserPlayback() {
    try {
      coachState.userPlayer.pause();
      coachState.userPlayer.currentTime = 0;
    } catch (e) {}
    coachState.compareMode = null;
  }

  function clearAllTimers() {
    clearTimeout(coachState.silenceTimer);
    clearTimeout(coachState.maxCapTimer);
    clearTimeout(coachState.nextActionTimer);
    coachState.silenceTimer = null;
    coachState.maxCapTimer = null;
    coachState.nextActionTimer = null;
  }

  function stopAll() {
    clearAllTimers();
    releaseMicResources();
    stopUserPlayback();
    if (app()) app().stopAllAudio();
    if (coachState.phase === "model_playing" || coachState.phase === "listening" || coachState.phase === "evaluating") {
      coachState.phase = coachState.result ? "result" : "idle";
      coachState.statusText = "";
      coachState.interimText = "";
    }
  }

  // =========================================================================
  // Deck & Roleplay Builders
  // =========================================================================
  function getAllRoleplayDialogues() {
    const a = app();
    if (!a) return [];
    const list = [];
    a.getEffectiveModules().forEach((mod) => {
      (mod.dialogues || []).forEach((dlg) => {
        if (dlg && Array.isArray(dlg.turns) && dlg.turns.length > 0) {
          list.push({
            id: dlg.id,
            title: `${mod.icon} ${dlg.title}`,
            context: dlg.context || "",
            modNumber: mod.number,
            turns: dlg.turns
          });
        }
      });
    });
    return list;
  }

  function getDeckItems(deckName = coachState.deck) {
    const a = app();
    if (!a) return [];
    const mods = a.getEffectiveModules();

    if (deckName === "phrases") {
      const out = [];
      mods.forEach((mod) => {
        (mod.sections || []).forEach((sec) => {
          (sec.items || []).forEach((it) => {
            out.push({
              id: it.id,
              tag: `${mod.icon} ${it.tag || mod.number}`,
              jp: it.jp,
              romaji: it.romaji || "",
              cn: it.cn,
              audioKey: it.id
            });
          });
        });
      });
      return out;
    }

    if (deckName === "staff") {
      const list = (window.JP_LEARNING_EXTRAS && window.JP_LEARNING_EXTRAS.staffDecoder) || [];
      return list.map((s) => ({
        id: `oral-staff-${s.id}`,
        tag: `🏪 ${s.scene} · 听问再答`,
        promptContextJp: s.hearJp,
        promptContextCn: `店员提问：${s.hearCn}`,
        jp: s.replyJp,
        romaji: s.replyRomaji || "",
        cn: s.replyCn,
        audioKey: null
      }));
    }

    if (deckName === "verbs") {
      return (window.JP_TOP_VERBS || []).map((v) => ({
        id: `${v.id}-ex0`,
        tag: `⚡ #${v.rank} ${v.dict} (${v.examples[0].form})`,
        jp: v.examples[0].jp,
        romaji: v.examples[0].romaji || "",
        cn: v.examples[0].cn,
        audioKey: null
      }));
    }

    if (deckName === "grammar") {
      return (window.JP_GRAMMAR_LIST || []).map((g) => ({
        id: `${g.id}-ex0`,
        tag: `📖 ${g.level} · ${g.pattern}`,
        jp: g.dailyExamples[0].jp,
        romaji: g.dailyExamples[0].romaji || "",
        cn: g.dailyExamples[0].cn,
        audioKey: null
      }));
    }

    if (deckName === "n5vocab") {
      const ex = window.JP_LEARNING_EXTRAS || {};
      return [
        ...(ex.n5Vocab || []).filter((x) => x.ex).map((x) => ({
          id: `${x.id}-ex`,
          tag: `🟢 N5 · ${x.cat}`,
          jp: x.ex,
          romaji: x.romaji || "",
          cn: x.exCn,
          audioKey: null
        })),
        ...(ex.contractions || []).map((c) => ({
          id: `${c.id}-casual`,
          tag: `💬 口语缩略 (${c.formal}→${c.casual})`,
          jp: c.exCasual,
          romaji: "",
          cn: c.exCn,
          audioKey: null
        }))
      ];
    }

    if (deckName === "weak") {
      const oralStats = (a.state && a.state.oralStats) || {};
      const pool = [];
      ["phrases", "staff", "verbs", "grammar", "n5vocab"].forEach((dn) => {
        getDeckItems(dn).forEach((it) => {
          const st = oralStats[it.id];
          if (st && st.bestScore < 80) {
            pool.push({ ...it, _bestScore: st.bestScore });
          }
        });
      });
      pool.sort((x, y) => x._bestScore - y._bestScore);
      return pool;
    }

    return [];
  }

  function getActiveItem() {
    if (coachState.isModalOpen && coachState.modalItem) {
      return coachState.modalItem;
    }
    if (coachState.deck === "roleplay") {
      const dlgs = getAllRoleplayDialogues();
      if (!dlgs.length) return null;
      let dlg = dlgs.find((d) => d.id === coachState.roleplayDlgId) || dlgs[0];
      coachState.roleplayDlgId = dlg.id;
      if (coachState.roleplayTurnIdx >= dlg.turns.length) coachState.roleplayTurnIdx = 0;
      const turn = dlg.turns[coachState.roleplayTurnIdx];
      return {
        id: `${dlg.id}-turn-${coachState.roleplayTurnIdx}`,
        tag: `🎭 ${dlg.modNumber} · 第 ${coachState.roleplayTurnIdx + 1}/${dlg.turns.length} 轮`,
        jp: turn.jp,
        romaji: turn.romaji || "",
        cn: turn.cn,
        note: turn.note || "",
        speaker: turn.speaker,
        speakerName: turn.speakerName,
        audioKey: `${dlg.id}-turn-${coachState.roleplayTurnIdx}`,
        dialogue: dlg,
        turnIdx: coachState.roleplayTurnIdx
      };
    }
    const items = getDeckItems(coachState.deck);
    if (!items.length) return null;
    if (coachState.index >= items.length) coachState.index = 0;
    if (coachState.index < 0) coachState.index = items.length - 1;
    return items[coachState.index];
  }

  function renderCurrentSurface() {
    if (coachState.isModalOpen) {
      const root = document.getElementById("oc-quick-modal-root");
      if (root) renderQuickModalBody(root);
    } else {
      const root = document.getElementById("oral-coach-stage");
      if (root) renderStudio(root);
    }
  }

  // =========================================================================
  // Playback & Capture State Machine
  // =========================================================================
  function speakTargetSentence(item, rate = coachState.rate, onDone = null) {
    const a = app();
    if (!a || !item) return;
    stopUserPlayback();
    const startT = performance.now();
    a.speakJapanese(
      item.jp,
      rate,
      null,
      () => {
        const measured = a.getLastNeuralDuration();
        const elapsed = performance.now() - startT;
        // Scale elapsed back to 1.0x reference duration if spoken slowly
        const refMs = measured > 300 ? measured : Math.round(elapsed * (rate < 1.0 ? 0.84 : 1.0));
        coachState.lastNativeDurationMs = refMs;
        if (onDone) onDone();
      },
      item.audioKey || null
    );
  }

  async function beginListeningAndRecording(item) {
    clearAllTimers();
    releaseMicResources();
    stopUserPlayback();

    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    coachState.phase = "listening";
    coachState.interimText = "";
    coachState.asrHypotheses = [];
    coachState.heardAnyVoice = false;
    coachState.recStartMs = performance.now();
    coachState.speechOnsetMs = 0;
    coachState.speechOffsetMs = 0;
    coachState.statusText = SR
      ? "🎙️ 请跟着朗读！系统正在收音并实时识别..."
      : "🎙️ 正在录音（当前浏览器不支持自动转写，将进行节奏对比与录音回放）...";

    renderCurrentSurface();

    let finalized = false;
    let stopping = false;
    let srDone = !SR;
    let recDone = true;
    const chunks = [];

    function maybeFinishCapture() {
      if (finalized) return;
      if (srDone && recDone) {
        finalized = true;
        finalizeAttempt(item);
      }
    }

    function stopCaptureGracefully() {
      if (finalized) return;
      if (stopping) {
        maybeFinishCapture();
        return;
      }
      stopping = true;
      clearAllTimers();
      coachState.phase = "evaluating";
      coachState.statusText = "🔍 正在逐词分析发音并生成纠音建议...";
      renderCurrentSurface();

      if (coachState.recognition && !srDone) {
        try { coachState.recognition.stop(); } catch (e) { srDone = true; }
      }
      if (coachState.mediaRecorder && coachState.mediaRecorder.state !== "inactive") {
        try { coachState.mediaRecorder.stop(); } catch (e) { recDone = true; }
      } else {
        recDone = true;
      }
      if (srDone && recDone) {
        maybeFinishCapture();
        return;
      }
      // Safety deadline in case onend/onstop stalls
      setTimeout(() => {
        srDone = true;
        recDone = true;
        maybeFinishCapture();
      }, 650);
    }

    // Store finish hook so user can tap "说完了，立即评分"
    coachState._manualFinish = stopCaptureGracefully;

    // 1. Setup microphone MediaStream + AnalyserNode live waveform + MediaRecorder
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (coachState.phase !== "listening") {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        coachState.mediaStream = stream;

        // AnalyserNode + Live Canvas Waveform + VAD Silence Detection
        const ctx = getAudioCtx();
        if (ctx) {
          try {
            const src = ctx.createMediaStreamSource(stream);
            const analyser = ctx.createAnalyser();
            analyser.fftSize = 128;
            src.connect(analyser);
            coachState.sourceNode = src;
            coachState.analyserNode = analyser;
            drawWaveformLoop(stopCaptureGracefully);
          } catch (e) {}
        }

        if (window.MediaRecorder) {
          try {
            const preferredTypes = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
            const chosenType = preferredTypes.find((t) => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) || "";
            const recorder = chosenType ? new MediaRecorder(stream, { mimeType: chosenType }) : new MediaRecorder(stream);
            recDone = false;
            recorder.ondataavailable = (ev) => {
              if (ev.data && ev.data.size > 0) chunks.push(ev.data);
            };
            recorder.onstop = () => {
              if (chunks.length > 0) {
                revokeUserAudioUrl();
                const blob = new Blob(chunks, { type: chosenType || chunks[0].type || "audio/webm" });
                coachState.userBlob = blob;
                coachState.userAudioUrl = URL.createObjectURL(blob);
              }
              recDone = true;
              maybeFinishCapture();
            };
            recorder.start(120);
            coachState.mediaRecorder = recorder;
          } catch (e) {
            recDone = true;
          }
        }
      } catch (micErr) {
        // Permission denied or mic missing; still allow SpeechRecognition if available
        if (!SR) {
          coachState.phase = "idle";
          coachState.statusText = "⚠️ 无法访问麦克风，请检查浏览器麦克风权限设置。";
          renderCurrentSurface();
          return;
        }
      }
    }

    // 2. Setup Web SpeechRecognition (ja-JP, 5 alternatives, interim results)
    if (SR) {
      try {
        const rec = new SR();
        rec.lang = "ja-JP";
        rec.interimResults = true;
        rec.maxAlternatives = 5;
        rec.continuous = false;

        rec.onresult = (ev) => {
          let interim = "";
          const hyps = [];
          for (let i = ev.resultIndex; i < ev.results.length; i++) {
            const res = ev.results[i];
            if (res.isFinal) {
              for (let a = 0; a < res.length; a++) {
                if (res[a] && res[a].transcript) hyps.push(res[a].transcript);
              }
            } else if (res[0] && res[0].transcript) {
              interim += res[0].transcript;
            }
          }
          if (interim) {
            coachState.interimText = interim;
            if (!coachState.heardAnyVoice) {
              coachState.heardAnyVoice = true;
              coachState.speechOnsetMs = performance.now();
            }
            coachState.speechOffsetMs = performance.now();
            const liveEl = document.getElementById("oc-interim-live");
            if (liveEl) liveEl.textContent = `👂 实时听到：${interim}`;
          }
          if (hyps.length > 0) {
            coachState.asrHypotheses = hyps;
            if (!coachState.heardAnyVoice) {
              coachState.heardAnyVoice = true;
              coachState.speechOnsetMs = coachState.recStartMs + 200;
            }
            coachState.speechOffsetMs = performance.now();
          }
        };

        rec.onerror = (ev) => {
          if (ev && (ev.error === "not-allowed" || ev.error === "service-not-allowed")) {
            coachState.statusText = "⚠️ 麦克风权限被拒绝，请在浏览器地址栏允许使用麦克风。";
          }
          srDone = true;
          stopCaptureGracefully();
        };

        rec.onend = () => {
          srDone = true;
          stopCaptureGracefully();
        };

        coachState.recognition = rec;
        rec.start();
      } catch (e) {
        srDone = true;
      }
    }

    // 3. Hard capture cap (14s) so microphone is never left open indefinitely
    coachState.maxCapTimer = setTimeout(() => {
      if (coachState.phase === "listening") {
        stopCaptureGracefully();
      }
    }, 14000);
  }

  function drawWaveformLoop(onTrailingSilence) {
    const analyser = coachState.analyserNode;
    if (!analyser || coachState.phase !== "listening") return;

    const data = new Uint8Array(analyser.frequencyBinCount);
    let silenceSince = 0;

    function tick() {
      if (coachState.phase !== "listening" || !coachState.analyserNode) return;
      analyser.getByteFrequencyData(data);

      let sum = 0;
      for (let i = 0; i < data.length; i++) sum += data[i];
      const avg = sum / Math.max(1, data.length);
      const now = performance.now();

      if (avg > 12) {
        if (!coachState.heardAnyVoice) {
          coachState.heardAnyVoice = true;
          coachState.speechOnsetMs = now;
        }
        coachState.speechOffsetMs = now;
        silenceSince = 0;
      } else if (coachState.heardAnyVoice && coachState.speechOffsetMs - coachState.speechOnsetMs > 380) {
        if (!silenceSince) silenceSince = now;
        // Stop automatically after 1.65s trailing silence once speech was spoken
        if (now - silenceSince > 1650 && !coachState.recognition) {
          onTrailingSilence();
          return;
        }
      }

      const canvas = document.getElementById("oc-waveform-canvas");
      if (canvas) {
        const g = canvas.getContext("2d");
        const w = canvas.width;
        const h = canvas.height;
        g.clearRect(0, 0, w, h);
        const bars = 24;
        const step = Math.max(1, Math.floor(data.length / bars));
        const barW = Math.floor((w - (bars - 1) * 3) / bars);
        const isDark = document.body.classList.contains("dark-mode");
        for (let b = 0; b < bars; b++) {
          const val = data[Math.min(data.length - 1, b * step)] / 255;
          const barH = Math.max(4, Math.round(val * (h - 6)));
          const x = b * (barW + 3);
          const y = Math.round((h - barH) / 2);
          g.fillStyle = avg > 12 ? (isDark ? "#60a5fa" : "#2563eb") : (isDark ? "#475569" : "#94a3b8");
          g.fillRect(x, y, barW, barH);
        }
      }
      coachState.rafId = requestAnimationFrame(tick);
    }

    coachState.rafId = requestAnimationFrame(tick);
  }

  function finalizeAttempt(item) {
    clearAllTimers();
    releaseMicResources();

    const userSpeechMs =
      coachState.heardAnyVoice && coachState.speechOffsetMs > coachState.speechOnsetMs
        ? Math.round(coachState.speechOffsetMs - coachState.speechOnsetMs)
        : 0;

    const hyps = coachState.asrHypotheses.length
      ? coachState.asrHypotheses
      : coachState.interimText
      ? [coachState.interimText]
      : [];

    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SR && hyps.length === 0) {
      // Browser without SpeechRecognition fallback: rhythm & audio playback check
      const moraLen = Math.max(1, parseTargetChunks(item.jp).targetMorae.length);
      const refMs = coachState.lastNativeDurationMs || moraLen * 165;
      const ratio = userSpeechMs > 280 ? userSpeechMs / refMs : null;
      const rhythmScore = ratio ? Math.max(45, Math.min(100, Math.round(100 - Math.abs(ratio - 1) * 55))) : 75;
      coachState.result = {
        fallbackAudioOnly: true,
        parsed: parseTargetChunks(item.jp),
        bestHeardRaw: "",
        bestHeardKana: "",
        accuracy: null,
        completeness: null,
        fluency: rhythmScore,
        overall: rhythmScore,
        grade: rhythmScore >= 85 ? "A" : "B",
        paceRatio: ratio,
        userSpeechMs,
        nativeDurationMs: refMs,
        chunkResults: parseTargetChunks(item.jp).chunks.map((c) => ({ ...c, status: c.isPunct ? "punct" : "neutral", issueTypes: [] })),
        tips: [
          {
            type: "fallback",
            severity: "info",
            icon: "🎧",
            title: "当前浏览器仅支持录音与语速节奏比对",
            detail: "已完整录制你的跟读声音！请点击「⚖️ 对比听：原声 → 我」亲自对比发声清晰度，或在「✨ AI 私教设置」填入 Gemini Key 开启 AI 精细听音纠错。"
          }
        ]
      };
      coachState.phase = "result";
      coachState.statusText = "✅ 录音完成！可随时与原声对比回放";
      renderCurrentSurface();
      if (isGeminiEnabled() && coachState.userBlob) {
        runGeminiAudioCoach(item, coachState.userBlob);
      }
      return;
    }

    const ev = evaluateOralAttempt(item.jp, hyps, coachState.lastNativeDurationMs, userSpeechMs);
    coachState.result = ev;
    coachState.phase = "result";
    coachState.statusText =
      ev.overall >= 92
        ? "🌟 S级地道发音！"
        : ev.overall >= 80
        ? "🎉 A级过关！表达清晰自然"
        : ev.overall >= 65
        ? "💪 B级接近了，看看下面的纠音建议再读一次"
        : "🐢 建议先慢速听一遍重点词块，再来挑战";

    saveOralScore(item, ev);
    renderCurrentSurface();

    // Trigger optional Gemini AI Coach in parallel
    if (isGeminiEnabled() && coachState.userBlob) {
      runGeminiAudioCoach(item, coachState.userBlob);
    }

    // Hands-free auto-flow if toggled
    if (coachState.handsFree && !coachState.isModalOpen) {
      if (ev.overall >= 80) {
        playCueChime("pass");
        coachState.autoRetries = 0;
        coachState.nextActionTimer = setTimeout(() => {
          if (coachState.handsFree) advanceToNextItem(true);
        }, 1850);
      } else if (coachState.autoRetries < 2) {
        coachState.autoRetries++;
        playCueChime("retry");
        coachState.nextActionTimer = setTimeout(() => {
          if (coachState.handsFree) {
            startGuidedPractice(item, 0.84);
          }
        }, 1600);
      }
    }
  }

  function saveOralScore(item, ev) {
    const a = app();
    if (!a || !item || !item.id || !ev.bestHeardRaw) return;
    if (!a.state.oralStats) a.state.oralStats = {};
    const prev = a.state.oralStats[item.id] || { bestScore: 0, attempts: 0 };
    const topIssues = ev.tips.map((t) => t.type).filter((t) => t !== "praise" && t !== "fallback");
    a.state.oralStats[item.id] = {
      bestScore: Math.max(prev.bestScore || 0, ev.overall),
      lastScore: ev.overall,
      attempts: (prev.attempts || 0) + 1,
      lastIssues: topIssues,
      updatedAt: Date.now()
    };
    a.saveUserState();
    a.recordStudyActivity(1);
  }

  async function runGeminiAudioCoach(item, blob) {
    const apiKey = getGeminiKey();
    if (!apiKey || !blob) return;
    coachState.aiLoading = true;
    coachState.aiError = "";
    coachState.aiResult = null;
    renderCurrentSurface();

    try {
      const { base64, mimeType } = await blobTo16kMonoWavBase64(blob);
      const targetPlain = app().stripFurigana(item.jp);
      const prompt = [
        "你是一位温柔专业、擅长针对中文母语者纠正日语发音的私人日语口语老师。",
        `学习者尝试朗读的日语目标句为：「${targetPlain}」（中文意思：${item.cn || ""}）。`,
        "请仔细聆听这段录音（不要臆测，若杂音或空白请如实指出），用简体中文简洁有力地评估高低音调 (Pitch Accent)、元音口型、清浊音、促音「っ」/长音节奏与整体自然度。"
      ].join("\n");

      const body = {
        model: "gemini-3.8-flash",
        input: [
          { type: "text", text: prompt },
          { type: "audio", data: base64, mime_type: mimeType }
        ],
        response_format: {
          type: "text",
          mime_type: "application/json",
          schema: {
            type: "object",
            properties: {
              heardJp: { type: "string", description: "你在录音中实际听到的日语内容" },
              pitchScore: { type: "integer", description: "高低音调自然度 0-100" },
              naturalnessScore: { type: "integer", description: "口型送气与整体自然度 0-100" },
              overallCoachScore: { type: "integer", description: "综合 AI 评分 0-100" },
              pitchNotes: { type: "string", description: "高低音调调型对比建议（指出哪个词调高/降调应怎么走）" },
              articulationTips: { type: "string", description: "具体的舌位、口型、送气或促音长音改进方法" },
              praise: { type: "string", description: "做得好的亮点鼓励" },
              nextDrillFocus: { type: "string", description: "下一遍最值得专注修正的1个小点" }
            },
            required: [
              "heardJp",
              "pitchScore",
              "naturalnessScore",
              "overallCoachScore",
              "pitchNotes",
              "articulationTips",
              "praise",
              "nextDrillFocus"
            ]
          }
        }
      };

      const resp = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
        method: "POST",
        headers: {
          "x-goog-api-key": apiKey,
          "Content-Type": "application/json",
          "Api-Revision": "2026-05-20"
        },
        body: JSON.stringify(body)
      });

      if (!resp.ok) {
        const errTxt = await resp.text().catch(() => "");
        throw new Error(`HTTP ${resp.status}: ${errTxt.slice(0, 140)}`);
      }
      const resJson = await resp.json();
      let rawText = resJson.output_text || "";
      if (!rawText && Array.isArray(resJson.outputs)) {
        const textOut = resJson.outputs.find((o) => o && o.type === "text" && o.text);
        if (textOut) rawText = textOut.text;
      }
      const parsedAi = JSON.parse(rawText);
      coachState.aiResult = parsedAi;
      coachState.aiLoading = false;
    } catch (err) {
      coachState.aiLoading = false;
      coachState.aiError = `AI 私教暂时不可用：${err.message || "网络或 API Key 验证失败"}`;
    }
    renderCurrentSurface();
  }

  function startGuidedPractice(item, overrideRate = null) {
    if (!item) return;
    stopAll();
    const useRate = overrideRate || coachState.rate;
    coachState.phase = "model_playing";
    coachState.result = null;
    coachState.aiResult = null;
    coachState.aiError = "";
    coachState.statusText =
      coachState.deck === "staff" && item.promptContextJp && !overrideRate
        ? "👂 第 1 步：先听店员快语速提问..."
        : `🔊 第 1 步：请听示范发音 (${useRate < 1 ? "0.84x 慢速" : "1.0x 原速"})...`;
    renderCurrentSurface();

    // Staff Responder deck plays the staff's rapid question first as context
    if (coachState.deck === "staff" && item.promptContextJp && !overrideRate) {
      app().speakJapanese(
        item.promptContextJp,
        1.0,
        null,
        () => {
          if (coachState.phase !== "model_playing") return;
          coachState.statusText = "🔊 第 1 步（续）：听一遍你的标准礼貌回答示范...";
          renderCurrentSurface();
          setTimeout(() => {
            if (coachState.phase !== "model_playing") return;
            speakTargetSentence(item, useRate, () => {
              if (coachState.phase !== "model_playing") return;
              playCueChime("start");
              setTimeout(() => {
                if (coachState.phase === "model_playing") beginListeningAndRecording(item);
              }, 260);
            });
          }, 380);
        },
        null
      );
      return;
    }

    speakTargetSentence(item, useRate, () => {
      if (coachState.phase !== "model_playing") return;
      playCueChime("start");
      setTimeout(() => {
        if (coachState.phase === "model_playing") {
          beginListeningAndRecording(item);
        }
      }, 260);
    });
  }

  function playUserRecording(compareWithNative = false, item = null) {
    if (!coachState.userAudioUrl) {
      app().showToast("⚠️ 尚未录制音频，请先跟读一句");
      return;
    }
    stopUserPlayback();
    app().stopAllAudio();

    if (compareWithNative && item) {
      coachState.compareMode = "compare";
      renderCurrentSurface();
      speakTargetSentence(item, 1.0, () => {
        if (coachState.compareMode !== "compare") return;
        setTimeout(() => {
          if (coachState.compareMode !== "compare") return;
          coachState.userPlayer.src = coachState.userAudioUrl;
          coachState.userPlayer.onended = () => {
            coachState.compareMode = null;
            renderCurrentSurface();
          };
          coachState.userPlayer.play().catch(() => {
            coachState.compareMode = null;
            renderCurrentSurface();
          });
        }, 450);
      });
    } else {
      coachState.compareMode = "user";
      renderCurrentSurface();
      coachState.userPlayer.src = coachState.userAudioUrl;
      coachState.userPlayer.onended = () => {
        coachState.compareMode = null;
        renderCurrentSurface();
      };
      coachState.userPlayer.play().catch(() => {
        coachState.compareMode = null;
        renderCurrentSurface();
      });
    }
  }

  function advanceToNextItem(autoStart = false) {
    stopAll();
    coachState.result = null;
    coachState.aiResult = null;
    coachState.aiError = "";
    coachState.phase = "idle";
    coachState.interimText = "";
    revokeUserAudioUrl();
    coachState.userBlob = null;

    if (coachState.deck === "roleplay") {
      const dlgs = getAllRoleplayDialogues();
      const dlg = dlgs.find((d) => d.id === coachState.roleplayDlgId) || dlgs[0];
      if (dlg) {
        if (coachState.roleplayTurnIdx + 1 < dlg.turns.length) {
          coachState.roleplayTurnIdx++;
        } else {
          app().showToast("🎉 本段情景对话全部完成！已回到第 1 轮");
          coachState.roleplayTurnIdx = 0;
          coachState.autoRetries = 0;
          renderCurrentSurface();
          return;
        }
      }
      renderCurrentSurface();
      const nextTurn = getActiveItem();
      if (autoStart && nextTurn) {
        if (nextTurn.speaker !== "us") runRoleplayPartnerTurn(nextTurn);
        else startGuidedPractice(nextTurn);
      }
      return;
    }

    const items = getDeckItems(coachState.deck);
    if (items.length > 0) {
      coachState.index = (coachState.index + 1) % items.length;
    }
    coachState.autoRetries = 0;
    renderCurrentSurface();
    if (autoStart) {
      const nextIt = getActiveItem();
      if (nextIt) startGuidedPractice(nextIt);
    }
  }

  function runRoleplayPartnerTurn(turnItem) {
    if (!turnItem || turnItem.speaker === "us") return;
    stopAll();
    coachState.phase = "model_playing";
    coachState.statusText = `🇯🇵 ${turnItem.speakerName}正在对你说话...`;
    renderCurrentSurface();

    speakTargetSentence(turnItem, coachState.rate, () => {
      if (coachState.phase !== "model_playing") return;
      const dlgs = getAllRoleplayDialogues();
      const dlg = dlgs.find((d) => d.id === coachState.roleplayDlgId);
      if (dlg && coachState.roleplayTurnIdx + 1 < dlg.turns.length) {
        coachState.roleplayTurnIdx++;
        coachState.phase = "idle";
        coachState.result = null;
        renderCurrentSurface();
        const nextUserTurn = getActiveItem();
        if (nextUserTurn && nextUserTurn.speaker === "us" && coachState.handsFree) {
          playCueChime("start");
          setTimeout(() => {
            if (coachState.handsFree) beginListeningAndRecording(nextUserTurn);
          }, 350);
        }
      } else {
        coachState.phase = "idle";
        renderCurrentSurface();
      }
    });
  }

  // =========================================================================
  // Shared HTML Render Helpers (Studio + Quick Modal)
  // =========================================================================
  function renderStepBar() {
    const p = coachState.phase;
    const s1 = p === "model_playing" ? "step-active" : p === "listening" || p === "evaluating" || p === "result" ? "step-done" : "";
    const s2 = p === "listening" || p === "evaluating" ? "step-active" : p === "result" ? "step-done" : "";
    const s3 = p === "result" ? "step-done" : "";
    return `
      <div class="oc-step-bar">
        <div class="oc-step-pill ${s1}"><span>1</span> 🔊 示范朗读</div>
        <div class="oc-step-pill ${s2}"><span>2</span> 🎙️ 自动开麦跟读</div>
        <div class="oc-step-pill ${s3}"><span>3</span> 📊 评判与纠音</div>
      </div>
    `;
  }

  function renderDiffSentenceHtml(item) {
    const a = app();
    if (!coachState.result) {
      return `<div class="jp-text oc-main-jp ${coachState.blindMode ? "oc-blind-blur" : ""}" lang="ja">${a.formatRuby(item.jp)}</div>`;
    }
    const chunks = coachState.result.chunkResults || [];
    const html = chunks
      .map((ch) => {
        if (ch.isPunct) return `<span class="oc-tok oc-tok-punct">${ch.displayHtml}</span>`;
        if (ch.status === "neutral") return `<span class="oc-tok">${ch.displayHtml}</span>`;
        const cls = ch.status === "ok" ? "oc-tok-ok" : ch.status === "close" ? "oc-tok-close" : "oc-tok-miss";
        const issueHint =
          ch.status === "close" && ch.issueTypes && ch.issueTypes[0]
            ? ch.issueTypes[0] === "sokuon"
              ? "促音っ"
              : ch.issueTypes[0] === "long_vowel"
              ? "长音"
              : ch.issueTypes[0] === "voicing"
              ? "清浊"
              : "发音"
            : ch.status === "miss"
            ? "漏读"
            : "";
        return `<span class="oc-tok ${cls}" ${issueHint ? `data-hint="${issueHint}" title="${issueHint}"` : ""}>${ch.displayHtml}${issueHint ? `<span class="oc-tok-badge">${issueHint}</span>` : ""}</span>`;
      })
      .join("");
    return `<div class="jp-text oc-main-jp oc-diff-sentence" lang="ja">${html}</div>`;
  }

  function renderEvaluationHtml(item) {
    const r = coachState.result;
    if (!r) return "";
    const a = app();
    const tierCls = r.grade === "S" ? "tier-s" : r.grade === "A" ? "tier-a" : r.grade === "B" ? "tier-b" : "tier-c";

    const paceLabel = r.paceRatio
      ? `${r.fluency}分 (${r.paceRatio.toFixed(2)}x 原速)`
      : `${r.fluency}分`;

    const aiCardHtml = isGeminiEnabled()
      ? coachState.aiLoading
        ? `<div class="oc-ai-card"><div class="oc-ai-hdr">✨ Gemini 3.8 Flash 深度听音分析中...</div><div style="font-size:0.8rem;color:var(--text-secondary);">正在评估高低音调 (Pitch Accent)、元音口型与自然度，请稍候 1–2 秒。</div></div>`
        : coachState.aiError
        ? `<div class="oc-ai-card oc-ai-err">${a.escapeHtml(coachState.aiError)}</div>`
        : coachState.aiResult
        ? `<div class="oc-ai-card">
            <div class="oc-ai-hdr">✨ Gemini AI 私教深度点评 <strong>综合 ${coachState.aiResult.overallCoachScore} 分</strong></div>
            <div class="oc-ai-grid">
              <div><span>听写识别：</span><strong lang="ja">${a.escapeHtml(coachState.aiResult.heardJp)}</strong></div>
              <div><span>高低音调：</span><strong>${coachState.aiResult.pitchScore}/100</strong> · <span>自然度：</span><strong>${coachState.aiResult.naturalnessScore}/100</strong></div>
            </div>
            <div class="oc-ai-line"><strong>🎵 音调走势：</strong>${a.escapeHtml(coachState.aiResult.pitchNotes)}</div>
            <div class="oc-ai-line"><strong>👄 发音口型：</strong>${a.escapeHtml(coachState.aiResult.articulationTips)}</div>
            <div class="oc-ai-line"><strong>🌟 鼓励亮点：</strong>${a.escapeHtml(coachState.aiResult.praise)}</div>
            <div class="oc-ai-line"><strong>🎯 下遍重点：</strong>${a.escapeHtml(coachState.aiResult.nextDrillFocus)}</div>
          </div>`
        : ""
      : "";

    return `
      <div class="oc-result-panel">
        <div class="oc-score-header">
          <div class="oc-score-circle ${tierCls}">
            <div class="oc-score-num">${r.overall}</div>
            <div class="oc-score-grade">${r.grade}级</div>
          </div>
          <div class="oc-metrics-3col">
            <div class="oc-metric-item">
              <div class="oc-m-top"><span>🎯 准确度</span><strong>${r.accuracy === null ? "音频模式" : `${r.accuracy}分`}</strong></div>
              <div class="progress-bar-track"><div class="progress-bar-fill" style="width:${r.accuracy ?? 80}%;background:#2563eb;"></div></div>
            </div>
            <div class="oc-metric-item">
              <div class="oc-m-top"><span>🧩 完整度</span><strong>${r.completeness === null ? "—" : `${r.completeness}分`}</strong></div>
              <div class="progress-bar-track"><div class="progress-bar-fill" style="width:${r.completeness ?? 80}%;background:#059669;"></div></div>
            </div>
            <div class="oc-metric-item">
              <div class="oc-m-top"><span>⏱️ 节奏语速</span><strong>${paceLabel}</strong></div>
              <div class="progress-bar-track"><div class="progress-bar-fill" style="width:${r.fluency}%;background:#7c3aed;"></div></div>
            </div>
          </div>
        </div>

        ${
          r.bestHeardRaw
            ? `<div class="oc-heard-line">
                🎙️ 语音识别听到：<strong lang="ja">${a.escapeHtml(r.bestHeardRaw)}</strong>
                ${r.bestHeardKana ? `<span style="opacity:0.75;font-size:0.78rem;">（${a.escapeHtml(r.bestHeardKana)}）</span>` : ""}
              </div>`
            : ""
        }

        <div class="oc-legend-row">
          <span class="oc-leg-chip leg-ok">🟢 清晰过关</span>
          <span class="oc-leg-chip leg-close">🟡 近似 / 拍节略偏</span>
          <span class="oc-leg-chip leg-miss">🔴 漏读或误读</span>
        </div>

        <div class="oc-tips-list">
          ${r.tips
            .map(
              (t) => `
            <div class="oc-tip-card tip-${t.severity}">
              <div class="oc-tip-title">${t.icon} ${a.escapeHtml(t.title)}</div>
              <div class="oc-tip-detail">${a.escapeHtml(t.detail)}</div>
            </div>
          `
            )
            .join("")}
        </div>

        ${aiCardHtml}

        ${
          coachState.userAudioUrl
            ? `<div class="oc-compare-bar">
                <button type="button" class="action-btn ${coachState.compareMode === "user" ? "speaking" : ""}" id="oc-btn-play-user">
                  ${coachState.compareMode === "user" ? "🔊 正在回放我的声音..." : "🎧 听我的录音 (P)"}
                </button>
                <button type="button" class="action-btn primary-audio ${coachState.compareMode === "compare" ? "speaking" : ""}" id="oc-btn-compare">
                  ${coachState.compareMode === "compare" ? "⚖️ 对比播放中..." : "⚖️ 对比听：原声 → 我 (C)"}
                </button>
              </div>`
            : ""
        }
      </div>
    `;
  }

  function renderCaptureControlsHtml(item, isQuick = false) {
    const p = coachState.phase;
    const isBusy = p === "model_playing" || p === "listening" || p === "evaluating";
    return `
      ${
        coachState.statusText
          ? `<div class="shadow-status-banner ${p === "listening" ? "oc-banner-listening" : ""}">${app().escapeHtml(coachState.statusText)}</div>`
          : ""
      }

      ${
        p === "listening"
          ? `<div class="oc-live-capture">
              <div class="oc-mic-row">
                <span class="oc-mic-dot"></span>
                <span>正在收音跟读中…</span>
                <button type="button" class="action-btn speaking" id="oc-btn-finish-now">⏹ 说完了，立即评分</button>
              </div>
              <canvas id="oc-waveform-canvas" class="oc-waveform-canvas" width="320" height="44"></canvas>
              <div id="oc-interim-live" class="oc-interim-box" lang="ja">${app().escapeHtml(coachState.interimText || "请直接开口说日语…")}</div>
            </div>`
          : ""
      }

      <div class="fc-controls-row oc-controls-row">
        ${
          !isQuick
            ? `<button type="button" class="action-btn" id="oc-btn-prev">← 上一句</button>`
            : ""
        }
        ${
          isBusy
            ? `<button type="button" class="action-btn speaking" id="oc-btn-stop-all">⏹ 停止</button>`
            : `<button type="button" class="action-btn primary-audio" id="oc-btn-guided">
                ${coachState.result ? "🔁 再示范并跟读" : "▶ 示范并自动跟读"}
              </button>
              <button type="button" class="action-btn" id="oc-btn-direct-mic">🎙️ 直接开麦</button>`
        }
        <button type="button" class="action-btn" id="oc-btn-model-1x" title="原速示范 (R)">🔊 原声</button>
        <button type="button" class="action-btn" id="oc-btn-model-slow" title="慢速示范 (S)">🐢 0.84x</button>
        ${
          !isQuick
            ? `<button type="button" class="action-btn" id="oc-btn-next">下一句 →</button>`
            : ""
        }
      </div>
    `;
  }

  function renderStudio(container) {
    if (!container) return;
    const a = app();
    if (!a) return;

    const dlgs = getAllRoleplayDialogues();
    const items = coachState.deck === "roleplay" ? [] : getDeckItems(coachState.deck);
    const item = getActiveItem();
    if (
      item &&
      typeof location !== "undefined" &&
      location.hostname === "127.0.0.1" &&
      location.search.includes("oral_demo=1") &&
      !coachState._demoInjected
    ) {
      coachState._demoInjected = true;
      coachState.phase = "result";
      coachState.statusText = "🧪 评测示例：已标注绿/黄/红逐词差异与发音指导";
      coachState.result = evaluateOralAttempt(
        item.jp,
        "こんにちはアメリカのサンフランシスコのちかからきましたりゅうともします",
        4200,
        4300
      );
    }
    const hasSR = !!(window.SpeechRecognition || window.webkitSpeechRecognition);
    const oralStats = (a.state && a.state.oralStats) || {};
    const weakCount = getDeckItems("weak").length;
    const aiReady = isGeminiEnabled();

    const deckPills = [
      ["phrases", `🗣️ 场景短语`],
      ["roleplay", `🎭 对话角色扮演 (${dlgs.length})`],
      ["staff", `🏪 店员听问回答 (24)`],
      ["verbs", `⚡ 动词例句 (300)`],
      ["grammar", `📖 语法例句 (132)`],
      ["n5vocab", `🟢 N5 & 缩略`],
      ["weak", `🔥 薄弱复训 (${weakCount})`]
    ];

    let stageContent = "";

    if (!item) {
      stageContent = `
        <div class="drill-question-box" style="text-align:center;padding:2rem;">
          <div style="font-size:2rem;margin-bottom:0.4rem;">🎉</div>
          <div style="font-weight:800;margin-bottom:0.4rem;">当前还没有低于 80 分的薄弱句！</div>
          <p style="font-size:0.84rem;color:var(--text-secondary);margin-bottom:0.9rem;">先在「场景短语」或「对话角色扮演」跟读几句，系统会自动把需要加强的句子收集到这里方便复训。</p>
          <button type="button" class="action-btn primary-audio" id="oc-btn-back-phrases">切换回场景短语</button>
        </div>
      `;
    } else if (coachState.deck === "roleplay" && item.dialogue) {
      const dlg = item.dialogue;
      const curTurn = item;
      const isPartnerTurn = curTurn.speaker !== "us";

      stageContent = `
        <div class="drill-question-box oc-sentence-card">
          <div class="oc-roleplay-bar">
            <select id="oc-rp-select" class="verb-select" style="flex:1;min-width:200px;" aria-label="选择场景对话">
              ${dlgs.map((d) => `<option value="${d.id}" ${d.id === dlg.id ? "selected" : ""}>${a.escapeHtml(d.title)}</option>`).join("")}
            </select>
            <span class="phrase-tag">轮次 ${coachState.roleplayTurnIdx + 1} / ${dlg.turns.length}</span>
          </div>
          <div class="dialogue-context" style="margin:0.45rem 0 0.7rem;">📍 ${a.escapeHtml(dlg.context)}</div>

          <div class="oc-roleplay-thread">
            ${dlg.turns
              .map((t, idx) => {
                const stateCls =
                  idx === coachState.roleplayTurnIdx ? "rp-active" : idx < coachState.roleplayTurnIdx ? "rp-done" : "rp-upcoming";
                const turnStats = oralStats[`${dlg.id}-turn-${idx}`];
                return `
                <div class="oc-rp-bubble ${t.speaker === "us" ? "rp-us" : "rp-them"} ${stateCls}" data-rpturn="${idx}">
                  <div class="oc-rp-who">
                    <span>${t.speaker === "us" ? "👨‍👩‍👧‍👧 我方：" : "🇯🇵 对方："}${a.escapeHtml(t.speakerName)}</span>
                    ${turnStats ? `<span class="oc-oral-badge">最佳 ${turnStats.bestScore}分</span>` : ""}
                  </div>
                  <div class="jp-text" lang="ja" style="font-size:1rem;line-height:1.8;">${a.formatRuby(t.jp)}</div>
                  <div class="cn-text" style="font-size:0.8rem;margin:0;">${a.escapeHtml(t.cn)}</div>
                </div>
              `;
              })
              .join("")}
          </div>

          <div class="oc-rp-spotlight">
            <div style="text-align:center;margin-bottom:0.35rem;">
              <span class="phrase-tag">${isPartnerTurn ? `🇯🇵 轮到对方说话 (${a.escapeHtml(curTurn.speakerName)})` : `🎤 轮到你回答！(${a.escapeHtml(curTurn.speakerName)})`}</span>
            </div>
            ${renderDiffSentenceHtml(curTurn)}
            <div class="romaji-text" style="text-align:center;">${a.escapeHtml(curTurn.romaji)}</div>
            <div class="cn-text" style="text-align:center;margin-bottom:0.65rem;">${a.escapeHtml(curTurn.cn)}</div>
            ${curTurn.note ? `<div class="turn-note" style="margin-bottom:0.65rem;">💡 ${a.escapeHtml(curTurn.note)}</div>` : ""}

            ${
              isPartnerTurn
                ? `<div class="fc-controls-row oc-controls-row">
                    <button type="button" class="action-btn" id="oc-btn-rp-prev">← 上一轮</button>
                    <button type="button" class="action-btn primary-audio" id="oc-btn-rp-partner">🔊 播放对方台词并进入我方回复</button>
                    <button type="button" class="action-btn" id="oc-btn-rp-skip">跳过到下一轮 →</button>
                  </div>`
                : `${renderCaptureControlsHtml(curTurn, false)}
                   ${renderEvaluationHtml(curTurn)}`
            }
          </div>
        </div>
      `;
    } else {
      const prevStat = oralStats[item.id];
      stageContent = `
        <div class="drill-question-box oc-sentence-card">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:0.5rem;flex-wrap:wrap;margin-bottom:0.5rem;">
            <span class="phrase-tag">${a.escapeHtml(item.tag)}</span>
            <div style="display:flex;gap:0.4rem;align-items:center;">
              ${prevStat ? `<span class="oc-oral-badge">历史最高 ${prevStat.bestScore}分 (${prevStat.attempts}次)</span>` : ""}
              <span style="font-size:0.78rem;color:var(--text-muted);font-weight:700;">第 ${coachState.index + 1} / ${items.length} 句</span>
            </div>
          </div>

          ${renderStepBar()}

          ${
            item.promptContextJp
              ? `<div class="oc-staff-prompt">
                  <div style="font-size:0.74rem;font-weight:800;color:var(--accent-indigo);margin-bottom:0.2rem;">👂 店员向你说（先听懂问题，再朗读下方回答）：</div>
                  <div class="jp-text" lang="ja" style="font-size:1.05rem;">${a.formatRuby(item.promptContextJp)}</div>
                  <div class="cn-text" style="font-size:0.8rem;margin:0;">${a.escapeHtml(item.promptContextCn)}</div>
                </div>`
              : ""
          }

          ${renderDiffSentenceHtml(item)}
          <div class="romaji-text ${coachState.blindMode && !coachState.result ? "oc-blind-blur" : ""}" style="text-align:center;">${a.escapeHtml(item.romaji)}</div>
          <div class="cn-text" style="text-align:center;margin-bottom:0.75rem;">${a.escapeHtml(item.cn)}</div>

          ${renderCaptureControlsHtml(item, false)}
          ${renderEvaluationHtml(item)}

          <div class="kbd-shortcut-hint">⌨️ 快捷键：Space 开始/停止跟读 · R 原速重听 · S 慢速(0.84x) · P 听我录音 · C 原声对比 · Enter 下一句</div>
        </div>
      `;
    }

    container.innerHTML = `
      <div class="practice-stage-card oc-studio">
        <div class="practice-toolbar-row oc-top-bar">
          <div class="toggle-group oc-deck-pills scroll-fade-x">
            ${deckPills.map(([k, lbl]) => `<button type="button" class="toggle-chip ${coachState.deck === k ? "active" : ""}" data-ocdeck="${k}">${lbl}</button>`).join("")}
          </div>
          <div class="toggle-group oc-mode-switches">
            <button type="button" class="toggle-chip ${coachState.handsFree ? "active" : ""}" id="oc-toggle-handsfree" title="≥80分自动进下句；<80分自动慢速重放再练一次">
              ${coachState.handsFree ? "🚀 连续闯关：开" : "🚀 连续闯关"}
            </button>
            <button type="button" class="toggle-chip ${coachState.blindMode ? "active" : ""}" id="oc-toggle-blind" title="隐藏日文拼写，凭听示范复述">
              ${coachState.blindMode ? "🙈 盲读：开" : "🙈 盲读挑战"}
            </button>
            <button type="button" class="toggle-chip ${coachState.rate < 1 ? "active" : ""}" id="oc-toggle-rate" title="切换示范语速">
              ${coachState.rate < 1 ? "🐢 默认0.84x" : "🔊 默认1.0x"}
            </button>
            <button type="button" class="toggle-chip ${aiReady ? "active" : ""}" id="oc-toggle-ai-cfg">
              ${aiReady ? "✨ AI私教：已开" : "⚙️ AI私教设置"}
            </button>
          </div>
        </div>

        ${
          !hasSR
            ? `<div class="phrase-tip" style="margin-bottom:0.65rem;">💡 提示：当前浏览器未提供内置日语语音转写接口（建议使用 Chrome / Edge / Safari）。系统仍支持「示范 → 自动录音 → 波形与节奏对比 → 原声/自录对比」。</div>`
            : ""
        }

        ${
          coachState.showAiSettings
            ? `<div class="oc-ai-settings">
                <div style="font-weight:800;font-size:0.86rem;margin-bottom:0.35rem;">✨ 可选：Gemini AI 深度听音私教（默认关闭，免配也可完整使用本地即时纠音）</div>
                <div style="font-size:0.78rem;color:var(--text-secondary);margin-bottom:0.55rem;">
                  填入你自己的 Gemini API Key 后，每次跟读都会同步调用官方 <code>gemini-3.8-flash</code> 模型听音分析<strong>高低音调 (Pitch Accent)</strong> 与<strong>舌位口型自然度</strong>。<br/>
                  🔒 Key 仅保存在当前浏览器 <code>localStorage</code>，音频仅直连 Google 官方 API，不经过任何第三方服务器。
                </div>
                <div style="display:flex;gap:0.45rem;flex-wrap:wrap;align-items:center;">
                  <input type="password" id="oc-gemini-key-input" class="verb-search-input" style="flex:1;min-width:210px;" placeholder="粘贴你的 Gemini API Key (AIza...)" value="${a.escapeHtml(getGeminiKey())}" />
                  <label style="display:inline-flex;align-items:center;gap:0.3rem;font-size:0.8rem;font-weight:700;cursor:pointer;">
                    <input type="checkbox" id="oc-gemini-enabled-chk" ${localStorage.getItem(GEMINI_ENABLED_STORAGE) === "1" ? "checked" : ""} /> 启用 AI 私教
                  </label>
                  <button type="button" class="action-btn primary-audio" id="oc-gemini-save-btn">💾 保存</button>
                  <button type="button" class="action-btn" id="oc-gemini-clear-btn">清除</button>
                </div>
              </div>`
            : ""
        }

        ${stageContent}
      </div>
    `;

    bindStudioEvents(container, item);
  }

  function renderQuickModalBody(container) {
    const a = app();
    const item = coachState.modalItem;
    if (!a || !container || !item) return;
    const prevStat = (a.state.oralStats || {})[item.id];
    const hasSR = !!(window.SpeechRecognition || window.webkitSpeechRecognition);

    container.innerHTML = `
      <div class="oc-quick-modal">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:0.5rem;flex-wrap:wrap;padding-right:2.2rem;margin-bottom:0.55rem;">
          <span class="phrase-tag">${a.escapeHtml(item.tag || "🎙️ 口语跟读")}</span>
          ${prevStat ? `<span class="oc-oral-badge">最高 ${prevStat.bestScore}分 · ${prevStat.attempts}次</span>` : ""}
        </div>

        ${renderStepBar()}
        ${renderDiffSentenceHtml(item)}
        ${item.romaji ? `<div class="romaji-text" style="text-align:center;">${a.escapeHtml(item.romaji)}</div>` : ""}
        <div class="cn-text" style="text-align:center;margin-bottom:0.75rem;">${a.escapeHtml(item.cn)}</div>

        ${
          !hasSR
            ? `<div style="font-size:0.76rem;color:var(--text-muted);text-align:center;margin-bottom:0.5rem;">当前浏览器支持录音与原声对比（推荐 Chrome/Safari 解锁逐词实时识别打分）</div>`
            : ""
        }

        ${renderCaptureControlsHtml(item, true)}
        ${renderEvaluationHtml(item)}
      </div>
    `;

    bindCommonActionEvents(container, item, true);
  }

  function bindCommonActionEvents(root, item, isQuick = false) {
    const btnGuided = root.querySelector("#oc-btn-guided");
    if (btnGuided && item) btnGuided.onclick = () => startGuidedPractice(item);

    const btnDirect = root.querySelector("#oc-btn-direct-mic");
    if (btnDirect && item) {
      btnDirect.onclick = () => {
        stopAll();
        playCueChime("start");
        beginListeningAndRecording(item);
      };
    }

    const btnFinishNow = root.querySelector("#oc-btn-finish-now");
    if (btnFinishNow && coachState._manualFinish) btnFinishNow.onclick = () => coachState._manualFinish();

    const btnStopAll = root.querySelector("#oc-btn-stop-all");
    if (btnStopAll) {
      btnStopAll.onclick = () => {
        coachState.handsFree = false;
        stopAll();
        renderCurrentSurface();
      };
    }

    const btn1x = root.querySelector("#oc-btn-model-1x");
    if (btn1x && item) btn1x.onclick = () => speakTargetSentence(item, 1.0);

    const btnSlow = root.querySelector("#oc-btn-model-slow");
    if (btnSlow && item) btnSlow.onclick = () => speakTargetSentence(item, 0.84);

    const btnPlayUser = root.querySelector("#oc-btn-play-user");
    if (btnPlayUser && item) btnPlayUser.onclick = () => playUserRecording(false, item);

    const btnCompare = root.querySelector("#oc-btn-compare");
    if (btnCompare && item) btnCompare.onclick = () => playUserRecording(true, item);
  }

  function bindStudioEvents(container, item) {
    container.querySelectorAll("[data-ocdeck]").forEach((b) => {
      b.onclick = () => {
        stopAll();
        coachState.deck = b.dataset.ocdeck;
        coachState.index = 0;
        coachState.result = null;
        coachState.aiResult = null;
        coachState.aiError = "";
        coachState.phase = "idle";
        revokeUserAudioUrl();
        coachState.userBlob = null;
        renderCurrentSurface();
      };
    });

    const btnBackPhrases = container.querySelector("#oc-btn-back-phrases");
    if (btnBackPhrases) {
      btnBackPhrases.onclick = () => {
        coachState.deck = "phrases";
        coachState.index = 0;
        renderCurrentSurface();
      };
    }

    const tHF = container.querySelector("#oc-toggle-handsfree");
    if (tHF) {
      tHF.onclick = () => {
        coachState.handsFree = !coachState.handsFree;
        coachState.autoRetries = 0;
        app().showToast(coachState.handsFree ? "🚀 已开启解放双手连续闯关：≥80分自动进下句！" : "已关闭连续闯关模式");
        renderCurrentSurface();
      };
    }

    const tBlind = container.querySelector("#oc-toggle-blind");
    if (tBlind) {
      tBlind.onclick = () => {
        coachState.blindMode = !coachState.blindMode;
        renderCurrentSurface();
      };
    }

    const tRate = container.querySelector("#oc-toggle-rate");
    if (tRate) {
      tRate.onclick = () => {
        coachState.rate = coachState.rate < 1 ? 1.0 : 0.84;
        renderCurrentSurface();
      };
    }

    const tAiCfg = container.querySelector("#oc-toggle-ai-cfg");
    if (tAiCfg) {
      tAiCfg.onclick = () => {
        coachState.showAiSettings = !coachState.showAiSettings;
        renderCurrentSurface();
      };
    }

    const btnAiSave = container.querySelector("#oc-gemini-save-btn");
    if (btnAiSave) {
      btnAiSave.onclick = () => {
        const keyInput = container.querySelector("#oc-gemini-key-input");
        const chk = container.querySelector("#oc-gemini-enabled-chk");
        const val = keyInput ? keyInput.value.trim() : "";
        if (val) localStorage.setItem(GEMINI_KEY_STORAGE, val);
        else localStorage.removeItem(GEMINI_KEY_STORAGE);
        localStorage.setItem(GEMINI_ENABLED_STORAGE, chk && chk.checked && val ? "1" : "0");
        coachState.showAiSettings = false;
        app().showToast(val && chk && chk.checked ? "✨ Gemini AI 听音私教已就绪！" : "✅ 设置已保存");
        renderCurrentSurface();
      };
    }

    const btnAiClear = container.querySelector("#oc-gemini-clear-btn");
    if (btnAiClear) {
      btnAiClear.onclick = () => {
        localStorage.removeItem(GEMINI_KEY_STORAGE);
        localStorage.removeItem(GEMINI_ENABLED_STORAGE);
        coachState.aiResult = null;
        coachState.aiError = "";
        app().showToast("🗑️ 已清除本地 API Key");
        renderCurrentSurface();
      };
    }

    // Roleplay controls
    const rpSelect = container.querySelector("#oc-rp-select");
    if (rpSelect) {
      rpSelect.onchange = (e) => {
        stopAll();
        coachState.roleplayDlgId = e.target.value;
        coachState.roleplayTurnIdx = 0;
        coachState.result = null;
        coachState.aiResult = null;
        coachState.phase = "idle";
        renderCurrentSurface();
      };
    }
    container.querySelectorAll("[data-rpturn]").forEach((el) => {
      el.onclick = () => {
        stopAll();
        coachState.roleplayTurnIdx = Number(el.dataset.rpturn) || 0;
        coachState.result = null;
        coachState.aiResult = null;
        coachState.phase = "idle";
        renderCurrentSurface();
      };
    });

    const btnRpPartner = container.querySelector("#oc-btn-rp-partner");
    if (btnRpPartner && item) btnRpPartner.onclick = () => runRoleplayPartnerTurn(item);

    const btnRpPrev = container.querySelector("#oc-btn-rp-prev");
    if (btnRpPrev && item && item.dialogue) {
      btnRpPrev.onclick = () => {
        stopAll();
        const len = item.dialogue.turns.length;
        coachState.roleplayTurnIdx = (coachState.roleplayTurnIdx - 1 + len) % len;
        coachState.result = null;
        coachState.phase = "idle";
        renderCurrentSurface();
      };
    }
    const btnRpSkip = container.querySelector("#oc-btn-rp-skip");
    if (btnRpSkip) btnRpSkip.onclick = () => advanceToNextItem(false);

    // Normal prev / next
    const btnPrev = container.querySelector("#oc-btn-prev");
    if (btnPrev) {
      btnPrev.onclick = () => {
        stopAll();
        coachState.result = null;
        coachState.aiResult = null;
        coachState.aiError = "";
        coachState.phase = "idle";
        revokeUserAudioUrl();
        coachState.userBlob = null;
        if (coachState.deck === "roleplay" && item && item.dialogue) {
          const len = item.dialogue.turns.length;
          coachState.roleplayTurnIdx = (coachState.roleplayTurnIdx - 1 + len) % len;
        } else {
          const items = getDeckItems(coachState.deck);
          if (items.length > 0) coachState.index = (coachState.index - 1 + items.length) % items.length;
        }
        renderCurrentSurface();
      };
    }

    const btnNext = container.querySelector("#oc-btn-next");
    if (btnNext) btnNext.onclick = () => advanceToNextItem(false);

    if (item) bindCommonActionEvents(container, item, false);
  }

  function openQuickModal(item) {
    const a = app();
    if (!a || !item) return;
    stopAll();
    coachState.isModalOpen = true;
    coachState.modalItem = item;
    coachState.phase = "idle";
    coachState.statusText = "";
    coachState.interimText = "";
    coachState.result = null;
    coachState.aiResult = null;
    coachState.aiError = "";
    revokeUserAudioUrl();
    coachState.userBlob = null;

    const body = a.openModalHtml(`<div id="oc-quick-modal-root"></div>`);
    if (body) renderQuickModalBody(body.querySelector("#oc-quick-modal-root"));
  }

  function openRoleplayDialogue(dlgId) {
    stopAll();
    coachState.isModalOpen = false;
    coachState.modalItem = null;
    coachState.deck = "roleplay";
    coachState.roleplayDlgId = dlgId;
    coachState.roleplayTurnIdx = 0;
    coachState.result = null;
    coachState.aiResult = null;
    coachState.phase = "idle";
    revokeUserAudioUrl();
    coachState.userBlob = null;
  }

  function handleKeydown(e) {
    if (coachState.isModalOpen) return;
    const item = getActiveItem();
    if (!item) return;

    if (e.code === "Space") {
      e.preventDefault();
      if (coachState.phase === "listening" && coachState._manualFinish) coachState._manualFinish();
      else if (coachState.phase === "model_playing") stopAll();
      else if (coachState.deck === "roleplay" && item.speaker !== "us") runRoleplayPartnerTurn(item);
      else startGuidedPractice(item);
      renderCurrentSurface();
    } else if (e.key === "r" || e.key === "R") {
      speakTargetSentence(item, 1.0);
    } else if (e.key === "s" || e.key === "S") {
      speakTargetSentence(item, 0.84);
    } else if (e.key === "p" || e.key === "P") {
      if (coachState.userAudioUrl) playUserRecording(false, item);
    } else if (e.key === "c" || e.key === "C") {
      if (coachState.userAudioUrl) playUserRecording(true, item);
    } else if (e.key === "Enter" || e.key === "ArrowRight") {
      e.preventDefault();
      advanceToNextItem(false);
    }
  }

  // Deterministic evaluation & studio preview helper for automated verification
  function _testEvaluate(targetJp, heardOrAlts, nativeMs = 0, userMs = 0) {
    return evaluateOralAttempt(targetJp, heardOrAlts, nativeMs, userMs);
  }

  function _testInjectResult(targetJp, heardOrAlts, nativeMs = 0, userMs = 0) {
    const item = getActiveItem() || { id: "test-1", tag: "🧪 发音测试", jp: targetJp, romaji: "", cn: "测试句子" };
    const evalItem = targetJp ? { ...item, jp: targetJp } : item;
    if (coachState.isModalOpen) coachState.modalItem = evalItem;
    const ev = evaluateOralAttempt(evalItem.jp, heardOrAlts, nativeMs, userMs);
    coachState.phase = "result";
    coachState.statusText = `🧪 已评判：${ev.overall}分 (${ev.grade}级)`;
    coachState.result = ev;
    saveOralScore(evalItem, ev);
    renderCurrentSurface();
    return ev;
  }

  window.JP_ORAL_COACH = {
    renderStudio,
    openQuickModal,
    openRoleplayDialogue,
    handleKeydown,
    stopAll() {
      coachState.isModalOpen = false;
      coachState.modalItem = null;
      coachState.handsFree = false;
      stopAll();
    },
    _testEvaluate,
    _testInjectResult
  };
})();
