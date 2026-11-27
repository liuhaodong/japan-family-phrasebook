"""SQLite persistence layer for Nihongo Sensei AI."""

from __future__ import annotations

import json
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterator, List, Optional

from server.config import DB_PATH


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _connect(db_path: Optional[Path] = None) -> sqlite3.Connection:
    conn = sqlite3.connect(str(db_path or DB_PATH), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA foreign_keys=ON;")
    return conn


@contextmanager
def get_conn(db_path: Optional[Path] = None) -> Iterator[sqlite3.Connection]:
    conn = _connect(db_path)
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_db(db_path: Optional[Path] = None) -> None:
    """Create schema tables and seed default family profiles."""
    with get_conn(db_path) as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                display_name TEXT NOT NULL,
                jlpt_target TEXT DEFAULT 'N4',
                preferred_voice TEXT DEFAULT 'Aoede',
                correction_mode TEXT DEFAULT 'strict',
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS call_sessions (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                mode TEXT NOT NULL,
                scenario_id TEXT NOT NULL,
                persona TEXT DEFAULT '',
                lesson_plan_json TEXT DEFAULT '{}',
                started_at TEXT NOT NULL,
                ended_at TEXT DEFAULT '',
                duration_sec INTEGER DEFAULT 0,
                report_json TEXT DEFAULT ''
            );

            CREATE TABLE IF NOT EXISTS call_turns (
                id TEXT PRIMARY KEY,
                session_id TEXT NOT NULL,
                turn_index INTEGER NOT NULL,
                speaker TEXT NOT NULL,
                stage TEXT DEFAULT '',
                target_jp TEXT DEFAULT '',
                transcript_jp TEXT DEFAULT '',
                tokens_json TEXT DEFAULT '[]',
                correction_json TEXT DEFAULT '{}',
                audio_path TEXT DEFAULT '',
                teacher_audio_url TEXT DEFAULT '',
                created_at TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_turns_session ON call_turns(session_id, turn_index);

            CREATE TABLE IF NOT EXISTS vocab_cards (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                surface TEXT NOT NULL,
                lemma TEXT NOT NULL,
                reading TEXT DEFAULT '',
                pitch_accent TEXT DEFAULT '',
                meaning_cn TEXT DEFAULT '',
                jlpt TEXT DEFAULT '',
                context_jp TEXT DEFAULT '',
                source_type TEXT DEFAULT 'manual',
                fsrs_state_json TEXT NOT NULL,
                next_due TEXT NOT NULL,
                created_at TEXT NOT NULL,
                UNIQUE(user_id, lemma, surface)
            );

            CREATE INDEX IF NOT EXISTS idx_vocab_due ON vocab_cards(user_id, next_due);

            CREATE TABLE IF NOT EXISTS weakness_memory (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                issue_type TEXT NOT NULL,
                pattern_key TEXT NOT NULL,
                example_jp TEXT DEFAULT '',
                note_cn TEXT DEFAULT '',
                occurrences INTEGER DEFAULT 1,
                last_seen_at TEXT NOT NULL,
                UNIQUE(user_id, issue_type, pattern_key)
            );

            CREATE TABLE IF NOT EXISTS stories (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                title_jp TEXT NOT NULL,
                title_cn TEXT DEFAULT '',
                jlpt_level TEXT DEFAULT 'N4',
                target_vocab_json TEXT DEFAULT '[]',
                script_json TEXT DEFAULT '[]',
                comprehension_json TEXT DEFAULT '{}',
                audio_path TEXT DEFAULT '',
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS dict_cache (
                lemma TEXT PRIMARY KEY,
                reading TEXT DEFAULT '',
                pitch_accent TEXT DEFAULT '',
                jlpt TEXT DEFAULT '',
                meaning_cn TEXT DEFAULT '',
                grammar_note TEXT DEFAULT '',
                example_jp TEXT DEFAULT '',
                example_cn TEXT DEFAULT '',
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS lesson_progress (
                user_id TEXT NOT NULL,
                lesson_id TEXT NOT NULL,
                status TEXT DEFAULT 'in_progress',
                best_score INTEGER DEFAULT 0,
                attempts INTEGER DEFAULT 0,
                last_studied_at TEXT NOT NULL,
                PRIMARY KEY(user_id, lesson_id)
            );
            """
        )

        now = utc_now_iso()
        wk_cols = {r["name"] for r in conn.execute("PRAGMA table_info(weakness_memory)").fetchall()}
        if "mastered_streak" not in wk_cols:
            conn.execute("ALTER TABLE weakness_memory ADD COLUMN mastered_streak INTEGER DEFAULT 0")
        for uid, name, jlpt in [
            ("haodong", "刘浩东", "N4"),
            ("sherry", "Sherry", "N5"),
        ]:
            conn.execute(
                """
                INSERT OR IGNORE INTO users (id, display_name, jlpt_target, preferred_voice, correction_mode, created_at)
                VALUES (?, ?, ?, 'Aoede', 'strict', ?)
                """,
                (uid, name, jlpt, now),
            )


def list_users(db_path: Optional[Path] = None) -> List[Dict[str, Any]]:
    with get_conn(db_path) as conn:
        rows = conn.execute("SELECT * FROM users ORDER BY created_at ASC").fetchall()
        return [dict(r) for r in rows]


def update_user_prefs(
    user_id: str,
    jlpt_target: Optional[str] = None,
    preferred_voice: Optional[str] = None,
    correction_mode: Optional[str] = None,
    db_path: Optional[Path] = None,
) -> Dict[str, Any]:
    with get_conn(db_path) as conn:
        row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        if not row:
            conn.execute(
                "INSERT INTO users (id, display_name, jlpt_target, preferred_voice, correction_mode, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                (
                    user_id,
                    user_id,
                    jlpt_target or "N4",
                    preferred_voice or "Aoede",
                    correction_mode or "strict",
                    utc_now_iso(),
                ),
            )
        else:
            conn.execute(
                """
                UPDATE users
                SET jlpt_target = COALESCE(?, jlpt_target),
                    preferred_voice = COALESCE(?, preferred_voice),
                    correction_mode = COALESCE(?, correction_mode)
                WHERE id = ?
                """,
                (jlpt_target, preferred_voice, correction_mode, user_id),
            )
        updated = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        return dict(updated)


def create_session(
    user_id: str,
    mode: str,
    scenario_id: str,
    persona: str = "",
    lesson_plan: Optional[Dict[str, Any]] = None,
    session_id: Optional[str] = None,
    db_path: Optional[Path] = None,
) -> str:
    sid = session_id or f"sess_{uuid.uuid4().hex[:12]}"
    with get_conn(db_path) as conn:
        conn.execute(
            """
            INSERT INTO call_sessions (id, user_id, mode, scenario_id, persona, lesson_plan_json, started_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                sid,
                user_id,
                mode,
                scenario_id,
                persona,
                json.dumps(lesson_plan or {}, ensure_ascii=False),
                utc_now_iso(),
            ),
        )
    return sid


def get_session(session_id: str, db_path: Optional[Path] = None) -> Optional[Dict[str, Any]]:
    with get_conn(db_path) as conn:
        row = conn.execute("SELECT * FROM call_sessions WHERE id = ?", (session_id,)).fetchone()
        if not row:
            return None
        d = dict(row)
        d["lesson_plan"] = json.loads(d.get("lesson_plan_json") or "{}")
        d["report"] = json.loads(d["report_json"]) if d.get("report_json") else None
        return d


def finish_session(
    session_id: str,
    duration_sec: int = 0,
    report: Optional[Dict[str, Any]] = None,
    db_path: Optional[Path] = None,
) -> None:
    with get_conn(db_path) as conn:
        conn.execute(
            """
            UPDATE call_sessions
            SET ended_at = ?,
                duration_sec = CASE WHEN ? > 0 THEN ? ELSE duration_sec END,
                report_json = CASE WHEN ? != '' THEN ? ELSE report_json END
            WHERE id = ?
            """,
            (
                utc_now_iso(),
                duration_sec,
                duration_sec,
                json.dumps(report, ensure_ascii=False) if report else "",
                json.dumps(report, ensure_ascii=False) if report else "",
                session_id,
            ),
        )


def add_turn(
    session_id: str,
    turn_index: int,
    speaker: str,
    transcript_jp: str = "",
    stage: str = "",
    target_jp: str = "",
    tokens: Optional[List[Dict[str, Any]]] = None,
    correction: Optional[Dict[str, Any]] = None,
    audio_path: str = "",
    teacher_audio_url: str = "",
    turn_id: Optional[str] = None,
    db_path: Optional[Path] = None,
) -> str:
    tid = turn_id or f"turn_{uuid.uuid4().hex[:12]}"
    with get_conn(db_path) as conn:
        conn.execute(
            """
            INSERT INTO call_turns (
                id, session_id, turn_index, speaker, stage, target_jp,
                transcript_jp, tokens_json, correction_json, audio_path, teacher_audio_url, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                tid,
                session_id,
                turn_index,
                speaker,
                stage,
                target_jp,
                transcript_jp,
                json.dumps(tokens or [], ensure_ascii=False),
                json.dumps(correction or {}, ensure_ascii=False),
                audio_path,
                teacher_audio_url,
                utc_now_iso(),
            ),
        )
    return tid


def update_turn_correction(
    turn_id: str,
    correction: Dict[str, Any],
    tokens: Optional[List[Dict[str, Any]]] = None,
    db_path: Optional[Path] = None,
) -> None:
    with get_conn(db_path) as conn:
        if tokens is not None:
            conn.execute(
                "UPDATE call_turns SET correction_json = ?, tokens_json = ? WHERE id = ?",
                (json.dumps(correction, ensure_ascii=False), json.dumps(tokens, ensure_ascii=False), turn_id),
            )
        else:
            conn.execute(
                "UPDATE call_turns SET correction_json = ? WHERE id = ?",
                (json.dumps(correction, ensure_ascii=False), turn_id),
            )


def list_session_turns(session_id: str, db_path: Optional[Path] = None) -> List[Dict[str, Any]]:
    with get_conn(db_path) as conn:
        rows = conn.execute(
            "SELECT * FROM call_turns WHERE session_id = ? ORDER BY turn_index ASC, created_at ASC",
            (session_id,),
        ).fetchall()
        out = []
        for r in rows:
            d = dict(r)
            d["tokens"] = json.loads(d.get("tokens_json") or "[]")
            d["correction"] = json.loads(d.get("correction_json") or "{}")
            out.append(d)
        return out


def list_recent_sessions(user_id: str, limit: int = 12, db_path: Optional[Path] = None) -> List[Dict[str, Any]]:
    with get_conn(db_path) as conn:
        rows = conn.execute(
            "SELECT * FROM call_sessions WHERE user_id = ? ORDER BY started_at DESC LIMIT ?",
            (user_id, limit),
        ).fetchall()
        out = []
        for r in rows:
            d = dict(r)
            d["report"] = json.loads(d["report_json"]) if d.get("report_json") else None
            out.append(d)
        return out


def upsert_weakness(
    user_id: str,
    issue_type: str,
    pattern_key: str,
    example_jp: str = "",
    note_cn: str = "",
    db_path: Optional[Path] = None,
) -> None:
    clean_issue = (issue_type or "pronunciation").strip()[:40]
    clean_key = (pattern_key or "").strip()[:80]
    if not clean_key:
        return
    now = utc_now_iso()
    with get_conn(db_path) as conn:
        conn.execute(
            """
            INSERT INTO weakness_memory (id, user_id, issue_type, pattern_key, example_jp, note_cn, occurrences, mastered_streak, last_seen_at)
            VALUES (?, ?, ?, ?, ?, ?, 1, 0, ?)
            ON CONFLICT(user_id, issue_type, pattern_key) DO UPDATE SET
                occurrences = occurrences + 1,
                mastered_streak = 0,
                example_jp = CASE WHEN excluded.example_jp != '' THEN excluded.example_jp ELSE weakness_memory.example_jp END,
                note_cn = CASE WHEN excluded.note_cn != '' THEN excluded.note_cn ELSE weakness_memory.note_cn END,
                last_seen_at = excluded.last_seen_at
            """,
            (f"wk_{uuid.uuid4().hex[:10]}", user_id, clean_issue, clean_key, example_jp, note_cn, now),
        )


def record_weakness_improvement(
    user_id: str,
    pattern_keys: List[str],
    db_path: Optional[Path] = None,
) -> List[str]:
    """Decrement occurrences and advance mastery streak when user fixes a logged weakness."""
    cleaned = [(k or "").strip() for k in (pattern_keys or []) if (k or "").strip()]
    if not cleaned:
        return []
    now = utc_now_iso()
    matched: List[str] = []
    with get_conn(db_path) as conn:
        for key in cleaned:
            rows = conn.execute(
                """
                SELECT id, pattern_key, occurrences, COALESCE(mastered_streak, 0) AS mastered_streak
                FROM weakness_memory
                WHERE user_id = ? AND occurrences > 0 AND LOWER(TRIM(pattern_key)) = LOWER(?)
                """,
                (user_id, key),
            ).fetchall()
            if not rows and len(key) >= 2:
                rows = conn.execute(
                    """
                    SELECT id, pattern_key, occurrences, COALESCE(mastered_streak, 0) AS mastered_streak
                    FROM weakness_memory
                    WHERE user_id = ? AND occurrences > 0 AND (pattern_key LIKE ? OR ? LIKE '%' || pattern_key || '%')
                    """,
                    (user_id, f"%{key}%", key),
                ).fetchall()
            for r in rows:
                new_streak = int(r["mastered_streak"]) + 1
                new_occ = 0 if new_streak >= 2 else max(0, int(r["occurrences"]) - 1)
                conn.execute(
                    """
                    UPDATE weakness_memory
                    SET occurrences = ?, mastered_streak = ?, last_seen_at = ?
                    WHERE id = ?
                    """,
                    (new_occ, new_streak, now, r["id"]),
                )
                if r["pattern_key"] not in matched:
                    matched.append(r["pattern_key"])
    return matched


def get_recent_step_turns(
    session_id: str,
    step_index: int,
    limit: int = 2,
    db_path: Optional[Path] = None,
) -> List[Dict[str, Any]]:
    """Return prior student attempts for the given step ordered oldest-first."""
    low = step_index * 10
    high = (step_index + 1) * 10
    with get_conn(db_path) as conn:
        rows = conn.execute(
            """
            SELECT * FROM call_turns
            WHERE session_id = ? AND speaker = 'student' AND turn_index >= ? AND turn_index < ?
            ORDER BY turn_index DESC, created_at DESC
            LIMIT ?
            """,
            (session_id, low, high, limit),
        ).fetchall()
        out = []
        for r in reversed(rows):
            d = dict(r)
            d["tokens"] = json.loads(d.get("tokens_json") or "[]")
            d["correction"] = json.loads(d.get("correction_json") or "{}")
            out.append(d)
        return out


def list_weaknesses(user_id: str, limit: int = 12, db_path: Optional[Path] = None) -> List[Dict[str, Any]]:
    with get_conn(db_path) as conn:
        rows = conn.execute(
            """
            SELECT * FROM weakness_memory
            WHERE user_id = ? AND occurrences > 0
            ORDER BY occurrences DESC, last_seen_at DESC
            LIMIT ?
            """,
            (user_id, limit),
        ).fetchall()
        return [dict(r) for r in rows]


def get_dict_cache(lemma: str, db_path: Optional[Path] = None) -> Optional[Dict[str, Any]]:
    with get_conn(db_path) as conn:
        row = conn.execute("SELECT * FROM dict_cache WHERE lemma = ?", (lemma,)).fetchone()
        return dict(row) if row else None


def save_dict_cache(entry: Dict[str, Any], db_path: Optional[Path] = None) -> None:
    with get_conn(db_path) as conn:
        conn.execute(
            """
            INSERT OR REPLACE INTO dict_cache (
                lemma, reading, pitch_accent, jlpt, meaning_cn, grammar_note, example_jp, example_cn, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                entry.get("lemma", ""),
                entry.get("reading", ""),
                entry.get("pitch_accent", ""),
                entry.get("jlpt", ""),
                entry.get("meaning_cn", ""),
                entry.get("grammar_note", ""),
                entry.get("example_jp", ""),
                entry.get("example_cn", ""),
                utc_now_iso(),
            ),
        )


def save_story(
    user_id: str,
    title_jp: str,
    title_cn: str,
    jlpt_level: str,
    target_vocab: List[str],
    script: List[Dict[str, Any]],
    comprehension: Dict[str, Any],
    audio_path: str,
    story_id: Optional[str] = None,
    db_path: Optional[Path] = None,
) -> Dict[str, Any]:
    sid = story_id or f"story_{uuid.uuid4().hex[:10]}"
    now = utc_now_iso()
    with get_conn(db_path) as conn:
        conn.execute(
            """
            INSERT INTO stories (
                id, user_id, title_jp, title_cn, jlpt_level,
                target_vocab_json, script_json, comprehension_json, audio_path, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                sid,
                user_id,
                title_jp,
                title_cn,
                jlpt_level,
                json.dumps(target_vocab, ensure_ascii=False),
                json.dumps(script, ensure_ascii=False),
                json.dumps(comprehension, ensure_ascii=False),
                audio_path,
                now,
            ),
        )
    return {
        "id": sid,
        "user_id": user_id,
        "title_jp": title_jp,
        "title_cn": title_cn,
        "jlpt_level": jlpt_level,
        "target_vocab": target_vocab,
        "script": script,
        "comprehension": comprehension,
        "audio_url": audio_path,
        "created_at": now,
    }


def list_stories(user_id: str, limit: int = 10, db_path: Optional[Path] = None) -> List[Dict[str, Any]]:
    with get_conn(db_path) as conn:
        rows = conn.execute(
            "SELECT * FROM stories WHERE user_id = ? ORDER BY created_at DESC LIMIT ?",
            (user_id, limit),
        ).fetchall()
        out = []
        for r in rows:
            d = dict(r)
            out.append(
                {
                    "id": d["id"],
                    "user_id": d["user_id"],
                    "title_jp": d["title_jp"],
                    "title_cn": d["title_cn"],
                    "jlpt_level": d["jlpt_level"],
                    "target_vocab": json.loads(d.get("target_vocab_json") or "[]"),
                    "script": json.loads(d.get("script_json") or "[]"),
                    "comprehension": json.loads(d.get("comprehension_json") or "{}"),
                    "audio_url": d.get("audio_path") or "",
                    "created_at": d["created_at"],
                }
            )
        return out


def list_lesson_progress(user_id: str, db_path: Optional[Path] = None) -> Dict[str, Dict[str, Any]]:
    """Return {lesson_id: progress_row} for a user."""
    with get_conn(db_path) as conn:
        rows = conn.execute(
            "SELECT * FROM lesson_progress WHERE user_id = ?",
            (user_id,),
        ).fetchall()
        return {r["lesson_id"]: dict(r) for r in rows}


def upsert_lesson_progress(
    user_id: str,
    lesson_id: str,
    score: int = 0,
    completed: bool = False,
    db_path: Optional[Path] = None,
) -> Dict[str, Any]:
    """Update best score, attempts, and completion status for a syllabus lesson."""
    clean_lid = (lesson_id or "").strip()
    if not clean_lid:
        return {}
    now = utc_now_iso()
    status_val = "completed" if completed else "in_progress"
    with get_conn(db_path) as conn:
        conn.execute(
            """
            INSERT INTO lesson_progress (user_id, lesson_id, status, best_score, attempts, last_studied_at)
            VALUES (?, ?, ?, ?, 1, ?)
            ON CONFLICT(user_id, lesson_id) DO UPDATE SET
                status = CASE WHEN lesson_progress.status = 'completed' THEN 'completed' ELSE excluded.status END,
                best_score = MAX(lesson_progress.best_score, excluded.best_score),
                attempts = lesson_progress.attempts + 1,
                last_studied_at = excluded.last_studied_at
            """,
            (user_id, clean_lid, status_val, int(score), now),
        )
        row = conn.execute(
            "SELECT * FROM lesson_progress WHERE user_id = ? AND lesson_id = ?",
            (user_id, clean_lid),
        ).fetchone()
        return dict(row) if row else {}
