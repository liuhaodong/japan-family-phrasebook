"""Personalized graded Japanese audio story generator embedding FSRS due vocab."""

from __future__ import annotations

from typing import Any, Dict, List

from server.config import (
    DEFAULT_VOICE,
    REPORT_FALLBACK_MODELS,
    REPORT_MODEL,
    TTS_STORY_MODEL,
)
from server.db import list_stories, save_story
from server.services.curriculum_loader import get_scenario
from server.services.jp_tokenizer import tokenize_sentence
from server.services.sensei_engine import _call_gemini_json
from server.services.srs_service import list_cards
from server.services.tts_service import synthesize_speech


async def generate_graded_story(
    *,
    user_id: str,
    jlpt_level: str = "N4",
    scenario_id: str = "daily_konbini",
    voice: str = DEFAULT_VOICE,
    api_key: str,
) -> Dict[str, Any]:
    """Create a short natural Japanese audio story weaving due FSRS vocabulary."""
    cards = list_cards(user_id, due_only=True, limit=6) or list_cards(user_id, due_only=False, limit=6)
    scenario = get_scenario(scenario_id) or {}

    if cards:
        vocab_list = [f"{c['surface']}（{c.get('meaning_cn') or c.get('reading') or ''}）" for c in cards]
        raw_vocab = [c["surface"] for c in cards]
    else:
        raw_vocab = ["予約", "荷物", "預ける", "子連れ", "おすすめ"]
        vocab_list = ["予約（预约）", "荷物（行李）", "預ける（寄存）", "子連れ（带娃）", "おすすめ（推荐）"]

    prompt = (
        f"请为目标水平 {jlpt_level} 的中国学习者家庭（爸爸浩东、妈妈Sherry、女儿Jinny 6岁半与Jaycie 2岁半）创作一段真实、好听的日本旅行短剧故事（5–7 句对话或旁白）。\n"
        f"主题场景：{scenario.get('title', '日本家庭旅行日常')}\n"
        f"务必自然嵌入这些目标词汇：{'、'.join(vocab_list)}\n\n"
        "严格返回 JSON：\n"
        "{\n"
        '  "title_jp": "纯日语标题",\n'
        '  "title_cn": "中文标题",\n'
        '  "segments": [\n'
        '    {"speaker": "ナレーション|浩東|店員|スタッフ", "jp": "纯日语台词（不加注音括号）", "reading": "平假名读法", "cn": "自然中文翻译"}\n'
        "  ],\n"
        '  "comprehension": {\n'
        '    "question_jp": "故事结束后的1个日语小提问",\n'
        '    "question_cn": "问题中文意思",\n'
        '    "sample_answer_jp": "推荐日语简短回答",\n'
        '    "sample_answer_cn": "参考答案中文"\n'
        "  }\n"
        "}"
    )

    models = [REPORT_MODEL] + [m for m in REPORT_FALLBACK_MODELS if m != REPORT_MODEL]
    story_data = await _call_gemini_json(parts=[{"text": prompt}], models=models, api_key=api_key, temperature=0.45)

    segments: List[Dict[str, Any]] = []
    spoken_lines: List[str] = []
    for seg in story_data.get("segments") or []:
        jp_text = (seg.get("jp") or "").strip()
        if not jp_text:
            continue
        spoken_lines.append(jp_text)
        segments.append(
            {
                "speaker": seg.get("speaker") or "ナレーション",
                "jp": jp_text,
                "reading": seg.get("reading") or "",
                "cn": seg.get("cn") or "",
                "tokens": tokenize_sentence(jp_text),
            }
        )

    full_audio_script = " ".join(spoken_lines) or story_data.get("title_jp") or "今日はいい天気ですね。"
    tts_res = await synthesize_speech(
        full_audio_script,
        api_key=api_key,
        voice=voice,
        model=TTS_STORY_MODEL,
    )

    return save_story(
        user_id=user_id,
        title_jp=story_data.get("title_jp") or "日本旅行の一日",
        title_cn=story_data.get("title_cn") or "日本旅行小故事",
        jlpt_level=jlpt_level,
        target_vocab=raw_vocab,
        script=segments,
        comprehension=story_data.get("comprehension") or {},
        audio_path=tts_res["audio_url"],
    )


def fetch_stories(user_id: str, limit: int = 10) -> List[Dict[str, Any]]:
    return list_stories(user_id=user_id, limit=limit)
