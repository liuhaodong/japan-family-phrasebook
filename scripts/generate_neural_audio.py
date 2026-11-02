import asyncio
import hashlib
import json
import re
from pathlib import Path
import edge_tts

PROJECT_DIR = Path("/Users/haodongl/Documents/projects/japan-family-phrasebook")
DATA_DIR = PROJECT_DIR / "data"
AUDIO_DIR = PROJECT_DIR / "audio"
AUDIO_DIR.mkdir(parents=True, exist_ok=True)


def parse_js_modules(filepath: Path):
    text = filepath.read_text(encoding="utf-8")
    idx = text.find("[")
    r_idx = text.rfind("]")
    body = text[idx:r_idx + 1]
    lines = []
    for line in body.splitlines():
        stripped = line.lstrip()
        if stripped.startswith("//"):
            continue
        line = re.sub(r'(?<=[,"\]\}])\s*//.*$', '', line)
        lines.append(line)
    cleaned = "\n".join(lines)
    cleaned = re.sub(r'(?m)^(\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*:', r'\1"\2":', cleaned)
    cleaned = re.sub(r'([\{,])\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*:', r'\1 "\2":', cleaned)
    cleaned = re.sub(r',(\s*[\}\]])', r'\1', cleaned)
    return json.loads(cleaned)


