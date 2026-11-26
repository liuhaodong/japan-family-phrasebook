"""Gemini Bilingual/Japanese TTS with SHA-256 disk caching & SSE PCM streaming."""

from __future__ import annotations

import array
import asyncio
import base64
import hashlib
import json
import re
import struct
import sys
from pathlib import Path
from typing import Any, AsyncIterator, Dict, List, Optional

import httpx

from server.config import (
    DEFAULT_VOICE,
    GEMINI_API_BASE,
    TTS_CACHE_DIR,
    TTS_FAST_MODEL,
    TTS_STORY_MODEL,
)
from server.services.audio_utils import pcm_to_wav_bytes
from server.services.jp_tokenizer import has_kana, has_kanji, jp_to_kana

_MD_CHARS_RE = re.compile(r"[`*_~#>|\[\]]+")
_EMOJI_RE = re.compile(
    "[\U0001F300-\U0001FAFF\u2600-\u27BF]+",
    flags=re.UNICODE,
)
_RATE_RE = re.compile(r"rate=(\d+)")
_ZH_ONLY_RE = re.compile(
    r"[的了这那你我请跟再听读说试音调词句助语气拍重练过关棒清晰稳错对平高低拉长停顿步记忆整体节奏还差遍刚才很不错加油继续保持非常变形自然杂音预约问题]"
)
_SENTENCE_SPLIT_RE = re.compile(r"[^。！？!?\n]+[。！？!?\n]*")
_TRAILING_CLAUSE_COLON_RE = re.compile(r"^(.*[：:])\s*([^：:]+)$")
_TRAILING_CLAUSE_COMMA_RE = re.compile(r"^(.*[，,])\s*([^，,]+)$")
_DEMO_COLON_LEAD_RE = re.compile(r"(?:跟我读|跟我念|跟我练|单独读|听我读|听示范|正确示范|跟我说|这样读)")


def clean_tts_transcript(text: str, lang: Optional[str] = None) -> str:
    """Strip markdown, arrows, and emojis so Gemini TTS reads clean speech only."""
    cleaned = text or ""
    cleaned = _EMOJI_RE.sub(" ", cleaned)
    cleaned = _MD_CHARS_RE.sub("", cleaned)
    cleaned = cleaned.replace("➔", "、").replace("→", "、").replace("・", " ")
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    if lang == "ja" and has_kanji(cleaned):
        cleaned = jp_to_kana(cleaned)
    return cleaned


def _is_pure_japanese_clause(seg: str) -> bool:
    s = (seg or "").strip()
    return bool(s and has_kana(s) and not _ZH_ONLY_RE.search(s))


def split_bilingual_tts_segments(clean_text: str, lang: Optional[str] = None) -> List[tuple[str, str]]:
    """Split mixed CN/JP text into pure single-language TTS segments to stop cross-language bleed."""
    text = (clean_text or "").strip()
    if not text:
        return []
    if lang == "ja":
        return [("ja", jp_to_kana(text))]
    if lang == "zh":
        return [("zh", text)]

    raw_parts: List[tuple[str, str]] = []
    sentences = [s.strip() for s in _SENTENCE_SPLIT_RE.findall(text) if s.strip()]
    if not sentences:
        sentences = [text]

    for sent in sentences:
        if _is_pure_japanese_clause(sent):
            raw_parts.append(("ja", jp_to_kana(sent)))
            continue

        if has_kana(sent) or _DEMO_COLON_LEAD_RE.search(sent):
            m_colon = _TRAILING_CLAUSE_COLON_RE.match(sent)
            if m_colon:
                left = m_colon.group(1).rstrip("：:，, ").strip()
                right = m_colon.group(2).strip()
                is_jp_right = _is_pure_japanese_clause(right) or (
                    _DEMO_COLON_LEAD_RE.search(left) and not _ZH_ONLY_RE.search(right) and has_kanji(right)
                )
                if is_jp_right:
                    if left:
                        raw_parts.append(("zh", f"{left}。"))
                    raw_parts.append(("ja", jp_to_kana(right)))
                    continue

            if has_kana(sent):
                m_comma = _TRAILING_CLAUSE_COMMA_RE.match(sent)
                if m_comma and _is_pure_japanese_clause(m_comma.group(2)) and _ZH_ONLY_RE.search(m_comma.group(1)):
                    left = m_comma.group(1).rstrip("，,：: ").strip()
                    right = m_comma.group(2).strip()
                    if left:
                        raw_parts.append(("zh", f"{left}。"))
                    raw_parts.append(("ja", jp_to_kana(right)))
                    continue

        raw_parts.append(("zh", sent))

    merged: List[tuple[str, str]] = []
    for seg_lang, seg_txt in raw_parts:
        seg_clean = seg_txt.strip()
        if not seg_clean:
            continue
        if merged and merged[-1][0] == seg_lang:
            prev_txt = merged[-1][1]
            sep = " " if seg_lang == "ja" else ""
            merged[-1] = (seg_lang, f"{prev_txt}{sep}{seg_clean}".strip())
        else:
            merged.append((seg_lang, seg_clean))

    return merged or [("zh", text)]


