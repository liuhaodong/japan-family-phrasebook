"""Guided 10-min Sensei Lesson Planner, Audio Mirror Evaluator, Live Sidecar & Report Generator."""

from __future__ import annotations

import asyncio
import base64
import json
import random
import re
import time
import uuid
from typing import Any, Callable, Dict, List, Optional

import httpx

from server.config import (
    AUTHOR_MODELS,
    COACH_FALLBACK_MODELS,
    COACH_MODEL,
    COACH_MODEL_OPTIONS,
    DEFAULT_VOICE,
    GEMINI_API_BASE,
    REPORT_FALLBACK_MODELS,
    REPORT_MODEL,
    TTS_FAST_MODEL,
    TURN_AUDIO_DIR,
)
from server.db import (
    add_turn,
    create_session,
    finish_session,
    list_lesson_progress,
    list_session_turns,
    list_weaknesses,
    upsert_lesson_progress,
    upsert_weakness,
)
from server.services.audio_utils import normalize_gemini_audio
from server.services.curriculum_loader import get_grammar, get_scenario, get_verbs
from server.services.jp_tokenizer import (
    has_kana,
    has_kanji,
    jp_to_kana,
    strip_furigana_parens,
    tokenize_sentence,
)
from server.services.srs_service import list_cards
from server.services.syllabus import get_syllabus_lesson, get_syllabus_overview
from server.services.tts_service import prewarm_tts_stream, synthesize_speech

_CODE_FENCE_RE = re.compile(r"^```(?:json)?\s*|\s*```$", re.MULTILINE)
_SPOKEN_SCRIPT_RE = re.compile(r'"teacherSpokenScript"\s*:\s*"((?:\\.|[^"\\])*)"')
_VALID_OR_BAD_ESCAPE_RE = re.compile(r'\\(["\\/bfnrt]|u[0-9a-fA-F]{4})|\\')
_TRAILING_COMMA_RE = re.compile(r",\s*([}\]])")
_DUP_PUNCT_RE = re.compile(r"([。！？!?])\1+")
_GENERIC_CN_OVERLAP = {
    "今天", "昨天", "明天", "现在", "时间", "问题", "朋友", "咖啡", "工作",
    "天气", "声音", "练习", "注意", "自己", "意思", "中文", "日语", "日本",
    "中国", "周末", "酒店", "机场", "餐厅", "小时", "时候", "公司", "家庭",
}


def prepare_tts_bilingual_script(script: str, jp_phrases: Optional[List[str]] = None) -> str:
    """Convert Japanese kanji fragments in a mixed CN+JP script into kana using target phrase context."""
    text = (script or "").strip()
    if not text:
        return ""
    text = _DUP_PUNCT_RE.sub(r"\1", text)

    replacements: Dict[str, str] = {}
    for raw_phrase in jp_phrases or []:
        clean = strip_furigana_parens(raw_phrase or "")
        if not clean:
            continue
        bare = clean.rstrip("。！？!?、,. ")
        if has_kanji(clean) and (len(clean) >= 2 or len(bare) >= 2):
            replacements[clean] = jp_to_kana(clean)
        if bare and len(bare) >= 2 and has_kanji(bare):
            replacements[bare] = jp_to_kana(bare)
        if len(bare) >= 2 and not has_kanji(bare):
            continue

        toks = tokenize_sentence(clean)
        n = len(toks)
        for i in range(n):
            acc_surfaces: List[str] = []
            for j in range(i, min(n, i + 8)):
                surf = toks[j].get("surface") or ""
                if not surf.strip():
                    break
                acc_surfaces.append(surf)
                span = "".join(acc_surfaces)
                if len(span) < 2 or not has_kanji(span):
                    continue
                if j == i and not has_kana(span) and span in _GENERIC_CN_OVERLAP and raw_phrase != span:
                    continue
                if span not in replacements:
                    replacements[span] = jp_to_kana(span)

    if replacements:
        pattern = re.compile("|".join(re.escape(k) for k in sorted(replacements, key=len, reverse=True)))
        text = pattern.sub(lambda m: replacements[m.group(0)], text)
    return _DUP_PUNCT_RE.sub(r"\1", text).strip()

# Curated substitution pattern drills connecting Top verbs & travel family scenarios
SUBSTITUTION_TEMPLATES = [
    {
        "pattern": "〜てもいいですか（礼貌请求允许）",
        "slot_note": "动词て形 + もいいですか",
        "cue_cn": "请问可以把婴儿车先寄存在这里吗？",
        "target_jp": "ベビーカーをここに預けてもいいですか。",
        "target_reading": "べびーかーをここにあずけてもいいですか。",
        "hint_jp": "預ける（あずける）→ 預けてもいいですか",
    },
    {
        "pattern": "〜ていただけますか（委婉拜托对方）",
        "slot_note": "动词て形 + いただけますか（比てください更柔和）",
        "cue_cn": "能请您帮我们确认一下预约吗？",
        "target_jp": "予約を確認していただけますか。",
        "target_reading": "よやくをかくにんしていただけますか。",
        "hint_jp": "確認する → 確認していただけますか",
    },
    {
        "pattern": "〜んですが（礼貌铺垫提出需求）",
        "slot_note": "普通形/ます形 + んですが（引出下文）",
        "cue_cn": "我想从美国旧金山把行李寄到下一家酒店……",
        "target_jp": "次のホテルに荷物を送りたいんですが。",
        "target_reading": "つぎのほてるににもつをおくりたいんですが。",
        "hint_jp": "送る → 送りたいんですが",
    },
    {
        "pattern": "〜ないでください / 〜を抜いてください（饮食禁忌/过敏）",
        "slot_note": "动词ない形 / 抜く（ぬく：去掉）",
        "cue_cn": "小孩子不吃芥末，请不要放芥末。",
        "target_jp": "子どもはわさびが苦手なので、抜いてください。",
        "target_reading": "こどもはわさびがにがてなので、ぬいてください。",
        "hint_jp": "苦手（にがて）＋ 抜いてください",
    },
]


def _extract_json_text(raw: str) -> Dict[str, Any]:
    clean = _CODE_FENCE_RE.sub("", (raw or "").strip()).strip()
    start = clean.find("{")
    end = clean.rfind("}")
    if start != -1 and end != -1 and end > start:
        clean = clean[start : end + 1]
    try:
        return json.loads(clean)
    except json.JSONDecodeError:
        repaired = _VALID_OR_BAD_ESCAPE_RE.sub(lambda m: m.group(0) if m.group(1) else r"\\", clean)
        repaired = _TRAILING_COMMA_RE.sub(r"\1", repaired)
        return json.loads(repaired, strict=False)


def compute_repeat_decision(
    overall_score: int,
    issues: List[Dict[str, Any]],
    attempt: int,
    drill_chunk_jp: str,
    target_jp: str,
    pass_threshold: int = 88,
) -> str:
    """Deterministic Repeat-Until-Good state transition rule."""
    has_critical = any((it.get("severity") == "critical") for it in (issues or []))
    if overall_score >= pass_threshold and not has_critical:
        return "pass"
    if attempt >= 3:
        return "advance"
    clean_chunk = strip_furigana_parens(drill_chunk_jp)
    clean_target = strip_furigana_parens(target_jp)
    if clean_chunk and len(clean_chunk) < len(clean_target):
        return "retry_chunk"
    return "retry_full"


