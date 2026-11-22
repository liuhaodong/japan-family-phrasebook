#!/usr/bin/env python3
"""
Deterministic N4->N3 Dataset Builder for Japan Family Phrasebook.
Enriches verbs_top200.js (200 -> 300 verbs with transitivity, pairs, particles,
causative_passive, imperative, and 3rd examples), grammar_n5_n3.js (96 -> 116),
and learning_extras.js (adds 9 new N4->N3 sections).
Outputs strict JSON inside window.VAR = ...; so both browsers and Python parse_js_data() work reliably.
"""
import json
import re
from pathlib import Path
from n5_review_pack import N5_GRAMMAR_ADDITIONS, N5_EXTRA_ADJECTIVES, N5_CORE_VOCAB_LIST

PROJECT_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = PROJECT_DIR / "data"

A_ROW = {"う": "わ", "つ": "た", "る": "ら", "む": "ま", "ぶ": "ば", "ぬ": "な", "く": "か", "ぐ": "が", "す": "さ"}
I_ROW = {"う": "い", "つ": "ち", "る": "り", "む": "み", "ぶ": "び", "ぬ": "に", "く": "き", "ぐ": "ぎ", "す": "し"}
E_ROW = {"う": "え", "つ": "て", "る": "れ", "む": "め", "ぶ": "べ", "ぬ": "ね", "く": "け", "ぐ": "げ", "す": "せ"}
O_ROW = {"う": "お", "つ": "と", "る": "ろ", "む": "も", "ぶ": "ぼ", "ぬ": "の", "く": "こ", "ぐ": "ご", "す": "そ"}


def conjugate_te_ta(dict_w, kana_w, group):
    if group == "irregular":
        if dict_w.endswith("する"):
            return (dict_w[:-2] + "して", kana_w[:-2] + "して"), (dict_w[:-2] + "した", kana_w[:-2] + "した")
        if dict_w.endswith("来る"):
            return (dict_w[:-2] + "来て", kana_w[:-2] + "きて"), (dict_w[:-2] + "来た", kana_w[:-2] + "きた")
    if group == "ichidan":
        return (dict_w[:-1] + "て", kana_w[:-1] + "て"), (dict_w[:-1] + "た", kana_w[:-1] + "た")
    if dict_w == "行く":
        return ("行って", "いって"), ("行った", "いった")
    last = dict_w[-1]
    ds, ks = dict_w[:-1], kana_w[:-1]
    if last in "うつる":
        return (ds + "って", ks + "って"), (ds + "った", ks + "った")
    if last in "むぶぬ":
        return (ds + "んで", ks + "んで"), (ds + "んだ", ks + "んだ")
    if last == "く":
        return (ds + "いて", ks + "いて"), (ds + "いた", ks + "いた")
    if last == "ぐ":
        return (ds + "いで", ks + "いで"), (ds + "いだ", ks + "いだ")
    if last == "す":
        return (ds + "して", ks + "して"), (ds + "した", ks + "した")
    raise ValueError(f"Unknown ending for {dict_w}")


def build_all_forms(dict_w, kana_w, group, overrides=None):
    overrides = overrides or {}
    if group == "irregular":
        if dict_w.endswith("する"):
            ds, ks = dict_w[:-2], kana_w[:-2]
            forms = {
                "dict": {"jp": dict_w, "kana": kana_w},
                "masu": {"jp": ds + "します", "kana": ks + "します"},
                "te": {"jp": ds + "して", "kana": ks + "して"},
                "ta": {"jp": ds + "した", "kana": ks + "した"},
                "nai": {"jp": ds + "しない", "kana": ks + "しない"},
                "tai": {"jp": ds + "したい", "kana": ks + "したい"},
                "potential": {"jp": ds + "できる", "kana": ks + "できる"},
                "volitional": {"jp": ds + "しよう", "kana": ks + "しよう"},
                "ba": {"jp": ds + "すれば", "kana": ks + "すれば"},
                "passive": {"jp": ds + "される", "kana": ks + "される"},
                "causative": {"jp": ds + "させる", "kana": ks + "させる"},
                "causative_passive": {"jp": ds + "させられる", "kana": ks + "させられる"},
                "imperative": {"jp": ds + "しろ", "kana": ks + "しろ"},
            }
        elif dict_w == "来る":
            forms = {
                "dict": {"jp": "来る", "kana": "くる"},
                "masu": {"jp": "来ます", "kana": "きます"},
                "te": {"jp": "来て", "kana": "きて"},
                "ta": {"jp": "来た", "kana": "きた"},
                "nai": {"jp": "来ない", "kana": "こない"},
                "tai": {"jp": "来たい", "kana": "きたい"},
                "potential": {"jp": "来られる", "kana": "こられる"},
                "volitional": {"jp": "来よう", "kana": "こよう"},
                "ba": {"jp": "来れば", "kana": "くれば"},
                "passive": {"jp": "来られる", "kana": "こられる"},
                "causative": {"jp": "来させる", "kana": "こさせる"},
                "causative_passive": {"jp": "来させられる", "kana": "こさせられる"},
                "imperative": {"jp": "来い", "kana": "こい"},
            }
        else:
            raise ValueError(f"Unsupported irregular verb: {dict_w}")
    elif group == "ichidan":
        ds, ks = dict_w[:-1], kana_w[:-1]
        forms = {
            "dict": {"jp": dict_w, "kana": kana_w},
            "masu": {"jp": ds + "ます", "kana": ks + "ます"},
            "te": {"jp": ds + "て", "kana": ks + "て"},
            "ta": {"jp": ds + "た", "kana": ks + "た"},
            "nai": {"jp": ds + "ない", "kana": ks + "ない"},
            "tai": {"jp": ds + "たい", "kana": ks + "たい"},
            "potential": {"jp": ds + "られる", "kana": ks + "られる"},
            "volitional": {"jp": ds + "よう", "kana": ks + "よう"},
            "ba": {"jp": ds + "れば", "kana": ks + "れば"},
            "passive": {"jp": ds + "られる", "kana": ks + "られる"},
            "causative": {"jp": ds + "させる", "kana": ks + "させる"},
            "causative_passive": {"jp": ds + "させられる", "kana": ks + "させられる"},
            "imperative": {"jp": ds + "ろ", "kana": ks + "ろ"},
        }
    else:
        last = dict_w[-1]
        ds, ks = dict_w[:-1], kana_w[:-1]
        (te_j, te_k), (ta_j, ta_k) = conjugate_te_ta(dict_w, kana_w, group)
        cp_j = ds + "させられる" if last == "す" else ds + A_ROW[last] + "される"
        cp_k = ks + "させられる" if last == "す" else ks + A_ROW[last] + "される"
        forms = {
            "dict": {"jp": dict_w, "kana": kana_w},
            "masu": {"jp": ds + I_ROW[last] + "ます", "kana": ks + I_ROW[last] + "ます"},
            "te": {"jp": te_j, "kana": te_k},
            "ta": {"jp": ta_j, "kana": ta_k},
            "nai": {"jp": ds + A_ROW[last] + "ない", "kana": ks + A_ROW[last] + "ない"},
            "tai": {"jp": ds + I_ROW[last] + "たい", "kana": ks + I_ROW[last] + "たい"},
            "potential": {"jp": ds + E_ROW[last] + "る", "kana": ks + E_ROW[last] + "る"},
            "volitional": {"jp": ds + O_ROW[last] + "う", "kana": ks + O_ROW[last] + "う"},
            "ba": {"jp": ds + E_ROW[last] + "ば", "kana": ks + E_ROW[last] + "ば"},
            "passive": {"jp": ds + A_ROW[last] + "れる", "kana": ks + A_ROW[last] + "れる"},
            "causative": {"jp": ds + A_ROW[last] + "せる", "kana": ks + A_ROW[last] + "せる"},
            "causative_passive": {"jp": cp_j, "kana": cp_k},
            "imperative": {"jp": ds + E_ROW[last], "kana": ks + E_ROW[last]},
        }
        if dict_w == "ある":
            forms["nai"] = {"jp": "ない", "kana": "ない"}
            forms["passive"] = {"jp": "—", "kana": ""}
            forms["causative"] = {"jp": "—", "kana": ""}
            forms["causative_passive"] = {"jp": "—", "kana": ""}
            forms["imperative"] = {"jp": "—", "kana": ""}
        elif dict_w == "分かる":
            forms["potential"] = {"jp": "—", "kana": ""}
            forms["volitional"] = {"jp": "—", "kana": ""}
            forms["causative_passive"] = {"jp": "—", "kana": ""}
            forms["imperative"] = {"jp": "—", "kana": ""}

    for k, val in overrides.items():
        forms[k] = val
    return forms


# Transitivity & particle collocation metadata for existing 200 verbs (v-001..v-200)
# Format: dict -> (transitivity, particles)
EXISTING_META = {
    "する": ("vt", "〜を する"),
    "いる": ("vi", "〜が いる（人/动物）"),
    "ある": ("vi", "〜が ある（物品/事情）"),
    "なる": ("vi", "〜に なる"),
    "行く": ("vi", "〜へ / 〜に 行く"),
    "来る": ("vi", "〜へ / 〜に 来る"),
    "見る": ("vt", "〜を 見る"),
    "食べる": ("vt", "〜を 食べる"),
    "飲む": ("vt", "〜を 飲む"),
    "言う": ("vt", "〜と 言う / 〜を 言う"),
    "聞く": ("vt", "〜を 聞く / 〜に 聞く"),
    "話す": ("both", "〜を 話す / 〜と 話す"),
    "買う": ("vt", "〜を 買う"),
    "使う": ("vt", "〜を 使う"),
    "待つ": ("both", "〜を 待つ"),
    "持つ": ("vt", "〜を 持つ"),
    "取る": ("vt", "〜を 取る"),
    "分かる": ("vi", "〜が 分かる"),
    "知る": ("vt", "〜を 知る"),
    "思う": ("vt", "〜と 思う"),
    "書く": ("vt", "〜を 書く"),
    "読む": ("vt", "〜を 読む"),
    "寝る": ("vi", "ベッドで 寝る"),
    "起きる": ("vi", "朝 起きる / 事件が 起きる"),
    "歩く": ("vi", "〜を 歩く（经过某地）"),
    "走る": ("vi", "〜を 走る（移动路径）"),
    "乗る": ("vi", "〜に 乗る"),
    "降りる": ("vi", "〜を 降りる / 〜から 降りる"),
    "入る": ("vi", "〜に 入る"),
    "出る": ("vi", "〜から 出る / 〜に 出る"),
    "開ける": ("vt", "〜を 開ける"),
    "閉める": ("vt", "〜を 閉める"),
    "つける": ("vt", "〜を つける"),
    "消す": ("vt", "〜を 消す"),
    "作る": ("vt", "〜を 作る"),
    "遊ぶ": ("vi", "〜と 遊ぶ / 〜で 遊ぶ"),
    "休む": ("both", "〜を 休む / 少し 休む"),
    "働く": ("vi", "〜で 働く"),
    "勉強する": ("vt", "〜を 勉強する"),
    "教える": ("vt", "〜に 〜を 教える"),
    "習う": ("vt", "〜に 〜を 習う"),
    "会う": ("vi", "〜に / 〜と 会う"),
    "帰る": ("vi", "家へ / 〜に 帰る"),
    "出す": ("vt", "〜を 出す"),
    "入れる": ("vt", "〜に 〜を 入れる"),
    "置く": ("vt", "〜に 〜を 置く"),
    "立つ": ("vi", "〜に 立つ"),
    "座る": ("vi", "〜に 座る"),
    "止まる": ("vi", "〜が 止まる / 〜に 止まる"),
    "始まる": ("vi", "〜が 始まる"),
    "終わる": ("both", "〜が 終わる"),
    "着く": ("vi", "〜に 着く"),
    "渡す": ("vt", "〜に 〜を 渡す"),
    "もらう": ("vt", "〜に/から 〜を もらう"),
    "あげる": ("vt", "〜に 〜を あげる"),
    "くれる": ("vt", "（私に）〜を くれる"),
    "借りる": ("vt", "〜に/から 〜を 借りる"),
    "貸す": ("vt", "〜に 〜を 貸す"),
    "払う": ("vt", "〜を 払う"),
    "選ぶ": ("vt", "〜を 選ぶ"),
    "頼む": ("vt", "〜を 頼む / 〜に 頼む"),
    "お願いする": ("vt", "〜を お願いする"),
    "予約する": ("vt", "〜を 予約する"),
    "確認する": ("vt", "〜を 確認する"),
    "調べる": ("vt", "〜を 調べる"),
    "探す": ("vt", "〜を 探す"),
    "見つける": ("vt", "〜を 見つける"),
    "忘れる": ("vt", "〜を 忘れる"),
    "覚える": ("vt", "〜を 覚える"),
    "考える": ("vt", "〜を 考える / 〜について 考える"),
    "決める": ("vt", "〜を 決める"),
    "変わる": ("vi", "〜が 変わる"),
    "変える": ("vt", "〜を 変える"),
    "始める": ("vt", "〜を 始める"),
    "続ける": ("vt", "〜を 続ける"),
    "やめる": ("vt", "〜を やめる"),
    "急ぐ": ("vi", "駅へ 急ぐ / 〜を 急ぐ"),
    "遅れる": ("vi", "〜に 遅れる"),
    "間に合う": ("vi", "〜に 間に合う"),
    "迷う": ("vi", "道に 迷う / 〜か 迷う"),
    "動く": ("vi", "〜が 動く"),
    "運ぶ": ("vt", "〜を 運ぶ"),
    "届ける": ("vt", "〜を 届ける"),
    "届く": ("vi", "〜が 届く"),
    "預ける": ("vt", "〜に 〜を 預ける"),
    "受け取る": ("vt", "〜を 受け取る"),
    "送る": ("vt", "〜に 〜を 送る"),
    "返す": ("vt", "〜を 返す"),
    "捨てる": ("vt", "〜を 捨てる"),
    "片付ける": ("vt", "〜を 片付ける"),
    "洗う": ("vt", "〜を 洗う"),
    "掃除する": ("vt", "〜を 掃除する"),
    "洗濯する": ("vt", "〜を 洗濯する"),
    "料理する": ("vt", "〜を 料理する"),
    "着る": ("vt", "〜を 着る（上衣）"),
    "脱ぐ": ("vt", "〜を 脱ぐ（衣/鞋）"),
    "履く": ("vt", "〜を 履く（鞋/裤）"),
    "浴びる": ("vt", "シャワーを 浴びる"),
    "磨く": ("vt", "歯を 磨く"),
    "笑う": ("vi", "楽しく 笑う"),
    "泣く": ("vi", "子どもが 泣く"),
    "怒る": ("vi", "〜に 怒る"),
    "喜ぶ": ("both", "〜を 喜ぶ"),
    "楽しむ": ("vt", "〜を 楽しむ"),
    "心配する": ("vt", "〜を 心配する"),
    "安心する": ("vi", "〜て 安心する"),
    "驚く": ("vi", "〜に 驚く"),
    "困る": ("vi", "〜に/で 困る"),
    "助ける": ("vt", "〜を 助ける"),
    "助かる": ("vi", "〜て 助かる"),
    "手伝う": ("vt", "〜を 手伝う"),
    "呼ぶ": ("vt", "〜を 呼ぶ"),
    "誘う": ("vt", "〜を 誘う"),
    "断る": ("vt", "〜を 断る"),
    "謝る": ("vi", "〜に 謝る"),
    "許す": ("vt", "〜を 許す"),
    "褒める": ("vt", "〜を 褒める"),
    "伝える": ("vt", "〜に 〜を 伝える"),
    "説明する": ("vt", "〜を 説明する"),
    "相談する": ("vi", "〜に 〜について 相談する"),
    "質問する": ("vi", "〜に 質問する"),
    "答える": ("vi", "〜に 答える"),
    "連絡する": ("vi", "〜に 連絡する"),
    "電話する": ("vi", "〜に 電話する"),
    "撮る": ("vt", "写真を 撮る"),
    "注文する": ("vt", "〜を 注文する"),
    "案内する": ("vt", "〜を 案内する"),
    "紹介する": ("vt", "〜を 紹介する"),
    "準備する": ("vt", "〜を 準備する"),
    "練習する": ("vt", "〜を 練習する"),
    "慣れる": ("vi", "〜に 慣れる"),
    "疲れる": ("vi", "〜て 疲れる"),
    "眠る": ("vi", "ぐっすり 眠る"),
    "治る": ("vi", "病気が 治る"),
    "治す": ("vt", "病気を 治す"),
    "痛む": ("vi", "足が 痛む"),
    "引く": ("vt", "〜を 引く / 風邪を 引く"),
    "押す": ("vt", "〜を 押す"),
    "触る": ("vi", "〜に 触る"),
    "投げる": ("vt", "〜を 投げる"),
    "落とす": ("vt", "〜を 落とす"),
    "落ちる": ("vi", "〜が 落ちる"),
    "壊れる": ("vi", "〜が 壊れる"),
    "壊す": ("vt", "〜を 壊す"),
    "直る": ("vi", "〜が 直る"),
    "直す": ("vt", "〜を 直す"),
    "汚れる": ("vi", "〜が 汚れる"),
    "濡れる": ("vi", "〜が 濡れる"),
    "乾く": ("vi", "〜が 乾く"),
    "温める": ("vt", "〜を 温める"),
    "冷やす": ("vt", "〜を 冷やす"),
    "焼く": ("vt", "〜を 焼く"),
    "煮る": ("vt", "〜を 煮る"),
    "切る": ("vt", "〜を 切る"),
    "混ぜる": ("vt", "〜を 混ぜる"),
    "味わう": ("vt", "〜を 味わう"),
    "足りる": ("vi", "〜が 足りる"),
    "余る": ("vi", "〜が 余る"),
    "増える": ("vi", "〜が 増える"),
    "減る": ("vi", "〜が 減る"),
    "上がる": ("vi", "〜が 上がる"),
    "下がる": ("vi", "〜が 下がる"),
    "上げる": ("vt", "〜を 上げる"),
    "下げる": ("vt", "〜を 下げる"),
    "並ぶ": ("vi", "〜に 並ぶ"),
    "並べる": ("vt", "〜を 並べる"),
    "集まる": ("vi", "〜に 集まる"),
    "集める": ("vt", "〜を 集める"),
    "通る": ("vi", "〜を 通る（经过）"),
    "渡る": ("vi", "道を 渡る"),
    "曲がる": ("both", "右へ 曲がる"),
    "戻る": ("vi", "〜に 戻る"),
    "寄る": ("vi", "〜に 寄る"),
    "泊まる": ("vi", "ホテルに 泊まる"),
    "引っ越す": ("vi", "〜へ 引っ越す"),
    "住む": ("vi", "〜に 住む"),
    "過ごす": ("vt", "時間を 過ごす"),
    "残る": ("vi", "〜が 残る"),
    "残す": ("vt", "〜を 残す"),
    "育てる": ("vt", "子どもを 育てる"),
    "育つ": ("vi", "子どもが 育つ"),
    "生まれる": ("vi", "〜が 生まれる"),
    "生きる": ("vi", "楽しく 生きる"),
    "守る": ("vt", "約束を 守る"),
    "信じる": ("vt", "〜を 信じる"),
    "願う": ("vt", "〜を 願う"),
    "祈る": ("vt", "〜を 祈る"),
    "比べる": ("vt", "〜と 〜を 比べる"),
    "試す": ("vt", "〜を 試す"),
    "挑戦する": ("vi", "〜に 挑戦する"),
    "成功する": ("vi", "〜に 成功する"),
    "失敗する": ("vi", "〜に 失敗する"),
    "間違える": ("vt", "〜を 間違える"),
    "気づく": ("vi", "〜に 気づく"),
    "思い出す": ("vt", "〜を 思い出す"),
    "想像する": ("vt", "〜を 想像する"),
    "期待する": ("vt", "〜に/を 期待する"),
    "賛成する": ("vi", "〜に 賛成する"),
    "反対する": ("vi", "〜に 反対する"),
    "感謝する": ("vi", "〜に 感謝する"),
}

# Bidirectional pair definitions by dict word
PAIR_DICT_LINKS = [
    ("開く", "開ける"),
    ("閉まる", "閉める"),
    ("つく", "つける"),
    ("消える", "消す"),
    ("始まる", "始める"),
    ("終わる", "終える"),
    ("入る", "入れる"),
    ("出る", "出す"),
    ("起きる", "起こす"),
    ("寝る", "寝かせる"),
    ("乗る", "乗せる"),
    ("降りる", "降ろす"),
    ("止まる", "止める"),
    ("見つかる", "見つける"),
    ("決まる", "決める"),
    ("変わる", "変える"),
    ("続く", "続ける"),
    ("届く", "届ける"),
    ("動く", "動かす"),
    ("預かる", "預ける"),
    ("片付く", "片付ける"),
    ("助かる", "助ける"),
    ("治る", "治す"),
    ("落ちる", "落とす"),
    ("壊れる", "壊す"),
    ("直る", "直す"),
    ("汚れる", "汚す"),
    ("濡れる", "濡らす"),
    ("乾く", "乾かす"),
    ("温まる", "温める"),
    ("冷える", "冷やす"),
    ("焼ける", "焼く"),
    ("混ざる", "混ぜる"),
    ("増える", "増やす"),
    ("減る", "減らす"),
    ("上がる", "上げる"),
    ("下がる", "下げる"),
    ("並ぶ", "並べる"),
    ("集まる", "集める"),
    ("通る", "通す"),
    ("戻る", "戻す"),
    ("残る", "残す"),
    ("育つ", "育てる"),
    ("掛かる", "掛ける"),
    ("抜ける", "抜く"),
    ("折れる", "折る"),
    ("割れる", "割る"),
    ("沸く", "沸かす"),
    ("溶ける", "溶かす"),
    ("外れる", "外す"),
    ("進む", "進める"),
    ("倒れる", "倒す"),
    ("破れる", "破る"),
    ("冷める", "冷ます"),
    ("鳴る", "鳴らす"),
    ("済む", "済ませる"),
]

