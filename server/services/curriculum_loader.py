"""Loads existing frontend curriculum JS data into Python for Sensei lessons, roleplay & glossing."""

from __future__ import annotations

import json
import re
import subprocess
from pathlib import Path
from typing import Any, Dict, List, Optional

from server.config import CURRICULUM_SNAPSHOT_PATH, REPO_ROOT

_DATA_FILES = [
    "data/itinerary.js",
    "data/modules_1_to_6.js",
    "data/modules_7_to_12.js",
    "data/modules_13_to_18.js",
    "data/verbs_top200.js",
    "data/grammar_n5_n3.js",
    "data/video_grammar.js",
]

_FURIGANA_RE = re.compile(r"[（(]([^()（）]+)[）)]")

DAILY_SCENARIOS: List[Dict[str, Any]] = [
    {
        "id": "daily_konbini",
        "number": 101,
        "title": "便利店结账与加热便当",
        "enTitle": "Konbini Checkout & Heating",
        "icon": "🏪",
        "legs": ["日常"],
        "summary": "店员超快语速提问：是否加热便当、要不要塑料袋、积分卡与热餐具。",
        "persona": "日本7-11或Lawson夜间店员，语速偏自然，常用敬语「お弁当温めますか」「袋お付けしますか」。",
        "starter_jp": "いらっしゃいませ！お弁当、温めますか？袋はご利用ですか？",
        "starter_cn": "欢迎光临！便当需要帮您加热吗？需要塑料袋吗？",
        "phrases": [
            {"id": "dk-1", "jp": "温（あたた）めてお願（ねが）いします。", "cn": "请帮我加热一下。", "tip": "「温めて」注意促音与て形连读。"},
            {"id": "dk-2", "jp": "袋（ふくろ）は大丈夫（だいじょうぶ）です、マイバッグがあります。", "cn": "不用袋子了，我自带了环保袋。", "tip": "在便利店拒绝袋子最地道自然的表达是「大丈夫です」或「結構です」。"},
            {"id": "dk-3", "jp": "お箸（はし）を二膳（にぜん）いただけますか。", "cn": "可以给我两双筷子吗？", "tip": "「〜ていただけますか」比「〜てください」更柔和礼貌。"},
        ],
    },
    {
        "id": "daily_cafe",
        "number": 102,
        "title": "东京咖啡馆点单与带娃入座",
        "enTitle": "Tokyo Cafe & Stroller Seating",
        "icon": "☕",
        "legs": ["日常"],
        "summary": "点冰美式/低因咖啡、询问宝宝椅、婴儿车停放位置、堂食或外带。",
        "persona": "表参道精品咖啡店年轻店员，温柔有礼，询问店内饮用还是外带、杯型及牛奶选择。",
        "starter_jp": "こんにちは！店内でお召し上がりですか？それともお持ち帰りですか？",
        "starter_cn": "您好！是在店内享用还是外带呢？",
        "phrases": [
            {"id": "dc-1", "jp": "店内（てんない）で、ベビーカーのまま入（はい）ってもいいですか。", "cn": "在店内用，可以推着婴儿车直接进去吗？", "tip": "「ベビーカーのまま」意为保持推车状态直接进入。"},
            {"id": "dc-2", "jp": "アイスラテのトールサイズを、オーツミルクに変更（へんこう）できますか。", "cn": "冰拿铁大杯可以换成燕麦奶吗？", "tip": "换奶用「〜に変更できますか」。"},
            {"id": "dc-3", "jp": "子（こ）ども用（よう）の椅子（いす）をお借（か）りできますか。", "cn": "可以借一张儿童座椅吗？", "tip": "「お借りできますか」是非常加分的尊敬自谦请求。"},
        ],
    },
    {
        "id": "daily_station",
        "number": 103,
        "title": "电车换乘问路与电梯查找",
        "enTitle": "Station Wayfinding & Elevator",
        "icon": "🚃",
        "legs": ["日常"],
        "summary": "携带两个娃与婴儿车，在东京复杂枢纽向站务员快速确认电梯、新干线检票口与特大行李区。",
        "persona": "JR山手线/新干线改札口站务员，认真热心、语速略快但咬字清晰。",
        "starter_jp": "はい、どうぞ！どちらのホームをお探しですか？",
        "starter_cn": "您好请问，您在找哪一侧站台呢？",
        "phrases": [
            {"id": "ds-1", "jp": "すみません、山手線（やまのてせん）のホームへ行（い）くエレベーターはどこですか。", "cn": "不好意思，去山手线站台的电梯在哪里？", "tip": "推婴儿车在东京必背问电梯句。"},
            {"id": "ds-2", "jp": "この電車（でんしゃ）は品川（しながわ）に停（と）まりますか。", "cn": "这班电车停品川站吗？", "tip": "注意区分快速/各停：用「停まりますか」。"},
            {"id": "ds-3", "jp": "ICカード（アイシーカード）にチャージしたいんですが、機械（きかい）はどちらですか。", "cn": "我想给交通卡充值，机器在哪个方向？", "tip": "「どこですか」升级为「どちらですか」更礼貌。"},
        ],
    },
    {
        "id": "daily_keigo_decode",
        "number": 104,
        "title": "日本店员超高频「敬语听力突击」",
        "enTitle": "Staff Keigo Listening & Reply",
        "icon": "🎧",
        "legs": ["进阶"],
        "summary": "专攻餐厅、酒店、百货店员高频尊敬语/自谦语（お預かりします・恐れ入りますが・少々お待ちください），听懂并秒回。",
        "persona": "东京高档百货/银座米其林餐厅侍应生，全程使用典型日式敬语表达，测试学生听懂后如何自然应对。",
        "starter_jp": "恐れ入りますが、お名前をお伺いしてもよろしいでしょうか。",
        "starter_cn": "实在抱歉打扰，方便请问一下您的贵姓大名吗？",
        "phrases": [
            {"id": "dkg-1", "jp": "予約（よやく）している劉（りゅう）と申（もう）します。二名（にめい）です。", "cn": "我是有预约的刘先生，两位。", "tip": "听到「お伺いしても」就是问你名字！直接报「〇〇と申します」。"},
            {"id": "dkg-2", "jp": "はい、よろしくお願（ねが）いいたします。", "cn": "好的，那就麻烦您了。", "tip": "对方说「少々お待ちください」或「ご案内いたします」时万能礼貌回应。"},
            {"id": "dkg-3", "jp": "すみません、もう少（すこ）しゆっくり言（い）っていただけますか。", "cn": "不好意思，您能稍微说慢一点吗？", "tip": "实战听不懂敬语时最体面的救场句！"},
        ],
    },
    {
        "id": "daily_friend",
        "number": 105,
        "title": "日本爸爸妈妈/滑雪教练日常闲聊",
        "enTitle": "Casual Chat with Japanese Parents",
        "icon": "💬",
        "legs": ["日常"],
        "summary": "脱离课本！用自然口语聊孩子年龄（6岁半Jinny & 2岁半Jaycie）、从旧金山来日本过35天假期、推荐美食。",
        "persona": "在轻井泽亲子休息区或芝公园偶遇的友善日本家长，说话带一点自然简体/普通体与「ね」「よ」语气词。",
        "starter_jp": "こんにちは！お子さん、とっても可愛いですね。今、何歳ですか？",
        "starter_cn": "你好呀！你家宝宝好可爱！现在几岁啦？",
        "phrases": [
            {"id": "df-1", "jp": "上（うえ）の子（こ）が六歳（ろくさい）半（はん）で、下（した）の子（こ）が二歳（にさい）半（はん）なんです。", "cn": "老大六岁半，老二两岁半。", "tip": "用「んです」收尾显得像真实日本父母聊天！"},
            {"id": "df-2", "jp": "アメリカから来（き）て、日本（にほん）に一ヶ月（いっかげつ）くらい滞在（たいざい）する予定（よてい）です。", "cn": "我们从美国过来的，打算在日本待一个月左右。", "tip": "「一ヶ月くらい滞在する予定です」自然地道。"},
            {"id": "df-3", "jp": "この近（ちか）くで、子連（こづ）れにおすすめのランチはありますか。", "cn": "这附近有没有适合带娃去吃的推荐午餐店？", "tip": "「子連れ（こづれ）」= 带娃，超实用旅游词！"},
        ],
    },
]

