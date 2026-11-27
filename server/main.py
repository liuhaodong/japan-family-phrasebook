"""FastAPI entry point for Nihongo Sensei AI & safe static frontend serving."""

from __future__ import annotations

import re
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import Body, FastAPI, File, Form, Header, HTTPException, Query, UploadFile, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from server.config import (
    APP_PASSCODE,
    AVAILABLE_VOICES,
    COACH_MODEL,
    COACH_MODEL_OPTIONS,
    DEFAULT_VOICE,
    LIVE_MODEL,
    REPO_ROOT,
    REPORT_MODEL,
    TTS_CACHE_DIR,
    TTS_FAST_MODEL,
    TTS_STORY_MODEL,
    TURN_AUDIO_DIR,
    get_server_api_key,
    resolve_api_key,
    verify_passcode,
)
from server.db import (
    init_db,
    list_lesson_progress,
    list_recent_sessions,
    list_session_turns,
    list_users,
    list_weaknesses,
    update_user_prefs,
)
from server.services.audio_utils import media_type_for_filename
from server.services.curriculum_loader import get_scenario, list_all_grammar, list_scenarios, load_curriculum
from server.services.jp_tokenizer import define_word, tokenize_sentence
from server.services.live_relay import handle_live_websocket
from server.services.sensei_engine import (
    create_guided_lesson,
    evaluate_sensei_turn,
    extend_guided_lesson,
    generate_session_report,
)
from server.services.srs_service import (
    add_or_update_card,
    delete_card,
    import_legacy_items,
    list_cards,
    review_card,
)
from server.services.story_service import fetch_stories, generate_graded_story
from server.services.syllabus import get_syllabus_lesson, get_syllabus_overview
from server.services.tts_service import get_tts_cache_meta, stream_speech_pcm, synthesize_speech

_SAFE_CACHE_NAME_RE = re.compile(r"^[a-f0-9]{16,64}\.wav$")
_SAFE_TURN_NAME_RE = re.compile(r"^turn_[a-zA-Z0-9_-]{6,32}\.(wav|webm|m4a|ogg|mp3)$")
_PUBLIC_ROOT_FILES = {
    "index.html",
    "styles.css",
    "app.js",
    "oral_coach.js",
    "learning.js",
    "sensei_ui.js",
    "live_audio_worklet.js",
    "sw.js",
    "manifest.json",
}


@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_db()
    load_curriculum()
    yield


app = FastAPI(title="Nihongo Sensei AI", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-TTS-Sample-Rate", "X-TTS-Cache-Url"],
)


class UserPrefsRequest(BaseModel):
    jlpt_target: Optional[str] = None
    preferred_voice: Optional[str] = None
    correction_mode: Optional[str] = None


class LessonStartRequest(BaseModel):
    user_id: str = "haodong"
    scenario_id: str = "1"
    lesson_type: str = "guided_10min"
    jlpt_target: str = "N4"
    voice: str = DEFAULT_VOICE
    curriculum_mode: str = "travel_scenario"
    lesson_id: Optional[str] = None
    grammar_id: Optional[str] = None
    custom_topic: Optional[str] = None
    ai_generate: bool = True
    defer_opening_tts: bool = True
    coach_model: Optional[str] = None
    include_review: bool = False


class LessonExtendRequest(BaseModel):
    session_id: str
    user_id: str = "haodong"
    curriculum_mode: str = "sensei_syllabus"
    lesson_title: str = ""
    grammar_focus: str = ""
    jlpt_target: str = "N4"
    voice: str = DEFAULT_VOICE
    existing_targets: List[str] = []
    start_index: int = 0
    scenario_id: Optional[str] = None
    grammar_id: Optional[str] = None
    coach_model: Optional[str] = None


class TTSRequest(BaseModel):
    text: str
    voice: str = DEFAULT_VOICE
    model: Optional[str] = None
    lang: Optional[str] = None


class TokenizeRequest(BaseModel):
    text: str


class DefineRequest(BaseModel):
    surface: str
    lemma: Optional[str] = None
    reading: str = ""
    context_jp: str = ""


class SrsCardRequest(BaseModel):
    user_id: str = "haodong"
    surface: str
    lemma: Optional[str] = None
    reading: str = ""
    pitch_accent: str = ""
    meaning_cn: str = ""
    jlpt: str = ""
    context_jp: str = ""
    source_type: str = "sensei"