# 3rd example sentences for existing verbs (dict -> {form, jp, romaji, cn})
# Paired/high-freq verbs get 自他对比 or 口语缩略 examples; remaining get natural N4->N3 travel/family examples
THIRD_EXAMPLES = {
    "する": {"form": "💬 口语缩略", "jp": "チェックインはもう済（す）ませたから、荷物（にもつ）だけ置（お）いとこう。", "romaji": "Chekkuin wa mou sumaseta kara, nimotsu dake oitokou.", "cn": "办理入住已经搞定了，咱们先把行李放着吧（〜ておこう→〜とこう）。"},
    "いる": {"form": "💬 口语缩略", "jp": "下（した）の子（こ）がまだ部屋（へや）で寝（ね）てるんだよ。", "romaji": "Shita no ko ga mada heya de neteru nda yo.", "cn": "小女儿还在房间里睡着呢（〜ている→〜てる + んだ）。"},
    "ある": {"form": "N4 确认", "jp": "すみません、子（こ）ども用（よう）の椅子（いす）ってありますか？", "romaji": "Sumimasen, kodomoyou no isu tte arimasu ka?", "cn": "不好意思，请问有儿童座椅吗（口语提示「〜って」）？"},
    "なる": {"form": "N4 变化", "jp": "軽井沢（かるいざわ）は夜（よる）になると急（きゅう）に寒（さむ）くなりますね。", "romaji": "Karuizawa wa yoru ni naru to kyuu ni samuku narimasu ne.", "cn": "轻井泽一到晚上就突然变冷了呢。"},
    "行く": {"form": "💬 口语缩略", "jp": "そろそろ行（い）かなきゃ！シャトルバスが出（で）ちゃうよ。", "romaji": "Sorosoro ikanakya! Shatoru basu ga dechau yo.", "cn": "差不多该走了！接驳巴士要开走了哦（〜なければ→〜なきゃ）。"},
    "来る": {"form": "💬 口语缩略", "jp": "あ、タクシーがやっと来（き）たっぽいよ！", "romaji": "A, takushii ga yatto kita ppoi yo!", "cn": "啊，出租车好像终于来了哦！"},
    "見る": {"form": "💬 口语缩略", "jp": "このお店（みせ）のメニュー、写真（しゃしん）で見（み）とくね。", "romaji": "Kono omise no menyuu, shashin de mitoku ne.", "cn": "我先用照片看看这家店的菜单哦（〜ておく→〜とく）。"},
    "食べる": {"form": "💬 口语缩略", "jp": "おいしい！これ、ぜんぶ食（た）べちゃった。", "romaji": "Oishii! Kore, zenbu tabechatta.", "cn": "好好吃！把这个全都吃光了（〜てしまった→〜ちゃった）。"},
    "飲む": {"form": "💬 口语缩略", "jp": "冷（さ）めちゃう前（まえ）に、早（はや）くスープ飲（の）んじゃおう。", "romaji": "Samechau mae ni, hayaku suupu nonjaou.", "cn": "在凉掉之前，赶紧把汤喝了吧（〜てしまおう→〜じゃおう）。"},
    "言う": {"form": "💬 口语缩略", "jp": "先生（せんせい）が「明日（あした）は雪（ゆき）だよ」って言（い）ってたよ。", "romaji": "Sensei ga 'ashita wa yuki da yo' tte itteta yo.", "cn": "老师刚才说“明天要下雪哦”（〜てた）。"},
    "聞く": {"form": "N4 礼貌", "jp": "念（ねん）のため、フロントで直接（ちょくせつ）聞（き）いておきますね。", "romaji": "Nen no tame, furonto de chokusetsu kiite okimasu ne.", "cn": "为了保险起见，我去前台直接问一下。"},
    "話す": {"form": "N4 能力", "jp": "ゆっくりなら日本語（にほんご）でも少（すこ）し話（はな）せるようになりました。", "romaji": "Yukkuri nara Nihongo demo sukoshi hanaseru you ni narimashita.", "cn": "说慢一点的话，我也慢慢能用日语聊几句了。"},
    "買う": {"form": "💬 口语缩略", "jp": "水（みず）とおやつ、コンビニで買（か）っといたよ。", "romaji": "Mizu to oyatsu, konbini de kattoita yo.", "cn": "水和小零食，我已经提前在便利店买好了哦（〜ておいた→〜といた）。"},
    "使う": {"form": "N4 礼貌", "jp": "すみません、こちらのクレジットカードは使（つか）えますか？", "romaji": "Sumimasen, kochira no kurejitto kaado wa tsukaemasu ka?", "cn": "不好意思，请问这张信用卡能用吗？"},
    "待つ": {"form": "N4 使役被动", "jp": "人気（にんき）店（てん）だったので、雨（あめ）の中（なか）30分（ぷん）も待（ま）たされました。", "romaji": "Ninkiten datta node, ame no naka sanjuppun mo matasaremashita.", "cn": "因为是人气店，在雨里被硬生生等了30分钟。"},
    "持つ": {"form": "💬 口语缩略", "jp": "傘（かさ）は私（わたし）が持（も）っとくから、子（こ）どもの手（て）をつないで。", "romaji": "Kasa wa watashi ga mottoku kara, kodomo no te wo tsunaide.", "cn": "伞我拿着就行，你牵着孩子的手吧。"},
    "取る": {"form": "N4 结果", "jp": "おかげさまで、銀座（ぎんざ）の予約（よやく）がちゃんと取（と）れました。", "romaji": "Okagesama de, Ginza no yoyaku ga chanto toremashita.", "cn": "托福，银座餐厅的预约顺利订到了。"},
    "分かる": {"form": "💬 口语缩略", "jp": "店員（てんいん）さんの早口（はやぐち）がぜんぜん分（わ）かんなかった！", "romaji": "Ten'in-san no hayaguchi ga zenzen wakannakatta!", "cn": "店员说得太快完全没听懂！（〜なかった→〜んなかった 口语）"},
    "知る": {"form": "N4 礼貌", "jp": "近（ちか）くに薬局（やっきょく）があるかご存（ぞん）じですか？", "romaji": "Chikaku ni yakkyoku ga aru ka gozonji desu ka?", "cn": "请问您知道附近有没有药妆店吗？（知る的尊他语）"},
    "思う": {"form": "💬 口语缩略", "jp": "今日（きょう）はちょっと混（こ）んでると思（おも）うんだよね。", "romaji": "Kyou wa chotto konderu to omou nda yo ne.", "cn": "我觉得今天可能有点挤呢。"},
    "書く": {"form": "N4 结果存留", "jp": "紙（かみ）にホテルの住所（じゅうしょ）が書（か）いてあります。", "romaji": "Kami ni hoteru no juusho ga kaite arimasu.", "cn": "纸上提前写着酒店的地址。"},
    "読む": {"form": "N4 尝试", "jp": "日本語（にほんご）の看板（かんばん）を自分（じぶん）で読（よ）んでみました。", "romaji": "Nihongo no kanban wo jibun de yonde mimashita.", "cn": "我试着自己读了一下日语招牌。"},
    "寝る": {"form": "⇄ 自他对比", "jp": "［自］妹（いもうと）はもう寝（ね）たので、静（しず）かにしよう。", "romaji": "[Vi] Imouto wa mou neta node, shizuka ni shiyou.", "cn": "[自] 妹妹已经睡了，咱们安静点吧（他动词：寝かせる）。"},
    "起きる": {"form": "⇄ 自他对比", "jp": "［自］今日（きょう）は7時（じ）に早（はや）く起（お）きられました。", "romaji": "[Vi] Kyou wa shichiji ni hayaku okiraremashita.", "cn": "[自] 今天7点钟很早就能起来了（他动词：起こす）。"},
    "歩く": {"form": "N4 使役被动", "jp": "東京駅（とうきょうえき）の中（なか）で道（みち）に迷（まよ）って、15分（ふん）も歩（ある）かされました。", "romaji": "Toukyou-eki no naka de michi ni mayotte, juugofun mo arukasaremashita.", "cn": "在东京站里迷路了，被迫走了15分钟。"},
    "走る": {"form": "N4 建议", "jp": "床（ゆか）が滑（すべ）りやすいから、廊下（ろうか）を走（はし）らないでね。", "romaji": "Yuka ga suberiyasui kara, rouka wo hashiranaide ne.", "cn": "地板很滑，不要在走廊里跑哦。"},
    "乗る": {"form": "⇄ 自他对比", "jp": "［自］次（つぎ）の新幹線（しんかんせん）に乗（の）ります。", "romaji": "[Vi] Tsugi no shinkansen ni norimasu.", "cn": "[自] 我们乘坐下一班新干线（他动词：乗せる）。"},
    "降りる": {"form": "⇄ 自他对比", "jp": "［自］次（つぎ）の駅（えき）で降（お）りますよ！", "romaji": "[Vi] Tsugi no eki de orimasu yo!", "cn": "[自] 下一站我们要下车了哦！（他动词：降ろす）。"},
    "入る": {"form": "⇄ 自他对比", "jp": "［自］お風呂（ふろ）にお湯（ゆ）が入（はい）っていますよ。", "romaji": "[Vi] Ofuro ni oyu ga haitte imasu yo.", "cn": "[自] 浴缸里已经放好热水了哦（他动词：入れる）。"},
    "出る": {"form": "⇄ 自他对比", "jp": "［自］あ、自販機（じはんき）からお釣（つ）りが出（で）ましたよ。", "romaji": "[Vi] A, jihanki kara otsuri ga demashita yo.", "cn": "[自] 啊，自动贩卖机里吐出找零了（他动词：出す）。"},
    "開ける": {"form": "⇄ 自他对比", "jp": "［他］ちょっと暑（あつ）いので、窓（まど）を開（あ）けてもいいですか？", "romaji": "[Vt] Chotto atsui node, mado wo akete mo ii desu ka?", "cn": "[他] 有点热，我可以打开窗户吗？（自动词：開く が開く）"},
    "閉める": {"form": "⇄ 自他对比", "jp": "［他］寒（さむ）いから、ドアを閉（し）めといてね。", "romaji": "[Vt] Samui kara, doa wo shimetoite ne.", "cn": "[他] 好冷，顺手把门关好吧（自动词：閉まる が閉まる）。"},
    "つける": {"form": "⇄ 自他对比", "jp": "［他］部屋（へや）が暗（くら）いので、電気（でんき）をつけましょう。", "romaji": "[Vt] Heya ga kurai node, denki wo tsukemashou.", "cn": "[他] 房间太暗了，把灯打开吧（自动词：つく がつく）。"},
    "消す": {"form": "⇄ 自他对比", "jp": "［他］寝（ね）るときはエアコンを消（け）してから寝（ね）よう。", "romaji": "[Vt] Neru toki wa eakon wo keshite kara neyou.", "cn": "[他] 睡觉时关掉空调再睡吧（自动词：消える が消える）。"},
    "作る": {"form": "💬 口语缩略", "jp": "パパが朝食（ちょうしょく）に卵焼（たまごや）きを作（つく）っといたよ。", "romaji": "Papa ga choushoku ni tamagoyaki wo tsukuttoita yo.", "cn": "爸爸早餐提前煎好了玉子烧哦。"},
    "遊ぶ": {"form": "N4 持续", "jp": "子どもたちは雪（ゆき）の中（なか）でずっと楽（たの）しそうに遊（あそ）んでいます。", "romaji": "Kodomotachi wa yuki no naka de zutto tanoshisou ni asonde imasu.", "cn": "孩子们一直在雪地里开心地玩着。"},
    "休む": {"form": "N4 建议", "jp": "たくさん歩（ある）いたから、カフェでちょっと休（やす）んでいかない？", "romaji": "Takusan aruita kara, kafe de chotto yasunde ikanai?", "cn": "走了好多路了，要不要去咖啡馆歇会儿再走？"},
    "働く": {"form": "N3 表达", "jp": "普段（ふだん）忙（いそが）しく働（はたら）いている分（ぶん）、旅行（りょこう）でゆっくりします。", "romaji": "Fudan isogashiku hataraite iru bun, ryokou de yukkuri shimasu.", "cn": "平时工作忙碌的那份，趁旅行好好放松一下。"},
    "勉強する": {"form": "N3 持续", "jp": "日本旅行（にほんりょこう）のために、毎日（まいにち）15分（ふん）ずつ日本語（にほんご）を勉強（べんきょう）しています。", "romaji": "Nihon ryokou no tame ni, mainichi juugofun zutsu Nihongo wo benkyou shite imasu.", "cn": "为了去日本旅行，每天坚持学15分钟日语。"},
    "教える": {"form": "N4 请求", "jp": "この辺（あた）りでお子様（こさま）歓迎（かんげい）のお店（みせ）を教（おし）えていただけますか？", "romaji": "Kono atari de okosama kangei no omise wo oshiete itadakemasu ka?", "cn": "请问能告诉我这附近欢迎带小孩的餐厅吗？"},
    "習う": {"form": "N4 经历", "jp": "娘（むすめ）は軽井沢（かるいざわ）で初（はじ）めてスキーを習（なら）いました。", "romaji": "Musume wa Karuizawa de hajimete sukii wo naraimashita.", "cn": "女儿在轻井泽第一次学了滑雪。"},
    "会う": {"form": "N4 期待", "jp": "来年（らいねん）また日本（にほん）でみんなに会（あ）えるのを楽し（たの）しみにしています。", "romaji": "Rainen mata Nihon de minna ni aeru no wo tanoshimi ni shite imasu.", "cn": "很期待明年还能在日本和大家见面。"},
    "帰る": {"form": "💬 口语缩略", "jp": "暗（くら）くなってきたし、そろそろホテルに帰（かえ）っちゃおうか。", "romaji": "Kuraku natte kita shi, sorosoro hoteru ni kaecchaou ka.", "cn": "天也黑下来了，咱们差不多回酒店吧。"},
    "出す": {"form": "⇄ 自他对比", "jp": "［他］免税（めんぜい）のために、レジでパスポートを出（だ）しました。", "romaji": "[Vt] Menzei no tame ni, reji de pasupooto wo dashimashita.", "cn": "[他] 为了办免税，在收银台拿出了护照（自动词：出る が出る）。"},
    "入れる": {"form": "⇄ 自他对比", "jp": "［他］スーツケースに冬物（ふゆもの）をぜんぶ入（い）れました。", "romaji": "[Vt] Suutsukeesu ni fuyumono wo zenbu iremashita.", "cn": "[他] 把冬装全都装进行李箱里了（自动词：入る が入る）。"},
    "置く": {"form": "N4 提前准备", "jp": "玄関（げんかん）にベビーカーをたたんで置（お）いておきました。", "romaji": "Genkan ni bebiikaa wo tatande oite okimashita.", "cn": "把婴儿车折叠好放在玄关了。"},
    "立つ": {"form": "N4 提示", "jp": "バスが揺（ゆ）れるので、走（はし）っている間（あいだ）は立（た）たないでください。", "romaji": "Basu ga yureru node, hashitte iru aida wa tatanaide kudasai.", "cn": "巴士会晃动，行驶期间请不要站立。"},
    "座る": {"form": "N4 结果存留", "jp": "あそこの窓側（まどがわ）の席（せき）が空（あ）いているから、座（すわ）りましょう。", "romaji": "Asoko no madogawa no seki ga aite iru kara, suwarimashou.", "cn": "那边靠窗的座位空着，咱们坐那里吧。"},
    "止まる": {"form": "⇄ 自他对比", "jp": "［自］雪（ゆき）のせいで、山手線（やまのてせん）が一時（いちじ）止（と）まっています。", "romaji": "[Vi] Yuki no sei de, Yamanote-sen ga ichiji tomatte imasu.", "cn": "[自] 因为下雪，山手线暂时停运了（他动词：止める を止める）。"},
    "始まる": {"form": "⇄ 自他对比", "jp": "［自］予約（よやく）していたお食事（しょくじ）が12時（じ）から始（はじ）まります。", "romaji": "[Vi] Yoyaku shite ita oshokuji ga juuniji kara hajimarimasu.", "cn": "[自] 预约好的午餐12点开始（他动词：始める を始める）。"},
    "終わる": {"form": "⇄ 自他对比", "jp": "［自］保育園（ほいくえん）が夕方（ゆうがた）4時（じ）に終（お）わります。", "romaji": "[Vi] Hoikuen ga yuugata yoji ni owarimasu.", "cn": "[自] 保育园下午4点放学（他动词：終える を終える）。"},
    "着く": {"form": "N4 条件", "jp": "ホテルに着（つ）いたら、すぐ荷ほどきをしてお風呂（ふろ）に入（はい）ろう。", "romaji": "Hoteru ni tsuitara, sugu nihodoki wo shite ofuro ni hairou.", "cn": "一到酒店，马上收拾行李去泡澡吧。"},
    "渡す": {"form": "N4 礼貌", "jp": "ルームキーをフロントの方（かた）に渡（わた）してチェックアウトしました。", "romaji": "Ruumu kii wo furonto no kata ni watashite chekkuauto shimashita.", "cn": "把房卡交给前台人员办理了退房。"},
    "もらう": {"form": "N4 授受", "jp": "ホテルのスタッフに近所（きんじょ）のおすすめ地図（ちず）をもらいました。", "romaji": "Hoteru no sutaffu ni kinjo no osusume chizu wo moraimashita.", "cn": "从酒店工作人员那里要了一份周边推荐地图。"},
    "あげる": {"form": "N4 授受", "jp": "お姉（ねえ）ちゃんが妹（いもうと）にミカンをむいてあげました。", "romaji": "Onee-chan ga imouto ni mikan wo muite agemashita.", "cn": "姐姐帮妹妹把橘子剥好了。"},
    "くれる": {"form": "N4 授受", "jp": "板前（いたまえ）さんが子（こ）ども用（よう）に小（ちい）さく切（き）ってくれました。", "romaji": "Itamae-san ga kodomoyou ni chiisaku kitte kuremashita.", "cn": "主厨特意为孩子切成了小块给我们。"},
    "借りる": {"form": "N4 借用", "jp": "フロントで子ども用（よう）のスリッパと歯（は）ブラシを借（か）りました。", "romaji": "Furonto de kodomoyou no surippa to haburashi wo karimashita.", "cn": "在前台借了儿童拖鞋和牙刷。"},
    "貸す": {"form": "N4 礼貌", "jp": "すみません、携帯（けいたい）の充電器（じゅうでんき）をお貸（か）しいただけますか？", "romaji": "Sumimasen, keitai no juudenki wo okashi itadakemasu ka?", "cn": "不好意思，可以借我用一下手机充电器吗？"},
    "払う": {"form": "N4 询问", "jp": "お会計（かいけい）は現金（げんきん）じゃなくても、Apple Payで払（はら）えますか？", "romaji": "Okaikei wa genkin ja nakutemo, Apple Pay de haraemasu ka?", "cn": "结账不用现金的话，可以用 Apple Pay 支付吗？"},
    "選ぶ": {"form": "N4 推荐", "jp": "どれを選（えら）べばいいか迷（まよ）ったら、店長（てんちょう）のおすすめにしましょう。", "romaji": "Dore wo erabeba ii ka mayottara, tenchou no osusume ni shimashou.", "cn": "犹豫选哪个好的话，就点店长推荐吧。"},
    "頼む": {"form": "N4 尝试", "jp": "せっかくだから、季節（きせつ）限定（げんてい）のデザートも頼（たの）んでみよう！", "romaji": "Sekkaku dakara, kisetsu gentei no dezaato mo tanonde miyou!", "cn": "难得来一趟，也点份季节限定甜品尝尝看吧！"},
    "決める": {"form": "⇄ 自他对比", "jp": "［他］明日（あした）の朝（あさ）ごはんは何（なに）にするか決（き）めましたか？", "romaji": "[Vt] Ashita no asagohan wa nani ni suru ka kimemashita ka?", "cn": "[他] 明早吃什么决定好了吗？（自动词：決まる が決まる）"},
    "変わる": {"form": "⇄ 自他对比", "jp": "［自］東京（とうきょう）と福岡（ふくおか）では天気（てんき）がガラッと変（か）わりました。", "romaji": "[Vi] Toukyou to Fukuoka dewa tenki ga garatto kawarimashita.", "cn": "[自] 东京和福冈的天气一下子变了（他动词：変える を変える）。"},
    "変える": {"form": "⇄ 自他对比", "jp": "［他］雨（あめ）なので、午後（ごご）の予定（よてい）を室内（しつない）に変（か）えましょう。", "romaji": "[Vt] Ame na node, gogo no yotei wo shitsunai ni kaemashou.", "cn": "[他] 下雨了，咱们把下午计划改成室内吧（自动词：変わる が変わる）。"},
    "始める": {"form": "⇄ 自他对比", "jp": "［他］みんな揃（そろ）ったので、そろそろ夕食（ゆうしょく）を始（はじ）めましょうか。", "romaji": "[Vt] Minna sorotta node, sorosoro yuushoku wo hajimemashou ka.", "cn": "[他] 大家都到齐了，差不多开始吃晚饭吧（自动词：始まる が始まる）。"},
    "続ける": {"form": "⇄ 自他对比", "jp": "［他］無理（むり）のないペースで会話（かいわ）の練習（れんしゅう）を続（つづ）けたいです。", "romaji": "[Vt] Muri no nai peesu de kaiwa no renshuu wo tsuzuketai desu.", "cn": "[他] 我想按轻松的节奏继续练习对话（自动词：続く が続く）。"},
    "動く": {"form": "⇄ 自他对比", "jp": "［自］あ、エレベーターがやっと動（うご）き始（はじ）めましたよ。", "romaji": "[Vi] A, erebeetaa ga yatto ugokihajimemashita yo.", "cn": "[自] 啊，电梯终于开始动起来了（他动词：動かす を動かす）。"},
    "届ける": {"form": "⇄ 自他对比", "jp": "［他］クロネコヤマトに荷物（にもつ）をホテルまで届（とど）けてもらいます。", "romaji": "[Vt] Kuroneko Yamato ni nimotsu wo hoteru made todokete moraimasu.", "cn": "[他] 请黑猫宅急便把行李送到酒店（自动词：届く が届く）。"},
    "届く": {"form": "⇄ 自他对比", "jp": "［自］空港（くうこう）から送（おく）ったスーツケースが無事（ぶじ）に届（とど）きました。", "romaji": "[Vi] Kuukou kara okutta suutsukeesu ga buji ni todokimashita.", "cn": "[自] 从机场寄来的行李箱平安送到了（他动词：届ける を届ける）。"},
    "預ける": {"form": "⇄ 自他对比", "jp": "［他］チェックアウト後（ご）、フロントに大（おお）きい荷物（にもつ）を預（あず）けました。", "romaji": "[Vt] Chekkuauto go, furonto ni ookii nimotsu wo azukemashita.", "cn": "[他] 退房后把大行李寄存在了前台（对应自动词：預かる）。"},
    "片付ける": {"form": "⇄ 自他对比", "jp": "［他］出（で）かける前（まえ）にテーブルの上（うえ）を片付（かたづ）けておこう。", "romaji": "[Vt] Dekakeru mae ni teeburu no ue wo katazukete okou.", "cn": "[他] 出门前先把桌子上收拾干净吧（自动词：片付く が片付く）。"},
    "助ける": {"form": "⇄ 自他对比", "jp": "［他］道（みち）に迷（まよ）っていた観光客（かんこうきゃく）を助（たす）けてあげました。", "romaji": "[Vt] Michi ni mayotte ita kankoukyaku wo tasukete agemashita.", "cn": "[他] 帮了迷路的游客一把（对应自动词：助かる）。"},
    "助かる": {"form": "⇄ 自他对比", "jp": "［自］ベビーカーを持（も）つとき手伝（てつだ）っていただいて、本当（ほんとう）に助（たす）かりました！", "romaji": "[Vi] Bebiikaa wo motsu toki tetsudatte itadaite, hontou ni tasukarimashita!", "cn": "[自] 抬婴儿车时承蒙您帮忙，真是帮了大忙！（他动词：助ける）。"},
    "治る": {"form": "⇄ 自他对比", "jp": "［自］よく休（やす）んだおかげで、風邪（かぜ）がすっかり治（なお）りました。", "romaji": "[Vi] Yoku yasunda okage de, kaze ga sukkari naorimashita.", "cn": "[自] 多亏好好休息了，感冒完全好了（他动词：治す を治す）。"},
    "治す": {"form": "⇄ 自他对比", "jp": "［他］早（はや）く薬（くすり）を飲（の）んで熱（ねつ）を治（なお）しましょうね。", "romaji": "[Vt] Hayaku kusuri wo nonde netsu wo naoshimashou ne.", "cn": "[他] 早点吃药把烧治好吧（自动词：治る が治る）。"},
    "落とす": {"form": "⇄ 自他对比", "jp": "［他］駅（えき）の改札（かいさつ）の近（ちか）くで切符（きっぷ）を落（お）としてしまいました。", "romaji": "[Vt] Eki no kaisatsu no chikaku de kippu wo otoshite shimaimashita.", "cn": "[他] 在车站检票口附近把车票弄丢了（自动词：落ちる が落ちる）。"},
    "落ちる": {"form": "⇄ 自他对比", "jp": "［自］バッグから手袋（てぶくろ）がポトッと落（お）ちましたよ！", "romaji": "[Vi] Baggu kara tebukuro ga pototto ochimashita yo!", "cn": "[自] 手套啪嗒从包里掉下来了哦！（他动词：落とす を落とす）。"},
    "壊れる": {"form": "⇄ 自他对比", "jp": "［自］スーツケースのキャスターが壊（こわ）れてしまったんです。", "romaji": "[Vi] Suutsukeesu no kyasutaa ga kowarete shimatta ndesu.", "cn": "[自] 行李箱的轮子坏掉了（他动词：壊す を壊す）。"},
    "壊す": {"form": "⇄ 自他对比", "jp": "［他］冷（つめ）たいものを食（た）べすぎて、お腹（なか）を壊（こわ）さないでね。", "romaji": "[Vt] Tsumetai mono wo tabesugite, onaka wo kowasanaide ne.", "cn": "[他] 别吃太多冰的把肚子吃坏了哦（自动词：壊れる）。"},
    "直る": {"form": "⇄ 自他对比", "jp": "［自］Wi-Fiの調子（ちょうし）、再起動（さいきどう）したらすぐ直（なお）りました。", "romaji": "[Vi] Wi-Fi no choushi, saikidou shitara sugu naorimashita.", "cn": "[自] Wi-Fi 状态重启一下马上就好了（他动词：直す を直す）。"},
    "直す": {"form": "⇄ 自他对比", "jp": "［他］ホテルの方（かた）がドアの鍵（かぎ）をすぐ直（なお）してくれました。", "romaji": "[Vt] Hoteru no kata ga doa no kagi wo sugu naoshite kuremashita.", "cn": "[他] 酒店工作人员马上把门锁修好了（自动词：直る が直る）。"},
    "汚れる": {"form": "⇄ 自他对比", "jp": "［自］雪（ゆき）でズボンの裾（すそ）が少（すこ）し汚（よご）れてしまいました。", "romaji": "[Vi] Yuki de zubon no suso ga sukoshi yogorete shimaimashita.", "cn": "[自] 雪把裤脚弄脏了一点（他动词：汚す を汚す）。"},
    "濡れる": {"form": "⇄ 自他对比", "jp": "［自］雪遊（ゆきあそ）びで手袋（てぶくろ）がびしょびしょに濡（ぬ）れちゃった。", "romaji": "[Vi] Yukiasobi de tebukuro ga bishobisho ni nurechatta.", "cn": "[自] 玩雪把手套弄得湿透了（他动词：濡らす を濡らす）。"},
    "乾く": {"form": "⇄ 自他对比", "jp": "［自］乾燥機（かんそうき）に入（い）れたら、1時間（じかん）でしっかり乾（かわ）きました。", "romaji": "[Vi] Kansouki ni iretara, ichijikan de shikkari kawakimashita.", "cn": "[自] 放进烘干机后1小时就彻底干了（他动词：乾かす を乾かす）。"},
    "温める": {"form": "⇄ 自他对比", "jp": "［他］すみません、この離乳食（りにゅうしょく）をレンジで温（あたた）めていただけますか？", "romaji": "[Vt] Sumimasen, kono rinyuushoku wo renji de atatamete itadakemasu ka?", "cn": "[他] 不好意思，可以帮我用微波炉加热一下这个婴儿辅食吗？（自动词：温まる）"},
    "冷やす": {"form": "⇄ 自他对比", "jp": "［他］買ったばかりのプリンを部屋（へや）の冷蔵庫（れいぞうこ）で冷（ひ）やしておこう。", "romaji": "[Vt] Katta bakari no purin wo heya no reizouko de hiyashite okou.", "cn": "[他] 把刚买的布丁放房间冰箱冰一下吧（自动词：冷える）。"},
    "焼く": {"form": "⇄ 自他对比", "jp": "［他］鉄板焼（てっぱんや）きは、ミディアムレアで焼（や）いてください。", "romaji": "[Vt] Teppanyaki wa, midiamu rea de yaite kudasai.", "cn": "[他] 铁板烧牛排请帮我煎五分熟（自动词：焼ける）。"},
    "混ぜる": {"form": "⇄ 自他对比", "jp": "［他］タレと生卵（なまたまご）をよく混（ま）ぜてから食（た）べると絶品（ぜっぴん）です。", "romaji": "[Vt] Tare to namatamago wo yoku mazete kara taberu to zeppin desu.", "cn": "[他] 把酱汁和生鸡蛋拌匀了再吃绝了！（自动词：混ざる）。"},
    "増える": {"form": "⇄ 自他对比", "jp": "［自］お土産（みやげ）を買（か）いすぎて、荷物がどんどん増（ふ）えてきたね。", "romaji": "[Vi] Omiyage wo kaisugite, nimotsu ga dondon fuete kita ne.", "cn": "[自] 伴手礼买太多，行李越变越多了呢（他动词：増やす を増やす）。"},
    "減る": {"form": "⇄ 自他对比", "jp": "［自］たくさん歩（ある）いたらお腹（なか）が減（へ）ってきました！", "romaji": "[Vi] Takusan aruitara onaka ga hette kimashita!", "cn": "[自] 走了好多路，肚子饿扁了！（他动词：減らす を減らす）。"},
    "上がる": {"form": "⇄ 自他对比", "jp": "［自］靴（くつ）を脱（ぬ）いで、どうぞお部屋（へや）へお上（あ）がりください。", "romaji": "[Vi] Kutsu wo nuide, douzo oheya e oagari kudasai.", "cn": "[自] 请脱鞋进屋吧（他动词：上げる を上げる）。"},
    "下がる": {"form": "⇄ 自他对比", "jp": "［自］一晩（ひとばん）寝（ね）たら熱（ねつ）も下（さ）がって元気（げんき）になりました。", "romaji": "[Vi] Hitoban netara netsu mo sagatte genki ni narimashita.", "cn": "[自] 睡了一晚烧也退了，恢复精神了（他动词：下げる を下げる）。"},
    "上げる": {"form": "⇄ 自他对比", "jp": "［他］暖房（だんぼう）の温度（おんど）をもう2度（ど）上（あ）げていただけますか？", "romaji": "[Vt] Danbou no ondo wo mou nido agete itadakemasu ka?", "cn": "[他] 请问能把暖气温度再调高2度吗？（自动词：上がる が上がる）。"},
    "下げる": {"form": "⇄ 自他对比", "jp": "［他］子（こ）どもが寝（ね）ているので、声（こえ）を少（すこ）し下（さ）げましょう。", "romaji": "[Vt] Kodomo ga nete iru node, koe wo sukoshi sagemashou.", "cn": "[他] 孩子在睡觉，咱们把声音放低一点吧（自动词：下がる が下がる）。"},
    "並ぶ": {"form": "⇄ 自他对比", "jp": "［自］有名（ゆうめい）なラーメン屋（や）の前（まえ）に長い列（れつ）が並（なら）んでいます。", "romaji": "[Vi] Yuumei na raamen-ya no mae ni nagai retsu ga narande imasu.", "cn": "[自] 有名拉面店前面排着长队（他动词：並べる を並べる）。"},
    "並べる": {"form": "⇄ 自他对比", "jp": "［他］玄関（げんかん）で靴（くつ）をきれいに並（なら）べて脱（ぬ）ぎました。", "romaji": "[Vt] Genkan de kutsu wo kirei ni narabete nugimashita.", "cn": "[他] 在玄关把鞋子脱下来整齐排好了（自动词：並ぶ が並ぶ）。"},
    "集まる": {"form": "⇄ 自他对比", "jp": "［自］9時（じ）までにロビーに家族（かぞく）みんなで集（あつ）まりましょう。", "romaji": "[Vi] Kuji made ni robii ni kazoku minna de atsumarimashou.", "cn": "[自] 9点前全家在大厅集合吧（他动词：集める を集める）。"},
    "集める": {"form": "⇄ 自他对比", "jp": "［他］駅のスタンプを集（あつ）めるのが娘（むすめ）のブームです。", "romaji": "[Vt] Eki no sutanpu wo atsumeru no ga musume no buumu desu.", "cn": "[他] 收集车站印章现在是女儿的心头好（自动词：集まる が集まる）。"},
    "通る": {"form": "⇄ 自他对比", "jp": "［自］すみません、ちょっと前（まえ）を通（とお）ります。", "romaji": "[Vi] Sumimasen, chotto mae wo toorimasu.", "cn": "[自] 不好意思，从您前面过一下（他动词：通す を通す）。"},
    "戻る": {"form": "⇄ 自他对比", "jp": "［自］傘（かさ）を忘（わす）れたので、いったん部屋（へや）に戻（もど）りますね。", "romaji": "[Vi] Kasa wo wasureta node, ittan heya ni modorimasu ne.", "cn": "[自] 忘带伞了，我先回一趟房间哦（他动词：戻す を戻す）。"},
    "残る": {"form": "⇄ 自他对比", "jp": "［自］まだお湯（ゆ）がポットに残（のこ）っていますか？", "romaji": "[Vi] Mada oyu ga potto ni nokotte imasu ka?", "cn": "[自] 保温壶里还有剩下的热水吗？（他动词：残す を残す）。"},
    "残す": {"form": "⇄ 自他对比", "jp": "［他］量（りょう）が多（おお）くて少（すこ）し残（のこ）してしまい、すみません。", "romaji": "[Vt] Ryou ga ookute sukoshi nokoshite shimai, sumimasen.", "cn": "[他] 份量太大没吃完剩了一点，真不好意思（自动词：残る が残る）。"},
    "育てる": {"form": "⇄ 自他对比", "jp": "［他］サンフランシスコで二人（ふたり）の娘（むすめ）を育（そだ）てています。", "romaji": "[Vt] San Furanshisuko de futari no musume wo sodatete imasu.", "cn": "[他] 我们在旧金山抚养着两个女儿（自动词：育つ が育つ）。"},
    "育つ": {"form": "⇄ 自他对比", "jp": "［自］子どもが35日（にち）の旅（たび）を通（とお）してたくましく育（そだ）ちました。", "romaji": "[Vi] Kodomo ga sanjuugonichi no tabi wo tooshite takumashiku sodachimashita.", "cn": "[自] 孩子在35天的旅行中茁壮成长了（他动词：育てる を育てる）。"},
}