def build_tts_payload(clean_text: str, voice: str = DEFAULT_VOICE) -> Dict[str, Any]:
    """Build Gemini TTS generateContent payload without systemInstruction (unsupported by TTS models)."""
    return {
        "contents": [{"role": "user", "parts": [{"text": clean_text}]}],
        "generationConfig": {
            "responseModalities": ["AUDIO"],
            "speechConfig": {
                "voiceConfig": {
                    "prebuiltVoiceConfig": {"voiceName": voice or DEFAULT_VOICE}
                }
            },
        },
    }


def _extract_pcm_and_rate(data: Dict[str, Any]) -> tuple[bytes, int]:
    candidates = data.get("candidates") or []
    for cand in candidates:
        parts = (cand.get("content") or {}).get("parts") or []
        for part in parts:
            inline = part.get("inlineData") or part.get("inline_data")
            if inline and inline.get("data"):
                raw = base64.b64decode(inline["data"])
                mime = inline.get("mimeType") or inline.get("mime_type") or ""
                m = _RATE_RE.search(mime)
                rate = int(m.group(1)) if m else 24000
                return _strip_wav_header(raw), rate
    raise RuntimeError("TTS 响应未包含音频数据。")


def _extract_audio_bytes(data: Dict[str, Any]) -> bytes:
    pcm, rate = _extract_pcm_and_rate(data)
    return pcm_to_wav_bytes(pcm, sample_rate=rate, channels=1, sampwidth=2)


_ORIG_ASYNC_CLIENT = httpx.AsyncClient
_SHARED_CLIENT: Optional[httpx.AsyncClient] = None


def _get_http_client() -> tuple[httpx.AsyncClient, bool]:
    """Reuse keep-alive connections unless httpx.AsyncClient is monkeypatched in tests."""
    global _SHARED_CLIENT
    if httpx.AsyncClient is not _ORIG_ASYNC_CLIENT:
        return httpx.AsyncClient(timeout=18.0), True
    if _SHARED_CLIENT is None or _SHARED_CLIENT.is_closed:
        _SHARED_CLIENT = httpx.AsyncClient(
            timeout=httpx.Timeout(18.0, connect=4.0),
            limits=httpx.Limits(max_keepalive_connections=8, max_connections=20, keepalive_expiry=10.0),
        )
    return _SHARED_CLIENT, False


async def _post_single_segment_pcm(
    client: httpx.AsyncClient,
    seg_text: str,
    voice: str,
    models_to_try: List[str],
    api_key: str,
) -> tuple[bytes, int, str]:
    payload = build_tts_payload(seg_text, voice=voice)
    last_error: Optional[str] = None
    for mdl in models_to_try:
        url = f"{GEMINI_API_BASE}/models/{mdl}:generateContent"
        try:
            resp = await client.post(
                url,
                headers={"x-goog-api-key": api_key, "Content-Type": "application/json"},
                json=payload,
            )
            if resp.status_code >= 400:
                last_error = f"{mdl} HTTP {resp.status_code}: {resp.text[:220]}"
                continue
            pcm, rate = _extract_pcm_and_rate(resp.json())
            return _polish_pcm_segment(pcm, rate), rate, mdl
        except Exception as exc:
            last_error = f"{mdl}: {exc}"
    raise RuntimeError(f"语音合成失败：{last_error or 'unknown error'}")