_CACHE: Optional[Dict[str, Any]] = None
_GLOSS_INDEX: Optional[Dict[str, Dict[str, str]]] = None


def _strip_parens(text: str) -> str:
    return _FURIGANA_RE.sub("", text or "").strip()


def _export_via_node() -> Dict[str, Any]:
    js = r"""
    const fs = require("fs");
    const vm = require("vm");
    const sandbox = { window: {} };
    const files = process.argv.slice(1);
    for (const f of files) {
      if (fs.existsSync(f)) {
        vm.runInNewContext(fs.readFileSync(f, "utf8"), sandbox);
      }
    }
    const w = sandbox.window;
    const modules = [
      ...(w.PHRASE_MODULES_1_6 || []),
      ...(w.PHRASE_MODULES_7_12 || []),
      ...(w.PHRASE_MODULES_13_18 || []),
    ];
    process.stdout.write(JSON.stringify({
      modules,
      verbs: w.JP_TOP_VERBS || [],
      grammar: w.JP_GRAMMAR_LIST || [],
      videoGrammar: w.JP_VIDEO_GRAMMAR || [],
      itinerary: w.TRIP_ITINERARY || {},
    }));
    """
    abs_files = [str(REPO_ROOT / rel) for rel in _DATA_FILES]
    proc = subprocess.run(
        ["node", "-e", js, *abs_files],
        cwd=str(REPO_ROOT),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=20,
        encoding="utf-8",
    )
    if proc.returncode != 0:
        raise RuntimeError(f"Node export failed: {proc.stderr}")
    return json.loads(proc.stdout)