# 100 curated new N4->N3 verbs (v-201..v-300)
# Tuple: (dict, jp_ruby, kana, romaji, cn, jlpt, group, category, transitivity, particles, ex1, ex2, ex3, overrides)
# ex = (form, jp, romaji, cn)
NEW_VERBS_SPEC = [
    # --- 1-27: Completing missing halves of core Vi/Vt pairs ---
    ("開く", "開（あ）く", "あく", "aku", "开、开启、营业（自动词）", "N5", "godan", "生活起居", "vi", "〜が 開く",
     ("ます形", "この店（みせ）は何時（なんじ）に開（あ）きますか？", "Kono mise wa nanji ni akimasu ka?", "这家店几点开门营业？"),
     ("ている形", "あ、左（ひだり）の窓（まど）が開（あ）いていますよ。", "A, hidari no mado ga aite imasu yo.", "啊，左边的窗户开着呢。"),
     ("⇄ 自他对比", "［自］自動（じどう）ドアがゆっくり開（あ）きました（他：開ける）。", "[Vi] Jidou doa ga yukkuri akimashita.", "[自] 自动门慢慢开了（对比他动词：ドアを開ける）。"), None),

    ("閉まる", "閉（し）まる", "しまる", "shimaru", "关上、关闭（自动词）", "N5", "godan", "生活起居", "vi", "〜が 閉まる",
     ("ます形", "そろそろお店（みせ）が閉（し）まりますよ。", "Sorosoro omise ga shimarimasu yo.", "店差不多要关门了哦。"),
     ("ている形", "ドアがちゃんと閉（し）まっているか確認（かくにん）しよう。", "Doa ga chanto shimatte iru ka kakunin shiyou.", "确认一下门有没有关严吧。"),
     ("⇄ 自他对比", "［自］エレベーターのドアが閉（し）まります（他：閉める）。", "[Vi] Erebeetaa no doa ga shimarimasu.", "[自] 电梯门要关了（对比他动词：ドアを閉める）。"), None),

    ("つく", "つく（点く）", "つく", "tsuku", "亮起、开启（灯/暖气 · 自动词）", "N4", "godan", "生活起居", "vi", "〜が つく",
     ("ています", "廊下（ろうか）の電気（でんき）がまだついています。", "Rouka no denki ga mada tsuite imasu.", "走廊的灯还亮着。"),
     ("ない形", "すみません、部屋（へや）の暖房（だんぼう）がつかないんです。", "Sumimasen, heya no danbou ga tsukanai ndesu.", "不好意思，房间的暖气打不开。"),
     ("⇄ 自他对比", "［自］あ、ストーブがやっとつきました！（他：つける）。", "[Vi] A, sutoobu ga yatto tsukimashita!", "[自] 啊，取暖器终于亮起来了！（他动词：〜をつける）。"), None),

    ("消える", "消（き）える", "きえる", "kieru", "熄灭、消失（灯/字迹 · 自动词）", "N5", "ichidan", "生活起居", "vi", "〜が 消える",
     ("た形", "さっき廊下（ろうか）の電気（でんき）が自然（しぜん）に消（き）えました。", "Sakki rouka no denki ga shizen ni kiemashita.", "刚才走廊的灯自动熄灭了。"),
     ("て形", "画面（がめん）が消（き）えてしまって、QRコードが見（み）えません。", "Gamen ga kiete shimatte, QR koodo ga miemasen.", "屏幕黑掉了，看不到二维码。"),
     ("⇄ 自他对比", "［自］雪（ゆき）が溶（と）けて足跡（あしあと）が消（き）えました（他：消す）。", "[Vi] Yuki ga tokete ashiato ga kiemashita.", "[自] 雪化了脚印就消失了（对比他动词：電気を消す）。"), None),

    ("終える", "終（お）える", "おえる", "oeru", "完成、结束（某事 · 他动词）", "N3", "ichidan", "核心基础", "vt", "〜を 終える",
     ("た形", "やっとすべての荷物（にもつ）の整理（せいり）を終（お）えました。", "Yatto subete no nimotsu no seiri wo oemashita.", "终于把所有行李整理完了。"),
     ("て形", "夕食（ゆうしょく）を終（お）えてから温泉（おんせん）に行（い）きましょう。", "Yuushoku wo oete kara onsen ni ikimashou.", "吃完晚饭后再去泡温泉吧。"),
     ("⇄ 自他对比", "［他］35日（にち）の旅（たび）を無事（ぶじ）に終（お）えました（自：終わる）。", "[Vt] Sanjuugonichi no tabi wo buji ni oemashita.", "[他] 平安结束了35天的旅程（自动词：旅が終わる）。"), None),

    ("見つかる", "見（み）つかる", "みつかる", "mitsukaru", "被找到、被发现（自动词）", "N4", "godan", "生活起居", "vi", "〜が 見つかる",
     ("た形", "あ、なくしたと思（おも）っていたパスポートが見（み）つかりました！", "A, nakushita to omotte ita pasupooto ga mitsukarimashita!", "啊，以为丢了的护照找到了！"),
     ("ない形", "なかなかベビーカーで入（はい）れるお店（みせ）が見（み）つかりません。", "Nakanaka bebiikaa de haireru omise ga mitsukarimasen.", "一直没找到能推婴儿车进去的店。"),
     ("⇄ 自他对比", "［自］駅（えき）の落（お）とし物（もの）センターで手袋（てぶくろ）が見（み）つかったよ（他：見つける）。", "[Vi] Eki no otoshimono sentaa de tebukuro ga mitsukatta yo.", "[自] 在车站失物招领处找到手套了哦！（他动词：〜を見つける）。"), None),

    ("決まる", "決（き）まる", "きまる", "kimaru", "定下来、决定好（自动词）", "N4", "godan", "思考情绪", "vi", "〜が 決まる",
     ("た形", "今夜（こんや）のレストランがやっと決（き）まりました！", "Kon'ya no resutoran ga yatto kimarimashita!", "今晚的餐厅终于定下来了！"),
     ("ている形", "出発（しゅっぱつ）の時間（じかん）はもう決（き）まっていますか？", "Shuppatsu no jikan wa mou kimatte imasu ka?", "出发时间已经定下来了吗？"),
     ("⇄ 自他对比", "［自］席（せき）が決（き）まったらご連絡（れんらく）ください（他：決める）。", "[Vi] Seki ga kimattara gorenraku kudasai.", "[自] 座位定下来后请联系我（他动词：〜を決める）。"), None),

    ("続く", "続（つづ）く", "つづく", "tsuzuku", "持续、继续下去（自动词）", "N4", "godan", "核心基础", "vi", "〜が 続く",
     ("ている形", "昨日（きのう）からずっと気持（きも）ちのいい晴（は）れが続（つづ）いています。", "Kinou kara zutto kimochi no ii hare ga tsuzuite imasu.", "从昨天起一直持续着舒爽的晴天。"),
     ("ます形", "この先（さき）、ずっと上（のぼ）り坂（ざか）が続（つづ）きますよ。", "Kono saki, zutto noborizaka ga tsuzukimasu yo.", "前面一直都是上坡路哦。"),
     ("⇄ 自他对比", "［自］楽しい毎日（まいにち）がもう3週間（しゅうかん）も続（つづ）いています（他：続ける）。", "[Vi] Tanoshii mainichi ga mou sanshuukan mo tsuzuite imasu.", "[自] 愉快的每一天已经持续3周了（他动词：〜を続ける）。"), None),

    ("動かす", "動（うご）かす", "うごかす", "ugokasu", "移动、挪动、开动（他动词）", "N4", "godan", "移动交通", "vt", "〜を 動かす",
     ("て形", "すみません、スーツケースを少（すこ）し動（うご）かしてもいいですか？", "Sumimasen, suutsukeesu wo sukoshi ugokashite mo ii desu ka?", "不好意思，能把行李箱稍微挪一下吗？"),
     ("ない形", "腰（こし）が痛（いた）いので、あまり重（おも）いものは動（うご）かさないで。", "Koshi ga itai node, amari omoi mono wa ugokasanaide.", "腰疼，别搬太重的东西。"),
     ("⇄ 自他对比", "［他］テーブルを少（すこ）し右（みぎ）へ動（うご）かしました（自：動く）。", "[Vt] Teeburu wo sukoshi migi e ugokashimashita.", "[他] 把桌子往右挪了一点（自动词：〜が動く）。"), None),

    ("預かる", "預（あず）かる", "あずかる", "azukaru", "代为保管、收下照管（酒店方视角）", "N3", "godan", "生活起居", "vt", "〜を お預かりする",
     ("ます形", "【店员说】お荷物（にもつ）、フロントでお預（あず）かりしますね。", "Onimotsu, furonto de oazukari shimasu ne.", "【店员】您的行李我们前台帮您保管哦。"),
     ("た形", "チェックインまで大きいバッグを預（あず）かってもらえました。", "Chekkuin made ookii baggu wo azukatte moraemashita.", "入住前酒店帮我们把大包收下保管了。"),
     ("⇄ 自他对比", "ホテルが荷物を「預（あず）かる」、私たちが「預（あず）ける」です。", "Hoteru ga nimotsu wo azukaru, watashitachi ga azukeru desu.", "酒店方“替客人保管”是「預かる」，客人“寄放”是「預ける」！"), None),

    ("片付く", "片付（かたづ）く", "かたづく", "katazuku", "收拾整齐、解决完毕（自动词）", "N3", "godan", "生活起居", "vi", "〜が 片付く",
     ("た形", "わあ、お部屋（へや）がすっきり片付（かたづ）きましたね！", "Waa, oheya ga sukkiri katazukimashita ne!", "哇，房间收拾得真整洁呀！"),
     ("ない形", "おもちゃが多（おお）くて、なかなか部屋（へや）が片付（かたづ）きません。", "Omocha ga ookute, nakanaka heya ga katazukimasen.", "玩具太多了，房间怎么也收拾不完。"),
     ("⇄ 自他对比", "［自］荷物（にもつ）が一通（ひととお）り片付（かたづ）いたら出（で）かけよう（他：片付ける）。", "[Vi] Nimotsu ga hitotoori katazuitara dekakeyou.", "[自] 行李大致收好后就出门吧（他动词：〜を片付ける）。"), None),

    ("汚す", "汚（よご）す", "よごす", "yogosu", "弄脏（他动词）", "N4", "godan", "亲子游玩", "vt", "〜を 汚す",
     ("て形", "うっかりシャツにラーメンの汁（しる）を飛（と）ばして汚（よご）しちゃった！", "Ukkari shatsu ni raamen no shiru wo tobashite yogoshichatta!", "一不小心把拉面汤溅到衬衫上弄脏了！"),
     ("ない形", "畳（たたみ）を汚（よご）さないように気（き）をつけて食べようね。", "Tatami wo yogosanai you ni ki wo tsukete tabeyou ne.", "小心别把榻榻米弄脏，仔细吃哦。"),
     ("⇄ 自他对比", "［他］泥（どろ）で靴（くつ）を汚（よご）さないでね（自：汚れる）。", "[Vt] Doro de kutsu wo yogosanaide ne.", "[他] 别用泥巴把鞋弄脏了哦（自动词：靴が汚れる）。"), None),

    ("濡らす", "濡（ぬ）らす", "ぬらす", "nurasu", "弄湿、打湿（他动词）", "N4", "godan", "生活起居", "vt", "〜を 濡らす",
     ("て形", "冷（つめ）たいタオルを水（みず）で濡（ぬ）らして拭（ふ）いてあげよう。", "Tsumetai taoru wo mizu de nurashite fuite ageyou.", "用冷水把毛巾浸湿帮她擦一擦吧。"),
     ("ない形", "スマホを濡（ぬ）らさないように防水（ぼうすい）ケースに入（い）れました。", "Sumaho wo nurasanai you ni bousui keesu ni iremashita.", "为了不弄湿手机，装进了防水袋里。"),
     ("⇄ 自他对比", "［他］温泉（おんせん）で髪（かみ）を濡（ぬ）らさないように気（き）をつけます（自：濡れる）。", "[Vt] Onsen de kami wo nurasanai you ni ki wo tsukemasu.", "[他] 泡温泉时注意别弄湿头发（自动词：髪が濡れる）。"), None),

    ("乾かす", "乾（かわ）かす", "かわかす", "kawakasu", "烘干、吹干、晾干（他动词）", "N4", "godan", "生活起居", "vt", "〜を 乾かす",
     ("ます形", "お風呂（ふろ）から出（で）たら、すぐドライヤーで髪（かみ）を乾（かわ）かします。", "Ofuro kara detara, sugu doraiyaa de kami wo kawakashimasu.", "出浴后马上用吹风机把头发吹干。"),
     ("て形", "濡（ぬ）れたスキーウェアを乾燥室（かんそうしつ）で乾（かわ）かしておこう。", "Nureta sukii wea wo kansoushitsu de kawakashite okou.", "把湿掉的滑雪服放干燥室烘干吧。"),
     ("⇄ 自他对比", "［他］コインランドリーで洗濯物（せんたくもの）を乾（かわ）かしました（自：乾く）。", "[Vt] Koin randorii de sentakumono wo kawakashimashita.", "[他] 在投币洗衣房把衣服烘干了（自动词：服が乾く）。"), None),

    ("温まる", "温（あたた）まる", "あたたまる", "atatamaru", "变暖和、暖身（自动词）", "N3", "godan", "生活起居", "vi", "〜が 温まる",
     ("た形", "温泉（おんせん）に入（はい）って、体（からだ）の芯（しん）まで温（あたた）まりました！", "Onsen ni haitte, karada no shin made atatamarimashita!", "泡了温泉，从里到外整个身子都暖和起来了！"),
     ("ます形", "熱（あつ）い豚骨（とんこつ）ラーメンを食べると心（こころ）まで温（あたた）まりますね。", "Atsui tonkotsu raamen wo taberu to kokoro made atatamarimasu ne.", "吃一碗滚烫的豚骨拉面连心都暖了呢。"),
     ("⇄ 自他对比", "［自］部屋（へや）がやっと温（あたた）まってきました（他：温める）。", "[Vi] Heya ga yatto atatamatte kimashita.", "[自] 房间终于暖和起来了（对比他动词：牛乳を温める）。"), None),

    ("冷える", "冷（ひ）える", "ひえる", "hieru", "变凉、身体受凉（自动词）", "N4", "ichidan", "生活起居", "vi", "〜が 冷える",
     ("ます形", "夕方（ゆうがた）になると急に冷（ひ）えるので、上着（うわぎ）を持（も）って行（い）こう。", "Yuugata ni naru to kyuu ni hieru node, uwagi wo motte ikou.", "一到傍晚就会突然变冷，带着外套出门吧。"),
     ("ている形", "このビール、キンキンに冷（ひ）えていて最高（さいこう）ですね！", "Kono biiru, kinkin ni hiete ite saikou desu ne!", "这杯啤酒冰镇得透心凉，太棒了！"),
     ("⇄ 自他对比", "［自］おなかが冷（ひ）えないように毛布（もうふ）をかけよう（他：冷やす）。", "[Vi] Onaka ga hienai you ni moufu wo kakeyou.", "[自] 盖好毯子免得肚子着凉（他动词：飲み物を冷やす）。"), None),

    ("焼ける", "焼（や）ける", "やける", "yakeru", "烤好、晒黑、烧焦（自动词）", "N4", "ichidan", "饮食点餐", "vi", "〜が 焼ける",
     ("た形", "あ、おいしそうにパンがこんがり焼（や）けましたよ！", "A, oishisou ni pan ga kongari yakemashita yo!", "啊，面包烤得金黄酥脆、看起来好香！"),
     ("ている形", "このお肉（にく）、ちょうどよく焼（や）けていますね。", "Kono oniku, choudo yoku yakete imasu ne.", "这块肉火候烤得刚刚好呢。"),
     ("⇄ 自他对比", "［自］焼き鳥（やきとり）がもうすぐ焼（や）けますよ（他：焼く）。", "[Vi] Yakitori ga mou sugu yakemasu yo.", "[自] 烤鸡串马上就烤好了哦（他动词：お肉を焼く）。"), None),

    ("混ざる", "混（ま）ざる", "まざる", "mazaru", "混在一起、掺杂（自动词）", "N3", "godan", "饮食点餐", "vi", "〜が 混ざる",
     ("ている形", "ソースとマヨネーズがうまく混（ま）ざっておいしいです。", "Soosu to mayoneezu ga umaku mazatte oishii desu.", "酱汁和蛋黄酱融合得很好，太香了。"),
     ("ない形", "油（あぶら）と水（みず）はなかなか混（ま）ざりません。", "Abura to mizu wa nakanaka mazarimasen.", "油和水很难混到一起。"),
     ("⇄ 自他对比", "［自］大人（おとな）の列（れつ）に子（こ）どもが混（ま）ざっています（他：混ぜる）。", "[Vi] Otona no retsu ni kodomo ga mazatte imasu.", "[自] 大人的队伍里混着小朋友（他动词：〜を混ぜる）。"), None),

    ("増やす", "増（ふ）やす", "ふやす", "fuyasu", "增加、增多（他动词）", "N4", "godan", "核心基础", "vt", "〜を 増やす",
     ("ます形", "旅行（りょこう）の思い出（おもいで）の写真（しゃしん）をもっと増（ふ）やしたいです。", "Ryokou no omoide no shashin wo motto fuyashitai desu.", "我想多拍一些旅行回忆的照片。"),
     ("た形", "日本語（にほんご）の語彙（ごい）を毎日（まいにち）少（すこ）しずつ増（ふ）やしました。", "Nihongo no goi wo mainichi sukoshi zutsu fuyashimashita.", "每天一点一点地增加了日语词汇量。"),
     ("⇄ 自他对比", "［他］スーツケースの中身（なかみ）はあまり増（ふ）やさないようにしよう（自：増える）。", "[Vt] Suutsukeesu no nakami wa amari fuyasanai you ni shiyou.", "[他] 尽量别让行李箱里的东西变太多（自动词：荷物が増える）。"), None),

    ("減らす", "減（へ）らす", "へらす", "herasu", "减少、削减（他动词）", "N3", "godan", "核心基础", "vt", "〜を 減らす",
     ("て形", "移動（いどう）の日（ひ）は荷物（にもつ）をできるだけ減（へ）らして身軽（みがる）にします。", "Idou no hi wa nimotsu wo dekiru dake herashite migaru ni shimasu.", "换酒店那天尽量精简行李，轻装出发。"),
     ("ます形", "ご飯（はん）の量（りょう）を少（すこ）し減（へ）らしていただけますか？", "Gohan no ryou wo sukoshi herashite itadakemasu ka?", "米饭的量可以帮我稍微少盛一点吗？"),
     ("⇄ 自他对比", "［他］無駄遣（むだづか）いを減（へ）らして貯金（ちょきん）します（自：減る）。", "[Vt] Mudazukai wo herashite chokin shimasu.", "[他] 减少乱花钱存起来（自动词：お金が減る）。"), None),

    ("止める", "止（と）める", "とめる", "tomeru", "停下、关闭、固定住（他动词）", "N4", "ichidan", "移动交通", "vt", "〜を 止める",
     ("て形", "運転手（うんてんしゅ）さん、あそこの角（かど）で車（くるま）を止（と）めてください。", "Untenshu-san, asoko no kado de kuruma wo tomete kudasai.", "司机师傅，请在那边的拐角把车停一下。"),
     ("ます形", "危（あぶ）ないから、すぐエレベーターを止（と）めましょう。", "Abunai kara, sugu erebeetaa wo tomemashou.", "很危险，赶紧停掉电梯吧。"),
     ("⇄ 自他对比", "［他］駅（えき）の前（まえ）に自転車（じてんしゃ）を止（と）めました（自：止まる）。", "[Vt] Eki no mae ni jitensha wo tomemashita.", "[他] 在车站前面停了自行车（自动词：車が止まる）。"), None),

    ("通す", "通（とお）す", "とおす", "toosu", "通过、穿透、引导进入（他动词）", "N3", "godan", "移动交通", "vt", "〜を 通す",
     ("て形", "奥（おく）の個室（こしつ）へ通（とお）していただけますか？", "Oku no koshitsu e tooshite itadakemasu ka?", "可以请您带我们进里面的包厢吗？"),
     ("ます形", "すみません、ちょっと通（とお）してもらえますか？（人混み）", "Sumimasen, chotto tooshite moraemasu ka?", "不好意思，能让我过一下吗？"),
     ("⇄ 自他对比", "［他］風（かぜ）を通（とお）すために窓（まど）を開（あ）けました（自：通る）。", "[Vt] Kaze wo toosu tame ni mado wo akemashita.", "[他] 为了通风把窗户打开了（自动词：風が通る）。"), None),

    ("戻す", "戻（もど）す", "もどす", "modosu", "放回原处、还原、归还（他动词）", "N4", "godan", "生活起居", "vt", "〜を 戻す",
     ("て形", "使（つか）ったおもちゃは元（もと）の場所（ばしょ）に戻（もど）してね。", "Tsukatta omocha wa moto no basho ni modoshite ne.", "玩完的玩具要放回原位哦。"),
     ("ます形", "すみません、音量（おんりょう）を少（すこ）し元（もと）に戻（もど）しますね。", "Sumimasen, onryou wo sukoshi moto ni modoshimasu ne.", "不好意思，我把音量稍微调回原样哦。"),
     ("⇄ 自他对比", "［他］椅子（いす）をテーブルの下（した）に戻（もど）しました（自：戻る）。", "[Vt] Isu wo teeburu no shita ni modoshimashita.", "[他] 把椅子推回桌子下面了（自动词：部屋に戻る）。"), None),

    ("起こす", "起（お）こす", "おこす", "okosu", "叫醒、扶起、引发（他动词）", "N4", "godan", "生活起居", "vt", "〜を 起こす",
     ("て形", "明日（あした）は7時（じ）に起（お）こしてくださいね。", "Ashita wa shichiji ni okoshite kudasai ne.", "明天请7点叫醒我哦。"),
     ("ない形", "Jaycieがぐっすり寝（ね）てるから、起（お）こさないでそっとしよう。", "Jaycie ga gussuri neteru kara, okosanaide sotto shiyou.", "Jaycie 睡得正香，别吵醒她轻轻的。"),
     ("⇄ 自他对比", "［他］転（ころ）んだ子（こ）どもを優（やさ）しく起（お）こしてあげました（自：起きる）。", "[Vt] Koronda kodomo wo yasashiku okoshite agemashita.", "[他] 温柔地把摔倒的孩子扶了起来（自动词：起きる）。"), None),

    ("寝かせる", "寝（ね）かせる", "ねかせる", "nekaseru", "哄睡、放倒放置（他动词）", "N3", "ichidan", "亲子游玩", "vt", "〜を 寝かせる",
     ("て形", "先（さき）に娘（むすめ）たちを寝（ね）かせてから、荷物（にもつ）を整理（せいり）しよう。", "Saki ni musumetachi wo nekasete kara, nimotsu wo seiri shiyou.", "先把女儿们哄睡着，再整理行李吧。"),
     ("ます形", "ベビーカーのリクライニングを倒（たお）して寝（ね）かせます。", "Bebiikaa no rikurainingu wo taoshite nekasemasu.", "把婴儿车靠背放平让她睡觉。"),
     ("⇄ 自他对比", "［他］8時（じ）にはベッドに寝（ね）かせたいです（自：寝る）。", "[Vt] Hachiji ni wa beddo ni nekasetai desu.", "[他] 想在8点前把她哄到床上睡着（自动词：寝る）。"), None),

    ("乗せる", "乗（の）せる", "のせる", "noseru", "放上去、载上、让搭乘（他动词）", "N4", "ichidan", "移动交通", "vt", "〜に 〜を 乗せる",
     ("て形", "ベビーカーに荷物（にもつ）を乗（の）せて運（はこ）びましょう。", "Bebiikaa ni nimotsu wo nosete hakobimashou.", "把行李放到婴儿车上推着走吧。"),
     ("ます形", "ご飯（はん）の上（うえ）にお刺身（さしみ）を乗（の）せて海鮮丼（かいせんどん）にします！", "Gohan no ue ni osashimi wo nosete kaisendon ni shimasu!", "把生鱼片铺在米饭上做成海鲜盖饭！"),
     ("⇄ 自他对比", "［他］トランクに大（おお）きいスーツケースを乗（の）せました（自：乗る）。", "[Vt] Toranku ni ookii suutsukeesu wo nosemashita.", "[他] 把大行李箱装上了后备箱（自动词：電車に乗る）。"), None),

    ("降ろす", "降（お）ろす", "おろす", "orosu", "卸下、让下车、取钱（他动词）", "N4", "godan", "移动交通", "vt", "〜を 降ろす",
     ("て形", "すみません、ここで荷物を降（お）ろしてもいいですか？", "Sumimasen, koko de nimotsu wo oroshite mo ii desu ka?", "不好意思，请问可以在这里卸行李吗？"),
     ("ます形", "コンビニのATMで日本円（にほんえん）を少し降（お）ろしておきます。", "Konbini no ATM de Nihon'en wo sukoshi oroshite okimasu.", "我在便利店 ATM 先取一点日元现金。"),
     ("⇄ 自他对比", "［他］眠（ねむ）った娘（むすめ）をそっとベッドに降（お）ろしました（自：降りる）。", "[Vt] Nemutta musume wo sotto beddo ni oroshimashita.", "[他] 把睡着的女儿轻轻放到了床上（自动词：電車を降りる）。"), None),

    # --- 28-53: 13 Brand New Complete Vi/Vt Pairs (26 verbs) ---
    ("掛かる", "掛（か）かる", "かかる", "kakaru", "花费(时间/钱)、挂着、上锁（自动词）", "N4", "godan", "核心基础", "vi", "〜が 掛かる",
     ("ます形", "品川（しながわ）から銀座（ぎんざ）まで電車（でんしゃ）で15分（ふん）ほど掛（か）かります。", "Shinagawa kara Ginza made densha de juugofun hodo kakarimasu.", "从品川到银座坐电车大概要花15分钟。"),
     ("ている形", "ドアに「準備中（じゅんびちゅう）」の札（ふだ）が掛（か）かっています。", "Doa ni 'junbichuu' no fuda ga kakatte imasu.", "门上挂着“准备中”的牌子。"),
     ("⇄ 自他对比", "［自］ホテルの入口（いりぐち）に鍵（かぎ）が掛（か）かっています（他：掛ける）。", "[Vi] Hoteru no iriguchi ni kagi ga kakatte imasu.", "[自] 酒店入口锁着门（他动词：鍵を掛ける）。"), None),

    ("掛ける", "掛（か）ける", "かける", "kakeru", "挂上、锁门、打电话、浇酱汁（他动词）", "N4", "ichidan", "生活起居", "vt", "〜を 掛ける",
     ("て形", "部屋（へや）を出（で）るとき、ちゃんと鍵（かぎ）を掛（か）けた？", "Heya wo deru toki, chanto kagi wo kaketa?", "出门的时候锁好门了吗？"),
     ("ます形", "ご迷惑（めいわく）をお掛（か）けして申し訳（もうしわけ）ありません。", "Gomeiwaku wo okake shite moushiwake arimasen.", "给您添麻烦了，非常抱歉（高频礼貌固定搭配）。"),
     ("⇄ 自他对比", "［他］コートをハンガーに掛（か）けておきました（自：掛かる）。", "[Vt] Kooto wo hangaa ni kakete okimashita.", "[他] 把大衣挂在衣架上了（自动词：壁に掛かる）。"), None),

    ("抜ける", "抜（ぬ）ける", "ぬける", "nukeru", "脱落、遗漏、穿过（自动词）", "N3", "ichidan", "生活起居", "vi", "〜が 抜ける",
     ("て形", "あっ、メモから予約番号（よやくばんごう）が抜（ぬ）けていました！", "A, memo kara yoyaku bangou ga nukete imashita!", "啊，备忘录里漏掉预约号了！"),
     ("た形", "この裏道（うらみち）を抜（ぬ）けると、すぐ銀座（ぎんざ）に出（で）ますよ。", "Kono uramichi wo nukeru to, sugu Ginza ni demasu yo.", "穿过这条小路，马上就到银座了哦。"),
     ("⇄ 自他对比", "［自］疲れ（つかれ）が一気（いっき）に抜（ぬ）けました（他：抜く）。", "[Vi] Tsukare ga ikki ni nukemashita.", "[自] 疲劳一下子消散了（他动词：〜を抜く）。"), None),

    ("抜く", "抜（ぬ）く", "ぬく", "nuku", "拔出、去掉(食材)、跳过（他动词）", "N3", "godan", "饮食点餐", "vt", "〜を 抜く",
     ("て形", "すみません、子（こ）ども用（よう）の料理（りょうり）はわさびを抜（ぬ）いていただけますか？", "Sumimasen, kodomoyou no ryouri wa wasabi wo nuite itadakemasu ka?", "不好意思，孩子的餐食可以去掉芥末吗？"),
     ("ます形", "コンセントからプラグを抜（ぬ）いておいてね。", "Konsento kara puragu wo nuite oite ne.", "记得把插头从插座拔下来哦。"),
     ("⇄ 自他对比", "［他］ネギ抜（ぬ）きでお願いできますか？（自：抜ける）。", "[Vt] Negi nuki de onegai dekimasu ka?", "[他] 可以不要葱吗？（〜抜き＝去掉某配料）。"), None),

    ("折れる", "折（お）れる", "おれる", "oreru", "折断、弯折、拐弯（自动词）", "N4", "ichidan", "生活起居", "vi", "〜が 折れる",
     ("て形", "強風（きょうふう）でビニール傘（がさ）の骨（ほね）が折（お）れてしまいました。", "Kyoufuu de biniiru gasa no hone ga orete shimaimashita.", "大风把塑料伞的伞骨吹折了。"),
     ("た形", "クレヨンがポキッと折（お）れちゃったね。", "Kureyon ga pokitto orechatta ne.", "蜡笔咔嚓一下折断了呀。"),
     ("⇄ 自他对比", "［自］雪（ゆき）の重（おも）みで木（き）の枝（えだ）が折（お）れています（他：折る）。", "[Vi] Yuki no omomi de ki no eda ga orete imasu.", "[自] 树枝被积雪压折了（他动词：枝を折る）。"), None),

    ("折る", "折（お）る", "おる", "oru", "折叠、折断（他动词）", "N4", "godan", "亲子游玩", "vt", "〜を 折る",
     ("て形", "新幹線（しんかんせん）の中（なか）で娘（むすめ）と折（お）り紙（がみ）でツルを折（お）りました。", "Shinkansen no naka de musume to origami de tsuru wo orimashita.", "在新干线上和女儿一起用折纸折了千纸鹤。"),
     ("ます形", "レシートを半分（はんぶん）に折（お）って財布（さいふ）に入（い）れます。", "Reshiito wo hanbun ni otte saifu ni iremasu.", "把小票对折放进钱包里。"),
     ("⇄ 自他对比", "［他］領収書（りょうしゅうしょ）は折（お）らずにパスポートに挟（はさ）みましょう（自：折れる）。", "[Vt] Ryoushuusho wa orazu ni pasupooto ni hasamimashou.", "[他] 发票不要折，夹在护照里吧（自动词：折れる）。"), None),

    ("割れる", "割（わ）れる", "われる", "wareru", "碎裂、裂开、分裂（自动词）", "N4", "ichidan", "生活起居", "vi", "〜が 割れる",
     ("た形", "うわ、コップが床（ゆか）に落（お）ちて割（わ）れちゃいました！", "Uwa, koppu ga yuka ni ochite warechatta!", "哇，杯子掉在地上摔碎了！"),
     ("ている形", "スマホの画面（がめん）に保護（ほご）フィルムがあるから割（わ）れていません。", "Sumaho no gamen ni hogo firumu ga aru kara warete imasen.", "手机贴了保护膜所以屏幕没碎。"),
     ("⇄ 自他对比", "［自］お皿（さら）が割（わ）れて大変（たいへん）！（他：割る）。", "[Vi] Osara ga warete taihen!", "[自] 盘子碎了糟了！（对比他动词：卵を割る）。"), None),

    ("割る", "割（わ）る", "わる", "waru", "打破、切开、分摊、兑水（他动词）", "N4", "godan", "生活起居", "vt", "〜を 割る",
     ("て形", "すみません、グラスを割（わ）ってしまいました！片付（かたづ）けないで大丈夫（だいじょうぶ）ですか？", "Sumimasen, gurasu wo watte shimaimashita! Katazukenaide daijoubu desu ka?", "不好意思，把玻璃杯打碎了！不用我们收拾没关系吗？"),
     ("ます形", "熱（あつ）いお湯（ゆ）を水（みず）で少（すこ）し割（わ）って飲（の）みます。", "Atsui oyu wo mizu de sukoshi watte nomimasu.", "把热水兑一点凉水再喝。"),
     ("⇄ 自他对比", "［他］温泉卵（おんせんたまご）をパカッと割（わ）っていただきます（自：割れる）。", "[Vt] Onsen tamago wo pakatto watte itadakimasu.", "[他] 啪地敲开温泉蛋开动啦（自动词：殻が割れる）。"), None),

    ("沸く", "沸（わ）く", "わく", "waku", "水烧开、澡水烧好、沸腾（自动词）", "N4", "godan", "生活起居", "vi", "お湯が 沸く",
     ("た形", "お湯（ゆ）が沸（わ）いたから、お茶（ちゃ）をいれましょうか。", "Oyu ga waita kara, ocha wo iremashou ka.", "水烧开了，咱们泡茶吧。"),
     ("ます形", "スイッチを押（お）すと15分（ふん）でお風呂（ふろ）が沸（わ）きますよ。", "Suitchi wo osu to juugofun de ofuro ga wakimasu yo.", "按下开关15分钟浴缸热水就烧好了哦。"),
     ("⇄ 自他对比", "［自］ケトルのお湯（ゆ）がもうすぐ沸（わ）きます（他：沸かす）。", "[Vi] Ketoru no oyu ga mou sugu wakimasu.", "[自] 电水壶的水马上要开了（他动词：お湯を沸かす）。"), None),

    ("沸かす", "沸（わ）かす", "わかす", "wakasu", "烧开(水)、烧热(洗澡水)（他动词）", "N4", "godan", "生活起居", "vt", "お湯を 沸かす",
     ("て形", "ミルク用（よう）にミネラルウォーターを一度（いちど）沸（わ）かしておきます。", "Mirukuyou ni mineraru wootaa wo ichido wakashite okimasu.", "给冲奶粉用的矿泉水先烧开一次晾着。"),
     ("ます形", "寒（さむ）いので、熱（あつ）めのお風呂（ふろ）を沸（わ）かしますね。", "Samui node, atsume no ofuro wo wakashimasu ne.", "天冷，我放一缸热一点的洗澡水哦。"),
     ("⇄ 自他对比", "［他］ポットでお湯（ゆ）を沸（わ）かしてもいいですか？（自：沸く）。", "[Vt] Potto de oyu wo wakashite mo ii desu ka?", "[他] 可以用烧水壶烧点热水吗？（自动词：お湯が沸く）。"), None),

    ("溶ける", "溶（と）ける", "とける", "tokeru", "融化、溶解（雪/冰/黄油 · 自动词）", "N3", "ichidan", "亲子游玩", "vi", "〜が 溶ける",
     ("て形", "わあ、雪（ゆき）だるまが太陽（たいよう）で少（すこ）しずつ溶（と）けてきたね。", "Waa, yukidaruma ga taiyou de sukoshi zutsu tokete kita ne.", "哇，雪人在太阳下一点点融化了呢。"),
     ("ます形", "この大トロ、口（くち）の中（なか）でとろっと溶（と）けますよ！", "Kono ootoro, kuchi no naka de torotto tokemasu yo!", "这块大肥金枪鱼，入口即化呀！"),
     ("⇄ 自他对比", "［自］道（みち）の氷（こおり）が溶（と）けて歩（ある）きやすくなりました（他：溶かす）。", "[Vi] Michi no koori ga tokete arukiyasuku narimashita.", "[自] 路上的冰化了，好走多了（他动词：〜を溶かす）。"), None),

    ("溶かす", "溶（と）かす", "とかす", "tokasu", "融化、冲开、溶解（他动词）", "N3", "godan", "饮食点餐", "vt", "〜を 溶かす",
     ("て形", "お湯（ゆ）で粉（こな）ミルクをよく溶（と）かしてから冷（さ）まします。", "Oyu de konamiruku wo yoku tokashite kara samashimasu.", "用热水把奶粉充分化开后再晾凉。"),
     ("ます形", "お味噌汁（みそしる）に味噌（みそ）を溶（と）かして作（つく）ります。", "Omisoshiru ni miso wo tokashite tsukurimasu.", "把味噌化开做成味噌汤。"),
     ("⇄ 自他对比", "［他］熱いスープにバターを溶（と）かしていただきます（自：溶ける）。", "[Vt] Atsui suupu ni bataa wo tokashite itadakimasu.", "[他] 把黄油融化在热汤里吃（自动词：雪が溶ける）。"), None),

    ("外れる", "外（はず）れる", "はずれる", "hazureru", "脱落、松开、落空（自动词）", "N3", "ichidan", "生活起居", "vi", "〜が 外れる",
     ("た形", "あ、スキー板（いた）のビンディングが外（はず）れました。", "A, sukii-ita no bindingu ga hazuremashita.", "啊，滑雪板的固定器松开了。"),
     ("て形", "ベビーカーのボタンが片方（かたほう）外（はず）れていますよ。", "Bebiikaa no botan ga katahou hazurete imasu yo.", "婴儿车有一边的扣子松开了哦。"),
     ("⇄ 自他对比", "［自］天気予報（てんきよほう）が外（はず）れて晴（は）れました！（他：外す）。", "[Vi] Tenki yohou ga hazurete haremashita!", "[自] 天气预报没准，反而晴天了！（他动词：〜を外す）。"), None),

    ("外す", "外（はず）す", "はずす", "hazusu", "摘下、取下、避开(高峰)（他动词）", "N3", "godan", "生活起居", "vt", "〜を 外す",
     ("て形", "写真（しゃしん）を撮（と）るときだけ、マスクを外（はず）してください。", "Shashin wo toru toki dake, masuku wo hazushite kudasai.", "就拍照的时候把口罩摘下来一下。"),
     ("ます形", "お昼（ひる）の混（こ）む時間（じかん）を外（はず）して11時（じ）半（はん）に行（い）きましょう。", "Ohiru no komu jikan wo hazushite juuichijihan ni ikimashou.", "错开中午高峰期，11点半去吧。"),
     ("⇄ 自他对比", "［他］お寺（てら）に入（はい）るときは帽子（ぼうし）を外（はず）します（自：外れる）。", "[Vt] Otera ni hairu toki wa boushi wo hazushimasu.", "[他] 进寺庙时要摘下帽子（自动词：ボタンが外れる）。"), None),

    ("進む", "進（すす）む", "すすむ", "susumu", "前进、进展（自动词）", "N4", "godan", "移动交通", "vi", "〜が/へ 進む",
     ("ます形", "この道（みち）をまっすぐ進（すす）むと、品川駅（しながわえき）に着（つ）きます。", "Kono michi wo massugu susumu to, Shinagawa-eki ni tsukimasu.", "沿着这条路直走就到品川站了。"),
     ("ている形", "準備（じゅんび）が順調（じゅんちょう）に進（すす）んでいますね。", "Junbi ga junchou ni susunde imasu ne.", "准备工作进展得很顺利呢。"),
     ("⇄ 自他对比", "［自］渋滞（じゅうたい）で車（くるま）がなかなか進（すす）みません（他：進める）。", "[Vi] Juutai de kuruma ga nakanaka susumimasen.", "[自] 堵车车子完全走不动（他动词：〜を進める）。"), None),

    ("進める", "進（すす）める", "すすめる", "susumeru", "推进、调快(时钟)（他动词）", "N3", "ichidan", "思考情绪", "vt", "〜を 進める",
     ("て形", "旅行（りょこう）の計画（けいかく）を少（すこ）しずつ進（すす）めておきましょう。", "Ryokou no keikaku wo sukoshi zutsu susumete okimashou.", "把旅行计划一点一点提前推进起来吧。"),
     ("ます形", "時計（とけい）の針（はり）を日本時間（にほんじかん）に進（すす）めました。", "Tokei no hari wo Nihon jikan ni susumemashita.", "把手表指针拨到日本时间了。"),
     ("⇄ 自他对比", "［他］手続（てつづ）きをスムーズに進（すす）めることができました（自：進む）。", "[Vt] Tetsuzuki wo sumuuzu ni susumeru koto ga dekimashita.", "[他] 顺利推进了手续办理（自动词：計画が進む）。"), None),

    ("倒れる", "倒（たお）れる", "たおれる", "taoreru", "倒下、倒塌（自动词）", "N4", "ichidan", "生活起居", "vi", "〜が 倒れる",
     ("て形", "風（かぜ）が強（つよ）くて、看板（かんばん）が倒（たお）れています。", "Kaze ga tsuyokute, kanban ga taorete imasu.", "风太大，招牌都倒了。"),
     ("ます形", "疲（つか）れてソファーに倒（たお）れ込（こ）みました。", "Tsukarete sofaa ni taorekomimashita.", "累得一下子倒在沙发上。"),
     ("⇄ 自他对比", "［自］スキーでバランスを崩（くず）して倒（たお）れちゃった（他：倒す）。", "[Vi] Sukii de baransu wo kuzushite taorechatta.", "[自] 滑雪失去平衡摔倒了（他动词：背もたれを倒す）。"), None),

    ("倒す", "倒（たお）す", "たおす", "taosu", "放倒、推倒（椅子靠背 · 他动词）", "N4", "godan", "移动交通", "vt", "〜を 倒す",
     ("てもいい", "すみません、後ろ（うしろ）の座席（ざせき）を少（すこ）し倒（たお）してもよろしいですか？", "Sumimasen, ushiro no zaseki wo sukoshi taoshite mo yoroshii desu ka?", "不好意思，请问我可以把座椅靠背稍微往后放一点吗？（新干线神句！）"),
     ("て形", "子どもが寝（ね）たので、シートを倒（たお）してあげました。", "Kodomo ga neta node, shiito wo taoshite agemashita.", "孩子睡着了，帮她把座椅放倒了。"),
     ("⇄ 自他对比", "［他］うっかりコップを倒（たお）してこぼしちゃった（自：倒れる）。", "[Vt] Ukkari koppu wo taoshite koboshichatta.", "[他] 不小心把杯子碰倒洒出来了（自动词：コップが倒れる）。"), None),

    ("破れる", "破（やぶ）れる", "やぶれる", "yabureru", "破了、撕裂（纸/包装/衣服 · 自动词）", "N3", "ichidan", "生活起居", "vi", "〜が 破れる",
     ("て形", "重（おも）いものを入（い）れたら、紙袋（かみぶくろ）が破（やぶ）れてしまいました。", "Omoi mono wo iretara, kamibukuro ga yaburete shimaimashita.", "装了太重的东西，纸袋裂开了。"),
     ("た形", "ズボンの膝（ひざ）が転（ころ）んで破（やぶ）れちゃった！", "Zubon no hiza ga koronde yaburechatta!", "摔了一跤裤子膝盖磨破了！"),
     ("⇄ 自他对比", "［自］お土産（みやげ）の袋（ふくろ）が破（やぶ）れそうなので二重（にじゅう）にします（他：破る）。", "[Vi] Omiyage no fukuro ga yaburesou na node nijuu ni shimasu.", "[自] 伴手礼袋子快破了，套两层吧（他动词：〜を破る）。"), None),

    ("破る", "破（やぶ）る", "やぶる", "yaburu", "撕破、打破(规则/约定)（他动词）", "N3", "godan", "沟通社交", "vt", "〜を 破る",
     ("て形", "ビニール袋（ぶくろ）の開（あ）け口（ぐち）をピッと破（やぶ）って開（あ）けます。", "Biniiru bukuro no akekuchi wo pitto yabutte akemasu.", "把塑料袋开口撕开。"),
     ("ない形", "マナーやルールを破（やぶ）らないように気（き）をつけましょう。", "Manaa ya ruuru wo yaburanai you ni ki wo tsukemashou.", "注意不要违反礼仪和规定。"),
     ("⇄ 自他对比", "［他］要（い）らない紙（かみ）をビリビリ破（やぶ）りました（自：破れる）。", "[Vt] Iranai kami wo biribiri yaburimashita.", "[他] 把不需要的纸嘶啦嘶啦撕掉了（自动词：紙が破れる）。"), None),

    ("冷める", "冷（さ）める", "さめる", "sameru", "饭菜变凉、兴致消退（自动词）", "N3", "ichidan", "饮食点餐", "vi", "〜が 冷める",
     ("ないうち", "天（てん）ぷらは冷（さ）めないうちに熱々（あつあつ）をいただきましょう！", "Tenpura wa samenai uchi ni atsuatsu wo itadakimashou!", "天妇罗趁还没凉赶紧热乎乎地吃吧！"),
     ("てしまった", "話（はな）に夢中（むちゅう）になって、コーヒーがすっかり冷（さ）めちゃいました。", "Hanashi ni muchuu ni natte, koohii ga sukkari samechaimashita.", "聊得太入迷，咖啡完全凉掉了。"),
     ("⇄ 自他对比", "［自］お粥（かゆ）が食べやすい温度（おんど）に冷（さ）めました（他：冷ます）。", "[Vi] Okayu ga tabeyasui ondo ni samemashita.", "[自] 粥晾到了适合吃的温度（他动词：スープを冷ます）。"), None),

    ("冷ます", "冷（さ）ます", "さます", "samasu", "把滚烫的食物吹凉/放凉（他动词）", "N3", "godan", "饮食点餐", "vt", "〜を 冷ます",
     ("てから", "スープが熱（あつ）いから、フーフー冷（さ）ましてから飲（の）もうね。", "Suupu ga atsui kara, fuufuu samashite kara nomou ne.", "汤很烫，吹凉了再喝哦。"),
     ("ます形", "子（こ）どものうどんを小皿（こざら）に取（と）って冷（さ）まします。", "Kodomo no udon wo kozara ni totte samashimasu.", "把孩子的乌冬面夹到小碗里晾凉。"),
     ("⇄ 自他对比", "［他］お湯（ゆ）を少（すこ）し冷（さ）ましてから薬（くすり）を飲（の）みます（自：冷める）。", "[Vt] Oyu wo sukoshi samashite kara kusuri wo nomimasu.", "[他] 把热水晾凉一点再吃药（自动词：お湯が冷める）。"), None),

    ("鳴る", "鳴（な）る", "なる", "naru", "响起(铃声/闹钟/肚子叫)（自动词）", "N4", "godan", "生活起居", "vi", "〜が 鳴る",
     ("ている形", "あ、キッチンタイマーが鳴（な）っていますよ！", "A, kitchin taimaa ga natte imasu yo!", "啊，厨房定时器响了哦！"),
     ("た形", "除夜（じょや）の鐘（かね）が108回（かい）ゴーンと鳴（な）りました。", "Joya no kane ga hyakuhachikai goon to narimashita.", "除夕夜的钟声咚咚响了108下。"),
     ("⇄ 自他对比", "［自］お腹（なか）がグーッと鳴（な）っちゃった！（他：鳴らす）。", "[Vi] Onaka ga guutto nacchatta!", "[自] 肚子咕噜叫起来了！（他动词：ベルを鳴らす）。"), None),

    ("鳴らす", "鳴（な）らす", "ならす", "narasu", "按响(门铃/喇叭)、敲响（他动词）", "N3", "godan", "沟通社交", "vt", "〜を 鳴らす",
     ("て形", "チェックインのときは入口（いりぐち）のベルを鳴（な）らしてください。", "Chekkuin no toki wa iriguchi no beru wo narashite kudasai.", "办理入住时请按响入口处的门铃。"),
     ("ます形", "お参（まい）りのとき、鈴（すず）をガラガラ鳴（な）らしてお祈（いの）りします。", "Omairi no toki, suzu wo garagara narashite oinori shimasu.", "去神社参拜时，哗啦哗啦摇响铃铛再祈愿。"),
     ("⇄ 自他对比", "［他］ピンポーンとチャイムを鳴（な）らしました（自：鳴る）。", "[Vt] Pinpoon to chaimu wo narashimashita.", "[他] 叮咚按响了门铃（自动词：チャイムが鳴る）。"), None),

    ("済む", "済（す）む", "すむ", "sumu", "办完、解决、了结（自动词）", "N4", "godan", "核心基础", "vi", "〜が 済む / 〜で 済む",
     ("たら", "手続（てつづ）きが済（す）んだら、すぐロビーで合流（ごうりゅう）しよう。", "Tetsuzuki ga sundara, sugu robii de gouryuu shiyou.", "手续一办完，马上在大厅会合吧。"),
     ("ます形", "近場（ちかば）なので、歩（ある）けばタクシー代（だい）がかからず安く済（す）みます。", "Chikaba na node, arukeba takushii-dai ga kakarazu yasuku sumimasu.", "因为很近，走过去省了打车费花得少。"),
     ("⇄ 自他对比", "［自］お会計（かいけい）がスマホで簡単（かんたん）に済（す）みました（他：済ませる）。", "[Vi] Okaikei ga sumaho de kantan ni sumimashita.", "[自] 结账用手机轻松搞定了（他动词：用事を済ませる）。"), None),

    ("済ませる", "済（す）ませる", "すませる", "sumaseru", "办完、凑合解决（事情/一顿饭 · 他动词）", "N3", "ichidan", "生活起居", "vt", "〜を 済ませる",
     ("ておく", "空港（くうこう）に着（つ）いたら、まずトイレと両替（りょうがえ）を済（す）ませておこう。", "Kuukou ni tsuitara, mazu toire to ryougae wo sumasete okou.", "到了机场先把厕所和换汇搞定吧。"),
     ("た形", "時間（じかん）がないので、昼食（ちゅうしょく）はおにぎりで軽（かる）く済（す）ませました。", "Jikan ga nai node, chuushoku wa onigiri de karuku sumasemashita.", "没时间了，午饭就吃个饭团简单解决了。"),
     ("⇄ 自他对比", "［他］早（はや）めにチェックインを済（す）ませたいです（自：済む）。", "[Vt] Hayame ni chekkuin wo sumasetai desu.", "[他] 想早点把入住办完（自动词：チェックインが済む）。"), None),

    # --- 54-80: 27 High-Frequency N3 Compound Verbs (复合动词) ---
    ("乗り換える", "乗（の）り換（か）える", "のりかえる", "norikaeru", "换乘、转车（电车/新干线）", "N4", "ichidan", "移动交通", "both", "〜に 乗り換える",
     ("ます形", "東京駅（とうきょうえき）で北陸（ほくりく）新幹線（しんかんせん）に乗（の）り換（か）えます。", "Toukyou-eki de Hokuriku shinkansen ni norikaemasu.", "我们在东京站换乘北陆新干线。"),
     ("て形", "品川（しながわ）で山手線（やまのてせん）に乗（の）り換（か）えて浜松町（はままつちょう）へ行（い）きましょう。", "Shinagawa de Yamanote-sen ni norikaete Hamamatsuchou e ikimashou.", "在品川换乘山手线去浜松町吧。"),
     ("💬 口语缩略", "改札（かいさつ）を出（で）ないで、そのまま乗（の）り換（か）えちゃっていいよ。", "Kaisatsu wo denaide, sono mama norikaechatte ii yo.", "不用出检票口，直接站内换乘就行哦。"), None),

    ("取り出す", "取（と）り出（だ）す", "とりだす", "toridasu", "取出、掏出（证件/物品）", "N3", "godan", "生活起居", "vt", "〜から 〜を 取り出す",
     ("て形", "バッグからパスポートと搭乗券（とうじょうけん）を取（と）り出（だ）しました。", "Baggu kara pasupooto to toujouken wo toridashimashita.", "从包里掏出了护照和登机牌。"),
     ("ます形", "コインロッカーから荷物（にもつ）を取（と）り出（だ）してから帰（かえ）ります。", "Koin rokkaa kara nimotsu wo toridashite kara kaerimasu.", "从投币寄存柜取出行李再回去。"),
     ("💬 口语缩略", "寒（さむ）くなったから、カイロを取（と）り出（だ）しとこ！", "Samuku natta kara, kairo wo toridashitoko!", "变冷了，把暖宝宝掏出来吧！"), None),

    ("持ち帰る", "持（も）ち帰（かえ）る", "もちかえる", "mochikaeru", "打包带走、带回家", "N3", "godan", "饮食点餐", "vt", "〜を 持ち帰る",
     ("ます形", "すみません、こちらのパンは店内（てんない）ではなく持（も）ち帰（かえ）りで。", "Sumimasen, kochira no pan wa tennai dewa naku mochikaeri de.", "不好意思，这个面包不在店里吃，打包带走（＝テイクアウト）。"),
     ("ていい", "食（た）べ切（き）れなかったお菓子（かし）、持（も）ち帰（かえ）ってもいいですか？", "Tabekirenakatta okashi, mochikaette mo ii desu ka?", "没吃完的点心可以打包带回去吗？"),
     ("N3 用法", "旅先（たびさき）の素敵（すてき）な思（おも）い出（で）をいっぱい持（も）ち帰（かえ）りましょう。", "Tabisaki no suteki na omoide wo ippai mochikaerimashou.", "把旅途的美好回忆满满带回家吧。"), None),

    ("落ち着く", "落（お）ち着（つ）く", "おちつく", "ochitsuku", "冷静下来、安静舒适、安顿", "N3", "godan", "思考情绪", "vi", "気持ちが 落ち着く",
     ("た形", "和室（わしつ）に入（はい）ったら、畳（たたみ）の香（かお）りで気持（きも）ちが落（お）ち着（つ）きました。", "Washitsu ni haittara, tatami no kaori de kimochi ga ochitsukimashita.", "一进和室，闻到榻榻米的香味心情一下子平静舒缓下来。"),
     ("て形", "慌（あわ）てないで、まず深呼吸（しんこきゅう）して落（お）ち着（つ）こう。", "Awatenaide, mazu shinkokyuu shite ochitsukou.", "别慌，先深呼吸冷静一下。"),
     ("💬 口语缩略", "由布院（ゆふいん）の旅館（りょかん）、すごく落（お）ち着（つ）いてて素敵（すてき）だね。", "Yufuin no ryokan, sugoku ochitsuitete suteki da ne.", "由布院的温泉旅馆好幽静雅致，太棒了。"), None),

    ("引き出す", "引（ひ）き出（だ）す", "ひきだす", "hikidasu", "取出(现金)、引出(潜力)", "N3", "godan", "购物消费", "vt", "〜から 〜を 引き出す",
     ("ます形", "セブン銀行（ぎんこう）のATMで現金（げんきん）を3万円（まんえん）引（ひ）き出（だ）します。", "Sebun Ginkou no ATM de genkin wo sanman-en hikidashimasu.", "在7-11银行 ATM 取3万日元现金。"),
     ("て形", "テーブルの下（した）の引（ひ）き出（だ）しをそっと引（ひ）き出（だ）しました。", "Teeburu no shita no hikidashi wo sotto hikidashimashita.", "轻轻拉开了桌子下面的抽屉。"),
     ("N3 理解", "素材（そざい）の味（あじ）を最大限（さいだいげん）に引（ひ）き出（だ）したお出汁（だし）です。", "Sozai no aji wo saidaigen ni hikidashita odashi desu.", "这是把食材本味发挥到极致的高汤。"), None),

    ("申し込む", "申（もう）し込（こ）む", "もうしこむ", "moushikomu", "申请、报名、预订", "N4", "godan", "沟通社交", "vt", "〜に/を 申し込む",
     ("た形", "インターネットで軽井沢（かるいざわ）のキッズスキースクールに申（もう）し込（こ）みました。", "Intaanetto de Karuizawa no kizzu sukii sukuuru ni moushikomimashita.", "在网上报名了轻井泽儿童滑雪学校。"),
     ("ます形", "事前（じぜん）に保育園（ほいくえん）の見学（けんがく）を申（もう）し込（こ）みます。", "Jizen ni hoikuen no kengaku wo moushikomimasu.", "提前申请去保育园参观。"),
     ("N3 用法", "貸切風呂（かしきりぶろ）の予約（よやく）はチェックイン時（じ）に申（もう）し込（こ）めます。", "Kashikiriburo no yoyaku wa chekkuin-ji ni moushikomemasu.", "包场私汤可以在办理入住时预约申请。"), None),

    ("見送る", "見送（みおく）る", "みおくる", "miokuru", "送行、目送、放弃(这趟车)", "N3", "godan", "沟通社交", "vt", "〜を 見送る",
     ("て形", "女将（おかみ）さんが車（くるま）が見（み）えなくなるまで笑顔（えがお）で見送（みおく）ってくれました。", "Okami-san ga kuruma ga mienaku naru made egao de miokutte kuremashita.", "老板娘一直微笑目送我们直到车子看不见为止。"),
     ("ます形", "混（こ）んでいるので、この電車（でんしゃ）は1本（ぽん）見送（みおく）りましょう。", "Konde iru node, kono densha wa ippon miokurimashou.", "车太挤了，咱们先错过这班等下一班吧。"),
     ("N3 用法", "今度（こんど）の新幹線（しんかんせん）で友達（ともだち）をホームまで見送（みおく）りました。", "Kondo no shinkansen de tomodachi wo hoomu made miokurimashita.", "坐这趟新干线把朋友送到站台上送行。"), None),

    ("見直す", "見直（みなお）す", "みなおす", "minaosu", "重新检查、重新审视、刮目相看", "N3", "godan", "思考情绪", "vt", "〜を 見直す",
     ("て形", "出発前（しゅっぱつまえ）にもう一度（いちど）荷物（にもつ）リストを見直（みなお）しておこう。", "Shuppatsu mae ni mou ichido nimotsu risuto wo minaoshite okou.", "出发前再重新核对一遍行李清单吧。"),
     ("ます形", "スケジュールが詰（つ）まりすぎているので、少（すこ）し見直（みなお）します。", "Sukejuuru ga tsumarisugite iru node, sukoshi minaoshimasu.", "行程排得太满了，稍微调整优化一下。"),
     ("N3 评价", "パパ、日本語（にほんご）上手（じょうず）になったね！見直（みなお）したよ。", "Papa, Nihongo jouzu ni natta ne! Minaoshita yo.", "爸爸，日语变这么厉害啦！真是对你刮目相看！"), None),

    ("飛び出す", "飛（と）び出（だ）す", "とびだす", "tobidasu", "突然冲出、飞奔出去", "N3", "godan", "亲子游玩", "vi", "〜から 飛び出す",
     ("ないで", "車（くるま）が来（く）るから、道路（どうろ）に急（きゅう）に飛（と）び出（だ）さないでね！", "Kuruma ga kuru kara, douro ni kyuu ni tobidasanaide ne!", "有车过来，千万不要突然冲到马路上哦！（带娃必记安全警句！）"),
     ("た形", "公園（こうえん）が見（み）えた瞬間（しゅんかん）、子どもたちが元気（げんき）よく飛（と）び出（だ）しました。", "Kouen ga mieta shunkan, kodomotachi ga genki yoku tobidashimashita.", "一看到公园，孩子们瞬间欢呼着冲出去了。"),
     ("💬 口语缩略", "あぶないっ、急（きゅう）に飛（と）び出（だ）したらダメだよ！", "Abunai, kyuu ni tobidashitara dame da yo!", "危险！突然跑出去不行的哦！"), None),

    ("飛び込む", "飛（と）び込（こ）む", "とびこむ", "tobikomu", "跳入、突然冲进、未预约直接进店", "N3", "godan", "饮食点餐", "vi", "〜に 飛び込む",
     ("ます形", "予約（よやく）なしでフラッと飛（と）び込（こ）んだお店（みせ）が大当（おおあ）たりでした。", "Yoyaku nashi de furatto tobikonda omise ga ooatari deshita.", "没预约随便钻进的一家店居然超级美味！"),
     ("た形", "雪（ゆき）のクッションに子どもがダイブして飛（と）び込（こ）みました。", "Yuki no kusshon ni kodomo ga daibu shite tobikomimashita.", "孩子扑通一下扑进了厚厚的雪堆里。"),
     ("N3 用法", "発車（はっしゃ）直前（ちょくぜん）の電車（でんしゃ）に飛（と）び込（こ）むのは危（あぶ）ないです。", "Hassha chokuzen no densha ni tobikomu no wa abunai desu.", "在电车快发车前冲上车是很危险的。"), None),

    ("通り過ぎる", "通（とお）り過（す）ぎる", "とおりすぎる", "toorisugiru", "路过、走过头、错过", "N3", "ichidan", "移动交通", "vt", "〜を 通り過ぎる",
     ("てしまった", "あっ、話（はな）していたら目的（もくてき）の角（かど）を通（とお）り過（す）ぎちゃった！", "A, hanashite itara mokuteki no kado wo toorisugichatta!", "啊，光顾着聊天把要转弯的路口走过头了！"),
     ("ます形", "のぞみ号（ごう）は小（ちい）さい駅（えき）をすごいスピードで通（とお）り過（す）ぎます。", "Nozomi-gou wa chiisai eki wo sugoi supiido de toorisugimasu.", "希望号新干线呼啸着飞过小车站。"),
     ("💬 口语缩略", "今（いま）のお寿司屋（すしや）さん、ちょっと通（とお）り過（す）ぎたっぽいよ。", "Ima no osushiya-san, chotto toorisugita ppoi yo.", "刚才那家寿司店咱们好像走过头了。"), None),

    ("振り返る", "振（ふ）り返（かえ）る", "ふりかえる", "furikaeru", "回头看、回顾往事", "N3", "godan", "思考情绪", "both", "〜を 振り返る",
     ("て", "名前（なまえ）を呼（よ）ばれて、思わず後（うし）ろを振（ふ）り返（かえ）りました。", "Namae wo yobarete, omowazu ushiro wo furikaerimashita.", "听到有人叫名字，不由得回头看了一眼。"),
     ("ます形", "2026年（ねん）の1年間（ねんかん）を家族（かぞく）みんなで振（ふ）り返（かえ）ります。", "Nisen-nijuurokunen no ichinenkan wo kazoku minna de furikaerimasu.", "全家一起回顾2026年这一整年。"),
     ("N3 用法", "結婚（けっこん）7周年（ななしゅうねん）を振（ふ）り返（かえ）ると、本当（ほんとう）に幸せ（しあわせ）です。", "Kekkon nanashuunen wo furikaeru to, hontou ni shiawase desu.", "回顾结婚七周年，真的觉得好幸福。"), None),

    ("話し合う", "話（はな）し合（あ）う", "はなしあう", "hanashiau", "商量、互相沟通讨论", "N4", "godan", "沟通社交", "vt", "〜について 話し合う",
     ("て", "今夜（こんや）、夫婦（ふうふ）で明日（あした）のスケジュールをゆっくり話（はな）し合（あ）おう。", "Kon'ya, fuufu de ashita no sukejuuru wo yukkuri hanashiaou.", "今晚夫妻俩好好商量一下明天的安排吧。"),
     ("ます形", "どこに行（い）きたいか家族（かぞく）全員（ぜんいん）で話（はな）し合（あ）います。", "Doko ni ikitai ka kazoku zen'in de hanashiaimasu.", "全家一起商量想去哪里玩。"),
     ("💬 口语缩略", "二人（ふたり）でちゃんと話（はな）し合（あ）っといてよかったね。", "Futari de chanto hanashiattoite yokatta ne.", "幸好咱俩提前好好沟通过了呢。"), None),

    ("付き合う", "付（つ）き合（あ）う", "つきあう", "tsukiau", "陪伴、交往、打交道", "N3", "godan", "沟通社交", "vi", "〜に/と 付き合う",
     ("て", "ママのショッピングに1時間（じかん）付（つ）き合（あ）ってくれてありがとう！", "Mama no shoppingu ni ichijikan tsukiatte kurete arigatou!", "谢谢陪妈妈逛街逛了一小时！"),
     ("ます形", "娘（むすめ）のおままごとにずっと付（つ）き合（あ）っています。", "Musume no omamagoto ni zutto tsukiatte imasu.", "一直在陪女儿玩过家家。"),
     ("N3 惯用", "丁寧（ていねい）にお付（つ）き合（あ）いいただきありがとうございます。", "Teinei ni otsukiai itadaki arigatou gozaimasu.", "感谢您的耐心陪伴/周到往来。"), None),

    ("切り替える", "切（き）り替（か）える", "きりかえる", "kirikaeru", "切换、转换(心情/路线/卡)", "N3", "ichidan", "思考情绪", "vt", "〜を 切り替える",
     ("て", "雨（あめ）でも気持（きも）ちを切（き）り替（か）えて室内（しつない）パークを楽しもう！", "Ame demo kimochi wo kirikaete shitsunai paaku wo tanoshimou!", "就算下雨也转换好心情，去室内乐园玩吧！"),
     ("ます形", "スマホを日本（にほん）のeSIMに切（き）り替（か）えました。", "Sumaho wo Nihon no eSIM ni kirikaemashita.", "把手机网络切换成日本 eSIM 了。"),
     ("N3 用法", "仕事（しごと）モードから完全（かんぜん）にバケーションモードへ切（き）り替（か）えます。", "Shigoto moodo kara kanzen ni bakeeshon moodo e kirikaemasu.", "从工作模式彻底切换到度假模式！"), None),

    ("取り替える", "取（と）り替（か）える", "とりかえる", "torikaeru", "更换、替换（尿布/毛巾/电池）", "N4", "ichidan", "生活起居", "vt", "〜を 取り替える",
     ("ます形", "オムツを取（と）り替（か）えるスペース（おむつ交換台）はどこですか？", "Omutsu wo torikaeru supeesu wa doko desu ka?", "请问换尿布台在哪里？"),
     ("て", "濡（ぬ）れたタオルを新（あたら）しいのに取（と）り替（か）えてもらえますか？", "Nureta taoru wo atarashii no ni torikaete moraemasu ka?", "能帮我把湿毛巾换成新的吗？"),
     ("💬 口语缩略", "出発前（しゅっぱつまえ）に今のうちにオムツ取（と）り替（か）えとこう。", "Shuppatsu mae ni ima no uchi ni omutsu torikaetokou.", "趁还没出发，现在先把尿布换好吧。"), None),

    ("やり直す", "やり直（なお）す", "やりなおす", "yarinaosu", "重新做一次、重来", "N3", "godan", "核心基础", "vt", "〜を やり直す",
     ("ます形", "切符（きっぷ）の買（か）い方（かた）を間違（まちが）えたので、最初（さいしょ）からやり直（なお）します。", "Kippu no kaikata wo machigaeta node, saisho kara yarinaoshimasu.", "买票步骤点错了，从头重新来一遍。"),
     ("て", "写真（しゃしん）、目（め）をつぶっちゃったからもう1回（かい）やり直（なお）そう！", "Shashin, me wo tsubutchatta kara mou ikkai yarinaosou!", "照片眨眼了，再来拍一次吧！"),
     ("💬 口语缩略", "間違（まちが）えても、すぐやり直（なお）せば大丈夫（だいじょうぶ）だよ。", "Machigaetemo, sugu yarinaoseba daijoubu da yo.", "就算弄错了，马上重做一遍就没事哦。"), None),

    ("食べ過ぎる", "食（た）べ過（す）ぎる", "たべすぎる", "tabesugiru", "吃太多、吃撑了", "N4", "ichidan", "饮食点餐", "vt", "〜を 食べ過ぎる",
     ("た形", "博多（はかた）ラーメンと明太子（めんたいこ）がおいしくて食（た）べ過（す）ぎました！", "Hakata raamen to mentaiko ga oishikute tabesugimashita!", "博多拉面和明太子太好吃，结果吃撑了！"),
     ("ない", "晩（ばん）ごはんがあるから、おやつは食（た）べ過（す）ぎないようにね。", "Bangohan ga aru kara, oyatsu wa tabesuginai you ni ne.", "一会儿还有晚饭，零食别吃太多哦。"),
     ("💬 口语缩略", "あー、今日（きょう）もついつい美味（おい）しくて食（た）べ過（す）ぎちゃった！", "Aa, kyou mo tsui tsui oishikute tabesugichatta!", "啊，今天又因为太好吃不知不觉吃多了！"), None),

    ("飲み過ぎる", "飲（の）み過（す）ぎる", "のみすぎる", "nomisugiru", "喝太多", "N4", "ichidan", "饮食点餐", "vt", "〜を 飲み過ぎる",
     ("た形", "銀座（ぎんざ）のランチで日本酒（にほんしゅ）が美味（おい）しくて少（すこ）し飲（の）み過（す）ぎました。", "Ginza no ranchi de nihonshu ga oishikute sukoshi nomisugimashita.", "银座午餐的日本酒太醇香，稍微多喝了两杯。"),
     ("ない", "お水（みず）を飲（の）み過（す）ぎるとトイレに行（い）きたくなるよ。", "Omizu wo nomisugiru to toire ni ikitaku naru yo.", "水喝太多一会儿又想上厕所啦。"),
     ("💬 口语缩略", "昨日（きのう）ちょっと飲（の）み過（す）ぎちゃって、眠（ねむ）いなぁ。", "Kinou chotto nomisugichatte, nemui naa.", "昨天稍微喝多了点，好困呀。"), None),

    ("歩き回る", "歩（ある）き回（まわ）る", "あるきまわる", "arukimawaru", "到处走来走去、逛来逛去", "N3", "godan", "移动交通", "vi", "〜を 歩き回る",
     ("て", "朝から銀座（ぎんざ）や表参道（おもてさんどう）をずっと歩（ある）き回（まわ）って足（あし）がパンパンです。", "Asa kara Ginza ya Omotesandou wo zutto arukimawatte ashi ga panpan desu.", "从早上就在银座和表参道到处逛，腿都走胀了。"),
     ("ます形", "アウトレットの中（なか）を1日（にち）じゅう歩（ある）き回（まわ）りました。", "Autoretto no naka wo ichinichijuu arukimawarimashita.", "在奥特莱斯里逛了一整天。"),
     ("💬 口语缩略", "子（こ）どもがお店（みせ）の中（なか）を歩（ある）き回（まわ）らないように手（て）をつなごう。", "Kodomo ga omise no naka wo arukimawaranai you ni te wo tsunagou.", "牵好手别让孩子在店里乱跑哦。"), None),

    ("見上げる", "見上（みあ）げる", "みあげる", "miageru", "抬头仰望", "N3", "ichidan", "亲子游玩", "vt", "〜を 見上げる",
     ("て", "芝公園（しばこうえん）からライトアップされた東京（とうきょう）タワーを見上（みあ）げました。", "Shiba Kouen kara raitoappu sareta Toukyou Tawaa wo miagemashita.", "从芝公园抬头仰望了亮起灯的东京塔。"),
     ("ます形", "大（おお）きなクリスマスツリーを娘（むすめ）たちがキラキラした目（め）で見上（みあ）げています。", "Ookina kurisumasu tsurii wo musumetachi ga kirakira shita me de miagete imasu.", "女儿们闪着星星眼仰望着高大的圣诞树。"),
     ("N3 描写", "夜空（よぞら）を見上（みあ）げると星（ほし）がすごくきれいに見（み）えました。", "Yozora wo miageru to hoshi ga sugoku kirei ni miemashita.", "抬头仰望夜空，星星看得特别清楚。"), None),

    ("受け付ける", "受（う）け付（つ）ける", "うけつける", "uketsukeru", "受理、接待、接受办理", "N3", "ichidan", "沟通社交", "vt", "〜を 受け付ける",
     ("ています", "荷物（にもつ）の発送（はっそう）は何時（なんじ）まで受（う）け付（つ）けていますか？", "Nimotsu no hassou wa nanji made uketsukete imasu ka?", "请问行李寄送受理到几点？"),
     ("ます形", "こちらのカウンターで免税（めんぜい）の手続（てつづ）きを受（う）け付（つ）けています。", "Kochira no kauntaa de menzei no tetsuzuki wo uketsukete imasu.", "这边的柜台受理免税手续。"),
     ("N3 提示", "予約（よやく）のキャンセルは前日（ぜんじつ）まで受（う）け付（つ）けているそうです。", "Yoyaku no kyanseru wa zenjitsu made uketsukete iru sou desu.", "听说预约取消受理到前一天为止。"), None),

    ("売り切れる", "売（う）り切（き）れる", "うりきれる", "urikireru", "卖光、售罄（自动词状态）", "N3", "ichidan", "购物消费", "vi", "〜が 売り切れる",
     ("ている", "すみません、限定（げんてい）プリンは本日（ほんじつ）分（ぶん）売（う）り切（き）れてしまいました。", "Sumimasen, gentei purin wa honjitsubun urikirete shimaimashita.", "抱歉，限定布丁今天份已经卖光了。"),
     ("る前に", "人気（にんき）の駅弁（えきべん）はすぐ売（う）り切（き）れるので、早（はや）めに買（か）いましょう。", "Ninki no ekiben wa sugu urikireru node, hayame ni kaimashou.", "人气铁路便当很快就会卖光，咱们早点买吧。"),
     ("💬 口语缩略", "うわ、狙（ねら）ってたケーキもう売（う）り切（き）れちゃったって！", "Uwa, neratteta keeki mou urikirechatta tte!", "哇，心心念念的蛋糕听说已经卖光了！"),
     {"potential": {"jp": "—", "kana": ""}, "volitional": {"jp": "—", "kana": ""}, "causative": {"jp": "—", "kana": ""}, "causative_passive": {"jp": "—", "kana": ""}, "imperative": {"jp": "—", "kana": ""}}),

    ("立ち寄る", "立（た）ち寄（よ）る", "たちよる", "tachiyoru", "顺道去、顺路停一下", "N3", "godan", "移动交通", "vi", "〜に 立ち寄る",
     ("て", "帰り道（かえりみち）にスーパーへ立（た）ち寄（よ）って、フルーツを買（か）って帰（かえ）ろう。", "Kaerimichi ni suupaa e tachiyotte, furuutsu wo katte kaerou.", "回程顺路去趟超市买点水果回去吧。"),
     ("ます形", "ドライブの途中（とちゅう）でサービスエリアに立（た）ち寄（よ）ります。", "Doraibu no tochuu de saabisueria ni tachiyorimasu.", "自驾途中顺路去一下高速服务区。"),
     ("N3 礼貌", "お近くにお越（こ）しの際（さい）は、ぜひお立（た）ち寄（よ）りください。", "Ochikaku ni okoshi no sai wa, zehi otachiyori kudasai.", "您到附近时欢迎随时顺道光临。"), None),

    ("乗り過ごす", "乗（の）り過（す）ごす", "のりすごす", "norisugosu", "坐过站（电车/巴士）", "N3", "godan", "移动交通", "vt", "駅を 乗り過ごす",
     ("てしまった", "うっかり寝（ね）てしまって、品川駅（しながわえき）を乗（の）り過（す）ごしてしまいました！", "Ukkari nete shimatte, Shinagawa-eki wo norisugoshite shimaimashita!", "一不小心睡着了，坐过品川站了！"),
     ("ない", "案内表示（あんないひょうじ）を見（み）て、乗（の）り過（す）ごさないように気（き）をつけよう。", "Annai hyouji wo mite, norisugosanai you ni ki wo tsukeyou.", "看着屏幕报站牌，小心别坐过站哦。"),
     ("💬 口语缩略", "もし乗（の）り過（す）ごしちゃったら、次（つぎ）の駅（えき）で反対（はんたい）ホームに戻（もど）ればいいよ。", "Moshi norisugoshichattara, tsugi no eki de hantai hoomu ni modoreba ii yo.", "万一坐过站的话，在下一站去对面站台坐回来就行。"), None),

    ("追いつく", "追（お）いつく", "おいつく", "oitsuku", "追上、赶上进度", "N3", "godan", "移动交通", "vi", "〜に 追いつく",
     ("ます形", "先（さき）に改札（かいさつ）へ向（む）かって、パパがすぐ追（お）いつくから！", "Saki ni kaisatsu e mukatte, papa ga sugu oitsuku kara!", "你们先往检票口走，爸爸马上追上来！"),
     ("ない", "お姉（ねえ）ちゃんの走（はし）りが速（はや）すぎて、2歳（さい）の妹（いもうと）が追（お）いつけません。", "Onee-chan no hashiri ga hayasugite, nisai no imouto ga oitsukemasen.", "姐姐跑太快了，2岁的妹妹追不上。"),
     ("N3 用法", "時差（じさ）ボケが直（なお）って、やっと体（からだ）が現地（げんち）の時間に追（お）いつきました。", "Jisaboke ga naotte, yatto karada ga genchi no jikan ni oitsukimashita.", "时差倒过来了，身体终于跟上当地时间了。"), None),

    ("思い込む", "思（おも）い込（こ）む", "おもいこむ", "omoikomu", "深信不疑、自以为是（误以为）", "N3", "godan", "思考情绪", "vt", "〜と 思い込む",
     ("ていた", "水曜日（すいようび）が営業日（えいぎょうび）だと思（おも）い込（こ）んでいたら、定休日（ていきゅうび）でした。", "Suiyoubi ga eigyoubi da to omoikonde itara, teikyuubi deshita.", "一直以为周三是营业日，结果人家周三公休。"),
     ("ないで", "12月（がつ）だからずっと雪（ゆき）だと勝手（かって）に思（おも）い込（こ）まないほうがいいよ。", "Juunigatsu dakara zutto yuki da to katte ni omoikomanai hou ga ii yo.", "别一厢情愿地以为12月肯定一直下雪哦。"),
     ("N3 口语", "クレジットカードで大丈夫（だいじょうぶ）だと思（おも）い込（こ）んでて、現金（げんきん）が少（すく）なかった！", "Kurejitto kaado de daijoubu da to omoikondete, genkin ga sukunakatta!", "自以为能刷卡，结果没带够现金！"), None),

    # --- 81-100: 20 Hospitality Keigo, Parenting & N4/N3 Daily Travel Verbs ---
    ("いらっしゃる", "いらっしゃる", "いらっしゃる", "irassharu", "来 / 去 / 在（最高敬语·尊他）", "N4", "godan", "沟通社交", "vi", "〜へ/に いらっしゃる",
     ("ます形", "【店员问】何名様（なんめいさま）でいらっしゃいますか？", "Nanmei-sama de irasshaimasu ka?", "【店员常用】请问几位呢？（＝何人ですか？）"),
     ("いますか", "担当（たんとう）の鈴木（すずき）様（さま）はいらっしゃいますでしょうか？", "Tantou no Suzuki-sama wa irasshaimasu deshou ka?", "请问负责人铃木先生/女士在吗？"),
     ("命令敬语", "【店员】いらっしゃいませ！どうぞ奥（おく）のお席（せき）へ！", "Irasshaimase! Douzo oku no oseki e!", "【店员】欢迎光临！请往里面的座位坐！"),
     {"masu": {"jp": "いらっしゃいます", "kana": "いらっしゃいます"}, "te": {"jp": "いらっしゃって", "kana": "いらっしゃって"}, "ta": {"jp": "いらっしゃった", "kana": "いらっしゃった"}, "nai": {"jp": "いらっしゃらない", "kana": "いらっしゃらない"}, "passive": {"jp": "—", "kana": ""}, "causative": {"jp": "—", "kana": ""}, "causative_passive": {"jp": "—", "kana": ""}, "imperative": {"jp": "いらっしゃい", "kana": "いらっしゃい"}}),

    ("召し上がる", "召（め）し上（あ）がる", "めしあがる", "meshiagaru", "吃 / 喝（尊他语·店员常问）", "N4", "godan", "饮食点餐", "vt", "〜を 召し上がる",
     ("ますか", "【店员问】お飲（の）み物（もの）は何（なに）を召（め）し上（あ）がりますか？", "Onomimono wa nani wo meshiagarimasu ka?", "【店员常用】请问您想喝点什么？（＝飲みますか？）"),
     ("ください", "【店员说】お好（この）みのお塩（しお）でどうぞお召（め）し上（あ）がりください。", "Okonomi no oshio de douzo omeshiagari kudasai.", "【店员】请蘸您喜欢的海盐享用。"),
     ("听力识别", "「お召（め）し上（あ）がりですか？」は「店内で食べますか？」の意味（いみ）です。", "'Omeshiagari desu ka?' wa 'tennai de tabemasu ka?' no imi desu.", "便利店常问「お召し上がりですか」＝“要在店里堂食吗？”"),
     {"passive": {"jp": "—", "kana": ""}, "causative": {"jp": "—", "kana": ""}, "causative_passive": {"jp": "—", "kana": ""}}),

    ("おっしゃる", "おっしゃる", "おっしゃる", "ossharu", "说、讲（尊他语）", "N4", "godan", "沟通社交", "vt", "〜と おっしゃる",
     ("ます", "【客气】店員（てんいん）さんがおっしゃる通（とお）りにしますね。", "Ten'in-san ga ossharu toori ni shimasu ne.", "我们就照店员说的办吧。"),
     ("いました", "先（さき）ほどシェフがおっしゃっていた料理（りょうり）はこれですね！", "Sakihodo shefu ga osshatte ita ryouri wa kore desu ne!", "刚才主厨说的就是这道菜吧！"),
     ("N4 礼貌", "すみません、もう一度（いちど）おっしゃっていただけますか？", "Sumimasen, mou ichido osshatte itadakemasu ka?", "不好意思，能请您再说一遍吗？"),
     {"masu": {"jp": "おっしゃいます", "kana": "おっしゃいます"}, "imperative": {"jp": "おっしゃい", "kana": "おっしゃい"}, "passive": {"jp": "—", "kana": ""}, "causative": {"jp": "—", "kana": ""}, "causative_passive": {"jp": "—", "kana": ""}}),

    ("伺う", "伺（うかが）う", "うかがう", "ukagau", "拜访 / 询问 / 听闻（自谦语）", "N4", "godan", "沟通社交", "vt", "〜へ/を 伺う",
     ("ます", "明日（あした）の12時（じ）に予約（よやく）で伺（うかが）います、劉（りゅう）です。", "Ashita no juuniji ni yoyaku de ukagaimasu, Ryuu desu.", "明天12点有预约过去用餐，我姓刘（打电话确认必用）。"),
     ("たい", "一（ひと）つお伺（うかが）いしたいことがあるのですが、よろしいですか？", "Hitotsu oukagai shitai koto ga aru no desu ga, yoroshii desu ka?", "有一件事想向您请教一下，方便吗？"),
     ("店员常说", "【店员】ご注文（ちゅうもん）をお伺（うかが）いいたします。", "Gochuumon wo oukagai itashimasu.", "【店员】现在为您点餐（＝听您吩咐）。"),
     {"passive": {"jp": "—", "kana": ""}, "causative": {"jp": "—", "kana": ""}, "causative_passive": {"jp": "—", "kana": ""}}),

    ("いただく", "いただく", "いただく", "itadaku", "吃 / 喝 / 收到 / 请对方做（自谦语）", "N4", "godan", "饮食点餐", "vt", "〜を いただく / 〜ていただく",
     ("ます", "とてもおいしそう！それでは遠慮（えんりょ）なくいただきます。", "Totemo oishisou! Soredewa enryo naku itadakimasu.", "看起来太美味了！那我就不客气开动啦。"),
     ("ますか", "お水（みず）をもう少（すこ）しいただけますか？", "Omizu wo mou sukoshi itadakemasu ka?", "可以再给我加一点水吗？（比ください更优雅！）"),
     ("N4 礼貌", "子どもたちのために早（はや）めに出（だ）していただき、ありがとうございます。", "Kodomotachi no tame ni hayame ni dashite itadaki, arigatou gozaimasu.", "感谢您为孩子们提前上菜。"), None),

    ("参る", "参（まい）る", "まいる", "mairu", "去 / 来（自谦语 · 列车报站高频）", "N4", "godan", "移动交通", "vi", "〜へ 参る",
     ("ます", "【车站广播】まもなく1番線（ばんせん）に電車（でんしゃ）が参（まい）ります。", "Mamonaku ichibansen ni densha ga mairimasu.", "【必听广播】1号站台电车即将进站（＝来ます）。"),
     ("ます", "【商务/礼貌】ただいま担当者（たんとうしゃ）が参（まい）りますので、少々（しょうしょう）お待（ま）ちください。", "Tadaima tantousha ga mairimasu node, shoushou omachi kudasai.", "负责人马上过来，请稍等。"),
     ("生活", "今（いま）すぐフロントへ参（まい）りますね。", "Ima sugu furonto e mairimasu ne.", "我现在马上去前台一趟。"),
     {"passive": {"jp": "—", "kana": ""}, "causative": {"jp": "—", "kana": ""}, "causative_passive": {"jp": "—", "kana": ""}}),

    ("致す", "致（いた）す", "いたす", "itasu", "做、办理（する的自谦语 · 服务业高频）", "N4", "godan", "沟通社交", "vt", "〜を 致す",
     ("ます", "【店员】お荷物（にもつ）はお部屋（へや）までお運（はこ）びいたします。", "Onimotsu wa oheya made ohakobi itashimasu.", "【店员】行李由我们为您送到房间（＝します）。"),
     ("ます", "どういたしまして！（不客气＝没什么大不了的）", "Dou itashimashite!", "不客气！（日常最常说的致す派生句）。"),
     ("店员常说", "【收银】ただいまお会計（かいけい）をいたします。", "Tadaima okaikei wo itashimasu.", "【收银】现在为您结账。"),
     {"passive": {"jp": "—", "kana": ""}, "causative": {"jp": "—", "kana": ""}, "causative_passive": {"jp": "—", "kana": ""}}),

    ("ご覧になる", "ご覧（らん）になる", "ごらんになる", "goran ni naru", "看、浏览（見る的尊他语）", "N4", "godan", "沟通社交", "vt", "〜を ご覧になる",
     ("ますか", "【店员】こちらのメニューをご覧（らん）になりますか？", "Kochira no menyuu wo goran ni narimasu ka?", "【店员】您要看一下这份菜单吗？"),
     ("ください", "窓（まど）の外（そと）をご覧（らん）ください、富士山（ふじさん）が見（み）えますよ！", "Mado no soto wo goran kudasai, Fujisan ga miemasu yo!", "请看窗外，能看到富士山哦！"),
     ("N4 敬语", "案内図（あんないず）をご覧（らん）になってお進（すす）みください。", "Annaizu wo goran ni natte osusumi kudasai.", "请参照导览图往前走。"),
     {"passive": {"jp": "—", "kana": ""}, "causative": {"jp": "—", "kana": ""}, "causative_passive": {"jp": "—", "kana": ""}}),

    ("気をつける", "気（き）をつける", "きをつける", "ki wo tsukeru", "注意、小心、留神", "N4", "ichidan", "核心基础", "vi", "〜に 気をつける",
     ("てください", "道（みち）が凍（こお）って滑りやすいので、気（き）をつけて歩（ある）いてくださいね。", "Michi ga kootte suberiyasui node, ki wo tsukete aruite kudasai ne.", "路面结冰很滑，走路请小心哦。"),
     ("ます", "食べ物（たべもの）のアレルギーには特（とく）に気（き）をつけています。", "Tabemono no arerugii ni wa toku ni ki wo tsukete imasu.", "我们对食物过敏特别注意。"),
     ("告别祝福", "それでは、お気（き）をつけてお帰（かえ）りください！", "Soredewa, oki wo tsukete okaeri kudasai!", "那您路上注意安全，慢走！"), None),

    ("混む", "混（こ）む", "こむ", "komu", "拥挤、人多（电车/餐厅）", "N4", "godan", "移动交通", "vi", "道/店が 混む",
     ("ています", "今（いま）このお店（みせ）、すごく混（こ）んでいますか？", "Ima kono omise, sugoku konde imasu ka?", "请问这家店现在很挤吗？"),
     ("ないうちに", "朝（あさ）のラッシュで混（こ）まないうちに移動（いどう）しましょう。", "Asa no rasshu de komanai uchi ni idou shimashou.", "趁早高峰还没挤起来，咱们先出发吧。"),
     ("💬 口语缩略", "ランチタイムは絶対（ぜったい）混（こ）んでるから予約（よやく）しといて正解（せいかい）だね。", "Ranchi taimu wa zettai konderu kara yoyaku shitoite seikai da ne.", "午饭时间肯定人多，幸好提前预约了！"), None),

    ("空く", "空（す）く", "すく", "suku", "变空(人少不挤)、肚子饿", "N4", "godan", "移动交通", "vi", "電車が 空く / お腹が 空く",
     ("ています", "平日（へいじつ）の午前中（ごぜんちゅう）は空（す）いていて快適（かいてき）ですね。", "Heijitsu no gozenchuu wa suite ite kaiteki desu ne.", "工作日早上人不挤真舒服呀。"),
     ("ました", "1時間（じかん）も遊（あそ）んだから、みんなお腹（なか）が空（す）きましたね！", "Ichijikan mo asonda kara, minna onaka ga sukimashita ne!", "玩了一小时，大家都饿了吧！"),
     ("💬 口语缩略", "わあ、お腹（なか）ペコペコに空（す）いちゃった！", "Waa, onaka pekopeko ni suichatta!", "哇，肚子饿得咕咕叫了！"), None),

    ("滑る", "滑（すべ）る", "すべる", "suberu", "滑行(滑雪)、脚底打滑", "N4", "godan", "亲子游玩", "vi", "雪の上を 滑る",
     ("ます", "軽井沢（かるいざわ）で家族（かぞく）みんなでスキーを滑（すべ）ります！", "Karuizawa de kazoku minna de sukii wo suberimasu!", "在轻井泽全家一起滑雪！"),
     ("やすい", "雨（あめ）の日の駅（えき）のタイルは滑（すべ）りやすいから気（き）をつけてね。", "Ame no hi no eki no tairu wa suberiyasui kara ki wo tsukete ne.", "下雨天车站的地砖很滑，注意别摔着哦。"),
     ("💬 口语缩略", "Jinny、昨日（きのう）よりぜんぜん上手（じょうず）に滑（すべ）れてるよ！", "Jinny, kinou yori zenzen jouzu ni subereteru yo!", "Jinny，比昨天滑得稳多啦！"), None),

    ("転ぶ", "転（ころ）ぶ", "ころぶ", "korobu", "摔倒、跌倒", "N4", "godan", "亲子游玩", "vi", "道で 転ぶ",
     ("た", "あっ、大丈夫（だいじょうぶ）？痛（いた）かったね、転（ころ）んじゃったね。", "A, daijoubu? Itakatta ne, koronjatta ne.", "啊，没事吧？疼了吧，摔了一跤呀（哄娃必用！）。"),
     ("ないように", "雪道（ゆきみち）で転（ころ）ばないように、ゆっくり小股（こまた）で歩（ある）こう。", "Yukimichi de korobanai you ni, yukkuri komata de arukou.", "雪地里小步慢走，别摔倒哦。"),
     ("N3 状态", "何度（なんど）転（ころ）んでもすぐ立（た）ち上（あ）がって偉（えら）いね！", "Nando korondemo sugu tachiagatte erai ne!", "摔倒好几次都马上爬起来，真棒呀！"), None),

    ("ぶつかる", "ぶつかる", "ぶつかる", "butsukaru", "撞到、碰到、(日程)冲突", "N3", "godan", "移动交通", "vi", "〜に ぶつかる",
     ("ない", "前（まえ）をよく見（み）て歩（ある）かないと、人（ひと）にぶつかるよ。", "Mae wo yoku mite arukanai to, hito ni butsukaru yo.", "不看前面好好走路的话，会撞到别人的哦。"),
     ("た", "ベビーカーがちょっと柱（はしら）にぶつかってしまいました。", "Bebiikaa ga chotto hashira ni butsukatte shimaimashita.", "婴儿车稍微撞到柱子了。"),
     ("N3 用法", "保育園（ほいくえん）のお迎（むか）えと時間（じかん）がぶつからないように調整（ちょうせい）しました。", "Hoikuen no omukae to jikan ga butsukaranai you ni chousei shimashita.", "我调整了时间，不让它和去保育园接孩子冲突。"), None),

    ("抱っこする", "抱（だ）っこする", "だっこする", "dakko suru", "抱起(孩子)（育儿超高频）", "N4", "irregular", "亲子游玩", "vt", "子どもを 抱っこする",
     ("て", "歩（ある）き疲（つか）れたかな？パパが抱（だ）っこしてあげるよ。", "Aruki tsukareta kana? Papa ga dakko shite ageru yo.", "是不是走累啦？爸爸抱你吧。"),
     ("ながら", "子（こ）どもを抱（だ）っこしながら荷物（にもつ）を持（も）つのは大変（たいへん）ですね。", "Kodomo wo dakko shinagara nimotsu wo motsu no wa taihen desu ne.", "一边抱着孩子一边拎东西真不容易呀。"),
     ("💬 口语缩略", "今（いま）おうち着（つ）くまで、抱（だ）っこしといてあげるね。", "Ima ouchi tsuku made, dakko shitoite ageru ne.", "到家之前，我先抱着你走吧。"), None),

    ("避ける", "避（さ）ける", "さける", "sakeru", "避开、躲避（人群/过敏原）", "N3", "ichidan", "生活起居", "vt", "〜を 避ける",
     ("て", "混雑（こんざつ）を避（さ）けるために、朝（あさ）9時（じ）に出発（しゅっぱつ）しましょう。", "Konzatsu wo sakeru tame ni, asa kuji ni shuppatsu shimashou.", "为了避开拥堵，咱们早上9点出发吧。"),
     ("ます", "子どもが生（なま）ものや辛（から）いものを避（さ）けて注文（ちゅうもん）します。", "Kodomo ga namamono ya karai mono wo sakete chuumon shimasu.", "帮孩子避开生食和辣的菜来点餐。"),
     ("N3 思考", "できれば年末（ねんまつ）のラッシュは避（さ）けたいですね。", "Dekireba nenmatsu no rasshu wa saketai desu ne.", "可以的话真想避开年底出行高峰呢。"), None),

    ("確かめる", "確（たし）かめる", "たしかめる", "tashikameru", "核实、确认清楚（细节/路线）", "N3", "ichidan", "沟通社交", "vt", "〜を 確かめる",
     ("て", "念（ねん）のため、乗（の）り場（ば）の番号（ばんごう）をもう1回（かい）確（たし）かめておこう。", "Nen no tame, noriba no bangou wo mou ikkai tashikamete okou.", "保险起见，再核实一遍乘车口编号吧。"),
     ("ます", "フロントで荷物（にもつ）が届（とど）いているか確（たし）かめます。", "Furonto de nimotsu ga todoite iru ka tashikamemasu.", "去前台确认一下行李到了没有。"),
     ("💬 口语缩略", "Googleマップで出口（でぐち）の方角（ほうがく）を確（たし）かめといたよ。", "Google Mappu de deguchi no hougaku wo tashikametoita yo.", "已经在谷歌地图上确认好出口方向了哦。"), None),

    ("我慢する", "我慢（がまん）する", "がまんする", "gaman suru", "忍耐、忍住", "N4", "irregular", "思考情绪", "vt", "〜を 我慢する",
     ("て", "あと10分（ぷん）で着（つ）くから、もうちょっとだけ我慢（がまん）してね。", "Ato juppun de tsuku kara, mou chotto dake gaman shite ne.", "再过10分钟就到了，稍微忍耐一下下哦。"),
     ("ない", "トイレは我慢（がまん）しないで、早（はや）めに教（おし）えてね！", "Toire wa gaman shinaide, hayame ni oshiete ne!", "想上厕所可别憋着，早点告诉爸爸妈妈哦！"),
     ("N3 表现", "お姉（ねえ）ちゃんは痛（いた）くても泣（な）かずにじっと我慢（がまん）していました。", "Onee-chan wa itakutemo nakazu ni jitto gaman shite imashita.", "姐姐就算疼也没哭，一直默默忍耐着，真厉害。"), None),

    ("遠慮する", "遠慮（えんりょ）する", "えんりょする", "enryo suru", "客气、婉拒、顾忌（请勿吸烟等）", "N4", "irregular", "沟通社交", "vt", "〜を 遠慮する",
     ("ないで", "何（なに）か必要（ひつよう）なものがあれば、どうぞ遠慮（えんりょ）なくおっしゃってください。", "Nani ka hitsuyou na mono ga areba, douzo enryo naku osshatte kudasai.", "如果有什么需要的东西，请千万别客气直接告诉我们。"),
     ("ください", "【看板/提示】店内（てんない）でのフラッシュ撮影（さつえい）はご遠慮（えんりょ）ください。", "Tennai deno furasshu satsuei wa goenryo kudasai.", "【看板高频】店内请勿使用闪光灯拍照（＝禁止的委婉说法！）。"),
     ("客气", "あ、お気遣（きづか）いありがとうございます。でも遠慮（えんりょ）しておきますね。", "A, okizukai arigatou gozaimasu. Demo enryo shite okimasu ne.", "啊，谢谢您的好意，不过我就先不用啦。"), None),

    ("両替する", "両替（りょうがえ）する", "りょうがえする", "ryougae suru", "兑换外币、换零钱", "N4", "irregular", "购物消费", "vt", "〜を 両替する",
     ("たい", "すみません、1万円札（いちまんえんさつ）を千円札（せんえんさつ）に両替（りょうがえ）できますか？", "Sumimasen, ichiman-en-satsu wo sen-en-satsu ni ryougae dekimasu ka?", "不好意思，能把1万日元纸币换成1千日元的零钱吗？（投币洗衣/小店必用！）"),
     ("ます", "空港（くうこう）のカウンターでドルを日本円（にほんえん）に両替（りょうがえ）します。", "Kuukou no kauntaa de doru wo Nihon'en ni ryougae shimasu.", "在机场柜台把美元换成日元。"),
     ("💬 口语缩略", "ガチャガチャ用（よう）に100円玉（ひゃくえんだま）に両替（りょうがえ）しとこう。", "Gachagacha-you ni hyaku-en-dama ni ryougae shitokou.", "给孩子玩扭蛋机，先换点100日元硬币备着吧。"), None),
]