async def synthesize_speech(
    text: str,
    api_key: str,
    voice: str = DEFAULT_VOICE,
    model: Optional[str] = None,
    cache_dir: Path = TTS_CACHE_DIR,
    lang: Optional[str] = None,
) -> Dict[str, Any]:
    """Synthesize Mandarin/Japanese speech cleanly per language segment and cache as RIFF WAV."""
    clean_text = clean_tts_transcript(text, lang=lang)
    if not clean_text:
        raise ValueError("TTS 文本为空。")

    chosen_voice = (voice or DEFAULT_VOICE).strip()
    primary_model = (model or TTS_FAST_MODEL).strip()
    models_to_try = [primary_model]
    if TTS_STORY_MODEL not in models_to_try:
        models_to_try.append(TTS_STORY_MODEL)

    cache_key = hashlib.sha256(f"v2|{primary_model}|{chosen_voice}|{clean_text}".encode("utf-8")).hexdigest()[:32]
    cache_dir.mkdir(parents=True, exist_ok=True)
    wav_path = cache_dir / f"{cache_key}.wav"

    if wav_path.exists() and wav_path.stat().st_size > 44:
        return {
            "audio_url": f"/api/tts/cache/{wav_path.name}",
            "file_path": str(wav_path),
            "cache_hit": True,
            "model_used": primary_model,
            "bytes": wav_path.stat().st_size,
            "clean_text": clean_text,
        }

    inflight = _INFLIGHT_STREAMS.get(cache_key)
    if inflight is not None and inflight.task is not None:
        try:
            await inflight.task
        except Exception:
            pass
        if wav_path.exists() and wav_path.stat().st_size > 44:
            return {
                "audio_url": f"/api/tts/cache/{wav_path.name}",
                "file_path": str(wav_path),
                "cache_hit": True,
                "model_used": primary_model,
                "bytes": wav_path.stat().st_size,
                "clean_text": clean_text,
            }

    segments = split_bilingual_tts_segments(clean_text, lang=lang)
    client, should_close = _get_http_client()
    try:
        if should_close:
            await client.__aenter__()
        if len(segments) == 1:
            pcm, rate, mdl = await _post_single_segment_pcm(client, segments[0][1], chosen_voice, models_to_try, api_key)
        else:
            results = await asyncio.gather(
                *[
                    _post_single_segment_pcm(client, seg_txt, chosen_voice, models_to_try, api_key)
                    for _, seg_txt in segments
                ]
            )
            rate = results[0][1]
            mdl = results[0][2]
            gap = b"\x00\x00" * int(rate * 0.16)
            joined: List[bytes] = []
            for idx, (seg_pcm, _, _) in enumerate(results):
                if idx > 0 and gap:
                    joined.append(gap)
                joined.append(seg_pcm)
            pcm = b"".join(joined)

        wav_bytes = pcm_to_wav_bytes(pcm, sample_rate=rate, channels=1, sampwidth=2)
        tmp_path = wav_path.with_suffix(f".{id(segments)}.tmp")
        tmp_path.write_bytes(wav_bytes)
        tmp_path.replace(wav_path)
        return {
            "audio_url": f"/api/tts/cache/{wav_path.name}",
            "file_path": str(wav_path),
            "cache_hit": False,
            "model_used": mdl,
            "bytes": len(wav_bytes),
            "clean_text": clean_text,
        }
    finally:
        if should_close:
            await client.__aexit__(None, None, None)


def get_tts_cache_meta(
    text: str,
    voice: str = DEFAULT_VOICE,
    model: Optional[str] = None,
    cache_dir: Path = TTS_CACHE_DIR,
    lang: Optional[str] = None,
) -> Dict[str, Any]:
    """Resolve normalized transcript, SHA-256 cache key, WAV path, and model fallback list."""
    clean_text = clean_tts_transcript(text, lang=lang)
    if not clean_text:
        raise ValueError("TTS 文本为空。")

    chosen_voice = (voice or DEFAULT_VOICE).strip()
    primary_model = (model or TTS_FAST_MODEL).strip()
    models_to_try = [primary_model]
    if TTS_STORY_MODEL not in models_to_try:
        models_to_try.append(TTS_STORY_MODEL)

    cache_key = hashlib.sha256(f"v2|{primary_model}|{chosen_voice}|{clean_text}".encode("utf-8")).hexdigest()[:32]
    wav_path = cache_dir / f"{cache_key}.wav"
    return {
        "clean_text": clean_text,
        "voice": chosen_voice,
        "primary_model": primary_model,
        "models_to_try": models_to_try,
        "cache_key": cache_key,
        "wav_path": wav_path,
        "audio_url": f"/api/tts/cache/{wav_path.name}",
    }