def clean_spoken_japanese(raw: str) -> str:
    """
    Convert display Japanese (with furigana, bracketed options, or Chinese labels)
    into 100% pure, natural spoken Japanese for Neural TTS.
    """
    s = raw
    # 1. Special handling for Module 14 appliance dictionary item
    if "【洗衣机】" in s:
        return "洗濯、洗濯乾燥、洗剤自動投入。ふろ自動、追いだき。暖房、加湿。"

    # 2. Remove Chinese tags in 【...】 such as 【店员说】 or 【1秒回答】
    s = re.sub(r"【[^】]*】", "", s)

    # 3. Replace arrow → with a natural pause
    s = s.replace("→", "。　")

    # 4. Remove full-width square bracket options/notes ［...］
    s = re.sub(r"［[^］]*］", "", s)

    # 5. Remove parenthetical notes starting with ※ or containing Chinese
    s = re.sub(r"（※[^）]*）", "", s)
    s = re.sub(r"\(※[^\)]*\)", "", s)

    # 6. Remove furigana in （...） (Hiragana, Katakana, numbers, romaji)
    s = re.sub(r"（[\u3040-\u309F\u30A0-\u30FFー・〜0-9０-９a-zA-Z\s/／]+）", "", s)
    s = re.sub(r"\([\u3040-\u309F\u30A0-\u30FFー・〜0-9０-９a-zA-Z\s/／]+\)", "", s)

    # 7. Replace slash separator ／ with a gentle pause so alternatives read smoothly
    s = re.sub(r"\s*／\s*", "。　", s)

    # 8. Replace 〇〇 placeholder with まるまる
    s = s.replace("〇〇", "まるまる")

    # 9. Clean up multiple spaces or duplicate periods
    s = re.sub(r"。+", "。", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def choose_voice_and_pitch(speaker: str = "us", speaker_name: str = "", item_id: str = ""):
    """
    Pick natural Japanese neural voice (NanamiNeural female vs KeitaNeural male)
    and pitch based on character role.
    """
    name = speaker_name or ""
    if "Jinny" in name or "ジニー" in name or item_id.startswith("m17-s1"):
        # Cute child-like higher pitch using NanamiNeural
        return ("ja-JP-NanamiNeural", "+18Hz", "+0%")
    if any(k in name for k in ["Sherry", "日本妈妈", "保育园老师", "仲居", "女将", "专柜", "甜品", "收银", "客房"]):
        return ("ja-JP-NanamiNeural", "+0Hz", "+0%")
    if any(k in name for k in ["浩东", "大将", "司机", "爸爸", "主厨", "先生", "售票", "租赁", "药剂师"]):
        return ("ja-JP-KeitaNeural", "+0Hz", "+0%")
    # For standalone sentences: alternate or pick based on speaker context
    if item_id.startswith(("m1-s1", "m1-s2", "m3-", "m4-s2", "m5-s1", "m7-s1", "m7-s2", "m8-s3", "m11-")):
        return ("ja-JP-KeitaNeural", "+0Hz", "+0%")
    return ("ja-JP-NanamiNeural", "+0Hz", "+0%")


async def main():
    mods = []
    for fname in ["modules_1_to_6.js", "modules_7_to_12.js", "modules_13_to_18.js"]:
        mods.extend(parse_js_modules(DATA_DIR / fname))

    tasks_info = []  # (key, spoken_text, voice, pitch, rate, filename)

    for m in mods:
        for sec in m.get("sections", []):
            for item in sec.get("items", []):
                iid = item["id"]
                spoken = clean_spoken_japanese(item["jp"])
                voice, pitch, rate = choose_voice_and_pitch(item_id=iid)
                tasks_info.append((iid, spoken, voice, pitch, rate, f"{iid}.mp3"))

                for r_idx, rep in enumerate(item.get("replies", [])):
                    rid = f"{iid}-rep-{r_idx}"
                    r_spoken = clean_spoken_japanese(rep["jp"])
                    # Counterparty replies use opposite voice for contrast
                    r_voice = "ja-JP-NanamiNeural" if voice == "ja-JP-KeitaNeural" else "ja-JP-KeitaNeural"
                    tasks_info.append((rid, r_spoken, r_voice, "+0Hz", "+0%", f"{rid}.mp3"))

        for dlg in m.get("dialogues", []):
            did = dlg["id"]
            for t_idx, turn in enumerate(dlg.get("turns", [])):
                tid = f"{did}-turn-{t_idx}"
                t_spoken = clean_spoken_japanese(turn["jp"])
                voice, pitch, rate = choose_voice_and_pitch(
                    speaker=turn.get("speaker", "us"),
                    speaker_name=turn.get("speakerName", ""),
                    item_id=tid
                )
                tasks_info.append((tid, t_spoken, voice, pitch, rate, f"{tid}.mp3"))

    # Also add the 7 hotel taxi driver audio clips!
    itin_text = (DATA_DIR / "itinerary.js").read_text(encoding="utf-8")
    taxi_matches = re.findall(r'taxiDriverText:\s*"([^"]+)"', itin_text)
    for idx, t_text in enumerate(taxi_matches):
        tid = f"taxi-{idx}"
        tasks_info.append((tid, clean_spoken_japanese(t_text), "ja-JP-KeitaNeural", "+0Hz", "+0%", f"{tid}.mp3"))

    print(f"Total neural audio clips to generate: {len(tasks_info)}")

    sem = asyncio.Semaphore(10)
    manifest = {}

    async def gen_one(key, text, voice, pitch, rate, fname):
        out_file = AUDIO_DIR / fname
        manifest[key] = {
            "file": f"audio/{fname}",
            "spoken": text,
            "voice": "👨 男声 (Keita)" if "Keita" in voice else ("👧 童声 (Jinny)" if pitch != "+0Hz" else "👩 女声 (Nanami)")
        }
        if out_file.exists() and out_file.stat().st_size > 500:
            return
        async with sem:
            for attempt in range(3):
                try:
                    comm = edge_tts.Communicate(text=text, voice=voice, pitch=pitch, rate=rate)
                    await comm.save(str(out_file))
                    break
                except Exception as e:
                    if attempt == 2:
                        print(f"Failed {key}: {e}")
                    await asyncio.sleep(0.6)

    await asyncio.gather(*(gen_one(*info) for info in tasks_info))

    manifest_js = "// Auto-generated Neural Audio Manifest (ja-JP-NanamiNeural & ja-JP-KeitaNeural)\nwindow.AUDIO_MANIFEST = " + json.dumps(manifest, ensure_ascii=False, indent=2) + ";\n"
    (DATA_DIR / "audio_manifest.js").write_text(manifest_js, encoding="utf-8")
    print(f"Successfully generated {len(manifest)} neural audio files and data/audio_manifest.js!")


if __name__ == "__main__":
    asyncio.run(main())