NEW_GRAMMAR_POINTS = [
    # 4 N4 Essentials (g-n4-33..36)
    {
        "id": "g-n4-33", "level": "N4", "order": 33, "importance": 5, "importanceLabel": "🔥 每日必用",
        "pattern": "お〜ください / ご〜ください", "reading": "o ~ kudasai / go ~ kudasai",
        "meaning": "请您……（尊他敬语指令：店员/标识最高频！）",
        "formation": "お ＋ 动词ます形去ます ＋ ください ｜ ご ＋ サ变动词词干 ＋ ください",
        "explanation": "去日本餐厅、酒店、电车听到或看到的标志90%都是这个句型！「お待ちください（请稍等）」「ご確認ください（请确认）」「お座りください（请坐）」。",
        "tip": "例外固定词：「ご覧ください（请看）」「お召し上がりください（请享用）」。",
        "dailyExamples": [
            {"ctx": "酒店", "jp": "ただいま確認（かくにん）いたしますので、少々（しょうしょう）お待（ま）ちください。", "romaji": "Tadaima kakunin itashimasu node, shoushou omachi kudasai.", "cn": "我现在为您确认，请稍等片刻。"},
            {"ctx": "餐厅", "jp": "お荷物（にもつ）はこちらのカゴにお入（い）れください。", "romaji": "Onimotsu wa kochira no kago ni oire kudasai.", "cn": "您的随身包请放到这边的篮子里。"},
            {"ctx": "案内", "jp": "どうぞお気（き）をつけてお帰（かえ）りください。", "romaji": "Douzo oki wo tsukete okaeri kudasai.", "cn": "路上请一定注意安全，慢走。"}
        ],
        "quiz": {"promptJp": "チェックインの時間（じかん）をご＿＿ください。", "answer": "確認", "options": ["確認", "待ち", "座り", "食べ"], "cn": "请您确认一下办理入住的时间。"}
    },
    {
        "id": "g-n4-34", "level": "N4", "order": 34, "importance": 5, "importanceLabel": "🔥 每日必用",
        "pattern": "〜ていただく / 〜てくださる", "reading": "te itadaku / te kudasaru",
        "meaning": "承蒙您帮我做……（礼貌敬语版授受表达）",
        "formation": "动词て形 ＋ いただく（我方请别人做）｜ 动词て形 ＋ くださる（对方主动为我做）",
        "explanation": "「てもらう」的敬语升级版是「ていただく」，「てくれる」的尊他升级版是「てくださる」。在高端银座餐厅、酒店、保育园沟通中极为常用！",
        "tip": "向服务员提要求：「〜ていただけますか？」比「〜てください」客气一个档次；夸酒店方主动帮忙：「案内してくださいました」。",
        "dailyExamples": [
            {"ctx": "餐厅", "jp": "生肉（なまにく）を少（すこ）し焼（や）いていただけますか？", "romaji": "Namaniku wo sukoshi yaite itadakemasu ka?", "cn": "请问能帮我把生肉稍微烤熟一点吗？"},
            {"ctx": "酒店", "jp": "スタッフの方（かた）がタクシーを呼（よ）んでくださいました。", "romaji": "Sutaffu no kata ga takushii wo yonde kudasaimashita.", "cn": "酒店工作人员特意帮我们叫了出租车。"},
            {"ctx": "保育园", "jp": "娘（むすめ）に優（やさ）しく教（おし）えていただき、ありがとうございます。", "romaji": "Musume ni yasashiku oshiete itadaki, arigatou gozaimasu.", "cn": "非常感谢您这么温柔地教我女儿。"}
        ],
        "quiz": {"promptJp": "すみません、写真（しゃしん）を撮（と）って＿＿ますか？", "answer": "いただけ", "options": ["いただけ", "あげ", "くれ", "もらって"], "cn": "不好意思，能请您帮我们拍张照吗？"}
    },
    {
        "id": "g-n4-35", "level": "N4", "order": 35, "importance": 5, "importanceLabel": "🔥 每日必用",
        "pattern": "〜ちゃう / 〜とく / 〜なきゃ", "reading": "chau / toku / nakya",
        "meaning": "日本人口语缩略三巨头（聴解必听：不靠课本完全听得懂！）",
        "formation": "〜てしまう → 〜ちゃう（〜でしまう → 〜じゃう）｜ 〜ておく → 〜とく ｜ 〜なければならない → 〜なきゃ",
        "explanation": "真实日剧、咖啡馆和家庭对话里，90%的人都用缩略形：「食べちゃった」「置いとく」「行かなきゃ」。学完这个，听力瞬间清晰一倍！",
        "tip": "「〜ている」也常省掉「い」变成「〜てる」（例：寝てる＝正在睡、知ってる＝知道）。",
        "dailyExamples": [
            {"ctx": "家庭", "jp": "もうすぐバスが来（き）ちゃうから、早（はや）く靴（くつ）を履（は）かなきゃ！", "romaji": "Mou sugu basu ga kichau kara, hayaku kutsu wo hakanakya!", "cn": "巴士马上就要来啦，得赶紧穿鞋才行！"},
            {"ctx": "旅行", "jp": "切符（きっぷ）は先（さき）に買（か）っといたほうがいいよ。", "romaji": "Kippu wa saki ni kattoita hou ga ii yo.", "cn": "车票还是提前先买好比较好哦。"},
            {"ctx": "日常", "jp": "あ、コーヒー飲（の）んじゃったの？おいしかった？", "romaji": "A, koohii nonjatta no? Oishikatta?", "cn": "啊，你已经把咖啡喝完啦？好喝吗？"}
        ],
        "quiz": {"promptJp": "チェックアウトの前（まえ）に、荷物（にもつ）をまとめ＿＿！（〜ておこう口语）", "answer": "とこう", "options": ["とこう", "ちゃおう", "なきゃ", "てる"], "cn": "退房前先把行李提前收拾好吧（〜ておく缩略形）。"}
    },
    {
        "id": "g-n4-36", "level": "N4", "order": 36, "importance": 4, "importanceLabel": "⭐ 高频实用",
        "pattern": "使役被动（〜させられる / 〜される）", "reading": "saserareru / sareru",
        "meaning": "被迫做…… / 不由得……（情绪自发或无奈接受）",
        "formation": "五段「あ段＋される」（す结尾必须「さ＋せられる」）｜ 一段「去る＋させられる」｜ する→させられる",
        "explanation": "表达“本来不想做却被迫做了某事”（排队等了1小时＝待たされた），或“听了故事很受感动”（感動させられた）。",
        "tip": "五段除了す结尾外都用短缩形：待つ→待たされる、行く→行かされる、飲む→飲まされる；話す→話させられる（不能缩）。",
        "dailyExamples": [
            {"ctx": "餐厅", "jp": "人気店（にんきてん）なので、外（そと）で40分（ぷん）も待（ま）たされました。", "romaji": "Ninkiten na node, soto de yonjuppun mo matasaremashita.", "cn": "因为是网红店，我们在外面被迫等了足足40分钟。"},
            {"ctx": "职场", "jp": "昨日（きのう）は夜遅（よるおそ）くまで残業（ざんぎょう）させられました。", "romaji": "Kinou wa yoru osoku made zangyou saseraremashita.", "cn": "昨天被迫加班到深夜。"},
            {"ctx": "旅行", "jp": "旅館（りょかん）のおもてなしに本当（ほんとう）に感動（かんどう）させられました。", "romaji": "Ryokan no omotenashi ni hontou ni kandou saseraremashita.", "cn": "真的被温泉旅馆的待客之道深深打动了。"}
        ],
        "quiz": {"promptJp": "混（こ）んでいて、1時間（じかん）も外（そと）で＿＿。", "answer": "待たされた", "options": ["待たされた", "待ってくれた", "待たせた", "待てた"], "cn": "太挤了，在外面硬等了一个小时。"}
    },

    # 16 N3 Core Fluency Points (g-n3-31..46)
    {
        "id": "g-n3-31", "level": "N3", "order": 31, "importance": 5, "importanceLabel": "🔥 每日必用",
        "pattern": "〜に違いない", "reading": "ni chigainai",
        "meaning": "肯定……、一定是……没错（自信度 95% 以上的断定推测）",
        "formation": "动词/い形简体 ＋ に違いない ｜ な形/名词（去だ）＋ に違いない",
        "explanation": "说话人根据线索或直觉，非常有把握地判断“绝对错不了！”，比「〜だろう / 〜はずだ」语气更强更肯定。",
        "tip": "注意后面绝不接「だ」：○ 便利に違いない（× 便利だに違いない）。",
        "dailyExamples": [
            {"ctx": "美食", "jp": "こんなに並（なら）んでいるんだから、おいしいに違（ちが）いないよ！", "romaji": "Konna ni narande iru nda kara, oishii ni chigainai yo!", "cn": "排这么长的队，肯定超好吃没错！"},
            {"ctx": "旅行", "jp": "あの建物（たてもの）が今日（きょう）泊（と）まるホテルに違（ちが）いないです。", "romaji": "Ano tatemono ga kyou tomaru hoteru ni chigainai desu.", "cn": "那栋建筑一定是咱们今天住的酒店没错。"},
            {"ctx": "家庭", "jp": "Jinnyも軽井沢（かるいざわ）の雪（ゆき）を見（み）たら大喜（おおよろこ）びするに違（ちが）いない。", "romaji": "Jinny mo Karuizawa no yuki wo mitara ooyorokobi suru ni chigainai.", "cn": "Jinny 看到轻井泽的雪肯定会乐疯的。"}
        ],
        "quiz": {"promptJp": "あんなに評判（ひょうばん）がいいんだから、この寿司屋（すしや）は最高（さいこう）＿＿。", "answer": "に違いない", "options": ["に違いない", "わけがない", "ことはない", "といっても"], "cn": "口碑这么好，这家寿司店肯定棒极了。"}
    },
    {
        "id": "g-n3-32", "level": "N3", "order": 32, "importance": 5, "importanceLabel": "🔥 每日必用",
        "pattern": "〜わけがない / 〜わけはない", "reading": "wake ga nai",
        "meaning": "绝不可能……、哪有……的道理（强烈否定可能性）",
        "formation": "动词/い形简体 ＋ わけがない ｜ な形＋な / 名词＋の ＋ わけがない",
        "explanation": "从常识或逻辑出发强烈否定某事：“怎么可能！”要注意和「〜わけではない（并非……）」区分！",
        "tip": "「高いわけではない」＝倒也不是很贵（部分否定）；「高いわけがない」＝绝不可能贵（100%否定）。",
        "dailyExamples": [
            {"ctx": "家庭", "jp": "こんなおいしいケーキ、2歳（さい）の子（こ）どもが嫌（きら）いなわけがないよ！", "romaji": "Konna oishii keeki, nisai no kodomo ga kirai na wake ga nai yo!", "cn": "这么好吃的蛋糕，2岁小孩怎么可能讨厌呢！"},
            {"ctx": "日常", "jp": "そんな大金（たいきん）、1日（にち）で使（つか）えるわけがないでしょう。", "romaji": "Sonna taikin, ichinichi de tsukaeru wake ga nai deshou.", "cn": "那么多钱一天哪花得完啊。"},
            {"ctx": "学习", "jp": "勉強（べんきょう）せずに日本語（にほんご）がペラペラになるわけがない。", "romaji": "Benkyou sezu ni Nihongo ga perapera ni naru wake ga nai.", "cn": "不学习日语绝不可能变流利的。"}
        ],
        "quiz": {"promptJp": "こんな簡単（かんたん）な道（みち）、間違う（まちがう）＿＿よ。", "answer": "わけがない", "options": ["わけがない", "に違いない", "わけにはいかない", "わけではない"], "cn": "这么简单的路，绝不可能走错啦。"}
    },
    {
        "id": "g-n3-33", "level": "N3", "order": 33, "importance": 4, "importanceLabel": "⭐ 高频实用",
        "pattern": "〜ことはない", "reading": "koto wa nai",
        "meaning": "没有必要……、用不着……（安慰或省事建议）",
        "formation": "动词辞书形 ＋ ことはない",
        "explanation": "告诉别人“不用特地那样做 / 用不着担心”，口语里非常温柔实用。",
        "tip": "不要和过去式「〜たことがない（从未做过）」混淆！辞书形＋ことはない＝没必要。",
        "dailyExamples": [
            {"ctx": "安慰", "jp": "時間はまだ十分（じゅうぶん）あるから、そんなに急（いそ）ぐことはないよ。", "romaji": "Jikan wa mada juubun aru kara, sonna ni isogu koto wa nai yo.", "cn": "时间还很充裕，用不着那么着急哦。"},
            {"ctx": "旅行", "jp": "同じ庭園（ていえん）の中（なか）だから、大（おお）きい荷物（にもつ）を運（はこ）ぶことはないね。", "romaji": "Onaji teien no naka dakara, ookii nimotsu wo hakobu koto wa nai ne.", "cn": "就在同一个庭园里，没必要自己搬大行李嘛。"},
            {"ctx": "育儿", "jp": "少（すこ）しくらい日本語（にほんご）が間違（まちが）っても、気（き）にする（心配する）ことはないですよ。", "romaji": "Sukoshi kurai Nihongo ga machigattemo, shinpai suru koto wa nai desu yo.", "cn": "日语说错一点点也完全用不着担心的。"}
        ],
        "quiz": {"promptJp": "電車（でんしゃ）は5分（ふん）おきに来（く）るから、走（はし）る＿＿よ。", "answer": "ことはない", "options": ["ことはない", "ことがある", "わけがない", "はずだ"], "cn": "电车每5分钟就有一班，用不着跑啦。"}
    },
    {
        "id": "g-n3-34", "level": "N3", "order": 34, "importance": 4, "importanceLabel": "⭐ 高频实用",
        "pattern": "〜てたまらない / 〜てしょうがない", "reading": "te tamaranai / te shou ga nai",
        "meaning": "……得不得了、……得受不了（情绪/感觉达到顶点）",
        "formation": "い形去い＋くて / な形＋で / 动词て形 ＋ たまらない（しょうがない）",
        "explanation": "表达兴奋、开心、想念、困倦、冷热等感受强烈到无法控制。“真想赶紧去！”“开心得不得了！”。",
        "tip": "主要用于描述说话人自己的生理感觉或强烈情感；形容他人可说「〜がってたまらない」。",
        "dailyExamples": [
            {"ctx": "期待", "jp": "由布院（ゆふいん）の温泉（おんせん）に入（はい）るのが楽（たの）しみでたまらない！", "romaji": "Yufuin no onsen ni hairu no ga tanoshimi de tamaranai!", "cn": "期待去泡由布院温泉期待得不得了！"},
            {"ctx": "疲劳", "jp": "長旅（ながたび）で眠（ねむ）くてたまらないので、今夜（こんや）は早（はや）く寝（ね）ます。", "romaji": "Nagatabi de nemukute tamaranai node, kon'ya wa hayaku nemasu.", "cn": "长途飞行困得要命，今晚早点睡。"},
            {"ctx": "天气", "jp": "手袋（てぶくろ）を忘（わす）れて、手（て）が冷（つめ）たくてしょうがないよ。", "romaji": "Tebukuro wo wasurete, te ga tsumetakute shou ga nai yo.", "cn": "忘带手套，手冻得受不了啦。"}
        ],
        "quiz": {"promptJp": "1日中（じゅう）遊（あそ）んでお腹（なか）が空（す）いて＿＿！", "answer": "たまらない", "options": ["たまらない", "ことはない", "わけがない", "おかげだ"], "cn": "玩了一整天，饿得不得了！"}
    },
    {
        "id": "g-n3-35", "level": "N3", "order": 35, "importance": 4, "importanceLabel": "⭐ 高频实用",
        "pattern": "〜ものの", "reading": "mono no",
        "meaning": "虽然……但是……（承认前者事实，转折出小遗憾或现实情况）",
        "formation": "动词/い形简体 ＋ ものの ｜ な形＋な / 名词＋である ＋ ものの",
        "explanation": "比「〜けれど」更书面、更地道，常用于“虽然做好了准备/买了东西，但实际情况有点出乎意料”。",
        "tip": "「〜ものの」后半句不能接强烈的命令、禁止或意志表达，而是客观陈述后来的状况。",
        "dailyExamples": [
            {"ctx": "旅行", "jp": "天気予報（てんきよほう）を見（み）て傘（かさ）を持（も）ってきたものの、まったく降（ふ）らなかった。", "romaji": "Tenki yohou wo mite kasa wo motte kita mono no, mattaku furanakatta.", "cn": "虽然看了天气预报带了伞，但雨完全没下。"},
            {"ctx": "购物", "jp": "高（たか）いコートを買（か）ったものの、暖（あたた）かくてあまり着（き）る機会（きかい）がない。", "romaji": "Takai kooto wo katta mono no, atatakakute amari kiru kikai ga nai.", "cn": "虽然买了件贵大衣，但天气暖和没怎么有机会穿。"},
            {"ctx": "学习", "jp": "敬語（けいご）を覚（おぼ）えたものの、とっさのときに口（くち）から出（で）てこない。", "romaji": "Keigo wo oboeta mono no, tossa no toki ni kuchi kara dete konai.", "cn": "敬语虽然背了，但临场一下子说不出口。"}
        ],
        "quiz": {"promptJp": "早（はや）く起（お）きた＿＿、まだ眠（ねむ）くて動（うご）けない。", "answer": "ものの", "options": ["ものの", "うちに", "おかげで", "ついでに"], "cn": "虽然早起了，但还是困得动弹不得。"}
    },
    {
        "id": "g-n3-36", "level": "N3", "order": 36, "importance": 4, "importanceLabel": "⭐ 高频实用",
        "pattern": "〜にもかかわらず", "reading": "ni mo kakawarazu",
        "meaning": "尽管……却……、不顾……仍然……（正式且强转折）",
        "formation": "动词/い形简体 / な形词干 / 名词 ＋ にもかかわらず",
        "explanation": "相当于书面或礼貌升级版的「〜のに」，强调“在如此不利或特别的情况下居然还是发生了某事”，常用于礼貌致谢或感慨。",
        "tip": "礼貌致谢经典句：「お忙しい中にもかかわらず（虽然您很忙，还是……）」。注意名词/な形容词直接接，不加「な」或「の」。",
        "dailyExamples": [
            {"ctx": "礼貌", "jp": "お忙（いそが）しいにもかかわらず、丁寧（ていねい）にご対応（たいおう）いただきありがとうございます。", "romaji": "Oisogashii ni mo kakawarazu, teinei ni gotaiou itadaki arigatou gozaimasu.", "cn": "尽管您很忙碌，还承蒙如此细致地接待，非常感谢。"},
            {"ctx": "天气", "jp": "大雪（おおゆき）にもかかわらず、新幹線（しんかんせん）は定刻（ていこく）通（どお）りに到着（とうちゃく）しました。", "romaji": "Ooyuki ni mo kakawarazu, shinkansen wa teikoku doori ni touchaku shimashita.", "cn": "尽管下大雪，新干线依然准点到达了。"},
            {"ctx": "家庭", "jp": "朝（あさ）早（はや）いにもかかわらず、娘（むすめ）はニコニコで起（お）きました。", "romaji": "Asa hayai ni mo kakawarazu, musume wa nikoniko de okimashita.", "cn": "尽管起得很早，女儿依然笑眯眯地醒来了。"}
        ],
        "quiz": {"promptJp": "雨（あめ）＿＿、たくさんのお客（きゃく）さんが並（なら）んでいました。", "answer": "にもかかわらず", "options": ["にもかかわらず", "のおかげで", "にとって", "だけでなく"], "cn": "尽管下着雨，还是排着好多客人。"}
    },
    {
        "id": "g-n3-37", "level": "N3", "order": 37, "importance": 4, "importanceLabel": "⭐ 高频实用",
        "pattern": "〜一方で", "reading": "ippou de",
        "meaning": "另一方面……（同时具备两面性或对比两种情况）",
        "formation": "动词/い形简体 / な形＋な / 名词＋の ＋ 一方で",
        "explanation": "用来客观对比同一事物的两个侧面（比如东京方便但人多），或同时进行的两种状态。",
        "tip": "读音是「いっぽうで」。也可以单独放在句首作接续词「一方で、〜」。",
        "dailyExamples": [
            {"ctx": "旅行", "jp": "東京（とうきょう）はとても便利（べんり）な一方（いっぽう）で、人混（ひとご）みで疲（つか）れることもあります。", "romaji": "Toukyou wa totemo benri na ippou de, hitogomi de tsukareru koto mo arimasu.", "cn": "东京非常方便，但另一方面人多拥挤有时也会觉得累。"},
            {"ctx": "家庭", "jp": "昼（ひる）は夫婦（ふうふ）で美食（びしょく）を楽（たの）しむ一方（いっぽう）で、夜（よる）は全力（ぜんりょく）で遊（あそ）んであげます。", "romaji": "Hiru wa fuufu de bishoku wo tanoshimu ippou de, yoru wa zenryoku de asonde agemasu.", "cn": "白天夫妻俩享受美食的同时，晚上全力陪孩子们玩耍。"},
            {"ctx": "工作", "jp": "仕事（しごと）が忙（いそが）しい一方（いっぽう）で、家族（かぞく）との時間（じかん）も大切（たいせつ）にしたいです。", "romaji": "Shigoto ga isogashii ippou de, kazoku to no jikan mo taisetsu ni shitai desu.", "cn": "工作忙碌的同时，也想珍惜和家人相处的时光。"}
        ],
        "quiz": {"promptJp": "このホテルは駅（えき）から近（ちか）い＿＿、とても静（しず）かです。", "answer": "一方で", "options": ["一方で", "せいで", "ばかりに", "たびに"], "cn": "这家酒店离车站很近，同时又非常安静。"}
    },
    {
        "id": "g-n3-38", "level": "N3", "order": 38, "importance": 4, "importanceLabel": "⭐ 高频实用",
        "pattern": "〜をはじめ（として）", "reading": "wo hajime (to shite)",
        "meaning": "以……为首、以……为代表（列举代表性的例子）",
        "formation": "名词 ＋ をはじめ（として）",
        "explanation": "举出最典型、最有代表性的一项作为领头，表示“除了它以外还有其他同类”。在介绍行程、美食、景点时超有高级感！",
        "tip": "前面必须是名词；「〜をはじめ、いろいろな〜」是经典搭配。",
        "dailyExamples": [
            {"ctx": "旅行", "jp": "東京（とうきょう）をはじめ、軽井沢（かるいざわ）や福岡（ふくおか）などたくさんの街（まち）を巡（めぐ）ります。", "romaji": "Toukyou wo hajime, Karuizawa ya Fukuoka nado takusan no machi wo megurimasu.", "cn": "以东京为首，还将游览轻井泽、福冈等多个城市。"},
            {"ctx": "美食", "jp": "寿司（すし）をはじめ、天（てん）ぷらや鉄板焼（てっぱんや）きまで日本料理（にほんりょうり）を満喫（まんきつ）します。", "romaji": "Sushi wo hajime, tenpura ya teppanyaki made Nihon ryouri wo mankitsu shimasu.", "cn": "从寿司到天妇罗、铁板烧，尽情享受日本料理。"},
            {"ctx": "职场", "jp": "店長（てんちょう）をはじめ、スタッフ全員（ぜんいん）がとても親切（しんせつ）でした。", "romaji": "Tenchou wo hajime, sutaffu zen'in ga totemo shinsetsu deshita.", "cn": "从店长开始，全体员工都非常亲切。"}
        ],
        "quiz": {"promptJp": "富士山（ふじさん）＿＿、日本（にほん）には美（うつく）しい山（やま）がたくさんあります。", "answer": "をはじめ", "options": ["をはじめ", "のせいで", "にかわって", "として"], "cn": "以富士山为首，日本有很多美丽的山。"}
    },
    {
        "id": "g-n3-39", "level": "N3", "order": 39, "importance": 4, "importanceLabel": "⭐ 高频实用",
        "pattern": "〜を中心に（して）", "reading": "wo chuushin ni",
        "meaning": "以……为中心、围绕……（聚焦重点对象或地区）",
        "formation": "名词 ＋ を中心に（して） / 〜を中心とした ＋ 名词",
        "explanation": "表示活动的重心、地理中心或受众核心，比如“以品川站为中心出行”、“以儿童为中心的公园”。",
        "tip": "后面接名词时用「を中心とした＋名词」或「を中心にし＋た＋名词」。",
        "dailyExamples": [
            {"ctx": "行程", "jp": "品川（しながわ）や浜松町（はままつちょう）を中心（ちゅうしん）に、東京（とうきょう）の観光（かんこう）を楽（たの）しみます。", "romaji": "Shinagawa ya Hamamatsuchou wo chuushin ni, Toukyou no kankou wo tanoshimimasu.", "cn": "以品川和浜松町为中心，畅游东京。"},
            {"ctx": "饮食", "jp": "今週（こんしゅう）は和食（わしょく）を中心（ちゅうしん）にしたランチを予約（よやく）しました。", "romaji": "Konshuu wa washoku wo chuushin ni shita ranchi wo yoyaku shimashita.", "cn": "这周预约了以和食为主的午餐。"},
            {"ctx": "沟通", "jp": "旅行会話（りょこうかいわ）を中心（ちゅうしん）に毎日（まいにち）練習（れんしゅう）しています。", "romaji": "Ryokou kaiwa wo chuushin ni mainichi renshuu shite imasu.", "cn": "每天以旅行会话为中心进行练习。"}
        ],
        "quiz": {"promptJp": "銀座（ぎんざ）＿＿、いろいろなお店（みせ）を見て回（まわ）りました。", "answer": "を中心に", "options": ["を中心に", "に違って", "をかわりに", "のわりに"], "cn": "以银座为中心，逛了各种各样的店。"}
    },
    {
        "id": "g-n3-40", "level": "N3", "order": 40, "importance": 4, "importanceLabel": "⭐ 高频实用",
        "pattern": "〜に限らず", "reading": "ni kagirazu",
        "meaning": "不仅限于……（连其他方面也一样）",
        "formation": "名词 ＋ に限らず",
        "explanation": "比 N4 的「だけでなく」更有格调！常用来夸某物老少皆宜、国内外通用，或菜单不仅限于大人。",
        "tip": "固定搭配：「老若男女（ろうにゃくなんにょ）に限らず」「日本人に限らず」。",
        "dailyExamples": [
            {"ctx": "旅行", "jp": "この旅館（りょかん）は大人（おとな）に限（かぎ）らず、子（こ）どもにもとても優（やさ）しいです。", "romaji": "Kono ryokan wa otona ni kagirazu, kodomo ni mo totemo yasashii desu.", "cn": "这家旅馆不仅对大人，对小朋友也非常贴心。"},
            {"ctx": "美食", "jp": "福岡（ふくおか）はラーメンに限（かぎ）らず、もつ鍋（なべ）やお刺身（さしみ）も絶品（ぜっぴん）です。", "romaji": "Fukuoka wa raamen ni kagirazu, motsunabe ya osashimi mo zeppin desu.", "cn": "福冈不仅拉面，牛肠锅和刺身也是一绝。"},
            {"ctx": "语言", "jp": "日本語（にほんご）に限（かぎ）らず、どんな言語（げんご）も毎日（まいにち）の継続（けいぞく）が大切（たいせつ）です。", "romaji": "Nihongo ni kagirazu, donna gengo mo mainichi no keizoku ga taisetsu desu.", "cn": "不仅限于日语，任何语言每天坚持都很重要。"}
        ],
        "quiz": {"promptJp": "この動物園（どうぶつえん）は週末（しゅうまつ）＿＿、平日（へいじつ）も人気（にんき）があります。", "answer": "に限らず", "options": ["に限らず", "によって", "のために", "のおかげで"], "cn": "这家动物园不仅周末，连工作日都很有人气。"}
    },
    {
        "id": "g-n3-41", "level": "N3", "order": 41, "importance": 4, "importanceLabel": "⭐ 高频实用",
        "pattern": "〜ばかりでなく〜も", "reading": "bakari de naku ~ mo",
        "meaning": "不仅……而且……（递进补充亮点或优点）",
        "formation": "普通形（な形＋な / 名词直接接）＋ ばかりでなく 〜 も",
        "explanation": "「〜だけでなく〜も」的 N3 升级表达，用来夸食物好吃服务又好、酒店交通方便风景又美。",
        "tip": "后面常与「〜も / 〜さえ」呼应，口语中也常说「〜ばかりか〜も」。",
        "dailyExamples": [
            {"ctx": "酒店", "jp": "この部屋（へや）は広（ひろ）いばかりでなく、窓（まど）からの景色（けしき）も最高（さいこう）です。", "romaji": "Kono heya wa hiroi bakari de naku, mado kara no keshiki mo saikou desu.", "cn": "这间房不仅宽敞，窗外的风景也绝了。"},
            {"ctx": "餐厅", "jp": "味（あじ）がおいしいばかりでなく、店員（てんいん）さんの笑顔（えがお）も素敵（すてき）でした。", "romaji": "Aji ga oishii bakari de naku, ten'in-san no egao mo suteki deshita.", "cn": "不仅味道美味，店员的笑容也很迷人。"},
            {"ctx": "旅行", "jp": "軽井沢（かるいざわ）はスキーばかりでなく、ショッピングも楽（たの）しめます。", "romaji": "Karuizawa wa sukii bakari de naku, shoppingu mo tanoshimemasu.", "cn": "轻井泽不仅能滑雪，还可以逛街购物。"}
        ],
        "quiz": {"promptJp": "彼女（かのじょ）は英語（えいご）＿＿、日本語（にほんご）も上手（じょうず）です。", "answer": "ばかりでなく", "options": ["ばかりでなく", "わけではなく", "かわりに", "せいで"], "cn": "她不仅英语好，日语也很棒。"}
    },
    {
        "id": "g-n3-42", "level": "N3", "order": 42, "importance": 4, "importanceLabel": "⭐ 高频实用",
        "pattern": "〜としたら / 〜とすれば", "reading": "to shitara / to sureba",
        "meaning": "假设……的话、假如是这样的话",
        "formation": "动词/い形/な形/名词 普通形 ＋ としたら / とすれば",
        "explanation": "用来提出一个假设前提，讨论接下来的选择或推论（“假如明天不下雪的话，咱们就去坐缆车”）。",
        "tip": "句首常搭配「もし」或「仮に（かりに）」，后面接建议「〜ほうがいい」、推测「〜だろう」或愿望「〜たい」。",
        "dailyExamples": [
            {"ctx": "计划", "jp": "もし明日（あした）が雨（あめ）だとしたら、美術館（びじゅつかん）に行（い）くのはどう？", "romaji": "Moshi ashita ga ame da to shitara, bijutsukan ni iku no wa dou?", "cn": "假如明天下雨的话，去美术馆怎么样？"},
            {"ctx": "旅行", "jp": "もう1回（かい）日本（にほん）に来（こ）られるとしたら、どこに泊（と）まりたいですか？", "romaji": "Mou ikkai Nihon ni korareru to shitara, doko ni tomaritai desu ka?", "cn": "假如还能再来一次日本，你想住在哪里？"},
            {"ctx": "讨论", "jp": "11時（じ）に着（つ）くとすれば、その前（まえ）に荷物（にもつ）を預（あず）けられるね。", "romaji": "Juuichiji ni tsuku to sureba, sono mae ni nimotsu wo azukerareru ne.", "cn": "如果是11点到的话，那之前就能先把行李寄存了。"}
        ],
        "quiz": {"promptJp": "100万円（まんえん）当（あ）たった＿＿、何（なに）を買（か）いますか？", "answer": "としたら", "options": ["としたら", "おかげで", "ものの", "うちに"], "cn": "假如中了100万日元，你会买什么？"}
    },
    {
        "id": "g-n3-43", "level": "N3", "order": 43, "importance": 4, "importanceLabel": "⭐ 高频实用",
        "pattern": "〜さえ〜ば", "reading": "sae ~ ba",
        "meaning": "只要……就……（唯一满足条件，其余都迎刃而解）",
        "formation": "名词 ＋ さえ ＋ 动词ば形 / い形ければ / な形なら（动词ます形＋さえ＋すれば）",
        "explanation": "强调只要满足这唯一核心条件，一切都没问题（“只要全家平安健康就好”、“只要有Suica卡坐车就超方便”）。",
        "tip": "和「〜さえ」单独用（连……都……）区分开；加上后面的「〜ば」就是“只要……就……”。",
        "dailyExamples": [
            {"ctx": "家庭", "jp": "家族（かぞく）みんなが元気（げんき）でさえあれば、それだけで十分（じゅうぶん）です。", "romaji": "Kazoku minna ga genki de sae areba, sore dake de juubun desu.", "cn": "只要全家人都健康有活力，这就足够了。"},
            {"ctx": "旅行", "jp": "スマホの充電（じゅうでん）さえあれば、東京（とうきょう）ではどこでも行（い）けます。", "romaji": "Sumaho no juuden sae areba, Toukyou dewa doko demo ikemasu.", "cn": "只要手机有电，在东京去哪里都没问题。"},
            {"ctx": "语言", "jp": "「すみません」と「ありがとうございます」さえ言（い）えれば、旅行（りょこう）は楽（たの）しいよ！", "romaji": "'Sumimasen' to 'arigatou gozaimasu' sae iereba, ryokou wa tanoshii yo!", "cn": "只要会说“不好意思”和“谢谢”，旅行就会很开心哦！"}
        ],
        "quiz": {"promptJp": "パスポート＿＿持（も）っていれば、免税（めんぜい）で買（か）えます。", "answer": "さえ", "options": ["さえ", "しか", "だけ", "ばかり"], "cn": "只要带着护照，就能免税购买。"}
    },
    {
        "id": "g-n3-44", "level": "N3", "order": 44, "importance": 4, "importanceLabel": "⭐ 高频实用",
        "pattern": "〜っけ", "reading": "kke",
        "meaning": "……来着？（口语自言自语或向家人确认快忘掉的记忆）",
        "formation": "动词た形 / 名词＋だ(だった) / い形かった ＋ っけ",
        "explanation": "夫妻旅行每天都会脱口而出的神级口语助词！“明天几点的电车来着？”“这间房密码是多少来着？”",
        "tip": "语尾用升调（↗）问自己或问伴侣；只能接在过去式或「だ」后面（例：何時だっけ？ 何て言ったっけ？）。",
        "dailyExamples": [
            {"ctx": "夫妻", "jp": "明日（あした）の新幹線（しんかんせん）、何時（なんじ）発（はつ）だったっけ？", "romaji": "Ashita no shinkansen, nanji hatsu datta kke?", "cn": "明天的新干线，是几点出发来着？"},
            {"ctx": "回忆", "jp": "あれ、Suicaどこに入（い）れたっけ？バッグの中（なか）かな。", "romaji": "Are, Suica doko ni ireta kke? Baggu no naka ka na.", "cn": "咦，西瓜卡我放哪儿来着？是不是在包里呀。"},
            {"ctx": "对话", "jp": "「おいしかった」って日本語（にほんご）で過去形（かこけい）は何（なん）だっけ？", "romaji": "'Oishikatta' tte Nihongo de kakokei wa nan dakke?", "cn": "“真好吃”的日语过去式是什么来着？"}
        ],
        "quiz": {"promptJp": "チェックアウトは11時（じ）でし＿＿？12時だっけ？", "answer": "たっけ", "options": ["たっけ", "るっけ", "てっけ", "ないっけ"], "cn": "退房时间是11点来着？还是12点来着？"}
    },
    {
        "id": "g-n3-45", "level": "N3", "order": 45, "importance": 4, "importanceLabel": "⭐ 高频实用",
        "pattern": "〜最中に（さいちゅうに）", "reading": "saichuu ni",
        "meaning": "正在……的正当中（突然发生某件意料之外的事）",
        "formation": "动词ている ＋ 最中に ｜ 名词＋の ＋ 最中に",
        "explanation": "表示“正做着某件事做到兴头上/正中间”，突然发生了别的事（比如正吃饭时、正泡温泉时下起大雪）。",
        "tip": "经常和突发事件呼应；也可以说「〜最中だ（正忙着/正进行中）」。",
        "dailyExamples": [
            {"ctx": "旅行", "jp": "露天風呂（ろてんぶろ）に入（はい）っている最中（さいちゅう）に、きれいな雪（ゆき）が降（ふ）ってきました！", "romaji": "Rotenburo ni haitte iru saichuu ni, kirei na yuki ga futte kimashita!", "cn": "正泡露天温泉泡得舒服呢，居然飘起了美丽的雪花！"},
            {"ctx": "家庭", "jp": "食事（しょくじ）の最中（さいちゅう）に、下（した）の子（こ）がテーブルで寝（ね）ちゃいました。", "romaji": "Shokuji no saichuu ni, shita no ko ga teeburu de nechaimashita.", "cn": "吃到一半，小女儿直接在餐桌旁睡着了。"},
            {"ctx": "电话", "jp": "今（いま）運転（うんてん）の最中（さいちゅう）なので、後（あと）でかけ直（なお）しますね。", "romaji": "Ima unten no saichuu na node, ato de kakenaoshimasu ne.", "cn": "现在正在开车呢，待会再回电话哦。"}
        ],
        "quiz": {"promptJp": "会議（かいぎ）＿＿、携帯（けいたい）が鳴（な）って焦（あせ）りました。", "answer": "の最中に", "options": ["の最中に", "のたびに", "のかわりに", "のせいで"], "cn": "正在开会开到一半时手机响了，好慌张。"}
    },
    {
        "id": "g-n3-46", "level": "N3", "order": 46, "importance": 3, "importanceLabel": "💎 进阶地道",
        "pattern": "〜にわたって / 〜にかけて", "reading": "ni watatte / ni kakete",
        "meaning": "历时…… / 在……整个期间・范围内",
        "formation": "时间/地点/范围名词 ＋ にわたって ｜ 起点〜から终点〜にかけて",
        "explanation": "「にわたって」强调跨越整个时间或空间范围（如“历时35晚的旅行”）；「〜から〜にかけて」常用于天气预报“从今晚到明早”。",
        "tip": "天气预报听力必会：「今夜から明日の朝にかけて雪が降るでしょう（从今晚到明早预计会下雪）」。",
        "dailyExamples": [
            {"ctx": "行程", "jp": "35泊（はく）にわたる家族（かぞく）みんなでの日本旅行（にほんりょこう）が始（はじ）まります！", "romaji": "Sanjuugohaku ni wataru kazoku minna de no Nihon ryokou ga hajimarimasu!", "cn": "历时35晚的全家日本大长假即将开启！"},
            {"ctx": "天气", "jp": "【天气预报】今夜（こんや）から明日（あした）の朝（あさ）にかけて、軽井沢（かるいざわ）は雪（ゆき）の予報（よほう）です。", "romaji": "Kon'ya kara ashita no asa ni kakete, Karuizawa wa yuki no yohou desu.", "cn": "【必听天气预报】从今晚到明天早上，轻井泽预报有雪。"},
            {"ctx": "范围", "jp": "東京（とうきょう）から九州（きゅうしゅう）にかけて、おいしいものを食（た）べ歩（ある）きます。", "romaji": "Toukyou kara Kyuushuu ni kakete, oishii mono wo tabearukimasu.", "cn": "从东京一直到九州，一路寻味吃遍美食。"}
        ],
        "quiz": {"promptJp": "12月（がつ）から1月（がつ）＿＿、日本（にほん）に滞在（たいざい）します。", "answer": "にかけて", "options": ["にかけて", "にとって", "について", "に対して"], "cn": "从12月到1月期间一直待在日本。"}
    }
]


