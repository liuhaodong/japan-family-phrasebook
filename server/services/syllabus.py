"""Veteran Japanese Sensei 8-Unit, 32-Lesson Progressive Textbook Syllabus (N5 -> N3 Spoken Mastery)."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List, Optional

_DATA_PATH = Path(__file__).resolve().parent.parent / "data" / "textbook_syllabus.json"


def _load_syllabus_data() -> Dict[str, Any]:
    raw = json.loads(_DATA_PATH.read_text(encoding="utf-8"))
    tracks = list(raw.get("tracks") or [])
    lessons = sorted(list(raw.get("lessons") or []), key=lambda x: int(x.get("order") or 999))
    return {"tracks": tracks, "lessons": lessons}


_SYLLABUS_DATA = _load_syllabus_data()
SENSEI_TRACKS: List[Dict[str, Any]] = _SYLLABUS_DATA["tracks"]
SENSEI_LESSONS: List[Dict[str, Any]] = _SYLLABUS_DATA["lessons"]
_LESSONS_BY_ID: Dict[str, Dict[str, Any]] = {l["id"]: l for l in SENSEI_LESSONS}


def get_syllabus_lesson(lesson_id: Optional[str]) -> Optional[Dict[str, Any]]:
    if not lesson_id:
        return None
    return _LESSONS_BY_ID.get(lesson_id.strip())


def get_syllabus_overview(
    progress_map: Dict[str, Dict[str, Any]],
    jlpt_target: str = "N4",
) -> Dict[str, Any]:
    """Build grouped textbook units, progress status badges, and next recommended lessons."""
    enriched_lessons: List[Dict[str, Any]] = []
    recommended: Optional[Dict[str, Any]] = None
    recommended_by_level: Dict[str, Optional[Dict[str, Any]]] = {"N5": None, "N4": None, "N3": None}
    first_by_level: Dict[str, Optional[Dict[str, Any]]] = {"N5": None, "N4": None, "N3": None}
    completed_count = 0

    for lesson in SENSEI_LESSONS:
        prog = progress_map.get(lesson["id"]) or {}
        status = prog.get("status") or "not_started"
        best_score = int(prog.get("best_score") or 0)
        attempts = int(prog.get("attempts") or 0)
        if status == "completed":
            completed_count += 1

        lvl = (lesson.get("level") or "N5").upper()
        vocab_list = lesson.get("vocabList") or []
        grammar_notes = lesson.get("grammarNotes") or []
        entry = {
            "id": lesson["id"],
            "order": lesson["order"],
            "trackId": lesson["trackId"],
            "trackTitle": lesson["trackTitle"],
            "level": lvl,
            "estimatedMin": int(lesson.get("estimatedMin") or 12),
            "title": lesson["title"],
            "subtitle": lesson["subtitle"],
            "canDoCn": lesson.get("canDoCn") or lesson["subtitle"],
            "grammarFocus": lesson["grammarFocus"],
            "cnPitfall": lesson["cnPitfall"],
            "keyPatterns": lesson["keyPatterns"],
            "vocabPreview": vocab_list[:4],
            "grammarCount": len(grammar_notes),
            "hasReading": bool((lesson.get("readingPassage") or {}).get("jp")),
            "status": status,
            "bestScore": best_score,
            "attempts": attempts,
        }
        enriched_lessons.append(entry)
        if lvl in first_by_level and first_by_level[lvl] is None:
            first_by_level[lvl] = entry
        if recommended is None and status != "completed":
            recommended = entry
        if lvl in recommended_by_level and recommended_by_level[lvl] is None and status != "completed":
            recommended_by_level[lvl] = entry

    if recommended is None and enriched_lessons:
        recommended = enriched_lessons[0]
    for lvl in ("N5", "N4", "N3"):
        if recommended_by_level[lvl] is None:
            recommended_by_level[lvl] = first_by_level[lvl]

    tracks_out: List[Dict[str, Any]] = []
    for tr in SENSEI_TRACKS:
        tr_lessons = [l for l in enriched_lessons if l["trackId"] == tr["id"]]
        tracks_out.append({**tr, "lessons": tr_lessons})

    return {
        "jlptTarget": jlpt_target,
        "totalCount": len(SENSEI_LESSONS),
        "completedCount": completed_count,
        "recommendedLesson": recommended,
        "recommendedByLevel": recommended_by_level,
        "tracks": tracks_out,
        "lessons": enriched_lessons,
    }
