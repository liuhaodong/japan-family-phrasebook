import asyncio
import hashlib
import json
import re
import subprocess
from pathlib import Path
import edge_tts

PROJECT_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = PROJECT_DIR / "data"
AUDIO_DIR = PROJECT_DIR / "audio"
LEARN_AUDIO_DIR = AUDIO_DIR / "learn"
AUDIO_DIR.mkdir(parents=True, exist_ok=True)
LEARN_AUDIO_DIR.mkdir(parents=True, exist_ok=True)


def parse_js_data(filepath: Path):
    """Parse JS window.VAR = ... data files reliably using Node, JavaScriptCore, or JSON/regex fallback."""
    try:
        script = (
            "global.window = {};"
            f"require({json.dumps(str(filepath))});"
            "const keys = Object.keys(global.window);"
            "process.stdout.write(JSON.stringify(global.window[keys[0]]));"
        )
        res = subprocess.run(
            ["node", "-e", script],
            capture_output=True,
            text=True,
            encoding="utf-8",
            check=True,
        )
        return json.loads(res.stdout)
    except Exception:
        pass

    jsc_bin = "/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc"
    if Path(jsc_bin).exists():
        try:
            script = (
                "var window = {};"
                f"load({json.dumps(str(filepath))});"
                "var keys = Object.keys(window);"
                "print(JSON.stringify(window[keys[0]]));"
            )
            res = subprocess.run(
                [jsc_bin, "-e", script],
                capture_output=True,
                text=True,
                encoding="utf-8",
                check=True,
            )
            return json.loads(res.stdout)
        except Exception:
            pass

    text = filepath.read_text(encoding="utf-8")
    idx = min(x for x in (text.find("["), text.find("{")) if x != -1)
    r_idx = max(text.rfind("]"), text.rfind("}"))
    body = text[idx : r_idx + 1]
    try:
        return json.loads(body)
    except Exception:
        pass
    lines = []
    for line in body.splitlines():
        stripped = line.lstrip()
        if stripped.startswith("//"):
            continue
        line = re.sub(r'(?<=[,"\]\}])\s*//.*$', "", line)
        lines.append(line)
    cleaned = "\n".join(lines)
    cleaned = re.sub(r'(?m)^(\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*:', r'\1"\2":', cleaned)
    cleaned = re.sub(r'([\{,])\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*:', r'\1 "\2":', cleaned)
    cleaned = re.sub(r',(\s*[\}\]])', r"\1", cleaned)
    return json.loads(cleaned)


def clean_spoken_japanese(raw: str) -> str:
    """
    Convert display Japanese (with furigana, bracketed options, or Chinese labels)
    into 100% pure, natural spoken Japanese for Neural TTS.
    """
    s = str(raw or "")
    # 1. Special handling for Module 14 appliance dictionary item
    if "【洗衣机】" in s:
        return "洗濯、洗濯乾燥、洗剤自動投入。ふろ自動、追いだき。暖房、加湿。"

    # 2. Remove Chinese tags in 【...】 such as 【店员说】 or 【1秒回答】
    s = re.sub(r"【[^】]*】", "", s)

    # 3. Replace arrow → with a natural pause
    s = s.replace("→", "。　")

    # 4. Remove full-width square bracket options/notes ［...］
    s = re.sub(r"［[^］]*］", "", s)

    # 5. Remove parenthetical notes starting with ※ or [自他]：
    s = re.sub(r"（※[^）]*）", "", s)
    s = re.sub(r"\(※[^\)]*\)", "", s)
    s = re.sub(r"（[自他]：[^）]*）", "", s)

    # 6. Remove furigana in （...） / (...)
    s = re.sub(r"（[\u3040-\u309F\u30A0-\u30FFー・〜0-9０-９a-zA-Z\s/／]+）", "", s)
    s = re.sub(r"\([\u3040-\u309F\u30A0-\u30FFー・〜0-9０-９a-zA-Z\s/／]+\)", "", s)

    # 7. Replace slash separator / or ／ with a gentle pause so alternatives read smoothly
    s = re.sub(r"\s*[/／]\s*", "。 ", s)

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
        return ("ja-JP-NanamiNeural", "+18Hz", "+0%")
    if any(k in name for k in ["Sherry", "日本妈妈", "保育园老师", "仲居", "女将", "专柜", "甜品", "收银", "客房"]):
        return ("ja-JP-NanamiNeural", "+0Hz", "+0%")
    if any(k in name for k in ["浩东", "大将", "司机", "爸爸", "主厨", "先生", "售票", "租赁", "药剂师"]):
        return ("ja-JP-KeitaNeural", "+0Hz", "+0%")
    if item_id.startswith(("m1-s1", "m1-s2", "m3-", "m4-s2", "m5-s1", "m7-s1", "m7-s2", "m8-s3", "m11-")):
        return ("ja-JP-KeitaNeural", "+0Hz", "+0%")
    return ("ja-JP-NanamiNeural", "+0Hz", "+0%")