_ORIG_ASYNC_CLIENT = httpx.AsyncClient
_SHARED_CLIENT: Optional[httpx.AsyncClient] = None
_ALLOWED_COACH_MODELS = {m["id"] for m in COACH_MODEL_OPTIONS} | {"gemini-4-argon", "gemini-4-carbon"}


def _get_http_client(timeout_sec: float = 45.0) -> tuple[httpx.AsyncClient, bool]:
    global _SHARED_CLIENT
    if httpx.AsyncClient is not _ORIG_ASYNC_CLIENT:
        return httpx.AsyncClient(timeout=timeout_sec), True
    if _SHARED_CLIENT is None or _SHARED_CLIENT.is_closed:
        _SHARED_CLIENT = httpx.AsyncClient(
            timeout=httpx.Timeout(timeout_sec, connect=4.0),
            limits=httpx.Limits(max_keepalive_connections=6, max_connections=20, keepalive_expiry=10.0),
        )
    return _SHARED_CLIENT, False


async def _request_model_once(
    client: httpx.AsyncClient,
    mdl: str,
    payload: Dict[str, Any],
    api_key: str,
    per_timeout: float,
    use_stream: bool,
    on_script_ready: Optional[Callable[[str], None]] = None,
    should_close: bool = False,
) -> Dict[str, Any]:
    req_timeout: Any = httpx.Timeout(per_timeout, connect=4.0) if not should_close else per_timeout
    headers = {"x-goog-api-key": api_key, "Content-Type": "application/json"}
    if use_stream:
        url = f"{GEMINI_API_BASE}/models/{mdl}:streamGenerateContent?alt=sse"
        acc = ""
        script_emitted = False
        async with client.stream("POST", url, headers=headers, json=payload, timeout=req_timeout) as resp:
            if resp.status_code >= 400:
                err_body = (await resp.aread()).decode("utf-8", "ignore")[:220]
                raise RuntimeError(f"{mdl} HTTP {resp.status_code}: {err_body}")
            async for line in resp.aiter_lines():
                if not line.startswith("data: "):
                    continue
                data_str = line[6:].strip()
                if not data_str or data_str == "[DONE]":
                    continue
                obj = json.loads(data_str)
                for cand in obj.get("candidates") or []:
                    for part in (cand.get("content") or {}).get("parts") or []:
                        if part.get("thought"):
                            continue
                        chunk_txt = part.get("text")
                        if chunk_txt:
                            acc += chunk_txt
                            if on_script_ready and not script_emitted:
                                m = _SPOKEN_SCRIPT_RE.search(acc)
                                if m:
                                    script_emitted = True
                                    try:
                                        spoken = json.loads(f'"{m.group(1)}"')
                                        if spoken:
                                            on_script_ready(spoken)
                                    except Exception:
                                        pass
        if not acc.strip():
            raise RuntimeError(f"Empty stream response from {mdl}")
        parsed = _extract_json_text(acc)
        parsed["_modelUsed"] = mdl
        return parsed

    resp = await client.post(
        f"{GEMINI_API_BASE}/models/{mdl}:generateContent",
        headers=headers,
        json=payload,
        timeout=req_timeout,
    )
    if resp.status_code >= 400:
        raise RuntimeError(f"{mdl} HTTP {resp.status_code}: {resp.text[:220]}")
    data = resp.json()
    cand = (data.get("candidates") or [{}])[0]
    text = (
        cand.get("content", {})
        .get("parts", [{}])[0]
        .get("text", "")
    )
    if not text and cand.get("finishReason"):
        raise RuntimeError(f"Empty response (finishReason={cand.get('finishReason')})")
    parsed = _extract_json_text(text)
    parsed["_modelUsed"] = mdl
    return parsed


async def _call_gemini_json(
    parts: List[Dict[str, Any]],
    models: List[str],
    api_key: str,
    temperature: float = 0.2,
    timeout_sec: float = 45.0,
    max_output_tokens: Optional[int] = None,
    per_model_timeouts: Optional[Dict[str, float]] = None,
    on_script_ready: Optional[Callable[[str], None]] = None,
    hedge_after_sec: Optional[float] = None,
) -> Dict[str, Any]:
    gen_cfg: Dict[str, Any] = {
        "temperature": temperature,
        "responseMimeType": "application/json",
        "thinkingConfig": {"thinkingLevel": "LOW"},
    }
    if max_output_tokens:
        gen_cfg["maxOutputTokens"] = max_output_tokens
    payload = {
        "contents": [{"role": "user", "parts": parts}],
        "generationConfig": gen_cfg,
    }
    last_err: Optional[str] = None
    client, should_close = _get_http_client(timeout_sec)
    can_stream = bool(on_script_ready) and (not should_close or hasattr(client, "stream"))

    try:
        if should_close:
            await client.__aenter__()

        if hedge_after_sec is not None and len(models) >= 2:
            m0, m1, rest = models[0], models[1], models[2:]
            t0 = (per_model_timeouts or {}).get(m0, timeout_sec)
            t1 = (per_model_timeouts or {}).get(m1, timeout_sec)

            async def _run_single(mdl: str, mdl_timeout: float) -> Dict[str, Any]:
                return await _request_model_once(
                    client=client,
                    mdl=mdl,
                    payload=payload,
                    api_key=api_key,
                    per_timeout=mdl_timeout,
                    use_stream=can_stream,
                    on_script_ready=on_script_ready,
                    should_close=should_close,
                )

            primary_task = asyncio.create_task(_run_single(m0, t0))
            done, _ = await asyncio.wait({primary_task}, timeout=hedge_after_sec)
            if primary_task in done:
                try:
                    return primary_task.result()
                except Exception as exc:
                    last_err = f"{m0}: {type(exc).__name__}: {exc}"
                    print(f"[sensei] fallback from {m0}: {last_err}")
                    remaining_models = [m1, *rest]
            else:
                print(f"[sensei] hedging {m0} after {hedge_after_sec:.1f}s with {m1}")
                hedge_task = asyncio.create_task(_run_single(m1, t1))
                pending = {primary_task, hedge_task}
                while pending:
                    done_set, pending = await asyncio.wait(pending, return_when=asyncio.FIRST_COMPLETED)
                    for finished in done_set:
                        try:
                            res = finished.result()
                            for p in pending:
                                p.cancel()
                                try:
                                    await p
                                except (asyncio.CancelledError, Exception):
                                    pass
                            return res
                        except Exception as exc:
                            last_err = f"{type(exc).__name__}: {exc}"
                            print(f"[sensei] hedged branch failed: {last_err}")
                remaining_models = rest
        else:
            remaining_models = list(models)

        for mdl in remaining_models:
            per_timeout = (per_model_timeouts or {}).get(mdl, timeout_sec)
            try:
                return await _request_model_once(
                    client=client,
                    mdl=mdl,
                    payload=payload,
                    api_key=api_key,
                    per_timeout=per_timeout,
                    use_stream=can_stream,
                    on_script_ready=on_script_ready,
                    should_close=should_close,
                )
            except Exception as exc:
                last_err = f"{mdl}: {type(exc).__name__}: {exc}"
                print(f"[sensei] fallback from {mdl}: {last_err}")
    finally:
        if should_close:
            await client.__aexit__(None, None, None)
    raise RuntimeError(f"AI 私教评审请求失败：{last_err or 'unknown error'}")


