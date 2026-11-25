"""FSRS spaced-repetition scheduler & SQLite card persistence."""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from fsrs import Card, Rating, Scheduler

from server.config import DB_PATH
from server.db import get_conn, utc_now_iso

_SCHEDULER = Scheduler()

_RATING_MAP = {
    1: Rating.Again,
    "again": Rating.Again,
    2: Rating.Hard,
    "hard": Rating.Hard,
    3: Rating.Good,
    "good": Rating.Good,
    4: Rating.Easy,
    "easy": Rating.Easy,
}


def _row_to_card_dict(row: Any) -> Dict[str, Any]:
    d = dict(row)
    state = json.loads(d.get("fsrs_state_json") or "{}")
    d["fsrs_state"] = state
    d["reps"] = state.get("step") or 0
    d["stability"] = state.get("stability")
    d["difficulty"] = state.get("difficulty")
    return d


def add_or_update_card(
    user_id: str,
    surface: str,
    lemma: Optional[str] = None,
    reading: str = "",
    pitch_accent: str = "",
    meaning_cn: str = "",
    jlpt: str = "",
    context_jp: str = "",
    source_type: str = "sensei",
    db_path: Optional[Path] = None,
) -> Dict[str, Any]:
    clean_surface = (surface or "").strip()
    clean_lemma = (lemma or clean_surface).strip()
    if not clean_surface:
        raise ValueError("词卡日语表面词形不能为空。")

    with get_conn(db_path) as conn:
        existing = conn.execute(
            "SELECT * FROM vocab_cards WHERE user_id = ? AND lemma = ? AND surface = ?",
            (user_id, clean_lemma, clean_surface),
        ).fetchone()
        if existing:
            conn.execute(
                """
                UPDATE vocab_cards
                SET reading = CASE WHEN ? != '' THEN ? ELSE reading END,
                    pitch_accent = CASE WHEN ? != '' THEN ? ELSE pitch_accent END,
                    meaning_cn = CASE WHEN ? != '' THEN ? ELSE meaning_cn END,
                    jlpt = CASE WHEN ? != '' THEN ? ELSE jlpt END,
                    context_jp = CASE WHEN ? != '' THEN ? ELSE context_jp END
                WHERE id = ?
                """,
                (
                    reading,
                    reading,
                    pitch_accent,
                    pitch_accent,
                    meaning_cn,
                    meaning_cn,
                    jlpt,
                    jlpt,
                    context_jp,
                    context_jp,
                    existing["id"],
                ),
            )
            refreshed = conn.execute("SELECT * FROM vocab_cards WHERE id = ?", (existing["id"],)).fetchone()
            return _row_to_card_dict(refreshed)

        card = Card()
        card_json = card.to_json()
        next_due = card.due.isoformat() if card.due else utc_now_iso()
        cid = f"card_{uuid.uuid4().hex[:10]}"
        conn.execute(
            """
            INSERT INTO vocab_cards (
                id, user_id, surface, lemma, reading, pitch_accent,
                meaning_cn, jlpt, context_jp, source_type, fsrs_state_json, next_due, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                cid,
                user_id,
                clean_surface,
                clean_lemma,
                reading,
                pitch_accent,
                meaning_cn,
                jlpt,
                context_jp,
                source_type,
                card_json,
                next_due,
                utc_now_iso(),
            ),
        )
        created = conn.execute("SELECT * FROM vocab_cards WHERE id = ?", (cid,)).fetchone()
        return _row_to_card_dict(created)


def list_cards(
    user_id: str,
    due_only: bool = False,
    limit: int = 200,
    db_path: Optional[Path] = None,
) -> List[Dict[str, Any]]:
    now_iso = datetime.now(timezone.utc).isoformat()
    with get_conn(db_path) as conn:
        if due_only:
            rows = conn.execute(
                "SELECT * FROM vocab_cards WHERE user_id = ? AND next_due <= ? ORDER BY next_due ASC LIMIT ?",
                (user_id, now_iso, limit),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM vocab_cards WHERE user_id = ? ORDER BY next_due ASC, created_at DESC LIMIT ?",
                (user_id, limit),
            ).fetchall()
        return [_row_to_card_dict(r) for r in rows]


def review_card(
    user_id: str,
    card_id: str,
    rating: Any,
    db_path: Optional[Path] = None,
) -> Dict[str, Any]:
    norm_rating = _RATING_MAP.get(
        rating.lower() if isinstance(rating, str) else rating
    )
    if norm_rating is None:
        raise ValueError("评分无效，请传入 1(Again)/2(Hard)/3(Good)/4(Easy)。")

    with get_conn(db_path) as conn:
        row = conn.execute(
            "SELECT * FROM vocab_cards WHERE id = ? AND user_id = ?",
            (card_id, user_id),
        ).fetchone()
        if not row:
            raise KeyError(f"未找到词卡 {card_id}")

        card = Card.from_json(row["fsrs_state_json"])
        now_dt = datetime.now(timezone.utc)
        updated_card, _review_log = _SCHEDULER.review_card(card, norm_rating, review_datetime=now_dt)
        next_due = updated_card.due.isoformat() if updated_card.due else utc_now_iso()

        conn.execute(
            "UPDATE vocab_cards SET fsrs_state_json = ?, next_due = ? WHERE id = ?",
            (updated_card.to_json(), next_due, card_id),
        )
        refreshed = conn.execute("SELECT * FROM vocab_cards WHERE id = ?", (card_id,)).fetchone()
        return _row_to_card_dict(refreshed)


def delete_card(user_id: str, card_id: str, db_path: Optional[Path] = None) -> bool:
    with get_conn(db_path) as conn:
        cur = conn.execute(
            "DELETE FROM vocab_cards WHERE id = ? AND user_id = ?",
            (card_id, user_id),
        )
        return cur.rowcount > 0


def import_legacy_items(
    user_id: str,
    items: List[Dict[str, Any]],
    db_path: Optional[Path] = None,
) -> int:
    """Import starred phrasebook / learning items into the unified FSRS deck."""
    imported = 0
    for item in items:
        surface = (item.get("jp") or item.get("surface") or "").strip()
        if not surface:
            continue
        add_or_update_card(
            user_id=user_id,
            surface=surface,
            lemma=(item.get("lemma") or surface).strip(),
            reading=(item.get("kana") or item.get("reading") or item.get("romaji") or "").strip(),
            pitch_accent=(item.get("pitch_accent") or "").strip(),
            meaning_cn=(item.get("cn") or item.get("meaning_cn") or "").strip(),
            jlpt=(item.get("jlpt") or "Travel").strip(),
            context_jp=(item.get("context_jp") or surface).strip(),
            source_type="legacy_import",
            db_path=db_path,
        )
        imported += 1
    return imported
