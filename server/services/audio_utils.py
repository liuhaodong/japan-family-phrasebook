"""Audio conversion, zero-FFmpeg container detection, and WAV container utilities."""

from __future__ import annotations

import io
import subprocess
import wave
from typing import Tuple

_MEDIA_MIME_BY_EXT = {
    "wav": "audio/wav",
    "webm": "audio/webm",
    "ogg": "audio/ogg",
    "mp3": "audio/mp3",
    "m4a": "audio/mp4",
    "mp4": "audio/mp4",
}


def pcm_to_wav_bytes(
    pcm_bytes: bytes,
    sample_rate: int = 24000,
    channels: int = 1,
    sampwidth: int = 2,
) -> bytes:
    """Wrap raw signed PCM bytes into a standard RIFF WAV byte buffer."""
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(channels)
        wf.setsampwidth(sampwidth)
        wf.setframerate(sample_rate)
        wf.writeframes(pcm_bytes)
    return buf.getvalue()


def is_wav_16k_mono(raw_bytes: bytes) -> bool:
    """Return True if raw_bytes is already 16kHz 16-bit mono RIFF WAV."""
    if len(raw_bytes) < 44 or raw_bytes[:4] != b"RIFF":
        return False
    try:
        with wave.open(io.BytesIO(raw_bytes), "rb") as wf:
            return (
                wf.getnchannels() == 1
                and wf.getsampwidth() == 2
                and wf.getframerate() == 16000
            )
    except Exception:
        return False


def detect_native_gemini_audio(
    raw_bytes: bytes,
    filename: str = "",
    content_type: str = "",
) -> Tuple[str, str] | None:
    """Detect audio formats supported natively by Gemini without ffmpeg transcoding."""
    base_mime = (content_type or "").split(";")[0].strip().lower()
    ext_hint = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""

    if len(raw_bytes) >= 12 and raw_bytes[:4] == b"RIFF" and raw_bytes[8:12] == b"WAVE":
        return ("audio/wav", "wav")
    if raw_bytes[:4] == b"\x1a\x45\xdf\xa3" or base_mime == "audio/webm" or ext_hint == "webm":
        return ("audio/webm", "webm")
    if raw_bytes[:4] == b"OggS" or base_mime == "audio/ogg" or ext_hint == "ogg":
        return ("audio/ogg", "ogg")
    if (
        raw_bytes[:3] == b"ID3"
        or (len(raw_bytes) >= 2 and raw_bytes[0] == 0xFF and (raw_bytes[1] & 0xE0) == 0xE0)
        or base_mime in ("audio/mp3", "audio/mpeg")
        or ext_hint == "mp3"
    ):
        return ("audio/mp3", "mp3")
    if (
        (len(raw_bytes) >= 12 and raw_bytes[4:8] == b"ftyp")
        or base_mime in ("audio/mp4", "audio/m4a", "audio/aac")
        or ext_hint in ("m4a", "mp4")
    ):
        return ("audio/mp4", "m4a")
    return None


def media_type_for_filename(filename: str) -> str:
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else "wav"
    return _MEDIA_MIME_BY_EXT.get(ext, "audio/wav")


def ensure_wav_16k_mono(
    raw_bytes: bytes,
    filename: str = "audio.wav",
    content_type: str = "",
) -> bytes:
    """Normalize uploaded WebM/MP4/WAV audio into 16kHz mono 16-bit PCM WAV."""
    if not raw_bytes:
        raise ValueError("音频数据为空，请重新录音。")
    if is_wav_16k_mono(raw_bytes):
        return raw_bytes

    cmd = [
        "ffmpeg",
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        "pipe:0",
        "-ar",
        "16000",
        "-ac",
        "1",
        "-c:a",
        "pcm_s16le",
        "-f",
        "wav",
        "pipe:1",
    ]
    proc = subprocess.run(
        cmd,
        input=raw_bytes,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=25,
    )
    if proc.returncode != 0 or not proc.stdout.startswith(b"RIFF"):
        err_msg = proc.stderr.decode("utf-8", errors="replace").strip()
        raise RuntimeError(f"音频转码失败 ({filename} / {content_type}): {err_msg or 'unknown error'}")
    return proc.stdout


def normalize_gemini_audio(
    raw_bytes: bytes,
    filename: str = "recording.webm",
    content_type: str = "",
) -> Tuple[bytes, str, str]:
    """Pass through native browser WebM/MP4/OGG/MP3/WAV bytes directly; transcode only if needed."""
    if not raw_bytes:
        raise ValueError("音频数据为空，请重新录音。")
    detected = detect_native_gemini_audio(raw_bytes, filename=filename, content_type=content_type)
    if detected:
        mime, ext = detected
        return raw_bytes, mime, ext
    wav_16k = ensure_wav_16k_mono(raw_bytes, filename=filename, content_type=content_type)
    return wav_16k, "audio/wav", "wav"
