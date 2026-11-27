"""Guided 10-min Sensei Lesson Planner, Audio Mirror Evaluator, Live Sidecar & Report Generator."""

from __future__ import annotations

import asyncio
import base64
import difflib
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
    get_recent_step_turns,
    get_session,
    list_favorite_sentences,
    list_lesson_progress,
    list_session_turns,
    list_weaknesses,
    record_favorite_practice,
    record_weakness_improvement,
    upsert_lesson_progress,
    upsert_weakness,
)
from server.services.audio_utils import (
    analyze_audio_speech_activity,
    boost_quiet_audio_for_gemini,
    format_acoustic_summary_for_prompt,
    normalize_gemini_audio,
)
from server.services.curriculum_loader import get_grammar, get_grammar_point, get_scenario, get_verbs
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
_HANGUL_RE = re.compile(r"[\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F]+")
_GENERIC_CN_OVERLAP = {
    "今天", "昨天", "明天", "现在", "时间", "问题", "朋友", "咖啡", "工作",
    "天气", "声音", "练习", "注意", "自己", "意思", "中文", "日语", "日本",
    "中国", "周末", "酒店", "机场", "餐厅", "小时", "时候", "公司", "家庭",
}


def strip_foreign_hangul(text: str, *, trim: bool = True) -> str:
    """Remove hallucinated Korean Hangul blocks emitted by multimodal fallback models."""
    if not text:
        return ""
    cleaned = _HANGUL_RE.sub("", text)
    cleaned = re.sub(r"[ \t]{2,}", " ", cleaned)
    return cleaned.strip() if trim else cleaned


def _sanitize_no_hangul(value: Any) -> Any:
    """Recursively strip Korean Hangul characters from strings inside JSON payloads."""
    if isinstance(value, str):
        return strip_foreign_hangul(value)
    if isinstance(value, list):
        return [_sanitize_no_hangul(item) for item in value]
    if isinstance(value, dict):
        return {k: _sanitize_no_hangul(v) for k, v in value.items()}
    return value


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


_PUNCT_STRIP_RE = re.compile(r"[\s。、！？!?.,・「」『』（）()]+")


def compute_token_diff(
    heard_tokens: List[Dict[str, Any]],
    target_tokens: List[Dict[str, Any]],
) -> Dict[str, Any]:
    """Compute token-level red-pen alignment between student's heard words and target words."""
    def _prep(tokens: List[Dict[str, Any]]) -> tuple[List[Dict[str, Any]], List[str], List[int]]:
        copied: List[Dict[str, Any]] = []
        keys: List[str] = []
        idx_map: List[int] = []
        for idx, tok in enumerate(tokens or []):
            t = dict(tok)
            surf = str(t.get("surface") or "")
            norm = _PUNCT_STRIP_RE.sub("", surf).strip()
            if not norm:
                t["status"] = "punct"
                copied.append(t)
                continue
            key = (t.get("reading") or norm).strip()
            t["status"] = "match"
            copied.append(t)
            keys.append(key)
            idx_map.append(idx)
        return copied, keys, idx_map

    h_out, h_keys, h_map = _prep(heard_tokens)
    t_out, t_keys, t_map = _prep(target_tokens)

    if not h_keys and not t_keys:
        return {"heardDiff": h_out, "targetDiff": t_out, "matchRatio": 1.0}
    if not h_keys or not t_keys:
        for i in h_map:
            h_out[i]["status"] = "extra"
        for j in t_map:
            t_out[j]["status"] = "missing"
        return {"heardDiff": h_out, "targetDiff": t_out, "matchRatio": 0.0}

    matcher = difflib.SequenceMatcher(None, h_keys, t_keys)
    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag == "equal":
            for i in range(i1, i2):
                h_out[h_map[i]]["status"] = "match"
            for j in range(j1, j2):
                t_out[t_map[j]]["status"] = "match"
        elif tag == "replace":
            for i in range(i1, i2):
                h_out[h_map[i]]["status"] = "sub"
            for j in range(j1, j2):
                t_out[t_map[j]]["status"] = "sub"
        elif tag == "delete":
            for i in range(i1, i2):
                h_out[h_map[i]]["status"] = "extra"
        elif tag == "insert":
            for j in range(j1, j2):
                t_out[t_map[j]]["status"] = "missing"

    return {
        "heardDiff": h_out,
        "targetDiff": t_out,
        "matchRatio": round(matcher.ratio(), 2),
    }


