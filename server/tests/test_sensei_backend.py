"""Comprehensive verification tests for Nihongo Sensei AI backend."""

from __future__ import annotations

import base64
import json
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from server import config, db
from server.main import app
from server.services import curriculum_loader, jp_tokenizer, sensei_engine, srs_service, tts_service
from server.services.audio_utils import pcm_to_wav_bytes


@pytest.fixture()
def isolated_env(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    test_db = tmp_path / "test_sensei.db"
    tts_dir = tmp_path / "cache" / "tts"
    turn_dir = tmp_path / "cache" / "turns"
    tts_dir.mkdir(parents=True, exist_ok=True)
    turn_dir.mkdir(parents=True, exist_ok=True)

    monkeypatch.setattr(config, "DB_PATH", test_db)
    monkeypatch.setattr(db, "DB_PATH", test_db)
    monkeypatch.setattr(srs_service, "DB_PATH", test_db)
    monkeypatch.setattr(config, "TTS_CACHE_DIR", tts_dir)
    monkeypatch.setattr(tts_service, "TTS_CACHE_DIR", tts_dir)
    monkeypatch.setattr(config, "TURN_AUDIO_DIR", turn_dir)
    monkeypatch.setattr(sensei_engine, "TURN_AUDIO_DIR", turn_dir)
    monkeypatch.setattr(tts_service, "TTS_CACHE_DIR", tts_dir)
    monkeypatch.setattr("server.main.TTS_CACHE_DIR", tts_dir)
    monkeypatch.setattr("server.main.TURN_AUDIO_DIR", turn_dir)

    db.init_db(test_db)
    return {"db": test_db, "tts_dir": tts_dir, "turn_dir": turn_dir}


def test_health_and_security_allowlist(isolated_env):
    client = TestClient(app)
    r = client.get("/api/health")
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True
    assert body["models"]["live"] == "gemini-3.8-live"
    assert body["models"]["coach"] == "gemini-4-hydrogen"
    assert body["models"]["tts_fast"] == "gemini-3.8-flash-lite-tts"
    assert len(body["coach_models"]) >= 3

    # Security: private backend files and env must return 404
    assert client.get("/server/.env").status_code == 404
    assert client.get("/server/sensei.db").status_code == 404
    assert client.get("/server/config.py").status_code == 404
    assert client.get("/").status_code == 200


def test_curriculum_loader_loads_all_modules_and_verbs():
    scenarios = curriculum_loader.list_scenarios()
    daily = [s for s in scenarios if s["category"] == "daily"]
    travel = [s for s in scenarios if s["category"] == "travel"]
    assert len(daily) == 5
    assert len(travel) == 18

    verbs = curriculum_loader.get_verbs(limit=300)
    grammar = curriculum_loader.get_grammar()
    assert len(verbs) >= 200
    assert len(grammar) >= 100


def test_jp_tokenizer_lemmatizes_inflected_verb(isolated_env):
    tokens = jp_tokenizer.tokenize_sentence("預けておきました")
    assert len(tokens) >= 1
    assert tokens[0]["lemma"] == "預ける"
    assert tokens[0]["reading"] == "あずけ"
    assert tokens[0]["is_content_word"] is True


def test_srs_add_and_fsrs_review_advances_due(isolated_env):
    card = srs_service.add_or_update_card(
        user_id="haodong",
        surface="預けて",
        lemma="預ける",
        reading="あずける",
        meaning_cn="寄存、托付",
        jlpt="N4",
        context_jp="ベビーカーを預けてもいいですか。",
        db_path=isolated_env["db"],
    )
    first_due = card["next_due"]
    reviewed = srs_service.review_card("haodong", card["id"], 4, db_path=isolated_env["db"])
    assert reviewed["next_due"] > first_due


@pytest.mark.asyncio
async def test_tts_service_strips_markdown_no_system_instruction_and_caches(isolated_env):
    fake_pcm = b"\x01\x00" * 4800  # 0.1s 24kHz mono PCM
    fake_resp = MagicMock()
    fake_resp.status_code = 200
    fake_resp.json.return_value = {
        "candidates": [
            {
                "content": {
                    "parts": [
                        {
                            "inlineData": {
                                "mimeType": "audio/L16;rate=24000",
                                "data": base64.b64encode(fake_pcm).decode("ascii"),
                            }
                        }
                    ]
                }
            }
        ]
    }

    captured_payloads = []

    class FakeAsyncClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        async def post(self, url, headers=None, json=None):
            captured_payloads.append({"url": url, "json": json})
            return fake_resp

    with patch("server.services.tts_service.httpx.AsyncClient", FakeAsyncClient):
        res1 = await tts_service.synthesize_speech(
            "**近く**の読法：ちかく！",
            api_key="test-key",
            voice="Aoede",
            cache_dir=isolated_env["tts_dir"],
        )
        assert res1["cache_hit"] is False
        assert res1["clean_text"] == "近くの読法：ちかく！"
        assert "systemInstruction" not in captured_payloads[0]["json"]
        wav_file = isolated_env["tts_dir"] / Path(res1["audio_url"]).name
        assert wav_file.read_bytes()[:4] == b"RIFF"

        # Second call hits disk cache with 0 network calls
        res2 = await tts_service.synthesize_speech(
            "**近く**の読法：ちかく！",
            api_key="test-key",
            voice="Aoede",
            cache_dir=isolated_env["tts_dir"],
        )
        assert res2["cache_hit"] is True
        assert len(captured_payloads) == 1


def _make_audible_wav(duration_sec: float = 0.6, amp: int = 6000, sample_rate: int = 16000) -> bytes:
    """Build a voiced-level 440Hz sine WAV buffer that clears the acoustic silence gate."""
    import math
    import struct

    n_samples = max(1, int(sample_rate * duration_sec))
    pcm = b"".join(
        struct.pack("<h", int(amp * math.sin(2.0 * math.pi * 440.0 * i / sample_rate)))
        for i in range(n_samples)
    )
    return pcm_to_wav_bytes(pcm, sample_rate=sample_rate)


@pytest.mark.asyncio
async def test_repeat_until_good_audio_mirror_state_machine(isolated_env):
    sample_wav = _make_audible_wav()

    session_info = await sensei_engine.create_guided_lesson(
        user_id="haodong",
        scenario_id="m1-first-impressions",
        lesson_type="guided_10min",
        api_key=None,
    )
    sid = session_info["sessionId"]

    mock_tts = AsyncMock(
        return_value={"audio_url": "/api/tts/cache/0123456789abcdef.wav", "cache_hit": False}
    )

    with patch("server.services.sensei_engine.synthesize_speech", mock_tts):
        # Attempt 1: score 68 -> retry_chunk + weakness logged (with defer_tts=False for sync URL check)
        with patch(
            "server.services.sensei_engine._call_gemini_json",
            AsyncMock(
                return_value={
                    "overallScore": 68,
                    "pitchScore": 60,
                    "grammarScore": 90,
                    "rhythmScore": 72,
                    "heardJp": "サンフランシスコのちかくからきました",
                    "betterJp": "サンフランシスコの近くから来ました。",
                    "drillChunkJp": "近く",
                    "drillChunkReading": "ちか＼く",
                    "pitchNote": "ちかく平读了，应该中高型ちか＼く。",
                    "grammarNote": "助词准确。",
                    "praiseCn": "流利度很好",
                    "issues": [{"type": "pitch", "severity": "minor", "patternKey": "近く音调", "detailCn": "第二拍降调不够"}],
                    "teacherSpokenScript": "刚才ちかく声调平了，跟我单练一遍，ちかく。",
                    "extractedVocab": [],
                    "_modelUsed": "gemini-4-hydrogen",
                }
            ),
        ):
            r1 = await sensei_engine.evaluate_sensei_turn(
                session_id=sid,
                user_id="haodong",
                step_index=0,
                stage="SHADOW_DRILL",
                target_jp="サンフランシスコの近くから来ました。",
                attempt=1,
                audio_bytes=sample_wav,
                defer_tts=False,
                api_key="test-key",
            )
            assert r1["decision"] == "retry_chunk"
            assert r1["drillChunkJp"] == "近く"
            client = TestClient(app)
            wav_res = client.get(r1["userAudioUrl"])
            assert wav_res.status_code == 200
            assert wav_res.content[:4] == b"RIFF"

        # Default defer_tts=True skips synthesize_speech and returns native .webm directly without ffmpeg
        mock_tts.reset_mock()
        fake_webm = b"\x1a\x45\xdf\xa3" + b"\x00" * 64
        with patch(
            "server.services.sensei_engine._call_gemini_json",
            AsyncMock(
                return_value={
                    "overallScore": 92,
                    "pitchScore": 94,
                    "grammarScore": 95,
                    "rhythmScore": 90,
                    "heardJp": "近く",
                    "betterJp": "サンフランシスコの近くから来ました。",
                    "drillChunkJp": "",
                    "drillChunkReading": "",
                    "pitchNote": "音调非常标准！",
                    "grammarNote": "完美。",
                    "praiseCn": "高低音很到位",
                    "issues": [],
                    "teacherSpokenScript": "太棒了，这遍声调非常地道！",
                    "extractedVocab": [],
                    "_modelUsed": "gemini-4-hydrogen",
                }
            ),
        ):
            r2 = await sensei_engine.evaluate_sensei_turn(
                session_id=sid,
                user_id="haodong",
                step_index=0,
                stage="SHADOW_DRILL",
                target_jp="サンフランシスコの近くから来ました。",
                attempt=2,
                drill_chunk_jp="近く",
                audio_bytes=fake_webm,
                audio_filename="turn.webm",
                content_type="audio/webm;codecs=opus",
                api_key="test-key",
            )
            assert r2["decision"] == "pass"
            assert r2["teacherAudioUrl"] == ""
            assert r2["userAudioUrl"].endswith(".webm")
            mock_tts.assert_not_called()
            webm_res = client.get(r2["userAudioUrl"])
            assert webm_res.status_code == 200
            assert "audio/webm" in webm_res.headers["content-type"]

        # Attempt 3 failing -> advance gently without infinite loop + weakness recorded
        with patch(
            "server.services.sensei_engine._call_gemini_json",
            AsyncMock(
                return_value={
                    "overallScore": 70,
                    "pitchScore": 70,
                    "grammarScore": 80,
                    "rhythmScore": 70,
                    "heardJp": "ちょっと",
                    "betterJp": "ちょっと待ってください。",
                    "drillChunkJp": "待って",
                    "issues": [{"type": "sokuon", "severity": "critical", "patternKey": "促音っ停顿", "detailCn": "っ未停顿"}],
                    "teacherSpokenScript": "没关系，我们先记下来继续下一步。",
                    "extractedVocab": [],
                    "_modelUsed": "gemini-4-argon",
                }
            ),
        ):
            r3 = await sensei_engine.evaluate_sensei_turn(
                session_id=sid,
                user_id="haodong",
                step_index=1,
                stage="SHADOW_DRILL",
                target_jp="ちょっと待ってください。",
                attempt=3,
                audio_bytes=sample_wav,
                api_key="test-key",
            )
            assert r3["decision"] == "advance"

    weaknesses = db.list_weaknesses("haodong", db_path=isolated_env["db"])
    keys = {w["pattern_key"] for w in weaknesses}
    assert "近く音调" in keys
    assert "促音っ停顿" in keys


def test_ws_live_protocol_handshake_and_clean_end(isolated_env, monkeypatch):
    class FakePart:
        def __init__(self, data=None):
            self.inline_data = type("Inline", (), {"data": data})() if data else None

    class FakeResp:
        def __init__(self, pcm_out=None, out_text=None, turn_complete=False):
            mt = type("MT", (), {"parts": [FakePart(pcm_out)]})() if pcm_out else None
            ot = type("OT", (), {"text": out_text})() if out_text else None
            self.server_content = type(
                "SC",
                (),
                {
                    "interrupted": False,
                    "input_transcription": None,
                    "output_transcription": ot,
                    "model_turn": mt,
                    "turn_complete": turn_complete,
                },
            )()

    class FakeLiveSession:
        async def send_client_content(self, **kwargs):
            return None

        async def send_realtime_input(self, **kwargs):
            return None

        async def receive(self):
            yield FakeResp(pcm_out=b"\x02\x00" * 480, out_text="こんにちは！", turn_complete=True)

    class FakeCM:
        async def __aenter__(self):
            return FakeLiveSession()

        async def __aexit__(self, *args):
            return False

    fake_client = MagicMock()
    fake_client.aio.live.connect.return_value = FakeCM()
    monkeypatch.setattr("server.services.live_relay.genai.Client", lambda **kwargs: fake_client)

    client = TestClient(app)
    with client.websocket_connect("/ws/live") as ws:
        ws.send_text(
            json.dumps(
                {
                    "type": "start_session",
                    "userId": "haodong",
                    "scenarioId": "daily_konbini",
                    "correctionMode": "strict",
                    "apiKey": "test-key",
                }
            )
        )
        msg1 = ws.receive_json()
        assert msg1["type"] == "session_ready"
        assert msg1["scenarioTitle"] == "便利店结账与加热便当"

        got_ai_audio = False
        got_ai_final = False
        for _ in range(6):
            raw = ws.receive()
            if "bytes" in raw and raw["bytes"]:
                got_ai_audio = True
            elif "text" in raw and raw["text"]:
                ev = json.loads(raw["text"])
                if ev.get("type") == "transcript_ai" and ev.get("final"):
                    got_ai_final = True
                if ev.get("type") == "turn_complete":
                    break
        assert got_ai_audio
        assert got_ai_final
        ws.send_text(json.dumps({"type": "end_session"}))



def test_veteran_syllabus_and_progress_tracking(isolated_env):
    import re
    from server.services import syllabus

    client = TestClient(app)
    r = client.get("/api/sensei/syllabus?user_id=haodong&jlpt_target=N4")
    assert r.status_code == 200
    body = r.json()
    assert len(body["tracks"]) == 10
    assert body["totalCount"] == 40
    assert body["recommendedLesson"]["id"] == "S01_mora_minimal_pairs"
    assert set(body["recommendedByLevel"].keys()) == {"N5", "N4", "N3"}

    # Validate textbook integrity across all 40 lessons
    hangul_re = re.compile(r"[\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F]")
    lvl_counts = {"N5": 0, "N4": 0, "N3": 0}
    seen_ids = set()
    for idx, ch in enumerate(syllabus.SENSEI_LESSONS, start=1):
        assert ch["order"] == idx
        assert ch["id"] not in seen_ids
        seen_ids.add(ch["id"])
        assert ch.get("canDoCn")
        bb = ch.get("blackboard") or {}
        assert bb.get("formulaJp") and bb.get("contrastGoodJp")
        assert len(ch.get("vocabList") or []) >= 6
        assert len(ch.get("grammarNotes") or []) >= 2
        assert len((ch.get("dialogue") or {}).get("turns") or []) >= 4
        assert not hangul_re.search(json.dumps(ch, ensure_ascii=False))
        lvl = ch["level"]
        lvl_counts[lvl] += 1
        if lvl in ("N4", "N3"):
            rp = ch.get("readingPassage") or {}
            assert rp.get("title") and rp.get("jp") and rp.get("cn")
        if lvl == "N3":
            assert len(ch["vocabList"]) >= 8
            assert len(ch["grammarNotes"]) >= 3
    assert lvl_counts == {"N5": 13, "N4": 12, "N3": 15}

    # Verify full chapter detail endpoint with tokenized blackboard contrast
    ch_res = client.get("/api/sensei/syllabus/S33_n3_decisions_habits")
    assert ch_res.status_code == 200
    ch_body = ch_res.json()["lesson"]
    assert ch_body["readingPassage"]["title"]
    assert len(ch_body["blackboard"]["contrastGoodTokens"]) >= 2

    # Simulate completing S01 -> progress advances recommendation to S02
    db.upsert_lesson_progress("haodong", "S01_mora_minimal_pairs", score=93, completed=True, db_path=isolated_env["db"])
    r2 = client.get("/api/sensei/syllabus?user_id=haodong&jlpt_target=N4").json()
    assert r2["completedCount"] == 1
    assert r2["recommendedLesson"]["id"] == "S02_pitch_contour"


@pytest.mark.asyncio
async def test_ai_textbook_authoring_syllabus_and_custom_topic(isolated_env):
    mocked_authored = {
        "blackboard": {
            "titleCn": "あげる vs くれる 视角突破",
            "grammarPoint": "授受动词方向",
            "formulaJp": "相手が 私に 〜てくれる",
            "cnPitfallCn": "别人帮你一定要用 くれる，不能用 あげる！",
            "contrastBadJp": "友だちは私に本をあげました。",
            "contrastGoodJp": "友だちが私に本をくれました。",
            "contrastNoteCn": "他人给我用 くれる",
        },
        "steps": [
            {"stage": "WARMUP", "stageLabel": "1. 热身唤醒", "hideTarget": False, "targetJp": "友だちがコーヒーを買ってくれました。", "targetCn": "朋友给我买了咖啡。", "cueCn": "热身", "tipCn": "注意 くれました", "teacherPrompt": "跟我读一遍，友だちがコーヒーを買ってくれました。"},
            {"stage": "TEACH", "stageLabel": "2. 核心精讲", "hideTarget": False, "targetJp": "同僚が資料を直してくれました。", "targetCn": "同事帮我改了资料。", "cueCn": "精讲", "tipCn": "〜てくれる", "teacherPrompt": "注意同事对你的帮助用 くれました"},
            {"stage": "CONTROLLED_DRILL", "stageLabel": "3. 节奏镜子", "hideTarget": False, "targetJp": "先生に発音を教えてもらいました。", "targetCn": "请老师教了我发音。", "cueCn": "镜子", "tipCn": "〜てもらう", "teacherPrompt": "试着读这句"},
            {"stage": "TRANSFORM_DRILL", "stageLabel": "4. 口头变形反射", "hideTarget": True, "targetJp": "母が写真を送ってくれました。", "targetCn": "妈妈给我发了照片。", "cueCn": "用 送る 表达：妈妈发给我了", "tipCn": "送ってくれました", "teacherPrompt": "试着用 くれる 说说看"},
            {"stage": "SUBSTITUTION_DRILL", "stageLabel": "5. 情景造句", "hideTarget": True, "targetJp": "友だちにおすすめのカフェを教えてもらいました。", "targetCn": "我让朋友推荐了一家咖啡馆。", "cueCn": "造句", "tipCn": "教えてもらう", "teacherPrompt": "说一句看看"},
            {"stage": "FREE_OUTPUT", "stageLabel": "6. 私教自由问答", "hideTarget": True, "questionJp": "最近、誰かに何かをしてもらいましたか。", "questionCn": "最近有人帮你做过什么事吗？", "targetJp": "はい、同僚が仕事を助けてくれました。", "targetCn": "有，同事帮了我的忙。", "cueCn": "自由回答", "tipCn": "用 くれました", "teacherPrompt": "回答我这个问题"},
        ],
    }

    with patch("server.services.sensei_engine._call_gemini_json", AsyncMock(return_value=mocked_authored)):
        res_syl = await sensei_engine.create_guided_lesson(
            user_id="haodong",
            curriculum_mode="sensei_syllabus",
            lesson_id="S11_giving_receiving",
            api_key="test-key",
        )
        assert res_syl["lessonMeta"]["curriculumMode"] == "sensei_syllabus"
        assert res_syl["lessonMeta"]["blackboard"]["grammarPoint"] == "授受动词方向"
        stages = [s["stage"] for s in res_syl["steps"]]
        assert "TRANSFORM_DRILL" in stages
        assert stages[-1] == "FREE_OUTPUT"
        assert len(res_syl["steps"][-1]["questionTokens"]) >= 2

        res_custom = await sensei_engine.create_guided_lesson(
            user_id="haodong",
            curriculum_mode="custom_topic",
            custom_topic="和日本同事聊周末与AI工具",
            api_key="test-key",
        )
        assert res_custom["lessonMeta"]["curriculumMode"] == "custom_topic"
        assert "和日本同事聊周末与AI工具" in res_custom["lessonMeta"]["title"]

    # N3 textbook chapter authoring injects readingPassage/grammarNotes into Gemini prompt and returns textbook metadata
    n3_prompts = []

    async def _capture_n3_author(parts, **kwargs):
        n3_prompts.append(parts[0]["text"])
        return mocked_authored

    with patch("server.services.sensei_engine._call_gemini_json", side_effect=_capture_n3_author):
        res_n3 = await sensei_engine.create_guided_lesson(
            user_id="haodong",
            curriculum_mode="sensei_syllabus",
            lesson_id="S33_n3_decisions_habits",
            api_key="test-key",
        )
    assert res_n3["lessonMeta"]["level"] == "N3"
    assert res_n3["lessonMeta"]["textbook"]["readingPassage"]["title"] == "新しい習慣が変えた毎日"
    assert "JLPT N3 中级难度校准" in n3_prompts[-1]
    assert "新しい習慣が変えた毎日" in n3_prompts[-1]



@pytest.mark.asyncio
async def test_travel_scenario_id_and_include_review_toggle(isolated_env):
    sc1 = curriculum_loader.get_scenario("1")
    assert sc1 is not None
    assert sc1["id"] == "1"
    assert "破冰" in sc1["title"]

    db.upsert_weakness(
        user_id="haodong",
        issue_type="particle",
        pattern_key="便利店测试旧错题",
        example_jp="マイバッグがあります。",
        note_cn="旧错题",
        db_path=isolated_env["db"],
    )

    # include_review=False must NOT inject old weakness_memory into Step 0
    no_rev = await sensei_engine.create_guided_lesson(
        user_id="haodong",
        curriculum_mode="travel_scenario",
        scenario_id="2",
        include_review=False,
        api_key=None,
    )
    assert "礼貌" in no_rev["scenario"]["title"]
    assert len(no_rev["weaknesses"]) == 0
    assert no_rev["steps"][0]["targetJp"] != "マイバッグがあります。"

    # include_review=True DOES inject weakness_memory into Step 0
    with_rev = await sensei_engine.create_guided_lesson(
        user_id="haodong",
        curriculum_mode="travel_scenario",
        scenario_id="2",
        include_review=True,
        api_key=None,
    )
    assert len(with_rev["weaknesses"]) >= 1
    assert with_rev["steps"][0]["targetJp"] == "マイバッグがあります。"



@pytest.mark.asyncio
async def test_call_gemini_json_failover_on_read_timeout():
    import httpx

    calls = []
    ok_resp = MagicMock()
    ok_resp.status_code = 200
    ok_resp.json.return_value = {
        "candidates": [{"content": {"parts": [{"text": '{"overallScore": 89, "teacherSpokenScript": "いいね"}'}]}}]
    }

    class FakeTimeoutClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        async def post(self, url, headers=None, json=None, timeout=None):
            calls.append(url)
            if "gemini-4-hydrogen" in url:
                raise httpx.ReadTimeout("simulated timeout")
            return ok_resp

    with patch("server.services.sensei_engine.httpx.AsyncClient", FakeTimeoutClient):
        out = await sensei_engine._call_gemini_json(
            parts=[{"text": "hi"}],
            models=["gemini-4-hydrogen", "gemini-4-neon"],
            api_key="test-key",
            timeout_sec=11.0,
        )
    assert out["_modelUsed"] == "gemini-4-neon"
    assert out["overallScore"] == 89
    assert len(calls) == 2


@pytest.mark.asyncio
async def test_tts_stream_endpoint_prewarm_and_cache(isolated_env):
    import asyncio

    # Odd-byte split across two SSE PCM chunks: 5 bytes + 5 bytes -> 10 bytes (5 int16 samples)
    pcm_all = b"\x01\x00\x02\x00\x03\x00\x04\x00\x05\x00"
    chunk1 = pcm_all[:5]
    chunk2 = pcm_all[5:]
    sse_lines = [
        "data: " + json.dumps({"candidates": [{"content": {"parts": [{"inlineData": {"mimeType": "audio/L16;rate=24000", "data": base64.b64encode(chunk1).decode("ascii")}}]}}]}),
        "data: " + json.dumps({"candidates": [{"content": {"parts": [{"inlineData": {"mimeType": "audio/L16;rate=24000", "data": base64.b64encode(chunk2).decode("ascii")}}]}}]}),
    ]

    upstream_calls = []

    class FakeStreamResp:
        status_code = 200

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        async def aread(self):
            return b""

        async def aiter_lines(self):
            for ln in sse_lines:
                await asyncio.sleep(0.01)
                yield ln

    class FakeStreamClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        def stream(self, method, url, headers=None, json=None, timeout=None):
            upstream_calls.append(url)
            return FakeStreamResp()

    tts_service._INFLIGHT_STREAMS.clear()
    import httpx

    orig_async_client = httpx.AsyncClient
    with patch("server.services.tts_service.httpx.AsyncClient", FakeStreamClient):
        pre_url = tts_service.prewarm_tts_stream(
            "**切手**をください",
            api_key="test-key",
            voice="Aoede",
            cache_dir=isolated_env["tts_dir"],
        )
        assert pre_url and pre_url.startswith("/api/tts/cache/")

        async with orig_async_client(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as client:
            resp1 = await client.post(
                "/api/tts/stream",
                json={"text": "**切手**をください", "voice": "Aoede"},
                headers={"X-Gemini-Api-Key": "test-key"},
            )
            assert resp1.status_code == 200
            assert resp1.headers["x-tts-sample-rate"] == "24000"
            assert resp1.headers["x-tts-cache-url"] == pre_url
            assert len(resp1.content) == len(pcm_all)
            assert len(resp1.content) % 2 == 0
            assert len(upstream_calls) == 1

            wav_path = isolated_env["tts_dir"] / Path(pre_url).name
            assert wav_path.exists()
            assert wav_path.read_bytes()[:4] == b"RIFF"

            # Second call hits disk WAV cache with 0 additional upstream requests
            resp2 = await client.post(
                "/api/tts/stream",
                json={"text": "**切手**をください", "voice": "Aoede"},
                headers={"X-Gemini-Api-Key": "test-key"},
            )
            assert resp2.status_code == 200
            assert resp2.content == pcm_all
            assert len(upstream_calls) == 1


def test_tts_stream_returns_502_on_upstream_error(isolated_env):
    class FakeErrResp:
        status_code = 500

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        async def aread(self):
            return b"upstream error"

    class FakeErrClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        def stream(self, *args, **kwargs):
            return FakeErrResp()

    tts_service._INFLIGHT_STREAMS.clear()
    with patch("server.services.tts_service.httpx.AsyncClient", FakeErrClient):
        client = TestClient(app)
        resp = client.post(
            "/api/tts/stream",
            json={"text": "おはようございます", "voice": "Aoede"},
            headers={"X-Gemini-Api-Key": "test-key"},
        )
        assert resp.status_code == 502


@pytest.mark.asyncio
async def test_hedged_failover_beats_hung_primary():
    import asyncio
    import time

    seen_models = []

    class FakeHedgedClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        async def post(self, url, headers=None, json=None, timeout=None):
            seen_models.append(url)
            if "gemini-4-hydrogen" in url:
                await asyncio.sleep(2.5)
                resp = MagicMock()
                resp.status_code = 200
                resp.json.return_value = {"candidates": [{"content": {"parts": [{"text": '{"overallScore": 70}'}]}}]}
                return resp
            await asyncio.sleep(0.03)
            resp = MagicMock()
            resp.status_code = 200
            resp.json.return_value = {
                "candidates": [{"content": {"parts": [{"text": '{"overallScore": 91, "teacherSpokenScript": "いいね"}'}]}}]
            }
            return resp

    t0 = time.perf_counter()
    with patch("server.services.sensei_engine.httpx.AsyncClient", FakeHedgedClient):
        out = await sensei_engine._call_gemini_json(
            parts=[{"text": "hi"}],
            models=["gemini-4-hydrogen", "gemini-3-flash-preview", "gemini-3.5-flash-lite"],
            api_key="test-key",
            timeout_sec=5.0,
            hedge_after_sec=0.12,
        )
    elapsed = time.perf_counter() - t0
    assert out["_modelUsed"] == "gemini-3-flash-preview"
    assert out["overallScore"] == 91
    assert elapsed < 1.0
    assert len(seen_models) == 2


def test_extract_json_text_repairs_invalid_escapes():
    raw = (
        '{"teacherSpokenScript":"a\\nb", "heardJp":"\\u3042\\uめ", '
        '"drillChunkReading":"ちか\\く", "issues":[],}'
    )
    parsed = sensei_engine._extract_json_text(raw)
    assert parsed["teacherSpokenScript"] == "a\nb"
    assert parsed["heardJp"] == "あ\\uめ"
    assert parsed["drillChunkReading"] == "ちか\\く"
    assert parsed["issues"] == []


def test_jp_to_kana_and_bilingual_tts_script_guard():
    assert jp_tokenizer.jp_to_kana("私は映画が好きです。") == "わたしはえいががすきです。"
    assert jp_tokenizer.jp_to_kana("あ、バスが来ました！") == "あ、バスがきました！"

    s1 = sensei_engine.prepare_tts_bilingual_script(
        "你的发音很清晰，但是映画的音调稍微平了点。跟我读：映画。整体很棒！",
        ["私は映画が好きです。", "映画"],
    )
    assert s1 == "你的发音很清晰，但是えいが的音调稍微平了点。跟我读：えいが。整体很棒！"

    s2 = sensei_engine.prepare_tts_bilingual_script(
        "佐藤さん的音调偏高。听示范，私は映画が好きです。。",
        ["佐藤さんは日本語がわかります。", "私は映画が好きです。"],
    )
    assert s2 == "さとうさん的音调偏高。听示范，わたしはえいががすきです。"


def test_tts_ja_lang_hint_kanaizes_bare_kanji(isolated_env):
    ja_meta = tts_service.get_tts_cache_meta("映画", lang="ja", cache_dir=isolated_env["tts_dir"])
    assert ja_meta["clean_text"] == "えいが"

    multi_meta = tts_service.get_tts_cache_meta(
        "新しい料理を作ってみます。", lang="ja", cache_dir=isolated_env["tts_dir"]
    )
    assert multi_meta["clean_text"] == "あたらしいりょうりをつくってみます。"

    cn_meta = tts_service.get_tts_cache_meta("你的发音很好", lang=None, cache_dir=isolated_env["tts_dir"])
    assert cn_meta["clean_text"] == "你的发音很好"


def test_jp_to_kana_and_tokenize_spoken_overrides():
    assert jp_tokenizer.jp_to_kana("明日、何を食べますか。") == "あした、なにをたべますか。"
    assert jp_tokenizer.jp_to_kana("今、何時ですか。") == "いま、なんじですか。"

    tokens = jp_tokenizer.tokenize_sentence("私は明日、何を食べますか。")
    readings = [t["reading"] for t in tokens if t["reading"]]
    assert "わたし" in readings
    assert "あした" in readings
    assert "なに" in readings


def test_split_bilingual_tts_segments_isolates_zh_and_ja():
    s1 = tts_service.split_bilingual_tts_segments("非常棒，变形很快很自然。あたらしいりょうりをつくってみます。")
    assert s1 == [("zh", "非常棒，变形很快很自然。"), ("ja", "あたらしいりょうりをつくってみます。")]

    s2 = tts_service.split_bilingual_tts_segments("发音很清晰。跟我读：予約。")
    assert s2 == [("zh", "发音很清晰。跟我读。"), ("ja", "よやく。")]

    s3 = tts_service.split_bilingual_tts_segments("新しい料理を作ってみます。", lang="ja")
    assert s3 == [("ja", "あたらしいりょうりをつくってみます。")]

    s4 = tts_service.split_bilingual_tts_segments("近くの読法：ちかく！")
    assert len(s4) == 1 and s4[0][0] == "ja"


@pytest.mark.asyncio
async def test_tts_stream_bilingual_stitches_parallel_segments(isolated_env):
    import asyncio
    import httpx

    seg1_pcm = b"\x01\x00" * 400
    seg2_pcm = b"\x02\x00" * 500
    seen_texts = []

    class FakeSegStreamResp:
        def __init__(self, pcm: bytes):
            self.status_code = 200
            self._pcm = pcm

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        async def aread(self):
            return b""

        async def aiter_lines(self):
            await asyncio.sleep(0.01)
            yield "data: " + json.dumps(
                {
                    "candidates": [
                        {
                            "content": {
                                "parts": [
                                    {
                                        "inlineData": {
                                            "mimeType": "audio/L16;rate=24000",
                                            "data": base64.b64encode(self._pcm).decode("ascii"),
                                        }
                                    }
                                ]
                            }
                        }
                    ]
                }
            )

    class FakeSegClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        def stream(self, method, url, headers=None, json=None, timeout=None):
            txt = json["contents"][0]["parts"][0]["text"]
            seen_texts.append(txt)
            return FakeSegStreamResp(seg1_pcm if "非常棒" in txt else seg2_pcm)

    tts_service._INFLIGHT_STREAMS.clear()
    orig_client = httpx.AsyncClient
    with patch("server.services.tts_service.httpx.AsyncClient", FakeSegClient):
        async with orig_client(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            resp = await client.post(
                "/api/tts/stream",
                json={"text": "非常棒，变形很快。新しい料理を作ってみます。", "voice": "Aoede"},
                headers={"X-Gemini-Api-Key": "test-key"},
            )
            assert resp.status_code == 200
            assert len(seen_texts) == 2
            assert seen_texts[0] == "非常棒，变形很快。"
            assert seen_texts[1] == "あたらしいりょうりをつくってみます。"
            assert len(resp.content) > len(seg1_pcm) + len(seg2_pcm)
            cache_url = resp.headers["x-tts-cache-url"]
            wav_file = isolated_env["tts_dir"] / Path(cache_url).name
            assert wav_file.exists() and wav_file.read_bytes()[:4] == b"RIFF"


def test_passcode_auth_gate_on_verify_and_protected_endpoints(isolated_env, monkeypatch):
    monkeypatch.setattr(config, "APP_PASSCODE", "1993")
    monkeypatch.setattr("server.main.APP_PASSCODE", "1993")

    client = TestClient(app)
    health = client.get("/api/health")
    assert health.status_code == 200
    assert health.json()["auth_required"] is True

    assert client.post("/api/auth/verify").status_code == 401
    assert client.post("/api/auth/verify", headers={"X-App-Passcode": "0000"}).status_code == 401

    ok_auth = client.post("/api/auth/verify", headers={"X-App-Passcode": "1993"})
    assert ok_auth.status_code == 200
    assert ok_auth.json() == {"ok": True, "auth_required": True}

    unauthed = client.post("/api/sensei/lesson/start", json={"user_id": "haodong", "curriculum_mode": "sensei_syllabus"})
    assert unauthed.status_code == 401

    authed = client.post(
        "/api/sensei/lesson/start",
        json={"user_id": "haodong", "curriculum_mode": "sensei_syllabus"},
        headers={"X-App-Passcode": "1993"},
    )
    assert authed.status_code == 200


def test_detect_native_gemini_audio_prefers_magic_bytes():
    from server.services import audio_utils

    # iOS MP4/M4A bytes mislabeled as .webm / audio/webm must still resolve as audio/mp4
    mp4_bytes = b"\x00\x00\x00\x18ftypmp42\x00\x00\x00\x00mp42isom"
    assert (
        audio_utils.detect_native_gemini_audio(
            mp4_bytes, filename="student_turn.webm", content_type="audio/webm"
        )
        == ("audio/mp4", "m4a")
    )

    # WebM EBML header resolves as audio/webm
    webm_bytes = b"\x1a\x45\xdf\xa3\x9fB\x86\x81\x01B\xf7\x81\x01"
    assert (
        audio_utils.detect_native_gemini_audio(
            webm_bytes, filename="student_turn.webm", content_type="audio/webm;codecs=opus"
        )
        == ("audio/webm", "webm")
    )

    # Fallback to MIME type when bytes have no known magic header
    assert (
        audio_utils.detect_native_gemini_audio(
            b"\x00" * 16, filename="clip.bin", content_type="audio/mp4;codecs=mp4a.40.2"
        )
        == ("audio/mp4", "m4a")
    )


@pytest.mark.asyncio
async def test_synthesize_tts_awaits_inflight_prewarm_without_duplicate_call(isolated_env):
    import asyncio

    pcm_data = b"\x02\x00" * 1600
    sse_lines = [
        "data: "
        + json.dumps(
            {
                "candidates": [
                    {
                        "content": {
                            "parts": [
                                {
                                    "inlineData": {
                                        "mimeType": "audio/L16;rate=24000",
                                        "data": base64.b64encode(pcm_data).decode("ascii"),
                                    }
                                }
                            ]
                        }
                    }
                ]
            }
        )
    ]
    upstream_calls = []

    class FakeSlowStreamResp:
        status_code = 200

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        async def aread(self):
            return b""

        async def aiter_lines(self):
            await asyncio.sleep(0.08)
            for ln in sse_lines:
                yield ln

    class FakeSlowStreamClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        def stream(self, method, url, headers=None, json=None, timeout=None):
            upstream_calls.append(url)
            return FakeSlowStreamResp()

    tts_service._INFLIGHT_STREAMS.clear()
    with patch("server.services.tts_service.httpx.AsyncClient", FakeSlowStreamClient):
        pre_url = tts_service.prewarm_tts_stream(
            "おはようございます",
            api_key="test-key",
            voice="Aoede",
            cache_dir=isolated_env["tts_dir"],
        )
        assert pre_url and pre_url.startswith("/api/tts/cache/")
        res = await tts_service.synthesize_speech(
            "おはようございます",
            api_key="test-key",
            voice="Aoede",
            cache_dir=isolated_env["tts_dir"],
        )
        assert res["cache_hit"] is True
        assert res["audio_url"] == pre_url
        wav_path = isolated_env["tts_dir"] / Path(pre_url).name
        assert wav_path.exists() and wav_path.read_bytes()[:4] == b"RIFF"
        assert len(upstream_calls) == 1


def test_strip_wav_header_excludes_trailing_c2pa_chunk_and_polishes_pcm():
    import array
    import struct

    # 1. Valid RIFF/WAVE containing fmt + data + trailing C2PA JUMBF metadata chunk
    expected_pcm = b"".join(struct.pack("<h", (i * 137) % 10000 - 5000) for i in range(600))
    fmt_chunk = b"fmt " + struct.pack("<IHHIIHH", 16, 1, 1, 24000, 48000, 2, 16)
    data_chunk = b"data" + struct.pack("<I", len(expected_pcm)) + expected_pcm
    c2pa_payload = b"jumb\x00\x00\x00\x1ejumdc2pa\x00\x11" + b"\xff" * 48
    c2pa_chunk = b"C2PA" + struct.pack("<I", len(c2pa_payload)) + c2pa_payload
    riff_body = b"WAVE" + fmt_chunk + data_chunk + c2pa_chunk
    wav_with_c2pa = b"RIFF" + struct.pack("<I", len(riff_body)) + riff_body

    stripped = tts_service._strip_wav_header(wav_with_c2pa)
    assert stripped == expected_pcm
    assert b"C2PA" not in stripped and b"jumb" not in stripped

    # Also verify fallback C2PA guard on raw unframed PCM chunks
    assert tts_service._strip_wav_header(expected_pcm + b"C2PA" + c2pa_payload) == expected_pcm

    # 2. Peak soft-limiter (<= 29500) + smooth 4ms boundary fade-in/out on real-length speech
    loud = array.array("h", [32767 if i % 2 == 0 else -32768 for i in range(1000)])
    polished_bytes = tts_service._polish_pcm_segment(loud.tobytes(), sample_rate=24000)
    assert len(polished_bytes) == len(loud.tobytes())
    polished = array.array("h")
    polished.frombytes(polished_bytes)
    assert max(abs(s) for s in polished) <= 29500
    assert polished[0] == 0 and polished[-1] == 0
    assert abs(polished[500]) > 28000


@pytest.mark.asyncio
async def test_hangul_sanitizer_strips_korean_from_eval_and_tts(isolated_env):
    from server.services import live_relay

    # 1. Helper & TTS transcript sanitizer strip Hangul while preserving Japanese + Chinese
    assert sensei_engine.strip_foreign_hangul("予約します예약합니다。") == "予約します。"
    assert sensei_engine.strip_foreign_hangul("안녕하세요 こんにちは") == "こんにちは"
    assert tts_service.clean_tts_transcript("发音很棒。예약 予約します。", lang="zh") == "发音很棒。 予約します。"
    assert tts_service.clean_tts_transcript("안녕하세요 こんにちは", lang="ja") == "こんにちは"

    # 2. Live relay system instruction explicitly locks out Korean/Hangul
    sys_prompt = live_relay.build_live_system_instruction(
        scenario=None,
        user_id="haodong",
        jlpt_target="N4",
        correction_mode="tutor",
    )
    assert "韩语" in sys_prompt and "한글" in sys_prompt

    # 3. evaluate_sensei_turn strips hallucinated Hangul across all fields + _on_script_ready
    sid = db.create_session(
        user_id="haodong",
        mode="sensei_syllabus",
        scenario_id="S01_mora_minimal_pairs",
        persona="Sensei",
        lesson_plan={"steps": []},
    )
    sample_wav = _make_audible_wav()
    prewarm_calls = []

    def _capture_prewarm(script: str, **kwargs):
        prewarm_calls.append(script)
        return "/api/tts/cache/fake.wav"

    polluted_eval = {
        "overallScore": 78,
        "pitchScore": 75,
        "grammarScore": 82,
        "rhythmScore": 77,
        "heardJp": "ちょっと 예약 待ってください",
        "betterJp": "ちょっと待って안녕하세요ください。",
        "drillChunkJp": "待って 예약",
        "drillChunkReading": "まって",
        "pitchNote": "注意 예약 不要变成韩语。",
        "grammarNote": "连接正确。",
        "praiseCn": "整体不错",
        "issues": [{"type": "pitch", "severity": "minor", "patternKey": "促音 예약", "detailCn": "停顿一下"}],
        "teacherSpokenScript": "发音不错，注意停顿。한국어 ちょっと待ってください。",
        "extractedVocab": [{"surface": "待つ", "reading": "まつ", "meaningCn": "等待 예약", "jlpt": "N5"}],
        "_modelUsed": "gemini-3-flash-preview",
    }

    async def _fake_call_gemini_json(*, on_script_ready=None, **kwargs):
        if on_script_ready:
            on_script_ready(polluted_eval["teacherSpokenScript"])
        return polluted_eval

    with (
        patch("server.services.sensei_engine._call_gemini_json", side_effect=_fake_call_gemini_json),
        patch("server.services.sensei_engine.prewarm_tts_stream", side_effect=_capture_prewarm),
    ):
        res = await sensei_engine.evaluate_sensei_turn(
            session_id=sid,
            user_id="haodong",
            step_index=0,
            stage="CONTROLLED_DRILL",
            target_jp="ちょっと待ってください。",
            attempt=1,
            audio_bytes=sample_wav,
            defer_tts=True,
            api_key="test-key",
        )

    assert not sensei_engine._HANGUL_RE.search(json.dumps(res, ensure_ascii=False))
    assert res["heardJp"] == "ちょっと 待ってください"
    assert res["betterJp"] == "ちょっと待ってください。"
    assert len(prewarm_calls) == 1
    assert not sensei_engine._HANGUL_RE.search(prewarm_calls[0])


@pytest.mark.asyncio
async def test_silent_audio_blocked_by_acoustic_gate_and_model_no_speech_guard(isolated_env):
    from server.services import audio_utils

    sid = db.create_session(
        user_id="haodong",
        mode="sensei_syllabus",
        scenario_id="S01_mora_minimal_pairs",
        persona="Sensei",
        lesson_plan={"steps": []},
    )

    # 1. Pure zero silence WAV (1.0s) -> blocked before Gemini, no weaknesses recorded
    silent_wav = pcm_to_wav_bytes(b"\x00\x00" * 16000, sample_rate=16000)
    gate_silence = audio_utils.analyze_audio_speech_activity(silent_wav, "silent.wav", "audio/wav")
    assert gate_silence["analyzed"] is True
    assert gate_silence["has_speech"] is False
    assert gate_silence["reason"] == "silence"

    mock_gemini = AsyncMock()
    with patch("server.services.sensei_engine._call_gemini_json", mock_gemini):
        r_silent = await sensei_engine.evaluate_sensei_turn(
            session_id=sid,
            user_id="haodong",
            step_index=0,
            stage="SHADOW_DRILL",
            target_jp="ちょっと待ってください。",
            attempt=1,
            audio_bytes=silent_wav,
            defer_tts=True,
            api_key="test-key",
        )
    mock_gemini.assert_not_called()
    assert r_silent["noSpeech"] is True
    assert r_silent["decision"] == "no_speech"
    assert r_silent["overallScore"] == 0
    assert r_silent["heardJp"] == ""
    assert db.list_weaknesses("haodong", db_path=isolated_env["db"]) == []

    # 2. Ultra-short click WAV (0.1s) -> also blocked before Gemini
    short_wav = _make_audible_wav(duration_sec=0.1)
    with patch("server.services.sensei_engine._call_gemini_json", mock_gemini):
        r_short = await sensei_engine.evaluate_sensei_turn(
            session_id=sid,
            user_id="haodong",
            step_index=0,
            stage="SHADOW_DRILL",
            target_jp="ちょっと待ってください。",
            attempt=1,
            audio_bytes=short_wav,
            defer_tts=True,
            api_key="test-key",
        )
    mock_gemini.assert_not_called()
    assert r_short["noSpeech"] is True
    assert r_short["decision"] == "no_speech"
    assert r_short["audioStats"]["reason"] == "too_short"

    # 3. Audible WAV where Gemini flags noSpeech=True -> zeroed out even if model gave scores/praise
    audible_wav = _make_audible_wav()
    with patch(
        "server.services.sensei_engine._call_gemini_json",
        AsyncMock(
            return_value={
                "noSpeech": True,
                "heardJp": "",
                "overallScore": 78,
                "praiseCn": "读得很好",
                "issues": [{"type": "pitch", "severity": "minor", "patternKey": "fake", "detailCn": "fake"}],
                "_modelUsed": "gemini-4-hydrogen",
            }
        ),
    ):
        r_flag = await sensei_engine.evaluate_sensei_turn(
            session_id=sid,
            user_id="haodong",
            step_index=0,
            stage="SHADOW_DRILL",
            target_jp="ちょっと待ってください。",
            attempt=1,
            audio_bytes=audible_wav,
            defer_tts=True,
            api_key="test-key",
        )
    assert r_flag["noSpeech"] is True
    assert r_flag["decision"] == "no_speech"
    assert r_flag["overallScore"] == 0
    assert r_flag["praiseCn"] == ""
    assert db.list_weaknesses("haodong", db_path=isolated_env["db"]) == []

    # 4. Audible WAV where Gemini leaves heardJp empty even with noSpeech=False -> enforced no_speech
    with patch(
        "server.services.sensei_engine._call_gemini_json",
        AsyncMock(
            return_value={
                "noSpeech": False,
                "heardJp": "",
                "overallScore": 82,
                "praiseCn": "不错",
                "_modelUsed": "gemini-3-flash-preview",
            }
        ),
    ):
        r_empty = await sensei_engine.evaluate_sensei_turn(
            session_id=sid,
            user_id="haodong",
            step_index=0,
            stage="SHADOW_DRILL",
            target_jp="ちょっと待ってください。",
            attempt=1,
            audio_bytes=audible_wav,
            defer_tts=True,
            api_key="test-key",
        )
    assert r_empty["noSpeech"] is True
    assert r_empty["decision"] == "no_speech"
    assert r_empty["overallScore"] == 0


@pytest.mark.asyncio
async def test_grammar_point_travel_ai_authoring_and_extend_lesson(isolated_env):
    from server.services import curriculum_loader

    # 1. Unified grammar catalog merges core N5-N3 + video N4/N3 & powers GET /api/grammar
    all_grammar = curriculum_loader.list_all_grammar()
    ids = {g["id"] for g in all_grammar}
    assert "g-n5-01" in ids and "vn4-01" in ids

    client = TestClient(app)
    res_n4 = client.get("/api/grammar", params={"level": "N4"})
    assert res_n4.status_code == 200
    n4_items = res_n4.json()["grammar"]
    assert n4_items and all(item["level"] == "N4" for item in n4_items)

    # 2. Grammar library AI lesson authoring supports flexible >6 step length & injects formation context
    captured_prompts = []
    grammar_8_steps = {
        "blackboard": {
            "titleCn": "は vs が 核心精讲",
            "grammarPoint": "〜は / 〜が",
            "formulaJp": "名詞＋は / 名詞＋が",
            "cnPitfallCn": "好恶对象「好き」前面一定要用 が！",
            "contrastBadJp": "私は寿司を好きです。",
            "contrastGoodJp": "私は寿司が好きです。",
            "contrastNoteCn": "好き前面不用 を",
        },
        "steps": [
            {"stage": "WARMUP", "stageLabel": f"{i + 1}. 步", "hideTarget": i >= 4, "targetJp": f"日本語の文その{i + 1}です。", "targetCn": f"第{i + 1}句", "cueCn": "提示", "tipCn": "贴士", "teacherPrompt": "跟我读一句。"}
            for i in range(8)
        ],
    }

    async def _mock_author(parts, **kwargs):
        captured_prompts.append(parts[0]["text"])
        return grammar_8_steps

    with patch("server.services.sensei_engine._call_gemini_json", side_effect=_mock_author):
        res_gp = await sensei_engine.create_guided_lesson(
            user_id="haodong",
            curriculum_mode="grammar_point",
            grammar_id="g-n5-01",
            api_key="test-key",
        )
    assert res_gp["lessonMeta"]["curriculumMode"] == "grammar_point"
    assert res_gp["lessonMeta"]["grammarId"] == "g-n5-01"
    assert len(res_gp["steps"]) == 8
    assert "名词 ＋ は" in captured_prompts[-1]

    # 3. Family travel scenario AI authoring creates fresh multi-turn dialogue with questionTokens + blackboard
    travel_8_steps = {
        "blackboard": {
            "titleCn": "亲子餐厅对话策略",
            "grammarPoint": "〜ていただけますか",
            "formulaJp": "子ども用の椅子をお借りできますか。",
            "cnPitfallCn": "直接要儿童椅用お借りできますか最自然。",
            "contrastBadJp": "子どもの椅子をください。",
            "contrastGoodJp": "子ども用の椅子をお借りできますか。",
            "contrastNoteCn": "用借比给更委婉",
        },
        "steps": [
            {
                "stage": "CONTROLLED_DRILL" if i < 5 else "FREE_OUTPUT",
                "stageLabel": f"{i + 1}. 对话轮",
                "hideTarget": i >= 4,
                "questionJp": "いらっしゃいませ！何名様でしょうか。",
                "questionCn": "欢迎光临！请问几位？",
                "targetJp": f"大人二人と子ども二人です。{i + 1}。",
                "targetCn": "两大两小。",
                "cueCn": "自然回应",
                "tipCn": "清晰报人数",
                "teacherPrompt": "听店员问话后自然回答。大人二人と子ども二人です。",
            }
            for i in range(8)
        ],
    }

    with patch("server.services.sensei_engine._call_gemini_json", AsyncMock(return_value=travel_8_steps)):
        res_tr = await sensei_engine.create_guided_lesson(
            user_id="haodong",
            curriculum_mode="travel_scenario",
            scenario_id="1",
            api_key="test-key",
        )
    assert res_tr["lessonMeta"]["curriculumMode"] == "travel_scenario"
    assert res_tr["lessonMeta"]["aiGenerated"] is True
    assert res_tr["lessonMeta"]["blackboard"]["grammarPoint"] == "〜ていただけますか"
    assert len(res_tr["steps"]) == 8
    assert len(res_tr["steps"][0]["questionTokens"]) >= 2

    # 4. extend_guided_lesson appends contiguous stepIndex [8, 9, 10]
    ext_payload = {
        "steps": [
            {"stage": "TRANSFORM_DRILL", "stageLabel": "9. 加练变形", "hideTarget": True, "targetJp": "水もお願いできますか。", "targetCn": "能顺便来点水吗？", "cueCn": "拓展点单", "tipCn": "礼貌请求", "teacherPrompt": "试试追加请求。"},
            {"stage": "SUBSTITUTION_DRILL", "stageLabel": "10. 情景加练", "hideTarget": True, "targetJp": "子ども用のスプーンをいただけますか。", "targetCn": "可以给我儿童勺子吗？", "cueCn": "向店员要勺子", "tipCn": "いただけますか", "teacherPrompt": "直接开口说说看。"},
            {"stage": "FREE_OUTPUT", "stageLabel": "11. 自由收尾", "hideTarget": True, "questionJp": "お会計はご一緒でよろしいですか。", "questionCn": "一起结账可以吗？", "targetJp": "はい、一緒にお願いします。", "targetCn": "好的，一起结。", "cueCn": "自然回答店员", "tipCn": "一緒にお願いします", "teacherPrompt": "回复店员的结账确认。はい、一緒にお願いします。"},
        ]
    }
    with patch("server.services.sensei_engine._call_gemini_json", AsyncMock(return_value=ext_payload)):
        ext_res = await sensei_engine.extend_guided_lesson(
            session_id=res_tr["sessionId"],
            user_id="haodong",
            curriculum_mode="travel_scenario",
            lesson_title="初见破冰",
            grammar_focus="〜ていただけますか",
            existing_targets=[s["targetJp"] for s in res_tr["steps"]],
            start_index=8,
            scenario_id="1",
            api_key="test-key",
        )
    assert [s["stepIndex"] for s in ext_res["steps"]] == [8, 9, 10]
    assert all(len(s["tokens"]) >= 2 and s["teacherPromptTts"] for s in ext_res["steps"])
