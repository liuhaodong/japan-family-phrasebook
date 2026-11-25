"""Japanese morphological tokenization (SudachiPy) + corpus & LLM dictionary lookup."""

from __future__ import annotations

import json
import re
from typing import Any, Dict, List, Optional

import httpx
import sudachipy

from server.config import COACH_FALLBACK_MODELS, COACH_MODEL, GEMINI_API_BASE
from server.db import get_dict_cache, save_dict_cache
from server.services.curriculum_loader import lookup_corpus_gloss

_TOKENIZER = sudachipy.Dictionary().tokenizer()
_SPLIT_MODE = sudachipy.SplitMode.B
_NON_CONTENT_POS = {"補助記号", "空白"}
_FUNCTIONAL_POS = {"助詞", "助動詞"}
_FURIGANA_PAREN_RE = re.compile(r"[（(]([^()（）]+)[）)]")
_KANJI_RE = re.compile(r"[\u4e00-\u9fff]")
_KANA_RE = re.compile(r"[\u3040-\u30ff]")


def strip_furigana_parens(text: str) -> str:
    """Convert '近（ちか）くから来（き）ました' into clean '近くから来ました'."""
    return _FURIGANA_PAREN_RE.sub("", text or "").strip()


def has_kana(text: str) -> bool:
    return bool(_KANA_RE.search(text or ""))


def has_kanji(text: str) -> bool:
    return bool(_KANJI_RE.search(text or ""))


def kata_to_hira(text: str) -> str:
    """Convert Katakana string to Hiragana."""
    chars = []
    for ch in text or "":
        code = ord(ch)
        if 0x30A1 <= code <= 0x30F6:
            chars.append(chr(code - 0x60))
        else:
            chars.append(ch)
    return "".join(chars)