def build_learning_tasks():
    """
    Collect all unique spoken Japanese clips across:
      - data/verbs_top200.js (300 verbs + 12 forms + 5 derived patterns + 900 daily examples)
      - data/grammar_n5_n3.js (132 patterns: 396 daily examples + 132 quiz complete sentences)
      - data/learning_extras.js (75 adjectives, 250 N5 vocab, counters, kana, comparisons,
        contractions, adverbs, onomatopoeia, keigo verbs, staff decoder, kanji traps, street signs, vi/vt quizzes)
    Returns:
      unique_jobs: dict[tts_key -> (tts_text, voice, rel_path)]
      lookup_map: dict[clean_lookup_key -> [rel_path, voice_code]]
    """
    unique_jobs = {}  # (tts_text, voice) -> rel_path
    lookup_map = {}   # normalized_lookup_text -> [rel_path, "F"|"M"]

    # Disambiguation overrides where isolated Kanji could be misread by TTS
    TTS_OVERRIDES = {
        "辛い": "からい",
        "いい": "いい",
        "好き": "すき",
        "入る": "はいる",
        "行く": "いく",
        "開く": "あく",
        "空く": "すく",
        "掛かる": "かかる",
        "掛ける": "かける",
        "苦い": "にがい",
        "細い": "ほそい",
        "太い": "ふとい",
        "風": "かぜ",
        "中": "なか",
        "間": "あいだ",
        "角": "かど",
        "箸": "はし",
        "橋": "はし",
        "雨": "あめ",
        "体": "からだ",
        "熱": "ねつ",
        "白": "しろ",
        "黒": "くろ",
        "赤": "あか",
        "青": "あお",
        "方": "かた",
        "満席": "まんせき",
        "土足厳禁": "どそくげんきん",
        "貸切風呂": "かしきりぶろ",
        "精算機": "せいさんき",
        "両替": "りょうがえ",
    }

    def register(lookup_keys, tts_text, voice):
        tts_clean = clean_spoken_japanese(tts_text)
        if not tts_clean:
            return
        # Gently separate middle-dot lists like げつ・か・すい for natural pauses
        tts_spoken = tts_clean.replace("・", "、")
        tts_spoken = TTS_OVERRIDES.get(tts_spoken, tts_spoken)

        vcode = "M" if "Keita" in voice else "F"
        h = hashlib.sha1(f"{vcode}:{tts_spoken}".encode("utf-8")).hexdigest()[:12]
        bucket = h[0]
        rel_path = f"audio/learn/{bucket}/{h}.mp3"

        job_key = (tts_spoken, voice)
        if job_key not in unique_jobs:
            unique_jobs[job_key] = rel_path

        for lk in lookup_keys:
            ck = clean_spoken_japanese(lk)
            if ck and ck not in lookup_map:
                lookup_map[ck] = [unique_jobs[job_key], vcode]

    # 1. Top 300 Verbs
    verbs_path = DATA_DIR / "verbs_top200.js"
    if verbs_path.exists():
        verbs = parse_js_data(verbs_path)
        for idx, v in enumerate(verbs):
            # Base verb: crisp Nanami female voice (use kana for ambiguous single-kanji dict words)
            base_tts = v["kana"] if v["dict"] in ("開く", "空く", "入る", "行く") else v["dict"]
            register([v["dict"], v["jp"], v["kana"]], base_tts, "ja-JP-NanamiNeural")
            # All 12 conjugated forms
            for fk in ("masu", "te", "ta", "nai", "tai", "potential", "volitional", "ba", "passive", "causative", "causative_passive", "imperative"):
                fobj = v["forms"].get(fk)
                if fobj and fobj.get("jp") and not fobj["jp"].startswith("—"):
                    register([fobj["jp"]], fobj["jp"], "ja-JP-NanamiNeural")
            # 5 derived modal patterns
            te_jp = v["forms"]["te"]["jp"]
            nai_jp = v["forms"]["nai"]["jp"]
            nai_stem = nai_jp[:-1] if nai_jp.endswith("ない") else nai_jp
            derived_voice = "ja-JP-KeitaNeural" if idx % 2 == 1 else "ja-JP-NanamiNeural"
            for dp in (
                f"{te_jp}います",
                f"{te_jp}ください",
                f"{te_jp}もいいですか？",
                f"{nai_stem}ければなりません",
                f"{te_jp}みます",
            ):
                register([dp], dp, derived_voice)
            # 3 daily example sentences (alternate Nanami & Keita)
            for ex_idx, ex in enumerate(v.get("examples", [])):
                ex_voice = "ja-JP-NanamiNeural" if (idx + ex_idx) % 2 == 0 else "ja-JP-KeitaNeural"
                register([ex["jp"]], ex["jp"], ex_voice)

    # 2. Grammar N5-N3
    grammar_path = DATA_DIR / "grammar_n5_n3.js"
    if grammar_path.exists():
        grammar = parse_js_data(grammar_path)
        for idx, g in enumerate(grammar):
            for ex_idx, ex in enumerate(g.get("dailyExamples", [])):
                ex_voice = "ja-JP-KeitaNeural" if (idx + ex_idx) % 2 == 1 else "ja-JP-NanamiNeural"
                register([ex["jp"]], ex["jp"], ex_voice)
            q = g.get("quiz")
            if q and q.get("promptJp") and q.get("answer"):
                full_q = q["promptJp"].replace("＿＿", q["answer"])
                q_voice = "ja-JP-NanamiNeural" if idx % 2 == 0 else "ja-JP-KeitaNeural"
                register([full_q], full_q, q_voice)

    # 3. Learning Extras (Adjectives 75, N5 Vocab 250, Counters, Kana, and all N4-N3 sets)
    extras_path = DATA_DIR / "learning_extras.js"
    if extras_path.exists():
        extras = parse_js_data(extras_path)
        for idx, a in enumerate(extras.get("adjectives", [])):
            adj_kanji = clean_spoken_japanese(a["jp"])
            tts_src = a["kana"] if adj_kanji in ("辛い", "いい", "好き", "苦い", "細い", "太い") else adj_kanji
            register([adj_kanji, a["jp"], a["kana"]], tts_src, "ja-JP-NanamiNeural")
            ex_voice = "ja-JP-KeitaNeural" if idx % 2 == 1 else "ja-JP-NanamiNeural"
            register([a["ex"]], a["ex"], ex_voice)

        for idx, nv in enumerate(extras.get("n5Vocab", [])):
            word_voice = "ja-JP-NanamiNeural" if idx % 2 == 0 else "ja-JP-KeitaNeural"
            ex_voice = "ja-JP-KeitaNeural" if idx % 2 == 0 else "ja-JP-NanamiNeural"
            register([nv["kana"], nv["jp"]], nv["kana"], word_voice)
            if nv.get("ex"):
                register([nv["ex"]], nv["ex"], ex_voice)

        for grp in extras.get("counters", []):
            for it in grp.get("items", []):
                register([it["kana"], it["jp"]], it["kana"], "ja-JP-NanamiNeural")

        for row in extras.get("kanaRows", []):
            for cell in row.get("cells", []):
                hira = cell[0] if cell else ""
                if hira:
                    register([hira], hira, "ja-JP-NanamiNeural")

        for cmp_item in extras.get("grammarComparisons", []):
            for r_idx, r in enumerate(cmp_item.get("rows", [])):
                if r.get("exJp"):
                    v = "ja-JP-NanamiNeural" if r_idx % 2 == 0 else "ja-JP-KeitaNeural"
                    register([r["exJp"]], r["exJp"], v)

        for idx, c in enumerate(extras.get("contractions", [])):
            register([c["exFormal"]], c["exFormal"], "ja-JP-KeitaNeural")
            register([c["exCasual"]], c["exCasual"], "ja-JP-NanamiNeural")

        for idx, adv in enumerate(extras.get("adverbs", [])):
            register([adv["kana"], adv["jp"]], adv["kana"], "ja-JP-NanamiNeural")
            v = "ja-JP-KeitaNeural" if idx % 2 == 1 else "ja-JP-NanamiNeural"
            register([adv["ex"]], adv["ex"], v)

        for idx, ono in enumerate(extras.get("onomatopoeia", [])):
            clean_o = clean_spoken_japanese(ono["jp"])
            register([ono["jp"], clean_o], clean_o, "ja-JP-NanamiNeural")
            v = "ja-JP-KeitaNeural" if idx % 2 == 0 else "ja-JP-NanamiNeural"
            register([ono["ex"]], ono["ex"], v)

        for idx, kg in enumerate(extras.get("keigoVerbs", [])):
            register([kg["sonkeigo"]], kg["sonkeigo"], "ja-JP-NanamiNeural")
            register([kg["kenjougo"]], kg["kenjougo"], "ja-JP-KeitaNeural")
            register([kg["ex"]], kg["ex"], "ja-JP-NanamiNeural" if idx % 2 == 0 else "ja-JP-KeitaNeural")

        for idx, st in enumerate(extras.get("staffDecoder", [])):
            staff_v = "ja-JP-NanamiNeural" if idx % 2 == 0 else "ja-JP-KeitaNeural"
            reply_v = "ja-JP-KeitaNeural" if staff_v == "ja-JP-NanamiNeural" else "ja-JP-NanamiNeural"
            register([st["hearJp"]], st["hearJp"], staff_v)
            register([st["replyJp"]], st["replyJp"], reply_v)

        for idx, kt in enumerate(extras.get("kanjiTraps", [])):
            register([kt["kana"], kt["jp"]], kt["kana"], "ja-JP-NanamiNeural")
            register([kt["ex"]], kt["ex"], "ja-JP-KeitaNeural" if idx % 2 == 1 else "ja-JP-NanamiNeural")

        for idx, ss in enumerate(extras.get("streetSigns", [])):
            register([ss["kana"], ss["jp"]], ss["kana"], "ja-JP-NanamiNeural")

        for idx, q in enumerate(extras.get("viVtQuizzes", [])):
            full_q = q["promptJp"].replace("＿＿", q["answer"])
            register([full_q], full_q, "ja-JP-NanamiNeural" if idx % 2 == 0 else "ja-JP-KeitaNeural")

    return unique_jobs, lookup_map


