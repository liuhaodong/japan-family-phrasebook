"""Veteran Japanese Sensei 6-Track, 16-Lesson Progressive Syllabus (N5 -> N3 Spoken Mastery)."""

from __future__ import annotations

from typing import Any, Dict, List, Optional

SENSEI_TRACKS: List[Dict[str, str]] = [
    {"id": "track_sound", "title": "Track 1 · 声音与拍节地基", "desc": "长音促音最小对立与东京高低音调"},
    {"id": "track_particle", "title": "Track 2 · 中文母语者最易错核心助词", "desc": "彻底建立 は/が、に/で、を 的日语语感"},
    {"id": "track_verb", "title": "Track 3 · 动词活用口语肌肉记忆", "desc": "て形/ない形/可能形/〜てみる/〜ておく 闪电反应"},
    {"id": "track_flow", "title": "Track 4 · 日本人每天说100遍的社交润滑剂", "desc": "相槌接话、〜んです、委婉拒绝与授受视角"},
    {"id": "track_narrative", "title": "Track 5 · 从单句走向成段叙事与观点", "desc": "经历、周末安排、观点表达与年轻人口语缩略"},
    {"id": "track_register", "title": "Track 6 · 社会语域切换与进阶听力", "desc": "礼貌体/简体秒切与职场服务敬语解码"},
]