def compute_repeat_decision(
    overall_score: int,
    issues: List[Dict[str, Any]],
    attempt: int,
    drill_chunk_jp: str,
    target_jp: str,
    pass_threshold: int = 88,
    was_chunk_drill: bool = False,
) -> str:
    """Deterministic Repeat-Until-Good + Chunk-to-Full Consolidation transition rule."""
    has_critical = any((it.get("severity") == "critical") for it in (issues or []))
    if overall_score >= pass_threshold and not has_critical:
        if was_chunk_drill and attempt < 3:
            return "consolidate_full"
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
    thinking_level: str = "LOW",
) -> Dict[str, Any]:
    gen_cfg: Dict[str, Any] = {
        "temperature": temperature,
        "responseMimeType": "application/json",
        "thinkingConfig": {"thinkingLevel": thinking_level},
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
    grammar_point: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Use a Veteran Tokyo Sensei prompt to author a flexible-length Japanese lesson."""
    if curriculum_mode == "grammar_point" and grammar_point:
        topic_title = f"{grammar_point.get('pattern', '')}（{grammar_point.get('meaning', '')}）"
        grammar_focus = f"{grammar_point.get('pattern', '')} | {grammar_point.get('formation', '')}"
        cn_pitfall = grammar_point.get("tip") or grammar_point.get("explanation") or "注意接续规则、助词搭配与语境区分。"
        key_patterns = grammar_point.get("pattern") or ""
        ref_examples = [
            f"{strip_furigana_parens(ex.get('jp') or '')}（{ex.get('cn') or ''}）"
            for ex in (grammar_point.get("examples") or [])[:3]
            if ex.get("jp")
        ]
        grammar_block = (
            "【指定精讲语法库知识点（必须围绕此知识点深度展开）】\n"
            f"- 句型：{grammar_point.get('pattern', '')}（{grammar_point.get('level', jlpt_target)}）\n"
            f"- 读音/拼读：{grammar_point.get('reading', '')}\n"
            f"- 核心释义：{grammar_point.get('meaning', '')}\n"
            f"- 接续规则：{grammar_point.get('formation', '')}\n"
            f"- 精讲要点：{grammar_point.get('explanation', '')}\n"
            f"- 避坑/区分贴士：{grammar_point.get('tip', '')}\n"
            f"- 语法库参考例句（可作启发，也请拓展更多日常/家庭鲜活例句）：{'; '.join(ref_examples) or '围绕主题原创'}\n\n"
        )
        pacing_hint = (
            "请像真正的 1 对 1 日语老师那样把这一条语法完全教透（不必凑固定时间，依据内容深度自主决定 6–12 步）：\n"
            "1) 概念破冰 + 接续规则拆解（WARMUP / TEACH）；\n"
            "2) 多角度用法对照（肯定/否定/委婉或近义区分 + 中文易错反例，TEACH / CONTROLLED_DRILL）；\n"
            "3) 1–2 步口头接续变形反射（TRANSFORM_DRILL，给出词干让学员 1 秒脱口变形）；\n"
            "4) 1–2 步家庭/生活情景造句（SUBSTITUTION_DRILL）；\n"
            "5) 1–2 步私教真实自由问答（FREE_OUTPUT）。\n"
        )
    else:
        topic_title = custom_topic if curriculum_mode == "custom_topic" else (unit or {}).get("title", "日常口语进阶")
        grammar_focus = custom_topic if curriculum_mode == "custom_topic" else (unit or {}).get("grammarFocus", "")
        cn_pitfall = (unit or {}).get("cnPitfall", "避免中文语序与中式直译，突出日语助词与自然语调。")
        key_patterns = ", ".join((unit or {}).get("keyPatterns") or [])
        textbook_parts: List[str] = []
        if unit:
            if unit.get("canDoCn"):
                textbook_parts.append(f"- Can-Do 教学目标：{unit['canDoCn']}")
            vocab_items = unit.get("vocabList") or []
            if vocab_items:
                v_str = "、".join(f"{v.get('jp', '')}({v.get('reading', '')}:{v.get('cn', '')})" for v in vocab_items[:8])
                textbook_parts.append(f"- 本课核心生词：{v_str}")
            g_notes = unit.get("grammarNotes") or []
            if g_notes:
                g_str = " | ".join(
                    f"{g.get('pattern', '')} [{g.get('formation', '')}] 例:{strip_furigana_parens(g.get('exampleJp') or '')}"
                    for g in g_notes
                )
                textbook_parts.append(f"- 本课核心文法：{g_str}")
            dlg_turns = (unit.get("dialogue") or {}).get("turns") or []
            if dlg_turns:
                d_str = " / ".join(f"{t.get('speaker', '')}:{strip_furigana_parens(t.get('jp') or '')}" for t in dlg_turns[:4])
                textbook_parts.append(f"- 教材示范对话：{d_str}")
            rp = unit.get("readingPassage") or {}
            if rp.get("jp"):
                textbook_parts.append(f"- 精读短文《{rp.get('title', '')}》：{rp['jp']}")
        grammar_block = (
            "【本课标准教材正文（请紧扣生词、文法公式、示范对话与精读短文编写带练）】\n" + "\n".join(textbook_parts) + "\n\n"
            if textbook_parts
            else ""
        )
        pacing_hint = (
            "请根据本课知识密度与实战需求自主决定步骤数量（建议 7–12 步，不设 10 分钟限制），"
            "自然涵盖：热身唤醒(WARMUP) → 核心文法精讲(TEACH) → 节奏镜子跟读(CONTROLLED_DRILL) → 1–2 步口头变形反射(TRANSFORM_DRILL) → "
            "1–2 步情景造句(SUBSTITUTION_DRILL) → 1–2 步私教自由问答(FREE_OUTPUT)。\n"
        )

    effective_level = (grammar_point or {}).get("level") or (unit or {}).get("level") or jlpt_target or "N4"
    effective_level_up = effective_level.upper()
    if effective_level_up == "N3":
        level_calibration = (
            "【JLPT N3 中级难度校准（严禁降级成简单 N5 短句）】\n"
            "- 目标句必须使用真正 N3 级别复句与中级词汇（如 ことにする/なる、うちに/最中に、にとって/によって、てくる/ていく、ほど/しか、べき/ばよかった、わりには/といえば、ております/させていただく 等）。\n"
            "- 至少设计 2 步 TRANSFORM_DRILL，给出简短 N5 表达要求学生口头改造成更地道、有逻辑张力的 N3 长句。\n"
            "- FREE_OUTPUT 提问应贴近工作/育儿/长途旅行思辨，鼓励学生回答 2–3 句完整段落（8–12 步为佳）。\n"
        )
    elif effective_level_up == "N4":
        level_calibration = (
            "【JLPT N4 进阶难度校准】\n"
            "- 目标句至少包含 2 个自然从句组合（如 〜ので、〜たら、〜のに、〜てみる、〜ておく、授受 〜てくれる/もらう、被动/使役等），贴合生活与家庭对话（7–10 步为佳）。\n"
        )
    else:
        level_calibration = (
            "【JLPT N5 地基难度校准】\n"
            "- 句型清晰实用、拍节饱满、助词精准，帮助稳扎稳打建立口腔肌肉反射（6–8 步为佳）。\n"
        )

    fresh_pair = random.sample(_VARIED_DAILY_SCENES, 2)
    base_contexts = (unit or {}).get("everydayContexts") or ["咖啡馆日常", "朋友聊天", "职场茶水间", "家庭周末生活"]
    contexts = ", ".join(list(dict.fromkeys([*fresh_pair, *base_contexts]))[:4])

    weakness_str = ", ".join(w["pattern_key"] for w in weaknesses) or "暂无（本课聚焦新知识，无需旧错题热身）"
    due_str = ", ".join(f"{c['surface']}({c.get('meaning_cn', '')})" for c in due_cards) or "暂无（本课全部采用全新生活词汇）"

    prompt = (
        "你是一位拥有20年教龄、专精教授中国成年人日语的资深东京私教总监。\n"
        "请为学生原创编写一堂完整、鲜活、地道东京生活/工作/家庭向的「深度私教口语教材」（不限 10 分钟，教透为止）。\n\n"
        f"{grammar_block}"
        f"课程主题: {topic_title}\n"
        f"核心语法与音调焦点: {grammar_focus}\n"
        f"目标句型参考: {key_patterns or '围绕主题自然精选'}\n"
        f"中国学习者常见母语负迁移陷阱: {cn_pitfall}\n"
        f"建议生活语境: {contexts}\n"
        f"目标等级: {effective_level_up}\n"
        f"学生历史薄弱点: {weakness_str}\n"
        f"记忆本待复习生词（若自然顺畅可嵌入1个）: {due_str}\n\n"
        f"{level_calibration}\n"
        f"{pacing_hint}\n"
        "【书写规范】targetJp、questionJp、blackboard 的日语例句必须使用东京日常规范日语（正常使用常用汉字与假名混排，如「新しい料理を作ってみます。」「店の席を予約しておきます。」），禁止写成全平假名！界面会自动在汉字上方标出假名。\n"
        "【口播规范】teacherPrompt 供语音朗读：请把中文引导与日语示范分成独立句子（先用纯中文说清要点加句号，不要在中文句子中间夹杂日语词，再另起一句给纯日语示范句），后端会自动把日语单独按假名发音，绝不串音。\n"
        "【语种锁定】全程仅限规范日语（汉字+平假名/片假名）与简体中文教学说明，严禁输出韩语（한글 / 한국어）或任何其他无关语种字符。\n\n"
        "严格输出以下 JSON（steps 可为 6–12 步，可用阶段：WARMUP, TEACH, CONTROLLED_DRILL, TRANSFORM_DRILL, SUBSTITUTION_DRILL, FREE_OUTPUT）：\n"
        "{\n"
        '  "blackboard": {\n'
        '    "titleCn": "简练黑板标题（20字内）",\n'
        '    "grammarPoint": "本课主攻文法/发音点",\n'
        '    "formulaJp": "清晰接续或结构公式",\n'
        '    "cnPitfallCn": "一句话讲透中国人为什么容易说错",\n'
        '    "contrastBadJp": "典型中式直译错句（日语）",\n'
        '    "contrastGoodJp": "东京母语者地道说法（日语）",\n'
        '    "contrastNoteCn": "对照点拨（25字内）"\n'
        "  },\n"
        '  "steps": [\n'
        '    {"stage": "WARMUP", "stageLabel": "1. 概念热身", "hideTarget": false, "targetJp": "规范日语句子(含常用汉字)", "targetCn": "中文翻译", "cueCn": "老师练习指引", "tipCn": "发音/记忆小贴士", "teacherPrompt": "纯中文开场引导加句号。随后另起一句给出纯日语示范句"},\n'
        '    {"stage": "TEACH", "stageLabel": "2. 核心精讲", "hideTarget": false, "targetJp": "规范日语核心例句(含常用汉字)", "targetCn": "中文翻译", "cueCn": "用法与接续点拨", "tipCn": "对比技巧", "teacherPrompt": "纯中文讲解要点加句号(不夹日语词)。随后另起一句给纯日语示范句"},\n'
        '    {"stage": "CONTROLLED_DRILL", "stageLabel": "3. 节奏镜子", "hideTarget": false, "targetJp": "另一句地道日常日语(含常用汉字)", "targetCn": "中文翻译", "cueCn": "注意哪两个音拍/助词", "tipCn": "细节提示", "teacherPrompt": "纯中文引导重点加句号。随后另起一句给纯日语示范句"},\n'
        '    {"stage": "TRANSFORM_DRILL", "stageLabel": "4. 口头变形反射", "hideTarget": true, "targetJp": "标准变形后日语整句(含常用汉字)", "targetCn": "中文目标意思", "cueCn": "给出原形/基础词，要求1秒口头变成今天的目标句型", "tipCn": "提示关键字", "teacherPrompt": "纯中文出题引导(不直接念出日语答案)"},\n'
        '    {"stage": "SUBSTITUTION_DRILL", "stageLabel": "5. 情景造句", "hideTarget": true, "targetJp": "标准日语表达(含常用汉字)", "targetCn": "中文情景需求", "cueCn": "真实生活情景，请直接用日语说出来", "tipCn": "提示重点词", "teacherPrompt": "纯中文情景出题(不剧透答案)"},\n'
        '    {"stage": "FREE_OUTPUT", "stageLabel": "6. 私教自由问答", "hideTarget": true, "questionJp": "老师用今天句型向学生提的1个真实日语问题(含常用汉字)", "questionCn": "问题中文意思", "targetJp": "一种自然参考答法（规范日语）", "targetCn": "参考答法中文", "cueCn": "请用自己的真实情况用日语回答老师提问，尽量用上今天学到的表达！", "tipCn": "可替换词汇提示", "teacherPrompt": "纯中文提示加句号。随后另起一句以纯日语发出提问"}\n'
        "  ]\n"
        "}"
    )

    models = list(AUTHOR_MODELS)
    return await _call_gemini_json(parts=[{"text": prompt}], models=models, api_key=api_key, temperature=0.6, timeout_sec=24.0)


def _normalize_authored_steps(raw_steps: List[Dict[str, Any]], start_index: int = 0) -> List[Dict[str, Any]]:
    normalized: List[Dict[str, Any]] = []
    for st in raw_steps:
        target_jp = strip_furigana_parens(strip_foreign_hangul(st.get("targetJp") or ""))
        question_jp = strip_furigana_parens(strip_foreign_hangul(st.get("questionJp") or ""))
        if not target_jp:
            continue
        idx = start_index + len(normalized)
        stage = st.get("stage") or "CONTROLLED_DRILL"
        hide_target = bool(st.get("hideTarget", stage in ("TRANSFORM_DRILL", "SUBSTITUTION_DRILL", "FREE_OUTPUT")))
        prompt_raw = strip_foreign_hangul(st.get("teacherPrompt") or "")
        normalized.append(
            {
                "stepIndex": idx,
                "stage": stage,
                "stageLabel": strip_foreign_hangul(st.get("stageLabel") or "") or f"{idx + 1}. 练习",
                "hideTarget": hide_target,
                "questionJp": question_jp,
                "questionCn": strip_foreign_hangul(st.get("questionCn") or ""),
                "questionTokens": tokenize_sentence(question_jp) if question_jp else [],
                "targetJp": target_jp,
                "targetDisplayJp": strip_foreign_hangul(st.get("targetDisplayJp") or "") or target_jp,
                "targetCn": strip_foreign_hangul(st.get("targetCn") or ""),
                "cueCn": strip_foreign_hangul(st.get("cueCn") or ""),
                "tipCn": strip_foreign_hangul(st.get("tipCn") or ""),
                "teacherPrompt": prompt_raw,
                "teacherPromptTts": prepare_tts_bilingual_script(prompt_raw, [target_jp, question_jp]),
                "tokens": tokenize_sentence(target_jp),
            }
        )
    return normalized


_TRAVEL_TWISTS = [
    "临时为6岁半 Jinny 和2岁半 Jaycie 询问儿童餐具、儿童椅或推车停放位置",
    "遇到满座/排队/时间变动，需要礼貌询问替代方案并协商时间",
    "孩子临时想要少冰/少盐/清淡或过敏确认，需要礼貌补充沟通",
    "推着婴儿车在车站/百货寻找无障碍电梯并确认准确路线",
    "酒店或餐厅核对预约姓名与35天长假行程中的行李寄存需求",
    "与热情友好的日本店员或当地家长顺便寒暄两句来自旧金山与带娃日常",
    "结账时确认支付方式、打包分装或是否需要小票/免税手续",
    "对方用敬语很快说了一长句时，礼貌请对方放慢一点并再次确认关键信息",
]


async def _author_travel_dialogue_lesson(
    *,
    scenario: Dict[str, Any],
    lesson_type: str,
    jlpt_target: str,
    weaknesses: List[Dict[str, Any]],
    due_cards: List[Dict[str, Any]],
    api_key: str,
) -> Dict[str, Any]:
    """Author a fresh, multi-turn AI family travel dialogue textbook tailored to Haodong's family."""
    phrases = list(scenario.get("phrases") or [])
    sampled = random.sample(phrases, min(len(phrases), 4)) if phrases else []
    seed_lines = [
        f"{strip_furigana_parens(p.get('jp') or '')}（{p.get('cn') or ''}）"
        for p in sampled
        if p.get("jp")
    ]
    twist_pair = random.sample(_TRAVEL_TWISTS, 2)
    weakness_str = ", ".join(w["pattern_key"] for w in weaknesses) or "暂无"
    due_str = ", ".join(f"{c['surface']}({c.get('meaning_cn', '')})" for c in due_cards) or "暂无"

    mode_note = (
        "专注声学镜子发音打磨：选 6 步高实用家庭现场句，每步强化节奏、促音与敬语尾音。"
        if lesson_type == "pronunciation_drill"
        else "专注动词与句型口头替换反射：设计 6–8 步高密度替换+情景反应训练，多用 hideTarget=true。"
        if lesson_type == "substitution_drill"
        else "完整 AI 场景连续对话实战（建议 7–10 步，随剧情自然收束，不受 10 分钟限制）：用一条连贯的真实家庭对话主线，从进店/开口破冰 → 提出家庭需求 → 应对突发小变化 → 礼貌确认与道谢收尾。对话轮次里，请在 questionJp 写出对方日本店员/当地人的真实台词（供学员听懂接话），targetJp 写一家人的自然地道回应！"
    )

    prompt = (
        "你是一位专注实战场景的东京资深日语私教，请为下面这个家庭定制「全新一次生成的家庭旅行情景对话教材」（不要照搬固定例句，每次重新编排鲜活对话）。\n\n"
        "【家庭画像】刘浩东（Google SWE 经理）与太太 Sherry，带 6岁半姐姐 Jinny 和 2岁半妹妹 Jaycie，从旧金山出发，2026年底至2027年初赴日本 35 晚长假（东京高轮、轻井泽滑雪、银座、福冈由布院）。\n"
        f"【场景名称】{scenario.get('title', '日本旅行实战')}\n"
        f"【场景背景】{scenario.get('summary', '')}\n"
        f"【对方角色设定】{scenario.get('persona', '友好的东京现场工作人员')}\n"
        f"【本轮随机剧情微调（务必自然融入对话中）】{twist_pair[0]}；可选支线：{twist_pair[1]}\n"
        f"【手册参考底句（供词汇启发，请重新创作自然多轮对话）】{'; '.join(seed_lines) or '围绕主题原创'}\n"
        f"【学生目标水平】{jlpt_target} | 历史薄弱点：{weakness_str} | 记忆本复习词：{due_str}\n"
        f"【训练模式要求】{mode_note}\n\n"
        "【书写规范】targetJp、questionJp、blackboard 的日语例句必须使用东京日常规范日语（汉字与假名自然混排），禁止全平假名。\n"
        "【口播规范】teacherPrompt 供语音朗读：中文引导与日语示范分开写，中文句子中间不夹日语词（先纯中文加句号，再另起一句给纯日语示范句）。\n"
        "【语种锁定】全程仅限规范日语与简体中文，严禁输出韩语（한글 / 한국어）。\n\n"
        "严格输出以下 JSON（steps 为 6–10 步，可用阶段：WARMUP, TEACH, CONTROLLED_DRILL, TRANSFORM_DRILL, SUBSTITUTION_DRILL, FREE_OUTPUT）：\n"
        "{\n"
        '  "blackboard": {\n'
        '    "titleCn": "本场场景要点（20字内）",\n'
        '    "grammarPoint": "本场景最核心的礼貌表达或敬语攻略",\n'
        '    "formulaJp": "核心套句公式",\n'
        '    "cnPitfallCn": "一句点破中国家长在此场景最容易踩的坑",\n'
        '    "contrastBadJp": "生硬直译说法（日语）",\n'
        '    "contrastGoodJp": "地道高情商日式表达（日语）",\n'
        '    "contrastNoteCn": "对比说明（25字内）"\n'
        "  },\n"
        '  "steps": [\n'
        '    {"stage": "WARMUP", "stageLabel": "1. 开场破冰", "hideTarget": false, "questionJp": "对方先说的话(如无可留空)", "questionCn": "对方中文意思", "targetJp": "规范日语句子", "targetCn": "中文翻译", "cueCn": "场景提示", "tipCn": "口语/礼貌细节", "teacherPrompt": "纯中文引导加句号。随后另起一句给出纯日语示范句"}\n'
        "  ]\n"
        "}"
    )

    models = list(AUTHOR_MODELS)
    return await _call_gemini_json(parts=[{"text": prompt}], models=models, api_key=api_key, temperature=0.72, timeout_sec=24.0)


def _build_offline_grammar_fallback(grammar_point: Dict[str, Any]) -> Dict[str, Any]:
    pattern = strip_foreign_hangul(grammar_point.get("pattern") or "核心语法")
    meaning = strip_foreign_hangul(grammar_point.get("meaning") or "")
    formation = strip_foreign_hangul(grammar_point.get("formation") or "")
    explanation = strip_foreign_hangul(grammar_point.get("explanation") or "")
    tip = strip_foreign_hangul(grammar_point.get("tip") or explanation or "注意日语接续与助词位置。")
    examples = grammar_point.get("examples") or []
    ex0 = examples[0] if len(examples) > 0 else {"jp": "日本語の勉強は毎日少しずつ続けています。", "cn": "日语学习每天都在一点点坚持。"}
    ex1 = examples[1] if len(examples) > 1 else ex0
    ex0_jp = strip_furigana_parens(ex0.get("jp") or "")
    ex1_jp = strip_furigana_parens(ex1.get("jp") or "")

    bb = {
        "titleCn": f"{pattern} · 离线精讲",
        "grammarPoint": f"{pattern}（{meaning}）",
        "formulaJp": formation or pattern,
        "cnPitfallCn": tip,
        "contrastBadJp": "",
        "contrastGoodJp": ex0_jp,
        "contrastNoteCn": meaning,
    }
    raw_steps = [
        {
            "stage": "WARMUP",
            "stageLabel": "1. 句型初识",
            "hideTarget": False,
            "targetJp": ex0_jp,
            "targetCn": ex0.get("cn") or meaning,
            "cueCn": f"重点体会「{pattern}」在句中的位置与含义（{meaning}）。",
            "tipCn": f"接续方式：{formation or pattern}",
            "teacherPrompt": f"今天我们来攻克语法「{pattern}」，意思是{meaning}。先跟我读第一句。{ex0_jp}",
        },
        {
            "stage": "TEACH",
            "stageLabel": "2. 例句巩固",
            "hideTarget": False,
            "targetJp": ex1_jp,
            "targetCn": ex1.get("cn") or meaning,
            "cueCn": explanation or tip,
            "tipCn": tip,
            "teacherPrompt": f"注意这个句型的接续和语气，再跟着读一遍例句。{ex1_jp}",
        },
        {
            "stage": "SUBSTITUTION_DRILL",
            "stageLabel": "3. 脱口造句",
            "hideTarget": True,
            "targetJp": ex0_jp,
            "targetCn": ex0.get("cn") or meaning,
            "cueCn": f"不要看文字，尝试用「{pattern}」直接说出这句话的意思：{ex0.get('cn') or meaning}",
            "tipCn": tip,
            "teacherPrompt": "合上提示，试着用刚才学到的句型自己直接说出来。",
        },
        {
            "stage": "FREE_OUTPUT",
            "stageLabel": "4. 自由运用",
            "hideTarget": True,
            "questionJp": ex1_jp,
            "questionCn": ex1.get("cn") or "试着用这个句型造一句贴近你生活的话。",
            "targetJp": ex0_jp,
            "targetCn": ex0.get("cn") or meaning,
            "cueCn": f"结合你自己的生活或日本旅行场景，用「{pattern}」说一句话。",
            "tipCn": tip,
            "teacherPrompt": "最后一步自由发挥，用今天学的语法点造一句自己的话，说给我听吧。",
        },
    ]
    return {"blackboard": bb, "steps": _normalize_authored_steps(raw_steps)}


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

    if unit and (unit.get("grammarNotes") or unit.get("dialogue")):
        g_notes = unit.get("grammarNotes") or []
        dlg_turns = (unit.get("dialogue") or {}).get("turns") or []
        g0 = g_notes[0] if len(g_notes) > 0 else {}
        g1 = g_notes[1] if len(g_notes) > 1 else g0
        g0_jp = strip_furigana_parens(g0.get("exampleJp") or bb.get("contrastGoodJp") or "今日は いい 天気ですね。")
        g1_jp = strip_furigana_parens(g1.get("exampleJp") or g0_jp)
        d0 = dlg_turns[0] if len(dlg_turns) > 0 else {"jp": g0_jp, "cn": g0.get("exampleCn") or ""}
        d1 = dlg_turns[1] if len(dlg_turns) > 1 else d0
        d2 = dlg_turns[2] if len(dlg_turns) > 2 else g1
        d0_jp = strip_furigana_parens(d0.get("jp") or g0_jp)
        d1_jp = strip_furigana_parens(d1.get("jp") or g1_jp)
        rp = unit.get("readingPassage") or {}
        rp_first_jp = ""
        if rp.get("jp"):
            rp_first_jp = strip_furigana_parens(rp["jp"].split("。")[0] + "。")

        raw_steps: List[Dict[str, Any]] = [
            {
                "stage": "WARMUP",
                "stageLabel": "1. 课文导入",
                "hideTarget": False,
                "targetJp": g0_jp,
                "targetCn": g0.get("exampleCn") or focus,
                "cueCn": f"文法「{g0.get('pattern', p0)}」：{g0.get('explanation', focus)}",
                "tipCn": f"接续：{g0.get('formation', p0)}",
                "teacherPrompt": f"今天进入《{title}》，我们先从核心例句入手。请跟我读，{g0_jp}",
            },
            {
                "stage": "TEACH",
                "stageLabel": "2. 文法深化",
                "hideTarget": False,
                "targetJp": g1_jp,
                "targetCn": g1.get("exampleCn") or focus,
                "cueCn": f"核心对比「{g1.get('pattern', focus)}」：{g1.get('explanation', '')}",
                "tipCn": f"接续：{g1.get('formation', '')}",
                "teacherPrompt": f"注意句型接续与语感差别，跟着再读这句例句。{g1_jp}",
            },
            {
                "stage": "CONTROLLED_DRILL",
                "stageLabel": "3. 对话精练",
                "hideTarget": False,
                "questionJp": d0_jp,
                "questionCn": d0.get("cn") or "",
                "targetJp": d1_jp,
                "targetCn": d1.get("cn") or "",
                "cueCn": "听清课文对话上句，自然接出下句回答。",
                "tipCn": bb.get("cnPitfallCn") or "",
                "teacherPrompt": f"来进入课文对话演练，认真听对方怎么说。{d0_jp}",
            },
            {
                "stage": "TRANSFORM_DRILL",
                "stageLabel": "4. 避坑转换",
                "hideTarget": True,
                "targetJp": strip_furigana_parens(bb.get("contrastGoodJp") or g0_jp),
                "targetCn": g0.get("exampleCn") or bb.get("contrastNoteCn") or "说出地道正确日语",
                "cueCn": f"注意避坑「{bb.get('cnPitfallCn', '')}」，直接口头说出正确日语：{g0.get('exampleCn') or bb.get('contrastNoteCn') or ''}",
                "tipCn": f"公式参考：{bb.get('formulaJp', '')}",
                "teacherPrompt": "不要看文字，用今天黑板上的正确表达直接说出来试试。",
            },
        ]
        if rp_first_jp:
            raw_steps.append(
                {
                    "stage": "CONTROLLED_DRILL",
                    "stageLabel": "5. 短文精读",
                    "hideTarget": False,
                    "targetJp": rp_first_jp,
                    "targetCn": (rp.get("cn") or "").split("。")[0] + "。",
                    "cueCn": f"精读《{rp.get('title', title)}》选段，注意断句、助词与长句语气。",
                    "tipCn": "放稳语速，逗号处自然换气。",
                    "teacherPrompt": f"下面我们来念一段教材短文《{rp.get('title', '')}》。{rp_first_jp}",
                }
            )
        raw_steps.append(
            {
                "stage": "FREE_OUTPUT",
                "stageLabel": f"{len(raw_steps) + 1}. 私教自由问答",
                "hideTarget": True,
                "questionJp": d0_jp,
                "questionCn": d0.get("cn") or f"请用今天学到的「{p0}」谈谈你的真实情况。",
                "targetJp": strip_furigana_parens(d2.get("jp") or d1_jp),
                "targetCn": d2.get("cn") or d1.get("cn") or "",
                "cueCn": f"围绕「{title}」，用上今天学到的句型 {p0} 自然回答！",
                "tipCn": f"推荐词：{', '.join(v.get('jp', '') for v in (unit.get('vocabList') or [])[:3])}",
                "teacherPrompt": f"最后一关自由回答，用自己的话回应这一句。{d0_jp}",
            }
        )
        return {"blackboard": bb, "steps": _normalize_authored_steps(raw_steps)}

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


def _build_offline_travel_steps(
    *,
    scenario: Dict[str, Any],
    lesson_type: str,
    jlpt_target: str,
    weaknesses: List[Dict[str, Any]],
    due_cards: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    """Deterministic offline travel scenario builder used when no API key is configured or authoring fails."""
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
    return steps


async def create_guided_lesson(
    user_id: str,
    scenario_id: str = "1",
    lesson_type: str = "guided_10min",
    jlpt_target: str = "N4",
    voice: str = DEFAULT_VOICE,
    curriculum_mode: str = "travel_scenario",
    lesson_id: Optional[str] = None,
    grammar_id: Optional[str] = None,
    custom_topic: Optional[str] = None,
    ai_generate: bool = True,
    defer_opening_tts: bool = True,
    coach_model: Optional[str] = None,
    include_review: bool = False,
    api_key: Optional[str] = None,
) -> Dict[str, Any]:
    """Create a Veteran Sensei textbook lesson (syllabus / grammar point / custom topic / AI travel dialogue)."""
    weaknesses = list_weaknesses(user_id, limit=3) if include_review else []
    due_cards = (list_cards(user_id, due_only=True, limit=4) or list_cards(user_id, due_only=False, limit=3)) if include_review else []
    due_snapshot = [{"surface": c["surface"], "meaning_cn": c.get("meaning_cn", "")} for c in due_cards]

    if curriculum_mode == "favorites":
        favs = list_favorite_sentences(user_id, limit=25)
        if not favs:
            raise ValueError("你还没有收藏练习句，先在私教课中点击 ☆ 收藏几句再来重练吧。")

        focus_fav_id = ""
        if lesson_id and str(lesson_id).startswith("fav:"):
            focus_fav_id = str(lesson_id)[4:].strip()
        if focus_fav_id:
            favs.sort(key=lambda item: 0 if item.get("id") == focus_fav_id else 1)

        raw_steps = []
        for idx, fav in enumerate(favs):
            jp = strip_furigana_parens(fav.get("jp") or "")
            if not jp:
                continue
            src_label = fav.get("lesson_title") or fav.get("level") or "收藏句"
            raw_steps.append(
                {
                    "stage": "CONTROLLED_DRILL",
                    "stageLabel": f"收藏第 {idx + 1} 句",
                    "hideTarget": False,
                    "targetJp": jp,
                    "targetCn": fav.get("cn") or "",
                    "cueCn": f"重点复练收藏句（来源：{src_label}）",
                    "tipCn": fav.get("tip_cn") or "注意音调起伏、长音促音与句尾收音。",
                    "teacherPrompt": f"来复练你收藏的第{idx + 1}句。{jp}",
                }
            )

        steps = _normalize_authored_steps(raw_steps)
        if not steps:
            raise ValueError("你还没有有效的收藏练习句。")

        first_fav = favs[0]
        lesson_meta = {
            "curriculumMode": "favorites",
            "lessonId": "favorites_deck",
            "grammarId": "",
            "title": "⭐ 收藏常练句专项",
            "subtitle": f"共 {len(steps)} 句个人收藏重点复练",
            "level": first_fav.get("level") or jlpt_target,
            "grammarFocus": first_fav.get("grammar_focus") or "重点句型与语音巩固",
            "blackboard": None,
            "textbook": None,
            "aiGenerated": False,
            "totalSteps": len(steps),
        }
        lesson_plan = {
            "curriculumMode": "favorites",
            "lessonId": "favorites_deck",
            "lessonMeta": lesson_meta,
            "jlptTarget": lesson_meta["level"],
            "weaknessesSnapshot": weaknesses,
            "dueCardsSnapshot": due_snapshot,
            "steps": steps,
        }
        session_id = create_session(
            user_id=user_id,
            mode="favorites",
            scenario_id="favorites_deck",
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
                "id": "favorites_deck",
                "title": lesson_meta["title"],
                "icon": "⭐",
                "summary": lesson_meta["subtitle"],
            },
            "weaknesses": weaknesses,
            "dueCards": due_snapshot,
            "steps": steps,
            "openingAudioUrl": opening_audio_url,
        }

    if curriculum_mode in ("sensei_syllabus", "custom_topic", "grammar_point"):
        progress_map = list_lesson_progress(user_id)
        unit: Optional[Dict[str, Any]] = None
        grammar_point: Optional[Dict[str, Any]] = None
        if curriculum_mode == "sensei_syllabus":
            unit = get_syllabus_lesson(lesson_id)
            if not unit:
                overview = get_syllabus_overview(progress_map, jlpt_target=jlpt_target)
                rec = overview.get("recommendedLesson")
                unit = get_syllabus_lesson(rec["id"] if rec else "S01_mora_minimal_pairs")
        elif curriculum_mode == "grammar_point":
            grammar_point = get_grammar_point(grammar_id or "")

        clean_custom = (custom_topic or "").strip()
        if curriculum_mode == "grammar_point" and not grammar_point and not clean_custom:
            clean_custom = "N4/N5 核心语法精讲"

        authored: Optional[Dict[str, Any]] = None
        if api_key and ai_generate:
            try:
                authored = await _author_textbook_lesson(
                    user_id=user_id,
                    curriculum_mode=curriculum_mode if (curriculum_mode != "grammar_point" or grammar_point) else "custom_topic",
                    unit=unit,
                    custom_topic=clean_custom,
                    jlpt_target=(unit or {}).get("level") or (grammar_point or {}).get("level") or jlpt_target,
                    weaknesses=weaknesses,
                    due_cards=due_cards,
                    coach_model=coach_model,
                    api_key=api_key,
                    grammar_point=grammar_point,
                )
            except Exception as exc:
                print(f"[sensei] AI textbook authoring fallback: {exc}")
                authored = None

        if authored and authored.get("steps"):
            steps = _normalize_authored_steps(authored["steps"])
            default_bb = (unit or {}).get("blackboard") or {}
            blackboard = _sanitize_no_hangul(dict(authored.get("blackboard") or default_bb))
        elif curriculum_mode == "grammar_point" and grammar_point:
            fb = _build_offline_grammar_fallback(grammar_point)
            steps = fb["steps"]
            blackboard = _sanitize_no_hangul(dict(fb["blackboard"] or {}))
        else:
            fb = _build_offline_syllabus_fallback(unit, clean_custom)
            steps = fb["steps"]
            blackboard = _sanitize_no_hangul(dict(fb["blackboard"] or {}))

        if blackboard.get("contrastBadJp"):
            blackboard["contrastBadTokens"] = tokenize_sentence(blackboard["contrastBadJp"])
        if blackboard.get("contrastGoodJp"):
            blackboard["contrastGoodTokens"] = tokenize_sentence(blackboard["contrastGoodJp"])

        if curriculum_mode == "sensei_syllabus":
            resolved_lid = (unit or {}).get("id")
            meta_title = (unit or {}).get("title", "私教体系课")
            meta_sub = (unit or {}).get("subtitle", "")
            meta_lvl = (unit or {}).get("level", jlpt_target)
            meta_focus = (unit or {}).get("grammarFocus", "")
        elif curriculum_mode == "grammar_point" and grammar_point:
            resolved_lid = f"grammar_{grammar_point['id']}"
            meta_title = f"语法精讲：{grammar_point.get('pattern', '')}"
            meta_sub = grammar_point.get("meaning") or "语法库专项深度精讲"
            meta_lvl = grammar_point.get("level") or jlpt_target
            meta_focus = f"{grammar_point.get('pattern', '')}（{grammar_point.get('meaning', '')}）"
        else:
            resolved_lid = f"custom_{uuid.uuid4().hex[:6]}"
            meta_title = f"自选专题：{clean_custom}"
            meta_sub = "由东京私教总监结合你的薄弱项现场编写"
            meta_lvl = jlpt_target
            meta_focus = clean_custom

        unit_textbook = None
        if curriculum_mode == "sensei_syllabus" and unit:
            unit_textbook = {
                "canDoCn": unit.get("canDoCn") or meta_sub,
                "estimatedMin": int(unit.get("estimatedMin") or 12),
                "vocabList": unit.get("vocabList") or [],
                "grammarNotes": unit.get("grammarNotes") or [],
                "dialogue": unit.get("dialogue") or None,
                "readingPassage": unit.get("readingPassage") or None,
            }

        lesson_meta = {
            "curriculumMode": curriculum_mode,
            "lessonId": resolved_lid,
            "grammarId": (grammar_point or {}).get("id") or grammar_id or "",
            "title": meta_title,
            "subtitle": meta_sub,
            "level": meta_lvl,
            "grammarFocus": meta_focus,
            "blackboard": blackboard,
            "textbook": unit_textbook,
            "aiGenerated": bool(authored and authored.get("steps")),
            "totalSteps": len(steps),
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

    # Travel scenario mode (AI-authored fresh family dialogue when api_key + ai_generate; static offline fallback otherwise)
    scenario = get_scenario(scenario_id)
    if not scenario:
        scenario = get_scenario("1") or get_scenario("daily_konbini")

    authored_travel: Optional[Dict[str, Any]] = None
    if api_key and ai_generate:
        try:
            authored_travel = await _author_travel_dialogue_lesson(
                scenario=scenario,
                lesson_type=lesson_type,
                jlpt_target=jlpt_target,
                weaknesses=weaknesses,
                due_cards=due_cards,
                api_key=api_key,
            )
        except Exception as exc:
            print(f"[sensei] AI travel dialogue authoring fallback: {exc}")
            authored_travel = None

    travel_blackboard: Optional[Dict[str, Any]] = None
    if authored_travel and authored_travel.get("steps"):
        steps = _normalize_authored_steps(authored_travel["steps"])
        raw_bb = authored_travel.get("blackboard")
        if raw_bb:
            travel_blackboard = _sanitize_no_hangul(dict(raw_bb))
            if travel_blackboard.get("contrastBadJp"):
                travel_blackboard["contrastBadTokens"] = tokenize_sentence(travel_blackboard["contrastBadJp"])
            if travel_blackboard.get("contrastGoodJp"):
                travel_blackboard["contrastGoodTokens"] = tokenize_sentence(travel_blackboard["contrastGoodJp"])
    else:
        steps = _build_offline_travel_steps(
            scenario=scenario,
            lesson_type=lesson_type,
            jlpt_target=jlpt_target,
            weaknesses=weaknesses,
            due_cards=due_cards,
        )

    lesson_meta = {
        "curriculumMode": "travel_scenario",
        "lessonId": "",
        "grammarId": "",
        "title": scenario["title"],
        "subtitle": scenario.get("summary", ""),
        "level": jlpt_target,
        "grammarFocus": (travel_blackboard or {}).get("grammarPoint", ""),
        "blackboard": travel_blackboard,
        "aiGenerated": bool(authored_travel and authored_travel.get("steps")),
        "totalSteps": len(steps),
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


async def extend_guided_lesson(
    *,
    session_id: str,
    user_id: str,
    curriculum_mode: str = "sensei_syllabus",
    lesson_title: str = "",
    grammar_focus: str = "",
    jlpt_target: str = "N4",
    voice: str = DEFAULT_VOICE,
    existing_targets: Optional[List[str]] = None,
    start_index: int = 0,
    scenario_id: Optional[str] = None,
    grammar_id: Optional[str] = None,
    coach_model: Optional[str] = None,
    api_key: str,
) -> Dict[str, Any]:
    """Generate 3-4 deeper continuation steps for any active lesson so study continues as long as needed."""
    prior_list = [strip_furigana_parens(t) for t in (existing_targets or []) if t][-8:]
    gp = get_grammar_point(grammar_id or "") if grammar_id else None
    sc = get_scenario(scenario_id or "") if scenario_id else None
    extra_ctx = ""
    if gp:
        extra_ctx += (
            f"语法知识点：{gp.get('pattern', '')}（{gp.get('meaning', '')}）｜"
            f"接续：{gp.get('formation', '')}｜提示：{gp.get('tip', '')}\n"
        )
    if sc:
        extra_ctx += f"场景设定：{sc.get('title', '')}（{sc.get('persona', '')}）\n"

    already_str = "；".join(prior_list) or "（刚开始）"
    start_num = max(1, start_index + 1)

    prompt = (
        "你是一位拥有20年教龄的东京资深日语私教，学生已经练完本课前面几步，还想继续深入加练！\n"
        f"模式：{curriculum_mode} | 课题：{lesson_title or grammar_focus or '日常日语进阶'} | 重点：{grammar_focus or '自然表达'} | 目标等级：{jlpt_target}\n"
        f"{extra_ctx}"
        f"【已经练过的句子（严禁重复或只改一个词敷衍）】：{already_str}\n\n"
        f"请继续往后编写 3–4 步难度递增的进阶操练（步骤编号从第 {start_num} 步开始：第 {start_num}. 细微辨析/新语境 → 情景对答/角色升级 → 自由表达或近义区别），\n"
        "若是旅行场景请在 questionJp 中写出店员/日本当地人自然的新一句回应（如追问细节、提供选项或善意提醒），targetJp 写刘浩东一家人的得体回答。\n"
        "【书写规范】targetJp、questionJp 使用东京规范日语（常用汉字与假名混排）。\n"
        "【口播规范】teacherPrompt 先用纯中文说清要求加句号，不夹日语词，如给示范再另起一句纯日语。\n"
        "【语种锁定】全程仅限规范日语与简体中文，严禁输出韩语（한글 / 한국어）。\n\n"
        '严格输出 JSON：{"steps": ['
        '{"stage":"CONTROLLED_DRILL|TRANSFORM_DRILL|SUBSTITUTION_DRILL|FREE_OUTPUT",'
        f'"stageLabel":"{start_num}. 进阶拓展",'
        '"hideTarget":true,'
        '"questionJp":"可选对方台词或提问(无则留空)",'
        '"questionCn":"对方中文意思",'
        '"targetJp":"规范日语句子",'
        '"targetCn":"中文翻译",'
        '"cueCn":"进阶指引",'
        '"tipCn":"关键提示",'
        '"teacherPrompt":"纯中文引导加句号。可选另起一句纯日语"}'
        "]}"
    )

    data = _sanitize_no_hangul(
        await _call_gemini_json(
            parts=[{"text": prompt}],
            models=list(AUTHOR_MODELS),
            api_key=api_key,
            temperature=0.65,
            timeout_sec=20.0,
        )
    )
    steps = _normalize_authored_steps(data.get("steps") or [], start_index=start_index)
    return {"sessionId": session_id, "steps": steps}


async def evaluate_sensei_turn(
    *,
    session_id: str,
    user_id: str,
    step_index: int,
    total_steps: int = 0,
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
    jlpt_target: str = "",
    previous_heard_jp: str = "",
    previous_issues_summary: str = "",
    previous_score: Optional[int] = None,
    api_key: str,
) -> Dict[str, Any]:
    """Evaluate student audio with Veteran Tokyo Sensei rubric, attempt memory, acoustic prosody & token diff."""
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
    target_tokens = tokenize_sentence(clean_target)
    audio_stats = analyze_audio_speech_activity(
        norm_bytes, filename=audio_filename, content_type=audio_mime
    )

    resolved_jlpt = (jlpt_target or "").strip().upper()
    if resolved_jlpt not in ("N5", "N4", "N3", "N2", "N1"):
        lesson_obj = get_syllabus_lesson(lesson_id) if lesson_id else None
        sess_obj = get_session(session_id) if not lesson_obj else None
        resolved_jlpt = (
            ((lesson_obj or {}).get("level") or ((sess_obj or {}).get("lesson_plan") or {}).get("jlptTarget") or "N4")
            .strip()
            .upper()
        )

    async def _build_no_speech_payload(reason_cn: str, spoken_cn: str, model_used: str) -> Dict[str, Any]:
        teacher_url = ""
        if not defer_tts and api_key:
            try:
                tts_res = await synthesize_speech(
                    spoken_cn, api_key=api_key, voice=voice, model=TTS_FAST_MODEL
                )
                teacher_url = tts_res["audio_url"]
            except Exception:
                teacher_url = ""
        return {
            "turnId": turn_id,
            "sessionId": session_id,
            "stepIndex": step_index,
            "stage": stage,
            "attempt": attempt,
            "decision": "no_speech",
            "noSpeech": True,
            "consolidatingFull": False,
            "jlptLevel": resolved_jlpt,
            "overallScore": 0,
            "pitchScore": 0,
            "grammarScore": 0,
            "rhythmScore": 0,
            "politenessScore": 0,
            "heardJp": "",
            "betterJp": clean_target,
            "betterTokens": target_tokens,
            "targetJp": clean_target,
            "drillChunkJp": "",
            "drillChunkTokens": [],
            "drillChunkReading": "",
            "pitchNotation": "",
            "pitchNote": reason_cn,
            "grammarNote": "",
            "praiseCn": "",
            "progressNoteCn": "",
            "actionTipCn": "",
            "pragmaticNoteCn": "",
            "nativeUpgradeJp": "",
            "nativeUpgradeTokens": [],
            "nativeUpgradeNoteCn": "",
            "resolvedWeaknesses": [],
            "issues": [],
            "heardDiff": [],
            "targetDiff": [],
            "matchRatio": 0.0,
            "teacherSpokenScript": spoken_cn,
            "teacherSpokenTts": spoken_cn,
            "teacherAudioUrl": teacher_url,
            "userAudioUrl": user_audio_url,
            "extractedVocab": [],
            "targetTokens": target_tokens,
            "heardTokens": [],
            "modelUsed": model_used,
            "evalMs": int((time.perf_counter() - t0) * 1000),
            "audioStats": audio_stats,
        }

    if audio_stats["analyzed"] and not audio_stats["has_speech"]:
        return await _build_no_speech_payload(
            "录音中未检测到有效人声（音量过低或录音过短），请靠近麦克风清晰朗读后再试。",
            "刚才录音里几乎没有听到声音，请你靠近麦克风，大声清晰地再读一遍。",
            "acoustic-gate",
        )

    prev_heard = (previous_heard_jp or "").strip()
    prev_score = previous_score
    prev_issues = (previous_issues_summary or "").strip()
    if attempt >= 2 and not prev_heard:
        for rt in reversed(get_recent_step_turns(session_id, step_index, limit=2)):
            r_heard = (rt.get("transcript_jp") or (rt.get("correction") or {}).get("heardJp") or "").strip()
            if r_heard:
                prev_heard = r_heard
                corr = rt.get("correction") or {}
                if prev_score is None:
                    prev_score = corr.get("overallScore")
                if not prev_issues:
                    prev_issues = "；".join(
                        f"{it.get('patternKey') or it.get('type', '')}:{it.get('detailCn', '')}"
                        for it in (corr.get("issues") or [])[:2]
                        if it.get("detailCn") or it.get("patternKey")
                    )
                break

    active_weaknesses = list_weaknesses(user_id, limit=3)
    weakness_lines = [
        f"{w['pattern_key']}({w.get('note_cn', '')[:24]})"
        for w in active_weaknesses
        if w.get("pattern_key")
    ]
    acoustic_hint = format_acoustic_summary_for_prompt(audio_stats, len(jp_to_kana(active_target)))

    if resolved_jlpt == "N5":
        level_rule = "【当前级别 N5 地基校准】重点把关音拍饱满度（长音拖满2拍、促音っ闭嘴停1拍）、清浊音区别、以及です/ます基本结尾清晰度；温柔明确，打好开口底子。"
    elif resolved_jlpt == "N3":
        level_rule = "【当前级别 N3 实战进阶】请用东京职场/日常自然度标尺评判！除发音声调外，重点审视助词精准度、句间自然衔接、缓冲垫词（〜んですが、〜ていただけませんか等）与语气委婉得体度；即便过关，也请尽量在 nativeUpgradeJp 给出一句更像东京当地人的地道升级表达。"
    else:
        level_rule = "【当前级别 N4 进阶校准】重点把关て形/ない形/可能态等活用变形、核心助词（は/が/に/で/を）搭配、长短促音及整句语流连贯性；若能更自然请顺手给出 nativeUpgradeJp。"

    if stage == "FREE_OUTPUT":
        stage_rule = (
            f"1. 这是【自由问答】环节。老师刚才问：{question_jp or cue_cn or target_cn}。本课焦点：{grammar_focus or '自然得体'}。\n"
            "权重：语义切题与目标语法运用 35% + 助词/活用准确 25% + 语境礼貌得体度 20% + 发音音调 20%。\n"
            "学生可以用自己的话回答，不必逐字照搬参考答案！只要语义切题、语法正确、语气得体且发音清晰，总分应>=85过关，并在 betterJp 给出更地道的润色。\n"
        )
        pass_threshold = 85
    elif stage in ("TRANSFORM_DRILL", "SUBSTITUTION_DRILL"):
        stage_rule = (
            f"1. 这是【口头变形/情景造句】环节。语法焦点：{grammar_focus or cue_cn}。\n"
            "权重：目标语法与语义达成 35% + 助词/活用 25% + 得体度 20% + 发音拍感 20%。\n"
            "只要日语活用正确、达成目标表达（即使换了等效礼貌词或同义词汇）且发音清晰即可>=88过关。\n"
        )
        pass_threshold = 88
    else:
        stage_rule = (
            "1. 这是【语音镜像跟读/精讲】环节。\n"
            "权重：音素清晰度(送气/ら行/清浊音) 25% + 日语拍感(促音っ/长音ー/拨音ん) 25% + 高低音调(アクセント) 25% + 语流连贯 15% + 完整度 10%。\n"
            "出现明显吞音、促音没停顿、长音念短、中文式平板腔或助词读错时总分必须<85。\n"
        )
        pass_threshold = 88

    was_chunk_drill = bool(drill_chunk_jp and len(strip_furigana_parens(drill_chunk_jp)) < len(clean_target))
    prev_block = ""
    if prev_heard:
        prev_block = (
            f"\n【本句上一次尝试对比（第{max(1, attempt - 1)}次）】学生上次读成：「{prev_heard}」（{prev_score or '-'}分；上次问题：{prev_issues or '需顺畅'}）。"
            "【纵向比较硬规则】：务必听出这次与上次的差异！在 progressNoteCn 里先具体肯定他哪一点改好了（若没改善则直说），再遵守「每次最多抓 1–2 个最优先纠错点」原则，切忌同时丢一堆错。\n"
        )
    weakness_block = ""
    if weakness_lines:
        weakness_block = (
            f"\n【学生历史高频老毛病档案】：{'；'.join(weakness_lines)}。"
            "若本轮再犯请温柔点破；若学生在本句需要用到该知识点且这次做对了，请在 resolvedWeaknesses 中原样输出对应标签名以示攻克。\n"
        )
    acoustic_block = f"\n【客观声学物理参考】：{acoustic_hint}\n" if acoustic_hint else ""
    consolidation_hint = (
        "\n【注意】学生本轮刚在单练拆词！若读准请先表扬该词已读稳，并邀请带着感觉读完整句。\n"
        if was_chunk_drill
        else ""
    )

    prompt = (
        "你是一位拥有20年教龄的东京资深日语1对1私教（面向中国家庭学员），兼具音乐般敏锐的听辨力与极其落地的教学表达。\n"
        f"阶段:{stage} | 第{attempt}次尝试 | 参考目标:{clean_target} | 本轮应读片段:{active_target} | 语义:{cue_cn or target_cn}\n"
        f"{level_rule}\n"
        "【评分锚点（严禁敷衍给分）】95–100:准母语级音调拍感与得体度；88–94:清晰准确过关(可有1处极轻微尾音微瑕)；75–87:能听懂但有明显中文腔(平读/送气过重/长短促音不足)或小错；60–74:关键助词活用错误或卡顿过多；<60:严重漏词/念错/答非所问。\n"
        "核心规则：\n"
        "0. 【反幻觉铁律】：先真实倾听音频！先输出 noSpeech 与逐字如实听写的 heardJp，严禁照抄参考目标脑补学生没读出的词！若音频为静音、环境杂音、咳嗽/按键声、完全听不清或未说日语，必须设 \"noSpeech\": true、\"heardJp\": \"\"、五项分数全为 0、评价字段留空，并在 teacherSpokenScript 坦诚说「刚才没听清你的声音，请你靠近麦克风再读一遍」，绝不可编造分析！若只读了一部分或说错词，必须如实听写并在总分大幅扣分（<50分）。\n"
        f"{stage_rule}"
        f"{prev_block}{weakness_block}{acoustic_block}{consolidation_hint}"
        "2. heardJp、betterJp、drillChunkJp、nativeUpgradeJp 使用规范日语汉字与假名（界面自动标假名）；全程严禁输出韩语（한글 / 한국어）。\n"
        "3. 【双通道反馈规范】：\n"
        "   - 语音通道 teacherSpokenScript（严格放在第3个字段，25–55字）：保持口播干脆！前半句纯中文点出1个最关键的夸奖+核心建议（句中不夹日语词，句号收尾），后半句另起一句纯日语示范（例：「这次促音憋得很好，句尾再收干脆一点就满分。切手を貼って、すぐに出します。」）。禁止英文/罗马音/括号/星号。\n"
        "   - 文本红笔卡字段请写出20年名师的干货：praiseCn 必须具体到某个词或某种语感；actionTipCn 必须给中国学习者一听就会的**口腔嘴型/憋气拍数/汉语四声类比动作处方**（例：き 后面闭嘴停满半拍再爆破 て；よ↑や↓く 第一拍低、や高、く掉下去）；pitchNotation 写出重点词高低音升降标注；若即使过关也有更地道的东京表达，请填 nativeUpgradeJp + nativeUpgradeNoteCn！\n"
        "返回严格 JSON（字段顺序不可打乱，确保 noSpeech/heardJp/teacherSpokenScript 在最前）：\n"
        '{"noSpeech":false,"heardJp":"逐字如实听写(静音/听不清必须留空)","teacherSpokenScript":"纯中文点评加句号。纯日语示范",'
        '"overallScore":0,"pitchScore":0,"grammarScore":0,"rhythmScore":0,"politenessScore":0,'
        '"betterJp":"标准地道目标句","drillChunkJp":"需单练的1个短词块(过关留空)","drillChunkReading":"如 ちか↓く(勿用反斜杠)",'
        '"pitchNotation":"如 よ[や↓く]（重点词音调升降符号）",'
        '"praiseCn":"具体夸到某个词或语感表现(35字内)",'
        '"progressNoteCn":"对比上一次尝试的具体进步或变化(第1次留空)",'
        '"actionTipCn":"给中文母语者的具体口腔动作/停顿拍数/声调类比处方(过关也可给微调建议，60字内)",'
        '"pitchNote":"高低音与长短音诊断(45字内)","grammarNote":"助词/活用/句型讲解(45字内)",'
        '"pragmaticNoteCn":"语境得体度/缓冲委婉度提醒(如无则留空)",'
        '"nativeUpgradeJp":"可选：更像东京当地人的升级地道说法(已最地道可留空)",'
        '"nativeUpgradeNoteCn":"为何升级版更地道(25字内)",'
        '"resolvedWeaknesses":["若这次改掉了历史老毛病档案中的某项，填其patternKey"],'
        '"issues":[{"type":"pitch|sokuon|long_vowel|voicing|consonant|ending|particle|grammar|keigo","severity":"critical|minor","patternKey":"短标签","detailCn":"具体原因与改法"}],'
        '"extractedVocab":[{"surface":"","lemma":"","reading":"","pitchAccent":"","meaningCn":"","jlpt":"N4"}]}'
    )

    gemini_bytes, gemini_mime, was_boosted = boost_quiet_audio_for_gemini(
        norm_bytes, audio_mime, audio_stats
    )
    audio_stats["gainBoosted"] = was_boosted
    audio_b64 = base64.b64encode(gemini_bytes).decode("ascii")
    parts = [
        {"text": prompt},
        {"inlineData": {"mimeType": gemini_mime, "data": audio_b64}},
    ]
    chosen_model = (coach_model or "").strip()
    if chosen_model not in _ALLOWED_COACH_MODELS:
        chosen_model = COACH_MODEL
    models = [chosen_model] + [m for m in [COACH_MODEL, *COACH_FALLBACK_MODELS] if m != chosen_model]

    prewarmed_scripts: set[str] = set()
    known_jp_hints = [clean_target, active_target, question_jp]

    def _on_script_ready(script_text: str) -> None:
        script_text = strip_foreign_hangul(script_text)
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
        timeout_sec=12.0,
        per_model_timeouts={
            "gemini-4-hydrogen": 12.0,
            "gemini-3-flash-preview": 12.5,
            "gemini-3.5-flash-lite": 9.0,
            "gemini-4-neon": 16.0,
            "gemini-4-argon": 14.0,
        },
        on_script_ready=_on_script_ready if defer_tts else None,
        hedge_after_sec=6.5 if (chosen_model == "gemini-4-hydrogen" and len(models) >= 2) else None,
        thinking_level="MEDIUM" if chosen_model == "gemini-4-neon" else "LOW",
    )

    eval_data = _sanitize_no_hangul(eval_data)
    heard_jp = (eval_data.get("heardJp") or "").strip()
    if bool(eval_data.get("noSpeech")) or not heard_jp:
        return await _build_no_speech_payload(
            eval_data.get("pitchNote") or "未识别到清晰的日语发音，请靠近麦克风重新朗读。",
            "刚才没听清你的日语发音，请你靠近麦克风，再清楚地读一遍。",
            eval_data.get("_modelUsed", chosen_model),
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
        was_chunk_drill=was_chunk_drill,
    )

    if decision == "consolidate_full":
        drill_chunk = ""

    teacher_script = (eval_data.get("teacherSpokenScript") or "").strip()
    if decision == "consolidate_full":
        if not teacher_script or "整句" not in teacher_script:
            teacher_script = (
                f"太好了，刚才那个词已经读稳了！现在带着刚才的感觉，把整句顺一遍。{jp_to_kana(clean_target)}"
            )
    elif not teacher_script:
        if decision == "pass":
            teacher_script = f"太棒了，这一句音调和节奏都很稳！{jp_to_kana(clean_target)}"
        elif drill_chunk:
            chunk_kana = jp_to_kana(drill_chunk)
            teacher_script = f"刚才这个词还差一点点，听我示范。{chunk_kana}。来，跟我单独读一遍。{chunk_kana}"
        else:
            teacher_script = f"我们再来顺一遍节奏，听我示范。{jp_to_kana(active_target)} 准备好再读一次。"

    if decision == "advance" and attempt >= 3 and overall_score < pass_threshold:
        teacher_script = (
            f"这几次已经明显比第一遍清楚多啦，刚才的问题我先帮你记在记忆本里。听一遍正确示范。{jp_to_kana(clean_target)} 我们先继续下一步。"
        )

    better_jp = strip_furigana_parens(eval_data.get("betterJp") or "") or clean_target
    native_upgrade_jp = strip_furigana_parens(eval_data.get("nativeUpgradeJp") or "")
    if native_upgrade_jp == better_jp:
        native_upgrade_jp = ""

    teacher_spoken_tts = prepare_tts_bilingual_script(
        teacher_script,
        [*known_jp_hints, better_jp, drill_chunk, native_upgrade_jp],
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

    resolved_weaknesses = [
        str(k).strip() for k in (eval_data.get("resolvedWeaknesses") or []) if str(k).strip()
    ]
    if resolved_weaknesses and overall_score >= pass_threshold:
        graduated_keys = record_weakness_improvement(user_id, resolved_weaknesses)
        if graduated_keys:
            resolved_weaknesses = graduated_keys

    has_critical = any((it.get("severity") == "critical") for it in issues)
    if overall_score < pass_threshold or has_critical:
        for it in issues[:3]:
            upsert_weakness(
                user_id=user_id,
                issue_type=it.get("type") or "pronunciation",
                pattern_key=it.get("patternKey") or drill_chunk or clean_target[:16],
                example_jp=clean_target,
                note_cn=it.get("detailCn") or eval_data.get("actionTipCn") or eval_data.get("pitchNote") or "",
            )

    target_tokens = tokenize_sentence(clean_target)
    better_tokens = tokenize_sentence(better_jp)
    heard_tokens = tokenize_sentence(heard_jp)
    drill_chunk_tokens = tokenize_sentence(drill_chunk) if drill_chunk else []
    native_upgrade_tokens = tokenize_sentence(native_upgrade_jp) if native_upgrade_jp else []
    token_diff = compute_token_diff(heard_tokens, better_tokens)
    eval_ms = int((time.perf_counter() - t0) * 1000)

    response_payload = {
        "turnId": turn_id,
        "sessionId": session_id,
        "stepIndex": step_index,
        "stage": stage,
        "attempt": attempt,
        "decision": decision,
        "noSpeech": False,
        "consolidatingFull": decision == "consolidate_full",
        "jlptLevel": resolved_jlpt,
        "overallScore": overall_score,
        "pitchScore": int(max(0, min(100, eval_data.get("pitchScore", overall_score)))),
        "grammarScore": int(max(0, min(100, eval_data.get("grammarScore", overall_score)))),
        "rhythmScore": int(max(0, min(100, eval_data.get("rhythmScore", overall_score)))),
        "politenessScore": int(max(0, min(100, eval_data.get("politenessScore", eval_data.get("grammarScore", overall_score))))),
        "heardJp": heard_jp,
        "betterJp": better_jp,
        "betterTokens": better_tokens,
        "targetJp": clean_target,
        "drillChunkJp": drill_chunk,
        "drillChunkTokens": drill_chunk_tokens,
        "drillChunkReading": eval_data.get("drillChunkReading") or "",
        "pitchNotation": eval_data.get("pitchNotation") or "",
        "pitchNote": eval_data.get("pitchNote") or "",
        "grammarNote": eval_data.get("grammarNote") or "",
        "praiseCn": eval_data.get("praiseCn") or "",
        "progressNoteCn": eval_data.get("progressNoteCn") or "",
        "actionTipCn": eval_data.get("actionTipCn") or "",
        "pragmaticNoteCn": eval_data.get("pragmaticNoteCn") or "",
        "nativeUpgradeJp": native_upgrade_jp,
        "nativeUpgradeTokens": native_upgrade_tokens,
        "nativeUpgradeNoteCn": eval_data.get("nativeUpgradeNoteCn") or "",
        "resolvedWeaknesses": resolved_weaknesses,
        "issues": issues,
        "heardDiff": token_diff["heardDiff"],
        "targetDiff": token_diff["targetDiff"],
        "matchRatio": token_diff["matchRatio"],
        "teacherSpokenScript": teacher_script,
        "teacherSpokenTts": teacher_spoken_tts,
        "teacherAudioUrl": teacher_audio_url,
        "userAudioUrl": user_audio_url,
        "extractedVocab": eval_data.get("extractedVocab") or [],
        "targetTokens": target_tokens,
        "heardTokens": heard_tokens,
        "modelUsed": eval_data.get("_modelUsed", chosen_model),
        "evalMs": eval_ms,
        "audioStats": audio_stats,
    }

    add_turn(
        session_id=session_id,
        turn_index=step_index * 10 + attempt,
        speaker="student",
        stage=stage,
        target_jp=clean_target,
        transcript_jp=heard_jp,
        tokens=heard_tokens,
        correction=response_payload,
        audio_path=str(turn_audio_path),
        teacher_audio_url=teacher_audio_url,
        turn_id=turn_id,
    )

    if lesson_id:
        is_lesson_done = step_index >= max(0, (total_steps or 6) - 1) and decision in ("pass", "advance")
        upsert_lesson_progress(user_id=user_id, lesson_id=lesson_id, score=overall_score, completed=is_lesson_done)

    record_favorite_practice(user_id=user_id, jp=clean_target, score=overall_score)
    if better_jp and better_jp != clean_target:
        record_favorite_practice(user_id=user_id, jp=better_jp, score=overall_score)

    return response_payload


async def evaluate_live_turn(
    *,
    user_id: str,
    audio_wav_bytes: Optional[bytes],
    transcript_user: str,
    last_ai_jp: str,
    scenario_title: str,
    jlpt_target: str = "N4",
    api_key: str,
) -> Dict[str, Any]:
    """Track-2 asynchronous evaluation for Live Voice Call turns."""
    clean_transcript = strip_foreign_hangul(transcript_user or "")
    if audio_wav_bytes:
        act = analyze_audio_speech_activity(audio_wav_bytes, filename="live.wav", content_type="audio/wav")
        if act.get("analyzed") and not act.get("has_speech") and not clean_transcript:
            return {
                "noSpeech": True,
                "score": 0,
                "isNatural": False,
                "heardJp": "",
                "naturalJp": "",
                "naturalReading": "",
                "pitchTip": "",
                "grammarTip": "",
                "actionTipCn": "",
                "politenessTip": "",
                "issueType": "none",
                "patternKey": "",
                "extractedVocab": [],
            }

    prompt = (
        "你是20年教龄的东京资深日语私教，正在实时旁听学生的日语通话并生成简洁高质量纠错卡。\n"
        f"当前场景: {scenario_title} | 学生目标水平: {jlpt_target}\n"
        f"上一句 AI 说的日语: {last_ai_jp}\n"
        f"本轮用户语音转写: {clean_transcript or '（参考音频）'}\n\n"
        "【评分锚点】95+:母语般自然；88-94:流畅得体仅轻微微瑕；75-87:可懂但有中文腔/平读或小错；<75:助词活用明显有误。\n"
        "请真实基于音频与语境评估：发音声调、拍感、助词语法、敬语得体度。全程严禁输出韩语（한글 / 한국어）。返回严格 JSON：\n"
        "{\n"
        '  "noSpeech": false,\n'
        '  "score": 88,\n'
        '  "isNatural": true,\n'
        '  "heardJp": "如实还原用户说出的日语或中英夹杂句",\n'
        '  "naturalJp": "更像东京当地人的自然说法（若已很地道则与原句一致）",\n'
        '  "naturalReading": "naturalJp 的平假名",\n'
        '  "pitchTip": "最关键的一处发音/高低音提示（若无填无）",\n'
        '  "actionTipCn": "具体口腔动作/停顿拍数微调建议（不超过35字中文）",\n'
        '  "grammarTip": "助词/活用微调建议（不超过35字中文）",\n'
        '  "politenessTip": "语气得体/敬语委婉建议（若恰当留空）",\n'
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
    data = _sanitize_no_hangul(
        await _call_gemini_json(parts=parts, models=models, api_key=api_key, temperature=0.15, timeout_sec=30.0)
    )

    if data.get("patternKey") and data.get("issueType") not in ("", "none", None):
        upsert_weakness(
            user_id=user_id,
            issue_type=data.get("issueType", "grammar"),
            pattern_key=data["patternKey"],
            example_jp=data.get("naturalJp") or clean_transcript,
            note_cn=data.get("grammarTip") or data.get("actionTipCn") or data.get("pitchTip") or "",
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
    res = _sanitize_no_hangul(
        await _call_gemini_json(parts=[{"text": prompt}], models=models, api_key=api_key, temperature=0.3, timeout_sec=15.0)
    )
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
        if corr.get("noSpeech"):
            continue
        issue_tags = ",".join(str(i.get("patternKey") or i.get("type", "")) for i in (corr.get("issues") or [])[:2])
        summary_lines.append(
            f"[{t['speaker']}|stage={t.get('stage') or '-'}|try={corr.get('attempt', 1)}] "
            f"jp={t.get('transcript_jp') or t.get('target_jp')} "
            f"score={corr.get('overallScore', corr.get('score', '-'))} "
            f"polite={corr.get('politenessScore', '-')} "
            f"progress={corr.get('progressNoteCn', '')} "
            f"issues=[{issue_tags}] note={corr.get('actionTipCn') or corr.get('pitchNote', corr.get('grammarTip', ''))}"
        )

    transcript_block = "\n".join(summary_lines[-28:]) or "本场会话尚无完整口语轮次。"
    prompt = (
        "请作为20年教龄的东京日语教学总监，为下面这场刚结束的 1 对 1 日语训练生成课后深度战报（严格 JSON，严禁韩语）：\n"
        f"会话记录：\n{transcript_block}\n\n"
        "请在 summaryCn / praiseHighlights 中特别点出学生在多轮重试（try=1→try=2）里的具体蜕变与突破！\n"
        "JSON Schema:\n"
        "{\n"
        '  "fluencyScore": 85,\n'
        '  "pitchScore": 82,\n'
        '  "keigoScore": 86,\n'
        '  "grammarScore": 84,\n'
        '  "summaryCn": "2–3句鼓励且有干货的整体点评（含第1遍到第2遍进步洞察）",\n'
        '  "praiseHighlights": ["具体表现亮点1", "具体表现亮点2"],\n'
        '  "topMistakes": [{"patternKey": "如 助词は/が", "detailCn": "错因与口腔/语法改法", "betterJp": "正确例句"}],\n'
        '  "nextFocusCn": "明天私教课建议主攻方向"\n'
        "}"
    )

    models = [REPORT_MODEL] + [m for m in REPORT_FALLBACK_MODELS if m != REPORT_MODEL]
    report = _sanitize_no_hangul(
        await _call_gemini_json(parts=[{"text": prompt}], models=models, api_key=api_key, temperature=0.25)
    )

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


async def answer_sensei_followup(
    *,
    question_cn: str,
    target_jp: str = "",
    heard_jp: str = "",
    better_jp: str = "",
    grammar_focus: str = "",
    jlpt_target: str = "N4",
    pitch_note: str = "",
    grammar_note: str = "",
    action_tip: str = "",
    coach_model: Optional[str] = None,
    api_key: str,
) -> Dict[str, Any]:
    """Answer an ad-hoc student follow-up question in Veteran Tokyo Sensei persona."""
    q_clean = strip_foreign_hangul((question_cn or "").strip())
    if not q_clean:
        raise ValueError("请输入想问老师的问题。")

    chosen_model = (coach_model or "").strip()
    if chosen_model not in _ALLOWED_COACH_MODELS:
        chosen_model = COACH_MODEL
    models = [chosen_model] + [m for m in [COACH_MODEL, *COACH_FALLBACK_MODELS] if m != chosen_model]

    clean_target = strip_furigana_parens(target_jp)
    clean_better = strip_furigana_parens(better_jp)
    clean_heard = strip_furigana_parens(heard_jp)

    prompt = (
        "你是拥有20年教龄的东京日语私教，学生刚练习完下面这句话并提出了追问。\n"
        f"目标级别：{jlpt_target} | 本课语法焦点：{grammar_focus or '日常表达'}\n"
        f"目标句：{clean_target}\n"
        f"学生刚才读成：{clean_heard or '（未记录）'}\n"
        f"标准示范句：{clean_better or clean_target}\n"
        f"刚才批改摘要：音调[{pitch_note}] | 语法[{grammar_note}] | 动作处方[{action_tip}]\n\n"
        f"【学生追问】：{q_clean}\n\n"
        "请用温柔、有条理的中文直接回答学生的疑惑（不超过120字），结合东京真实日常/旅行语境点透「为什么」或「怎么切换礼貌度」，并给出最多2个简短鲜活的双语对照例句。\n"
        "【重要】：spokenSummaryCn 用于语音朗读：用20–45字纯中文口语先总结结论（句号收尾），如附日语短句必须另起一句写纯日语，全程严禁英文/罗马音/星号/韩语！\n"
        '严格输出 JSON：{"answerCn":"清晰有深度的中文解答","spokenSummaryCn":"纯中文口播总结。可选纯日语短句","examples":[{"jp":"规范日语例句","cn":"中文意思与使用场景"}]}'
    )

    res = _sanitize_no_hangul(
        await _call_gemini_json(
            parts=[{"text": prompt}],
            models=models,
            api_key=api_key,
            temperature=0.25,
            timeout_sec=14.0,
        )
    )

    examples_raw = (res.get("examples") or [])[:2]
    examples: List[Dict[str, Any]] = []
    jp_hints = [clean_target, clean_better]
    for ex in examples_raw:
        ex_jp = strip_furigana_parens(ex.get("jp") or "")
        if not ex_jp:
            continue
        jp_hints.append(ex_jp)
        examples.append(
            {
                "jp": ex_jp,
                "cn": ex.get("cn") or "",
                "tokens": tokenize_sentence(ex_jp),
            }
        )

    spoken = (res.get("spokenSummaryCn") or "").strip() or (res.get("answerCn") or "")[:50]
    spoken_tts = prepare_tts_bilingual_script(spoken, jp_hints)

    return {
        "answerCn": (res.get("answerCn") or "").strip(),
        "examples": examples,
        "spokenSummaryCn": spoken,
        "spokenSummaryTts": spoken_tts,
        "modelUsed": res.get("_modelUsed", chosen_model),
    }