async def generate_batch(jobs, concurrency=12):
    """
    jobs: list of (out_path: Path, text: str, voice: str, pitch: str, rate: str, label: str)
    """
    sem = asyncio.Semaphore(concurrency)
    pending = [j for j in jobs if not (j[0].exists() and j[0].stat().st_size > 400)]
    total_pending = len(pending)
    if total_pending == 0:
        print("All target MP3 files already exist on disk!")
        return 0

    print(f"Generating {total_pending} missing neural MP3 clips (concurrency={concurrency})...")
    done = 0
    failed = 0

    async def gen_one(out_file: Path, text: str, voice: str, pitch: str, rate: str, label: str):
        nonlocal done, failed
        out_file.parent.mkdir(parents=True, exist_ok=True)
        async with sem:
            for attempt in range(5):
                try:
                    comm = edge_tts.Communicate(text=text, voice=voice, pitch=pitch, rate=rate)
                    await asyncio.wait_for(comm.save(str(out_file)), timeout=25)
                    if out_file.exists() and out_file.stat().st_size > 400:
                        done += 1
                        if done % 200 == 0 or done == total_pending:
                            print(f"  Progress: {done}/{total_pending} generated (failed={failed})")
                        return
                except Exception as e:
                    if attempt == 4:
                        failed += 1
                        print(f"  FAILED [{label}] ({text}): {e}")
                    await asyncio.sleep(0.8 * (attempt + 1))

    await asyncio.gather(*(gen_one(*j) for j in pending))
    return failed