def _needs_rebuild() -> bool:
    if not CURRICULUM_SNAPSHOT_PATH.exists():
        return True
    snap_mtime = CURRICULUM_SNAPSHOT_PATH.stat().st_mtime
    for rel in _DATA_FILES:
        p = REPO_ROOT / rel
        if p.exists() and p.stat().st_mtime > snap_mtime:
            return True
    return False


def load_curriculum(force_reload: bool = False) -> Dict[str, Any]:
    """Load curriculum data from cache snapshot or build via Node."""
    global _CACHE, _GLOSS_INDEX
    if _CACHE is not None and not force_reload:
        return _CACHE

    if not force_reload and not _needs_rebuild():
        _CACHE = json.loads(CURRICULUM_SNAPSHOT_PATH.read_text(encoding="utf-8"))
        _GLOSS_INDEX = None
        return _CACHE

    try:
        data = _export_via_node()
        CURRICULUM_SNAPSHOT_PATH.parent.mkdir(parents=True, exist_ok=True)
        CURRICULUM_SNAPSHOT_PATH.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
        _CACHE = data
    except Exception:
        if CURRICULUM_SNAPSHOT_PATH.exists():
            _CACHE = json.loads(CURRICULUM_SNAPSHOT_PATH.read_text(encoding="utf-8"))
        else:
            _CACHE = {"modules": [], "verbs": [], "grammar": [], "videoGrammar": [], "itinerary": {}}

    _GLOSS_INDEX = None
    return _CACHE


def _build_gloss_index() -> Dict[str, Dict[str, str]]:
    global _GLOSS_INDEX
    if _GLOSS_INDEX is not None:
        return _GLOSS_INDEX

    data = load_curriculum()
    index: Dict[str, Dict[str, str]] = {}

    for v in data.get("verbs", []):
        lemma = (v.get("dict") or v.get("jp") or "").strip()
        if lemma and lemma not in index:
            index[lemma] = {
                "reading": (v.get("kana") or "").strip(),
                "meaning_cn": (v.get("cn") or "").strip(),
                "jlpt": (v.get("jlpt") or "N5").strip(),
                "pitch_accent": "",
                "example_jp": "",
                "tip": (v.get("group") or "").strip(),
            }

    for g in data.get("grammar", []):
        pat = (g.get("pattern") or "").strip()
        if pat and pat not in index:
            index[pat] = {
                "reading": (g.get("reading") or "").strip(),
                "meaning_cn": (g.get("meaning") or "").strip(),
                "jlpt": (g.get("level") or "N5").strip(),
                "pitch_accent": "",
                "example_jp": "",
                "tip": (g.get("tip") or "").strip(),
            }

    # Useful core family & travel glosses
    seed_gloss = {
        "申す": {"reading": "もうす", "meaning_cn": "叫做、自谦地称呼（ます型：申します）", "jlpt": "N4"},
        "預ける": {"reading": "あずける", "meaning_cn": "寄存、托付", "jlpt": "N4"},
        "お預かり": {"reading": "おあずかり", "meaning_cn": "为您保管/接收（店员敬语）", "jlpt": "N4"},
        "確認": {"reading": "かくにん", "meaning_cn": "确认", "jlpt": "N4"},
        "予約": {"reading": "よやく", "meaning_cn": "预约、预订", "jlpt": "N4"},
        "温める": {"reading": "あたためる", "meaning_cn": "加热（便当等）", "jlpt": "N4"},
        "近く": {"reading": "ちかく", "meaning_cn": "附近", "jlpt": "N5"},
        "娘": {"reading": "むすめ", "meaning_cn": "女儿", "jlpt": "N4"},
        "荷物": {"reading": "にもつ", "meaning_cn": "行李", "jlpt": "N4"},
        "会計": {"reading": "かいけい", "meaning_cn": "结账、买单", "jlpt": "N4"},
        "子連れ": {"reading": "こづれ", "meaning_cn": "带着孩子", "jlpt": "N3"},
        "大変": {"reading": "たいへん", "meaning_cn": "非常、辛苦", "jlpt": "N5"},
        "少々": {"reading": "しょうしょう", "meaning_cn": "稍微、一点点", "jlpt": "N4"},
        "恐れ入る": {"reading": "おそれいる", "meaning_cn": "实在抱歉、非常感谢（敬语）", "jlpt": "N3"},
    }
    for k, val in seed_gloss.items():
        index.setdefault(k, {**val, "pitch_accent": "", "example_jp": "", "tip": ""})

    _GLOSS_INDEX = index
    return _GLOSS_INDEX