class SrsReviewRequest(BaseModel):
    user_id: str = "haodong"
    card_id: str
    rating: Any


class SrsImportRequest(BaseModel):
    user_id: str = "haodong"
    items: List[Dict[str, Any]] = []


class ReportRequest(BaseModel):
    user_id: str = "haodong"
    duration_sec: int = 0


class StoryGenerateRequest(BaseModel):
    user_id: str = "haodong"
    jlpt_level: str = "N4"
    scenario_id: str = "daily_konbini"
    voice: str = DEFAULT_VOICE


@app.get("/api/health")
async def health() -> Dict[str, Any]:
    return {
        "ok": True,
        "has_server_key": bool(get_server_api_key()),
        "auth_required": bool(APP_PASSCODE),
        "models": {
            "live": LIVE_MODEL,
            "coach": COACH_MODEL,
            "report": REPORT_MODEL,
            "tts_fast": TTS_FAST_MODEL,
            "tts_story": TTS_STORY_MODEL,
        },
        "voices": AVAILABLE_VOICES,
        "coach_models": COACH_MODEL_OPTIONS,
        "features": {"live": True, "sudachi": True, "fsrs": True},
    }


@app.post("/api/auth/verify")
async def api_verify_auth(
    x_app_passcode: Optional[str] = Header(default=None),
) -> Dict[str, Any]:
    verify_passcode(x_app_passcode)
    return {"ok": True, "auth_required": bool(APP_PASSCODE)}


@app.get("/api/users")
async def api_list_users() -> Dict[str, Any]:
    init_db()
    return {"users": list_users()}


@app.post("/api/users/{user_id}/prefs")
async def api_update_user_prefs(
    user_id: str,
    body: UserPrefsRequest,
    x_app_passcode: Optional[str] = Header(default=None),
) -> Dict[str, Any]:
    verify_passcode(x_app_passcode)
    init_db()
    return {"user": update_user_prefs(user_id, body.jlpt_target, body.preferred_voice, body.correction_mode)}


@app.get("/api/scenarios")
async def api_list_scenarios() -> Dict[str, Any]:
    return {"scenarios": list_scenarios()}


@app.get("/api/scenarios/{scenario_id}")
async def api_get_scenario(scenario_id: str) -> Dict[str, Any]:
    sc = get_scenario(scenario_id)
    if not sc:
        raise HTTPException(status_code=404, detail="未找到对应场景。")
    return {"scenario": sc}


@app.get("/api/sensei/syllabus")
async def api_get_syllabus(
    user_id: str = Query("haodong"),
    jlpt_target: str = Query("N4"),
) -> Dict[str, Any]:
    init_db()
    progress = list_lesson_progress(user_id=user_id)
    return get_syllabus_overview(progress_map=progress, jlpt_target=jlpt_target)


@app.get("/api/sensei/syllabus/{lesson_id}")
async def api_get_syllabus_lesson(lesson_id: str) -> Dict[str, Any]:
    lesson = get_syllabus_lesson(lesson_id)
    if not lesson:
        raise HTTPException(status_code=404, detail="未找到对应教材章节。")
    enriched = dict(lesson)
    bb = dict(enriched.get("blackboard") or {})
    if bb.get("contrastBadJp"):
        bb["contrastBadTokens"] = tokenize_sentence(bb["contrastBadJp"])
    if bb.get("contrastGoodJp"):
        bb["contrastGoodTokens"] = tokenize_sentence(bb["contrastGoodJp"])
    enriched["blackboard"] = bb
    return {"lesson": enriched}


@app.get("/api/grammar")
async def api_list_grammar(
    level: Optional[str] = Query(None),
    q: Optional[str] = Query(None),
) -> Dict[str, Any]:
    return {"grammar": list_all_grammar(level=level, query=q)}


