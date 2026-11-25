"""Configuration & environment settings for Nihongo Sensei AI backend."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv
from fastapi import HTTPException

SERVER_DIR = Path(__file__).resolve().parent
REPO_ROOT = SERVER_DIR.parent

load_dotenv(SERVER_DIR / ".env")

DB_PATH = Path(os.getenv("SENSEI_DB_PATH", str(SERVER_DIR / "sensei.db")))
CACHE_DIR = Path(os.getenv("SENSEI_CACHE_DIR", str(SERVER_DIR / "cache")))
TTS_CACHE_DIR = CACHE_DIR / "tts"
TURN_AUDIO_DIR = CACHE_DIR / "turns"
STORY_AUDIO_DIR = CACHE_DIR / "stories"
DATA_DIR = SERVER_DIR / "data"
CURRICULUM_SNAPSHOT_PATH = DATA_DIR / "curriculum_snapshot.json"

for _d in (CACHE_DIR, TTS_CACHE_DIR, TURN_AUDIO_DIR, STORY_AUDIO_DIR, DATA_DIR):
    _d.mkdir(parents=True, exist_ok=True)

GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta"

LIVE_MODEL = os.getenv("LIVE_MODEL", "gemini-3.8-live")
LIVE_FALLBACK_MODELS = [
    "gemini-3.1-flash-live-preview",
    "gemini-2.5-flash-native-audio-latest",
]

COACH_MODEL = os.getenv("COACH_MODEL", "gemini-4-hydrogen")
COACH_FALLBACK_MODELS = ["gemini-3-flash-preview", "gemini-3.5-flash-lite", "gemini-4-neon"]
COACH_MODEL_OPTIONS = [
    {"id": "gemini-4-hydrogen", "label": "🎯 Gemini 4 Hydrogen（均衡精准 · ~4s · 推荐）"},
    {"id": "gemini-3.5-flash-lite", "label": "⚡ Gemini 3.5 Flash Lite（极速刷句 · ~1.5s）"},
    {"id": "gemini-4-neon", "label": "🧠 Gemini 4 Neon（深度精评 · ~10s）"},
]

REPORT_MODEL = os.getenv("REPORT_MODEL", "gemini-4-neon")
REPORT_FALLBACK_MODELS = ["gemini-4-hydrogen", "gemini-4-argon"]
AUTHOR_MODELS = ["gemini-3.5-flash-lite", "gemini-3-flash-preview", "gemini-4-hydrogen"]

TTS_FAST_MODEL = os.getenv("TTS_FAST_MODEL", "gemini-3.8-flash-lite-tts")
TTS_STORY_MODEL = os.getenv("TTS_STORY_MODEL", "gemini-3.8-flash-tts")
DEFAULT_VOICE = os.getenv("DEFAULT_VOICE", "Aoede")
AVAILABLE_VOICES = [
    {"id": "Aoede", "label": "Aoede（温柔女老师 · 推荐）"},
    {"id": "Kore", "label": "Kore（沉稳知性女声）"},
    {"id": "Puck", "label": "Puck（爽朗男老师）"},
    {"id": "Charon", "label": "Charon（稳重男声 · 餐厅店员）"},
]

APP_PASSCODE = os.getenv("APP_PASSCODE", "").strip()


def get_server_api_key() -> str:
    return os.getenv("GEMINI_API_KEY", "").strip()


def resolve_api_key(header_key: Optional[str] = None, required: bool = True) -> str:
    """Resolve Gemini API key from server env first, or local BYOK header fallback."""
    key = get_server_api_key() or (header_key or "").strip()
    if required and not key:
        raise HTTPException(
            status_code=400,
            detail="未检测到 Gemini API Key：请在 server/.env 配置 GEMINI_API_KEY，或在前端设置中填入本地 Key。",
        )
    return key


def verify_passcode(provided_passcode: Optional[str]) -> None:
    """Optional family passcode gate when APP_PASSCODE is configured."""
    if not APP_PASSCODE:
        return
    if (provided_passcode or "").strip() != APP_PASSCODE:
        raise HTTPException(status_code=401, detail="访问口令无效，请在前端输入家庭口令。")