SENSEI_LESSONS: List[Dict[str, Any]] = [
    {
        "id": "S01_mora_minimal_pairs",
        "order": 1,
        "trackId": "track_sound",
        "trackTitle": "Track 1 · 声音与拍节地基",
        "level": "N5",
        "title": "第1课 · 长音与促音的生死线",
        "subtitle": "おばさん(阿姨) vs おばあさん(奶奶) · きて vs きって",
        "grammarFocus": "长音（伸ばす音）一拍变两拍，促音（っ）闭气停顿半拍不发声",
        "cnPitfall": "中文没有「节拍等长」概念，常把长音念短、把促音直接跳过，导致把「阿姨」喊成「奶奶」、把「请来」听成「邮票」。",
        "keyPatterns": ["おばあさん / おばさん", "きって（切手）vs きて（来て）", "いっぱい（一杯）vs いぱい"],
        "everydayContexts": ["邻居打招呼", "咖啡店点单", "日常闲聊"],
        "blackboard": {
            "titleCn": "长音与促音：日语等时节拍的第一课",
            "grammarPoint": "モーラ（音拍）等长原则",
            "formulaJp": "お・ば・あ・さ・ん（5拍） ≠ お・ば・さ・ん（4拍）｜ き・っ・て（3拍）",
            "cnPitfallCn": "「っ」不是发不出音，而是声带憋住一整拍再爆破后面的 t/k/p/s 辅音；长音必须拉满完整两拍。",
            "contrastBadJp": "さき コーヒー いぱい のみました。",
            "contrastGoodJp": "さっき コーヒーを いっぱい 飲みました。",
            "contrastNoteCn": "「さっき(刚才)」和「いっぱい(满满一杯)」漏掉促音就听不清意思了。",
        },
        "fallbackSteps": [
            {
                "stage": "WARMUP",
                "stageLabel": "1. 热身唤醒",
                "hideTarget": False,
                "targetJp": "おばあさんは 元気ですね。",
                "targetCn": "奶奶精神真好呀。（注意 おばあさん 拖满五拍！）",
                "cueCn": "热身区分 4 拍与 5 拍长音，读准「おばあさん」。",
                "tipCn": "ば 后面的 あ 轻轻拉长一整拍。",
                "teacherPrompt": "今天是我们体系课第一课，先攻克中国学生最容易混淆的长音。跟我一起拉开两拍读，おばあさんは 元気ですね。",
            },
            {
                "stage": "TEACH",
                "stageLabel": "2. 核心微课",
                "hideTarget": False,
                "targetJp": "さっき コーヒーを いっぱい 飲みました。",
                "targetCn": "我刚才喝了一大杯咖啡。",
                "cueCn": "感受一句里连续出现促音「さっき・いっぱい」与长音「コーヒー」的弹跳节奏。",
                "tipCn": "さっき 和 いっぱい 都要在中间停半拍憋气再爆破。",
                "teacherPrompt": "听我示范这句日常咖啡对话，注意「さっき」和「いっぱい」中间的停顿，さっき コーヒーを いっぱい 飲みました。",
            },
            {
                "stage": "CONTROLLED_DRILL",
                "stageLabel": "3. 节奏镜子",
                "hideTarget": False,
                "targetJp": "ちょっと 待ってください、切手を 買います。",
                "targetCn": "请稍等一下，我去买邮票。",
                "cueCn": "连续三个促音：ちょっと・待って・切手（きって）。",
                "tipCn": "切手（きって）是邮票，不能读成 きいて（听）。",
                "teacherPrompt": "这句有三个促音连击，很考验基本功。试着匀速打拍子读给我听，ちょっと 待ってください、切手を 買います。",
            },
            {
                "stage": "TRANSFORM_DRILL",
                "stageLabel": "4. 口头对比变音",
                "hideTarget": True,
                "targetJp": "日曜日は ゆっくり 休みたいです。",
                "targetCn": "周日我想好好地、慢悠悠地休息一下。",
                "cueCn": "用带促音副词「ゆっくり（慢悠悠地）」口头造句：周日我想好好休息。",
                "tipCn": "ゆっくり ＋ 休みたい（やすみたい）です。",
                "teacherPrompt": "不看答案挑战一下！「ゆっくり」中间有个促音，用日语对我说：周日我想好好休息一下。",
            },
            {
                "stage": "SUBSTITUTION_DRILL",
                "stageLabel": "5. 情景替换",
                "hideTarget": True,
                "targetJp": "朝ごはんは もう いっぱいです。",
                "targetCn": "早饭已经吃得饱饱的了。",
                "cueCn": "用「もう〜いっぱいです」表达：肚子已经很饱了。",
                "tipCn": "お腹（おなか）が いっぱいです 也可以。",
                "teacherPrompt": "好，朋友问你要不要再来一块面包，用今天学的促音词「いっぱい」告诉他：我已经饱啦。",
            },
            {
                "stage": "FREE_OUTPUT",
                "stageLabel": "6. 私教自由问答",
                "hideTarget": True,
                "questionJp": "さっき 朝ごはんか コーヒー、何か 飲みましたか。",
                "questionCn": "你刚才有吃早饭或者喝咖啡什么的吗？",
                "targetJp": "はい、さっき コーヒーを いっぱい 飲みました。",
                "targetCn": "（参考答法）嗯，我刚才喝了一杯咖啡。",
                "cueCn": "老师用日语问你刚才喝了/吃了什么，请用自己的话真实回答（尽量用上「さっき」或長音词）。",
                "tipCn": "可以自由回答 紅茶（こうちゃ）、お水（みず）等。",
                "teacherPrompt": "最后一关自由对话！我问你一句：さっき 朝ごはんか コーヒー、何か 飲みましたか。",
            },
        ],
    },
    {
        "id": "S02_pitch_contour",
        "order": 2,
        "trackId": "track_sound",
        "trackTitle": "Track 1 · 声音与拍节地基",
        "level": "N5",
        "title": "第2课 · 东京高低音调 core (平板 vs 头高)",
        "subtitle": "雨(あ＼め) vs 飴(あめ) · 箸(は＼し) vs 橋(はし＼)",
        "grammarFocus": "日语只有高音(H)和低音(L)两档阶梯，第一拍与第二拍高低必相反",
        "cnPitfall": "用中文四个声调念日语，特别是把所有词尾都读成降调（四声），听起来浓重外国腔。",
        "keyPatterns": ["平板型 L-H-H (あめが)", "头高型 H-L-L (あ＼めが)", "中高型 L-H-L (たま＼ご)"],
        "everydayContexts": ["聊天气下雨", "餐桌拿筷子", "日常名词发音"],
        "blackboard": {
            "titleCn": "告别中文四声：东京音调只有「高/低」两层台阶",
            "grammarPoint": "第1拍 ≠ 第2拍 黄金铁律",
            "formulaJp": "平板[0]：低→高→高（雨・会社） ｜ 头高[1]：高→低→低（雨・猫）",
            "cnPitfallCn": "一句话开头的「はい」「ちょっと」「今日」是高→低，而「会社」「私」「電車」是低→高并保持平顺！",
            "contrastBadJp": "きょう あめ が ふり ます。（每个字乱起伏）",
            "contrastGoodJp": "きょ＼うは あ＼めが ふりま＼す。",
            "contrastNoteCn": "只要把「高低阶梯」踩稳，句子立刻有东京播音腔。",
        },
    },
    {
        "id": "S03_wa_vs_ga",
        "order": 3,
        "trackId": "track_particle",
        "trackTitle": "Track 2 · 中文母语者最易错核心助词",
        "level": "N5",
        "title": "第3课 · 「は」vs「が」语感彻底通关",
        "subtitle": "已知话题大框架「は」 vs 聚光灯焦点/好恶「が」",
        "grammarFocus": "〜は（谈论某主题/对比） vs 〜が（喜欢/懂/有/眼前新发现）",
        "cnPitfall": "中文没有助词，常常所有主语一律乱用「は」，说出「私はコーヒーは好き」这种错句。",
        "keyPatterns": ["〜は〜が好きです", "〜がわかります / できます", "あ、バスが来ました！"],
        "everydayContexts": ["聊兴趣偏好", "办公室互相了解", "街上看到车来了"],
        "blackboard": {
            "titleCn": "「は」拉大幕布，「が」打聚光灯",
            "grammarPoint": "は（主题/对比） vs が（对象/新信息）",
            "formulaJp": "【主题】は ＋ 【好恶/能力/存在】が ＋ 好き / 上手 / ある / わかる",
            "cnPitfallCn": "「好き・嫌い・上手・わかる・できる・ある・いる」前面的对象一律用「が」，绝不能用「を」或再加「は」！",
            "contrastBadJp": "私は 日本語を 好きです。／ バスは 来ました！",
            "contrastGoodJp": "私は 日本語が 好きです。／ あ、バスが 来ました！",
            "contrastNoteCn": "眼前突然看到公交车开了过来，信息焦点的主角是「バス」，用「が」！",
        },
    },
    {
        "id": "S04_ni_vs_de",
        "order": 4,
        "trackId": "track_particle",
        "trackTitle": "Track 2 · 中文母语者最易错核心助词",
        "level": "N5",
        "title": "第4课 · 「に」vs「で」动作舞台与落脚点",
        "subtitle": "在咖啡馆工作(で) vs 咖啡馆在车站前(に)",
        "grammarFocus": "动作发生舞台用「で」，存在位置/移动终点/时间点用「に」",
        "cnPitfall": "中文一个「在」包打天下，导致「家でいます」「東京に住んでで」频频出错。",
        "keyPatterns": ["[场所]で [动作动词]", "[场所]に います / あります / 住んでいます", "[时间/工具] に vs で"],
        "everydayContexts": ["居家办公", "周末约咖啡馆", "聊居住与工作城市"],
        "blackboard": {
            "titleCn": "动起来用「で」，安静待着或到达终点用「に」",
            "grammarPoint": "场所助词 で vs に 核心分野",
            "formulaJp": "カフェ【で】仕事をする（动态舞台） ｜ 家【に】いる（静态存在）",
            "cnPitfallCn": "特例注意！「住む（居住）」「勤める（任职）」虽然像状态，但属于长期扎根落脚点，固定配「に」（東京に住んでいます）。",
            "contrastBadJp": "今日 私は カフェに 仕事を します。",
            "contrastGoodJp": "今日 私は カフェで 仕事を します。",
            "contrastNoteCn": "「仕事をする」是具体动作，发生舞台用「で」！",
        },
    },
    {
        "id": "S05_wo_kara_made",
        "order": 5,
        "trackId": "track_particle",
        "trackTitle": "Track 2 · 中文母语者最易错核心助词",
        "level": "N5",
        "title": "第5课 · 「を」的隐藏移动用法与「から/まで」",
        "subtitle": "穿过公园(公園を歩く) · 下电车(電車を降りる)",
        "grammarFocus": "「を」不仅接宾语，也表示移动动词「经过/离开」的空间",
        "cnPitfall": "习惯把「下电车」「穿过马路」说成「電車から降りる / 道に歩く」，母语者其实常用「を」。",
        "keyPatterns": ["公園を散歩する", "電車を降りる", "家を9時に出る"],
        "everydayContexts": ["早上通勤出门", "周末散步", "换乘下车"],
    },
    {
        "id": "S06_te_form_fluency",
        "order": 6,
        "trackId": "track_verb",
        "trackTitle": "Track 3 · 动词活用口语肌肉记忆",
        "level": "N5",
        "title": "第6课 · 「て形」闪电变形与动作串联",
        "subtitle": "一秒说出 待って / 書いて / 飲んで / 話して",
        "grammarFocus": "一类/二类/三类动词て形直觉反应 + 动作先后串联「〜て、〜ます」",
        "cnPitfall": "脑子里想「い・ち・り 促音变」要花 3 秒，说话时全卡住；其实按高频词组直接练成口腔反射最快。",
        "keyPatterns": ["起きて→飲んで→出かけます", "〜ています（正在/状态）", "〜てもいいですか"],
        "everydayContexts": ["早起生活习惯", "做饭步骤", "上班日常流水账"],
    },
    {
        "id": "S07_nai_ta_plain",
        "order": 7,
        "trackId": "track_verb",
        "trackTitle": "Track 3 · 动词活用口语肌肉记忆",
        "level": "N4",
        "title": "第7课 · 「ない形・た形」与客观说明「〜ので」",
        "subtitle": "不会做 / 没喝 / 已经看过了 · 比「から」更温柔的理由",
        "grammarFocus": "简体否定「〜ない」与过去「〜た」的转换 + 礼貌解释理由「〜ので」",
        "cnPitfall": "一出口全是「〜ませんから」，在日本人耳里「から」带主观强硬感；解释原因请求体谅时多用「〜ので / 〜んです」。",
        "keyPatterns": ["食べない / 飲まない / 来ない", "〜ないでください", "〜ので、ちょっと…"],
        "everydayContexts": ["婉拒聚餐晚到", "生活习惯说明", "和同事交代进度"],
    },
    {
        "id": "S08_potential_and_try",
        "order": 8,
        "trackId": "track_verb",
        "trackTitle": "Track 3 · 动词活用口语肌肉记忆",
        "level": "N4",
        "title": "第8课 · 可能形 +「〜てみる」+「〜ておく」三连击",
        "subtitle": "做得到 · 试着做做看 · 提前准备好",
        "grammarFocus": "可能动词（食べられる/話せる）与高频补助动词 〜てみる / 〜ておく",
        "cnPitfall": "表达「我试试看」「我提前查一下」时直译用「試す・準備する」，其实日本人口语几乎全用「〜てみます」「調べておきます」。",
        "keyPatterns": ["[可能形]が 話せます / 作れます", "やってみます（我试试）", "予約しておきます（提前约好）"],
        "everydayContexts": ["学做新菜", "工作提前准备", "尝试新事物"],
    },
    {
        "id": "S09_aizuchi_and_ndesu",
        "order": 9,
        "trackId": "track_flow",
        "trackTitle": "Track 4 · 日本人每天说100遍的社交润滑剂",
        "level": "N4",
        "title": "第9课 · 地道接话「相槌」与解释语气「〜んです」",
        "subtitle": "へえ、そうなんですか！ · 其实呢，是因为…「〜んです」",
        "grammarFocus": "口语自然共情回应 + 用「〜んです」让干瘪陈述句瞬间充满人情味",
        "cnPitfall": "中文直接回答「仕事が忙しいです」听起来像冷冰冰汇报；加上「んです」才像在跟真人交流。",
        "keyPatterns": ["なるほど・たしかに・すごいですね", "実は〜なんです", "どうして〜んですか？"],
        "everydayContexts": ["朋友闲聊近况", "互相解释原因", "咖啡厅聊生活"],
    },
    {
        "id": "S10_cushion_and_soft_refusal",
        "order": 10,
        "trackId": "track_flow",
        "trackTitle": "Track 4 · 日本人每天说100遍的社交润滑剂",
        "level": "N4",
        "title": "第10课 · 日式缓冲语与不伤人的委婉拒绝",
        "subtitle": "「〜んですけど」「ちょっと…」「せっかくですが」",
        "grammarFocus": "开场铺垫「すみませんが〜んですけど」与留余地的拒绝表达",
        "cnPitfall": "直接说「いいえ、無理です / 嫌です」在日语社交里会显得极具攻击性；学会留半句悬念才是高级流畅。",
        "keyPatterns": ["ちょっと用事があって…", "せっかくですが、今日はちょっと…", "また今度ぜひ！"],
        "everydayContexts": ["推掉额外加班或聚会", "请同事帮忙前铺垫", "礼貌改期"],
    },
    {
        "id": "S11_giving_receiving",
        "order": 11,
        "trackId": "track_flow",
        "trackTitle": "Track 4 · 日本人每天说100遍的社交润滑剂",
        "level": "N4",
        "title": "第11课 · 彻底攻克「あげる・もらう・くれる」视角",
        "subtitle": "谁给了谁？别人帮了我，一定要用「くれる / もらう」！",
        "grammarFocus": "授受动词的方向与恩惠感（〜てくれる / 〜てもらう / 〜てあげる）",
        "cnPitfall": "中国学生最大难点：不管谁帮谁都想用「あげる」，或者分不清「友だちが教えてくれた」和「友だちに教えてもらった」。",
        "keyPatterns": ["友だちが写真を送ってくれました", "先生に直してもらいました", "子どもに絵本を読んであげます"],
        "everydayContexts": ["同事帮忙修改文件", "朋友送礼物推荐餐厅", "给孩子讲故事"],
    },
    {
        "id": "S12_experience_and_listing",
        "order": 12,
        "trackId": "track_narrative",
        "trackTitle": "Track 5 · 从单句走向成段叙事与观点",
        "level": "N4",
        "title": "第12课 · 聊周末与经历：串联过去与遗憾「〜てしまう」",
        "subtitle": "〜たことがある · 〜たり〜たり · 不小心做完了 〜てしまう",
        "grammarFocus": "用三件套把干巴巴的「周末我看了电影」变成有画面感的 3 句话叙事",
        "cnPitfall": "只会用「〜と〜をしました」罗列，不会用「〜たり〜たりしました」体现周末轻松感，也不会用「忘れちゃった」表达懊恼。",
        "keyPatterns": ["〜たことがあります", "本を読んだり、散歩したりしました", "うっかり忘れてしまいました"],
        "everydayContexts": ["周一聊周末怎么过", "回忆难忘经历", "吐槽小迷糊瞬间"],
    },
    {
        "id": "S13_opinions_and_smalltalk",
        "order": 13,
        "trackId": "track_narrative",
        "trackTitle": "Track 5 · 从单句走向成段叙事与观点",
        "level": "N3",
        "title": "第13课 · 优雅表达观点与传闻「と思います・みたいです」",
        "subtitle": "我觉得不错 · 好像快下雨了 · 难得来一次「せっかくなので」",
        "grammarFocus": "普通形＋と思います / みたいです / そうです（外观/传闻），让语言有层次",
        "cnPitfall": "把个人主观判断直接说成「これは高いです（绝对事实）」，缺少日本人常用的缓冲后缀「〜と思います」。",
        "keyPatterns": ["〜と思います / 思っています", "〜みたいです / らしいです", "せっかく〜なので"],
        "everydayContexts": ["讨论电影或AI产品", "看天气猜是否下雨", "聊工作想法"],
    },
    {
        "id": "S14_casual_contractions",
        "order": 14,
        "trackId": "track_narrative",
        "trackTitle": "Track 5 · 从单句走向成段叙事与观点",
        "level": "N3",
        "title": "第14课 · 日剧与日常真人口语缩略「〜てる・〜ちゃう・〜なきゃ」",
        "subtitle": "听懂日本人真实语速，脱掉「课本腔」",
        "grammarFocus": "ている→てる、てしまう→ちゃう/じゃう、なければならない→なきゃ、ておく→とく",
        "cnPitfall": "课本只教「行かなければなりません」，但东京朋友与日剧里全说「もう行かなきゃ！」结果听不懂也接不上。",
        "keyPatterns": ["何してるの？", "全部食べちゃった！", "そろそろ帰らなきゃ"],
        "everydayContexts": ["和日本朋友聊天", "哄孩子吃饭出门", "自言自语"],
    },
    {
        "id": "S15_polite_vs_casual",
        "order": 15,
        "trackId": "track_register",
        "trackTitle": "Track 6 · 社会语域切换与进阶听力",
        "level": "N3",
        "title": "第15课 · 同一句话说两遍：敬体「です/ます」与简体秒切",
        "subtitle": "对新同事有分寸 vs 对家人好朋友零距离",
        "grammarFocus": "在真实对话里根据对象即时切换文体、句尾助词「ね/よ/よね」与疑问升降调",
        "cnPitfall": "对熟人一直用「〜ますか」显得生分，对陌生人突然甩简体又冒犯；核心是训练大脑毫秒级双轨切换。",
        "keyPatterns": ["今日暇ですか？ ⇄ 今日暇？", "とても楽しかったです ⇄ めっちゃ楽しかった！", "〜よね（共鸣确认）"],
        "everydayContexts": ["公司茶水间 vs 回家陪妻子女儿", "约朋友吃饭"],
    },
    {
        "id": "S16_keigo_real_life",
        "order": 16,
        "trackId": "track_register",
        "trackTitle": "Track 6 · 社会语域切换与进阶听力",
        "level": "N3",
        "title": "第16课 · 社会高频敬语听辨与得体应对实战",
        "subtitle": "お伺いします · かしこまりました · 恐れ入りますが",
        "grammarFocus": "听懂对方尊敬语/自谦语的核心动作，自己用温和礼貌体「〜と申します / 〜ていただけますか」稳稳接住",
        "cnPitfall": "中国学生常想背全套最高级敬语，反而结巴出错；资深老师做法是「耳朵听懂复杂敬语，嘴巴说出干净自谦＋ます形」。",
        "keyPatterns": ["いらっしゃいます / ご覧になります", "かしこまりました / お預かりします", "恐れ入りますが、もう一度お願いします"],
        "everydayContexts": ["商务会面与前台接待", "餐厅电话预约", "百货售后服务"],
    },
]