# 9 New N4->N3 Extras Collections
LEARNING_EXTRAS_NEW = {
    "grammarComparisons": [
        {
            "id": "cmp-1",
            "title": "🔮 四大推测对比：そうだ(样态) vs そうだ(传闻) vs ようだ/みたいだ vs らしい",
            "summary": "N4→N3 最容易搞混的四兄弟！核心看【信息来源】：亲眼看到直觉 / 亲耳听说传闻 / 客观根据推理。",
            "rows": [
                {"form": "〜そうだ（样态）", "nuance": "亲眼看着马上要……（动词ます形去ます/形容词去い＋そうだ）", "exJp": "わあ、このケーキ、すごくおいしそうですね！", "exCn": "哇，这个蛋糕看起来好好吃！（亲眼看卖相）"},
                {"form": "〜そうだ（传闻）", "nuance": "听说……（普通形＋そうだ · 据天气预报/别人说）", "exJp": "ニュースによると、明日（あした）は雪（ゆき）が降（ふ）るそうです。", "exCn": "听新闻说，明天会下雪。（消息来源）"},
                {"form": "〜ようだ / 〜みたいだ", "nuance": "好像……（根据现场迹象做主观判断，みたい更口语）", "exJp": "外（そと）が濡（ぬ）れているから、雨（あめ）が降（ふ）ったみたいだよ。", "exCn": "外面湿漉漉的，好像刚下过雨呢。（现场迹象）"},
                {"form": "〜らしい", "nuance": "听说/似乎……/很有……风范（客观听闻，不带主观臆测）", "exJp": "あの店（みせ）、すごく人気（にんき）らしいですよ。", "exCn": "听说那家店好像超级火哦。（坊间传闻）"}
            ]
        },
        {
            "id": "cmp-2",
            "title": "⏱️ 状态存续三剑客：〜ている vs 〜てある vs 〜ておく",
            "summary": "自他动词＋状态表达黄金组合！分清“自然结果”、“刻意留存”与“提前准备”。",
            "rows": [
                {"form": "自动词 ＋ 〜ている", "nuance": "客观描述眼前持续的状态（门开着/灯亮着，不管谁做的）", "exJp": "あ、窓（まど）が開（あ）いていますよ。", "exCn": "啊，窗户开着呢。"},
                {"form": "他动词 ＋ 〜てある", "nuance": "某人刻意做完后结果摆在那里（带「が」：提前备好了）", "exJp": "テーブルにお箸（はし）が並（なら）べてあります。", "exCn": "桌子上已经摆好筷子了（服务员提前摆好的）。"},
                {"form": "他动词 ＋ 〜ておく", "nuance": "为了后续方便，现在提前先做好（口语缩略为「〜とく」）", "exJp": "チェックイン前（まえ）に荷物（にもつ）を預（あず）けときます。", "exCn": "办入住前我先把行李寄存好。"}
            ]
        },
        {
            "id": "cmp-3",
            "title": "🔀 四大条件句：〜と vs 〜ば vs 〜たら vs 〜なら",
            "summary": "去日本开口“如果……”不再卡壳！记住：日常万金油选「〜たら」，提话题建议选「〜なら」。",
            "rows": [
                {"form": "〜と（必然/自然结果）", "nuance": "一……就……（指路、机械操作、季节规律，后句不能接请求/命令）", "exJp": "この角（かど）を右（みぎ）へ曲（ま）がると、駅（えき）が見（み）えます。", "exCn": "在这个拐角往右拐，就能看到车站了。"},
                {"form": "〜ば（一般条件/假设）", "nuance": "只要满足条件就会……（谚语、规律、只要……就……）", "exJp": "よく練習（れんしゅう）すれば、すぐ上手（じょうず）になりますよ。", "exCn": "只要多加练习，很快就能变熟练哦。"},
                {"form": "〜たら（万能如果/完了后）", "nuance": "1) 假如某事发生 2) 做完某事之后（口语最常用！可接请求）", "exJp": "ホテルに着（つ）いたら、電話（でんわ）してくださいね。", "exCn": "到了酒店之后，请给我打个电话哦。"},
                {"form": "〜なら（承接对方话题）", "nuance": "如果是你说的那个事的话，我推荐……（常用于给建议）", "exJp": "ラーメンなら、博多駅（はかたえき）の近（ちか）くがおいしいですよ。", "exCn": "要是想吃拉面的话，博多站附近很好吃哦。"}
            ]
        },
        {
            "id": "cmp-4",
            "title": "🎯 目的表达双雄：〜ために vs 〜ように",
            "summary": "同样翻译为“为了……”，关键看前面动词自己能不能控制！",
            "rows": [
                {"form": "意志动词辞书形 / 名词＋の ＋ ために", "nuance": "主语自己有意志去达成目标（注意前后主语通常一致）", "exJp": "家族（かぞく）の記念日（きねんび）を祝（いわ）うために、銀座（ぎんざ）へ行（い）きます。", "exCn": "为了庆祝家庭纪念日，我们去银座。"},
                {"form": "可能形 / 否定形 / 无意志动词 ＋ ように", "nuance": "为了能达到某种状态/避免发生意外（“以免……/以便……”）", "exJp": "忘（わす）れないように、スマホにメモしておきます。", "exCn": "为了不忘记，我记在手机备忘录里。"}
            ]
        },
        {
            "id": "cmp-5",
            "title": "🌱 变化与决定四姐妹：ようになる / ようにする vs ことになる / ことにする",
            "summary": "区分“能力的自然变化”、“个人努力习惯”与“客观安排/主观决定”。",
            "rows": [
                {"form": "〜ようになる", "nuance": "从不会/不能变成会/能（能力变化）", "exJp": "毎日（まいにち）聴（き）いて、店員（てんいん）の話（はなし）が分（わ）かるようになりました。", "exCn": "每天坚持听，慢慢能听懂店员的话了。"},
                {"form": "〜ようにする", "nuance": "平时有意识地努力尽量去做/不做", "exJp": "体（からだ）のために、毎朝（まいあさ）お水（みず）を飲（の）むようにしています。", "exCn": "为了健康，我尽量每天早上喝水。"},
                {"form": "〜ことにする", "nuance": "我自己主观决定要做……", "exJp": "今夜（こんや）はホテルの近（ちか）くで食（た）べることにしました。", "exCn": "我们决定今晚就在酒店附近吃。"},
                {"form": "〜ことになる", "nuance": "客观决定/最终安排成……（公司/日程规定）", "exJp": "12月（がつ）から1月（がつ）まで日本（にほん）に滞在（たいざい）することになりました。", "exCn": "最终安排好从12月到1月待在日本。"}
            ]
        },
        {
            "id": "cmp-6",
            "title": "⇄ 自动词 vs 他动词核心逻辑：が vs を",
            "summary": "记住一句话：眼前自然发生/呈现在那里用【自动词＋が】；人主动去动作改变对象用【他动词＋を】！",
            "rows": [
                {"form": "自动词（主体 ＋ が ＋ 自动词）", "nuance": "不强调谁做的，描述事物本身变化或当前状态", "exJp": "あっ、自動（じどう）ドアが開（あ）きました。お湯（ゆ）が沸（わ）いたよ。", "exCn": "啊，自动门开了。水烧开了哦。"},
                {"form": "他动词（行为 ＋ を ＋ 他动词）", "nuance": "有明确的动作发出者“把某物怎么样了”", "exJp": "窓（まど）を開（あ）けてもいいですか？お湯（ゆ）を沸（わ）かしますね。", "exCn": "可以开一下窗户吗？我来烧点热水。"},
                {"form": "常见词尾速记规律", "nuance": "① -aru(自) vs -eru(他) ② -reru(自) vs -su(他) ③ -eru(自) vs -u(他)", "exJp": "止（と）まる↔止（と）める / 壊（こわ）れる↔壊（こわ）す / 開（あ）く↔開（あ）ける", "exCn": "比如 集まる↔集める、落ちる↔落とす、割れる↔割る！"}
            ]
        }
    ],

    "contractions": [
        {"formal": "〜ている", "casual": "〜てる", "rule": "去掉「い」（最超高频！100%必听）", "exFormal": "子どもが部屋（へや）で寝（ね）ています。", "exCasual": "子（こ）どもが部屋（へや）で寝（ね）てるよ。", "exCn": "孩子正在房间里睡觉哦。"},
        {"formal": "〜ていない", "casual": "〜てない", "rule": "去掉「い」（还没……）", "exFormal": "まだ朝（あさ）ごはんを食（た）べていません。", "exCasual": "まだ朝（あさ）ごはん食（た）べてないんだ。", "exCn": "还没吃早饭呢。"},
        {"formal": "〜てしまう", "casual": "〜ちゃう", "rule": "て＋しまう → ちゃう（做了/糟糕）", "exFormal": "切符（きっぷ）をなくしてしまいました！", "exCasual": "切符（きっぷ）をなくしちゃった！", "exCn": "把车票弄丢了！"},
        {"formal": "〜でしまう", "casual": "〜じゃう", "rule": "で＋しまう → じゃう（浊音）", "exFormal": "全部（ぜんぶ）飲（の）んでしまいました。", "exCasual": "全部（ぜんぶ）飲（の）んじゃった！", "exCn": "全喝光了！"},
        {"formal": "〜ておく", "casual": "〜とく", "rule": "て＋おく → とく（提前先做）", "exFormal": "荷物（にもつ）はフロントに預（あず）けておきます。", "exCasual": "荷物（にもつ）はフロントに預（あず）けとくね。", "exCn": "行李我先寄存在前台哦。"},
        {"formal": "〜でおく", "casual": "〜どく", "rule": "で＋おく → どく（浊音）", "exFormal": "今のうちに読（よ）んでおきましょう。", "exCasual": "今のうちに読（よ）んどこう！", "exCn": "趁现在先提前读一遍吧！"},
        {"formal": "〜なければ（ならない）", "casual": "〜なきゃ", "rule": "必须得做……（常省略后半句ならない）", "exFormal": "そろそろ行（い）かなければなりません。", "exCasual": "そろそろ行（い）かなきゃ！", "exCn": "差不多得走了！"},
        {"formal": "〜なくてはいけない", "casual": "〜なくちゃ", "rule": "也表示“必须得做……”（常用于提醒）", "exFormal": "パスポートを持（も）って行（い）かなくてはいけません。", "exCasual": "パスポート持（も）って行（い）かなくちゃ！", "exCn": "必须带上护照才行！"},
        {"formal": "〜てあげる", "casual": "〜てあげる / 〜たる", "rule": "关西常见「〜たる」，东京常缩音「〜てやる」", "exFormal": "パパが抱（だ）っこしてあげます。", "exCasual": "パパが抱（だ）っこしてあげるね。", "exCn": "爸爸来抱你哦。"},
        {"formal": "〜てはいけない", "casual": "〜ちゃだめ / 〜じゃだめ", "rule": "不可以……（叮嘱孩子最高频！）", "exFormal": "廊下（ろうか）を走（はし）ってはいけません。", "exCasual": "廊下（ろうか）を走（はし）っちゃダメだよ！", "exCn": "走廊里不可以跑哦！"},
        {"formal": "〜というのは / 〜とは", "casual": "〜って / 〜っていうのは", "rule": "口语提起话题、引用别人说的话", "exFormal": "「替玉（かえだま）」というのはどういう意味（いみ）ですか？", "exCasual": "「替玉（かえだま）」って何（なん）ですか？", "exCn": "请问“替玉（加面）”是什么意思？"},
        {"formal": "〜のですか / 〜のです", "casual": "〜んですか / 〜んだ", "rule": "解释说明与询问理由的口语体", "exFormal": "どうしたのですか？", "exCasual": "どうしたんですか？ / どうしたの？", "exCn": "怎么了吗？发生什么事了？"},
        {"formal": "〜ではない / 〜じゃない", "casual": "〜じゃん", "rule": "表示“这不挺……嘛 / 对吧！”", "exFormal": "とてもいい天気（てんき）ではありませんか！", "exCasual": "すごくいい天気（てんき）じゃん！", "exCn": "天气这不是超级棒嘛！"},
        {"formal": "〜わからない", "casual": "〜わかんない", "rule": "ら行拨音化（ら/り/る/れ + ない → んない）", "exFormal": "すみません、場所（ばしょ）が分（わ）かりません。", "exCasual": "あれ、場所（ばしょ）がぜんぜん分（わ）かんない！", "exCn": "哎呀，完全不知道在哪儿！"},
        {"formal": "〜かもしれない", "casual": "〜かも", "rule": "省略「しれない」，表示“说不定/可能”", "exFormal": "午後（ごご）は雨（あめ）が降（ふ）るかもしれません。", "exCasual": "午後（ごご）、雨（あめ）降（ふ）るかもね。", "exCn": "下午说不定会下雨哦。"},
        {"formal": "〜てみる", "casual": "〜てみ（る）", "rule": "劝别人“试着看看/尝一口”", "exFormal": "一口（ひとくち）食（た）べてみてください。", "exCasual": "一口（ひとくち）食（た）べてみて！", "exCn": "来尝一口看看！"}
    ],

    "adverbs": [
        {"jp": "せっかく", "kana": "せっかく", "romaji": "sekkaku", "cn": "好不容易、难得", "jlpt": "N4", "pairing": "せっかく〜だから / のに", "ex": "せっかく日本（にほん）に来（き）たんだから、おいしいものをたくさん食（た）べよう！", "exCn": "难得来一趟日本，咱们多吃点好吃的吧！"},
        {"jp": "なかなか", "kana": "なかなか", "romaji": "nakanaka", "cn": "（接否定）怎么也……不 / （接肯定）相当不错", "jlpt": "N4", "pairing": "なかなか〜ない", "ex": "人気（にんき）のレストランはなかなか予約（よやく）が取（と）れません。", "exCn": "人气餐厅真是很难订到位子。"},
        {"jp": "やっぱり / やはり", "kana": "やっぱり", "romaji": "yappari", "cn": "果然、还是（经过考虑后的选择）", "jlpt": "N4", "pairing": "やっぱり〜だ", "ex": "いろいろ迷（まよ）ったけど、やっぱりこの寿司屋（すしや）にしよう！", "exCn": "虽然犹豫了好久，果然还是选这家寿司店吧！"},
        {"jp": "ちょうど", "kana": "ちょうど", "romaji": "choudo", "cn": "正好、刚刚好", "jlpt": "N5", "pairing": "ちょうどいい", "ex": "あ、バスがちょうど今（いま）来（き）ましたよ！", "exCn": "啊，巴士正好现在开过来了！"},
        {"jp": "やっと", "kana": "やっと", "romaji": "yatto", "cn": "好不容易终于（带如释重负）", "jlpt": "N4", "pairing": "やっと〜た", "ex": "長（なが）いフライトの後（あと）、やっとホテルに着（つ）きました！", "exCn": "漫长飞行之后，终于到酒店了！"},
        {"jp": "ぜひ", "kana": "ぜひ", "romaji": "zehi", "cn": "务必、无论如何请……", "jlpt": "N4", "pairing": "ぜひ〜たい / てください", "ex": "次回（じかい）もぜひこちらに泊（と）まりたいです。", "exCn": "下次也一定要住在这里。"},
        {"jp": "もし", "kana": "もし", "romaji": "moshi", "cn": "假如、如果", "jlpt": "N4", "pairing": "もし〜たら / ば", "ex": "もし困（こま）ったことがあれば、いつでも声（こえ）をかけてくださいね。", "exCn": "如果有什么困难，请随时叫我们哦。"},
        {"jp": "なるべく / できるだけ", "kana": "なるべく", "romaji": "narubeku", "cn": "尽量、尽可能", "jlpt": "N4", "pairing": "なるべく早め", "ex": "子（こ）どもがいるので、なるべく静（しず）かな席（せき）をお願（ねが）いします。", "exCn": "因为带了孩子，请尽量安排安静一点的座位。"},
        {"jp": "ちゃんと", "kana": "ちゃんと", "romaji": "chanto", "cn": "好好地、妥善地、按规矩", "jlpt": "N3", "pairing": "ちゃんと確認する", "ex": "パスポートをちゃんとかばんに入（い）れた？", "exCn": "护照好好放进包里了吗？"},
        {"jp": "しっかり", "kana": "しっかり", "romaji": "shikkari", "cn": "牢牢地、扎实充分地", "jlpt": "N3", "pairing": "しっかり持つ", "ex": "滑（すべ）らないようにママの手（て）をしっかり握（にぎ）ってね。", "exCn": "为了不滑倒，要牢牢牵紧妈妈的手哦。"},
        {"jp": "だんだん", "kana": "だんだん", "romaji": "dandan", "cn": "渐渐地、逐渐", "jlpt": "N5", "pairing": "だんだん〜なる", "ex": "冬（ふゆ）になって、だんだん寒（さむ）くなってきましたね。", "exCn": "进入冬天，渐渐变冷起来了呢。"},
        {"jp": "どんどん", "kana": "どんどん", "romaji": "dondon", "cn": "接连不断地、迅速推进", "jlpt": "N4", "pairing": "どんどん進む", "ex": "日本語（にほんご）がどんどん上手（じょうず）になっていますね！", "exCn": "您的日语越来越流利了呢！"},
        {"jp": "ますます", "kana": "ますます", "romaji": "masumasu", "cn": "越发、更加", "jlpt": "N3", "pairing": "ますます〜なる", "ex": "福岡（ふくおか）のグルメを食（た）べて、日本（にほん）がますます好（す）きになりました。", "exCn": "吃了福冈美食之后，越发喜欢日本了。"},
        {"jp": "ずいぶん", "kana": "ずいぶん", "romaji": "zuibun", "cn": "相当、很（比预期程度高）", "jlpt": "N4", "pairing": "ずいぶん〜ね", "ex": "東京（とうきょう）からずいぶん遠（とお）くまで来（き）ましたね。", "exCn": "从东京来到好远的地方了呢。"},
        {"jp": "たいてい", "kana": "たいてい", "romaji": "taitei", "cn": "通常、多半、大多数情况下", "jlpt": "N4", "pairing": "たいてい〜", "ex": "日本（にほん）のコンビニはたいてい24時間（じかん）開（あ）いています。", "exCn": "日本的便利店通常24小时营业。"},
        {"jp": "おそらく / たぶん", "kana": "おそらく", "romaji": "osoraku", "cn": "恐怕、大概（较高概率推测）", "jlpt": "N3", "pairing": "おそらく〜だろう", "ex": "おそらくあと10分（ぷん）ほどで到着（とうちゃく）すると思（おも）います。", "exCn": "大概再过10分钟左右就能到了。"},
        {"jp": "まさか", "kana": "まさか", "romaji": "masaka", "cn": "难道、万万没想到居然……", "jlpt": "N3", "pairing": "まさか〜とは / ないだろう", "ex": "まさか東京（とうきょう）の真ん中（まんなか）で雪（ゆき）が見（み）られるとは思（おも）いませんでした！", "exCn": "万万没想到居然能在东京市中心看到雪！"},
        {"jp": "念のため", "kana": "ねんのため", "romaji": "nen no tame", "cn": "为了慎重/保险起见", "jlpt": "N3", "pairing": "念のため確認する", "ex": "念（ねん）のため、予約（よやく）メールの画面（がめん）も準備（じゅんび）しておきます。", "exCn": "保险起见，我也把预约确认邮件页面准备好。"},
        {"jp": "とりあえず", "kana": "とりあえず", "romaji": "toriaezu", "cn": "总之先……（餐厅先点饮品神词！）", "jlpt": "N3", "pairing": "とりあえず生/ビール", "ex": "とりあえず生（なま）ビールを二（ふた）つと、オレンジジュースを二（ふた）つお願（ねが）いします！", "exCn": "总之先来两杯生啤和两杯橙汁！"},
        {"jp": "一応", "kana": "いちおう", "romaji": "ichiou", "cn": "姑且先、以防万一先……", "jlpt": "N3", "pairing": "一応持っていく", "ex": "晴（は）れていますが、一応（いちおう）折（お）りたたみ傘（がさ）を持（も）って行（い）きましょう。", "exCn": "虽然现在是晴天，姑且还是带上折叠伞吧。"},
        {"jp": "ついつい", "kana": "ついつい", "romaji": "tsuitsui", "cn": "不知不觉、忍不住就……", "jlpt": "N3", "pairing": "ついつい〜てしまう", "ex": "デパ地下（ちか）に行（い）くと、おいしそうでついつい買（か）い過（す）ぎてしまいます。", "exCn": "一去百货地下美食街，看着太好吃忍不住就买多了。"},
        {"jp": "わざわざ", "kana": "わざわざ", "romaji": "wazawaza", "cn": "特意、专门（感谢对方好意必用！）", "jlpt": "N3", "pairing": "わざわざ〜ありがとうございます", "ex": "わざわざ駅（えき）まで迎（むか）えに来（き）てくださり、ありがとうございます。", "exCn": "劳您专门到车站来接，太感谢了。"},
        {"jp": "たまたま", "kana": "たまたま", "romaji": "tamatama", "cn": "碰巧、偶然", "jlpt": "N3", "pairing": "たまたま見つける", "ex": "散策（さんさく）していたら、たまたま素敵（すてき）なカフェを見（み）つけました。", "exCn": "散步时碰巧发现了一家超棒的咖啡馆。"},
        {"jp": "せっかくですが", "kana": "せっかくですが", "romaji": "sekkaku desu ga", "cn": "虽然承蒙好意，但……（日本最礼貌婉拒语！）", "jlpt": "N3", "pairing": "せっかくですが、今回は…", "ex": "せっかくですが、子（こ）どもが寝（ね）てしまったのでまた今度（こんど）にします。", "exCn": "虽然很感谢您的美意，但孩子睡着了只能下次再来了。"},
        {"jp": "さっそく", "kana": "さっそく", "romaji": "sassoku", "cn": "立刻、马上着手", "jlpt": "N3", "pairing": "さっそく〜てみる", "ex": "旅館（りょかん）に着（つ）いたら、さっそく温泉（おんせん）に入（はい）りましょう！", "exCn": "一到温泉旅馆，马上就去泡汤吧！"},
        {"jp": "しばらく", "kana": "しばらく", "romaji": "shibaraku", "cn": "一会儿、好一阵子", "jlpt": "N4", "pairing": "しばらく待つ", "ex": "ここでしばらく休（やす）んでから出発（しゅっぱつ）しようか。", "exCn": "在这里歇一会儿再出发吧？"},
        {"jp": "そろそろ", "kana": "そろそろ", "romaji": "sorosoro", "cn": "差不多该……了", "jlpt": "N4", "pairing": "そろそろ〜ましょう", "ex": "4時（じ）になりますよ、そろそろ保育（ほいく）園（えん）のお迎（むか）えに行（い）こう。", "exCn": "快4点了，差不多该去保育园接孩子了。"},
        {"jp": "さっき", "kana": "さっき", "romaji": "sakki", "cn": "刚才（口语最常用）", "jlpt": "N4", "pairing": "さっき〜た", "ex": "さっきの店員（てんいん）さん、すごく親切（しんせつ）だったね！", "exCn": "刚才那位店员真是太热心了！"},
        {"jp": "たった今", "kana": "たったいま", "romaji": "tatta ima", "cn": "就在刚刚那一刻", "jlpt": "N3", "pairing": "たった今〜たばかり", "ex": "ホテルのバスはたった今（いま）到着（とうちゃく）したばかりです。", "exCn": "酒店接驳巴士刚刚才开过来。"},
        {"jp": "もうすぐ", "kana": "もうすぐ", "romaji": "mousugu", "cn": "很快就要、马上", "jlpt": "N5", "pairing": "もうすぐ着く", "ex": "もうすぐ品川（しながわ）に着（つ）くよ、荷物（にもつ）の準備（じゅんび）をしよう。", "exCn": "马上就到品川了，收拾一下行李吧。"},
        {"jp": "ほとんど", "kana": "ほとんど", "romaji": "hotondo", "cn": "几乎、绝大部分（接否定＝几乎不）", "jlpt": "N4", "pairing": "ほとんど〜ない / 全部", "ex": "東京（とうきょう）ではSuicaだけでほとんど買（か）い物（もの）ができます。", "exCn": "在东京光靠西瓜卡几乎什么都能买。"},
        {"jp": "だいぶ", "kana": "だいぶ", "romaji": "daibu", "cn": "相当、很、显著（比以前好多了）", "jlpt": "N4", "pairing": "だいぶ良くなった", "ex": "昨日（きのう）よりだいぶ暖（あたた）かくなりましたね。", "exCn": "比昨天暖和多了呢。"},
        {"jp": "ぜんぜん", "kana": "ぜんぜん", "romaji": "zenzen", "cn": "完全（接否定） / 非常（口语亦可接肯定）", "jlpt": "N5", "pairing": "ぜんぜん〜ない / 大丈夫", "ex": "日本語（にほんご）を間違（まちが）えても、ぜんぜん大丈夫（だいじょうぶ）ですよ！", "exCn": "日语说错一点也完全没关系哦！"},
        {"jp": "まったく", "kana": "まったく", "romaji": "mattaku", "cn": "完全、丝毫（语气比ぜんぜん更强）", "jlpt": "N3", "pairing": "まったく〜ない", "ex": "夜（よる）もまったく音（おと）がしなくて、ぐっすり眠（ねむ）れました。", "exCn": "晚上也完全没有噪音，睡了个好觉。"},
        {"jp": "めったに", "kana": "めったに", "romaji": "mettani", "cn": "很少、难得（后面必接否定！）", "jlpt": "N3", "pairing": "めったに〜ない", "ex": "こんな素敵（すてき）な和食（わしょく）ランチ、めったに食（た）べられませんね！", "exCn": "这么棒的和食午餐平时可难得能吃到呀！"},
        {"jp": "じつは", "kana": "じつは", "romaji": "jitsu wa", "cn": "其实、说实话（引出说明/破冰神词）", "jlpt": "N4", "pairing": "実は〜んです", "ex": "実（じつ）は結婚（けっこん）7周年（ななしゅうねん）のお祝（いわ）いでサンフランシスコから来（き）ました。", "exCn": "其实我们是为了庆祝结婚7周年专程从旧金山来的。"},
        {"jp": "いきなり", "kana": "いきなり", "romaji": "ikinari", "cn": "突然、一下子、不打招呼就……", "jlpt": "N3", "pairing": "いきなり〜する", "ex": "いきなり雪（ゆき）が降（ふ）り始（はじ）めてびっくりしました！", "exCn": "突然一下子下起雪来，吓了一跳！"},
        {"jp": "おもわず", "kana": "おもわず", "romaji": "omowazu", "cn": "不由自主地、禁不住", "jlpt": "N3", "pairing": "思わず笑う / 買う", "ex": "お寿司（すし）があまりに美味（おい）しくて、思（おも）わず笑顔（えがお）になりました。", "exCn": "寿司实在太美味，不由得露出了笑容。"},
        {"jp": "やはり / さすがに", "kana": "さすがに", "romaji": "sasuga ni", "cn": "到底还是、真不愧是……（即便如此也……）", "jlpt": "N3", "pairing": "さすがに疲れた / すごい", "ex": "さすがは銀座（ぎんざ）の名店（めいてん）、すべてのお皿（さら）が芸術（げいじゅつ）みたいですね！", "exCn": "真不愧是银座名店，每一道菜都像艺术品一样！"},
        {"jp": "かえって", "kana": "かえって", "romaji": "kaette", "cn": "反而、倒不如说", "jlpt": "N3", "pairing": "かえって〜なる", "ex": "タクシーより新幹線（しんかんせん）や電車（でんしゃ）のほうが、かえって早（はや）いこともあります。", "exCn": "有时候坐电车比打车反而更快。"}
    ],

    "onomatopoeia": [
        # 美食口感 (12)
        {"cat": "🍜 美食口感", "jp": "アツアツ", "romaji": "atsu-atsu", "cn": "热腾腾的、刚出锅烫嘴的", "ex": "天（てん）ぷらはアツアツのうちにいただきましょう！", "exCn": "天妇罗趁着热乎乎的吃吧！"},
        {"cat": "🍜 美食口感", "jp": "サクサク", "romaji": "saku-saku", "cn": "酥脆爽口的（天妇罗/猪排/可颂）", "ex": "衣（ころも）がサクサクしていて軽（かる）いですね！", "exCn": "面衣炸得酥脆又清爽，一点不腻！"},
        {"cat": "🍜 美食口感", "jp": "もちもち", "romaji": "mochi-mochi", "cn": "Q弹软糯的（乌冬面/年糕/米饭）", "ex": "このうどん、もちもちしてて食（た）べやすいね！", "exCn": "这乌冬面好 Q 弹软糯呀！"},
        {"cat": "🍜 美食口感", "jp": "とろとろ", "romaji": "toro-toro", "cn": "入口即化、浓稠软烂的（金枪鱼腹/芝士/红烧肉）", "ex": "大トロが口（くち）の中（なか）でとろとろにとろけます！", "exCn": "大肥金枪鱼在嘴里入口即化！"},
        {"cat": "🍜 美食口感", "jp": "ふわふわ", "romaji": "fuwa-fuwa", "cn": "松软蓬松的（玉子烧/松饼/雪花）", "ex": "この卵焼（たまごや）き、ふわふわで甘（あま）くておいしい！", "exCn": "这个玉子烧好松软香甜！"},
        {"cat": "🍜 美食口感", "jp": "プリプリ", "romaji": "puri-puri", "cn": "弹牙紧实多汁的（鲜虾/扇贝/牛肠锅）", "ex": "博多（はかた）のもつ鍋（なべ）、もつがプリプリですね！", "exCn": "博多的牛肠锅，牛肠好弹牙鲜美！"},
        {"cat": "🍜 美食口感", "jp": "ジューシー", "romaji": "juushii", "cn": "鲜嫩多汁的（牛排/炸鸡/草莓）", "ex": "鉄板焼（てっぱんや）きのステーキがすごくジューシーです。", "exCn": "铁板烧牛排超级多汁！"},
        {"cat": "🍜 美食口感", "jp": "シャキシャキ", "romaji": "shaki-shaki", "cn": "清脆爽口的（蔬菜/苹果/萝卜丝）", "ex": "サラダのお野菜（やさい）がシャキシャキで新鮮（しんせん）ですね。", "exCn": "沙拉的蔬菜清脆爽口，好新鲜。"},
        {"cat": "🍜 美食口感", "jp": "あっさり", "romaji": "assari", "cn": "清淡鲜爽不油腻的（汤底/和食）", "ex": "昆布（こんぶ）だしがあっさりしていて飲（の）みやすいです。", "exCn": "昆布高汤清淡鲜美很好喝。"},
        {"cat": "🍜 美食口感", "jp": "こってり", "romaji": "kotteri", "cn": "浓郁醇厚的（博多豚骨拉面）", "ex": "博多（はかた）ラーメンはスープがこってりしていて最高（さいこう）！", "exCn": "博多拉面汤底浓郁醇厚绝了！"},
        {"cat": "🍜 美食口感", "jp": "ペコペコ", "romaji": "peko-peko", "cn": "肚子饿得前胸贴后背", "ex": "おなかペコペコ！早（はや）くラーメン食（た）べよう！", "exCn": "肚子饿扁了！快去吃拉面吧！"},
        {"cat": "🍜 美食口感", "jp": "パンパン", "romaji": "pan-pan", "cn": "吃得肚子撑得圆滚滚 / 行李箱塞满 / 腿走酸胀", "ex": "おなかもスーツケースもパンパンです！", "exCn": "肚子和行李箱都塞得满满的！"},

        # 带娃日常 (10)
        {"cat": "👶 带娃日常", "jp": "ニコニコ", "romaji": "niko-niko", "cn": "笑眯眯的", "ex": "娘（むすめ）は保育（ほいく）園（えん）でもずっとニコニコしていました。", "exCn": "女儿在保育园也一直笑眯眯的。"},
        {"cat": "👶 带娃日常", "jp": "ワクワク", "romaji": "waku-waku", "cn": "兴奋雀跃、满怀期待", "ex": "初（はじ）めてのスキーに、Jinnyもワクワクしています。", "exCn": "第一次滑雪，Jinny 也兴奋得不行。"},
        {"cat": "👶 带娃日常", "jp": "ぐっすり", "romaji": "gussuri", "cn": "熟睡、睡得很沉很香", "ex": "たくさん雪遊（ゆきあそ）びして、二人（ふたり）ともぐっすり眠（ねむ）りました。", "exCn": "玩了好多雪，两个孩子都睡得可香了。"},
        {"cat": "👶 带娃日常", "jp": "すやすや", "romaji": "suya-suya", "cn": "小宝宝安安静静香甜熟睡的样子", "ex": "ベビーカーの中（なか）でJaycieがすやすや寝（ね）ています。", "exCn": "Jaycie 在婴儿车里安安静静睡着了。"},
        {"cat": "👶 带娃日常", "jp": "ピカピカ", "romaji": "pika-pika", "cn": "亮晶晶、闪闪发光、干净锃亮", "ex": "東京（とうきょう）のクリスマスイルミネーション、ピカピカできれいだね！", "exCn": "东京的圣诞彩灯亮晶晶的好漂亮呀！"},
        {"cat": "👶 带娃日常", "jp": "ふわふわ（雪）", "romaji": "fuwa-fuwa", "cn": "轻飘飘软绵绵的（粉雪/毛绒玩具）", "ex": "軽井沢（かるいざわ）の雪（ゆき）はふわふわのパウダースノーだね！", "exCn": "轻井泽的雪是软绵绵的粉雪呀！"},
        {"cat": "👶 带娃日常", "jp": "よちよち", "romaji": "yochi-yochi", "cn": "摇摇摆摆学步的样子（小企鹅/幼儿）", "ex": "スキーブーツでよちよち歩（ある）く姿（すがた）がかわいいね。", "exCn": "穿着滑雪靴摇摇摆摆走路的样子好可爱。"},
        {"cat": "👶 带娃日常", "jp": "びしょびしょ", "romaji": "bisho-bisho", "cn": "浑身湿透", "ex": "雪遊（ゆきあそ）びで手袋（てぶくろ）がびしょびしょになっちゃった。", "exCn": "玩雪把手套弄得湿漉漉的了。"},
        {"cat": "👶 带娃日常", "jp": "ぐったり", "romaji": "guttari", "cn": "精疲力竭、累瘫了", "ex": "フライトのあとで大人（おとな）のほうがぐったりですね。", "exCn": "坐完长途飞机大人反而累瘫了呢。"},
        {"cat": "👶 带娃日常", "jp": "うろうろ", "romaji": "uro-uro", "cn": "东张西望转来转去（找不到路时）", "ex": "駅（えき）の出口（でぐち）が分（わ）からなくてうろうろしました。", "exCn": "找不到车站出口在里面转了好几圈。"},

        # 状态感受与天气 (10)
        {"cat": "✨ 状态感受", "jp": "のんびり / ゆっくり", "romaji": "nonbiri / yukkuri", "cn": "悠闲惬意、慢节奏放松", "ex": "由布院（ゆふいん）の旅館（りょかん）でのんびり過（す）ごします。", "exCn": "在由布院的旅馆里悠闲地度过时光。"},
        {"cat": "✨ 状态感受", "jp": "すっきり", "romaji": "sukkiri", "cn": "神清气爽、豁然开朗、整洁利落", "ex": "温泉（おんせん）に入（はい）って体（からだ）がすっきりしました！", "exCn": "泡完温泉浑身神清气爽！"},
        {"cat": "✨ 状态感受", "jp": "ぽかぽか", "romaji": "poka-poka", "cn": "暖洋洋的（太阳/温泉后）", "ex": "温泉（おんせん）から出（で）たあと、体（からだ）がずっとぽかぽかです。", "exCn": "泡完温泉出来，身子一直暖洋洋的。"},
        {"cat": "✨ 状态感受", "jp": "キンキン", "romaji": "kin-kin", "cn": "冰镇得透凉透爽的（啤酒/冰水）", "ex": "キンキンに冷（ひ）えた生（なま）ビールを1杯（ぱい）ください！", "exCn": "请给我来一杯冰镇透凉的生啤！"},
        {"cat": "✨ 状态感受", "jp": "ギリギリ", "romaji": "giri-giri", "cn": "差一点点、刚好卡点赶上", "ex": "新幹線（しんかんせん）にギリギリ間（ま）に合（あ）いました！", "exCn": "刚好卡点赶上新干线了！"},
        {"cat": "✨ 状态感受", "jp": "バッチリ", "romaji": "batchiri", "cn": "完美、万事俱备", "ex": "防寒（ぼうかん）対策（たいさく）も予約（よやく）もバッチリです！", "exCn": "防寒准备和餐厅预约都万无一失！"},
        {"cat": "✨ 状态感受", "jp": "びっくり", "romaji": "bikkuri", "cn": "吓一跳、吃惊惊喜", "ex": "値段（ねだん）の安（やす）さと美味しさにびっくりしました！", "exCn": "被又便宜又好吃惊艳到了！"},
        {"cat": "✨ 状态感受", "jp": "がっかり", "romaji": "gakkari", "cn": "失望、沮丧", "ex": "お目当（めあ）てのお店（みせ）が定休（ていきゅう）日（び）でがっかりしました。", "exCn": "心仪的店正好公休，有点小失望。"},
        {"cat": "✨ 状态感受", "jp": "ワクワク / ドキドキ", "romaji": "doki-doki", "cn": "心跳加速、紧张又期待", "ex": "初めて日本の保育（ほいく）園（えん）に行（い）く朝（あさ）はちょっとドキドキしますね。", "exCn": "第一天送去日本保育园的早上还真有点紧张期待呢。"},
        {"cat": "✨ 状态感受", "jp": "ピカッと / キラキラ", "romaji": "kira-kira", "cn": "闪闪发亮、璀璨夺目", "ex": "夜（よる）の博多駅（はかたえき）のイルミネーションがキラキラ光（ひか）っています。", "exCn": "夜晚博多站的圣诞灯饰闪闪发光。"}
    ],

    "keigoVerbs": [
        {"plain": "行く・来る・いる", "cn": "去 / 来 / 在", "sonkeigo": "いらっしゃる", "kenjougo": "参（まい）る / 伺（うかが）う / おる", "tip": "店员问“几位”：「何名様でいらっしゃいますか」；自己说“明天去”：「明日伺います」。", "ex": "何名様（なんめいさま）でいらっしゃいますか？", "exCn": "【店员】请问一共几位？"},
        {"plain": "食べる・飲む", "cn": "吃 / 喝", "sonkeigo": "召（め）し上（あ）がる", "kenjougo": "いただく", "tip": "「お召し上がりですか」＝在店里吃吗；自己吃之前说「いただきます」。", "ex": "店内（てんない）でお召（め）し上（あ）がりですか？", "exCn": "【店员】您是在店内享用吗？"},
        {"plain": "言う", "cn": "说、讲", "sonkeigo": "おっしゃる", "kenjougo": "申（もう）す / 申（もう）し上（あ）げる", "tip": "自我介绍必用「劉と申します」；请对方指教说「おっしゃってください」。", "ex": "サンフランシスコから参（まい）りました、劉（りゅう）と申（もう）します。", "exCn": "我是从旧金山来的，姓刘。"},
        {"plain": "する", "cn": "做、办理", "sonkeigo": "なさる", "kenjougo": "致（いた）す", "tip": "「どうなさいますか？」＝您要怎么处理/怎么办；「お預かりいたします」＝我替您保管。", "ex": "お支払（しはら）いはどうなさいますか？", "exCn": "【收银】请问您怎么结账？"},
        {"plain": "見る", "cn": "看、阅览", "sonkeigo": "ご覧（らん）になる", "kenjougo": "拝見（はいけん）する", "tip": "让司机/服务员看手机说：「こちらをご覧いただけますか？」", "ex": "すみません、こちらの地図（ちず）をご覧（らん）いただけますか？", "exCn": "不好意思，能请您看一下这张地图吗？"},
        {"plain": "聞く・尋ねる・訪問する", "cn": "听 / 问 / 拜访", "sonkeigo": "お聞（き）きになる", "kenjougo": "伺（うかが）う / 拝聴（はいちょう）する", "tip": "问问题前礼貌开场白：「ちょっとお伺いしたいのですが…」。", "ex": "すみません、一（ひと）つお伺（うかが）いしたいのですが。", "exCn": "不好意思，想向您打听一件事。"},
        {"plain": "知る・知っている", "cn": "知道、认识", "sonkeigo": "ご存（ぞん）じだ", "kenjougo": "存（ぞん）じている / 存（ぞん）じ上（あ）げる", "tip": "问路人或前台知不知道某地：「〜をご存知ですか？」。", "ex": "近（ちか）くにキッズスペースをご存（ぞん）じですか？", "exCn": "请问您知道附近有儿童游乐区吗？"},
        {"plain": "待つ", "cn": "等待", "sonkeigo": "お待（ま）ちになる", "kenjougo": "お待（ま）ちする", "tip": "服务员常见「少々お待ちくださいませ」；对别人说“我等您”：「ロビーでお待ちしております」。", "ex": "少々（しょうしょう）お待（ま）ちくださいませ。", "exCn": "【店员】请您稍等片刻。"},
        {"plain": "食べる人・もらう", "cn": "收到 / 请人做", "sonkeigo": "くださる", "kenjougo": "いただく / 頂戴（ちょうだい）する", "tip": "「〜ていただけますか」＝能请您帮我做……吗（万能黄金礼貌句型）。", "ex": "もう少（すこ）しお湯（ゆ）をいただけますか？", "exCn": "能请您再给我加一点热水吗？"},
        {"plain": "あげる・渡す", "cn": "给、提供", "sonkeigo": "くださる", "kenjougo": "差（さ）し上（あ）げる", "tip": "店员说「お渡しいたします」＝我现在递给您。", "ex": "領収書（りょうしゅうしょ）をお渡（わた）しいたします。", "exCn": "【店员】这是您的收据，请收好。"},
        {"plain": "寝る", "cn": "睡觉", "sonkeigo": "お休（やす）みになる", "kenjougo": "休（やす）ませていただく", "tip": "晚上跟旅馆仲居/家人道晚安「おやすみなさい」。", "ex": "今夜（こんや）はゆっくりお休（やす）みくださいませ。", "exCn": "【旅馆】今晚请您好好休息。"},
        {"plain": "着る・履く", "cn": "穿(衣服/浴衣)", "sonkeigo": "お召（め）しになる", "kenjougo": "着（き）させていただく", "tip": "高级旅馆会说「浴衣をお召しください（请换上浴衣）」。", "ex": "お部屋（へや）の浴衣（ゆかた）をお召（め）しください。", "exCn": "请换上房间里的浴衣。"},
        {"plain": "座る・掛ける", "cn": "坐下", "sonkeigo": "お掛（か）けになる", "kenjougo": "座（すわ）らせていただく", "tip": "听到「こちらへお掛けください」＝“请坐这边”。", "ex": "どうぞこちらへお掛（か）けください。", "exCn": "【店员】请坐这边。"},
        {"plain": "帰る", "cn": "回家、离开", "sonkeigo": "お帰（かえ）りになる", "kenjougo": "失礼（しつれい）する / 戻（もど）る", "tip": "离开餐厅或店铺时，店员会说「お気をつけてお帰りください」。", "ex": "本日（ほんじつ）はありがとうございました。お気（き）をつけてお帰（かえ）りください。", "exCn": "【店员】感谢今天光临，路上小心慢走！"},
        {"plain": "買う", "cn": "购买", "sonkeigo": "お買（か）い上（あ）げになる", "kenjougo": "購入（こうにゅう）する", "tip": "收银台必听：「お買い上げありがとうございます（感谢购买）」。", "ex": "本日（ほんじつ）もお買（か）い上（あ）げありがとうございます！", "exCn": "【收银】非常感谢您今天的惠顾！"},
        {"plain": "預ける / 保管", "cn": "寄存行李", "sonkeigo": "お預（あず）けになる", "kenjougo": "お預（あず）かりする", "tip": "前台收行李时对你说：「お荷物お預かりいたします」。", "ex": "お荷物（にもつ）、チェックインまでお預（あず）かりいたします。", "exCn": "【前台】您的行李在入住前我们为您保管。"},
        {"plain": "確認する", "cn": "确认", "sonkeigo": "ご確認（かくにん）になる", "kenjougo": "確認（かくにん）いたす / 拝見（はいけん）する", "tip": "听店员说「確認いたしますので、少々お待ちください」＝“我帮您确认一下，请稍等”。", "ex": "ただいま確認（かくにん）いたしますので、少々（しょうしょう）お待（ま）ちください。", "exCn": "【店员】我现在为您核实一下，请稍等。"},
        {"plain": "伝える / 案内", "cn": "带路 / 转达", "sonkeigo": "ご案内（あんない）くださる", "kenjougo": "ご案内（あんない）いたす", "tip": "进餐厅必听：「お席へご案内いたします（现在带您去座位）」。", "ex": "お席（せき）へご案内（あんない）いたします、こちらへどうぞ。", "exCn": "【店员】现在带您去座位，这边请。"}
    ],

    "staffDecoder": [
        # 便利店 & 超市收银 (8)
        {"scene": "🏪 便利店", "hearJp": "ポイントカードはお持（も）ちですか？", "hearRomaji": "Pointo kaado wa omochi desu ka?", "keyword": "ポイントカード (会员积分卡)", "cn": "请问您有积分卡吗？", "replyJp": "持（も）っていません / ないです。", "replyCn": "没有（挥挥手微笑即可）。"},
        {"scene": "🏪 便利店", "hearJp": "レジ袋（ぶくろ）はご入用（にゅうよう）ですか？ / ご利用（りよう）ですか？", "hearRomaji": "Rejibukuro wa gonyuuyou / goriyou desu ka?", "keyword": "レジ袋 (塑料袋 · 收费¥3-5)", "cn": "请问需要购买塑料袋吗？", "replyJp": "お願（ねが）いします / 大丈夫（だいじょうぶ）です。", "replyCn": "请给我一个 / 不用了谢谢。"},
        {"scene": "🏪 便利店", "hearJp": "お弁当（べんとう）、お温（あたた）めしますか？", "hearRomaji": "Obentou, oatatame shimasu ka?", "keyword": "温め (微波加热)", "cn": "便当需要帮您加热吗？", "replyJp": "はい、お願（ねが）いします！", "replyCn": "好的，麻烦加热！"},
        {"scene": "🏪 便利店", "hearJp": "お箸（はし）やスプーンは何本（なんぼん）お付（つ）けしますか？", "hearRomaji": "Ohashi ya supuun wa nanbon otsuke shimasu ka?", "keyword": "お箸 / スプーン / 何本 (几双筷子/勺)", "cn": "请问需要几双筷子或勺子？", "replyJp": "2膳（ぜん）お願（ねが）いします / 大丈夫（だいじょうぶ）です。", "replyCn": "请给我两双（或比2根手指说 ふたつ）。"},
        {"scene": "🏪 便利店", "hearJp": "店内（てんない）でお召（め）し上（あ）がりですか？", "hearRomaji": "Tennai de omeshiagari desu ka?", "keyword": "店内 / お召し上がり (堂食税10% vs 打包8%)", "cn": "请问是在店内食用吗？（涉及消费税差异）", "replyJp": "持（も）ち帰（かえ）りでお願（ねが）いします。", "replyCn": "麻烦打包带走。"},
        {"scene": "🏪 便利店", "hearJp": "お支払（しはら）い方法（ほうほう）はどうなさいますか？", "hearRomaji": "Oshiharai houhou wa dou nasaimasu ka?", "keyword": "お支払い方法 (支付方式)", "cn": "请问您用哪种方式结账？", "replyJp": "クレジットカードで / Suica（スイカ）で。", "replyCn": "刷信用卡 / 用西瓜卡。"},
        {"scene": "🏪 便利店", "hearJp": "レシートはご不要（ふよう）ですか？ / お返（かえ）しします。", "hearRomaji": "Reshiito wa gofuyou desu ka?", "keyword": "レシート (购物小票)", "cn": "您需要小票吗？", "replyJp": "お願（ねが）いします / 大丈夫（だいじょうぶ）です。", "replyCn": "我要小票 / 不用啦。"},
        {"scene": "🏪 超市", "hearJp": "保冷剤（ほれいざい）はお入（い）れしますか？", "hearRomaji": "Horeizai wa oire shimasu ka?", "keyword": "保冷剤 (冰袋 · 买蛋糕布丁常问)", "cn": "甜品需要帮您放冰袋吗？", "replyJp": "はい、1時間（じかん）分（ぶん）お願（ねが）いします。", "replyCn": "好的，请给我保冷1小时的。"},

        # 餐厅 & 居酒屋 & Omakase (8)
        {"scene": "🍣 餐厅", "hearJp": "何名様（なんめいさま）でいらっしゃいますか？", "hearRomaji": "Nanmei-sama de irasshaimasu ka?", "keyword": "何名様 (一共几位)", "cn": "请问一共几位呢？", "replyJp": "大人（おとな）2名（めい）と子（こ）ども2名（めい）です。", "replyCn": "2位大人和2位小朋友。"},
        {"scene": "🍣 餐厅", "hearJp": "ご予約（よやく）はされておりますか？", "hearRomaji": "Goyoyaku wa sarete orimasu ka?", "keyword": "ご予約 (有没有预约)", "cn": "请问您有预约吗？", "replyJp": "はい、劉（りゅう）で予約（よやく）しています。", "replyCn": "是的，我用刘（LIU）的名字预约了。"},
        {"scene": "🍣 餐厅", "hearJp": "苦手（にがて）な食材（しょくざい）やアレルギーはございますか？", "hearRomaji": "Nigate na shokuzai ya arerugii wa gozaimasu ka?", "keyword": "苦手 / アレルギー (忌口/过敏)", "cn": "请问有什么忌口或过敏的食材吗？", "replyJp": "アレルギーはありませんが、妻（つま）が生肉（なまにく）が苦手（にがて）です。", "replyCn": "没有过敏，但太太不太能吃生肉。"},
        {"scene": "🍣 餐厅", "hearJp": "お飲（の）み物（もの）から先（さき）にお伺（うかが）いします。", "hearRomaji": "Onomimono kara saki ni oukagai shimasu.", "keyword": "お飲み物 (先点饮料 · 日本正餐习惯)", "cn": "先为您点饮品哦。", "replyJp": "烏龍茶（うーろんちゃ）を2つお願（ねが）いします。", "replyCn": "请给我们两杯乌龙茶。"},
        {"scene": "🍣 餐厅", "hearJp": "お料理（りょうり）の提供（ていきょう）まで20分（ぷん）ほどかかりますがよろしいですか？", "hearRomaji": "Oryouri no teikyou made nijuppun hodo kakarimasu ga yoroshii desu ka?", "keyword": "〜分ほどかかります (大约需等几分钟)", "cn": "菜品现做大约需要20分钟，可以吗？", "replyJp": "はい、大丈夫（だいじょうぶ）です。", "replyCn": "好的，没问题。"},
        {"scene": "🍜 拉面", "hearJp": "麺（めん）の硬（かた）さはどうなさいますか？", "hearRomaji": "Men no katasa wa dou nasaimasu ka?", "keyword": "麺の硬さ (博多拉面必问！面条软硬度)", "cn": "面条的软硬度请问要哪种？", "replyJp": "カタ（硬め）でお願（ねが）いします！子（こ）どもはヤワ（柔らかめ）で。", "replyCn": "我要偏硬(Kata)！孩子那碗要煮软(Yawa)。"},
        {"scene": "🍣 餐厅", "hearJp": "お会計（かいけい）はテーブルでお願（ねが）いします / レジへどうぞ。", "hearRomaji": "Okaikei wa teeburu de / reji e douzo.", "keyword": "テーブル / レジ (桌边买单 vs 收银台)", "cn": "请您在桌边结账 / 请去门口收银台结账。", "replyJp": "わかりました、ごちそうさまでした！", "replyCn": "明白，非常感谢款待！"},
        {"scene": "🍣 餐厅", "hearJp": "ただいま満席（まんせき）で、30分（ぷん）ほどお待（ま）ちいただきます。", "hearRomaji": "Tadaima manseki de, sanjuppun hodo omachi itadakimasu.", "keyword": "満席 / お待ち (满座需排队)", "cn": "目前客满，大概要让您等30分钟左右。", "replyJp": "わかりました、待（ま）ちます / また今度（こんど）にします。", "replyCn": "好的我等一下 / 那下次再来吧。"},

        # 酒店、机场、购物免税 (8)
        {"scene": "🏨 酒店", "hearJp": "ご宿泊（しゅくはく）の代表者様（だいひょうしゃさま）のお名前（なまえ）を頂戴（ちょうだい）できますか？", "hearRomaji": "Goshukuhaku no daihyousha-sama no onamae wo choudai dekimasu ka?", "keyword": "代表者のお名前 (预订人姓名)", "cn": "请告诉我入住预订代表人的姓名好吗？", "replyJp": "LIU HAODONG です。パスポートをお見（み）せします。", "replyCn": "是 LIU HAODONG，给您看护照。"},
        {"scene": "🏨 酒店", "hearJp": "全員分（ぜんいんぶん）のパスポートをお預（あず）かりできますか？", "hearRomaji": "Zen'in-bun no pasupooto wo oazukari dekimasu ka?", "keyword": "全員分のパスポート (全家所有人的护照)", "cn": "能借用一下所有入住人的护照复印吗？", "replyJp": "はい、4人分（よにんぶん）こちらです。", "replyCn": "好的，4个人的都在这里。"},
        {"scene": "🏨 酒店", "hearJp": "チェックアウトは正午（しょうご）12時（じ）でございます。", "hearRomaji": "Chekkuauto wa shougo juuniji de gozaimasu.", "keyword": "正午12時 (中午12点退房)", "cn": "退房时间是中午12点。", "replyJp": "承知（しょうち）しました、ありがとうございます。", "replyCn": "了解了，谢谢您。"},
        {"scene": "🛍️ 购物", "hearJp": "免税（めんぜい）のお手続（てつづ）きをご希望（きぼう）ですか？", "hearRomaji": "Menzei no otetsuzuki wo gokibou desu ka?", "keyword": "免税手続き (办理退税/免税)", "cn": "请问需要办理免税手续吗？", "replyJp": "はい、パスポートはこちらです。", "replyCn": "是的，这是护照。"},
        {"scene": "🛍️ 购物", "hearJp": "消耗品（しょうもうひん）は日本国内（にほんこくない）では開封（かいふう）できません。", "hearRomaji": "Shoumouhin wa Nihon kokunai dewa kaifuu dekimasen.", "keyword": "消耗品 / 開封できません (免税密封袋在离境前别拆！)", "cn": "药妆零食等消耗品在日本境内不能拆封哦。", "replyJp": "はい、わかりました！", "replyCn": "好的，明白了！"},
        {"scene": "🛍️ 购物", "hearJp": "クレジットカードの暗証番号（あんしょうばんごう）をお願（ねが）いします。", "hearRomaji": "Kurejitto kaado no anshou bangou wo onegai shimasu.", "keyword": "暗証番号 (银行卡PIN密码)", "cn": "请输入您的信用卡密码。", "replyJp": "タッチ決済（けっさい）は使えますか？", "replyCn": "请问能用非接触拍卡支付吗？"},
        {"scene": "🚆 交通", "hearJp": "この電車（でんしゃ）は各駅停車（かくえきていしゃ）です。", "hearRomaji": "Kono densha wa kakueki teisha desu.", "keyword": "各駅停車 vs 快速/特急 (每站都停慢车 vs 快车)", "cn": "这趟是每站都停的普通列车。", "replyJp": "品川（しながわ）に止（と）まりますか？", "replyCn": "请问停品川站吗？"},
        {"scene": "🚕 出租", "hearJp": "トランクにお荷物（にもつ）をお積（つ）みしましょうか？", "hearRomaji": "Toranku ni onimotsu wo otsumi shimashou ka?", "keyword": "トランク (后备箱)", "cn": "要帮您把行李放进后备箱吗？", "replyJp": "はい、お願（ねが）いします！ベビーカーも折（お）りたたみます。", "replyCn": "好的麻烦您！婴儿车我也折叠一下。"}
    ],

    "kanjiTraps": [
        # 12 同形异义汉字陷阱
        {"type": "汉字陷阱", "jp": "大丈夫（だいじょうぶ）", "kana": "だいじょうぶ", "romaji": "daijoubu", "wrongGuess": "男子汉大丈夫", "realCn": "没关系、不要紧、安全可靠", "ex": "辛（から）くなくても大丈夫（だいじょうぶ）ですよ。", "exCn": "不辣也没关系哦。"},
        {"type": "汉字陷阱", "jp": "手紙（てがみ）", "kana": "てがみ", "romaji": "tegami", "wrongGuess": "卫生纸（厕纸是トイレットペーパー）", "realCn": "书信、信件", "ex": "ホテルから家族（かぞく）に手紙（てがみ）を出（だ）しました。", "exCn": "从酒店给家里寄了封信。"},
        {"type": "汉字陷阱", "jp": "娘（むすめ）", "kana": "むすめ", "romaji": "musume", "wrongGuess": "母亲、老娘", "realCn": "女儿！（「お嬢さん」＝令爱/姑娘）", "ex": "6歳（さい）と2歳（さい）の娘（むすめ）がいます。", "exCn": "我有两个女儿，6岁和2岁。"},
        {"type": "汉字陷阱", "jp": "愛人（あいじん）", "kana": "あいじん", "romaji": "aijin", "wrongGuess": "合法配偶", "realCn": "婚外情人！（配偶请用「妻 / 主人 / 夫」）", "ex": "こちらは妻（つま）のSherryです。", "exCn": "这位是我太太 Sherry（千万别用愛人！）。"},
        {"type": "汉字陷阱", "jp": "勉強（べんきょう）", "kana": "べんきょう", "romaji": "benkyou", "wrongGuess": "勉强、强迫", "realCn": "学习、用功（关西商贩也指“优惠打折”）", "ex": "毎日（まいにち）日本語（にほんご）を勉強（べんきょう）しています。", "exCn": "每天都在学日语。"},
        {"type": "汉字陷阱", "jp": "切手（きって）", "kana": "きって", "romaji": "kitte", "wrongGuess": "切手（受伤）", "realCn": "邮票！（车票是「切符 きっぷ」）", "ex": "ポストにハガキを入（い）れる前（まえ）に切手（きって）を貼（は）ります。", "exCn": "投进邮筒前先贴邮票。"},
        {"type": "汉字陷阱", "jp": "怪我（けが）", "kana": "けが", "romaji": "kega", "wrongGuess": "责怪我", "realCn": "受伤、外伤", "ex": "転（ころ）んでも怪我（けが）がなくてよかった！", "exCn": "摔倒了但没受伤真是太好了！"},
        {"type": "汉字陷阱", "jp": "人参（にんじん）", "kana": "にんじん", "romaji": "ninjin", "wrongGuess": "名贵药材人参", "realCn": "胡萝卜！（高丽参是「高麗人参」）", "ex": "娘（むすめ）はカレーの人参（にんじん）が好（す）きです。", "exCn": "女儿很喜欢咖喱里的胡萝卜。"},
        {"type": "汉字陷阱", "jp": "湯（ゆ）", "kana": "ゆ", "romaji": "yu", "wrongGuess": "喝的汤（スープ / 汁）", "realCn": "热水、温泉澡池！（「お湯」＝白开水/洗澡水）", "ex": "温泉（おんせん）のお湯（ゆ）がとても気持（きも）ちいいですね。", "exCn": "温泉的泡汤水真舒服啊。"},
        {"type": "汉字陷阱", "jp": "結構（けっこう）です", "kana": "けっこうです", "romaji": "kekkou desu", "wrongGuess": "结构很好", "realCn": "足够了 / 不用了（委婉拒绝：袋子不用了！）", "ex": "お箸（はし）は結構（けっこう）です、ありがとうございます。", "exCn": "筷子不用了，谢谢您。"},
        {"type": "汉字陷阱", "jp": "無理（むり）", "kana": "むり", "romaji": "muri", "wrongGuess": "无理取闹", "realCn": "做不到、勉强、太拼（别太累了＝無理しないで）", "ex": "子（こ）ども連（づ）れなので、無理（むり）のないスケジュールにします。", "exCn": "因为带孩子，行程安排得轻松不勉强。"},
        {"type": "汉字陷阱", "jp": "留守（るす）", "kana": "るす", "romaji": "rusu", "wrongGuess": "留守在里面", "realCn": "不在家、没人在！（「留守番電話」＝语音信箱）", "ex": "今（いま）は留守（るす）にしているので、後（あと）で届（とど）けます。", "exCn": "现在人不在，晚点再送来。"},

        # 12 日本旅行高频片假名外来词 (Katakana Survival)
        {"type": "高频片假名", "jp": "ベビーカー", "kana": "ベビーカー", "romaji": "bebiikaa", "wrongGuess": "Baby Car (美式叫 Stroller)", "realCn": "婴儿推车（日本全境通用！）", "ex": "ベビーカーのままエレベーターに乗（の）れますか？", "exCn": "婴儿车可以直接推进电梯吗？"},
        {"type": "高频片假名", "jp": "テイクアウト", "kana": "テイクアウト", "romaji": "teikuauto", "wrongGuess": "Take out (注意日语念法)", "realCn": "打包外带（对应「お持ち帰り」）", "ex": "コーヒーをテイクアウトでお願（ねが）いします。", "exCn": "咖啡麻烦打包带走。"},
        {"type": "高频片假名", "jp": "タッチ決済（けっさい）", "kana": "タッチけっさい", "romaji": "tatchi kessai", "wrongGuess": "Touch Pay", "realCn": "非接触感应刷卡 / Apple Pay 拍卡", "ex": "Visaのタッチ決済（けっさい）は使（つか）えますか？", "exCn": "请问支持 Visa 感应拍卡支付吗？"},
        {"type": "高频片假名", "jp": "コインロッカー", "kana": "コインロッカー", "romaji": "koin rokkaa", "wrongGuess": "Coin Locker", "realCn": "车站投币式行李寄存柜（也多支持Suica）", "ex": "スーツケースが入（はい）る大（おお）きいコインロッカーはどこですか？", "exCn": "请问能放进大行李箱的寄存柜在哪里？"},
        {"type": "高频片假名", "jp": "フロント", "kana": "フロント", "romaji": "furonto", "wrongGuess": "Front", "realCn": "酒店前台（Check-in/寄存处）", "ex": "フロントに荷物（にもつ）を預（あず）けてきました。", "exCn": "我把行李寄存在前台了。"},
        {"type": "高频片假名", "jp": "アメニティ", "kana": "アメニティ", "romaji": "ameniti", "wrongGuess": "Amenity", "realCn": "酒店洗漱用品（牙刷/拖鞋/浴帽/护肤包）", "ex": "1階（かい）のロビーにアメニティバーがありますよ。", "exCn": "一楼大堂有洗漱用品自取台哦。"},
        {"type": "高频片假名", "jp": "コンセント", "kana": "コンセント", "romaji": "konsento", "wrongGuess": "Consent(同意)", "realCn": "电源插座！（日式和制英语）", "ex": "ベッドの横（よこ）にコンセントがありますか？", "exCn": "床头旁边有充电插座吗？"},
        {"type": "高频片假名", "jp": "フリーWi-Fi", "kana": "フリーワイファイ", "romaji": "furii waifai", "wrongGuess": "Free Wi-Fi", "realCn": "免费无线网络", "ex": "ホテルのフリーWi-Fiのパスワードを教（おし）えてください。", "exCn": "请告诉我酒店免费 Wi-Fi 的密码。"},
        {"type": "高频片假名", "jp": "アレルギー", "kana": "アレルギー", "romaji": "arerugii", "wrongGuess": "Allergy", "realCn": "食物或药物过敏", "ex": "子（こ）どもに卵（たまご）のアレルギーはありません。", "exCn": "孩子对鸡蛋没有过敏。"},
        {"type": "高频片假名", "jp": "キャッシュレス", "kana": "キャッシュレス", "romaji": "kyasshuresu", "wrongGuess": "Cashless", "realCn": "无现金支付（刷卡/交通卡/二维码）", "ex": "キャッシュレス決済（けっさい）のみのお店（みせ）も増（ふ）えています。", "exCn": "只支持无现金支付的店也越来越多了。"},
        {"type": "高频片假名", "jp": "ミディアムレア", "kana": "ミディアムレア", "romaji": "midiamu rea", "wrongGuess": "Medium Rare", "realCn": "牛排五分熟（五明铁板烧推荐熟度！）", "ex": "ステーキの焼（や）き加減（かげん）はミディアムレアでお願（ねが）いします。", "exCn": "牛排熟度请做五分熟。"},
        {"type": "高频片假名", "jp": "チェックアウト", "kana": "チェックアウト", "romaji": "chekkuauto", "wrongGuess": "Check out", "realCn": "退房（「チェックイン」＝办理入住）", "ex": "チェックアウトの後（あと）も荷物（にもつ）を預（あず）かってもらえますか？", "exCn": "退房后还能帮我们寄存行李吗？"}
    ],

    "streetSigns": [
        # 餐厅排队/点餐/店规 (8)
        {"cat": "🍣 餐厅看板", "jp": "満席（まんせき）", "kana": "まんせき", "romaji": "manseki", "cn": "已客满", "tip": "门口挂「満席」代表暂时没空位，旁边常写需等待时间或排队纸。"},
        {"cat": "🍣 餐厅看板", "jp": "準備中（じゅんびちゅう）", "kana": "じゅんびちゅう", "romaji": "junbichuu", "cn": "备餐休息中（未营业）", "tip": "日本餐厅下午常有 14:00–17:00 午休，挂「準備中」或「仕込み中」。"},
        {"cat": "🍣 餐厅看板", "jp": "本日休業（ほんじつきゅうぎょう） / 定休日（ていきゅうび）", "kana": "ほんじつきゅうぎょう", "romaji": "honjitsu kyuugyou", "cn": "今日休息 / 固定公休日", "tip": "遇到这个牌子说明今天不开门，可以改去备选店。"},
        {"cat": "🍣 餐厅看板", "jp": "禁煙（きんえん） / 完全禁煙", "kana": "きんえん", "romaji": "kin'en", "cn": "全席禁烟（带娃放心进！）", "tip": "相反如果看到「喫煙可（きつえんか）」表示可抽烟，带娃建议避开。"},
        {"cat": "🍣 餐厅看板", "jp": "お通し（おとおし）あり", "kana": "おとおし", "romaji": "otooshi", "cn": "居酒屋开胃小菜（相当于座位费¥300-500/人）", "tip": "居酒屋常见小盘开胃菜，不是送错菜而是按人头收的入座费。"},
        {"cat": "🍣 餐厅看板", "jp": "ワンドリンク制（せい）", "kana": "わんどりんくせい", "romaji": "wan dorinku sei", "cn": "每位客人需点至少1杯饮料", "tip": "银座山科等高档餐厅午餐也要求每人点一杯饮品（可点乌龙茶/果汁）。"},
        {"cat": "🍣 餐厅看板", "jp": "現金のみ（げんきんのみ）", "kana": "げんきんのみ", "romaji": "genkin nomi", "cn": "仅限现金（不收卡！）", "tip": "许多老字号拉面店、小食摊、神社买御守都会写「現金のみ」。"},
        {"cat": "🍣 餐厅看板", "jp": "食券機（しょっけんき）", "kana": "しょっけんき", "romaji": "shokkenki", "cn": "门口自助点餐买票机", "tip": "先投钱或扫码选菜打印小票，再把纸票交给店员。"},

        # 交通 & 车站 (8)
        {"cat": "🚆 交通车站", "jp": "出口（でぐち） / 乗換（のりかえ）", "kana": "でぐち / のりかえ", "romaji": "deguchi / norikae", "cn": "出口 / 换乘通道", "tip": "黄色牌子通常是出口「出口」，换乘看各线路颜色标志。"},
        {"cat": "🚆 交通车站", "jp": "精算機（せいさんき）", "kana": "せいさんき", "romaji": "seisanki", "cn": "补票机 / 西瓜卡充值机", "tip": "卡里余额不足刷不出闸机时，找「のりこし精算機」补差额即可出站。"},
        {"cat": "🚆 交通车站", "jp": "改札（かいさつ）", "kana": "かいさつ", "romaji": "kaisatsu", "cn": "检票闸机口", "tip": "找大件行李或婴儿车可以走有工作人员的值守宽通道「有人改札」。"},
        {"cat": "🚆 交通车站", "jp": "優先席（ゆうせんせき）", "kana": "ゆうせんせき", "romaji": "yuusenseki", "cn": "老弱病残孕及幼童优先专座", "tip": "带两娃推婴儿车优先去车厢两端的「優先席 / フリースペース」区域。"},
        {"cat": "🚆 交通车站", "jp": "女性専用車（じょせいせんようしゃ）", "kana": "じょせいせんようしゃ", "romaji": "josei senyousha", "cn": "女性专用车厢（工作日早高峰限定）", "tip": "注意爸爸不能在工作日早高峰进粉色标的女性专用车厢哦（小学生以下男童通常可跟妈妈）。"},
        {"cat": "🚆 交通车站", "jp": "自由席（じゆうせき） / 指定席（していせき）", "kana": "じゆうせき / していせき", "romaji": "jiyuuseki / shiteiseki", "cn": "自由座 / 对号入座指定席", "tip": "带娃强烈建议提前买「指定席」保证一家四口坐一起且有行李架！"},
        {"cat": "🚆 交通车站", "jp": "特大荷物スペースつき座席", "kana": "とくだいにもつすぺーす", "romaji": "tokudai nimotsu supeesu", "cn": "超大件行李专用席", "tip": "东海道新干线三边和超160cm箱子需订此席；北陆新干线一般行李架够大无需额外费用。"},
        {"cat": "🚆 交通车站", "jp": "到着（とうちゃく） / 出発（しゅっぱつ）", "kana": "とうちゃく / しゅっぱつ", "romaji": "touchaku / shuppatsu", "cn": "到达 / 出发", "tip": "机场和大站指示牌必看关键词。"},

        # 旅馆、温泉 & 购物禁令 (8)
        {"cat": "♨️ 旅馆商店", "jp": "土足厳禁（どそくげんきん）", "kana": "どそくげんきん", "romaji": "dosoku genkin", "cn": "严禁穿鞋入内（请在玄关脱鞋！）", "tip": "温泉旅馆、和室包厢、部分保育园或诊所门口最常贴！"},
        {"cat": "♨️ 旅馆商店", "jp": "貸切風呂（かしきりぶろ） / 家族風呂", "kana": "かしきりぶろ", "romaji": "kashikiriburo", "cn": "私人包场家庭温泉", "tip": "一家四口可以一起泡不被外人打扰的包场汤池。"},
        {"cat": "♨️ 旅馆商店", "jp": "女湯（おんなゆ） / 男湯（おとこゆ）", "kana": "おんなゆ / おとこゆ", "romaji": "onnayu / otokoyu", "cn": "女汤（红色暖帘） / 男汤（蓝色暖帘）", "tip": "注意温泉早晚可能会互换男女汤池，进去前看清当天暖帘颜色和「女/男」字！"},
        {"cat": "♨️ 旅馆商店", "jp": "授乳室（じゅにゅうしつ） / おむつ交換台", "kana": "じゅにゅうしつ / おむつこうかんだい", "romaji": "junyuushitsu / omutsu koukandai", "cn": "母婴哺乳室 / 换尿布台", "tip": "日本百货公司和车站母婴室极好，有70°C热水冲奶机！"},
        {"cat": "🛍️ 购物禁令", "jp": "撮影禁止（さつえいきんし）", "kana": "さつえいきんし", "romaji": "satsuei kinshi", "cn": "禁止拍照", "tip": "美术馆、部分板前料理台或药妆店内部常见提示。"},
        {"cat": "🛍️ 购物禁令", "jp": "立入禁止（たちいりきんし）", "kana": "たちいりきんし", "romaji": "tachiiri kinshi", "cn": "禁止入内（非请勿入）", "tip": "寺庙内院、私人庭园、雪场危险边界常见红牌。"},
        {"cat": "🛍️ 购物禁令", "jp": "税込（ぜいこみ） / 税抜（ぜいぬき）", "kana": "ぜいこみ / ぜいぬき", "romaji": "zeikomi / zeinuki", "cn": "含税价 / 不含税价", "tip": "「税込」是实际付款价格，「税抜」结账时会加8%或10%消费税。"},
        {"cat": "🛍️ 购物禁令", "jp": "両替（りょうがえ）", "kana": "りょうがえ", "romaji": "ryougae", "cn": "货币兑换 / 换零钱机", "tip": "扭蛋机区或投币洗衣房旁常有把1000日元纸币换成100日元硬币的「両替機」。"}
    ],

    "viVtQuizzes": [
        # 18 Vi/Vt Transitivity Drills
        {"kind": "vivt", "promptJp": "あ、自動（じどう）ドアがゆっくり＿＿。", "cn": "啊，自动门慢慢开了（自动词）。", "answer": "開きました", "options": ["開きました", "開けました", "開けます", "開けている"], "ruleTip": "门自己打开（无明确人动作主语），用自动词「ドアが開（あ）く」！"},
        {"kind": "vivt", "promptJp": "ちょっと暑（あつ）いので、窓（まど）を＿＿。", "cn": "有点热，我把窗户打开吧（他动词）。", "answer": "開けましょう", "options": ["開けましょう", "開きましょう", "開きます", "開けています"], "ruleTip": "人主动去把某物打开（带「を」），用他动词「窓を開（あ）ける」！"},
        {"kind": "vivt", "promptJp": "部屋（へや）が暗（くら）いので、電気（でんき）を＿＿ください。", "cn": "房间好暗，请把灯打开。", "answer": "つけて", "options": ["つけて", "ついて", "つって", "つき"], "ruleTip": "人去开灯用他动词「電気をつける」；灯自己亮着是「電気がついている」。"},
        {"kind": "vivt", "promptJp": "廊下（ろうか）の電気（でんき）がまだ＿＿いますよ。", "cn": "走廊的灯还亮着哦。", "answer": "ついて", "options": ["ついて", "つけて", "つけ", "けして"], "ruleTip": "描述灯“亮着”的客观状态用自动词＋ている：「電気がついている」！"},
        {"kind": "vivt", "promptJp": "あっ、スマホの画面（がめん）が突然（とつぜん）＿＿しまいました！", "cn": "啊，手机屏幕突然黑掉熄灭了！", "answer": "消えて", "options": ["消えて", "消して", "消さえて", "消せ"], "ruleTip": "屏幕自己熄灭，没有人去关它，用自动词「画面が消（き）える」！"},
        {"kind": "vivt", "promptJp": "寝（ね）る前（まえ）にエアコンを＿＿くださいね。", "cn": "睡觉前请把空调关掉哦。", "answer": "消して", "options": ["消して", "消えて", "消いて", "消って"], "ruleTip": "人主动关掉电器（带「を」），用他动词「エアコンを消す」！"},
        {"kind": "vivt", "promptJp": "雪（ゆき）のせいで、新幹線（しんかんせん）が一時（いちじ）＿＿います。", "cn": "因为下雪，新干线暂时停运着。", "answer": "止まって", "options": ["止まって", "止めて", "止められて", "止んで"], "ruleTip": "电车/车自己停下来或停运状态，用自动词「電車が止まる」！"},
        {"kind": "vivt", "promptJp": "運転手（うんてんしゅ）さん、あそこの角（かど）で車（くるま）を＿＿ください。", "cn": "司机师傅，请在那边的拐角把车停一下。", "answer": "止めて", "options": ["止めて", "止まって", "止まってい", "止んで"], "ruleTip": "让司机把车停下来（带「を」），用他动词「車を止める」！"},
        {"kind": "vivt", "promptJp": "なくしたと思（おも）っていたSuicaがカバンから＿＿！", "cn": "以为弄丢的西瓜卡在包里找到了！", "answer": "見つかりました", "options": ["見つかりました", "見つけました", "見えました", "見ました"], "ruleTip": "以丢失的物品为主语（〜が），用自动词「Suicaが見つかる（被发现/找到了）」！"},
        {"kind": "vivt", "promptJp": "昨日（きのう）の夜（よる）、すてきなお店（みせ）を＿＿よ。", "cn": "昨晚我们发现了一家超棒的店哦。", "answer": "見つけました", "options": ["見つけました", "見つかりました", "見えられました", "見ました"], "ruleTip": "“我找到了某个店”（带「を」），用他动词「お店を見つける」！"},
        {"kind": "vivt", "promptJp": "よく休（やす）んだので、風邪（かぜ）がすっかり＿＿。", "cn": "因为好好休息了，感冒完全痊愈了。", "answer": "治りました", "options": ["治りました", "治しました", "直しました", "治れました"], "ruleTip": "病/感冒自己痊愈了用自动词「病気が治（なお）る」；医生治好病人是「治す」。"},
        {"kind": "vivt", "promptJp": "バッグから手袋（てぶくろ）が床（ゆか）に＿＿いますよ！", "cn": "手套从包里掉在地上哦！", "answer": "落ちて", "options": ["落ちて", "落として", "落て", "落とし"], "ruleTip": "东西自己掉下来（〜が）用自动词「落ちる」；人不小心弄掉（〜を）是「落とす」。"},
        {"kind": "vivt", "promptJp": "お湯（ゆ）が＿＿から、お茶（ちゃ）をいれましょうか。", "cn": "水烧开了，咱们泡茶吧。", "answer": "沸いた", "options": ["沸いた", "沸かした", "沸く", "沸かせて"], "ruleTip": "水烧开（〜が）用自动词「お湯が沸く」；人去烧水（〜を）是他动词「お湯を沸かす」。"},
        {"kind": "vivt", "promptJp": "お皿（さら）がテーブルから落（お）ちて＿＿しまいました。", "cn": "盘子从桌上掉下去摔碎了。", "answer": "割れて", "options": ["割れて", "割って", "破って", "折って"], "ruleTip": "玻璃/盘子自己碎掉用自动词「お皿が割（わ）れる」；打破/敲鸡蛋用他动词「割る」。"},
        {"kind": "vivt", "promptJp": "子（こ）ども用（よう）のうどんは、わさびを＿＿いただけますか？", "cn": "孩子的乌冬面能帮我去掉芥末（不要芥末）吗？", "answer": "抜いて", "options": ["抜いて", "抜けて", "取れて", "外れて"], "ruleTip": "让厨师把食材去掉/拔掉（带「を」）用他动词「わさびを抜（ぬ）く」！"},
        {"kind": "vivt", "promptJp": "空港（くうこう）から送（おく）ったスーツケースが無事（ぶじ）に＿＿！", "cn": "从机场寄出的行李箱平安送到了！", "answer": "届きました", "options": ["届きました", "届けました", "届けられました", "着けました"], "ruleTip": "包裹/邮件自己寄到了（主语是行李が）用自动词「届く」；送货上门是他动词「届ける」。"},
        {"kind": "vivt", "promptJp": "すみません、後ろ（うしろ）の座席（ざせき）を少（すこ）し＿＿もいいですか？", "cn": "不好意思，我可以把座椅靠背稍微放倒一点吗？", "answer": "倒して", "options": ["倒して", "倒れて", "降りて", "下げれて"], "ruleTip": "人把座椅往后放倒（带「を」）用他动词「座席を倒（たお）す」！"},
        {"kind": "vivt", "promptJp": "テーブルにお箸（はし）ときれいなお皿（さら）が並（なら）べて＿＿。", "cn": "桌子上已经整齐摆好了筷子和漂亮的盘子。", "answer": "あります", "options": ["あります", "います", "おきます", "しまいます"], "ruleTip": "他动词て形＋ある（並べてある）表示“别人提前做好、现在摆在那里供使用”的状态！"},

        # 18 Essential N4-N3 Particle & Verb Collocation Drills
        {"kind": "particle", "promptJp": "次（つぎ）の駅（えき）＿＿新幹線（しんかんせん）を降（お）りますよ。", "cn": "在下一站下新干线哦（离开交通工具用「を」）。", "answer": "で", "options": ["で", "を", "へ", "から"], "ruleTip": "下车的“地点”用「駅で」；所下的“交通工具”本身用「新干線を降りる」！"},
        {"kind": "particle", "promptJp": "品川駅（しながわえき）からホテル行（ゆ）きのバス＿＿乗（の）ります。", "cn": "从品川站乘坐开往酒店的巴士。", "answer": "に", "options": ["に", "を", "で", "が"], "ruleTip": "乘坐交通工具固定用助词「に」：「バスに乗る / 電車に乗る」（× バスを乗る）！"},
        {"kind": "particle", "promptJp": "すみません、品川駅（しながわえき）＿＿電車（でんしゃ）を降（お）りたいのですが。", "cn": "不好意思，我要在品川站下车。", "answer": "で", "options": ["で", "に", "を", "へ"], "ruleTip": "注意区分：上车用「〜に乗る」，下车离开车厢本身用「電車を降りる」，车站地点用「〜で降りる」！"},
        {"kind": "particle", "promptJp": "雪道（ゆきみち）で滑（すべ）らないように気（き）＿＿つけましょう。", "cn": "在雪路上小心别滑倒哦。", "answer": "を", "options": ["を", "に", "が", "で"], "ruleTip": "固定搭配「気（き）をつける」＝注意小心；所要注意的对象前面用「に」（足元に気をつける）。"},
        {"kind": "particle", "promptJp": "時間（じかん）ぎりぎりでしたが、なんとか飛行機（ひこうき）＿＿間（ま）に合（あ）いました。", "cn": "时间非常紧张，总算赶上飞机了。", "answer": "に", "options": ["に", "を", "で", "が"], "ruleTip": "「間に合う（赶上、来得及）」前面表示目标时间或交通工具用助词「に」！"},
        {"kind": "particle", "promptJp": "道（みち）＿＿迷（まよ）ってしまったので、駅員（えきいん）さんに聞（き）きましょう。", "cn": "迷路了，去问问车站工作人员吧。", "answer": "に", "options": ["に", "を", "で", "が"], "ruleTip": "固定搭配「道（みち）に迷（まよ）う」＝迷路，用助词「に」！"},
        {"kind": "particle", "promptJp": "フロント＿＿大きいスーツケースを2つ預（あず）けました。", "cn": "在前台寄存了2个大行李箱。", "answer": "に", "options": ["に", "で", "へ", "を"], "ruleTip": "把某物寄放在某人/某处，收受方用「に」：「フロントに 荷物を 預ける」！"},
        {"kind": "particle", "promptJp": "ホテルに着（つ）く前（まえ）に、駅（えき）＿＿ちょっと寄（よ）ってもいい？", "cn": "到酒店前可以顺便去趟车站/便利店吗？", "answer": "に", "options": ["に", "を", "で", "から"], "ruleTip": "「〜に 寄（よ）る / 〜に 立ち寄る」表示顺便停靠、顺路去某地，用助词「に」或「へ」！"},
        {"kind": "particle", "promptJp": "展示品（てんじひん）＿＿あまり触（さわ）らないでくださいね。", "cn": "展品请不要随便触摸哦。", "answer": "に", "options": ["に", "を", "で", "が"], "ruleTip": "「触る（触摸）」在标准日语中通常用「〜に 触（さわ）る」（比如 展示品に触る）！"},
        {"kind": "particle", "promptJp": "東京（とうきょう）＿＿住（す）んでいる友達（ともだち）に会（あ）います。", "cn": "要去见住在东京的朋友。", "answer": "に", "options": ["に", "で", "を", "へ"], "ruleTip": "表示长期居住地「住む」以及固定存在状态，用助词「に」：「東京に住む」！"},
        {"kind": "particle", "promptJp": "由布院（ゆふいん）の温泉旅館（おんせんりょかん）＿＿一泊（いっぱく）します。", "cn": "在由布院的温泉旅馆住1晚。", "answer": "に", "options": ["に", "を", "で", "から"], "ruleTip": "「ホテル / 旅館に 泊（と）まる / 一泊する」表示下榻住在某酒店，固定搭配助词「に」！"},
        {"kind": "particle", "promptJp": "この角（かど）を右（みぎ）＿＿曲（ま）がると、すぐレストランがあります。", "cn": "在这个拐角往右转，马上就能看到餐厅。", "answer": "へ", "options": ["へ", "を", "で", "から"], "ruleTip": "「角（かど）を（经过拐角）＋ 右へ/右に 曲がる（向右侧拐弯）」！"},
        {"kind": "particle", "promptJp": "せっかくなので、季節（きせつ）のパフェ＿＿挑戦（ちょうせん）してみましょう。", "cn": "机会难得，挑战试试这个季节限定芭菲吧！", "answer": "に", "options": ["に", "を", "で", "が"], "ruleTip": "「〜に 挑戦（ちょうせん）する」表示挑战某个目标，固定用助词「に」！"},
        {"kind": "particle", "promptJp": "昨日（きのう）の夜（よる）、ホテルの人（ひと）＿＿とても親切（しんせつ）にしてもらいました。", "cn": "昨晚承蒙酒店工作人员非常热心地帮忙。", "answer": "に", "options": ["に", "を", "で", "が"], "ruleTip": "「〜に してもらう（请/承蒙某人为我做某事）」，动作发出者用「に」或「から」！"},
        {"kind": "particle", "promptJp": "2階（かい）の階段（かいだん）＿＿昇（のぼ）って上（うえ）に行（い）きます。", "cn": "沿着二楼的楼梯走上去。", "answer": "を", "options": ["を", "に", "で", "へ"], "ruleTip": "经过、穿过的路径（走廊、公园、马路、桥、楼梯）在移动动词前用「を」：「道を渡る / 橋を通る / 階段を昇る」！"},
        {"kind": "particle", "promptJp": "チェックアウト後（ご）の荷物（にもつ）預（あず）かり＿＿、本当（ほんとう）に助（たす）かりました！", "cn": "退房后的寄存行李服务真是帮了大忙！", "answer": "で", "options": ["で", "を", "に", "へ"], "ruleTip": "表示原因“多亏了这件事（帮了大忙）”用「で」或「〜て助かる」！"},
        {"kind": "particle", "promptJp": "お姉（ねえ）ちゃんの日本（にほん）生活（せいかつ）＿＿もうすっかり慣（な）れました。", "cn": "已经完全适应了在日本的生活了。", "answer": "に", "options": ["に", "を", "で", "が"], "ruleTip": "「〜に 慣（な）れる（适应/习惯某环境）」固定搭配助词「に」！"},
        {"kind": "particle", "promptJp": "急（いそ）いでいるので、タクシー＿＿乗（の）り換（か）えましょう。", "cn": "赶时间，咱们换乘出租车吧。", "answer": "に", "options": ["に", "を", "で", "から"], "ruleTip": "「（原来的车）から ＋（新的车）に 乗り換える」表示换乘到新交通工具，用「に」！"}
    ]
}


