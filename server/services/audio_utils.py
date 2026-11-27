"""Audio conversion, zero-FFmpeg container detection, and WAV container utilities."""

from __future__ import annotations

import array
import io
import math
import shutil
import subprocess
import sys
import wave
from typing import Any, Dict, Tuple

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

    # 1. Inspect container magic bytes first so mislabeled uploads (e.g. iOS MP4 named .webm) are never misclassified.
    if len(raw_bytes) >= 12 and raw_bytes[:4] == b"RIFF" and raw_bytes[8:12] == b"WAVE":
        return ("audio/wav", "wav")
    if raw_bytes[:4] == b"\x1a\x45\xdf\xa3":
        return ("audio/webm", "webm")
    if raw_bytes[:4] == b"OggS":
        return ("audio/ogg", "ogg")
    if len(raw_bytes) >= 12 and raw_bytes[4:8] == b"ftyp":
        return ("audio/mp4", "m4a")
    if raw_bytes[:3] == b"ID3" or (
        len(raw_bytes) >= 2 and raw_bytes[0] == 0xFF and (raw_bytes[1] & 0xE0) == 0xE0
    ):
        return ("audio/mp3", "mp3")

    # 2. Fall back to MIME type.
    if base_mime in ("audio/wav", "audio/x-wav"):
        return ("audio/wav", "wav")
    if base_mime == "audio/webm":
        return ("audio/webm", "webm")
    if base_mime == "audio/ogg":
        return ("audio/ogg", "ogg")
    if base_mime in ("audio/mp4", "audio/m4a", "audio/aac", "audio/x-m4a"):
        return ("audio/mp4", "m4a")
    if base_mime in ("audio/mp3", "audio/mpeg"):
        return ("audio/mp3", "mp3")

    # 3. Fall back to filename extension.
    if ext_hint == "wav":
        return ("audio/wav", "wav")
    if ext_hint == "webm":
        return ("audio/webm", "webm")
    if ext_hint == "ogg":
        return ("audio/ogg", "ogg")
    if ext_hint in ("m4a", "mp4", "aac"):
        return ("audio/mp4", "m4a")
    if ext_hint == "mp3":
        return ("audio/mp3", "mp3")
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


def _decode_to_mono_pcm16(raw_bytes: bytes) -> Tuple[array.array | None, int]:
    """Decode WAV or compressed audio bytes to mono signed 16-bit PCM samples."""
    if not raw_bytes:
        return array.array("h"), 16000

    # 1. Zero-subprocess WAV fast path
    if len(raw_bytes) >= 44 and raw_bytes[:4] == b"RIFF" and raw_bytes[8:12] == b"WAVE":
        try:
            with wave.open(io.BytesIO(raw_bytes), "rb") as wf:
                if wf.getsampwidth() == 2:
                    n_ch = max(1, wf.getnchannels())
                    sr = max(8000, wf.getframerate())
                    frames = wf.readframes(wf.getnframes())
                    if not frames:
                        return array.array("h"), sr
                    usable = len(frames) - (len(frames) % (2 * n_ch))
                    pcm = array.array("h")
                    pcm.frombytes(frames[:usable])
                    if sys.byteorder != "little":
                        pcm.byteswap()
                    if n_ch > 1:
                        mono = array.array("h")
                        for i in range(0, len(pcm), n_ch):
                            mono.append(sum(pcm[i : i + n_ch]) // n_ch)
                        return mono, sr
                    return pcm, sr
        except Exception:
            pass

    # 2. Compressed browser containers (.m4a, .webm, .ogg, .mp3) via ffmpeg if available
    if shutil.which("ffmpeg"):
        try:
            proc = subprocess.run(
                [
                    "ffmpeg",
                    "-hide_banner",
                    "-loglevel",
                    "error",
                    "-i",
                    "pipe:0",
                    "-ac",
                    "1",
                    "-ar",
                    "16000",
                    "-f",
                    "s16le",
                    "pipe:1",
                ],
                input=raw_bytes,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                timeout=6,
            )
            if proc.returncode == 0 and len(proc.stdout) >= 2:
                usable = len(proc.stdout) - (len(proc.stdout) % 2)
                pcm = array.array("h")
                pcm.frombytes(proc.stdout[:usable])
                if sys.byteorder != "little":
                    pcm.byteswap()
                return pcm, 16000
        except Exception:
            pass

    return None, 0


def analyze_audio_speech_activity(
    raw_bytes: bytes,
    filename: str = "",
    content_type: str = "",
) -> Dict[str, Any]:
    """Deterministically detect silent, near-silent, or ultra-short recordings before LLM grading."""
    samples, sample_rate = _decode_to_mono_pcm16(raw_bytes)
    if samples is None:
        return {
            "analyzed": False,
            "has_speech": True,
            "reason": "decode_skipped",
            "durationSec": 0.0,
            "peakDb": -120.0,
            "rmsDb": -120.0,
            "activeSpeechMs": 0,
        }
    if len(samples) == 0:
        return {
            "analyzed": True,
            "has_speech": False,
            "reason": "empty",
            "durationSec": 0.0,
            "peakDb": -120.0,
            "rmsDb": -120.0,
            "activeSpeechMs": 0,
        }

    duration_sec = len(samples) / float(sample_rate)
    peak = max(abs(s) for s in samples) / 32768.0
    rms = math.sqrt(sum(s * s for s in samples) / len(samples)) / 32768.0

    frame_len = max(1, int(sample_rate * 0.02))
    frame_stats = []
    for i in range(0, len(samples), frame_len):
        chunk = samples[i : i + frame_len]
        if not chunk:
            continue
        f_rms = math.sqrt(sum(s * s for s in chunk) / len(chunk)) / 32768.0
        f_peak = max(abs(s) for s in chunk) / 32768.0
        frame_stats.append((f_rms, f_peak))

    sorted_rms = sorted(r for r, _ in frame_stats)
    p20_rms = sorted_rms[len(sorted_rms) // 5] if len(sorted_rms) >= 5 else 0.0
    rms_thresh = max(0.008, min(0.035, p20_rms * 2.2))
    active_frames = sum(1 for r, p in frame_stats if r >= rms_thresh and p >= 0.020)
    active_speech_ms = int(round(active_frames * (frame_len / sample_rate) * 1000))

    if duration_sec < 0.25:
        has_speech = False
        reason = "too_short"
    elif peak < 0.018 or rms < 0.004:
        has_speech = False
        reason = "silence"
    elif active_speech_ms < 120:
        has_speech = False
        reason = "no_speech"
    else:
        has_speech = True
        reason = "ok"

    peak_db = round(20.0 * math.log10(max(peak, 1e-6)), 1)
    rms_db = round(20.0 * math.log10(max(rms, 1e-6)), 1)
    return {
        "analyzed": True,
        "has_speech": has_speech,
        "reason": reason,
        "durationSec": round(duration_sec, 2),
        "peakDb": peak_db,
        "rmsDb": rms_db,
        "activeSpeechMs": active_speech_ms,
    }
