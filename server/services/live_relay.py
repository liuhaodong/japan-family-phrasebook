"""Real-time bidirectional WebSocket relay between browser AudioWorklet and Gemini Live API."""

from __future__ import annotations

import asyncio
import json
import uuid
from typing import Any, Dict, List, Optional

from fastapi import WebSocket, WebSocketDisconnect
from google import genai
from google.genai import types

from server.config import (
    DEFAULT_VOICE,
    LIVE_FALLBACK_MODELS,
    LIVE_MODEL,
    TURN_AUDIO_DIR,
    resolve_api_key,
    verify_passcode,
)
from server.db import add_turn, create_session, finish_session, list_weaknesses
from server.services.audio_utils import pcm_to_wav_bytes
from server.services.curriculum_loader import get_scenario
from server.services.jp_tokenizer import strip_furigana_parens, tokenize_sentence
from server.services.sensei_engine import evaluate_live_turn, generate_live_hints
from server.services.srs_service import list_cards


def build_live_system_instruction(
    *,
    scenario: Optional[Dict[str, Any]],
    user_id: str,
    jlpt_target: str,
    correction_mode: str,
) -> str:
    """Build dynamic Sensei persona prompt seeded with scenario, family context, and user weaknesses."""
    weaknesses = list_weaknesses(user_id, limit=3)
    due_cards = list_cards(user_id, due_only=True, limit=3) or list_cards(user_id, due_only=False, limit=3)

    weakness_text = ", ".join(f"{w['pattern_key']}({w['note_cn']})" for w in weaknesses) or "暂无明显历史错题"
    due_text = ", ".join(f"{c['surface']}({c.get('meaning_cn', '')})" for c in due_cards) or "暂无到期词卡"

    sc_title = (scenario or {}).get("title") or "东京自由对话"
    sc_persona = (scenario or {}).get("persona") or "温柔、地道的东京本地日语私教老师兼对话伙伴"
    sc_starter = strip_furigana_parens((scenario or {}).get("starter_jp") or "こんにちは！今日はどんな練習をしましょうか？")

    correction_rule = (
        "【流畅聊天模式 (Flow)】：绝不打断学生思路！只用极其自然的日语回话，在需要时顺便自然重述正确的说法引导对话继续。"
        if correction_mode == "flow"
        else "【严格私教模式 (Tutor)】：一旦学生说出明显语法错误或严重发音/敬语失误，先用1句简短中文温柔指出并给出正确日语示范、请对方跟我重复一次，再接回场景对话。"
    )

    return (
        "你是刘浩东一家人的私人东京日语老师「美咲（Misaki）先生」，现在正在进行一对一实时语音通话。\n"
        f"当前通话场景：{sc_title}\n"
        f"角色设定：{sc_persona}\n"
        "学生背景：刘浩东（Google SWE Mgr）与妻子 Sherry（SWE），带两个女儿 Jinny（6岁半）和 Jaycie（2岁半），2026年底赴日本长假35晚（东京高轮、轻井泽滑雪、银座午餐、福冈由布院）。\n"
        f"学生目标水平：{jlpt_target}\n"
        f"学生近期高频薄弱点：{weakness_text}\n"
        f"记忆本待复习词汇：{due_text}（请在对话中自然找机会引出或考一考！）\n"
        f"{correction_rule}\n"
        "【双语救场安全网 (Bilingual Safety Net)】：如果学生卡壳或直接用中文/英文问「这句话日语怎么说？」，"
        "立刻用简短清晰的中文告诉他最地道的日语表达，念一遍鼓励他复述后，继续自然推进行动。\n"
        "【开口规则】：每轮回复简短口语化（1–3 句日语为主），留出充足空白等待学生开口，不要自言自语长篇大论。\n"
        f"现在请用这一句开场进入角色：{sc_starter}"
    )