def load_json_array(path, varname):
    txt = path.read_text(encoding="utf-8")
    m = re.search(rf"window\.{varname}\s*=\s*(\[.*\]);", txt, re.S)
    if not m:
        raise ValueError(f"Could not find {varname} in {path}")
    return json.loads(m.group(1))


def load_existing_extras(path):
    txt = path.read_text(encoding="utf-8")
    idx = txt.find("{")
    r_idx = txt.rfind("}")
    body = txt[idx : r_idx + 1]
    try:
        return json.loads(body)
    except Exception:
        lines = []
        for line in body.splitlines():
            if line.lstrip().startswith("//"):
                continue
            line = re.sub(r'(?<=[,"\]\}])\s*//.*$', "", line)
            lines.append(line)
        cleaned = "\n".join(lines)
        cleaned = re.sub(r'(?m)^(\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*:', r'\1"\2":', cleaned)
        cleaned = re.sub(r'([\{,])\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*:', r'\1 "\2":', cleaned)
        cleaned = re.sub(r',(\s*[\}\]])', r"\1", cleaned)
        return json.loads(cleaned)


KANA_ROMAJI = {
    "きゃ":"kya","きゅ":"kyu","きょ":"kyo","しゃ":"sha","しゅ":"shu","しょ":"sho",
    "ちゃ":"cha","ちゅ":"chu","ちょ":"cho","にゃ":"nya","にゅ":"nyu","にょ":"nyo",
    "ひゃ":"hya","ひゅ":"hyu","ひょ":"hyo","みゃ":"mya","みゅ":"myu","みょ":"myo",
    "りゃ":"rya","りゅ":"ryu","りょ":"ryo","ぎゃ":"gya","ぎゅ":"gyu","ぎょ":"gyo",
    "じゃ":"ja","じゅ":"ju","じょ":"jo","びゃ":"bya","びゅ":"byu","びょ":"byo",
    "ぴゃ":"pya","ぴゅ":"pyu","ぴょ":"pyo",
    "あ":"a","い":"i","う":"u","え":"e","お":"o",
    "か":"ka","き":"ki","く":"ku","け":"ke","こ":"ko",
    "さ":"sa","し":"shi","す":"su","せ":"se","そ":"so",
    "た":"ta","ち":"chi","つ":"tsu","て":"te","と":"to",
    "な":"na","に":"ni","ぬ":"nu","ね":"ne","の":"no",
    "は":"ha","ひ":"hi","ふ":"fu","へ":"he","ほ":"ho",
    "ま":"ma","み":"mi","む":"mu","め":"me","も":"mo",
    "や":"ya","ゆ":"yu","よ":"yo",
    "ら":"ra","り":"ri","る":"ru","れ":"re","ろ":"ro",
    "わ":"wa","を":"wo","ん":"n",
    "が":"ga","ぎ":"gi","ぐ":"gu","げ":"ge","ご":"go",
    "ざ":"za","じ":"ji","ず":"zu","ぜ":"ze","ぞ":"zo",
    "だ":"da","ぢ":"ji","づ":"zu","で":"de","ど":"do",
    "ば":"ba","び":"bi","ぶ":"bu","べ":"be","ぼ":"bo",
    "ぱ":"pa","ぴ":"pi","ぷ":"pu","ぺ":"pe","ぽ":"po",
}