_VARIED_DAILY_SCENES = [
    "精品咖啡馆工作小憩",
    "公司茶水间与同事闲聊",
    "周末逛书店与买文具",
    "傍晚在公园散步",
    "在家准备晚饭与陪娃",
    "聊最近看的电影或新科技",
    "小区超市买菜挑水果",
    "周五下班约朋友吃拉面",
]


async def _author_textbook_lesson(
    *,
    user_id: str,
    curriculum_mode: str,
    unit: Optional[Dict[str, Any]],
    custom_topic: str,
    jlpt_target: str,
    weaknesses: List[Dict[str, Any]],
    due_cards: List[Dict[str, Any]],
    coach_model: Optional[str],
    api_key: str,
) -> Dict[str, Any]:
    """Use a Veteran Tokyo Sensei prompt to author a fresh 6-step everyday Japanese lesson."""
    topic_title = custom_topic if curriculum_mode == "custom_topic" else (unit or {}).get("title", "日常口语进阶")
    grammar_focus = custom_topic if curriculum_mode == "custom_topic" else (unit or {}).get("grammarFocus", "")
    cn_pitfall = (unit or {}).get("cnPitfall", "避免中文语序与中式直译，突出日语助词与自然语调。")
    key_patterns = ", ".join((unit or {}).get("keyPatterns") or [])
    fresh_pair = random.sample(_VARIED_DAILY_SCENES, 2)
    base_contexts = (unit or {}).get("everydayContexts") or ["咖啡馆日常", "朋友聊天", "职场茶水间", "周末生活"]
    contexts = ", ".join(list(dict.fromkeys([*fresh_pair, *base_contexts]))[:4])

    weakness_str = ", ".join(w["pattern_key"] for w in weaknesses) or "暂无（本课聚焦新知识，无需旧错题热身）"
    due_str = ", ".join(f"{c['surface']}({c.get('meaning_cn', '')})" for c in due_cards) or "暂无（本课全部采用全新生活词汇）"

    prompt = (
        "你是一位拥有20年教龄、专精教授中国成年人日语的资深东京私教总监。\n"
        "请脱离普通旅游观光模板，为学生原创编写一堂完整、鲜活、地道东京生活/工作向的「10分钟6步私教课教材」。\n\n"
        f"课程主题: {topic_title}\n"
        f"核心语法与音调焦点: {grammar_focus}\n"
        f"目标句型参考: {key_patterns or '围绕主题自然精选'}\n"
        f"中国学习者常见母语负迁移陷阱: {cn_pitfall}\n"
        f"建议生活语境（不要写机场酒店打卡模板）: {contexts}\n"
        f"学生目标等级: {jlpt_target}\n"
        f"学生历史薄弱点: {weakness_str}\n"
        f"记忆本待复习生词（若自然顺畅可嵌入1个）: {due_str}\n\n"
        "【书写规范】targetJp、questionJp、blackboard 的日语例句必须使用东京日常规范日语（正常使用常用汉字与假名混排，如「新しい料理を作ってみます。」「店の席を予約しておきます。」），禁止写成全平假名！界面会自动在汉字上方标出假名。\n"
        "【口播规范】teacherPrompt 供语音朗读：请把中文引导与日语示范分成独立句子（先用纯中文说清要点加句号，不要在中文句子中间夹杂日语词，再另起一句给纯日语示范句），后端会自动把日语单独按假名发音，绝不串音。\n\n"
        "严格输出以下 JSON（steps 必须精确为 6 步，顺序为 WARMUP, TEACH, CONTROLLED_DRILL, TRANSFORM_DRILL, SUBSTITUTION_DRILL, FREE_OUTPUT）：\n"
        "{\n"
        '  "blackboard": {\n'
        '    "titleCn": "简练黑板标题（20字内）",\n'
        '    "grammarPoint": "本课主攻文法/发音点",\n'
        '    "formulaJp": "清晰结构公式",\n'
        '    "cnPitfallCn": "一句话讲透中国人为什么容易说错",\n'
        '    "contrastBadJp": "典型中式直译错句（日语）",\n'
        '    "contrastGoodJp": "东京母语者地道说法（日语）",\n'
        '    "contrastNoteCn": "对照点拨（25字内）"\n'
        "  },\n"
        "  \"steps\": [\n"
        '    {"stage": "WARMUP", "stageLabel": "1. 热身唤醒", "hideTarget": false, "targetJp": "规范日语句子(含常用汉字)", "targetCn": "中文翻译", "cueCn": "老师练习指引", "tipCn": "发音/记忆小贴士", "teacherPrompt": "纯中文开场引导加句号。随后另起一句给出纯日语示范句"},\n'
        '    {"stage": "TEACH", "stageLabel": "2. 核心精讲", "hideTarget": false, "targetJp": "规范日语核心例句(含常用汉字)", "targetCn": "中文翻译", "cueCn": "用法点拨", "tipCn": "对比技巧", "teacherPrompt": "纯中文讲解要点加句号(不夹日语词)。随后另起一句给纯日语示范句"},\n'
        '    {"stage": "CONTROLLED_DRILL", "stageLabel": "3. 节奏镜子", "hideTarget": false, "targetJp": "另一句地道日常日语(含常用汉字)", "targetCn": "中文翻译", "cueCn": "注意哪两个音拍/助词", "tipCn": "细节提示", "teacherPrompt": "纯中文引导重点加句号。随后另起一句给纯日语示范句"},\n'
        '    {"stage": "TRANSFORM_DRILL", "stageLabel": "4. 口头变形反射", "hideTarget": true, "targetJp": "标准变形后日语整句(含常用汉字)", "targetCn": "中文目标意思", "cueCn": "给出原形/基础词，要求1秒口头变成今天的目标句型", "tipCn": "提示关键字", "teacherPrompt": "纯中文出题引导(不直接念出日语答案)"},\n'
        '    {"stage": "SUBSTITUTION_DRILL", "stageLabel": "5. 情景造句", "hideTarget": true, "targetJp": "标准日语表达(含常用汉字)", "targetCn": "中文情景需求", "cueCn": "真实生活情景（如和同事聊咖啡/周末），请直接用日语说出来", "tipCn": "提示重点词", "teacherPrompt": "纯中文情景出题(不剧透答案)"},\n'
        '    {"stage": "FREE_OUTPUT", "stageLabel": "6. 私教自由问答", "hideTarget": true, "questionJp": "老师用今天句型向学生提的1个真实日语问题(含常用汉字)", "questionCn": "问题中文意思", "targetJp": "一种自然参考答法（规范日语）", "targetCn": "参考答法中文", "cueCn": "请用自己的真实情况用日语回答老师提问，尽量用上今天学到的表达！", "tipCn": "可替换词汇提示", "teacherPrompt": "纯中文提示加句号。随后另起一句以纯日语发出提问"}\n'
        "  ]\n"
        "}"
    )

    models = list(AUTHOR_MODELS)
    return await _call_gemini_json(parts=[{"text": prompt}], models=models, api_key=api_key, temperature=0.6, timeout_sec=16.0)