async def handle_live_websocket(
    websocket: WebSocket,
    header_api_key: Optional[str] = None,
    passcode: Optional[str] = None,
) -> None:
    """FastAPI WebSocket handler relaying 16kHz PCM up & 24kHz PCM + transcripts down."""
    await websocket.accept()

    session_id: Optional[str] = None
    try:
        raw_init = await asyncio.wait_for(websocket.receive_text(), timeout=15.0)
        init_msg = json.loads(raw_init)
    except Exception:
        await websocket.send_json({"type": "error", "message": "未收到有效的 start_session 握手消息。"})
        await websocket.close(code=1008)
        return

    if init_msg.get("type") != "start_session":
        await websocket.send_json({"type": "error", "message": "首条消息必须为 start_session。"})
        await websocket.close(code=1008)
        return

    try:
        verify_passcode(init_msg.get("passcode") or passcode)
        api_key = resolve_api_key(init_msg.get("apiKey") or header_api_key, required=True)
    except Exception as exc:
        detail = getattr(exc, "detail", str(exc))
        await websocket.send_json({"type": "error", "message": detail})
        await websocket.close(code=1008)
        return

    user_id = (init_msg.get("userId") or "haodong").strip()
    scenario_id = (init_msg.get("scenarioId") or "daily_konbini").strip()
    correction_mode = (init_msg.get("correctionMode") or "strict").strip()
    voice = (init_msg.get("voice") or DEFAULT_VOICE).strip()
    jlpt_target = (init_msg.get("jlptTarget") or "N4").strip()

    scenario = get_scenario(scenario_id)
    scenario_title = (scenario or {}).get("title") or "自由日语对话"
    system_prompt = build_live_system_instruction(
        scenario=scenario,
        user_id=user_id,
        jlpt_target=jlpt_target,
        correction_mode=correction_mode,
    )

    session_id = create_session(
        user_id=user_id,
        mode=f"live_{correction_mode}",
        scenario_id=scenario_id,
        persona=scenario_title,
    )

    client = genai.Client(api_key=api_key, http_options={"api_version": "v1beta"})
    config = types.LiveConnectConfig(
        response_modalities=[types.Modality.AUDIO],
        speech_config=types.SpeechConfig(
            voice_config=types.VoiceConfig(
                prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name=voice)
            )
        ),
        system_instruction=system_prompt,
        input_audio_transcription=types.AudioTranscriptionConfig(),
        output_audio_transcription=types.AudioTranscriptionConfig(),
        context_window_compression=types.ContextWindowCompressionConfig(
            sliding_window=types.SlidingWindow()
        ),
        session_resumption=types.SessionResumptionConfig(),
    )

    models_to_try = [LIVE_MODEL] + [m for m in LIVE_FALLBACK_MODELS if m != LIVE_MODEL]
    connected_cm = None
    live_session = None
    active_model = LIVE_MODEL
    connect_errors: List[str] = []

    for mdl in models_to_try:
        try:
            connected_cm = client.aio.live.connect(model=mdl, config=config)
            live_session = await connected_cm.__aenter__()
            active_model = mdl
            break
        except Exception as exc:
            connect_errors.append(f"{mdl}: {exc}")
            connected_cm = None
            live_session = None

    if live_session is None or connected_cm is None:
        await websocket.send_json(
            {
                "type": "error",
                "message": "无法连接 Gemini Live 语音引擎：" + " | ".join(connect_errors),
            }
        )
        finish_session(session_id)
        await websocket.close(code=1011)
        return

    await websocket.send_json(
        {
            "type": "session_ready",
            "sessionId": session_id,
            "model": active_model,
            "scenarioTitle": scenario_title,
        }
    )

    # Trigger initial Sensei greeting immediately
    try:
        await live_session.send_client_content(
            turns=types.Content(
                role="user",
                parts=[types.Part(text="先生、こんにちは！始めてください。")],
            ),
            turn_complete=True,
        )
    except Exception:
        pass

    state: Dict[str, Any] = {
        "user_pcm": bytearray(),
        "user_transcript": "",
        "ai_transcript": "",
        "last_ai_jp": "",
        "turn_counter": 0,
        "closed": False,
    }
    background_tasks: List[asyncio.Task[Any]] = []
    send_lock = asyncio.Lock()

    async def safe_send_json(payload: Dict[str, Any]) -> None:
        if state["closed"]:
            return
        async with send_lock:
            try:
                await websocket.send_json(payload)
            except Exception:
                state["closed"] = True

    async def safe_send_bytes(data: bytes) -> None:
        if state["closed"]:
            return
        async with send_lock:
            try:
                await websocket.send_bytes(data)
            except Exception:
                state["closed"] = True

    async def flush_user_turn_for_analysis() -> None:
        pcm_copy = bytes(state["user_pcm"])
        transcript_copy = state["user_transcript"].strip()
        last_ai_copy = state["last_ai_jp"] or state["ai_transcript"]
        state["user_pcm"].clear()
        state["user_transcript"] = ""

        # Skip tiny noise bursts (< 0.45s at 16kHz 16-bit mono = ~14,400 bytes)
        if len(pcm_copy) < 14400 and len(transcript_copy) < 2:
            return

        state["turn_counter"] += 1
        turn_idx = state["turn_counter"]
        turn_id = f"turn_{uuid.uuid4().hex[:12]}"
        wav_bytes = pcm_to_wav_bytes(pcm_copy, sample_rate=16000, channels=1, sampwidth=2) if pcm_copy else b""
        wav_path = ""
        user_audio_url = ""
        if wav_bytes:
            file_path = TURN_AUDIO_DIR / f"{turn_id}.wav"
            file_path.write_bytes(wav_bytes)
            wav_path = str(file_path)
            user_audio_url = f"/api/audio/turn/{turn_id}.wav"

        tokens = tokenize_sentence(transcript_copy) if transcript_copy else []
        add_turn(
            session_id=session_id,
            turn_index=turn_idx,
            speaker="student",
            stage="LIVE_CALL",
            transcript_jp=transcript_copy,
            tokens=tokens,
            audio_path=wav_path,
            turn_id=turn_id,
        )
        await safe_send_json(
            {
                "type": "transcript_user",
                "turnId": turn_id,
                "text": transcript_copy,
                "final": True,
                "tokens": tokens,
                "userAudioUrl": user_audio_url,
            }
        )

        async def _run_track2() -> None:
            try:
                evaluation = await evaluate_live_turn(
                    user_id=user_id,
                    audio_wav_bytes=wav_bytes or None,
                    transcript_user=transcript_copy,
                    last_ai_jp=last_ai_copy,
                    scenario_title=scenario_title,
                    api_key=api_key,
                )
                natural_jp = evaluation.get("naturalJp") or transcript_copy
                from server.db import update_turn_correction

                update_turn_correction(turn_id, evaluation, tokens=tokenize_sentence(natural_jp))
                await safe_send_json(
                    {
                        "type": "turn_correction",
                        "turnId": turn_id,
                        "userAudioUrl": user_audio_url,
                        "evaluation": evaluation,
                        "naturalTokens": tokenize_sentence(natural_jp),
                    }
                )
            except Exception:
                pass

        task = asyncio.create_task(_run_track2())
        background_tasks.append(task)

    async def client_to_gemini() -> None:
        try:
            while not state["closed"]:
                msg = await websocket.receive()
                if msg.get("type") == "websocket.disconnect":
                    state["closed"] = True
                    break

                raw_bytes = msg.get("bytes")
                if raw_bytes:
                    # Cap rolling buffer to 30 seconds (16000 * 2 * 30 = 960,000 bytes)
                    if len(state["user_pcm"]) + len(raw_bytes) <= 960000:
                        state["user_pcm"].extend(raw_bytes)
                    await live_session.send_realtime_input(
                        audio=types.Blob(data=raw_bytes, mime_type="audio/pcm;rate=16000")
                    )
                    continue

                raw_text = msg.get("text")
                if raw_text:
                    ctrl = json.loads(raw_text)
                    ctype = ctrl.get("type")
                    if ctype == "end_session":
                        await flush_user_turn_for_analysis()
                        state["closed"] = True
                        break
                    if ctype == "barge_in":
                        state["user_pcm"].clear()
                    elif ctype == "slow_down":
                        await live_session.send_client_content(
                            turns=types.Content(
                                role="user",
                                parts=[
                                    types.Part(
                                        text="すみません、今の表現をもう少しゆっくり、はっきり言っていただけますか？"
                                    )
                                ],
                            ),
                            turn_complete=True,
                        )
                    elif ctype == "hint_request":
                        hints = await generate_live_hints(
                            last_ai_jp=state["last_ai_jp"] or state["ai_transcript"],
                            scenario_title=scenario_title,
                            jlpt_target=jlpt_target,
                            api_key=api_key,
                        )
                        await safe_send_json({"type": "hint_suggestions", "hints": hints})
                    elif ctype == "user_text" and ctrl.get("text"):
                        await live_session.send_client_content(
                            turns=types.Content(
                                role="user",
                                parts=[types.Part(text=ctrl["text"])],
                            ),
                            turn_complete=True,
                        )
        except WebSocketDisconnect:
            state["closed"] = True
        except Exception:
            state["closed"] = True

    async def gemini_to_client() -> None:
        try:
            async for response in live_session.receive():
                if state["closed"]:
                    break
                sc = getattr(response, "server_content", None)
                if not sc:
                    continue

                if getattr(sc, "interrupted", False):
                    await safe_send_json({"type": "interrupted"})
                    state["ai_transcript"] = ""

                in_trans = getattr(sc, "input_transcription", None)
                if in_trans and getattr(in_trans, "text", None):
                    state["user_transcript"] += in_trans.text
                    await safe_send_json(
                        {
                            "type": "transcript_user",
                            "text": state["user_transcript"],
                            "final": False,
                        }
                    )

                out_trans = getattr(sc, "output_transcription", None)
                if out_trans and getattr(out_trans, "text", None):
                    if state["user_pcm"] or state["user_transcript"].strip():
                        await flush_user_turn_for_analysis()
                    state["ai_transcript"] += out_trans.text
                    await safe_send_json(
                        {
                            "type": "transcript_ai",
                            "text": state["ai_transcript"],
                            "final": False,
                        }
                    )

                mt = getattr(sc, "model_turn", None)
                if mt and getattr(mt, "parts", None):
                    if state["user_pcm"] or state["user_transcript"].strip():
                        await flush_user_turn_for_analysis()
                    for part in mt.parts:
                        inline = getattr(part, "inline_data", None)
                        if inline and getattr(inline, "data", None):
                            await safe_send_bytes(inline.data)

                if getattr(sc, "turn_complete", False):
                    if state["ai_transcript"].strip():
                        ai_text = state["ai_transcript"].strip()
                        state["last_ai_jp"] = ai_text
                        state["turn_counter"] += 1
                        ai_tid = f"turn_{uuid.uuid4().hex[:12]}"
                        ai_tokens = tokenize_sentence(ai_text)
                        add_turn(
                            session_id=session_id,
                            turn_index=state["turn_counter"],
                            speaker="sensei",
                            stage="LIVE_CALL",
                            transcript_jp=ai_text,
                            tokens=ai_tokens,
                            turn_id=ai_tid,
                        )
                        await safe_send_json(
                            {
                                "type": "transcript_ai",
                                "turnId": ai_tid,
                                "text": ai_text,
                                "final": True,
                                "tokens": ai_tokens,
                            }
                        )
                        state["ai_transcript"] = ""
                    await safe_send_json({"type": "turn_complete"})
        except Exception:
            state["closed"] = True

    try:
        t_up = asyncio.create_task(client_to_gemini())
        t_down = asyncio.create_task(gemini_to_client())
        done, pending = await asyncio.wait({t_up, t_down}, return_when=asyncio.FIRST_COMPLETED)
        state["closed"] = True
        for p in pending:
            p.cancel()
        for t in done:
            _ = t.exception() if not t.cancelled() else None
    finally:
        for bt in background_tasks:
            if not bt.done():
                bt.cancel()
        try:
            await connected_cm.__aexit__(None, None, None)
        except Exception:
            pass
        if session_id:
            finish_session(session_id)
        try:
            await websocket.send_json({"type": "session_ended", "sessionId": session_id})
            await websocket.close()
        except Exception:
            pass