@app.post("/api/sensei/lesson/start")
async def api_start_lesson(
    body: LessonStartRequest,
    x_gemini_api_key: Optional[str] = Header(default=None),
    x_app_passcode: Optional[str] = Header(default=None),
) -> Dict[str, Any]:
    verify_passcode(x_app_passcode)
    init_db()
    api_key = resolve_api_key(x_gemini_api_key, required=False) or None
    return await create_guided_lesson(
        user_id=body.user_id,
        scenario_id=body.scenario_id,
        lesson_type=body.lesson_type,
        jlpt_target=body.jlpt_target,
        voice=body.voice,
        curriculum_mode=body.curriculum_mode,
        lesson_id=body.lesson_id,
        grammar_id=body.grammar_id,
        custom_topic=body.custom_topic,
        ai_generate=body.ai_generate,
        defer_opening_tts=body.defer_opening_tts,
        coach_model=body.coach_model,
        include_review=body.include_review,
        api_key=api_key,
    )


@app.post("/api/sensei/lesson/extend")
async def api_extend_lesson(
    body: LessonExtendRequest,
    x_gemini_api_key: Optional[str] = Header(default=None),
    x_app_passcode: Optional[str] = Header(default=None),
) -> Dict[str, Any]:
    verify_passcode(x_app_passcode)
    init_db()
    api_key = resolve_api_key(x_gemini_api_key, required=True)
    return await extend_guided_lesson(
        session_id=body.session_id,
        user_id=body.user_id,
        curriculum_mode=body.curriculum_mode,
        lesson_title=body.lesson_title,
        grammar_focus=body.grammar_focus,
        jlpt_target=body.jlpt_target,
        voice=body.voice,
        existing_targets=body.existing_targets,
        start_index=body.start_index,
        scenario_id=body.scenario_id,
        grammar_id=body.grammar_id,
        coach_model=body.coach_model,
        api_key=api_key,
    )


