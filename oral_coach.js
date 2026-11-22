// Oral Follow-Reading & Pronunciation Coach (V12)
// Dual-Engine:
//   1. Built-in Zero-Config Local Engine: Corpus Kanji->Kana + Japanese Mora DP Alignment
//      + Web Audio Live Waveform & VAD Pace + Sokuon/Long-Vowel/Voicing/Ending Coaching
//      + Pitch Accent Mora Strip + Weakness Radar + Clickable Chunk Micro-Drill + Free-Talk
//   2. Optional Gemini AI Audio Coach (BYOK, gemini-3.8-flash Interactions API over 16kHz WAV)
(function () {
  const GEMINI_KEY_STORAGE = "jp_phrasebook_gemini_key_v1";
  const GEMINI_ENABLED_STORAGE = "jp_phrasebook_gemini_enabled_v1";
  const MANUAL_STOP_STORAGE = "jp_phrasebook_oral_manual_stop_v1";
  const MUTE_CHIME_STORAGE = "jp_phrasebook_oral_mute_chime_v1";
  const PITCH_GUIDE_STORAGE = "jp_phrasebook_oral_pitch_guide_v1";

  const ISSUE_META = {
    sokuon: {
      icon: "⏸️",
      label: "促音停顿 (っ)",
      shortTip: "遇到小「っ」先憋住半拍静音再爆破下个音"
    },
    long_vowel: {
      icon: "〰️",
      label: "长音拍数 (ー/う/い)",
      shortTip: "长音须拉满两拍时长，不可匆忙收短"
    },
    voicing: {
      icon: "🔔",
      label: "清浊音区分 (か/が)",
      shortTip: "浊音声带震动（摸喉可感），清音在词中不送气"
    },
    consonant: {
      icon: "👄",
      label: "辅音舌位 (ら/つ/ん)",
      shortTip: "ら行舌尖轻弹上齿龈；つ保持扁平轻吐；ん鼻音占一拍"
    },
    ending: {
      icon: "🏁",
      label: "句尾完整度 (ます/です)",
      shortTip: "日语时态与礼貌体都在句末，最后一拍不要吞音"
    },
    pace: {
      icon: "⏱️",
      label: "语速流利度",
      shortTip: "跟上 0.84x 拍节后按词块一口气连读"
    }
  };

  const VOICED_KANA_RE = /[がぎぐげござじずぜぞだぢづでどばびぶべぼぱぴぷぺぽ]/;
  const TRAILING_PARTICLE_MORA = new Set(["か", "ね", "よ", "わ", "さ", "ぞ"]);
  const ATAMADAKA_OPENERS = [
    "はい", "ちょっと", "いくら", "どこ", "いつ", "だれ", "きょう",
    "いま", "あと", "まだ", "すぐ", "なんで", "どう"
  ];

  // Deterministic Tokyo pitch drops for polite sentence endings (suffix mora array -> offset from end of core)
  const POLITE_DROP_SUFFIXES = [
    { suffix: ["あ", "り", "が", "と", "う", "ご", "ざ", "い", "ま", "す"], dropFromEnd: 4 },
    { suffix: ["お", "ね", "が", "い", "し", "ま", "す"], dropFromEnd: 2 },
    { suffix: ["す", "み", "ま", "せ", "ん"], dropFromEnd: 2 },
    { suffix: ["く", "だ", "さ", "い"], dropFromEnd: 2 },
    { suffix: ["ま", "し", "た"], dropFromEnd: 3 },
    { suffix: ["ま", "せ", "ん"], dropFromEnd: 2 },
    { suffix: ["ま", "しょ", "う"], dropFromEnd: 2 },
    { suffix: ["ま", "す"], dropFromEnd: 2 },
    { suffix: ["た", "い", "で", "す"], dropFromEnd: 4 }
  ];

  const ROLEPLAY_FOLLOWUPS = {
    "模块一": {
      jp: "お子様（おこさま）は何歳（なんさい）ですか？旅行（りょこう）は長（なが）いですか？",
      romaji: "Okosama wa nansai desu ka? Ryokou wa nagai desu ka?",
      cn: "小朋友今年几岁了？这次日本旅行待得久吗？",
      intentKeywords: ["さい", "歳", "げつ", "にち", "しゅうかん", "まで", "から", "はい", "です"],
      sampleReplies: [
        { jp: "上の娘は6歳で、下は1歳です。全部で1か月くらいいます。", cn: "大女儿6岁，小的1岁。我们一共待一个月左右。" },
        { jp: "今月から来年の一月まで日本にいます。", cn: "我们从这个月一直待到明年一月。" }
      ]
    },
    "模块二": {
      jp: "かしこまりました。ほかにご要望（ようぼう）はございますか？",
      romaji: "Kashikomarimashita. Hoka ni go-youbou wa gozaimasu ka?",
      cn: "好的明白。请问您还有其他需要帮忙的吗？",
      intentKeywords: ["大丈夫", "だいじょうぶ", "いい", "おねがい", "お願い", "はい", "すみません", "ありがとう"],
      sampleReplies: [
        { jp: "はい、大丈夫です。ありがとうございます！", cn: "没关系，这样就可以了，谢谢！" },
        { jp: "すみません、子供用のイスをお願いできますか？", cn: "不好意思，可以麻烦拿一把儿童座椅吗？" }
      ]
    },
    "模块三": {
      jp: "お荷物（にもつ）はお大（おお）きいですか？大型荷物（おおがたにもつ）スペースをお取（と）りしましょうか？",
      romaji: "O-nimotsu wa ookii desu ka? Oogata nimotsu supeesu wo o-tori shimashou ka?",
      cn: "您的行李箱大吗？需要帮您预订特大行李座位区吗？",
      intentKeywords: ["はい", "いいえ", "おねがい", "お願い", "おおきい", "大きい", "スーツケース", "大丈夫", "ありがとう"],
      sampleReplies: [
        { jp: "はい、大きいスーツケースが2つあるのでお願いします。", cn: "是的，有两个大行李箱，麻烦您了。" },
        { jp: "小さいカバンだけなので大丈夫です。", cn: "只有小包，所以没关系不用特大席。" }
      ]
    },
    "模块四": {
      jp: "チェックインのお手続きですね。パスポートを全員分（ぜんいんぶん）拝見（はいけん）できますか？",
      romaji: "Chekkuin no o-tetsuzuki desu ne. Pasupooto wo zen'in-bun haiken dekimasu ka?",
      cn: "您要办理入住对吧？可以请我看一下全员的护照吗？",
      intentKeywords: ["はい", "どうぞ", "おねがい", "お願い", "パスポート", "すみません", "ありがとう"],
      sampleReplies: [
        { jp: "はい、どうぞ。大人2人と子供2人分です。", cn: "好的，给您。这是两位大人和两个孩子的。" },
        { jp: "はい、よろしくお願いします。", cn: "好的，拜托您了。" }
      ]
    },
    "模块五": {
      jp: "お子様（おこさま）の靴（くつ）のサイズは何センチですか？ヘルメットも借（か）りますか？",
      romaji: "Okosama no kutsu no saizu wa nan-senchi desu ka? Herumetto mo karimasu ka?",
      cn: "小朋友的雪鞋尺码是多少厘米？头盔也要租吗？",
      intentKeywords: ["センチ", "はい", "おねがい", "お願い", "ヘルメット", "かり", "借り", "大丈夫"],
      sampleReplies: [
        { jp: "19センチです。ヘルメットもお願いします。", cn: "19厘米。头盔也请帮我租一个。" },
        { jp: "はい、一式お借りしたいです。", cn: "是的，想租一整套。" }
      ]
    },
    "模块六": {
      jp: "今日（きょう）お子様（おこさま）の体調（たいちょう）や朝食（ちょうしょく）はどうでしたか？",
      romaji: "Kyou okosama no taichou ya choushoku wa dou deshita ka?",
      cn: "今天小朋友的身体状况和早餐情况怎么样呀？",
      intentKeywords: ["げんき", "元気", "たべ", "食べ", "よく", "大丈夫", "ねつ", "熱", "ない"],
      sampleReplies: [
        { jp: "朝ごはんもよく食べて、とても元気です！", cn: "早饭吃得很香，精神也很好！" },
        { jp: "熱もなくて元気ですが、少し鼻水が出ています。", cn: "没有发烧挺精神的，就是稍微有点流鼻涕。" }
      ]
    },
    "模块七": {
      jp: "苦手（にがて）なものやアレルギーなどはございませんか？お飲（の）み物（もの）は何（なに）になさいますか？",
      romaji: "Nigate na mono ya arerugii nado wa gozaimasen ka? O-nomimono wa nani ni nasaimasu ka?",
      cn: "请问有什么忌口或过敏食材吗？饮品要喝点什么呢？",
      intentKeywords: ["ない", "あり", "大丈夫", "おちゃ", "お茶", "みず", "水", "ビール", "りんご", "おねがい"],
      sampleReplies: [
        { jp: "アレルギーはありません。温かいお茶をお願いします。", cn: "没有过敏。请给我一杯热茶。" },
        { jp: "子供にリンゴジュースと、私はウーロン茶をお願いします。", cn: "给孩子来杯苹果汁，我点乌龙茶。" }
      ]
    },
    "模块八": {
      jp: "ベビーカーはお席（せき）の横（よこ）に置（お）けますよ。お子様（おこさま）用（よう）のお皿（さら）はお持（も）ちしましょうか？",
      romaji: "Bebiikaa wa o-seki no yoko ni okemasu yo. Okosama-you no o-sara wa o-mochi shimashou ka?",
      cn: "婴儿车可以放在座位旁边哦。需要给您拿儿童餐盘吗？",
      intentKeywords: ["はい", "おねがい", "お願い", "ありがとう", "ふたつ", "2つ", "大丈夫"],
      sampleReplies: [
        { jp: "はい、子供用の取り皿を2ついただけますか？", cn: "好的，可以拿两个儿童小碗吗？" },
        { jp: "ありがとうございます！助かります。", cn: "谢谢！真是帮大忙了。" }
      ]
    },
    "模块十": {
      jp: "お弁当（べんとう）は温（あたた）めますか？レジ袋（ぶくろ）はご利用（りよう）ですか？",
      romaji: "O-bentou wa atatamemasu ka? Rejibukuro wa go-riyou desu ka?",
      cn: "便当需要帮您加热吗？购物袋需要吗？",
      intentKeywords: ["はい", "いいえ", "おねがい", "お願い", "大丈夫", "だいじょうぶ", "あたため", "ふくろ", "袋"],
      sampleReplies: [
        { jp: "はい、温めてください。袋は大丈夫です。", cn: "嗯，请帮忙加热。袋子不用了。" },
        { jp: "袋を1枚お願いします。お弁当はそのままで大丈夫です。", cn: "请给我1个袋子，便当不用加热了。" }
      ]
    },
    "模块十二": {
      jp: "症状（しょうじょう）はいつからですか？お薬（くすり）のアレルギーはありますか？",
      romaji: "Shoujou wa itsu kara desu ka? O-kusuri no arerugii wa arimasu ka?",
      cn: "症状是从什么时候开始的？对药物有过敏史吗？",
      intentKeywords: ["きのう", "昨日", "きょう", "今日", "から", "ない", "あり", "大丈夫", "ねつ", "せき"],
      sampleReplies: [
        { jp: "昨日の夜からです。薬のアレルギーはありません。", cn: "从昨天晚上开始的，没有药物过敏。" },
        { jp: "今朝から少し咳が出ています。大丈夫です、アレルギーはありません。", cn: "从今早开始有点咳嗽。没有药物过敏。" }
      ]
    },
    "default": {
      jp: "すみません、ほかにお手伝（てつだ）いできることはありますか？",
      romaji: "Sumimasen, hoka ni o-tetsudai dekiru koto wa arimasu ka?",
      cn: "请问还有什么可以帮您的吗？",
      intentKeywords: ["大丈夫", "だいじょうぶ", "はい", "おねがい", "お願い", "ありがとう", "すみません", "ください"],
      sampleReplies: [
        { jp: "はい、とても助かりました。ありがとうございます！", cn: "谢谢，真的帮大忙了！" },
        { jp: "すみません、クレジットカードは使えますか？", cn: "不好意思，请问可以刷信用卡吗？" }
      ]
    }
  };
  ROLEPLAY_FOLLOWUPS["模块九"] = ROLEPLAY_FOLLOWUPS["模块四"];
  ROLEPLAY_FOLLOWUPS["模块十一"] = ROLEPLAY_FOLLOWUPS["default"];
  ROLEPLAY_FOLLOWUPS["模块十三"] = ROLEPLAY_FOLLOWUPS["模块七"];
  ROLEPLAY_FOLLOWUPS["模块十四"] = ROLEPLAY_FOLLOWUPS["模块十"];
  ROLEPLAY_FOLLOWUPS["模块十五"] = ROLEPLAY_FOLLOWUPS["模块八"];
  ROLEPLAY_FOLLOWUPS["模块十六"] = ROLEPLAY_FOLLOWUPS["模块十"];
  ROLEPLAY_FOLLOWUPS["模块十七"] = ROLEPLAY_FOLLOWUPS["模块八"];
  ROLEPLAY_FOLLOWUPS["模块十八"] = ROLEPLAY_FOLLOWUPS["模块十"];

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
    "分かりません": "わかりません",
    "分かりました": "わかりました",
    "分かります": "わかります",
    "分かって": "わかって",
    "分かる": "わかる",
    "分から": "わから",
    "分かり": "わかり",
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
    "台": "だい",
    "suica": "すいか",
    "wi-fi": "わいふぁい",
    "wifi": "わいふぁい",
    "google": "ぐーぐる",
    "apple pay": "あっぷるぺい",
    "apple": "あっぷる",
    "pay": "ぺい",
    "line": "らいん",
    "atm": "えーてぃーえむ",
    "qr": "きゅーあーる",
    "visa": "びざ",
    "esim": "いーしむ",
    "airbnb": "えあびー"
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
      .replace(/（[自他]：[^）]*）/g, "")
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
      if (k && yomi && /[A-Za-z]/.test(k) && !targetMap[k.toLowerCase()]) {
        targetMap[k.toLowerCase()] = yomi;
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

    const rubyOrTokenRe = /([一-龯々ヶ0-9０-９a-zA-Z]+(?:-[a-zA-Z0-9]+)*)\（([\u3040-\u309F\u30A0-\u30FFー・]+)\）|([、。！？!?\s・「」『』()（）/／]+)|([^一-龯々ヶ0-9０-９a-zA-Z、。！？!?\s・「」『』()（）/／]+)|([一-龯々ヶ0-9０-９a-zA-Z]+(?:-[a-zA-Z0-9]+)*)/g;
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
  // Tokyo Pitch Contour Heuristic & Personal Weakness Analytics
  // =========================================================================
  function isMoraSuffixMatch(morae, suffixArr) {
    if (morae.length < suffixArr.length) return false;
    const offset = morae.length - suffixArr.length;
    for (let i = 0; i < suffixArr.length; i++) {
      if (morae[offset + i] !== suffixArr[i]) return false;
    }
    return true;
  }

  function detectOpenerOp(clauseMorae) {
    const joined = clauseMorae.join("");
    for (let i = 0; i < ATAMADAKA_OPENERS.length; i++) {
      const op = ATAMADAKA_OPENERS[i];
      if (joined.startsWith(op)) {
        return tokenizeMorae(op).length;
      }
    }
    if (/^もう($|すぐ|すこし|いい|いちど)/.test(joined)) return 2;
    return 0;
  }

  function analyzeMoraPitchContour(rawJp) {
    const cleaned = stripMetaAnnotations(rawJp);
    if (!cleaned) return [];
    const localKanjiMap = {};
    collectRubyPairsFromText(cleaned, localKanjiMap);
    ensureCorpusKanjiMap();

    const segments = cleaned
      .split(/([、。！？!?]+)/)
      .reduce((acc, part) => {
        if (/^[、。！？!?]+$/.test(part)) {
          if (acc.length > 0) acc[acc.length - 1].punct += part;
        } else if (part && part.trim()) {
          acc.push({ text: part.trim(), punct: "" });
        }
        return acc;
      }, []);

    const clauses = [];
    segments.forEach((seg) => {
      const parsed = parseTargetChunks(seg.text);
      const morae = parsed.targetMorae;
      if (!morae.length) return;
      const endsWithQ = /[？?]/.test(seg.punct) || (morae.length >= 3 && morae[morae.length - 1] === "か" && (morae[morae.length - 2] === "す" || morae[morae.length - 2] === "ん"));

      let coreLen = morae.length;
      while (coreLen > 2 && TRAILING_PARTICLE_MORA.has(morae[coreLen - 1])) {
        coreLen--;
      }
      const core = morae.slice(0, coreLen);

      let suffixDropIdx = -1;
      for (let i = 0; i < POLITE_DROP_SUFFIXES.length; i++) {
        const rule = POLITE_DROP_SUFFIXES[i];
        if (isMoraSuffixMatch(core, rule.suffix)) {
          suffixDropIdx = core.length - rule.dropFromEnd;
          break;
        }
      }
      if (suffixDropIdx < 0 && core.length >= 4 && isMoraSuffixMatch(core, ["で", "す"])) {
        suffixDropIdx = core.length - 3;
      }

      const openerLen = detectOpenerOp(morae);
      const drops = new Set();
      let restartIdx = -1;

      if (openerLen > 0) {
        drops.add(0);
        if (morae.length >= openerLen + 3) {
          restartIdx = openerLen;
          if (suffixDropIdx >= restartIdx) drops.add(suffixDropIdx);
        }
      } else if (suffixDropIdx >= 0) {
        drops.add(suffixDropIdx);
      }

      const outMorae = [];
      let phaseStart = 0;
      let fellInPhrase = false;

      for (let i = 0; i < morae.length; i++) {
        if (i === restartIdx) {
          phaseStart = i;
          fellInPhrase = false;
        }
        const m = morae[i];
        const prev = i > 0 ? morae[i - 1] : "";
        const kind = m === "っ" ? "sokuon" : isProlongingMora(m, prev) ? "long" : m === "ん" ? "nasal" : "normal";
        const hasOpenerAt0 = i === phaseStart && i === 0 && drops.has(0);

        let level;
        if (fellInPhrase) {
          level = "L";
        } else if (hasOpenerAt0) {
          level = "H";
        } else if (i === phaseStart) {
          level = "L";
        } else {
          level = "H";
        }

        const dropAfter = drops.has(i);
        if (dropAfter) fellInPhrase = true;

        const risingEnd = Boolean(endsWithQ && i === morae.length - 1);
        outMorae.push({ mora: m, level, dropAfter, kind, risingEnd });
      }

      clauses.push({
        morae: outMorae,
        isQuestion: Boolean(endsWithQ),
        punct: seg.punct
      });
    });

    return clauses;
  }

  function computeWeaknessProfile(oralStats = {}) {
    const totals = {};
    Object.values(oralStats || {}).forEach((st) => {
      if (!st || typeof st !== "object") return;
      if (st.issueCounts && typeof st.issueCounts === "object") {
        Object.keys(st.issueCounts).forEach((k) => {
          if (ISSUE_META[k]) totals[k] = (totals[k] || 0) + (Number(st.issueCounts[k]) || 0);
        });
      } else if (Array.isArray(st.lastIssues)) {
        st.lastIssues.forEach((k) => {
          if (ISSUE_META[k]) totals[k] = (totals[k] || 0) + 1;
        });
      }
    });
    return Object.keys(totals)
      .filter((k) => totals[k] > 0 && ISSUE_META[k])
      .map((k) => ({ key: k, count: totals[k], ...ISSUE_META[k] }))
      .sort((x, y) => y.count - x.count);
  }

  function matchesIssueFeature(item, issueKey, oralStats = {}) {
    if (!item || !issueKey) return true;
    const st = oralStats[item.id];
    const flaggedBefore = st && ((st.issueCounts && st.issueCounts[issueKey] > 0) || (Array.isArray(st.lastIssues) && st.lastIssues.includes(issueKey)));
    if (flaggedBefore) return true;
    const { targetMorae } = parseTargetChunks(item.jp);
    if (issueKey === "sokuon") return targetMorae.includes("っ");
    if (issueKey === "long_vowel") {
      return targetMorae.some((m, idx) => idx > 0 && isProlongingMora(m, targetMorae[idx - 1]));
    }
    if (issueKey === "voicing") {
      return targetMorae.some((m) => VOICED_KANA_RE.test(m));
    }
    if (issueKey === "consonant") {
      return targetMorae.some((m) => /^[らりるれろつん]/.test(m));
    }
    if (issueKey === "ending") return targetMorae.length >= 8;
    if (issueKey === "pace") return targetMorae.length >= 10;
    return true;
  }

  // =========================================================================
  // Audio Context (Chimes + AnalyserNode Waveform + 16kHz Anti-Aliased WAV)
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
    if (coachState.muteChime) return;
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

  // Convert recorded Blob into compact 16kHz Mono 16-bit PCM WAV using anti-aliased OfflineAudioContext resampling
  async function blobTo16kMonoWavBase64(blob) {
    try {
      const ctx = getAudioCtx();
      if (!ctx) throw new Error("No AudioContext");
      const arrBuf = await blob.arrayBuffer();
      const decoded = await ctx.decodeAudioData(arrBuf);
      const targetRate = 16000;
      let samples = null;

      const OfflineAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
      if (OfflineAC && decoded.sampleRate !== targetRate) {
        try {
          const outFrames = Math.max(1, Math.ceil(decoded.duration * targetRate));
          const offline = new OfflineAC(1, outFrames, targetRate);
          const src = offline.createBufferSource();
          src.buffer = decoded;
          src.connect(offline.destination);
          src.start(0);
          const rendered = await offline.startRendering();
          samples = rendered.getChannelData(0);
        } catch (e) {
          samples = null;
        }
      }

      let outLen;
      let useLinear = false;
      const ch0 = decoded.getChannelData(0);
      const ratio = decoded.sampleRate / targetRate;
      if (samples) {
        outLen = samples.length;
      } else if (decoded.sampleRate === targetRate) {
        samples = ch0;
        outLen = ch0.length;
      } else {
        outLen = Math.max(1, Math.floor(ch0.length / ratio));
        useLinear = true;
      }

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
        let rawSample;
        if (useLinear) {
          const pos = i * ratio;
          const i0 = Math.floor(pos);
          const i1 = Math.min(ch0.length - 1, i0 + 1);
          const frac = pos - i0;
          rawSample = ch0[i0] * (1 - frac) + ch0[i1] * frac;
        } else {
          rawSample = samples[i];
        }
        const sample = Math.max(-1, Math.min(1, rawSample));
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
    shadowLoop: false,
    shadowLoopStage: 0, // 0 = 0.84x slow, 1 = 1.0x native
    blindMode: false,
    manualStop: localStorage.getItem(MANUAL_STOP_STORAGE) === "1",
    muteChime: localStorage.getItem(MUTE_CHIME_STORAGE) === "1",
    showPitchGuide: localStorage.getItem(PITCH_GUIDE_STORAGE) !== "0",
    includeAllExamples: false,
    deckFilter: "all", // 'all' | 'unpracticed' | 'under80'
    issueFocus: null, // null | keyof ISSUE_META
    showPicker: false,
    pickerQuery: "",
    selectedChunkIdx: null,

    // Roleplay specific
    roleplayDlgId: null,
    roleplayTurnIdx: 0,
    rpRecallMode: false,
    rpRevealed: false,
    rpUserClips: {}, // { [turnId]: { url, blob } }
    rpMixPlaying: false,
    rpMixTurnIdx: -1,

    // Roleplay Free-Talk Follow-up Challenge
    ftActive: false,
    ftQuestion: null,
    ftShowCn: false,
    ftPhase: "idle", // 'idle' | 'listening' | 'evaluating' | 'result'
    ftHeard: "",
    ftResult: null,
    ftAiLoading: false,
    ftAiResult: null,
    ftAiError: "",

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
    compareMode: null, // null | 'user' | 'compare' | 'mix'
    lastNativeDurationMs: 0,

    // Active handles to tear down cleanly on stopAll()
    recognition: null,
    mediaRecorder: null,
    mediaStream: null,
    sourceNode: null,
    analyserNode: null,
    rafId: null,
    monitorTimer: null,
    maxCapTimer: null,
    nextActionTimer: null,
    preListenTimer: null,
    captureSessionId: 0,
    _manualFinish: null,
    _ftManualFinish: null,
    userPlayer: new Audio(),

    // Speech VAD measurements
    recStartMs: 0,
    vadStartMs: 0,
    speechOnsetMs: 0,
    speechOffsetMs: 0,
    lastVoiceOrAsrMs: 0,
    lastVoiceRmsMs: 0,
    lastAsrChangeMs: 0,
    noiseFloor: 2.0,
    elapsedSec: 0,
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

  function revokeRoleplayClips() {
    Object.values(coachState.rpUserClips || {}).forEach((clip) => {
      if (clip && clip.url) {
        try { URL.revokeObjectURL(clip.url); } catch (e) {}
      }
    });
    coachState.rpUserClips = {};
    coachState.rpMixPlaying = false;
    coachState.rpMixTurnIdx = -1;
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
    coachState.rpMixPlaying = false;
    coachState.rpMixTurnIdx = -1;
  }

  function clearAllTimers() {
    clearInterval(coachState.monitorTimer);
    clearTimeout(coachState.maxCapTimer);
    clearTimeout(coachState.nextActionTimer);
    clearTimeout(coachState.preListenTimer);
    coachState.monitorTimer = null;
    coachState.maxCapTimer = null;
    coachState.nextActionTimer = null;
    coachState.preListenTimer = null;
  }

  function stopAll() {
    coachState.captureSessionId++;
    coachState._manualFinish = null;
    coachState._ftManualFinish = null;
    clearAllTimers();
    releaseMicResources();
    stopUserPlayback();
    if (app()) app().stopAllAudio();
    if (coachState.phase === "model_playing" || coachState.phase === "listening" || coachState.phase === "evaluating") {
      coachState.phase = coachState.result ? "result" : "idle";
      coachState.statusText = "";
      coachState.interimText = "";
    }
    if (coachState.ftPhase === "listening" || coachState.ftPhase === "evaluating") {
      coachState.ftPhase = coachState.ftResult ? "result" : "idle";
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

  function getDeckItems(deckName = coachState.deck, forceAllExamples = false) {
    const a = app();
    if (!a) return [];
    const mods = a.getEffectiveModules();

    if (deckName === "phrases") {
      const out = [];
      mods.forEach((mod) => {
        (mod.sections || []).forEach((sec) => {
          (sec.items || []).forEach((it) => {
            if (it.id === "m14-s1-3") return;
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
      return list.map((s, idx) => ({
        id: `oral-${s.id || `staff-${idx + 1}`}`,
        tag: `🏪 ${s.scene} · 听问再答`,
        promptContextJp: s.hearJp,
        promptContextCn: `店员提问：${s.hearCn || s.cn || ""}`,
        jp: s.replyJp,
        romaji: s.replyRomaji || "",
        cn: s.replyCn,
        audioKey: null
      }));
    }

    if (deckName === "verbs") {
      const out = [];
      const expandAll = forceAllExamples || coachState.includeAllExamples;
      (window.JP_TOP_VERBS || []).forEach((v) => {
        const exList = expandAll ? (v.examples || []) : (v.examples || []).slice(0, 1);
        exList.forEach((ex, exIdx) => {
          out.push({
            id: `${v.id}-ex${exIdx}`,
            tag: `⚡ #${v.rank} ${v.dict} (${ex.form})`,
            jp: ex.jp,
            romaji: ex.romaji || "",
            cn: ex.cn,
            audioKey: null
          });
        });
      });
      return out;
    }

    if (deckName === "grammar") {
      const out = [];
      const expandAll = forceAllExamples || coachState.includeAllExamples;
      (window.JP_GRAMMAR_LIST || []).forEach((g) => {
        const exList = expandAll ? (g.dailyExamples || []) : (g.dailyExamples || []).slice(0, 1);
        exList.forEach((ex, exIdx) => {
          out.push({
            id: `${g.id}-ex${exIdx}`,
            tag: `📖 ${g.level} · ${g.pattern}`,
            jp: ex.jp,
            romaji: ex.romaji || "",
            cn: ex.cn,
            audioKey: null
          });
        });
      });
      return out;
    }

    if (deckName === "n5vocab") {
      const ex = window.JP_LEARNING_EXTRAS || {};
      return [
        ...(ex.n5Vocab || []).filter((x) => x.ex).map((x) => ({
          id: `${x.id}-ex`,
          tag: `🟢 N5 · ${x.cat}`,
          jp: x.ex,
          romaji: x.exRomaji || "",
          cn: x.exCn,
          audioKey: null
        })),
        ...(ex.contractions || []).map((c, idx) => ({
          id: `${c.id || `con-${idx + 1}`}-casual`,
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
        getDeckItems(dn, true).forEach((it) => {
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

  function getFilteredDeckItems(deckName = coachState.deck) {
    const a = app();
    const oralStats = (a && a.state && a.state.oralStats) || {};
    let items = getDeckItems(deckName);

    if (deckName !== "weak") {
      if (coachState.deckFilter === "unpracticed") {
        items = items.filter((it) => !oralStats[it.id]);
      } else if (coachState.deckFilter === "under80") {
        items = items.filter((it) => {
          const st = oralStats[it.id];
          return st && st.bestScore < 80;
        });
      }
    }

    if (coachState.issueFocus) {
      const focusKey = coachState.issueFocus;
      items = items.filter((it) => matchesIssueFeature(it, focusKey, oralStats));
      items.sort((x, y) => {
        const sx = oralStats[x.id];
        const sy = oralStats[y.id];
        const fx = sx && ((sx.issueCounts && sx.issueCounts[focusKey]) || (Array.isArray(sx.lastIssues) && sx.lastIssues.includes(focusKey) ? 1 : 0)) ? 1 : 0;
        const fy = sy && ((sy.issueCounts && sy.issueCounts[focusKey]) || (Array.isArray(sy.lastIssues) && sy.lastIssues.includes(focusKey) ? 1 : 0)) ? 1 : 0;
        return fy - fx;
      });
    }

    return items;
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
    const items = getFilteredDeckItems(coachState.deck);
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
      const heroStatsEl = document.getElementById("oral-hero-stats");
      if (heroStatsEl) renderHeroStatsInto(heroStatsEl);
      const root = document.getElementById("oral-coach-stage");
      if (root) renderStudio(root);
    }
  }

  function normalizeTranscriptKey(str) {
    return String(str || "")
      .replace(/[、。！？!?・\s　,.]+/g, "")
      .trim();
  }

  function charBigramSimilarity(a, b) {
    const s1 = String(a || "");
    const s2 = String(b || "");
    if (!s1 || !s2) return 0;
    if (s1 === s2) return 1;
    if (s1.length < 2 || s2.length < 2) return s1 === s2 ? 1 : 0;
    const counts = new Map();
    for (let i = 0; i < s1.length - 1; i++) {
      const bg = s1.slice(i, i + 2);
      counts.set(bg, (counts.get(bg) || 0) + 1);
    }
    let overlap = 0;
    for (let j = 0; j < s2.length - 1; j++) {
      const bg = s2.slice(j, j + 2);
      const n = counts.get(bg) || 0;
      if (n > 0) {
        overlap++;
        counts.set(bg, n - 1);
      }
    }
    return (2 * overlap) / (s1.length - 1 + (s2.length - 1));
  }

  function isTranscriptDuplicateOrCumulative(prevStr, nextStr) {
    const na = normalizeTranscriptKey(prevStr);
    const nb = normalizeTranscriptKey(nextStr);
    if (!na || !nb) return null;
    if (na === nb) return "equal";
    if (nb.startsWith(na)) return "cumulative";
    if (na.endsWith(nb) || na.includes(nb)) return "contained";
    if (
      na.length >= 6 &&
      nb.length >= 6 &&
      nb.length >= na.length * 0.68 &&
      nb.length <= na.length * 1.45 &&
      charBigramSimilarity(na, nb) >= 0.72
    ) {
      return "near_dup";
    }
    return null;
  }

  function mergeTranscriptPair(prevStr, nextStr) {
    const a = String(prevStr || "").trim();
    const b = String(nextStr || "").trim();
    if (!a) return b;
    if (!b) return a;

    const dupKind = isTranscriptDuplicateOrCumulative(a, b);
    if (dupKind === "equal" || dupKind === "cumulative" || dupKind === "near_dup") {
      return b;
    }
    if (dupKind === "contained") {
      return a;
    }

    const maxOverlap = Math.min(a.length, b.length, 24);
    for (let k = maxOverlap; k >= 3; k--) {
      if (a.endsWith(b.slice(0, k))) {
        return a + b.slice(k);
      }
    }

    return a + b;
  }

  function dedupeSegmentList(segList) {
    const raw = (segList || []).filter((seg) => Array.isArray(seg) && seg.length > 0 && String(seg[0] || "").trim());
    const out = [];
    for (let i = 0; i < raw.length; i++) {
      const seg = raw[i];
      const cur0 = String(seg[0] || "").trim();
      if (out.length === 0) {
        out.push(seg);
        continue;
      }
      const prevSeg = out[out.length - 1];
      const prev0 = String(prevSeg[0] || "").trim();
      const pairKind = isTranscriptDuplicateOrCumulative(prev0, cur0);
      if (pairKind === "equal" || pairKind === "cumulative" || pairKind === "near_dup") {
        out[out.length - 1] = seg;
        continue;
      }
      if (pairKind === "contained") {
        continue;
      }
      if (out.length >= 2) {
        let mergedSoFar = out[0][0];
        for (let mIdx = 1; mIdx < out.length; mIdx++) {
          mergedSoFar = mergeTranscriptPair(mergedSoFar, out[mIdx][0]);
        }
        const wholeKind = isTranscriptDuplicateOrCumulative(mergedSoFar, cur0);
        if (wholeKind === "equal" || wholeKind === "cumulative" || wholeKind === "near_dup") {
          out.length = 0;
          out.push(seg);
          continue;
        }
        if (wholeKind === "contained") {
          continue;
        }
      }
      out.push(seg);
    }
    return out;
  }

  function buildCombinedHypotheses(committedSegments, currentFinalSegments, interim = "") {
    const dedupedSegs = dedupeSegmentList([...(committedSegments || []), ...(currentFinalSegments || [])]);
    const trailing = String(interim || "").trim();

    if (dedupedSegs.length === 0) {
      return trailing ? [trailing] : [];
    }

    let prefix = "";
    for (let i = 0; i < dedupedSegs.length - 1; i++) {
      prefix = mergeTranscriptPair(prefix, dedupedSegs[i][0]);
    }
    const lastSeg = dedupedSegs[dedupedSegs.length - 1];
    const results = [];
    const seen = new Set();

    function pushCandidate(str) {
      const s = String(str || "").trim();
      if (s && !seen.has(s)) {
        seen.add(s);
        results.push(s);
      }
    }

    lastSeg.slice(0, 5).forEach((alt) => {
      const withAlt = mergeTranscriptPair(prefix, alt);
      pushCandidate(mergeTranscriptPair(withAlt, trailing));
    });

    // Also include up to 1 alternative from earlier segment if present
    if (dedupedSegs.length >= 2 && results.length < 5 && dedupedSegs[0][1]) {
      let altPrefix = dedupedSegs[0][1];
      for (let i = 1; i < dedupedSegs.length; i++) {
        altPrefix = mergeTranscriptPair(altPrefix, dedupedSegs[i][0]);
      }
      pushCandidate(mergeTranscriptPair(altPrefix, trailing));
    }

    return results.slice(0, 5);
  }

  function isEndMoraSimilar(tM, tPrev, hM, hPrev) {
    if (tM === hM) return true;
    if (inSameSetGroup(tM, hM, EXACT_MORA_GROUPS)) return true;
    if (isProlongingMora(tM, tPrev) && isProlongingMora(hM, hPrev)) return true;
    if (inSameSetGroup(tM, hM, VOICING_GROUPS)) return true;
    if (inSameSetGroup(tM, hM, CONSONANT_CONFUSION_GROUPS)) return true;
    return false;
  }

  function hasTargetEndingMatch(targetMorae, heardMorae) {
    if (!Array.isArray(targetMorae) || !Array.isArray(heardMorae) || targetMorae.length === 0 || heardMorae.length === 0) {
      return false;
    }
    const k = Math.min(3, targetMorae.length);
    const targetTail = targetMorae.slice(-k);
    const tailWindow = heardMorae.slice(-Math.min(heardMorae.length, k + 2));
    let hPos = 0;
    let matches = 0;
    let matchedTail2 = false;

    for (let i = 0; i < k; i++) {
      const tM = targetTail[i];
      const tPrev = i > 0 ? targetTail[i - 1] : (targetMorae.length > k ? targetMorae[targetMorae.length - k - 1] : "");
      for (let j = hPos; j < tailWindow.length; j++) {
        const hM = tailWindow[j];
        const hPrev = j > 0 ? tailWindow[j - 1] : "";
        if (isEndMoraSimilar(tM, tPrev, hM, hPrev)) {
          matches++;
          if (i >= k - 2) matchedTail2 = true;
          hPos = j + 1;
          break;
        }
      }
    }

    if (k === 1) return matches >= 1;
    if (k === 2) return matches >= 2;
    return matches >= 2 && matchedTail2;
  }

  function shouldAutoStopCapture({
    elapsedMs = 0,
    hasMeaningfulSpeech = false,
    spokenRatio = 0,
    asrQuietMs = 0,
    voiceQuietMs = 0,
    hasFinalComplete = false,
    tailMatched = false,
    browserSpeechActive = false,
    hasSR = true
  }) {
    if (!hasMeaningfulSpeech) {
      return elapsedMs > 10000;
    }
    if (!hasSR) {
      return voiceQuietMs >= 2000;
    }
    if (tailMatched && spokenRatio >= 0.78) {
      if (!browserSpeechActive && voiceQuietMs >= 1200 && ((hasFinalComplete && asrQuietMs >= 900) || asrQuietMs >= 1050)) {
        return true;
      }
      return asrQuietMs >= 2800;
    }
    if (spokenRatio >= 0.90) {
      return (!browserSpeechActive && voiceQuietMs >= 2200 && asrQuietMs >= 2000) || asrQuietMs >= 4200;
    }
    if (spokenRatio >= 0.55) {
      return (!browserSpeechActive && voiceQuietMs >= 2800 && asrQuietMs >= 2600) || asrQuietMs >= 4800;
    }
    return (!browserSpeechActive && voiceQuietMs >= 3600 && asrQuietMs >= 3400) || asrQuietMs >= 5500;
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

    const mySession = ++coachState.captureSessionId;
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const targetInfo = parseTargetChunks(item.jp);
    const targetMoraLen = Math.max(1, targetInfo.targetMorae.length);
    const startNow = performance.now();

    coachState.phase = "listening";
    coachState.interimText = "";
    coachState.asrHypotheses = [];
    coachState.heardAnyVoice = false;
    coachState.recStartMs = startNow;
    coachState.vadStartMs = 0;
    coachState.speechOnsetMs = 0;
    coachState.speechOffsetMs = 0;
    coachState.lastVoiceOrAsrMs = startNow;
    coachState.lastVoiceRmsMs = startNow;
    coachState.lastAsrChangeMs = startNow;
    coachState.noiseFloor = 1.2;
    coachState.elapsedSec = 0;
    coachState.statusText = SR
      ? "🎙️ 请从容读完！说完停顿约 1.2 秒即自动评分"
      : "🎙️ 正在录音（当前浏览器不支持自动转写，将进行节奏对比与录音回放）...";

    let finalized = false;
    let stopping = false;
    let srDone = !SR;
    let recDone = true;
    const chunks = [];

    let committedSegments = [];
    let currentFinalSegments = [];
    let currentInterim = "";
    let srRestarts = 0;
    const MAX_SR_RESTARTS = 8;
    let burstCommitted = false;
    let lastDispSig = "";
    let hasFinalComplete = false;
    let browserSpeechActive = false;

    function updateInterimDisplay() {
      const combined = buildCombinedHypotheses(committedSegments, currentFinalSegments, currentInterim);
      coachState.asrHypotheses = combined;
      const displayStr = combined[0] || "";
      coachState.interimText = displayStr;
      const liveEl = document.getElementById("oc-interim-live");
      if (liveEl) {
        liveEl.textContent = displayStr ? `👂 实时听到：${displayStr}` : "请直接开口说日语…";
      }
      return displayStr;
    }

    function commitActiveAsrBurst() {
      if (burstCommitted) return;
      burstCommitted = true;
      if (currentFinalSegments.length > 0) {
        committedSegments = dedupeSegmentList([...committedSegments, ...currentFinalSegments]);
        currentFinalSegments = [];
      } else if (currentInterim.trim()) {
        committedSegments = dedupeSegmentList([...committedSegments, [currentInterim.trim()]]);
      }
      currentInterim = "";
      updateInterimDisplay();
    }

    function maybeFinishCapture() {
      if (finalized || mySession !== coachState.captureSessionId) return;
      if (srDone && recDone) {
        finalized = true;
        commitActiveAsrBurst();
        finalizeAttempt(item);
      }
    }

    function stopCaptureGracefully() {
      if (finalized || mySession !== coachState.captureSessionId) return;
      if (stopping) {
        if (srDone && recDone) maybeFinishCapture();
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
        if (mySession !== coachState.captureSessionId || finalized) return;
        srDone = true;
        recDone = true;
        maybeFinishCapture();
      }, 650);
    }

    // Bind finish hook BEFORE first render so button onclick is live immediately
    coachState._manualFinish = stopCaptureGracefully;
    renderCurrentSurface();

    // 1. Setup microphone MediaStream + AnalyserNode live waveform + MediaRecorder
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (mySession !== coachState.captureSessionId || coachState.phase !== "listening" || stopping) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        coachState.mediaStream = stream;

        const ctx = getAudioCtx();
        if (ctx) {
          try {
            const src = ctx.createMediaStreamSource(stream);
            const analyser = ctx.createAnalyser();
            analyser.fftSize = 128;
            src.connect(analyser);
            coachState.sourceNode = src;
            coachState.analyserNode = analyser;
            drawWaveformLoop();
          } catch (e) {}
        }

        if (window.MediaRecorder) {
          try {
            const preferredTypes = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
            const chosenType = preferredTypes.find((t) => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) || "";
            const recorder = chosenType ? new MediaRecorder(stream, { mimeType: chosenType }) : new MediaRecorder(stream);
            recDone = false;
            recorder.ondataavailable = (ev) => {
              if (mySession !== coachState.captureSessionId) return;
              if (ev.data && ev.data.size > 0) chunks.push(ev.data);
            };
            recorder.onstop = () => {
              if (mySession !== coachState.captureSessionId) return;
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
        if (mySession !== coachState.captureSessionId) return;
        if (!SR) {
          coachState.phase = "idle";
          coachState.statusText = "⚠️ 无法访问麦克风，请检查浏览器麦克风权限设置。";
          renderCurrentSurface();
          return;
        }
      }
    }

    // 2. Setup continuous Web SpeechRecognition (ja-JP, 5 alternatives, smart dedupe & tail-aware auto-finish)
    function startRecognitionInstance() {
      if (!SR || mySession !== coachState.captureSessionId || stopping || coachState.phase !== "listening") {
        srDone = true;
        return;
      }
      burstCommitted = false;
      browserSpeechActive = false;
      currentFinalSegments = [];
      currentInterim = "";
      try {
        const rec = new SR();
        rec.lang = "ja-JP";
        rec.interimResults = true;
        rec.maxAlternatives = 5;
        rec.continuous = true;

        rec.onspeechstart = () => {
          if (mySession !== coachState.captureSessionId) return;
          browserSpeechActive = true;
          const now = performance.now();
          coachState.lastVoiceRmsMs = Math.max(coachState.lastVoiceRmsMs, now);
        };

        rec.onspeechend = () => {
          if (mySession !== coachState.captureSessionId) return;
          browserSpeechActive = false;
        };

        rec.onresult = (ev) => {
          if (mySession !== coachState.captureSessionId || finalized) return;
          const newFinals = [];
          let newInterim = "";
          for (let i = 0; i < ev.results.length; i++) {
            const res = ev.results[i];
            if (res.isFinal) {
              const alts = [];
              for (let a = 0; a < res.length; a++) {
                if (res[a] && res[a].transcript) alts.push(res[a].transcript.trim());
              }
              if (alts.length > 0) newFinals.push(alts);
            } else if (res[0] && res[0].transcript) {
              newInterim += res[0].transcript;
            }
          }
          currentFinalSegments = dedupeSegmentList(newFinals);
          currentInterim = newInterim;

          const now = performance.now();
          const disp = updateInterimDisplay();
          hasFinalComplete = currentFinalSegments.length > 0 && !currentInterim.trim();
          if (disp && disp !== lastDispSig) {
            lastDispSig = disp;
            if (!coachState.heardAnyVoice) {
              coachState.heardAnyVoice = true;
              coachState.speechOnsetMs = Math.max(coachState.recStartMs + 180, now - 350);
            }
            coachState.speechOffsetMs = now;
            coachState.lastAsrChangeMs = now;
            coachState.lastVoiceOrAsrMs = now;
          }
        };

        rec.onerror = (ev) => {
          if (mySession !== coachState.captureSessionId) return;
          browserSpeechActive = false;
          const errCode = ev && ev.error;
          if (errCode === "not-allowed" || errCode === "service-not-allowed") {
            coachState.statusText = "⚠️ 麦克风权限被拒绝，请在浏览器地址栏允许使用麦克风。";
            srDone = true;
            stopCaptureGracefully();
            return;
          }
          if (stopping) {
            srDone = true;
            maybeFinishCapture();
          }
        };

        rec.onend = () => {
          if (mySession !== coachState.captureSessionId || finalized) return;
          browserSpeechActive = false;
          commitActiveAsrBurst();
          if (!stopping && coachState.phase === "listening") {
            const disp = coachState.asrHypotheses[0] || "";
            const spokenMorae = disp ? tokenizeMorae(toHiraganaReading(disp, targetInfo.localKanjiMap)) : [];
            const spokenRatio = spokenMorae.length / targetMoraLen;
            const tailMatched = hasTargetEndingMatch(targetInfo.targetMorae, spokenMorae);
            if (!coachState.manualStop && tailMatched && spokenRatio >= 0.78 && (performance.now() - coachState.lastVoiceRmsMs >= 700)) {
              srDone = true;
              stopCaptureGracefully();
              return;
            }
            if (srRestarts < MAX_SR_RESTARTS) {
              srRestarts++;
              setTimeout(() => {
                if (mySession !== coachState.captureSessionId) return;
                if (!stopping && coachState.phase === "listening") {
                  startRecognitionInstance();
                } else {
                  srDone = true;
                  maybeFinishCapture();
                }
              }, 60);
              return;
            }
          }
          srDone = true;
          maybeFinishCapture();
        };

        coachState.recognition = rec;
        rec.start();
      } catch (e) {
        srDone = true;
      }
    }

    if (SR) {
      startRecognitionInstance();
    }

    // 3. Unified RMS + ASR auto-endpointing & live elapsed timer (120ms cadence)
    coachState.monitorTimer = setInterval(() => {
      if (mySession !== coachState.captureSessionId || coachState.phase !== "listening" || stopping) return;
      const now = performance.now();
      const elapsedSec = Math.floor((now - coachState.recStartMs) / 1000);
      if (elapsedSec !== coachState.elapsedSec) {
        coachState.elapsedSec = elapsedSec;
        const timerEl = document.getElementById("oc-rec-timer");
        if (timerEl) {
          const mm = String(Math.floor(elapsedSec / 60)).padStart(2, "0");
          const ss = String(elapsedSec % 60).padStart(2, "0");
          timerEl.textContent = `${mm}:${ss}`;
        }
      }

      if (coachState.manualStop) return;

      const disp = coachState.asrHypotheses[0] || "";
      const hasMeaningfulSpeech =
        (coachState.heardAnyVoice && coachState.speechOffsetMs - coachState.speechOnsetMs >= 320) ||
        disp.length >= 2;

      const spokenMorae = disp ? tokenizeMorae(toHiraganaReading(disp, targetInfo.localKanjiMap)) : [];
      const spokenMoraCount = spokenMorae.length || Math.round(Math.max(0, coachState.speechOffsetMs - coachState.speechOnsetMs) / 170);
      const spokenRatio = spokenMoraCount / targetMoraLen;
      const tailMatched = hasTargetEndingMatch(targetInfo.targetMorae, spokenMorae);
      const asrQuietMs = now - coachState.lastAsrChangeMs;
      const voiceQuietMs = now - Math.max(coachState.lastVoiceRmsMs, coachState.lastAsrChangeMs);

      if (
        shouldAutoStopCapture({
          elapsedMs: now - coachState.recStartMs,
          hasMeaningfulSpeech,
          spokenRatio,
          asrQuietMs,
          voiceQuietMs,
          hasFinalComplete,
          tailMatched,
          browserSpeechActive,
          hasSR: Boolean(SR)
        })
      ) {
        stopCaptureGracefully();
      }
    }, 120);

    // 4. Dynamic hard capture cap based on sentence length (manual mode allows up to 60s)
    const hardCapMs = coachState.manualStop
      ? 60000
      : Math.max(24000, Math.min(45000, targetMoraLen * 750));
    coachState.maxCapTimer = setTimeout(() => {
      if (mySession === coachState.captureSessionId && coachState.phase === "listening" && !stopping) {
        stopCaptureGracefully();
      }
    }, hardCapMs);
  }

  function drawWaveformLoop() {
    const analyser = coachState.analyserNode;
    if (!analyser || (coachState.phase !== "listening" && coachState.ftPhase !== "listening")) return;

    coachState.vadStartMs = performance.now();
    coachState.noiseFloor = 1.2;
    const freqData = new Uint8Array(analyser.frequencyBinCount);
    const timeData = new Uint8Array(analyser.fftSize);

    function tick() {
      if ((coachState.phase !== "listening" && coachState.ftPhase !== "listening") || !coachState.analyserNode) return;
      analyser.getByteFrequencyData(freqData);
      analyser.getByteTimeDomainData(timeData);

      let sumSq = 0;
      for (let i = 0; i < timeData.length; i++) {
        const d = timeData[i] - 128;
        sumSq += d * d;
      }
      const rms = Math.sqrt(sumSq / Math.max(1, timeData.length));
      const now = performance.now();

      // Calibrate ambient noise floor over the first 220ms AFTER stream starts
      if (now - coachState.vadStartMs < 220) {
        coachState.noiseFloor = coachState.noiseFloor * 0.6 + rms * 0.4;
      } else {
        const voiceThreshold = Math.max(2.2, coachState.noiseFloor * 2.0 + 0.6);
        if (rms > voiceThreshold) {
          if (!coachState.heardAnyVoice) {
            coachState.heardAnyVoice = true;
            coachState.speechOnsetMs = now;
          }
          coachState.speechOffsetMs = now;
          coachState.lastVoiceRmsMs = now;
          coachState.lastVoiceOrAsrMs = now;
        } else if (rms < coachState.noiseFloor) {
          coachState.noiseFloor = coachState.noiseFloor * 0.92 + rms * 0.08;
        } else if (rms < coachState.noiseFloor * 1.3) {
          coachState.noiseFloor = Math.min(6.0, coachState.noiseFloor * 0.995 + rms * 0.005);
        }
      }

      const canvas = document.getElementById("oc-waveform-canvas");
      if (canvas) {
        const g = canvas.getContext("2d");
        const w = canvas.width;
        const h = canvas.height;
        g.clearRect(0, 0, w, h);
        const bars = 24;
        const step = Math.max(1, Math.floor(freqData.length / bars));
        const barW = Math.floor((w - (bars - 1) * 3) / bars);
        const isDark = document.body.classList.contains("dark-mode");
        const activeThresh = Math.max(2.2, coachState.noiseFloor * 2.0 + 0.6);
        for (let b = 0; b < bars; b++) {
          const val = freqData[Math.min(freqData.length - 1, b * step)] / 255;
          const barH = Math.max(4, Math.round(val * (h - 6)));
          const x = b * (barW + 3);
          const y = Math.round((h - barH) / 2);
          g.fillStyle = rms > activeThresh ? (isDark ? "#60a5fa" : "#2563eb") : (isDark ? "#475569" : "#94a3b8");
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
    coachState.selectedChunkIdx = null;

    const userSpeechMs =
      coachState.heardAnyVoice && coachState.speechOffsetMs > coachState.speechOnsetMs
        ? Math.round(coachState.speechOffsetMs - coachState.speechOnsetMs)
        : 0;

    if (coachState.deck === "roleplay" && coachState.userBlob && item && item.id) {
      const oldClip = coachState.rpUserClips[item.id];
      if (oldClip && oldClip.url) {
        try { URL.revokeObjectURL(oldClip.url); } catch (e) {}
      }
      coachState.rpUserClips[item.id] = {
        blob: coachState.userBlob,
        url: URL.createObjectURL(coachState.userBlob)
      };
    }

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
            detail: "已完整录制你的跟读声音！请点击「⚖️ 对比听：原声 → 我」亲自对比发声清晰度，或在「⚙️ AI私教设置」填入 Gemini Key 开启 AI 精细听音纠错。"
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

    // A-B Shadowing Loop (0.84x slow -> 1.0x native -> advance/retry)
    if (coachState.shadowLoop && !coachState.isModalOpen) {
      if (coachState.shadowLoopStage === 0) {
        coachState.shadowLoopStage = 1;
        coachState.statusText = "🔁 慢速完成！1.5秒后自动进入 1.0x 原速复读...";
        renderCurrentSurface();
        coachState.nextActionTimer = setTimeout(() => {
          if (coachState.shadowLoop) startGuidedPractice(item, 1.0);
        }, 1500);
      } else {
        coachState.shadowLoopStage = 0;
        if (ev.overall >= 80) {
          playCueChime("pass");
          coachState.autoRetries = 0;
          coachState.nextActionTimer = setTimeout(() => {
            if (coachState.shadowLoop) advanceToNextItem(true);
          }, 1800);
        } else if (coachState.autoRetries < 2) {
          coachState.autoRetries++;
          playCueChime("retry");
          coachState.nextActionTimer = setTimeout(() => {
            if (coachState.shadowLoop) {
              coachState.shadowLoopStage = 0;
              startGuidedPractice(item, 0.84);
            }
          }, 1600);
        }
      }
      return;
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
    const prev = a.state.oralStats[item.id] || { bestScore: 0, attempts: 0, issueCounts: {} };
    const topIssues = ev.tips.map((t) => t.type).filter((t) => t !== "praise" && t !== "fallback");
    const nextIssueCounts = { ...(prev.issueCounts || {}) };
    topIssues.forEach((t) => {
      if (ISSUE_META[t]) nextIssueCounts[t] = (nextIssueCounts[t] || 0) + 1;
    });
    a.state.oralStats[item.id] = {
      bestScore: Math.max(prev.bestScore || 0, ev.overall),
      lastScore: ev.overall,
      attempts: (prev.attempts || 0) + 1,
      lastIssues: topIssues,
      issueCounts: nextIssueCounts,
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
        "请仔细聆听这段录音（不要臆测，若杂音或空白请如实指出），用简体中文简洁有力地评估：",
        "1) 高低音调（Pitch Accent / 下がり目 与疑问句句尾升降调自然度）；",
        "2) 日本真实场景（旅行/餐厅/家庭对话）中的礼貌体（です・ます）与表达得体度；",
        "3) 元音口型、清浊音、促音「っ」与长音拍数等发音细节。"
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
              pitchNotes: { type: "string", description: "高低音调调型对比建议（指出哪个词调高/降调与疑问升调应怎么走）" },
              politenessNotes: { type: "string", description: "日本真实场景下的礼貌体(です/ます)与表达得体度建议" },
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
              "politenessNotes",
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
    const mySession = coachState.captureSessionId;
    const useRate = overrideRate || (coachState.shadowLoop && coachState.shadowLoopStage === 0 ? 0.84 : coachState.rate);
    coachState.phase = "model_playing";
    coachState.result = null;
    coachState.selectedChunkIdx = null;
    coachState.aiResult = null;
    coachState.aiError = "";
    coachState.statusText =
      coachState.deck === "staff" && item.promptContextJp && !overrideRate
        ? "👂 第 1 步：先听店员快语速提问..."
        : coachState.shadowLoop
        ? `🔁 第 ${coachState.shadowLoopStage === 0 ? "1/2 轮慢速" : "2/2 轮原速"} 示范 (${useRate < 1 ? "0.84x" : "1.0x"})...`
        : `🔊 第 1 步：请听示范发音 (${useRate < 1 ? "0.84x 慢速" : "1.0x 原速"})...`;
    renderCurrentSurface();

    // Staff Responder deck plays the staff's rapid question first as context
    if (coachState.deck === "staff" && item.promptContextJp && !overrideRate) {
      app().speakJapanese(
        item.promptContextJp,
        1.0,
        null,
        () => {
          if (mySession !== coachState.captureSessionId || coachState.phase !== "model_playing") return;
          coachState.statusText = "🔊 第 1 步（续）：听一遍你的标准礼貌回答示范...";
          renderCurrentSurface();
          coachState.preListenTimer = setTimeout(() => {
            if (mySession !== coachState.captureSessionId || coachState.phase !== "model_playing") return;
            speakTargetSentence(item, useRate, () => {
              if (mySession !== coachState.captureSessionId || coachState.phase !== "model_playing") return;
              playCueChime("start");
              coachState.preListenTimer = setTimeout(() => {
                if (mySession === coachState.captureSessionId && coachState.phase === "model_playing") {
                  beginListeningAndRecording(item);
                }
              }, 340);
            });
          }, 380);
        },
        null
      );
      return;
    }

    speakTargetSentence(item, useRate, () => {
      if (mySession !== coachState.captureSessionId || coachState.phase !== "model_playing") return;
      playCueChime("start");
      coachState.preListenTimer = setTimeout(() => {
        if (mySession === coachState.captureSessionId && coachState.phase === "model_playing") {
          beginListeningAndRecording(item);
        }
      }, 340);
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

  function playFullRoleplayMix(dlg) {
    if (!dlg || !Array.isArray(dlg.turns) || dlg.turns.length === 0) return;
    if (coachState.rpMixPlaying) {
      stopAll();
      renderCurrentSurface();
      return;
    }
    stopAll();
    coachState.rpMixPlaying = true;
    coachState.compareMode = "mix";

    function playTurnAt(idx) {
      if (!coachState.rpMixPlaying || idx >= dlg.turns.length) {
        coachState.rpMixPlaying = false;
        coachState.rpMixTurnIdx = -1;
        coachState.compareMode = null;
        renderCurrentSurface();
        return;
      }
      coachState.rpMixTurnIdx = idx;
      renderCurrentSurface();
      const turn = dlg.turns[idx];
      const turnId = `${dlg.id}-turn-${idx}`;
      const clip = turn.speaker === "us" ? coachState.rpUserClips[turnId] : null;
      if (clip && clip.url) {
        coachState.userPlayer.src = clip.url;
        coachState.userPlayer.onended = () => {
          if (!coachState.rpMixPlaying) return;
          coachState.nextActionTimer = setTimeout(() => playTurnAt(idx + 1), 350);
        };
        coachState.userPlayer.play().catch(() => {
          if (!coachState.rpMixPlaying) return;
          coachState.nextActionTimer = setTimeout(() => playTurnAt(idx + 1), 350);
        });
      } else {
        app().speakJapanese(
          turn.jp,
          1.0,
          null,
          () => {
            if (!coachState.rpMixPlaying) return;
            coachState.nextActionTimer = setTimeout(() => playTurnAt(idx + 1), 380);
          },
          turnId
        );
      }
    }

    playTurnAt(0);
  }

  function getFollowupForDialogue(dlg) {
    if (!dlg) return ROLEPLAY_FOLLOWUPS.default;
    return ROLEPLAY_FOLLOWUPS[dlg.modNumber] || ROLEPLAY_FOLLOWUPS.default;
  }

  function evaluateFreeTalkOffline(question, heardRaw) {
    const cleanHeard = String(heardRaw || "").trim();
    const hira = toHiraganaReading(cleanHeard);
    const hasPolite = /(ます|です|お願い|おねがい|ください|大丈夫|だいじょうぶ|ありがとう|すみません|いません|ありません)/.test(cleanHeard) || /(ます|です|おねがい|ください|だいじょうぶ|ありがとう|すみません)/.test(hira);
    const kws = (question && question.intentKeywords) || [];
    const matchedKws = kws.filter((kw) => cleanHeard.includes(kw) || hira.includes(katakanaToHiragana(kw)));
    const moraLen = tokenizeMorae(hira).length;
    const understood = cleanHeard.length >= 2 && (matchedKws.length > 0 || hasPolite || moraLen >= 5);

    return {
      understood,
      hasPolite,
      matchedCount: matchedKws.length,
      heardRaw: cleanHeard,
      heardHira: hira,
      verdictTitle: understood ? "✅ 沟通成功！听懂并作出了自然回应" : cleanHeard ? "💬 已录下回答，试试加上关键词或礼貌句尾" : "⚠️ 暂未识别到语音，可直接点下方示例先听再试",
      verdictDetail: understood
        ? `${hasPolite ? "使用了礼貌体（です/ます/お願い），现场对话非常得体！" : "核心意思已表达清楚，加上 〜お願いします 或 〜です 会更地道。"}`
        : "自由回答不限固定台词，哪怕只回「はい、お願いします」「大丈夫です」「すみません」也完全过关！"
    };
  }

  async function runGeminiFreeTalkCoach(question, blob, dlgContext = "") {
    const apiKey = getGeminiKey();
    if (!apiKey || !blob || !question) return;
    coachState.ftAiLoading = true;
    coachState.ftAiError = "";
    coachState.ftAiResult = null;
    renderCurrentSurface();

    try {
      const { base64, mimeType } = await blobTo16kMonoWavBase64(blob);
      const qPlain = app().stripFurigana(question.jp);
      const prompt = [
        "你是一位日本当地亲切耐心的店员/服务人员兼日语私教。",
        dlgContext ? `当前情景：${dlgContext}` : "",
        `你刚刚用日语向客人追问了：「${qPlain}」（中文：${question.cn}）。`,
        "请聆听客人的语音回答，判断是否沟通成功，以日本店员身份自然回一句话，并给出简体中文礼貌得体度反馈与1句更地道的N4/N3自然表达。"
      ].filter(Boolean).join("\n");

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
              heardJp: { type: "string", description: "听到的学习者日语回答" },
              understood: { type: "boolean", description: "日本人店员是否能听懂并完成沟通" },
              staffReplyJp: { type: "string", description: "店员接着这句话的自然日语回应" },
              staffReplyCn: { type: "string", description: "店员回应的中文翻译" },
              politenessFeedback: { type: "string", description: "礼貌度与发音自然度反馈（简体中文）" },
              betterN4N3Expression: { type: "string", description: "更地道的1句N4/N3替代说法（含中文解释）" }
            },
            required: ["heardJp", "understood", "staffReplyJp", "staffReplyCn", "politenessFeedback", "betterN4N3Expression"]
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
        throw new Error(`HTTP ${resp.status}: ${errTxt.slice(0, 120)}`);
      }
      const resJson = await resp.json();
      let rawText = resJson.output_text || "";
      if (!rawText && Array.isArray(resJson.outputs)) {
        const textOut = resJson.outputs.find((o) => o && o.type === "text" && o.text);
        if (textOut) rawText = textOut.text;
      }
      coachState.ftAiResult = JSON.parse(rawText);
      coachState.ftAiLoading = false;
    } catch (err) {
      coachState.ftAiLoading = false;
      coachState.ftAiError = `AI 对话分支暂不可用：${err.message || "网络或 Key 验证失败"}`;
    }
    renderCurrentSurface();
  }

  async function startFreeTalkRecording(question, dlgContext = "") {
    if (!question) return;
    stopAll();
    const mySession = ++coachState.captureSessionId;
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const startNow = performance.now();

    coachState.ftActive = true;
    coachState.ftPhase = "listening";
    coachState.ftHeard = "";
    coachState.ftResult = null;
    coachState.ftAiResult = null;
    coachState.ftAiError = "";
    coachState.heardAnyVoice = false;
    coachState.recStartMs = startNow;
    coachState.vadStartMs = 0;
    coachState.speechOnsetMs = 0;
    coachState.speechOffsetMs = 0;
    coachState.lastVoiceOrAsrMs = startNow;
    coachState.lastVoiceRmsMs = startNow;
    coachState.lastAsrChangeMs = startNow;
    coachState.noiseFloor = 1.2;
    coachState.elapsedSec = 0;
    coachState.asrHypotheses = [];

    let finalized = false;
    let stopping = false;
    let srDone = !SR;
    let recDone = true;
    const chunks = [];
    let ftBlob = null;
    let committedSegments = [];
    let currentFinalSegments = [];
    let currentInterim = "";
    let srRestarts = 0;
    let burstCommitted = false;
    let lastDispSig = "";
    let browserSpeechActive = false;

    function updateFtInterim() {
      const combined = buildCombinedHypotheses(committedSegments, currentFinalSegments, currentInterim);
      coachState.ftHeard = combined[0] || "";
      const liveEl = document.getElementById("oc-interim-live");
      if (liveEl) liveEl.textContent = coachState.ftHeard ? `👂 实时听到：${coachState.ftHeard}` : "请自由用日语回答店员问题…";
      return coachState.ftHeard;
    }

    function commitFtBurst() {
      if (burstCommitted) return;
      burstCommitted = true;
      if (currentFinalSegments.length > 0) {
        committedSegments = dedupeSegmentList([...committedSegments, ...currentFinalSegments]);
        currentFinalSegments = [];
      } else if (currentInterim.trim()) {
        committedSegments = dedupeSegmentList([...committedSegments, [currentInterim.trim()]]);
      }
      currentInterim = "";
      updateFtInterim();
    }

    function finishFt() {
      if (finalized || mySession !== coachState.captureSessionId) return;
      if (!srDone || !recDone) return;
      finalized = true;
      clearAllTimers();
      releaseMicResources();
      commitFtBurst();
      coachState.phase = "idle";
      coachState.ftPhase = "result";
      coachState.ftResult = evaluateFreeTalkOffline(question, coachState.ftHeard);
      if (ftBlob) {
        revokeUserAudioUrl();
        coachState.userBlob = ftBlob;
        coachState.userAudioUrl = URL.createObjectURL(ftBlob);
      }
      renderCurrentSurface();
      if (isGeminiEnabled() && ftBlob) {
        runGeminiFreeTalkCoach(question, ftBlob, dlgContext);
      }
    }

    function stopFtGracefully() {
      if (finalized || mySession !== coachState.captureSessionId) return;
      if (stopping) {
        if (srDone && recDone) finishFt();
        return;
      }
      stopping = true;
      clearAllTimers();
      coachState.ftPhase = "evaluating";
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
        finishFt();
        return;
      }
      setTimeout(() => {
        if (mySession !== coachState.captureSessionId || finalized) return;
        srDone = true;
        recDone = true;
        finishFt();
      }, 650);
    }

    // Bind finish hook BEFORE first render so button onclick is live immediately
    coachState._ftManualFinish = stopFtGracefully;
    renderCurrentSurface();

    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (mySession !== coachState.captureSessionId || coachState.ftPhase !== "listening" || stopping) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        coachState.mediaStream = stream;
        const ctx = getAudioCtx();
        if (ctx) {
          try {
            const src = ctx.createMediaStreamSource(stream);
            const analyser = ctx.createAnalyser();
            analyser.fftSize = 128;
            src.connect(analyser);
            coachState.sourceNode = src;
            coachState.analyserNode = analyser;
            drawWaveformLoop();
          } catch (e) {}
        }
        if (window.MediaRecorder) {
          try {
            const preferredTypes = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
            const chosenType = preferredTypes.find((t) => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) || "";
            const recorder = chosenType ? new MediaRecorder(stream, { mimeType: chosenType }) : new MediaRecorder(stream);
            recDone = false;
            recorder.ondataavailable = (ev) => {
              if (mySession !== coachState.captureSessionId) return;
              if (ev.data && ev.data.size > 0) chunks.push(ev.data);
            };
            recorder.onstop = () => {
              if (mySession !== coachState.captureSessionId) return;
              if (chunks.length > 0) {
                ftBlob = new Blob(chunks, { type: chosenType || chunks[0].type || "audio/webm" });
              }
              recDone = true;
              finishFt();
            };
            recorder.start(120);
            coachState.mediaRecorder = recorder;
          } catch (e) {
            recDone = true;
          }
        }
      } catch (e) {}
    }

    function startFtRec() {
      if (!SR || mySession !== coachState.captureSessionId || stopping || coachState.ftPhase !== "listening") {
        srDone = true;
        return;
      }
      burstCommitted = false;
      browserSpeechActive = false;
      currentFinalSegments = [];
      currentInterim = "";
      try {
        const rec = new SR();
        rec.lang = "ja-JP";
        rec.interimResults = true;
        rec.maxAlternatives = 3;
        rec.continuous = true;
        rec.onspeechstart = () => {
          if (mySession !== coachState.captureSessionId) return;
          browserSpeechActive = true;
          const now = performance.now();
          coachState.lastVoiceRmsMs = Math.max(coachState.lastVoiceRmsMs, now);
        };
        rec.onspeechend = () => {
          if (mySession !== coachState.captureSessionId) return;
          browserSpeechActive = false;
        };
        rec.onresult = (ev) => {
          if (mySession !== coachState.captureSessionId || finalized) return;
          const newFinals = [];
          let newInterim = "";
          for (let i = 0; i < ev.results.length; i++) {
            const res = ev.results[i];
            if (res.isFinal) {
              const alts = [];
              for (let aIdx = 0; aIdx < res.length; aIdx++) {
                if (res[aIdx] && res[aIdx].transcript) alts.push(res[aIdx].transcript.trim());
              }
              if (alts.length > 0) newFinals.push(alts);
            } else if (res[0] && res[0].transcript) {
              newInterim += res[0].transcript;
            }
          }
          currentFinalSegments = dedupeSegmentList(newFinals);
          currentInterim = newInterim;
          const now = performance.now();
          const disp = updateFtInterim();
          if (disp && disp !== lastDispSig) {
            lastDispSig = disp;
            coachState.heardAnyVoice = true;
            coachState.lastAsrChangeMs = now;
            coachState.lastVoiceOrAsrMs = now;
          }
        };
        rec.onerror = (ev) => {
          if (mySession !== coachState.captureSessionId) return;
          browserSpeechActive = false;
          const errCode = ev && ev.error;
          if (errCode === "not-allowed" || errCode === "service-not-allowed") {
            srDone = true;
            stopFtGracefully();
          } else if (stopping) {
            srDone = true;
            finishFt();
          }
        };
        rec.onend = () => {
          if (mySession !== coachState.captureSessionId || finalized) return;
          browserSpeechActive = false;
          commitFtBurst();
          if (!stopping && coachState.ftPhase === "listening") {
            if (!coachState.manualStop && coachState.ftHeard.length >= 6 && (performance.now() - coachState.lastVoiceRmsMs >= 1000)) {
              srDone = true;
              stopFtGracefully();
              return;
            }
            if (srRestarts < 6) {
              srRestarts++;
              setTimeout(() => {
                if (mySession !== coachState.captureSessionId) return;
                if (!stopping && coachState.ftPhase === "listening") startFtRec();
                else {
                  srDone = true;
                  finishFt();
                }
              }, 60);
              return;
            }
          }
          srDone = true;
          finishFt();
        };
        coachState.recognition = rec;
        rec.start();
      } catch (e) {
        srDone = true;
      }
    }

    if (SR) startFtRec();

    coachState.monitorTimer = setInterval(() => {
      if (mySession !== coachState.captureSessionId || coachState.ftPhase !== "listening" || stopping) return;
      const now = performance.now();
      const elapsedSec = Math.floor((now - coachState.recStartMs) / 1000);
      if (elapsedSec !== coachState.elapsedSec) {
        coachState.elapsedSec = elapsedSec;
        const timerEl = document.getElementById("oc-rec-timer");
        if (timerEl) {
          timerEl.textContent = `${String(Math.floor(elapsedSec / 60)).padStart(2, "0")}:${String(elapsedSec % 60).padStart(2, "0")}`;
        }
      }
      if (coachState.manualStop) return;
      const hasSpoken = coachState.heardAnyVoice || coachState.ftHeard.length >= 2;
      if (!hasSpoken) {
        if (now - coachState.recStartMs > 10000) stopFtGracefully();
        return;
      }
      const asrQuietMs = now - coachState.lastAsrChangeMs;
      const voiceQuietMs = now - Math.max(coachState.lastVoiceRmsMs, coachState.lastAsrChangeMs);
      if ((!browserSpeechActive && voiceQuietMs >= 2000 && asrQuietMs >= 1600) || asrQuietMs >= 3600) {
        stopFtGracefully();
      }
    }, 120);

    coachState.maxCapTimer = setTimeout(() => {
      if (mySession === coachState.captureSessionId && coachState.ftPhase === "listening" && !stopping) stopFtGracefully();
    }, 30000);
  }

  function advanceToNextItem(autoStart = false) {
    stopAll();
    coachState.result = null;
    coachState.selectedChunkIdx = null;
    coachState.aiResult = null;
    coachState.aiError = "";
    coachState.phase = "idle";
    coachState.statusText = "";
    coachState.interimText = "";
    coachState.rpRevealed = false;
    coachState.shadowLoopStage = 0;
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
        else startGuidedPractice(nextTurn, coachState.shadowLoop ? 0.84 : null);
      }
      return;
    }

    const items = getFilteredDeckItems(coachState.deck);
    if (items.length > 0) {
      coachState.index = (coachState.index + 1) % items.length;
    }
    coachState.autoRetries = 0;
    renderCurrentSurface();
    if (autoStart) {
      const nextIt = getActiveItem();
      if (nextIt) startGuidedPractice(nextIt, coachState.shadowLoop ? 0.84 : null);
    }
  }

  function runRoleplayPartnerTurn(turnItem) {
    if (!turnItem || turnItem.speaker === "us") return;
    stopAll();
    coachState.phase = "model_playing";
    coachState.rpRevealed = false;
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
        coachState.selectedChunkIdx = null;
        renderCurrentSurface();
        const nextUserTurn = getActiveItem();
        if (nextUserTurn && nextUserTurn.speaker === "us" && (coachState.handsFree || coachState.shadowLoop)) {
          playCueChime("start");
          setTimeout(() => {
            if (coachState.handsFree || coachState.shadowLoop) beginListeningAndRecording(nextUserTurn);
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
      .map((ch, idx) => {
        if (ch.isPunct) return `<span class="oc-tok oc-tok-punct">${ch.displayHtml}</span>`;
        if (ch.status === "neutral") {
          const sel = coachState.selectedChunkIdx === idx ? "oc-tok-selected" : "";
          return `<button type="button" class="oc-tok oc-tok-btn ${sel}" data-chunk-idx="${idx}" title="点击 0.7x 慢听「${a.escapeHtml(ch.kana || ch.raw)}」">${ch.displayHtml}</button>`;
        }
        const cls = ch.status === "ok" ? "oc-tok-ok" : ch.status === "close" ? "oc-tok-close" : "oc-tok-miss";
        const sel = coachState.selectedChunkIdx === idx ? "oc-tok-selected" : "";
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
        return `<button type="button" class="oc-tok oc-tok-btn ${cls} ${sel}" data-chunk-idx="${idx}" ${issueHint ? `data-hint="${issueHint}"` : ""} title="点击 0.7x 单点慢听纠音">${ch.displayHtml}${issueHint ? `<span class="oc-tok-badge">${issueHint}</span>` : ""}</button>`;
      })
      .join("");
    return `<div class="jp-text oc-main-jp oc-diff-sentence" lang="ja">${html}</div>`;
  }

  function renderPitchGuideHtml(item, masked = false) {
    if (!coachState.showPitchGuide || masked || !item || !item.jp) return "";
    const clauses = analyzeMoraPitchContour(item.jp);
    if (!clauses.length) return "";
    const a = app();
    const totalMora = clauses.reduce((s, c) => s + c.morae.length, 0);
    if (totalMora > 48) return "";

    const clausesHtml = clauses
      .map(
        (cl) => `
        <span class="oc-pitch-clause">
          ${cl.morae
            .map((m) => {
              const lvlCls = m.level === "H" ? "oc-pm-h" : "oc-pm-l";
              const dropCls = m.dropAfter ? "oc-pm-drop" : "";
              const kindCls = m.kind === "sokuon" ? "oc-pm-sokuon" : m.kind === "long" ? "oc-pm-long" : m.kind === "nasal" ? "oc-pm-nasal" : "";
              const riseCls = m.risingEnd ? "oc-pm-rise" : "";
              return `<span class="oc-pm-cell ${lvlCls} ${dropCls} ${kindCls} ${riseCls}"><span class="oc-pm-bar"></span><span class="oc-pm-kana">${a.escapeHtml(m.mora)}</span></span>`;
            })
            .join("")}
        </span>`
      )
      .join('<span class="oc-pitch-sep">/</span>');

    return `
      <div class="oc-pitch-strip" aria-label="音拍与高低音调参考">
        <div class="oc-pitch-morae" lang="ja">${clausesHtml}</div>
        <div class="oc-pitch-legend">🎵 东京腔音拍与高低参考 · ⏸ 促音(っ)停半拍 · ━ 长音拉满 · ↘ 降调 · ↗ 疑问升调</div>
      </div>
    `;
  }

  function renderChunkDrillCard(item) {
    if (!coachState.result || coachState.selectedChunkIdx === null) return "";
    const ch = (coachState.result.chunkResults || [])[coachState.selectedChunkIdx];
    if (!ch || ch.isPunct) return "";
    const a = app();
    const cleanRaw = a.stripFurigana(ch.raw);
    const primaryIssue = (ch.issueTypes && ch.issueTypes[0]) || (ch.status === "miss" ? "miss" : "ok");
    let advice = "发音清晰过关！再点一遍「0.7x 慢听该词」可重点核对元音与高低音调是否与原声一致。";
    if (primaryIssue === "sokuon") advice = ISSUE_META.sokuon.shortTip;
    else if (primaryIssue === "long_vowel") advice = ISSUE_META.long_vowel.shortTip;
    else if (primaryIssue === "voicing") advice = ISSUE_META.voicing.shortTip;
    else if (primaryIssue === "consonant") advice = ISSUE_META.consonant.shortTip;
    else if (primaryIssue === "miss" || ch.status === "miss") advice = "这一词块存在漏读或音节偏差，建议先 0.7x 慢听跟读两遍，再连回整句。";

    return `
      <div class="oc-chunk-drill-card" id="oc-chunk-drill-card">
        <div class="oc-cd-top">
          <div class="oc-cd-title">
            <span lang="ja" style="font-weight:900;font-size:1.02rem;">「${a.escapeHtml(cleanRaw)}」</span>
            ${ch.kana ? `<span class="oc-cd-kana">${a.escapeHtml(ch.kana)}</span>` : ""}
          </div>
          <div style="display:flex;gap:0.35rem;align-items:center;">
            <button type="button" class="action-btn primary-audio" id="oc-btn-drill-chunk-play">🐢 0.7x 慢听该词</button>
            <button type="button" class="icon-btn" id="oc-btn-drill-chunk-close" aria-label="关闭单点纠音">✕</button>
          </div>
        </div>
        <div class="oc-cd-meta">
          识别听到：<strong>${a.escapeHtml(ch.heardKana || "未清晰识别")}</strong> · ${a.escapeHtml(advice)}
        </div>
      </div>
    `;
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
        ? `<div class="oc-ai-card"><div class="oc-ai-hdr">✨ Gemini 3.8 Flash 深度听音分析中...</div><div style="font-size:0.8rem;color:var(--text-secondary);">正在评估高低音调 (Pitch Accent)、礼貌得体度与元音口型，请稍候 1–2 秒。</div></div>`
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
            ${coachState.aiResult.politenessNotes ? `<div class="oc-ai-line"><strong>🙇 礼貌得体：</strong>${a.escapeHtml(coachState.aiResult.politenessNotes)}</div>` : ""}
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
          <span style="font-size:0.71rem;color:var(--text-muted);align-self:center;">👆 点击词块可 0.7x 慢听纠音</span>
        </div>

        ${renderChunkDrillCard(item)}

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
                <span style="display:inline-flex;align-items:center;gap:0.4rem;">
                  <span class="oc-mic-dot"></span>
                  <span>正在收音跟读中…</span>
                  <span id="oc-rec-timer" class="oc-rec-timer">00:${String(coachState.elapsedSec || 0).padStart(2, "0")}</span>
                </span>
                <button type="button" class="action-btn speaking" id="oc-btn-finish-now">⏹ 说完了，立即评分</button>
              </div>
              <canvas id="oc-waveform-canvas" class="oc-waveform-canvas" width="320" height="44"></canvas>
              <div id="oc-interim-live" class="oc-interim-box" lang="ja">${app().escapeHtml(coachState.interimText || "请直接开口说日语…")}</div>
              <div class="oc-rec-hint">${
                coachState.manualStop
                  ? "🖐️ 手动结束模式：从容读完后再点击上方「说完了，立即评分」（或按 Space）"
                  : "⏱️ 自动评分模式：说完停顿约 1 秒即自动结束并评分（长句中途换气不会打断，也可随时点上方按钮）"
              }</div>
            </div>`
          : ""
      }

      <div class="oc-controls-stack">
        <div class="fc-controls-row oc-controls-row oc-controls-primary">
          ${
            isBusy
              ? `<button type="button" class="action-btn speaking" id="oc-btn-stop-all">⏹ 停止</button>`
              : `<button type="button" class="action-btn primary-audio" id="oc-btn-guided">
                  ${coachState.shadowLoop ? "🔁 慢→快循环跟读" : coachState.result ? "🔁 再示范并跟读" : "▶ 示范并自动跟读"}
                </button>
                <button type="button" class="action-btn" id="oc-btn-direct-mic">🎙️ 直接开麦</button>`
          }
        </div>
        <div class="fc-controls-row oc-controls-row oc-controls-secondary">
          ${!isQuick ? `<button type="button" class="action-btn" id="oc-btn-prev">← 上一句</button>` : ""}
          <button type="button" class="action-btn" id="oc-btn-model-1x" title="原速示范 (R)">🔊 原声</button>
          <button type="button" class="action-btn" id="oc-btn-model-slow" title="慢速示范 (S)">🐢 0.84x</button>
          ${!isQuick ? `<button type="button" class="action-btn" id="oc-btn-next">下一句 →</button>` : ""}
        </div>
      </div>
    `;
  }

  function renderFreeTalkCard(dlg) {
    const a = app();
    const q = coachState.ftQuestion || getFollowupForDialogue(dlg);
    if (!coachState.ftActive) {
      return `
        <div class="oc-freetalk-card" id="oc-freetalk-box">
          <div style="display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:0.5rem;">
            <div>
              <div style="font-weight:800;font-size:0.86rem;color:var(--accent-indigo);">🤖 进阶实战：店员随机追问挑战 (Free-Talk)</div>
              <div style="font-size:0.75rem;color:var(--text-secondary);">练完脚本对话？试试听一句日本店员的临时追问，自由用自己的话回答！</div>
            </div>
            <button type="button" class="action-btn primary-audio" id="oc-btn-ft-start">🎭 来一句随机追问</button>
          </div>
        </div>
      `;
    }

    const r = coachState.ftResult;
    const ai = coachState.ftAiResult;

    return `
      <div class="oc-freetalk-card" id="oc-freetalk-box">
        <div class="oc-cd-top" style="margin-bottom:0.4rem;">
          <span style="font-weight:800;font-size:0.84rem;color:var(--accent-indigo);">🤖 店员突然追问了一句：</span>
          <div style="display:flex;gap:0.3rem;flex-wrap:wrap;">
            <button type="button" class="icon-btn" id="oc-btn-ft-play">🔊 重听追问</button>
            <button type="button" class="icon-btn" id="oc-btn-ft-cn">${coachState.ftShowCn ? "隐藏中文" : "👀 中文提示"}</button>
            <button type="button" class="icon-btn" id="oc-btn-ft-close" aria-label="收起追问">✕</button>
          </div>
        </div>

        <div class="oc-ft-qbox">
          <div class="jp-text" lang="ja" style="font-size:1.05rem;line-height:1.8;">${a.formatRuby(q.jp)}</div>
          ${q.romaji ? `<div class="romaji-text" style="margin:0.1rem 0;">${a.escapeHtml(q.romaji)}</div>` : ""}
          ${coachState.ftShowCn ? `<div class="cn-text" style="font-size:0.84rem;margin:0.2rem 0 0;">${a.escapeHtml(q.cn)}</div>` : ""}
        </div>

        ${
          coachState.ftPhase === "listening"
            ? `<div class="oc-live-capture" style="margin:0.5rem 0;">
                <div class="oc-mic-row">
                  <span style="display:inline-flex;align-items:center;gap:0.4rem;">
                    <span class="oc-mic-dot"></span>
                    <span>正在听你自由回答…</span>
                    <span id="oc-rec-timer" class="oc-rec-timer">00:${String(coachState.elapsedSec || 0).padStart(2, "0")}</span>
                  </span>
                  <button type="button" class="action-btn speaking" id="oc-btn-ft-finish">⏹ 说完了，立即反馈</button>
                </div>
                <canvas id="oc-waveform-canvas" class="oc-waveform-canvas" width="320" height="44"></canvas>
                <div id="oc-interim-live" class="oc-interim-box" lang="ja">${a.escapeHtml(coachState.ftHeard || "请自由用日语回答店员问题…")}</div>
              </div>`
            : coachState.ftPhase === "evaluating"
            ? `<div class="shadow-status-banner">🔍 正在分析你的自由回答…</div>`
            : `<div class="fc-controls-row oc-controls-row" style="margin-top:0.45rem;">
                <button type="button" class="action-btn primary-audio" id="oc-btn-ft-mic">${r ? "🔁 再答一次" : "🎙️ 自由开口回答"}</button>
              </div>`
        }

        ${
          r
            ? `<div class="oc-ft-result">
                <div class="oc-tip-card ${r.understood ? "tip-ok" : "tip-info"}">
                  <div class="oc-tip-title">${a.escapeHtml(r.verdictTitle)}</div>
                  ${r.heardRaw ? `<div style="font-size:0.82rem;margin-bottom:0.2rem;">🎙️ 识别到你说：<strong lang="ja">${a.escapeHtml(r.heardRaw)}</strong></div>` : ""}
                  <div class="oc-tip-detail">${a.escapeHtml(r.verdictDetail)}</div>
                </div>

                <div style="font-size:0.78rem;font-weight:800;color:var(--text-secondary);margin-top:0.4rem;">💡 地道回应参考（点击试听）：</div>
                <div style="display:flex;flex-direction:column;gap:0.35rem;">
                  ${(q.sampleReplies || [])
                    .map(
                      (sr, idx) => `
                    <div class="oc-ft-sample-row">
                      <div style="min-width:0;">
                        <div lang="ja" style="font-weight:700;font-size:0.86rem;">${a.escapeHtml(sr.jp)}</div>
                        <div style="font-size:0.75rem;color:var(--text-secondary);">${a.escapeHtml(sr.cn)}</div>
                      </div>
                      <button type="button" class="icon-btn oc-ft-sample-play" data-ftsample="${idx}" style="flex-shrink:0;">🔊</button>
                    </div>`
                    )
                    .join("")}
                </div>

                ${
                  isGeminiEnabled()
                    ? coachState.ftAiLoading
                      ? `<div class="oc-ai-card" style="margin-top:0.45rem;"><div class="oc-ai-hdr">✨ Gemini AI 店员正在听取回答并生成下一轮回应...</div></div>`
                      : coachState.ftAiError
                      ? `<div class="oc-ai-card oc-ai-err" style="margin-top:0.45rem;">${a.escapeHtml(coachState.ftAiError)}</div>`
                      : ai
                      ? `<div class="oc-ai-card" style="margin-top:0.45rem;">
                          <div class="oc-ai-hdr">✨ AI 店员真实接话回应 <strong>${ai.understood ? "✅ 已听懂" : "🤔 需补充"}</strong></div>
                          <div class="oc-ai-line" style="display:flex;justify-content:space-between;align-items:center;gap:0.4rem;flex-wrap:wrap;">
                            <span><strong>🇯🇵 店员接着说：</strong><span lang="ja">${a.escapeHtml(ai.staffReplyJp)}</span>（${a.escapeHtml(ai.staffReplyCn)}）</span>
                            <button type="button" class="icon-btn" id="oc-btn-ft-ai-reply-play">🔊 播放回应</button>
                          </div>
                          <div class="oc-ai-line"><strong>🙇 礼貌与发音：</strong>${a.escapeHtml(ai.politenessFeedback)}</div>
                          <div class="oc-ai-line"><strong>🚀 N4/N3 升级表达：</strong>${a.escapeHtml(ai.betterN4N3Expression)}</div>
                        </div>`
                      : ""
                    : ""
                }
              </div>`
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
    const items = coachState.deck === "roleplay" ? [] : getFilteredDeckItems(coachState.deck);
    const allUnfilteredDeckCount = coachState.deck === "roleplay" ? dlgs.length : getDeckItems(coachState.deck).length;
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
    const verbsTotalCount = coachState.includeAllExamples
      ? (window.JP_TOP_VERBS || []).reduce((s, v) => s + ((v.examples && v.examples.length) || 0), 0)
      : (window.JP_TOP_VERBS || []).length;
    const grammarTotalCount = coachState.includeAllExamples
      ? (window.JP_GRAMMAR_LIST || []).reduce((s, g) => s + ((g.dailyExamples && g.dailyExamples.length) || 0), 0)
      : (window.JP_GRAMMAR_LIST || []).length;
    const aiReady = isGeminiEnabled();

    const deckPills = [
      ["phrases", `🗣️ 场景短语`],
      ["roleplay", `🎭 对话角色扮演 (${dlgs.length})`],
      ["staff", `🏪 店员听问回答 (24)`],
      ["verbs", `⚡ 动词例句 (${verbsTotalCount})`],
      ["grammar", `📖 语法例句 (${grammarTotalCount})`],
      ["n5vocab", `🟢 N5 & 缩略`],
      ["weak", `🔥 薄弱复训 (${weakCount})`]
    ];

    let stageContent = "";

    if (!item) {
      const isFilteredEmpty = coachState.deck !== "weak" && allUnfilteredDeckCount > 0;
      stageContent = `
        <div class="drill-question-box" style="text-align:center;padding:1.6rem 1rem;">
          <div style="font-size:2rem;margin-bottom:0.4rem;">${isFilteredEmpty ? "🔍" : "🎉"}</div>
          <div style="font-weight:800;margin-bottom:0.4rem;">${isFilteredEmpty ? "当前筛选条件下暂无匹配句子" : "当前还没有低于 80 分的薄弱句！"}</div>
          <p style="font-size:0.84rem;color:var(--text-secondary);margin-bottom:0.9rem;">${
            isFilteredEmpty
              ? "可以重置上方的状态或弱项筛选，回到完整词库继续跟读。"
              : "先在「场景短语」或「对话角色扮演」跟读几句，系统会自动把需要加强的句子收集到这里方便复训。"
          }</p>
          ${
            isFilteredEmpty
              ? `<button type="button" class="action-btn primary-audio" id="oc-btn-clear-filters">清除筛选条件</button>`
              : `<button type="button" class="action-btn primary-audio" id="oc-btn-back-phrases">切换回场景短语</button>`
          }
        </div>
      `;
    } else if (coachState.deck === "roleplay" && item.dialogue) {
      const dlg = item.dialogue;
      const curTurn = item;
      const isPartnerTurn = curTurn.speaker !== "us";
      const usTurnIds = dlg.turns
        .map((t, i) => (t.speaker === "us" ? `${dlg.id}-turn-${i}` : null))
        .filter(Boolean);
      const recordedClipsCount = usTurnIds.filter((id) => Boolean(coachState.rpUserClips[id])).length;
      const isTurnMasked = coachState.rpRecallMode && !isPartnerTurn && !coachState.rpRevealed && !coachState.result;

      stageContent = `
        <div class="drill-question-box oc-sentence-card">
          <div class="oc-roleplay-bar">
            <select id="oc-rp-select" class="lf-select oc-rp-select" aria-label="选择场景对话">
              ${dlgs.map((d) => `<option value="${d.id}" ${d.id === dlg.id ? "selected" : ""}>${a.escapeHtml(d.title)}</option>`).join("")}
            </select>
            <span class="phrase-tag">轮次 ${coachState.roleplayTurnIdx + 1} / ${dlg.turns.length}</span>
          </div>

          <div class="oc-rp-toolbar">
            <button type="button" class="toggle-chip ${coachState.rpRecallMode ? "active" : ""}" id="oc-toggle-rp-recall" title="隐藏我方日文，先看中文意图脱口而出">
              ${coachState.rpRecallMode ? "🇨🇳 中文提词：开" : "🇨🇳 中文提词回忆"}
            </button>
            <button type="button" class="toggle-chip ${coachState.rpMixPlaying ? "active" : ""}" id="oc-btn-rp-playmix" title="按对话顺序连续播放：对方原声 + 你刚才录制的回应">
              ${coachState.rpMixPlaying ? "⏹ 停止整段合听" : `🎧 回放整段对话 (${recordedClipsCount}/${usTurnIds.length} 句自录)`}
            </button>
          </div>

          <div class="dialogue-context" style="margin:0.45rem 0 0.7rem;">📍 ${a.escapeHtml(dlg.context)}</div>

          <div class="oc-roleplay-thread">
            ${dlg.turns
              .map((t, idx) => {
                const stateCls =
                  idx === coachState.roleplayTurnIdx ? "rp-active" : idx < coachState.roleplayTurnIdx ? "rp-done" : "rp-upcoming";
                const mixCls = coachState.rpMixPlaying && coachState.rpMixTurnIdx === idx ? "rp-mix-playing" : "";
                const turnId = `${dlg.id}-turn-${idx}`;
                const turnStats = oralStats[turnId];
                const hasSelfClip = Boolean(coachState.rpUserClips[turnId]);
                const maskBubble =
                  coachState.rpRecallMode &&
                  t.speaker === "us" &&
                  !turnStats &&
                  !(idx === coachState.roleplayTurnIdx && (coachState.rpRevealed || coachState.result));

                return `
                <div class="oc-rp-bubble ${t.speaker === "us" ? "rp-us" : "rp-them"} ${stateCls} ${mixCls}" data-rpturn="${idx}">
                  <div class="oc-rp-who">
                    <span>${t.speaker === "us" ? "👨‍👩‍👧‍👧 我方：" : "🇯🇵 对方："}${a.escapeHtml(t.speakerName)}</span>
                    <span style="display:inline-flex;gap:0.25rem;align-items:center;">
                      ${hasSelfClip ? `<span class="oc-oral-badge">🎤 已录</span>` : ""}
                      ${turnStats ? `<span class="oc-oral-badge">最佳 ${turnStats.bestScore}分</span>` : ""}
                    </span>
                  </div>
                  ${
                    maskBubble
                      ? `<div class="oc-rp-masked">🔒 凭中文记忆开口表达后再揭晓日文…</div>`
                      : `<div class="jp-text" lang="ja" style="font-size:1rem;line-height:1.8;">${a.formatRuby(t.jp)}</div>`
                  }
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

            ${
              isTurnMasked
                ? `<div class="oc-recall-prompt-box">
                    <div style="font-size:0.78rem;font-weight:800;color:var(--accent-indigo);margin-bottom:0.25rem;">🇨🇳 中文提词主动回忆：试试不看日文直接说！</div>
                    <div style="font-size:1.05rem;font-weight:800;color:var(--text-primary);margin-bottom:0.45rem;">${a.escapeHtml(curTurn.cn)}</div>
                    ${curTurn.note ? `<div class="turn-note" style="margin-bottom:0.5rem;">💡 ${a.escapeHtml(curTurn.note)}</div>` : ""}
                    <button type="button" class="action-btn" id="oc-btn-rp-reveal">👁️ 偷看标准日文</button>
                  </div>`
                : `${renderDiffSentenceHtml(curTurn)}
                   ${renderPitchGuideHtml(curTurn, coachState.blindMode && !coachState.result)}
                   <div class="romaji-text ${coachState.blindMode && !coachState.result ? "oc-blind-blur" : ""}" style="text-align:center;">${a.escapeHtml(curTurn.romaji)}</div>
                   <div class="cn-text" style="text-align:center;margin-bottom:0.65rem;">${a.escapeHtml(curTurn.cn)}</div>
                   ${curTurn.note ? `<div class="turn-note" style="margin-bottom:0.65rem;">💡 ${a.escapeHtml(curTurn.note)}</div>` : ""}`
            }

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

          ${renderFreeTalkCard(dlg)}
        </div>
      `;
    } else {
      const prevStat = oralStats[item.id];
      const focusMeta = coachState.issueFocus ? ISSUE_META[coachState.issueFocus] : null;
      const pickerQuery = coachState.pickerQuery.trim().toLowerCase();
      const pickerMatches = coachState.showPicker
        ? items
            .map((it, idx) => ({ it, idx }))
            .filter(({ it }) => {
              if (!pickerQuery) return true;
              const hay = `${it.tag} ${a.stripFurigana(it.jp)} ${it.romaji || ""} ${it.cn || ""}`.toLowerCase();
              return hay.includes(pickerQuery);
            })
            .slice(0, 60)
        : [];

      stageContent = `
        <div class="drill-question-box oc-sentence-card">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:0.45rem;flex-wrap:wrap;margin-bottom:0.45rem;">
            <span class="phrase-tag">${a.escapeHtml(item.tag)}</span>
            <div style="display:flex;gap:0.4rem;align-items:center;flex-wrap:wrap;">
              ${prevStat ? `<span class="oc-oral-badge">历史最高 ${prevStat.bestScore}分 (${prevStat.attempts}次)</span>` : ""}
              <span style="font-size:0.78rem;color:var(--text-muted);font-weight:700;">第 ${coachState.index + 1} / ${items.length} 句</span>
            </div>
          </div>

          <div class="oc-deck-subbar">
            ${
              coachState.deck !== "weak"
                ? `<div class="oc-subbar-group">
                    <button type="button" class="toggle-chip ${coachState.deckFilter === "all" ? "active" : ""}" data-ocfilter="all">全部</button>
                    <button type="button" class="toggle-chip ${coachState.deckFilter === "unpracticed" ? "active" : ""}" data-ocfilter="unpracticed">未练</button>
                    <button type="button" class="toggle-chip ${coachState.deckFilter === "under80" ? "active" : ""}" data-ocfilter="under80">未达标</button>
                  </div>`
                : ""
            }
            ${
              coachState.deck === "verbs" || coachState.deck === "grammar"
                ? `<button type="button" class="toggle-chip ${coachState.includeAllExamples ? "active" : ""}" id="oc-toggle-allex">
                    ${coachState.includeAllExamples ? "📚 全部例句" : "📌 核心首句"}
                  </button>`
                : ""
            }
            ${
              focusMeta
                ? `<button type="button" class="toggle-chip active" id="oc-clear-focus">
                    ${focusMeta.icon} ${focusMeta.label} ✕
                  </button>`
                : ""
            }
            <div class="oc-subbar-actions">
              <button type="button" class="toggle-chip" id="oc-btn-random" title="随机抽一句练习">🔀 随机</button>
              <button type="button" class="toggle-chip ${coachState.showPicker ? "active" : ""}" id="oc-btn-toggle-picker" title="搜索或直接跳选句子">📋 选句</button>
            </div>
          </div>

          ${
            coachState.showPicker
              ? `<div class="oc-picker-panel" id="oc-picker-panel">
                  <input type="text" id="oc-picker-search" class="tb-input" placeholder="输入中文、日语或标签关键词搜索（展示前60条匹配）..." value="${a.escapeHtml(coachState.pickerQuery)}" />
                  <div class="oc-picker-list">
                    ${
                      pickerMatches.length
                        ? pickerMatches
                            .map(({ it, idx }) => {
                              const ps = oralStats[it.id];
                              return `
                              <button type="button" class="oc-picker-row ${idx === coachState.index ? "active" : ""}" data-pickidx="${idx}">
                                <span class="oc-picker-num">#${idx + 1}</span>
                                <span class="oc-picker-main">
                                  <span class="oc-picker-jp" lang="ja">${a.escapeHtml(a.stripFurigana(it.jp))}</span>
                                  <span class="oc-picker-cn">${a.escapeHtml(it.cn || "")}</span>
                                </span>
                                ${ps ? `<span class="oc-oral-badge">${ps.bestScore}分</span>` : ""}
                              </button>`;
                            })
                            .join("")
                        : `<div style="font-size:0.8rem;color:var(--text-muted);text-align:center;padding:0.75rem;">没有找到匹配句子</div>`
                    }
                  </div>
                </div>`
              : ""
          }

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
          ${renderPitchGuideHtml(item, coachState.blindMode && !coachState.result)}
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
            <button type="button" class="toggle-chip ${coachState.shadowLoop ? "active" : ""}" id="oc-toggle-loop" title="每句先 0.84x 慢读一遍，紧接 1.0x 原速复读一遍，达标自动下句">
              ${coachState.shadowLoop ? "🔁 循环：开" : "🔁 慢→快循环"}
            </button>
            <button type="button" class="toggle-chip ${coachState.blindMode ? "active" : ""}" id="oc-toggle-blind" title="隐藏日文拼写，凭听示范复述">
              ${coachState.blindMode ? "🙈 盲读：开" : "🙈 盲读挑战"}
            </button>
            <button type="button" class="toggle-chip ${coachState.rate < 1 ? "active" : ""}" id="oc-toggle-rate" title="切换示范语速">
              ${coachState.rate < 1 ? "🐢 默认0.84x" : "🔊 默认1.0x"}
            </button>
            <button type="button" class="toggle-chip ${coachState.manualStop ? "active" : ""}" id="oc-toggle-manualstop" title="长句容易停顿？开启手动结束后，只有点按钮才停止录音">
              ${coachState.manualStop ? "🖐️ 手动结束：开" : "⏱️ 自动结束(耐心)"}
            </button>
            <button type="button" class="toggle-chip ${coachState.showPitchGuide ? "active" : ""}" id="oc-toggle-pitchguide" title="显示东京腔音拍与高低音调参考条">
              ${coachState.showPitchGuide ? "🎵 音调拍线：开" : "🎵 音调拍线"}
            </button>
            <button type="button" class="toggle-chip ${!coachState.muteChime ? "active" : ""}" id="oc-toggle-mute" title="开关开麦/达标提示音">
              ${coachState.muteChime ? "🔕 提示音：关" : "🔔 提示音：开"}
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
                  填入你自己的 Gemini API Key 后，每次跟读都会同步调用官方 <code>gemini-3.8-flash</code> 模型听音分析<strong>高低音调 (Pitch Accent)</strong>、<strong>礼貌体得体度</strong>与<strong>舌位口型自然度</strong>。<br/>
                  🔒 Key 仅保存在当前浏览器 <code>localStorage</code>，音频仅直连 Google 官方 API，不经过任何第三方服务器。
                </div>
                <div style="display:flex;gap:0.45rem;flex-wrap:wrap;align-items:center;">
                  <input type="password" id="oc-gemini-key-input" class="tb-input" style="flex:1 1 200px;min-width:0;max-width:100%;" placeholder="粘贴你的 Gemini API Key (AIza...)" value="${a.escapeHtml(getGeminiKey())}" />
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
        ${renderPitchGuideHtml(item, false)}
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
    if (btnGuided && item) {
      btnGuided.onclick = () => {
        coachState.shadowLoopStage = 0;
        startGuidedPractice(item, coachState.shadowLoop ? 0.84 : null);
      };
    }

    const btnDirect = root.querySelector("#oc-btn-direct-mic");
    if (btnDirect && item) {
      btnDirect.onclick = () => {
        stopAll();
        const mySession = coachState.captureSessionId;
        playCueChime("start");
        coachState.preListenTimer = setTimeout(() => {
          if (mySession === coachState.captureSessionId) beginListeningAndRecording(item);
        }, 280);
      };
    }

    const btnFinishNow = root.querySelector("#oc-btn-finish-now");
    if (btnFinishNow) btnFinishNow.onclick = () => { if (coachState._manualFinish) coachState._manualFinish(); };

    const btnStopAll = root.querySelector("#oc-btn-stop-all");
    if (btnStopAll) {
      btnStopAll.onclick = () => {
        coachState.handsFree = false;
        coachState.shadowLoop = false;
        coachState.shadowLoopStage = 0;
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

    // Clickable diff chunks for isolated 0.7x slow micro-drill
    root.querySelectorAll(".oc-tok-btn[data-chunk-idx]").forEach((btn) => {
      btn.onclick = () => {
        const idx = Number(btn.dataset.chunkIdx);
        if (!Number.isFinite(idx) || !coachState.result) return;
        const ch = (coachState.result.chunkResults || [])[idx];
        if (!ch || ch.isPunct) return;
        coachState.selectedChunkIdx = idx;
        renderCurrentSurface();
        const speakTxt = ch.kana || app().stripFurigana(ch.raw);
        if (speakTxt) app().speakJapanese(speakTxt, 0.7);
      };
    });

    const btnChunkPlay = root.querySelector("#oc-btn-drill-chunk-play");
    if (btnChunkPlay && coachState.result && coachState.selectedChunkIdx !== null) {
      btnChunkPlay.onclick = () => {
        const ch = (coachState.result.chunkResults || [])[coachState.selectedChunkIdx];
        if (ch) app().speakJapanese(ch.kana || app().stripFurigana(ch.raw), 0.7);
      };
    }

    const btnChunkClose = root.querySelector("#oc-btn-drill-chunk-close");
    if (btnChunkClose) {
      btnChunkClose.onclick = () => {
        coachState.selectedChunkIdx = null;
        renderCurrentSurface();
      };
    }
  }

  function bindStudioEvents(container, item) {
    const a = app();
    container.querySelectorAll("[data-ocdeck]").forEach((b) => {
      b.onclick = () => {
        stopAll();
        coachState.deck = b.dataset.ocdeck;
        coachState.index = 0;
        coachState.result = null;
        coachState.selectedChunkIdx = null;
        coachState.aiResult = null;
        coachState.aiError = "";
        coachState.phase = "idle";
        coachState.statusText = "";
        coachState.showPicker = false;
        coachState.pickerQuery = "";
        coachState.ftActive = false;
        coachState.ftResult = null;
        revokeUserAudioUrl();
        coachState.userBlob = null;
        renderCurrentSurface();
      };
    });

    container.querySelectorAll("[data-ocfilter]").forEach((b) => {
      b.onclick = () => {
        stopAll();
        coachState.deckFilter = b.dataset.ocfilter;
        coachState.index = 0;
        coachState.result = null;
        coachState.selectedChunkIdx = null;
        coachState.statusText = "";
        renderCurrentSurface();
      };
    });

    const btnToggleAllEx = container.querySelector("#oc-toggle-allex");
    if (btnToggleAllEx) {
      btnToggleAllEx.onclick = () => {
        stopAll();
        coachState.includeAllExamples = !coachState.includeAllExamples;
        coachState.index = 0;
        coachState.result = null;
        coachState.selectedChunkIdx = null;
        coachState.statusText = "";
        a.showToast(coachState.includeAllExamples ? "📚 已解锁全部多例句库（动词900句 / 语法366句）" : "📌 已切换回核心首句精练模式");
        renderCurrentSurface();
      };
    }

    const btnClearFocus = container.querySelector("#oc-clear-focus");
    if (btnClearFocus) {
      btnClearFocus.onclick = () => {
        coachState.issueFocus = null;
        coachState.index = 0;
        renderCurrentSurface();
      };
    }

    const btnClearFilters = container.querySelector("#oc-btn-clear-filters");
    if (btnClearFilters) {
      btnClearFilters.onclick = () => {
        coachState.deckFilter = "all";
        coachState.issueFocus = null;
        coachState.index = 0;
        renderCurrentSurface();
      };
    }

    const btnRandom = container.querySelector("#oc-btn-random");
    if (btnRandom) {
      btnRandom.onclick = () => {
        const list = getFilteredDeckItems(coachState.deck);
        if (list.length <= 1) return;
        stopAll();
        let nextIdx = coachState.index;
        for (let tries = 0; tries < 5 && nextIdx === coachState.index; tries++) {
          nextIdx = Math.floor(Math.random() * list.length);
        }
        coachState.index = nextIdx;
        coachState.result = null;
        coachState.selectedChunkIdx = null;
        coachState.phase = "idle";
        coachState.statusText = "";
        renderCurrentSurface();
      };
    }

    const btnTogglePicker = container.querySelector("#oc-btn-toggle-picker");
    if (btnTogglePicker) {
      btnTogglePicker.onclick = () => {
        coachState.showPicker = !coachState.showPicker;
        renderCurrentSurface();
        if (coachState.showPicker) {
          const inp = document.getElementById("oc-picker-search");
          if (inp) inp.focus();
        }
      };
    }

    const pickerSearch = container.querySelector("#oc-picker-search");
    if (pickerSearch) {
      pickerSearch.oninput = (e) => {
        const val = e.target.value;
        const pos = e.target.selectionStart || val.length;
        coachState.pickerQuery = val;
        renderCurrentSurface();
        const nextInp = document.getElementById("oc-picker-search");
        if (nextInp) {
          nextInp.focus();
          try { nextInp.setSelectionRange(pos, pos); } catch (err) {}
        }
      };
    }

    container.querySelectorAll("[data-pickidx]").forEach((row) => {
      row.onclick = () => {
        stopAll();
        coachState.index = Number(row.dataset.pickidx) || 0;
        coachState.showPicker = false;
        coachState.result = null;
        coachState.selectedChunkIdx = null;
        coachState.phase = "idle";
        coachState.statusText = "";
        renderCurrentSurface();
      };
    });

    const btnBackPhrases = container.querySelector("#oc-btn-back-phrases");
    if (btnBackPhrases) {
      btnBackPhrases.onclick = () => {
        coachState.deck = "phrases";
        coachState.index = 0;
        coachState.statusText = "";
        renderCurrentSurface();
      };
    }

    const tHF = container.querySelector("#oc-toggle-handsfree");
    if (tHF) {
      tHF.onclick = () => {
        coachState.handsFree = !coachState.handsFree;
        if (coachState.handsFree) coachState.shadowLoop = false;
        coachState.autoRetries = 0;
        a.showToast(coachState.handsFree ? "🚀 已开启解放双手连续闯关：≥80分自动进下句！" : "已关闭连续闯关模式");
        renderCurrentSurface();
      };
    }

    const tLoop = container.querySelector("#oc-toggle-loop");
    if (tLoop) {
      tLoop.onclick = () => {
        coachState.shadowLoop = !coachState.shadowLoop;
        coachState.shadowLoopStage = 0;
        if (coachState.shadowLoop) coachState.handsFree = false;
        a.showToast(coachState.shadowLoop ? "🔁 已开启慢→快循环：先 0.84x 慢读再 1.0x 原速复读，达标自动下句" : "已关闭慢→快循环");
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

    const tManual = container.querySelector("#oc-toggle-manualstop");
    if (tManual) {
      tManual.onclick = () => {
        coachState.manualStop = !coachState.manualStop;
        localStorage.setItem(MANUAL_STOP_STORAGE, coachState.manualStop ? "1" : "0");
        a.showToast(coachState.manualStop ? "🖐️ 已切换为手动结束：说完主动点「说完了」评分" : "⏱️ 已切换为自动结束：说完停顿约 1 秒自动评分");
        renderCurrentSurface();
      };
    }

    const tPitch = container.querySelector("#oc-toggle-pitchguide");
    if (tPitch) {
      tPitch.onclick = () => {
        coachState.showPitchGuide = !coachState.showPitchGuide;
        localStorage.setItem(PITCH_GUIDE_STORAGE, coachState.showPitchGuide ? "1" : "0");
        renderCurrentSurface();
      };
    }

    const tMute = container.querySelector("#oc-toggle-mute");
    if (tMute) {
      tMute.onclick = () => {
        coachState.muteChime = !coachState.muteChime;
        localStorage.setItem(MUTE_CHIME_STORAGE, coachState.muteChime ? "1" : "0");
        a.showToast(coachState.muteChime ? "🔕 已静音开麦/过关提示音" : "🔔 已开启提示音");
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
        a.showToast(val && chk && chk.checked ? "✨ Gemini AI 听音私教已就绪！" : "✅ 设置已保存");
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
        a.showToast("🗑️ 已清除本地 API Key");
        renderCurrentSurface();
      };
    }

    // Roleplay controls
    const rpSelect = container.querySelector("#oc-rp-select");
    if (rpSelect) {
      rpSelect.onchange = (e) => {
        stopAll();
        revokeRoleplayClips();
        coachState.roleplayDlgId = e.target.value;
        coachState.roleplayTurnIdx = 0;
        coachState.rpRevealed = false;
        coachState.ftActive = false;
        coachState.ftResult = null;
        coachState.result = null;
        coachState.selectedChunkIdx = null;
        coachState.aiResult = null;
        coachState.phase = "idle";
        coachState.statusText = "";
        renderCurrentSurface();
      };
    }

    const tRpRecall = container.querySelector("#oc-toggle-rp-recall");
    if (tRpRecall) {
      tRpRecall.onclick = () => {
        coachState.rpRecallMode = !coachState.rpRecallMode;
        coachState.rpRevealed = false;
        renderCurrentSurface();
      };
    }

    const btnRpReveal = container.querySelector("#oc-btn-rp-reveal");
    if (btnRpReveal) {
      btnRpReveal.onclick = () => {
        coachState.rpRevealed = true;
        renderCurrentSurface();
      };
    }

    const btnRpMix = container.querySelector("#oc-btn-rp-playmix");
    if (btnRpMix && item && item.dialogue) {
      btnRpMix.onclick = () => playFullRoleplayMix(item.dialogue);
    }

    container.querySelectorAll("[data-rpturn]").forEach((el) => {
      el.onclick = () => {
        stopAll();
        coachState.roleplayTurnIdx = Number(el.dataset.rpturn) || 0;
        coachState.rpRevealed = false;
        coachState.result = null;
        coachState.selectedChunkIdx = null;
        coachState.aiResult = null;
        coachState.phase = "idle";
        coachState.statusText = "";
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
        coachState.rpRevealed = false;
        coachState.result = null;
        coachState.selectedChunkIdx = null;
        coachState.phase = "idle";
        coachState.statusText = "";
        renderCurrentSurface();
      };
    }
    const btnRpSkip = container.querySelector("#oc-btn-rp-skip");
    if (btnRpSkip) btnRpSkip.onclick = () => advanceToNextItem(false);

    // Roleplay Free-Talk Follow-up Events
    const btnFtStart = container.querySelector("#oc-btn-ft-start");
    if (btnFtStart && item && item.dialogue) {
      btnFtStart.onclick = () => {
        stopAll();
        const fq = getFollowupForDialogue(item.dialogue);
        coachState.ftActive = true;
        coachState.ftQuestion = fq;
        coachState.ftPhase = "idle";
        coachState.ftShowCn = false;
        coachState.ftHeard = "";
        coachState.ftResult = null;
        coachState.ftAiResult = null;
        coachState.ftAiError = "";
        renderCurrentSurface();
        a.speakJapanese(fq.jp, 1.0);
      };
    }

    const btnFtPlay = container.querySelector("#oc-btn-ft-play");
    if (btnFtPlay && item && item.dialogue) {
      btnFtPlay.onclick = () => {
        const fq = coachState.ftQuestion || getFollowupForDialogue(item.dialogue);
        a.speakJapanese(fq.jp, 1.0);
      };
    }

    const btnFtCn = container.querySelector("#oc-btn-ft-cn");
    if (btnFtCn) {
      btnFtCn.onclick = () => {
        coachState.ftShowCn = !coachState.ftShowCn;
        renderCurrentSurface();
      };
    }

    const btnFtClose = container.querySelector("#oc-btn-ft-close");
    if (btnFtClose) {
      btnFtClose.onclick = () => {
        stopAll();
        coachState.ftActive = false;
        coachState.ftPhase = "idle";
        renderCurrentSurface();
      };
    }

    const btnFtMic = container.querySelector("#oc-btn-ft-mic");
    if (btnFtMic && item && item.dialogue) {
      btnFtMic.onclick = () => {
        stopAll();
        const mySession = coachState.captureSessionId;
        const fq = coachState.ftQuestion || getFollowupForDialogue(item.dialogue);
        playCueChime("start");
        coachState.preListenTimer = setTimeout(() => {
          if (mySession === coachState.captureSessionId) startFreeTalkRecording(fq, item.dialogue.context);
        }, 280);
      };
    }

    const btnFtFinish = container.querySelector("#oc-btn-ft-finish");
    if (btnFtFinish) {
      btnFtFinish.onclick = () => { if (coachState._ftManualFinish) coachState._ftManualFinish(); };
    }

    container.querySelectorAll(".oc-ft-sample-play").forEach((b) => {
      b.onclick = () => {
        const idx = Number(b.dataset.ftsample);
        const fq = coachState.ftQuestion || (item && item.dialogue && getFollowupForDialogue(item.dialogue));
        const sr = fq && fq.sampleReplies && fq.sampleReplies[idx];
        if (sr) a.speakJapanese(sr.jp, 1.0, b);
      };
    });

    const btnFtAiReplyPlay = container.querySelector("#oc-btn-ft-ai-reply-play");
    if (btnFtAiReplyPlay && coachState.ftAiResult && coachState.ftAiResult.staffReplyJp) {
      btnFtAiReplyPlay.onclick = () => a.speakJapanese(coachState.ftAiResult.staffReplyJp, 1.0, btnFtAiReplyPlay);
    }

    // Normal prev / next
    const btnPrev = container.querySelector("#oc-btn-prev");
    if (btnPrev) {
      btnPrev.onclick = () => {
        stopAll();
        coachState.result = null;
        coachState.selectedChunkIdx = null;
        coachState.aiResult = null;
        coachState.aiError = "";
        coachState.phase = "idle";
        coachState.statusText = "";
        coachState.rpRevealed = false;
        revokeUserAudioUrl();
        coachState.userBlob = null;
        if (coachState.deck === "roleplay" && item && item.dialogue) {
          const len = item.dialogue.turns.length;
          coachState.roleplayTurnIdx = (coachState.roleplayTurnIdx - 1 + len) % len;
        } else {
          const list = getFilteredDeckItems(coachState.deck);
          if (list.length > 0) coachState.index = (coachState.index - 1 + list.length) % list.length;
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
    coachState.selectedChunkIdx = null;
    coachState.aiResult = null;
    coachState.aiError = "";
    revokeUserAudioUrl();
    coachState.userBlob = null;

    const body = a.openModalHtml(`<div id="oc-quick-modal-root"></div>`);
    if (body) renderQuickModalBody(body.querySelector("#oc-quick-modal-root"));
  }

  function openRoleplayDialogue(dlgId) {
    stopAll();
    revokeRoleplayClips();
    coachState.isModalOpen = false;
    coachState.modalItem = null;
    coachState.deck = "roleplay";
    coachState.roleplayDlgId = dlgId;
    coachState.roleplayTurnIdx = 0;
    coachState.rpRevealed = false;
    coachState.ftActive = false;
    coachState.ftResult = null;
    coachState.result = null;
    coachState.selectedChunkIdx = null;
    coachState.aiResult = null;
    coachState.phase = "idle";
    coachState.statusText = "";
    revokeUserAudioUrl();
    coachState.userBlob = null;
  }

  function handleKeydown(e) {
    if (coachState.isModalOpen) return;
    const item = getActiveItem();
    if (!item) return;

    if (e.code === "Space") {
      e.preventDefault();
      if (coachState.ftPhase === "listening" && coachState._ftManualFinish) coachState._ftManualFinish();
      else if (coachState.phase === "listening" && coachState._manualFinish) coachState._manualFinish();
      else if (coachState.phase === "model_playing") stopAll();
      else if (coachState.deck === "roleplay" && item.speaker !== "us") runRoleplayPartnerTurn(item);
      else {
        coachState.shadowLoopStage = 0;
        startGuidedPractice(item, coachState.shadowLoop ? 0.84 : null);
      }
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

  function renderWeaknessRadarInto(radarEl, oralStats) {
    if (!radarEl) return;
    const profile = computeWeaknessProfile(oralStats);
    const hasHistory = profile.length > 0;
    const chips = hasHistory
      ? profile.slice(0, 4).map((p) => ({
          key: p.key,
          label: `${p.icon} ${p.label} ×${p.count}`
        }))
      : [
          { key: "sokuon", label: "⏸️ 促音(っ)特训" },
          { key: "long_vowel", label: "〰️ 长音(ー)特训" },
          { key: "voicing", label: "🔔 清浊音特训" },
          { key: "consonant", label: "👄 ら行/つ口型" }
        ];

    radarEl.innerHTML = `
      <div class="oc-weakness-radar">
        <span class="oc-radar-title">${hasHistory ? "🎯 个人发音薄弱雷达（点击专注特训）：" : "🎯 核心专项特训入口："}</span>
        <div class="oc-radar-chips">
          ${chips
            .map(
              (c) => `<button type="button" class="oc-radar-chip ${coachState.issueFocus === c.key ? "active" : ""}" data-ocfocus="${c.key}">${c.label}</button>`
            )
            .join("")}
        </div>
      </div>
    `;

    radarEl.querySelectorAll("[data-ocfocus]").forEach((btn) => {
      btn.onclick = () => {
        stopAll();
        const k = btn.dataset.ocfocus;
        coachState.issueFocus = coachState.issueFocus === k ? null : k;
        if (coachState.issueFocus && (coachState.deck === "roleplay" || coachState.deck === "weak")) {
          coachState.deck = "phrases";
        }
        coachState.index = 0;
        coachState.result = null;
        coachState.selectedChunkIdx = null;
        coachState.phase = "idle";
        coachState.statusText = "";
        renderCurrentSurface();
      };
    });
  }

  function renderHeroStatsInto(el) {
    const a = app();
    if (!el || !a) return;
    const oralStats = (a.state && a.state.oralStats) || {};
    const entries = Object.values(oralStats).filter((x) => x && typeof x.bestScore === "number");
    const passed = entries.filter((x) => x.bestScore >= 80).length;
    const weak = entries.filter((x) => x.bestScore < 80).length;
    const totalAttempts = entries.reduce((sum, x) => sum + (x.attempts || 0), 0);
    const avgBest = entries.length ? Math.round(entries.reduce((sum, x) => sum + x.bestScore, 0) / entries.length) : null;

    el.innerHTML = `
      <div class="dash-metric">
        <div class="dm-top"><span>✅ 口语达标 (≥80分)</span><strong style="color:var(--accent-emerald);">${passed} 句</strong></div>
        <div style="font-size:0.72rem;color:var(--text-muted);margin-top:0.18rem;">已评测总句数：${entries.length}</div>
      </div>
      <div class="dash-metric ${weak > 0 ? "oc-metric-clickable" : ""}" id="oc-hero-weak-jump">
        <div class="dm-top"><span>🔥 待复训薄弱句</span><strong style="color:${weak > 0 ? "#d97706" : "var(--accent-emerald)"};">${weak} 句</strong></div>
        <div style="font-size:0.72rem;color:var(--text-muted);margin-top:0.18rem;">${weak > 0 ? "点击专注复训 &lt;80分 句子" : "继续保持，暂无薄弱句！"}</div>
      </div>
      <div class="dash-metric">
        <div class="dm-top"><span>🎯 累计开口次数</span><strong>${totalAttempts} 次</strong></div>
        <div style="font-size:0.72rem;color:var(--text-muted);margin-top:0.18rem;">支持长句换气停顿不断麦</div>
      </div>
      <div class="dash-metric">
        <div class="dm-top"><span>📊 历史平均最佳</span><strong>${avgBest !== null ? `${avgBest} 分` : "待测"}</strong></div>
        <div style="font-size:0.72rem;color:var(--text-muted);margin-top:0.18rem;">涵盖促音 · 长音 · 清浊 · 节奏</div>
      </div>
    `;

    renderWeaknessRadarInto(document.getElementById("oral-weakness-radar"), oralStats);

    const weakCard = el.querySelector("#oc-hero-weak-jump");
    if (weakCard && weak > 0) {
      weakCard.onclick = () => {
        stopAll();
        coachState.deck = "weak";
        coachState.index = 0;
        coachState.result = null;
        coachState.selectedChunkIdx = null;
        coachState.phase = "idle";
        coachState.statusText = "";
        renderStudio(document.getElementById("oral-coach-stage"));
      };
    }
  }

  function renderDedicatedView(container) {
    if (!container) return;
    const a = app();
    if (!a) return;
    const todayStr = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}-${String(new Date().getDate()).padStart(2, "0")}`;
    const todayCount = a.state.streak.todayDate === todayStr ? a.state.streak.todayCount || 0 : 0;

    container.innerHTML = `
      <div class="learning-hero-card">
        <div class="learning-hero-top">
          <div>
            <h2 class="itin-section-title">🎙️ 日语口语跟读与发音私教</h2>
            <p class="itin-section-sub">示范朗读 → 提示音后自动开麦跟读（长句中间换气不会打断）→ 拍数逐词纠音 → 原声与自录对比，支持 27 组情景对话角色扮演！</p>
          </div>
          <div class="dash-streak-badge">
            <div style="font-size:1.35rem;font-weight:900;">🔥 ${a.state.streak.count || 0} 天</div>
            <div style="font-size:0.72rem;opacity:0.9;">今日已完成 ${todayCount} 题/卡</div>
          </div>
        </div>
        <div class="dash-metrics-grid oc-hero-stats" id="oral-hero-stats"></div>
        <div id="oral-weakness-radar"></div>
      </div>

      <div id="oral-coach-stage"></div>
    `;

    renderHeroStatsInto(document.getElementById("oral-hero-stats"));
    renderStudio(document.getElementById("oral-coach-stage"));
  }

  if (typeof document !== "undefined" && document.addEventListener) {
    document.addEventListener("keydown", (e) => {
      const a = app();
      if (!a || !a.state || a.state.appMode !== "oral") return;
      const modal = document.getElementById("app-modal");
      if (modal && modal.classList.contains("open")) return;
      const tag = (e.target && e.target.tagName) || "";
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (e.target && e.target.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      handleKeydown(e);
    });
  }

  // Deterministic evaluation & studio preview helpers for automated verification
  function _testEvaluate(targetJp, heardOrAlts, nativeMs = 0, userMs = 0) {
    return evaluateOralAttempt(targetJp, heardOrAlts, nativeMs, userMs);
  }

  function _testCombineHypotheses(committedSegments, currentFinalSegments, interim = "") {
    return buildCombinedHypotheses(committedSegments, currentFinalSegments, interim);
  }

  function _testPitchContour(rawJp) {
    return analyzeMoraPitchContour(rawJp);
  }

  function _testWeaknessProfile(oralStats) {
    return computeWeaknessProfile(oralStats);
  }

  function _testDeckInfo(deckName, opts = {}) {
    const prevAll = coachState.includeAllExamples;
    const prevFocus = coachState.issueFocus;
    const prevFilter = coachState.deckFilter;
    try {
      if (typeof opts.includeAllExamples === "boolean") coachState.includeAllExamples = opts.includeAllExamples;
      if ("issueFocus" in opts) coachState.issueFocus = opts.issueFocus;
      if ("deckFilter" in opts) coachState.deckFilter = opts.deckFilter;
      const items = getFilteredDeckItems(deckName);
      return { count: items.length, firstId: items[0] ? items[0].id : null, sampleJp: items.slice(0, 3).map((x) => x.jp) };
    } finally {
      coachState.includeAllExamples = prevAll;
      coachState.issueFocus = prevFocus;
      coachState.deckFilter = prevFilter;
    }
  }

  function _testFreeTalkOffline(modNumber, heardRaw) {
    const q = ROLEPLAY_FOLLOWUPS[modNumber] || ROLEPLAY_FOLLOWUPS.default;
    return evaluateFreeTalkOffline(q, heardRaw);
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
    renderDedicatedView,
    renderStudio,
    openQuickModal,
    openRoleplayDialogue,
    handleKeydown,
    stopAll() {
      coachState.isModalOpen = false;
      coachState.modalItem = null;
      coachState.handsFree = false;
      coachState.shadowLoop = false;
      coachState.shadowLoopStage = 0;
      coachState.rpMixPlaying = false;
      stopAll();
    },
    _testEvaluate,
    _testCombineHypotheses,
    _testShouldAutoStop: shouldAutoStopCapture,
    _testTailMatch: hasTargetEndingMatch,
    _testPitchContour,
    _testWeaknessProfile,
    _testDeckInfo,
    _testFreeTalkOffline,
    _testInjectResult
  };
})();