_LESSONS_BY_ID: Dict[str, Dict[str, Any]] = {l["id"]: l for l in SENSEI_LESSONS}


def get_syllabus_lesson(lesson_id: Optional[str]) -> Optional[Dict[str, Any]]:
    if not lesson_id:
        return None
    return _LESSONS_BY_ID.get(lesson_id.strip())


def get_syllabus_overview(
    progress_map: Dict[str, Dict[str, Any]],
    jlpt_target: str = "N4",
) -> Dict[str, Any]:
    """Build grouped tracks, progress status badges, and next recommended lesson."""
    enriched_lessons: List[Dict[str, Any]] = []
    recommended: Optional[Dict[str, Any]] = None
    completed_count = 0

    for lesson in SENSEI_LESSONS:
        prog = progress_map.get(lesson["id"]) or {}
        status = prog.get("status") or "not_started"
        best_score = int(prog.get("best_score") or 0)
        attempts = int(prog.get("attempts") or 0)
        if status == "completed":
            completed_count += 1

        entry = {
            "id": lesson["id"],
            "order": lesson["order"],
            "trackId": lesson["trackId"],
            "trackTitle": lesson["trackTitle"],
            "level": lesson["level"],
            "title": lesson["title"],
            "subtitle": lesson["subtitle"],
            "grammarFocus": lesson["grammarFocus"],
            "cnPitfall": lesson["cnPitfall"],
            "keyPatterns": lesson["keyPatterns"],
            "status": status,
            "bestScore": best_score,
            "attempts": attempts,
        }
        enriched_lessons.append(entry)
        if recommended is None and status != "completed":
            recommended = entry

    if recommended is None and enriched_lessons:
        recommended = enriched_lessons[0]

    tracks_out: List[Dict[str, Any]] = []
    for tr in SENSEI_TRACKS:
        tr_lessons = [l for l in enriched_lessons if l["trackId"] == tr["id"]]
        tracks_out.append({**tr, "lessons": tr_lessons})

    return {
        "jlptTarget": jlpt_target,
        "totalCount": len(SENSEI_LESSONS),
        "completedCount": completed_count,
        "recommendedLesson": recommended,
        "tracks": tracks_out,
        "lessons": enriched_lessons,
    }