def _strip_wav_header(raw: bytes) -> bytes:
    """Extract pure 16-bit PCM bytes from a RIFF/WAVE container, excluding trailing chunks like C2PA."""
    if not raw:
        return raw
    if len(raw) >= 12 and raw[:4] == b"RIFF" and raw[8:12] == b"WAVE":
        pos = 12
        total = len(raw)
        while pos + 8 <= total:
            chunk_id = raw[pos : pos + 4]
            chunk_size = struct.unpack_from("<I", raw, pos + 4)[0]
            data_start = pos + 8
            data_end = min(total, data_start + chunk_size)
            if chunk_id == b"data":
                pcm = raw[data_start:data_end]
                return pcm[: len(pcm) - (len(pcm) % 2)]
            pos = data_start + chunk_size + (chunk_size & 1)
        idx = raw.find(b"data")
        if idx != -1 and idx + 8 <= total:
            chunk_size = struct.unpack_from("<I", raw, idx + 4)[0]
            data_start = idx + 8
            data_end = min(total, data_start + chunk_size) if chunk_size > 0 else total
            pcm = raw[data_start:data_end]
            return pcm[: len(pcm) - (len(pcm) % 2)]
        pcm = raw[44:]
        return pcm[: len(pcm) - (len(pcm) % 2)]
    c2pa_idx = raw.find(b"C2PA")
    if c2pa_idx != -1 and raw.find(b"jumb", c2pa_idx, min(len(raw), c2pa_idx + 64)) != -1:
        raw = raw[:c2pa_idx]
    return raw