async def main():
    # =========================================================================
    # PART 1: Original 18 Phrasebook Modules + 7 Taxi Cards
    # =========================================================================
    mods = []
    for fname in ["modules_1_to_6.js", "modules_7_to_12.js", "modules_13_to_18.js"]:
        mods.extend(parse_js_data(DATA_DIR / fname))

    phrase_jobs = []
    manifest = {}

    for m in mods:
        for sec in m.get("sections", []):
            for item in sec.get("items", []):
                iid = item["id"]
                spoken = clean_spoken_japanese(item["jp"])
                voice, pitch, rate = choose_voice_and_pitch(item_id=iid)
                fname = f"{iid}.mp3"
                manifest[iid] = {
                    "file": f"audio/{fname}",
                    "spoken": spoken,
                    "voice": "👨 男声 (Keita)" if "Keita" in voice else ("👧 童声 (Jinny)" if pitch != "+0Hz" else "👩 女声 (Nanami)")
                }
                phrase_jobs.append((AUDIO_DIR / fname, spoken, voice, pitch, rate, iid))

                for r_idx, rep in enumerate(item.get("replies", [])):
                    rid = f"{iid}-rep-{r_idx}"
                    r_spoken = clean_spoken_japanese(rep["jp"])
                    r_voice = "ja-JP-NanamiNeural" if voice == "ja-JP-KeitaNeural" else "ja-JP-KeitaNeural"
                    rfname = f"{rid}.mp3"
                    manifest[rid] = {
                        "file": f"audio/{rfname}",
                        "spoken": r_spoken,
                        "voice": "👨 男声 (Keita)" if "Keita" in r_voice else "👩 女声 (Nanami)"
                    }
                    phrase_jobs.append((AUDIO_DIR / rfname, r_spoken, r_voice, "+0Hz", "+0%", rid))

        for dlg in m.get("dialogues", []):
            did = dlg["id"]
            for t_idx, turn in enumerate(dlg.get("turns", [])):
                tid = f"{did}-turn-{t_idx}"
                t_spoken = clean_spoken_japanese(turn["jp"])
                voice, pitch, rate = choose_voice_and_pitch(
                    speaker=turn.get("speaker", "us"),
                    speaker_name=turn.get("speakerName", ""),
                    item_id=tid,
                )
                tfname = f"{tid}.mp3"
                manifest[tid] = {
                    "file": f"audio/{tfname}",
                    "spoken": t_spoken,
                    "voice": "👨 男声 (Keita)" if "Keita" in voice else ("👧 童声 (Jinny)" if pitch != "+0Hz" else "👩 女声 (Nanami)")
                }
                phrase_jobs.append((AUDIO_DIR / tfname, t_spoken, voice, pitch, rate, tid))

    itin_text = (DATA_DIR / "itinerary.js").read_text(encoding="utf-8")
    taxi_matches = re.findall(r'taxiDriverText:\s*"([^"]+)"', itin_text)
    for idx, t_text in enumerate(taxi_matches):
        tid = f"taxi-{idx}"
        spoken = clean_spoken_japanese(t_text)
        tfname = f"{tid}.mp3"
        manifest[tid] = {
            "file": f"audio/{tfname}",
            "spoken": spoken,
            "voice": "👨 男声 (Keita)"
        }
        phrase_jobs.append((AUDIO_DIR / tfname, spoken, "ja-JP-KeitaNeural", "+0Hz", "+0%", tid))

    print(f"Phrasebook clips: {len(phrase_jobs)}")
    fail1 = await generate_batch(phrase_jobs, concurrency=10)

    manifest_js = (
        "// Auto-generated Neural Audio Manifest (ja-JP-NanamiNeural & ja-JP-KeitaNeural)\n"
        "window.AUDIO_MANIFEST = " + json.dumps(manifest, ensure_ascii=False, indent=2) + ";\n"
    )
    (DATA_DIR / "audio_manifest.js").write_text(manifest_js, encoding="utf-8")

    # =========================================================================
    # PART 2: Learning Hub Studio Neural Audio (Verbs 200, Grammar N5-N3, Toolbox)
    # =========================================================================
    unique_jobs, lookup_map = build_learning_tasks()
    learn_jobs = [
        (PROJECT_DIR / rel_path, tts_text, voice, "+0Hz", "+0%", rel_path)
        for (tts_text, voice), rel_path in unique_jobs.items()
    ]
    print(f"Learning hub unique studio neural MP3 clips: {len(learn_jobs)} (lookup keys: {len(lookup_map)})")
    fail2 = await generate_batch(learn_jobs, concurrency=14)

    # Filter lookup_map to only entries whose file actually exists (>400 bytes)
    valid_lookup = {
        k: v for k, v in lookup_map.items()
        if (PROJECT_DIR / v[0]).exists() and (PROJECT_DIR / v[0]).stat().st_size > 400
    }
    learn_manifest_js = (
        "// Auto-generated Studio Neural Learning Audio Manifest (ja-JP-NanamiNeural & ja-JP-KeitaNeural)\n"
        "// Format: { normalizedSpokenJapanese: [relativeMp3Path, 'F'|'M'] }\n"
        "window.LEARNING_AUDIO_MANIFEST = " + json.dumps(valid_lookup, ensure_ascii=False, separators=(",", ":")) + ";\n"
    )
    (DATA_DIR / "audio_learning_manifest.js").write_text(learn_manifest_js, encoding="utf-8")

    # Remove orphaned MP3 clips under audio/learn/ no longer referenced by any manifest entry
    referenced_rel_paths = {v[0] for v in valid_lookup.values()}
    pruned_orphans = 0
    for mp3_file in LEARN_AUDIO_DIR.rglob("*.mp3"):
        rel = mp3_file.relative_to(PROJECT_DIR).as_posix()
        if rel not in referenced_rel_paths:
            mp3_file.unlink()
            pruned_orphans += 1

    total_bytes = sum(f.stat().st_size for f in LEARN_AUDIO_DIR.rglob("*.mp3"))
    print(
        f"Done! Phrasebook={len(manifest)} clips (failed={fail1}) | "
        f"Learning={len(valid_lookup)} keys / {len(learn_jobs)} MP3s ({total_bytes / 1024 / 1024:.2f} MB, failed={fail2}, pruned_orphans={pruned_orphans})"
    )


if __name__ == "__main__":
    asyncio.run(main())