def _normalize_authored_steps(raw_steps: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    normalized: List[Dict[str, Any]] = []
    for idx, st in enumerate(raw_steps):
        target_jp = strip_furigana_parens(st.get("targetJp") or "")
        question_jp = strip_furigana_parens(st.get("questionJp") or "")
        if not target_jp:
            continue
        stage = st.get("stage") or "CONTROLLED_DRILL"
        hide_target = bool(st.get("hideTarget", stage in ("TRANSFORM_DRILL", "SUBSTITUTION_DRILL", "FREE_OUTPUT")))
        prompt_raw = st.get("teacherPrompt") or ""
        normalized.append(
            {
                "stepIndex": idx,
                "stage": stage,
                "stageLabel": st.get("stageLabel") or f"{idx + 1}. 练习",
                "hideTarget": hide_target,
                "questionJp": question_jp,
                "questionCn": st.get("questionCn") or "",
                "questionTokens": tokenize_sentence(question_jp) if question_jp else [],
                "targetJp": target_jp,
                "targetDisplayJp": st.get("targetDisplayJp") or target_jp,
                "targetCn": st.get("targetCn") or "",
                "cueCn": st.get("cueCn") or "",
                "tipCn": st.get("tipCn") or "",
                "teacherPrompt": prompt_raw,
                "teacherPromptTts": prepare_tts_bilingual_script(prompt_raw, [target_jp, question_jp]),
                "tokens": tokenize_sentence(target_jp),
            }
        )
    return normalized


def _build_offline_syllabus_fallback(unit: Optional[Dict[str, Any]], custom_topic: str) -> Dict[str, Any]:
    if unit and unit.get("fallbackSteps"):
        return {
            "blackboard": unit.get("blackboard") or {},
            "steps": _normalize_authored_steps(unit["fallbackSteps"]),
        }
    title = custom_topic or (unit or {}).get("title") or "日常口语训练"
    focus = (unit or {}).get("grammarFocus") or custom_topic or "自然表达与音调控制"
    patterns = (unit or {}).get("keyPatterns") or ["〜んです", "〜てみます"]
    p0 = strip_furigana_parens(patterns[0])
    bb = (unit or {}).get("blackboard") or {
        "titleCn": title,
        "grammarPoint": focus,
        "formulaJp": " / ".join(patterns[:2]),
        "cnPitfallCn": (unit or {}).get("cnPitfall") or "注意日语助词、音拍节奏与高低音调。",
        "contrastBadJp": "",
        "contrastGoodJp": "",
        "contrastNoteCn": "",
    }
    raw_steps = [
        {
            "stage": "WARMUP",
            "stageLabel": "1. 热身唤醒",
            "hideTarget": False,
            "targetJp": "今日は いい 天気ですね。",
            "targetCn": "今天天气真好啊。",
            "cueCn": f"课前热身进入「{title}」：放慢半拍把每个音拍念饱满。",
            "tipCn": "い・い 两拍拉满。",
            "teacherPrompt": f"欢迎来到今天的「{title}」，先读一句轻松的热身，今日は いい 天気ですね。",
        },
        {
            "stage": "TEACH",
            "stageLabel": "2. 核心精讲",
            "hideTarget": False,
            "targetJp": f"実は、日本語を 勉強して いるんです。",
            "targetCn": "其实呢，我正在学日语。",
            "cueCn": f"重点语法：{focus}（代表表达：{p0}）",
            "tipCn": bb.get("cnPitfallCn", ""),
            "teacherPrompt": f"今天核心攻克 {p0}，听我先读一句示范，実は 日本語を 勉強しているんです。",
        },
        {
            "stage": "TRANSFORM_DRILL",
            "stageLabel": "3. 口头练习",
            "hideTarget": True,
            "targetJp": "週末に やってみます。",
            "targetCn": "周末我试着做做看。",
            "cueCn": f"结合主题「{title}」，用日语说一句完整句子（参考方向：{focus}）。",
            "tipCn": f"重点参考：{p0}",
            "teacherPrompt": f"试着自己组织一句跟「{title}」相关的日语，说给我听吧。",
        },
        {
            "stage": "FREE_OUTPUT",
            "stageLabel": "4. 私教问答",
            "hideTarget": True,
            "questionJp": "最近、何か 楽しい ことが ありましたか。",
            "questionCn": "最近有什么有趣的事情吗？",
            "targetJp": "はい、友だちと カフェで ゆっくり 話しました。",
            "targetCn": "有的，和朋友在咖啡馆悠闲地聊天了。",
            "cueCn": "用自己的话自然回答老师的提问。",
            "tipCn": "可以说工作、家人、散步或喝咖啡。",
            "teacherPrompt": "用日语聊聊看：最近、何か 楽しい ことが ありましたか。",
        },
    ]
    return {"blackboard": bb, "steps": _normalize_authored_steps(raw_steps)}


async def create_guided_lesson(
    user_id: str,
    scenario_id: str = "1",
    lesson_type: str = "guided_10min",
    jlpt_target: str = "N4",
    voice: str = DEFAULT_VOICE,
    curriculum_mode: str = "travel_scenario",
    lesson_id: Optional[str] = None,
    custom_topic: Optional[str] = None,
    defer_opening_tts: bool = True,
    coach_model: Optional[str] = None,
    include_review: bool = False,
    api_key: Optional[str] = None,
) -> Dict[str, Any]:
    """Create a Veteran Sensei textbook lesson (syllabus / custom topic) or travel scenario drill."""
    weaknesses = list_weaknesses(user_id, limit=3) if include_review else []
    due_cards = (list_cards(user_id, due_only=True, limit=4) or list_cards(user_id, due_only=False, limit=3)) if include_review else []
    due_snapshot = [{"surface": c["surface"], "meaning_cn": c.get("meaning_cn", "")} for c in due_cards]

    if curriculum_mode in ("sensei_syllabus", "custom_topic"):
        progress_map = list_lesson_progress(user_id)
        unit: Optional[Dict[str, Any]] = None
        if curriculum_mode == "sensei_syllabus":
            unit = get_syllabus_lesson(lesson_id)
            if not unit:
                overview = get_syllabus_overview(progress_map, jlpt_target=jlpt_target)
                rec = overview.get("recommendedLesson")
                unit = get_syllabus_lesson(rec["id"] if rec else "S01_mora_minimal_pairs")

        clean_custom = (custom_topic or "").strip()
        authored: Optional[Dict[str, Any]] = None
        if api_key:
            try:
                authored = await _author_textbook_lesson(
                    user_id=user_id,
                    curriculum_mode=curriculum_mode,
                    unit=unit,
                    custom_topic=clean_custom,
                    jlpt_target=jlpt_target,
                    weaknesses=weaknesses,
                    due_cards=due_cards,
                    coach_model=coach_model,
                    api_key=api_key,
                )
            except Exception as exc:
                print(f"[sensei] AI textbook authoring fallback: {exc}")
                authored = None

        if authored and authored.get("steps"):
            steps = _normalize_authored_steps(authored["steps"])
            blackboard = dict(authored.get("blackboard") or (unit or {}).get("blackboard") or {})
        else:
            fb = _build_offline_syllabus_fallback(unit, clean_custom)
            steps = fb["steps"]
            blackboard = dict(fb["blackboard"] or {})

        if blackboard.get("contrastBadJp"):
            blackboard["contrastBadTokens"] = tokenize_sentence(blackboard["contrastBadJp"])
        if blackboard.get("contrastGoodJp"):
            blackboard["contrastGoodTokens"] = tokenize_sentence(blackboard["contrastGoodJp"])

        resolved_lid = (unit or {}).get("id") if curriculum_mode == "sensei_syllabus" else f"custom_{uuid.uuid4().hex[:6]}"
        lesson_meta = {
            "curriculumMode": curriculum_mode,
            "lessonId": resolved_lid,
            "title": f"自选专题：{clean_custom}" if curriculum_mode == "custom_topic" else (unit or {}).get("title", "私教体系课"),
            "subtitle": "由东京私教总监结合你的薄弱项现场编写" if curriculum_mode == "custom_topic" else (unit or {}).get("subtitle", ""),
            "level": jlpt_target if curriculum_mode == "custom_topic" else (unit or {}).get("level", jlpt_target),
            "grammarFocus": clean_custom if curriculum_mode == "custom_topic" else (unit or {}).get("grammarFocus", ""),
            "blackboard": blackboard,
        }

        lesson_plan = {
            "curriculumMode": curriculum_mode,
            "lessonId": resolved_lid,
            "lessonMeta": lesson_meta,
            "jlptTarget": jlpt_target,
            "weaknessesSnapshot": weaknesses,
            "dueCardsSnapshot": due_snapshot,
            "steps": steps,
        }
        session_id = create_session(
            user_id=user_id,
            mode=curriculum_mode,
            scenario_id=resolved_lid or "sensei_lesson",
            persona=lesson_meta["title"],
            lesson_plan=lesson_plan,
        )

        opening_audio_url = ""
        if api_key and not defer_opening_tts and steps and (steps[0].get("teacherPromptTts") or steps[0].get("teacherPrompt")):
            try:
                tts = await synthesize_speech(
                    steps[0].get("teacherPromptTts") or steps[0]["teacherPrompt"],
                    api_key=api_key,
                    voice=voice,
                    model=TTS_FAST_MODEL,
                )
                opening_audio_url = tts["audio_url"]
            except Exception:
                opening_audio_url = ""

        return {
            "sessionId": session_id,
            "lessonMeta": lesson_meta,
            "scenario": {
                "id": resolved_lid,
                "title": lesson_meta["title"],
                "icon": "👩‍🏫",
                "summary": lesson_meta["subtitle"],
            },
            "weaknesses": weaknesses,
            "dueCards": due_snapshot,
            "steps": steps,
            "openingAudioUrl": opening_audio_url,
        }

    # Travel scenario mode (preserved cleanly)
    scenario = get_scenario(scenario_id)
    if not scenario:
        scenario = get_scenario("1") or get_scenario("daily_konbini")

    verbs = get_verbs(limit=60)
    grammar_list = get_grammar(jlpt_target if jlpt_target in ("N5", "N4", "N3") else None)

    phrases = list(scenario.get("phrases") or [])
    if len(phrases) > 3:
        phrases = random.sample(phrases, min(len(phrases), 4))
    p1 = phrases[0] if len(phrases) > 0 else {
        "jp": "こんにちは！アメリカのサンフランシスコの近（ちか）くから来（き）ました、劉（りゅう）と申（もう）します。",
        "cn": "您好！我是从美国旧金山附近来的，我姓刘。",
        "tip": "「〜と申します」比「〜です」更礼貌得体。",
    }
    p2 = phrases[1] if len(phrases) > 1 else {
        "jp": "荷物（にもつ）を預（あず）けてもいいですか。",
        "cn": "可以把行李寄存在这里吗？",
        "tip": "注意「預けて」的促音与重音位置。",
    }
    p3 = phrases[2] if len(phrases) > 2 else {
        "jp": "子（こ）どもが二人（ふたり）います。",
        "cn": "我们有两个孩子。",
        "tip": "「二人（ふたり）」特殊读音。",
    }

    steps: List[Dict[str, Any]] = []
    if due_cards:
        wcard = due_cards[0]
        warmup_target = wcard.get("context_jp") or wcard["surface"]
        warmup_cn = f"课前热身复习：{wcard['surface']}（{wcard.get('meaning_cn') or '重点词'}）"
        warmup_intro = (
            f"哈喽，我是你的日语私教老师。今天我们先花十秒热身，复习一下你记忆本里的「{wcard['surface']}」。"
            f"跟我一起读这句，{strip_furigana_parens(warmup_target)}"
        )
    elif weaknesses:
        wk = weaknesses[0]
        warmup_target = wk.get("example_jp") or strip_furigana_parens(p1["jp"])
        warmup_cn = f"课前针对性热身（上次高频纠错：{wk['pattern_key']}）：{p1.get('cn', '')}"
        warmup_intro = (
            f"欢迎回来！我记着你上次在「{wk['pattern_key']}」这里有点卡壳，今天咱们一开场就把它攻克！"
            f"先听一遍标准示范，{strip_furigana_parens(warmup_target)}"
        )
    else:
        warmup_target = strip_furigana_parens(p1["jp"])
        warmup_cn = p1.get("cn", "")
        warmup_intro = (
            f"こんにちは！欢迎来到今天的{scenario['title']}实战私教课。不用紧张，你开口说错也没关系，"
            f"我会帮你把声调和文法一句一句磨顺。我们先来热身第一句，{warmup_target}"
        )

    steps.append(
        {
            "stepIndex": 0,
            "stage": "WARMUP",
            "stageLabel": "1. 热身唤醒",
            "hideTarget": False,
            "targetJp": strip_furigana_parens(warmup_target),
            "targetDisplayJp": warmup_target,
            "targetCn": warmup_cn,
            "cueCn": "先听老师带读，再用正常语速完整复述一遍（注意促音与句尾ます/です）。",
            "tipCn": p1.get("tip") or "开场第一拍不要抢快，把每个假名饱满读出来。",
            "teacherPrompt": warmup_intro,
            "tokens": tokenize_sentence(warmup_target),
        }
    )

    if lesson_type != "substitution_drill":
        g_item = grammar_list[0] if grammar_list else {
            "pattern": "〜てもいいですか",
            "meaning": "请求允许（可以……吗）",
            "tip": "动词て形后接もいいですか，旅行酒店/餐厅高频使用。",
        }
        s1_target = strip_furigana_parens(p1["jp"])
        steps.append(
            {
                "stepIndex": 1,
                "stage": "TEACH",
                "stageLabel": "2. 核心微课",
                "hideTarget": False,
                "targetJp": s1_target,
                "targetDisplayJp": p1["jp"],
                "targetCn": p1.get("cn", ""),
                "cueCn": f"核心句型：{g_item.get('pattern')} —— {g_item.get('meaning')}",
                "tipCn": p1.get("tip") or g_item.get("tip", ""),
                "teacherPrompt": (
                    f"这一步我们重点打磨「{scenario['title']}」的黄金开场句。注意每个词的高低音转折。"
                    f"来，请试着自己说一次，{s1_target}"
                ),
                "tokens": tokenize_sentence(s1_target),
            }
        )

        s2_target = strip_furigana_parens(p2["jp"])
        steps.append(
            {
                "stepIndex": 2,
                "stage": "SHADOW_DRILL",
                "stageLabel": "3. 声学镜子纠音",
                "hideTarget": False,
                "targetJp": s2_target,
                "targetDisplayJp": p2["jp"],
                "targetCn": p2.get("cn", ""),
                "cueCn": "精听细节：长音、促音「っ」与清浊音必须拉开差距，老师会逐拍严格把关。",
                "tipCn": p2.get("tip") or "如果卡住，系统会自动把你读错的词块拆出来带你单练。",
                "teacherPrompt": f"现在进入严格纠音环节。认真听这一句的节奏，{s2_target}",
                "tokens": tokenize_sentence(s2_target),
            }
        )

        s3_target = strip_furigana_parens(p3["jp"])
        steps.append(
            {
                "stepIndex": 3,
                "stage": "SHADOW_DRILL",
                "stageLabel": "4. 场景连读实战",
                "hideTarget": False,
                "targetJp": s3_target,
                "targetDisplayJp": p3["jp"],
                "targetCn": p3.get("cn", ""),
                "cueCn": "模拟现场对答语速，一次性流畅表达完整意思。",
                "tipCn": p3.get("tip") or "保持句末语调自然收尾。",
                "teacherPrompt": f"很好！我们再练一句现场高频表达，试着直接说给我听，{s3_target}",
                "tokens": tokenize_sentence(s3_target),
            }
        )

    drill_offset = len(steps)
    dynamic_verb = verbs[(len(weaknesses) + len(due_cards)) % len(verbs)] if verbs else None
    sub_list = list(SUBSTITUTION_TEMPLATES[:2])
    if dynamic_verb and dynamic_verb.get("forms", {}).get("masu"):
        masu_jp = dynamic_verb["forms"]["masu"].get("jp") or dynamic_verb["jp"]
        sub_list.append(
            {
                "pattern": f"高频动词礼貌活用（{dynamic_verb['dict']} · {dynamic_verb['cn']}）",
                "slot_note": "请直接说出「可以……吗 / 请……」的完整礼貌句",
                "cue_cn": f"用动词「{dynamic_verb['dict']}（{dynamic_verb['cn']}）」说一句礼貌请求（例如：{masu_jp} / 〜ていただけますか）",
                "target_jp": f"すみません、{dynamic_verb.get('forms', {}).get('te', {}).get('jp', masu_jp)}もいいですか。",
                "target_reading": f"すみません、{dynamic_verb.get('forms', {}).get('te', {}).get('kana', '')}もいいですか。",
                "hint_jp": f"{dynamic_verb['dict']} → て形：{dynamic_verb.get('forms', {}).get('te', {}).get('jp', '')}",
            }
        )

    for idx, sub in enumerate(sub_list):
        s_idx = drill_offset + idx
        steps.append(
            {
                "stepIndex": s_idx,
                "stage": "SUBSTITUTION_DRILL",
                "stageLabel": f"{s_idx + 1}. 口头替换操练",
                "hideTarget": True,
                "targetJp": sub["target_jp"],
                "targetDisplayJp": sub["target_jp"],
                "targetCn": sub["cue_cn"],
                "cueCn": f"句型：{sub['pattern']}（{sub['slot_note']}）→ 请口头造句：{sub['cue_cn']}",
                "tipCn": f"提示：{sub['hint_jp']}",
                "teacherPrompt": f"来挑战一下口头替换反应！不要看答案，请直接用日语对我说，{sub['cue_cn']}",
                "tokens": tokenize_sentence(sub["target_jp"]),
            }
        )

    for st in steps:
        st["teacherPromptTts"] = prepare_tts_bilingual_script(st.get("teacherPrompt") or "", [st.get("targetJp") or ""])

    lesson_meta = {
        "curriculumMode": "travel_scenario",
        "lessonId": "",
        "title": scenario["title"],
        "subtitle": scenario.get("summary", ""),
        "level": jlpt_target,
        "grammarFocus": "",
        "blackboard": None,
    }
    lesson_plan = {
        "scenarioId": scenario["id"],
        "scenarioTitle": scenario["title"],
        "lessonType": lesson_type,
        "jlptTarget": jlpt_target,
        "weaknessesSnapshot": weaknesses,
        "dueCardsSnapshot": due_snapshot,
        "steps": steps,
    }

    session_id = create_session(
        user_id=user_id,
        mode=lesson_type,
        scenario_id=scenario["id"],
        persona=scenario.get("persona", ""),
        lesson_plan=lesson_plan,
    )

    opening_audio_url = ""
    if api_key and not defer_opening_tts and steps:
        try:
            tts = await synthesize_speech(
                steps[0].get("teacherPromptTts") or steps[0]["teacherPrompt"],
                api_key=api_key,
                voice=voice,
                model=TTS_FAST_MODEL,
            )
            opening_audio_url = tts["audio_url"]
        except Exception:
            opening_audio_url = ""

    return {
        "sessionId": session_id,
        "lessonMeta": lesson_meta,
        "scenario": {
            "id": scenario["id"],
            "title": scenario["title"],
            "icon": scenario.get("icon", "🗾"),
            "summary": scenario.get("summary", ""),
        },
        "weaknesses": weaknesses,
        "dueCards": due_snapshot,
        "steps": steps,
        "openingAudioUrl": opening_audio_url,
    }


async def evaluate_sensei_turn(
    *,
    session_id: str,
    user_id: str,
    step_index: int,
    stage: str,
    target_jp: str,
    target_cn: str = "",
    cue_cn: str = "",
    attempt: int = 1,
    drill_chunk_jp: str = "",
    audio_bytes: bytes,
    audio_filename: str = "recording.webm",
    content_type: str = "audio/webm",
    voice: str = DEFAULT_VOICE,
    coach_model: Optional[str] = None,
    defer_tts: bool = True,
    lesson_id: Optional[str] = None,
    grammar_focus: str = "",
    question_jp: str = "",
    api_key: str,
) -> Dict[str, Any]:
    """Evaluate student audio with Gemini 4 Hydrogen/selected coach + Repeat-Until-Good state machine."""
    t0 = time.perf_counter()
    norm_bytes, audio_mime, audio_ext = normalize_gemini_audio(
        audio_bytes, filename=audio_filename, content_type=content_type
    )
    turn_id = f"turn_{uuid.uuid4().hex[:12]}"
    turn_audio_path = TURN_AUDIO_DIR / f"{turn_id}.{audio_ext}"
    turn_audio_path.write_bytes(norm_bytes)
    user_audio_url = f"/api/audio/turn/{turn_id}.{audio_ext}"

    clean_target = strip_furigana_parens(target_jp)
    active_target = strip_furigana_parens(drill_chunk_jp) if drill_chunk_jp else clean_target

    if stage == "FREE_OUTPUT":
        stage_rule = (
            f"1. 这是【自由问答】环节。老师刚才问：{question_jp or cue_cn or target_cn}。本课焦点：{grammar_focus or '自然得体'}。"
            f"学生可以用自己的话回答，不需要跟参考答案一模一样！只要答对问题语义、语法基本正确、尽量用上本课语法且发音清晰，就应判>=85分通过；并在 betterJp 给出更地道的东京润色。\n"
        )
        pass_threshold = 85
    elif stage in ("TRANSFORM_DRILL", "SUBSTITUTION_DRILL"):
        stage_rule = (
            f"1. 这是【口头变形/情景造句】环节。语法焦点：{grammar_focus or cue_cn}。"
            "只要学生日语语法正确、达成目标表达（即使换了等效礼貌词或同义词汇）且发音清晰即判>=88分通过。\n"
        )
        pass_threshold = 88
    else:
        stage_rule = (
            "1. 真实听出促音っ、长音ー、清浊音、高低音调(アクセント)、ら/つ/ん与句尾ます/です；出现明显吞音/平读/助词错时总分<85；\n"
        )
        pass_threshold = 88

    prompt = (
        "你是严格但温暖的东京母语级日语私教（中文教学），听学生录音做精准音调与语法纠音。\n"
        f"阶段:{stage} | 第{attempt}次 | 参考目标:{clean_target} | 本轮片段:{active_target} | 语义:{cue_cn or target_cn}\n"
        "规则：\n"
        f"{stage_rule}"
        f"2. heardJp、betterJp、drillChunkJp 使用规范日语汉字与假名（如「予約」「新しい料理」），界面会自动标假名。\n"
        f"3. 先输出 teacherSpokenScript（20–50字）：前半句用纯中文点评（指代某词用中文意思或「这个词/前半句」，不要在中文句中夹日语词），句号收尾；后半句另起一句给纯日语示范（如「发音很清晰，预约这个词音调偏平，跟我读一遍。予約。」）。禁英文/罗马音/星号/括号/箭头；若总分>={pass_threshold}且无严重问题，issues/drillChunkJp/grammarNote 留空以提速。\n"
        "返回精简JSON（每条说明25字内，issues<=2，extractedVocab<=2）：\n"
        '{"teacherSpokenScript":"纯中日口语台词","overallScore":0,"pitchScore":0,"grammarScore":0,"rhythmScore":0,'
        '"heardJp":"如实听写","betterJp":"地道目标句","drillChunkJp":"需单练词块(过关留空)",'
        '"drillChunkReading":"如 ちか↓く(勿用反斜杠)","pitchNote":"音调简评","grammarNote":"语法简评","praiseCn":"亮点",'
        '"issues":[{"type":"pitch|sokuon|long_vowel|voicing|consonant|ending|particle|grammar","severity":"critical|minor","patternKey":"短标签","detailCn":"原因"}],'
        '"extractedVocab":[{"surface":"","lemma":"","reading":"","pitchAccent":"","meaningCn":"","jlpt":"N4"}]}'
    )

    audio_b64 = base64.b64encode(norm_bytes).decode("ascii")
    parts = [
        {"text": prompt},
        {"inlineData": {"mimeType": audio_mime, "data": audio_b64}},
    ]
    chosen_model = (coach_model or "").strip()
    if chosen_model not in _ALLOWED_COACH_MODELS:
        chosen_model = COACH_MODEL
    models = [chosen_model] + [m for m in [COACH_MODEL, *COACH_FALLBACK_MODELS] if m != chosen_model]

    prewarmed_scripts: set[str] = set()
    known_jp_hints = [clean_target, active_target, question_jp]

    def _on_script_ready(script_text: str) -> None:
        if not defer_tts or not api_key or not script_text:
            return
        cleaned = prepare_tts_bilingual_script(script_text, known_jp_hints)
        if cleaned and cleaned not in prewarmed_scripts:
            prewarmed_scripts.add(cleaned)
            try:
                prewarm_tts_stream(cleaned, api_key=api_key, voice=voice, model=TTS_FAST_MODEL)
            except Exception:
                pass

    eval_data = await _call_gemini_json(
        parts=parts,
        models=models,
        api_key=api_key,
        temperature=0.15,
        timeout_sec=10.5,
        per_model_timeouts={
            "gemini-4-hydrogen": 10.5,
            "gemini-3-flash-preview": 11.5,
            "gemini-3.5-flash-lite": 9.0,
            "gemini-4-neon": 12.0,
            "gemini-4-argon": 12.0,
        },
        on_script_ready=_on_script_ready if defer_tts else None,
        hedge_after_sec=6.5 if (chosen_model == "gemini-4-hydrogen" and len(models) >= 2) else None,
    )

    overall_score = int(max(0, min(100, eval_data.get("overallScore", 70))))
    issues = eval_data.get("issues") or []
    drill_chunk = (eval_data.get("drillChunkJp") or "").strip()
    decision = compute_repeat_decision(
        overall_score=overall_score,
        issues=issues,
        attempt=attempt,
        drill_chunk_jp=drill_chunk,
        target_jp=active_target,
        pass_threshold=pass_threshold,
    )

    teacher_script = (eval_data.get("teacherSpokenScript") or "").strip()
    if not teacher_script:
        if decision == "pass":
            teacher_script = f"太棒了，这一句音调和节奏都很稳！{jp_to_kana(clean_target)}"
        elif drill_chunk:
            chunk_kana = jp_to_kana(drill_chunk)
            teacher_script = f"刚才这个词还差一点点，听我示范。{chunk_kana}。来，跟我单独读一遍。{chunk_kana}"
        else:
            teacher_script = f"我们再来顺一遍节奏，听我示范。{jp_to_kana(active_target)} 准备好再读一次。"

    if decision == "advance" and attempt >= 3 and overall_score < 88:
        teacher_script = (
            f"这几次已经明显比第一遍清楚多啦，刚才的问题我先帮你记在记忆本里。听一遍正确示范。{jp_to_kana(clean_target)} 我们先继续下一步。"
        )

    teacher_spoken_tts = prepare_tts_bilingual_script(
        teacher_script,
        [*known_jp_hints, eval_data.get("betterJp") or "", drill_chunk],
    )

    teacher_audio_url = ""
    if not defer_tts:
        tts_result = await synthesize_speech(
            teacher_spoken_tts or teacher_script,
            api_key=api_key,
            voice=voice,
            model=TTS_FAST_MODEL,
        )
        teacher_audio_url = tts_result["audio_url"]
    elif teacher_spoken_tts and teacher_spoken_tts not in prewarmed_scripts and getattr(_call_gemini_json, "__module__", "") == __name__:
        _on_script_ready(teacher_spoken_tts)

    # Record recurring weaknesses when issues exist
    if overall_score < 88:
        for it in issues[:3]:
            upsert_weakness(
                user_id=user_id,
                issue_type=it.get("type") or "pronunciation",
                pattern_key=it.get("patternKey") or drill_chunk or clean_target[:16],
                example_jp=clean_target,
                note_cn=it.get("detailCn") or eval_data.get("pitchNote") or "",
            )

    better_jp = strip_furigana_parens(eval_data.get("betterJp") or "") or clean_target
    target_tokens = tokenize_sentence(clean_target)
    better_tokens = tokenize_sentence(better_jp)
    heard_tokens = tokenize_sentence(eval_data.get("heardJp") or "")
    drill_chunk_tokens = tokenize_sentence(drill_chunk) if drill_chunk else []
    eval_ms = int((time.perf_counter() - t0) * 1000)

    response_payload = {
        "turnId": turn_id,
        "sessionId": session_id,
        "stepIndex": step_index,
        "stage": stage,
        "attempt": attempt,
        "decision": decision,
        "overallScore": overall_score,
        "pitchScore": int(eval_data.get("pitchScore", overall_score)),
        "grammarScore": int(eval_data.get("grammarScore", overall_score)),
        "rhythmScore": int(eval_data.get("rhythmScore", overall_score)),
        "heardJp": eval_data.get("heardJp") or "",
        "betterJp": better_jp,
        "betterTokens": better_tokens,
        "targetJp": clean_target,
        "drillChunkJp": drill_chunk,
        "drillChunkTokens": drill_chunk_tokens,
        "drillChunkReading": eval_data.get("drillChunkReading") or "",
        "pitchNote": eval_data.get("pitchNote") or "",
        "grammarNote": eval_data.get("grammarNote") or "",
        "praiseCn": eval_data.get("praiseCn") or "",
        "issues": issues,
        "teacherSpokenScript": teacher_script,
        "teacherSpokenTts": teacher_spoken_tts,
        "teacherAudioUrl": teacher_audio_url,
        "userAudioUrl": user_audio_url,
        "extractedVocab": eval_data.get("extractedVocab") or [],
        "targetTokens": target_tokens,
        "heardTokens": heard_tokens,
        "modelUsed": eval_data.get("_modelUsed", chosen_model),
        "evalMs": eval_ms,
    }

    add_turn(
        session_id=session_id,
        turn_index=step_index * 10 + attempt,
        speaker="student",
        stage=stage,
        target_jp=clean_target,
        transcript_jp=eval_data.get("heardJp") or "",
        tokens=heard_tokens,
        correction=response_payload,
        audio_path=str(turn_audio_path),
        teacher_audio_url=teacher_audio_url,
        turn_id=turn_id,
    )

    if lesson_id:
        is_lesson_done = step_index >= 5 and decision in ("pass", "advance")
        upsert_lesson_progress(user_id=user_id, lesson_id=lesson_id, score=overall_score, completed=is_lesson_done)

    return response_payload


async def evaluate_live_turn(
    *,
    user_id: str,
    audio_wav_bytes: Optional[bytes],
    transcript_user: str,
    last_ai_jp: str,
    scenario_title: str,
    api_key: str,
) -> Dict[str, Any]:
    """Track-2 asynchronous evaluation for Live Voice Call turns."""
    prompt = (
        "你是日语私教双轨助教，正在实时旁听学生的日语通话并生成简洁气泡纠错卡片。\n"
        f"当前场景: {scenario_title}\n"
        f"上一句 AI 说的日语: {last_ai_jp}\n"
        f"本轮用户语音转写: {transcript_user or '（参考音频）'}\n\n"
        "请基于音频和上下文快速评估：发音声调、助词语法、敬语得体度。返回严格 JSON：\n"
        "{\n"
        '  "score": 88,\n'
        '  "isNatural": true,\n'
        '  "heardJp": "精准还原用户说出的日语或中英夹杂句",\n'
        '  "naturalJp": "更像东京当地人的自然说法（若原句已很地道则与原句一致）",\n'
        '  "naturalReading": "naturalJp 的平假名",\n'
        '  "pitchTip": "最关键的一处发音/高低音提示（若无填无）",\n'
        '  "grammarTip": "助词/活用/敬语微调建议（不超过35字中文）",\n'
        '  "issueType": "none|pitch|particle|keigo|sokuon|vocab",\n'
        '  "patternKey": "若需记入错题本写短标签如 は/が混淆；否则空字符串",\n'
        '  "extractedVocab": [{"surface": "", "lemma": "", "reading": "", "meaningCn": "", "jlpt": "N4"}]\n'
        "}"
    )

    parts: List[Dict[str, Any]] = [{"text": prompt}]
    if audio_wav_bytes and len(audio_wav_bytes) > 800:
        parts.append(
            {
                "inlineData": {
                    "mimeType": "audio/wav",
                    "data": base64.b64encode(audio_wav_bytes).decode("ascii"),
                }
            }
        )

    models = [COACH_MODEL] + [m for m in COACH_FALLBACK_MODELS if m != COACH_MODEL]
    data = await _call_gemini_json(parts=parts, models=models, api_key=api_key, temperature=0.15, timeout_sec=30.0)

    if data.get("patternKey") and data.get("issueType") not in ("", "none", None):
        upsert_weakness(
            user_id=user_id,
            issue_type=data.get("issueType", "grammar"),
            pattern_key=data["patternKey"],
            example_jp=data.get("naturalJp") or transcript_user,
            note_cn=data.get("grammarTip") or data.get("pitchTip") or "",
        )
    return data


async def generate_live_hints(
    *,
    last_ai_jp: str,
    scenario_title: str,
    jlpt_target: str,
    api_key: str,
) -> List[Dict[str, str]]:
    """Generate 2 instant Japanese reply hints when student taps '帮我接话' during a call."""
    prompt = (
        f"学生在「{scenario_title}」日语实时对话中卡壳了。对方刚说：\n「{last_ai_jp or 'こんにちは！何かお手伝いできますか？'}」\n"
        f"学生目标水平 {jlpt_target}，请立刻提供 2 句简短实用、不同态度的接话参考，返回严格 JSON：\n"
        '{"hints": [{"jp": "纯日语", "reading": "纯平假名", "cn": "中文意思与语气说明"}]}'
    )
    models = [COACH_MODEL] + [m for m in COACH_FALLBACK_MODELS if m != COACH_MODEL]
    res = await _call_gemini_json(parts=[{"text": prompt}], models=models, api_key=api_key, temperature=0.3, timeout_sec=15.0)
    return (res.get("hints") or [])[:3]


async def generate_session_report(
    session_id: str,
    user_id: str,
    api_key: str,
    duration_sec: int = 0,
) -> Dict[str, Any]:
    """Summarize all turns of a lesson or live call using Gemini 4 Neon."""
    turns = list_session_turns(session_id)
    summary_lines = []
    for t in turns:
        corr = t.get("correction") or {}
        summary_lines.append(
            f"[{t['speaker']}] jp={t.get('transcript_jp') or t.get('target_jp')} "
            f"score={corr.get('overallScore', corr.get('score', '-'))} "
            f"note={corr.get('pitchNote', corr.get('grammarTip', ''))}"
        )

    transcript_block = "\n".join(summary_lines[-24:]) or "本场会话尚无完整口语轮次。"
    prompt = (
        "请作为日语教学总监，为下面这场刚结束的 1 对 1 日语训练生成课后深度战报（严格 JSON）：\n"
        f"会话记录：\n{transcript_block}\n\n"
        "JSON Schema:\n"
        "{\n"
        '  "fluencyScore": 85,\n'
        '  "pitchScore": 82,\n'
        '  "keigoScore": 86,\n'
        '  "grammarScore": 84,\n'
        '  "summaryCn": "2句鼓励且有干货的整体点评",\n'
        '  "praiseHighlights": ["表现亮点1", "表现亮点2"],\n'
        '  "topMistakes": [{"patternKey": "如 助词は/が", "detailCn": "错因与下回注意", "betterJp": "正确例句"}],\n'
        '  "nextFocusCn": "明天10分钟私教课建议主攻方向"\n'
        "}"
    )

    models = [REPORT_MODEL] + [m for m in REPORT_FALLBACK_MODELS if m != REPORT_MODEL]
    report = await _call_gemini_json(parts=[{"text": prompt}], models=models, api_key=api_key, temperature=0.25)

    for m in (report.get("topMistakes") or [])[:3]:
        if m.get("patternKey"):
            upsert_weakness(
                user_id=user_id,
                issue_type="session_report",
                pattern_key=m["patternKey"],
                example_jp=m.get("betterJp") or "",
                note_cn=m.get("detailCn") or "",
            )

    finish_session(session_id=session_id, duration_sec=duration_sec, report=report)
    return report