def _polish_pcm_segment(pcm: bytes, sample_rate: int = 24000) -> bytes:
    """Soft-limit peaks to prevent iOS speaker clipping and apply 4ms boundary fades."""
    usable = len(pcm) - (len(pcm) % 2)
    if usable < 960:
        return pcm[:usable]
    samples = array.array("h")
    samples.frombytes(pcm[:usable])
    if sys.byteorder != "little":
        samples.byteswap()
    n = len(samples)
    peak = max((abs(s) for s in samples), default=0)
    if peak > 29500:
        scale = 29500.0 / peak
        for i in range(n):
            samples[i] = int(samples[i] * scale)
    fade_n = min(int(sample_rate * 0.004), n // 8)
    if fade_n > 1:
        for i in range(fade_n):
            gain = i / fade_n
            samples[i] = int(samples[i] * gain)
            j = n - 1 - i
            samples[j] = int(samples[j] * gain)
    if sys.byteorder != "little":
        samples.byteswap()
    return samples.tobytes()


async def _stream_single_segment_pcm(
    client: httpx.AsyncClient,
    seg_text: str,
    voice: str,
    models_to_try: List[str],
    api_key: str,
    on_chunk: Optional[Any] = None,
) -> tuple[bytes, int]:
    """Stream one clean single-language segment via Gemini TTS SSE and return (pcm_bytes, sample_rate)."""
    payload = build_tts_payload(seg_text, voice=voice)
    last_error: Optional[str] = None
    for mdl in models_to_try:
        url = f"{GEMINI_API_BASE}/models/{mdl}:streamGenerateContent?alt=sse"
        leftover = b""
        all_pcm: List[bytes] = []
        yielded_any = False
        sample_rate = 24000
        try:
            async with client.stream(
                "POST",
                url,
                headers={"x-goog-api-key": api_key, "Content-Type": "application/json"},
                json=payload,
                timeout=httpx.Timeout(18.0, connect=4.0),
            ) as resp:
                if resp.status_code >= 400:
                    err_body = (await resp.aread()).decode("utf-8", "ignore")[:220]
                    last_error = f"{mdl} HTTP {resp.status_code}: {err_body}"
                    continue
                async for line in resp.aiter_lines():
                    if not line.startswith("data: "):
                        continue
                    data_str = line[6:].strip()
                    if not data_str or data_str == "[DONE]":
                        continue
                    obj = json.loads(data_str)
                    for cand in obj.get("candidates") or []:
                        for part in (cand.get("content") or {}).get("parts") or []:
                            inline = part.get("inlineData") or part.get("inline_data")
                            if not inline or not inline.get("data"):
                                continue
                            mime = inline.get("mimeType") or inline.get("mime_type") or ""
                            m = _RATE_RE.search(mime)
                            if m:
                                sample_rate = int(m.group(1))
                            raw = _strip_wav_header(base64.b64decode(inline["data"]))
                            data = leftover + raw
                            if len(data) % 2 == 1:
                                leftover = data[-1:]
                                data = data[:-1]
                            else:
                                leftover = b""
                            if data:
                                all_pcm.append(data)
                                yielded_any = True
                                if on_chunk is not None:
                                    await on_chunk(data)
            if all_pcm:
                return b"".join(all_pcm), sample_rate
            last_error = f"{mdl}: stream returned no audio chunks"
        except Exception as exc:
            last_error = f"{mdl}: {exc}"
            if yielded_any:
                if all_pcm:
                    return b"".join(all_pcm), sample_rate
                break
    raise RuntimeError(last_error or "stream returned no audio chunks")


class _InflightTtsStream:
    """Coalesces a background SSE PCM stream from Gemini TTS across prewarm & client consumers."""

    def __init__(
        self,
        *,
        cache_key: str,
        clean_text: str,
        voice: str,
        models_to_try: List[str],
        wav_path: Path,
        api_key: str,
        lang: Optional[str] = None,
    ) -> None:
        self.cache_key = cache_key
        self.clean_text = clean_text
        self.voice = voice
        self.models_to_try = models_to_try
        self.wav_path = wav_path
        self.api_key = api_key
        self.lang = lang
        self.chunks: List[bytes] = []
        self.done = False
        self.error: Optional[str] = None
        self.sample_rate = 24000
        self.cond = asyncio.Condition()
        self.task: Optional[asyncio.Task] = None

    async def _push_chunk(self, chunk: bytes) -> None:
        async with self.cond:
            self.chunks.append(chunk)
            self.cond.notify_all()

    async def run(self) -> None:
        segments = split_bilingual_tts_segments(self.clean_text, lang=self.lang)
        last_error: Optional[str] = None
        all_pcm: List[bytes] = []
        client, should_close = _get_http_client()
        try:
            if should_close:
                await client.__aenter__()

            async def _push0(ch: bytes) -> None:
                all_pcm.append(ch)
                await self._push_chunk(ch)

            if len(segments) == 1:
                _, rate = await _stream_single_segment_pcm(
                    client, segments[0][1], self.voice, self.models_to_try, self.api_key, on_chunk=_push0
                )
                self.sample_rate = rate
            else:
                # Synthesize tail segments in parallel while segment 0 streams live (~470ms TTFB)
                tail_tasks = [
                    asyncio.create_task(
                        _stream_single_segment_pcm(client, seg_txt, self.voice, self.models_to_try, self.api_key)
                    )
                    for _, seg_txt in segments[1:]
                ]
                try:
                    _, rate0 = await _stream_single_segment_pcm(
                        client, segments[0][1], self.voice, self.models_to_try, self.api_key, on_chunk=_push0
                    )
                    self.sample_rate = rate0
                    gap = b"\x00\x00" * int(rate0 * 0.16)
                    for t in tail_tasks:
                        seg_pcm, seg_rate = await t
                        if seg_pcm:
                            seg_pcm = _polish_pcm_segment(seg_pcm, seg_rate or rate0)
                            if gap:
                                all_pcm.append(gap)
                                await self._push_chunk(gap)
                            all_pcm.append(seg_pcm)
                            await self._push_chunk(seg_pcm)
                except Exception:
                    for t in tail_tasks:
                        if not t.done():
                            t.cancel()
                    raise

            if all_pcm:
                wav_bytes = pcm_to_wav_bytes(b"".join(all_pcm), sample_rate=self.sample_rate, channels=1, sampwidth=2)
                self.wav_path.parent.mkdir(parents=True, exist_ok=True)
                tmp_path = self.wav_path.with_suffix(f".{id(self)}.tmp")
                tmp_path.write_bytes(wav_bytes)
                tmp_path.replace(self.wav_path)
        except Exception as exc:
            last_error = str(exc)
        finally:
            if should_close:
                await client.__aexit__(None, None, None)
            async with self.cond:
                if not self.chunks and not self.error:
                    self.error = f"流式语音合成失败：{last_error or 'unknown error'}"
                self.done = True
                self.cond.notify_all()
            if _INFLIGHT_STREAMS.get(self.cache_key) is self:
                _INFLIGHT_STREAMS.pop(self.cache_key, None)


_INFLIGHT_STREAMS: Dict[str, _InflightTtsStream] = {}


def prewarm_tts_stream(
    text: str,
    api_key: str,
    voice: str = DEFAULT_VOICE,
    model: Optional[str] = None,
    cache_dir: Path = TTS_CACHE_DIR,
    lang: Optional[str] = None,
) -> Optional[str]:
    """Start SSE PCM synthesis in the background so /api/tts/stream hits warm buffers or WAV cache."""
    if not api_key or not text:
        return None
    try:
        meta = get_tts_cache_meta(text=text, voice=voice, model=model, cache_dir=cache_dir, lang=lang)
    except ValueError:
        return None

    wav_path: Path = meta["wav_path"]
    if wav_path.exists() and wav_path.stat().st_size > 44:
        return meta["audio_url"]

    cache_key: str = meta["cache_key"]
    existing = _INFLIGHT_STREAMS.get(cache_key)
    if existing is None or (existing.done and existing.error and not existing.chunks):
        inflight = _InflightTtsStream(
            cache_key=cache_key,
            clean_text=meta["clean_text"],
            voice=meta["voice"],
            models_to_try=meta["models_to_try"],
            wav_path=wav_path,
            api_key=api_key,
            lang=lang,
        )
        _INFLIGHT_STREAMS[cache_key] = inflight
        inflight.task = asyncio.create_task(inflight.run())
    return meta["audio_url"]


async def stream_speech_pcm(
    text: str,
    api_key: str,
    voice: str = DEFAULT_VOICE,
    model: Optional[str] = None,
    cache_dir: Path = TTS_CACHE_DIR,
    lang: Optional[str] = None,
) -> AsyncIterator[bytes]:
    """Yield 24kHz 16-bit mono PCM chunks from disk cache, an in-flight prewarm, or live SSE stream."""
    meta = get_tts_cache_meta(text=text, voice=voice, model=model, cache_dir=cache_dir, lang=lang)
    wav_path: Path = meta["wav_path"]
    if wav_path.exists() and wav_path.stat().st_size > 44:
        pcm = _strip_wav_header(wav_path.read_bytes())
        step = 32768
        for off in range(0, len(pcm), step):
            chunk = pcm[off : off + step]
            if len(chunk) % 2 == 1:
                chunk = chunk[:-1]
            if chunk:
                yield chunk
        return

    cache_key: str = meta["cache_key"]
    inflight = _INFLIGHT_STREAMS.get(cache_key)
    if inflight is None or (inflight.done and inflight.error and not inflight.chunks):
        inflight = _InflightTtsStream(
            cache_key=cache_key,
            clean_text=meta["clean_text"],
            voice=meta["voice"],
            models_to_try=meta["models_to_try"],
            wav_path=wav_path,
            api_key=api_key,
            lang=lang,
        )
        _INFLIGHT_STREAMS[cache_key] = inflight
        inflight.task = asyncio.create_task(inflight.run())

    idx = 0
    while True:
        async with inflight.cond:
            while idx >= len(inflight.chunks) and not inflight.done:
                await inflight.cond.wait()
            batch = inflight.chunks[idx:]
            idx += len(batch)
            is_done = inflight.done
            err = inflight.error
        for ch in batch:
            yield ch
        if is_done:
            if idx == 0 and err:
                raise RuntimeError(err)
            break