def _spoken_reading_hira(morphemes: List[Any], idx: int) -> str:
    """Normalize formal dictionary readings (私/明日/何/何時) to natural spoken Tokyo hiragana."""
    m = morphemes[idx]
    surf = m.surface()
    prev_surf = morphemes[idx - 1].surface() if idx > 0 else ""
    next_surf = morphemes[idx + 1].surface() if idx + 1 < len(morphemes) else ""
    if surf == "私":
        return "わたし"
    if surf == "明日":
        return "あした"
    if surf == "何時":
        return "なんじ"
    if surf == "何" and next_surf in ("を", "が", "も", "か", "に", "より"):
        return "なに"
    if surf == "時" and (prev_surf in ("何", "零", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十") or prev_surf.isdigit()):
        return "じ"
    return kata_to_hira(m.reading_form() or surf)


def jp_to_kana(text: str) -> str:
    """Convert Japanese text with kanji into pure hiragana/katakana for reliable TTS."""
    clean = strip_furigana_parens(text)
    if not clean:
        return ""
    if not has_kanji(clean):
        return clean
    morphemes = list(_TOKENIZER.tokenize(clean, _SPLIT_MODE))
    out: List[str] = []
    for idx, m in enumerate(morphemes):
        surf = m.surface()
        if _KANJI_RE.search(surf):
            out.append(_spoken_reading_hira(morphemes, idx))
        else:
            out.append(surf)
    return "".join(out)


def tokenize_sentence(text: str) -> List[Dict[str, Any]]:
    """Tokenize Japanese text into interactive Tap-Any-Word morpheme chips."""
    clean = strip_furigana_parens(text)
    if not clean:
        return []

    morphemes = list(_TOKENIZER.tokenize(clean, _SPLIT_MODE))
    tokens: List[Dict[str, Any]] = []
    for idx, m in enumerate(morphemes):
        surface = m.surface()
        pos_tuple = m.part_of_speech()
        pos_major = pos_tuple[0] if pos_tuple else ""
        if pos_major in _NON_CONTENT_POS or not surface.strip():
            tokens.append(
                {
                    "surface": surface,
                    "lemma": m.dictionary_form(),
                    "reading": "",
                    "pos": pos_major,
                    "is_content_word": False,
                    "meaning_cn": "",
                    "jlpt": "",
                    "pitch_accent": "",
                }
            )
            continue

        lemma = m.dictionary_form()
        reading_hira = _spoken_reading_hira(morphemes, idx)
        gloss = lookup_corpus_gloss(lemma) or lookup_corpus_gloss(surface) or {}
        cached = get_dict_cache(lemma) or get_dict_cache(surface) or {}
        cached_reading = cached.get("reading") or ""
        if surface == "私" and cached_reading == "わたくし":
            cached_reading = ""

        meaning_cn = cached.get("meaning_cn") or gloss.get("meaning_cn") or ""
        jlpt = cached.get("jlpt") or gloss.get("jlpt") or ""
        pitch_accent = cached.get("pitch_accent") or gloss.get("pitch_accent") or ""

        tokens.append(
            {
                "surface": surface,
                "lemma": lemma,
                "reading": cached_reading or reading_hira,
                "pos": pos_major,
                "is_content_word": pos_major not in _FUNCTIONAL_POS,
                "meaning_cn": meaning_cn,
                "jlpt": jlpt,
                "pitch_accent": pitch_accent,
            }
        )
    return tokens


async def define_word(
    surface: str,
    lemma: Optional[str] = None,
    reading: str = "",
    context_jp: str = "",
    api_key: Optional[str] = None,
) -> Dict[str, Any]:
    """Return dictionary entry for a tapped token, caching LLM lookups in SQLite."""
    clean_surface = (surface or "").strip()
    clean_lemma = (lemma or clean_surface).strip()
    if not clean_lemma:
        raise ValueError("词条不能为空。")

    cached = get_dict_cache(clean_lemma)
    if cached and cached.get("meaning_cn"):
        return {**cached, "surface": clean_surface, "source": "cache"}

    corpus = lookup_corpus_gloss(clean_lemma) or lookup_corpus_gloss(clean_surface)
    if corpus and corpus.get("meaning_cn") and not api_key:
        entry = {
            "lemma": clean_lemma,
            "surface": clean_surface,
            "reading": corpus.get("reading") or reading,
            "pitch_accent": corpus.get("pitch_accent") or "",
            "jlpt": corpus.get("jlpt") or "N4",
            "meaning_cn": corpus.get("meaning_cn") or "",
            "grammar_note": corpus.get("tip") or "",
            "example_jp": corpus.get("example_jp") or context_jp,
            "example_cn": corpus.get("example_cn") or "",
            "source": "corpus",
        }
        return entry

    if not api_key:
        return {
            "lemma": clean_lemma,
            "surface": clean_surface,
            "reading": reading,
            "pitch_accent": "",
            "jlpt": (corpus or {}).get("jlpt", ""),
            "meaning_cn": (corpus or {}).get("meaning_cn", "暂无离线释义，配置 Gemini Key 后可实时查词"),
            "grammar_note": "",
            "example_jp": context_jp,
            "example_cn": "",
            "source": "fallback",
        }

    prompt = (
        f"请为日语学习者解释下面这个词条，返回严格 JSON：\n"
        f"- 句中形式: {clean_surface}\n"
        f"- 辞书原形: {clean_lemma}\n"
        f"- 假名读音: {reading}\n"
        f"- 所在例句: {strip_furigana_parens(context_jp)}\n\n"
        "JSON Schema:\n"
        "{\n"
        '  "lemma": "辞书形",\n'
        '  "reading": "纯平假名读音",\n'
        '  "pitch_accent": "东京音调核与标号，如 [0] 平板型 或 [2] 中高型 (あず＼ける)",\n'
        '  "jlpt": "N5|N4|N3|N2|N1",\n'
        '  "meaning_cn": "简明中文释义（15字以内，含词性）",\n'
        '  "grammar_note": "用法/活用或敬语提示（35字以内）",\n'
        '  "example_jp": "自然实用日本旅行/日常例句",\n'
        '  "example_cn": "例句中文翻译"\n'
        "}"
    )

    payload = {
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": {
            "temperature": 0.1,
            "responseMimeType": "application/json",
            "thinkingConfig": {"thinkingLevel": "LOW"},
        },
    }

    models = [COACH_MODEL] + [m for m in COACH_FALLBACK_MODELS if m != COACH_MODEL]
    async with httpx.AsyncClient(timeout=25.0) as client:
        for mdl in models:
            try:
                resp = await client.post(
                    f"{GEMINI_API_BASE}/models/{mdl}:generateContent",
                    headers={"x-goog-api-key": api_key, "Content-Type": "application/json"},
                    json=payload,
                )
                if resp.status_code >= 400:
                    continue
                data = resp.json()
                raw_text = (
                    data.get("candidates", [{}])[0]
                    .get("content", {})
                    .get("parts", [{}])[0]
                    .get("text", "")
                )
                parsed = json.loads(raw_text)
                entry = {
                    "lemma": parsed.get("lemma") or clean_lemma,
                    "reading": parsed.get("reading") or reading,
                    "pitch_accent": parsed.get("pitch_accent") or "",
                    "jlpt": parsed.get("jlpt") or "N4",
                    "meaning_cn": parsed.get("meaning_cn") or "",
                    "grammar_note": parsed.get("grammar_note") or "",
                    "example_jp": parsed.get("example_jp") or context_jp,
                    "example_cn": parsed.get("example_cn") or "",
                }
                save_dict_cache(entry)
                return {**entry, "surface": clean_surface, "source": mdl}
            except Exception:
                continue

    return {
        "lemma": clean_lemma,
        "surface": clean_surface,
        "reading": reading or (corpus or {}).get("reading", ""),
        "pitch_accent": "",
        "jlpt": (corpus or {}).get("jlpt", ""),
        "meaning_cn": (corpus or {}).get("meaning_cn", "查词请求暂时失败，请稍后重试"),
        "grammar_note": "",
        "example_jp": context_jp,
        "example_cn": "",
        "source": "fallback",
    }