@app.post("/api/sensei/turn")
async def api_sensei_turn(
    audio: UploadFile = File(...),
    session_id: str = Form(...),
    user_id: str = Form("haodong"),
    step_index: int = Form(0),
    total_steps: int = Form(0),
    stage: str = Form("SHADOW_DRILL"),
    target_jp: str = Form(...),
    target_cn: str = Form(""),
    cue_cn: str = Form(""),
    attempt: int = Form(1),
    drill_chunk_jp: str = Form(""),
    voice: str = Form(DEFAULT_VOICE),
    coach_model: Optional[str] = Form(None),
    defer_tts: bool = Form(True),
    lesson_id: Optional[str] = Form(None),
    grammar_focus: str = Form(""),
    question_jp: str = Form(""),
    x_gemini_api_key: Optional[str] = Header(default=None),
    x_app_passcode: Optional[str] = Header(default=None),
) -> Dict[str, Any]:
    verify_passcode(x_app_passcode)
    init_db()
    api_key = resolve_api_key(x_gemini_api_key, required=True)
    audio_bytes = await audio.read()
    try:
        return await evaluate_sensei_turn(
            session_id=session_id,
            user_id=user_id,
            step_index=step_index,
            total_steps=total_steps,
            stage=stage,
            target_jp=target_jp,
            target_cn=target_cn,
            cue_cn=cue_cn,
            attempt=attempt,
            drill_chunk_jp=drill_chunk_jp,
            audio_bytes=audio_bytes,
            audio_filename=audio.filename or "recording.webm",
            content_type=audio.content_type or "audio/webm",
            voice=voice,
            coach_model=coach_model,
            defer_tts=defer_tts,
            lesson_id=lesson_id,
            grammar_focus=grammar_focus,
            question_jp=question_jp,
            api_key=api_key,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@app.post("/api/tts")
async def api_tts(
    body: TTSRequest,
    x_gemini_api_key: Optional[str] = Header(default=None),
    x_app_passcode: Optional[str] = Header(default=None),
) -> Dict[str, Any]:
    verify_passcode(x_app_passcode)
    api_key = resolve_api_key(x_gemini_api_key, required=True)
    try:
        return await synthesize_speech(
            text=body.text,
            api_key=api_key,
            voice=body.voice,
            model=body.model,
            lang=body.lang,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@app.post("/api/tts/stream")
async def api_tts_stream(
    body: TTSRequest,
    x_gemini_api_key: Optional[str] = Header(default=None),
    x_app_passcode: Optional[str] = Header(default=None),
) -> StreamingResponse:
    verify_passcode(x_app_passcode)
    api_key = resolve_api_key(x_gemini_api_key, required=True)
    try:
        meta = get_tts_cache_meta(
            text=body.text,
            voice=body.voice,
            model=body.model,
            cache_dir=TTS_CACHE_DIR,
            lang=body.lang,
        )
        gen = stream_speech_pcm(
            text=body.text,
            api_key=api_key,
            voice=body.voice,
            model=body.model,
            cache_dir=TTS_CACHE_DIR,
            lang=body.lang,
        )
        first_chunk = await anext(gen)
    except StopAsyncIteration as exc:
        raise HTTPException(status_code=502, detail="流式语音未返回音频数据。") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    async def _stream_body():
        yield first_chunk
        async for chunk in gen:
            yield chunk

    return StreamingResponse(
        _stream_body(),
        media_type="audio/L16;rate=24000",
        headers={
            "X-TTS-Sample-Rate": "24000",
            "X-TTS-Cache-Url": meta["audio_url"],
            "Cache-Control": "no-store",
        },
    )


@app.get("/api/tts/cache/{filename}")
async def api_get_cached_tts(filename: str) -> FileResponse:
    if not _SAFE_CACHE_NAME_RE.match(filename):
        raise HTTPException(status_code=404, detail="Invalid cache filename.")
    path = TTS_CACHE_DIR / filename
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Audio not found.")
    return FileResponse(path, media_type="audio/wav")


@app.get("/api/audio/turn/{filename}")
async def api_get_turn_audio(filename: str) -> FileResponse:
    if not _SAFE_TURN_NAME_RE.match(filename):
        raise HTTPException(status_code=404, detail="Invalid turn audio filename.")
    path = TURN_AUDIO_DIR / filename
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Turn audio not found.")
    return FileResponse(path, media_type=media_type_for_filename(filename))


@app.post("/api/dict/tokenize")
async def api_tokenize(body: TokenizeRequest) -> Dict[str, Any]:
    return {"tokens": tokenize_sentence(body.text)}


@app.post("/api/dict/define")
async def api_define(
    body: DefineRequest,
    x_gemini_api_key: Optional[str] = Header(default=None),
    x_app_passcode: Optional[str] = Header(default=None),
) -> Dict[str, Any]:
    verify_passcode(x_app_passcode)
    api_key = resolve_api_key(x_gemini_api_key, required=False) or None
    entry = await define_word(
        surface=body.surface,
        lemma=body.lemma,
        reading=body.reading,
        context_jp=body.context_jp,
        api_key=api_key,
    )
    return {"entry": entry}


@app.get("/api/srs/cards")
async def api_get_srs_cards(
    user_id: str = Query("haodong"),
    due_only: bool = Query(False),
) -> Dict[str, Any]:
    init_db()
    cards = list_cards(user_id=user_id, due_only=due_only)
    return {"cards": cards, "count": len(cards)}


@app.post("/api/srs/cards")
async def api_add_srs_card(
    body: SrsCardRequest,
    x_app_passcode: Optional[str] = Header(default=None),
) -> Dict[str, Any]:
    verify_passcode(x_app_passcode)
    init_db()
    card = add_or_update_card(
        user_id=body.user_id,
        surface=body.surface,
        lemma=body.lemma,
        reading=body.reading,
        pitch_accent=body.pitch_accent,
        meaning_cn=body.meaning_cn,
        jlpt=body.jlpt,
        context_jp=body.context_jp,
        source_type=body.source_type,
    )
    return {"card": card}


@app.post("/api/srs/review")
async def api_review_srs_card(
    body: SrsReviewRequest,
    x_app_passcode: Optional[str] = Header(default=None),
) -> Dict[str, Any]:
    verify_passcode(x_app_passcode)
    init_db()
    try:
        card = review_card(user_id=body.user_id, card_id=body.card_id, rating=body.rating)
        return {"card": card}
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.delete("/api/srs/cards/{card_id}")
async def api_delete_srs_card(
    card_id: str,
    user_id: str = Query("haodong"),
    x_app_passcode: Optional[str] = Header(default=None),
) -> Dict[str, Any]:
    verify_passcode(x_app_passcode)
    ok = delete_card(user_id=user_id, card_id=card_id)
    if not ok:
        raise HTTPException(status_code=404, detail="词卡不存在。")
    return {"ok": True}


@app.post("/api/srs/import")
async def api_import_srs(
    body: SrsImportRequest,
    x_app_passcode: Optional[str] = Header(default=None),
) -> Dict[str, Any]:
    verify_passcode(x_app_passcode)
    init_db()
    count = import_legacy_items(user_id=body.user_id, items=body.items)
    return {"imported": count}


@app.get("/api/memory")
async def api_get_memory(user_id: str = Query("haodong")) -> Dict[str, Any]:
    init_db()
    weaknesses = list_weaknesses(user_id=user_id, limit=20)
    sessions = list_recent_sessions(user_id=user_id, limit=12)
    due_cards = list_cards(user_id=user_id, due_only=True, limit=200)
    all_cards = list_cards(user_id=user_id, due_only=False, limit=200)
    return {
        "userId": user_id,
        "weaknesses": weaknesses,
        "sessions": sessions,
        "dueCount": len(due_cards),
        "totalCards": len(all_cards),
    }


@app.get("/api/sessions")
async def api_list_sessions(user_id: str = Query("haodong")) -> Dict[str, Any]:
    init_db()
    return {"sessions": list_recent_sessions(user_id=user_id, limit=20)}


@app.get("/api/sessions/{session_id}/turns")
async def api_get_session_turns(session_id: str) -> Dict[str, Any]:
    init_db()
    return {"turns": list_session_turns(session_id)}


@app.post("/api/sessions/{session_id}/report")
async def api_generate_report(
    session_id: str,
    body: ReportRequest = Body(default=ReportRequest()),
    x_gemini_api_key: Optional[str] = Header(default=None),
    x_app_passcode: Optional[str] = Header(default=None),
) -> Dict[str, Any]:
    verify_passcode(x_app_passcode)
    init_db()
    api_key = resolve_api_key(x_gemini_api_key, required=True)
    report = await generate_session_report(
        session_id=session_id,
        user_id=body.user_id,
        api_key=api_key,
        duration_sec=body.duration_sec,
    )
    return {"report": report}


@app.get("/api/stories")
async def api_list_stories(user_id: str = Query("haodong")) -> Dict[str, Any]:
    init_db()
    return {"stories": fetch_stories(user_id=user_id)}


@app.post("/api/stories/generate")
async def api_generate_story(
    body: StoryGenerateRequest,
    x_gemini_api_key: Optional[str] = Header(default=None),
    x_app_passcode: Optional[str] = Header(default=None),
) -> Dict[str, Any]:
    verify_passcode(x_app_passcode)
    init_db()
    api_key = resolve_api_key(x_gemini_api_key, required=True)
    story = await generate_graded_story(
        user_id=body.user_id,
        jlpt_level=body.jlpt_level,
        scenario_id=body.scenario_id,
        voice=body.voice,
        api_key=api_key,
    )
    return {"story": story}


@app.websocket("/ws/live")
async def ws_live_endpoint(
    websocket: WebSocket,
    x_gemini_api_key: Optional[str] = Header(default=None),
    x_app_passcode: Optional[str] = Header(default=None),
) -> None:
    init_db()
    await handle_live_websocket(
        websocket,
        header_api_key=x_gemini_api_key,
        passcode=x_app_passcode,
    )


# Mount public read-only asset subdirectories (never mount server/ or .env!)
for _subdir in ("data", "audio", "vendor", "docs"):
    _dir_path = REPO_ROOT / _subdir
    if _dir_path.is_dir():
        app.mount(f"/{_subdir}", StaticFiles(directory=str(_dir_path)), name=f"static-{_subdir}")


@app.get("/favicon.ico")
async def favicon() -> Response:
    return Response(status_code=204)


@app.get("/")
async def serve_index() -> FileResponse:
    return FileResponse(REPO_ROOT / "index.html")


@app.get("/{asset_name}")
async def serve_allowlisted_root_file(asset_name: str) -> FileResponse:
    if asset_name not in _PUBLIC_ROOT_FILES:
        raise HTTPException(status_code=404, detail="Not Found")
    target = REPO_ROOT / asset_name
    if not target.is_file():
        raise HTTPException(status_code=404, detail="Not Found")
    return FileResponse(target)