def kana_to_romaji(text):
    out = []
    i = 0
    while i < len(text):
        ch = text[i]
        if ch == "っ" and i + 1 < len(text):
            nxt = KANA_ROMAJI.get(text[i + 1 : i + 3]) or KANA_ROMAJI.get(text[i + 1], "")
            if nxt:
                out.append("t" if nxt.startswith("ch") else nxt[0])
            i += 1
            continue
        if i + 1 < len(text) and text[i : i + 2] in KANA_ROMAJI:
            out.append(KANA_ROMAJI[text[i : i + 2]])
            i += 2
            continue
        if ch == "ー" and out:
            out.append(out[-1][-1])
            i += 1
            continue
        out.append(KANA_ROMAJI.get(ch, ch))
        i += 1
    return "".join(out)


def make_fallback_third_example(v):
    """For any verb without a custom 3rd example, create a clean N4->N3 colloquial/practical sentence with accurate romaji."""
    dict_w = v["dict"]
    forms = v["forms"]
    te = forms["te"]["jp"]
    te_k = forms["te"]["kana"]
    ta = forms["ta"]["jp"]
    ta_k = forms["ta"]["kana"]
    if dict_w.endswith("する"):
        base = dict_w[:-2]
        base_r = v["romaji"].replace(" suru", "").strip()
        return {
            "form": "💬 口语缩略",
            "jp": f"念（ねん）のため、あとで{base}しといたほうがいいかもね。",
            "romaji": f"Nen no tame, ato de {base_r} shitoita hou ga ii kamo ne.",
            "cn": f"保险起见，待会还是先{v['cn'].split('、')[0]}一下比较好哦（〜ておく→〜とく）。"
        }
    if te and not te.startswith("—"):
        if v.get("transitivity") == "vt":
            toku_jp = te[:-1] + ("ど" if te.endswith("で") else "と") + "こう"
            toku_rom = kana_to_romaji(te_k[:-1] + ("ど" if te_k.endswith("で") else "と") + "こう")
            return {
                "form": "💬 口语缩略",
                "jp": f"出発（しゅっぱつ）の前（まえ）に、今のうちに{toku_jp}！",
                "romaji": f"Shuppatsu no mae ni, ima no uchi ni {toku_rom}!",
                "cn": f"出发前趁现在先提前{v['cn'].split('、')[0]}吧（〜ておこう→〜とこう）。"
            }
        teru_jp = te + "る"
        teru_rom = kana_to_romaji(te_k + "る")
        return {
            "form": "💬 口语缩略",
            "jp": f"もうすっかり{teru_jp}から、大丈夫（だいじょうぶ）だよ。",
            "romaji": f"Mou sukkari {teru_rom} kara, daijoubu da yo.",
            "cn": f"已经好好{v['cn'].split('、')[0]}了，放心吧（〜ている→〜てる）。"
        }
    ta_rom = kana_to_romaji(ta_k)
    return {
        "form": "N4 实用",
        "jp": f"旅（たび）の間（あいだ）、ゆっくり{ta}。",
        "romaji": f"Tabi no aida, yukkuri {ta_rom}.",
        "cn": f"旅途中好好体验了「{v['cn'].split('、')[0]}」。"
    }