def lookup_corpus_gloss(word: str) -> Optional[Dict[str, str]]:
    if not word:
        return None
    return _build_gloss_index().get(word.strip())


def list_scenarios() -> List[Dict[str, Any]]:
    """Return both the 5 daily scenarios and all 18 travel phrasebook modules."""
    data = load_curriculum()
    out: List[Dict[str, Any]] = []

    for sc in DAILY_SCENARIOS:
        out.append(
            {
                "id": sc["id"],
                "category": "daily",
                "icon": sc["icon"],
                "title": sc["title"],
                "enTitle": sc["enTitle"],
                "legs": sc["legs"],
                "summary": sc["summary"],
                "phraseCount": len(sc["phrases"]),
            }
        )

    for m in data.get("modules", []):
        phrase_count = sum(len(s.get("items") or []) for s in (m.get("sections") or []))
        out.append(
            {
                "id": str(m["id"]),
                "category": "travel",
                "icon": m.get("icon") or "🗾",
                "title": m.get("title") or str(m["id"]),
                "enTitle": m.get("enTitle") or "",
                "legs": m.get("legs") or [],
                "summary": m.get("summary") or "",
                "phraseCount": phrase_count,
            }
        )
    return out


def get_scenario(scenario_id: str) -> Optional[Dict[str, Any]]:
    """Return full scenario details, phrases, dialogues, and roleplay prompt context."""
    req_id = str(scenario_id or "").strip()
    for sc in DAILY_SCENARIOS:
        if sc["id"] == req_id:
            return {
                **sc,
                "category": "daily",
                "dialogues": [],
            }

    data = load_curriculum()
    for m in data.get("modules", []):
        if str(m.get("id")) == req_id:
            phrases: List[Dict[str, Any]] = []
            for sec in m.get("sections") or []:
                for item in sec.get("items") or []:
                    phrases.append(
                        {
                            "id": item.get("id", ""),
                            "tag": item.get("tag", sec.get("title", "")),
                            "jp": item.get("jp", ""),
                            "clean_jp": _strip_parens(item.get("jp", "")),
                            "romaji": item.get("romaji", ""),
                            "cn": item.get("cn", ""),
                            "tip": item.get("tip", ""),
                        }
                    )
            dialogues = m.get("dialogues") or []
            starter_jp = "こんにちは！何かお手伝いできますか？"
            starter_cn = "您好！有什么可以帮您的吗？"
            if dialogues:
                turns = dialogues[0].get("turns") or []
                for t in turns:
                    if t.get("speaker") == "them":
                        starter_jp = _strip_parens(t.get("jp", ""))
                        starter_cn = t.get("cn", "")
                        break
            return {
                "id": str(m["id"]),
                "category": "travel",
                "icon": m.get("icon") or "🗾",
                "title": m.get("title") or m["id"],
                "enTitle": m.get("enTitle") or "",
                "legs": m.get("legs") or [],
                "summary": m.get("summary") or "",
                "persona": f"日本旅行真实工作人员/对话伙伴，围绕「{m.get('title')}」与带着两个孩子（Jinny 6岁半、Jaycie 2岁半）的刘浩东/Sherry一家互动。",
                "starter_jp": starter_jp,
                "starter_cn": starter_cn,
                "phrases": phrases,
                "dialogues": dialogues,
            }
    return None


def get_verbs(limit: int = 200) -> List[Dict[str, Any]]:
    return (load_curriculum().get("verbs") or [])[:limit]


def get_grammar(level: Optional[str] = None) -> List[Dict[str, Any]]:
    items = load_curriculum().get("grammar") or []
    if level:
        return [g for g in items if (g.get("level") or "").upper() == level.upper()]
    return items