def main():
    # 1. Process Verbs (200 -> 300)
    existing_verbs = load_json_array(DATA_DIR / "verbs_top200.js", "JP_TOP_VERBS")
    assert len(existing_verbs) == 200, f"Expected 200 verbs, got {len(existing_verbs)}"

    all_verbs = []
    seen_dicts = set()

    for v in existing_verbs:
        dict_w = v["dict"]
        seen_dicts.add(dict_w)
        # Recompute causative_passive and imperative cleanly
        computed = build_all_forms(dict_w, v["kana"], v["group"])
        v["forms"]["causative_passive"] = computed["causative_passive"]
        v["forms"]["imperative"] = computed["imperative"]

        trans, particles = EXISTING_META[dict_w]
        v["transitivity"] = trans
        v["particles"] = particles
        v["pairId"] = None

        # Keep existing 2 examples, add/refresh 3rd example idempotently
        base_ex = list(v.get("examples", []))[:2]
        ex3 = THIRD_EXAMPLES.get(dict_w) or make_fallback_third_example(v)
        v["examples"] = base_ex + [ex3]
        all_verbs.append(v)

    assert len(NEW_VERBS_SPEC) == 100, f"Expected 100 new verbs, got {len(NEW_VERBS_SPEC)}"

    for idx, spec in enumerate(NEW_VERBS_SPEC, start=201):
        (dict_w, jp_ruby, kana, romaji, cn, jlpt, group, cat, trans, particles, ex1, ex2, ex3, overrides) = spec
        assert dict_w not in seen_dicts, f"Duplicate dict word: {dict_w}"
        seen_dicts.add(dict_w)
        forms = build_all_forms(dict_w, kana, group, overrides=overrides)
        vid = f"v-{idx:03d}"
        all_verbs.append({
            "id": vid,
            "rank": idx,
            "dict": dict_w,
            "jp": jp_ruby,
            "kana": kana,
            "romaji": romaji,
            "cn": cn,
            "jlpt": jlpt,
            "group": group,
            "category": cat,
            "transitivity": trans,
            "pairId": None,
            "particles": particles,
            "forms": forms,
            "examples": [
                {"form": ex1[0], "jp": ex1[1], "romaji": ex1[2], "cn": ex1[3]},
                {"form": ex2[0], "jp": ex2[1], "romaji": ex2[2], "cn": ex2[3]},
                {"form": ex3[0], "jp": ex3[1], "romaji": ex3[2], "cn": ex3[3]},
            ],
        })

    # Link bidirectional pairs
    by_dict = {v["dict"]: v for v in all_verbs}
    paired_count = 0
    for vi_w, vt_w in PAIR_DICT_LINKS:
        assert vi_w in by_dict, f"Missing vi {vi_w}"
        assert vt_w in by_dict, f"Missing vt {vt_w}"
        v_vi = by_dict[vi_w]
        v_vt = by_dict[vt_w]
        v_vi["pairId"] = v_vt["id"]
        v_vt["pairId"] = v_vi["id"]
        paired_count += 1

    # Validate all 300 verbs
    required_forms = {
        "dict", "masu", "te", "ta", "nai", "tai", "potential",
        "volitional", "ba", "passive", "causative", "causative_passive", "imperative"
    }
    by_id = {v["id"]: v for v in all_verbs}
    for v in all_verbs:
        assert set(v["forms"].keys()) == required_forms, f"Bad forms keys on {v['id']} {v['dict']}"
        assert len(v["examples"]) == 3, f"Expected 3 examples on {v['id']}"
        assert v["transitivity"] in ("vi", "vt", "both")
        if v["pairId"]:
            partner = by_id[v["pairId"]]
            assert partner["pairId"] == v["id"], f"Non-reciprocal pair {v['id']} <-> {partner['id']}"

    verbs_out = (
        "// Top 300 Most Frequently Used Japanese Verbs (N5-N3) with 13 Conjugation Forms,\n"
        "// Transitive/Intransitive Pairs (自他成对), Particle Collocations & 900 Daily Examples\n"
        "window.JP_TOP_VERBS = " + json.dumps(all_verbs, ensure_ascii=False, indent=2) + ";\n"
    )
    (DATA_DIR / "verbs_top200.js").write_text(verbs_out, encoding="utf-8")

    # 2. Process Grammar (96 -> 132: 50 N5, 36 N4, 46 N3)
    existing_grammar = load_json_array(DATA_DIR / "grammar_n5_n3.js", "JP_GRAMMAR_LIST")
    added_ids = {g["id"] for g in N5_GRAMMAR_ADDITIONS + NEW_GRAMMAR_POINTS}
    base_grammar = [g for g in existing_grammar if g["id"] not in added_ids]
    assert len(base_grammar) == 96, f"Expected 96 base grammar points, got {len(base_grammar)}"

    n5_base = [g for g in base_grammar if g["level"] == "N5"]
    n4_base = [g for g in base_grammar if g["level"] == "N4"]
    n3_base = [g for g in base_grammar if g["level"] == "N3"]
    n4_new = [g for g in NEW_GRAMMAR_POINTS if g["level"] == "N4"]
    n3_new = [g for g in NEW_GRAMMAR_POINTS if g["level"] == "N3"]

    all_grammar = n5_base + N5_GRAMMAR_ADDITIONS + n4_base + n4_new + n3_base + n3_new
    assert len(all_grammar) == 132, f"Expected 132 grammar points, got {len(all_grammar)}"
    assert len({g["id"] for g in all_grammar}) == 132, "Duplicate grammar IDs!"

    grammar_out = (
        "// Curated Japanese Grammar Guide Grouped by JLPT N5 / N4 / N3 & Ordered by Daily Importance\n"
        "// 132 High-Frequency Patterns (50 N5, 36 N4, 46 N3) with Formation Formulas, Tips, Examples & Quizzes\n"
        "window.JP_GRAMMAR_LIST = " + json.dumps(all_grammar, ensure_ascii=False, indent=2) + ";\n"
    )
    (DATA_DIR / "grammar_n5_n3.js").write_text(grammar_out, encoding="utf-8")

    # 3. Process Learning Extras (preserve base 50 adjectives + counters + kanaRows; expand to 75 adj + 250 N5 vocab + 9 N4->N3 sets)
    extras = load_existing_extras(DATA_DIR / "learning_extras.js")
    base_adjs = [a for a in extras["adjectives"] if not str(a.get("id", "")).startswith("adj-05") and not str(a.get("id", "")).startswith("adj-06") and not str(a.get("id", "")).startswith("adj-07")]
    base_adjs = base_adjs[:50]
    for i, a in enumerate(base_adjs, start=1):
        a["id"] = f"adj-{i:03d}"
        a.setdefault("jlpt", "N5" if i <= 40 else "N4")
    extras["adjectives"] = base_adjs + N5_EXTRA_ADJECTIVES
    assert len(extras["adjectives"]) == 75, f"Expected 75 adjectives, got {len(extras['adjectives'])}"

    n5_vocab_entries = []
    for i, item in enumerate(N5_CORE_VOCAB_LIST, start=1):
        entry = {"id": f"n5v-{i:03d}", **item}
        n5_vocab_entries.append(entry)
    extras["n5Vocab"] = n5_vocab_entries

    for k, val in LEARNING_EXTRAS_NEW.items():
        extras[k] = val

    extras_out = (
        "// Japanese Quick-Reference & N5->N3 Complete Vocabulary & Fluency Toolbox (Strict JSON)\n"
        "// Adjectives (75), N5 Core Vocab (250), Counters, Kana, Grammar Comparisons (6), Contractions (16),\n"
        "// Adverbs (40), Onomatopoeia (32), Keigo Verbs (18), Staff Decoder (24),\n"
        "// Kanji Traps & Katakana (24), Street Signs (24), Vi/Vt & Particle Quizzes (36)\n"
        "window.JP_LEARNING_EXTRAS = " + json.dumps(extras, ensure_ascii=False, indent=2) + ";\n"
    )
    (DATA_DIR / "learning_extras.js").write_text(extras_out, encoding="utf-8")

    print(
        f"SUCCESS! Verbs={len(all_verbs)} (pairs={paired_count}), "
        f"Grammar={len(all_grammar)} (N5={len(n5_base)+len(N5_GRAMMAR_ADDITIONS)}, N4={len(n4_base)+len(n4_new)}, N3={len(n3_base)+len(n3_new)}), "
        f"Extras keys={list(extras.keys())} "
        f"(counts={[len(extras[k]) for k in extras]})"
    )


if __name__ == "__main__":
    main()
