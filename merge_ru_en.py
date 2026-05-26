#!/usr/bin/env python3
"""Merge the Russian and English WhisperX passes of one mixed RU/EN recording into one timeline.

Inputs, produced by transcribe.py next to the audio:
  <STEM>.ru.json              Russian pass, DIARIZE=True
  <STEM>.ru.diarization.json  raw pyannote turns of that pass: the speaker/timing backbone
  <STEM>.en.json              English pass, DIARIZE=False is enough
Writes <STEM>.merged.txt plus two caches (delete to recompute): <STEM>.lid.json (language ID)
and <STEM>.redecode.json (re-transcribed units).
Run:  python merge_ru_en.py

The forced language does not fix the output language: WhisperX decodes ~30 s chunks, and a chunk
that starts in Russian stays Russian in both passes, translating any English inside it (and vice
versa). So neither pass is reliably in its own language, and the language is decided per speaker
turn instead:
  * Units = pyannote turns; same-speaker turns closer than MERGE_GAP are joined, each unit
    capped at MAX_UNIT seconds (the window Whisper's language ID looks at).
  * Every unit gets Whisper language ID on its own audio, restricted to ru vs en.
  * A unit's language is the first rule that applies:
      1. lid      confident language ID on a unit of at least MIN_LID_SEC;
      2. script   a pass wrote the other language's alphabet (Cyrillic in the EN pass means
                  Russian was heard, Latin in the RU pass means English), without contradiction;
      3. speaker  the speaker's language over their confident units, if one-sided;
      4. neighbor the nearest confidently identified unit;
      5. argmax   raw language-ID probability.
  * Text: words whose midpoint falls inside the unit, from whichever pass wrote them in the
    unit's alphabet, own pass first. English text must be free of Cyrillic (any Cyrillic there
    is a translation); Russian text may carry Latin terms. If neither pass fits, the unit was
    translated in both: units of at least MIN_LID_SEC are re-transcribed alone with the right
    language and the prompt's sentences in that language; shorter ones keep their own pass.
  * Prompt-echo segments are dropped and repetition loops collapsed, as in merge.py.
Greedy decoding and argmax only: the same inputs always give the same output.
"""
from __future__ import annotations

import bisect
import functools
import json
import math
import os
import re
from collections import Counter, defaultdict
from pathlib import Path

from merge import collapse_repeats, fmt_ts

HERE = Path(__file__).resolve().parent
MODELS_DIR = HERE / "models"
os.environ.setdefault("HF_HOME", str(MODELS_DIR))

# ---- CONFIG ----------------------------------------------------------------------
STEM = "meeting"
SRC_DIR = HERE / "source"
AUDIO = SRC_DIR / f"{STEM}.m4a"
RU_JSON = SRC_DIR / f"{STEM}.ru.json"
EN_JSON = SRC_DIR / f"{STEM}.en.json"
DIARIZATION_JSON = SRC_DIR / f"{STEM}.ru.diarization.json"
PROMPT_FILE = HERE / "prompts/meeting_ru_en.txt"
LID_CACHE = SRC_DIR / f"{STEM}.lid.json"
REDECODE_CACHE = SRC_DIR / f"{STEM}.redecode.json"
OUT = SRC_DIR / f"{STEM}.merged.txt"

WHISPER_MODEL = "large-v3"
MERGE_GAP = 1.0
MAX_UNIT = 30.0
MIN_LID_SEC = 1.5
LID_CONFIDENT = 0.80
CYRILLIC_MIN = 0.25
LATIN_MIN = 0.75
EN_MAX_CYRILLIC = 0.02
SPEAKER_ONE_SIDED = 0.85
ECHO_NGRAM = 5
PROMPT_ECHO_THRESH = 0.50
# ----------------------------------------------------------------------------------

SAMPLE_RATE = 16000
TOKEN = re.compile(r"\w+")
LATIN = re.compile(r"[A-Za-z]")
CYRILLIC = re.compile(r"[А-Яа-яЁё]")
SENTENCE_END = re.compile(r"(?<=[.!?])\s+")
OTHER = {"RU": "EN", "EN": "RU"}


def tokens(text: str) -> list[str]:
    return TOKEN.findall(text.lower())


def prompt_text() -> str:
    return PROMPT_FILE.read_text(encoding="utf-8").strip() if PROMPT_FILE.is_file() else ""


def prompt_ngrams() -> set[tuple[str, ...]]:
    ws = tokens(prompt_text())
    return {tuple(ws[i:i + ECHO_NGRAM]) for i in range(len(ws) - ECHO_NGRAM + 1)}


def is_prompt_echo(text: str, ngrams: set[tuple[str, ...]]) -> bool:
    ws = tokens(text)
    if len(ws) < ECHO_NGRAM:
        return False
    covered = [False] * len(ws)
    for i in range(len(ws) - ECHO_NGRAM + 1):
        if tuple(ws[i:i + ECHO_NGRAM]) in ngrams:
            covered[i:i + ECHO_NGRAM] = [True] * ECHO_NGRAM
    return sum(covered) / len(ws) >= PROMPT_ECHO_THRESH


def script(text: str) -> str | None:
    letters = sum(1 for c in text if c.isalpha())
    if letters < 2:
        return None
    if len(CYRILLIC.findall(text)) / letters >= CYRILLIC_MIN:
        return "RU"
    if len(LATIN.findall(text)) / letters >= LATIN_MIN:
        return "EN"
    return None


def fits(text: str, lang: str) -> bool:
    letters = sum(1 for c in text if c.isalpha())
    if letters < 2:
        return False
    cyrillic = len(CYRILLIC.findall(text)) / letters
    if lang == "RU":
        return cyrillic >= CYRILLIC_MIN
    return cyrillic <= EN_MAX_CYRILLIC and len(LATIN.findall(text)) / letters >= LATIN_MIN


def heard_from_script(ru_text: str, en_text: str) -> str | None:
    ru_script, en_script = script(ru_text), script(en_text)
    if ru_script == "EN":
        return None if en_script == "RU" else "EN"
    if en_script == "RU":
        return "RU"
    return None


def finite(x) -> bool:
    return isinstance(x, (int, float)) and math.isfinite(x)


def segment_words(seg: dict) -> list[dict]:
    seg_start = seg.get("start") if finite(seg.get("start")) else 0.0
    seg_end = seg.get("end") if finite(seg.get("end")) else seg_start
    words = [w for w in seg.get("words") or [] if (w.get("word") or "").strip()]
    if not words:
        text = collapse_repeats((seg.get("text") or "").strip())
        return [{"start": seg_start, "end": seg_end, "text": text}] if text else []
    out, t = [], seg_start
    for w in words:
        start, end = w.get("start"), w.get("end")
        if not (finite(start) and finite(end)):
            start = end = t
        t = end
        out.append({"start": start, "end": end, "text": w["word"].strip()})
    return out


def load_words(path: Path, ngrams: set[tuple[str, ...]]) -> list[dict]:
    data = json.loads(path.read_text(encoding="utf-8"))
    words: list[dict] = []
    for seg in data.get("segments", []):
        if not is_prompt_echo(seg.get("text") or "", ngrams):
            words += segment_words(seg)
    return words


def build_units(turns: list[dict]) -> list[dict]:
    joined: list[dict] = []
    for t in sorted(turns, key=lambda t: (t["start"], t["end"])):
        last = joined[-1] if joined else None
        if (
            last
            and last["speaker"] == t["speaker"]
            and t["start"] - last["end"] < MERGE_GAP
            and max(last["end"], t["end"]) - last["start"] <= MAX_UNIT
        ):
            last["end"] = max(last["end"], t["end"])
        else:
            joined.append({"start": t["start"], "end": t["end"], "speaker": t["speaker"]})
    units: list[dict] = []
    for u in joined:
        n = max(1, math.ceil((u["end"] - u["start"]) / MAX_UNIT))
        step = (u["end"] - u["start"]) / n
        units += [
            {**u, "start": u["start"] + i * step, "end": u["start"] + (i + 1) * step}
            for i in range(n)
        ]
    return units


def assign_text(words: list[dict], units: list[dict]) -> list[str]:
    starts = [u["start"] for u in units]
    buckets: list[list[dict]] = [[] for _ in units]
    for w in words:
        mid = (w["start"] + w["end"]) / 2
        lo = max(0, bisect.bisect_left(starts, mid - MAX_UNIT) - 1)
        hi = min(len(units), bisect.bisect_right(starts, mid) + 1)

        def rank(j: int) -> tuple[float, int]:
            u = units[j]
            return max(0.0, u["start"] - mid, mid - u["end"]), j

        buckets[min(range(lo, hi), key=rank)].append(w)
    return [" ".join(w["text"] for w in sorted(b, key=lambda w: w["start"])) for b in buckets]


def unit_key(u: dict) -> str:
    return f"{u['start']:.3f}-{u['end']:.3f}"


@functools.cache
def whisper_model():
    import ctranslate2
    from faster_whisper import WhisperModel

    cuda = ctranslate2.get_cuda_device_count() > 0
    return WhisperModel(
        WHISPER_MODEL,
        device="cuda" if cuda else "cpu",
        compute_type="float16" if cuda else "int8",
        download_root=str(MODELS_DIR),
    )


@functools.cache
def audio_samples():
    if not AUDIO.is_file():
        raise SystemExit(f"[!] No such file: {AUDIO} (needed for language ID / re-decoding)")
    from faster_whisper import decode_audio

    return decode_audio(str(AUDIO), sampling_rate=SAMPLE_RATE)


def unit_audio(u: dict):
    return audio_samples()[int(u["start"] * SAMPLE_RATE):int(u["end"] * SAMPLE_RATE)]


def load_cache(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8")) if path.is_file() else {}


def detect_languages(units: list[dict]) -> dict[str, dict[str, float]]:
    cache = load_cache(LID_CACHE)
    missing = [u for u in units if unit_key(u) not in cache]
    if not missing:
        return cache
    print(f"[*] language ID for {len(missing)} units…")
    for u in missing:
        clip = unit_audio(u)
        probs: dict[str, float] = {}
        if len(clip) >= SAMPLE_RATE // 10:
            _, _, all_probs = whisper_model().detect_language(audio=clip)
            probs = {lang: float(p) for lang, p in all_probs}
        cache[unit_key(u)] = {"ru": probs.get("ru", 0.0), "en": probs.get("en", 0.0)}
    LID_CACHE.write_text(json.dumps(cache, indent=2), encoding="utf-8")
    return cache


def prompt_in(lang: str) -> str | None:
    sentences = [s for s in SENTENCE_END.split(prompt_text()) if script(s) == lang]
    return " ".join(sentences) or None


def redecode(jobs: list[tuple[dict, str]]) -> dict[str, str]:
    cache = load_cache(REDECODE_CACHE)
    missing = [(u, lang) for u, lang in jobs if f"{unit_key(u)}|{lang}" not in cache]
    if not missing:
        return cache
    print(f"[*] re-transcribing {len(missing)} units translated in both passes…")
    for u, lang in missing:
        segments, _ = whisper_model().transcribe(
            unit_audio(u),
            language=lang.lower(),
            task="transcribe",
            beam_size=5,
            temperature=0.0,
            condition_on_previous_text=False,
            initial_prompt=prompt_in(lang),
            without_timestamps=True,
            vad_filter=False,
        )
        text = " ".join(s.text.strip() for s in segments).strip()
        cache[f"{unit_key(u)}|{lang}"] = collapse_repeats(text)
    REDECODE_CACHE.write_text(json.dumps(cache, ensure_ascii=False, indent=2), encoding="utf-8")
    return cache


def en_share(probs: dict[str, float]) -> float:
    total = probs["ru"] + probs["en"]
    return probs["en"] / total if total > 0 else 0.5


def speaker_en_shares(units: list[dict]) -> dict[str, float]:
    en, total = defaultdict(float), defaultdict(float)
    for u in units:
        if u.get("rule") == "lid":
            dur = u["end"] - u["start"]
            total[u["speaker"]] += dur
            if u["lang"] == "EN":
                en[u["speaker"]] += dur
    return {s: en[s] / total[s] for s in total if total[s] > 0}


def decide(units: list[dict]) -> dict[str, float]:
    for u in units:
        if u["end"] - u["start"] < MIN_LID_SEC:
            continue
        if u["p_en"] >= LID_CONFIDENT:
            u["lang"], u["rule"] = "EN", "lid"
        elif u["p_en"] <= 1 - LID_CONFIDENT:
            u["lang"], u["rule"] = "RU", "lid"

    shares = speaker_en_shares(units)
    confident = [u for u in units if u.get("rule") == "lid"]
    confident_mids = [(u["start"] + u["end"]) / 2 for u in confident]

    for u in units:
        if u.get("rule"):
            continue
        heard = heard_from_script(u["texts"]["RU"], u["texts"]["EN"])
        share = shares.get(u["speaker"])
        if heard:
            u["lang"], u["rule"] = heard, "script"
        elif share is not None and (share >= SPEAKER_ONE_SIDED or share <= 1 - SPEAKER_ONE_SIDED):
            u["lang"], u["rule"] = ("EN" if share >= SPEAKER_ONE_SIDED else "RU"), "speaker"
        elif confident:
            mid = (u["start"] + u["end"]) / 2
            i = bisect.bisect_left(confident_mids, mid)
            near = min(
                (j for j in (i - 1, i) if 0 <= j < len(confident)),
                key=lambda j: (abs(confident_mids[j] - mid), j),
            )
            u["lang"], u["rule"] = confident[near]["lang"], "neighbor"
        else:
            u["lang"], u["rule"] = ("EN" if u["p_en"] >= 0.5 else "RU"), "argmax"
    return shares


def needs_redecode(u: dict) -> bool:
    lang, texts = u["lang"], u["texts"]
    return (
        not fits(texts[lang], lang)
        and not fits(texts[OTHER[lang]], lang)
        and bool(texts[lang] or texts[OTHER[lang]])
        and u["end"] - u["start"] >= MIN_LID_SEC
    )


def pick_text(units: list[dict]) -> None:
    redecoded = redecode([(u, u["lang"]) for u in units if needs_redecode(u)])
    for u in units:
        lang, texts = u["lang"], u["texts"]
        if fits(texts[lang], lang):
            u["text"], u["source"] = texts[lang], lang.lower()
        elif fits(texts[OTHER[lang]], lang):
            u["text"], u["source"] = texts[OTHER[lang]], OTHER[lang].lower()
        elif needs_redecode(u):
            u["text"], u["source"] = redecoded[f"{unit_key(u)}|{lang}"], "redecode"
        else:
            u["text"], u["source"] = texts[lang], lang.lower()
            u["lang"] = script(texts[lang]) or lang


def write_merged(units: list[dict]) -> int:
    lines: list[str] = []
    cur = None

    def flush(turn):
        text = collapse_repeats(" ".join(turn["parts"]))
        lines.extend([f"[{turn['speaker']} {fmt_ts(turn['start'])} | {turn['lang']}]", text, ""])

    turns = 0
    for u in units:
        if not u["text"]:
            continue
        if cur and cur["speaker"] == u["speaker"] and cur["lang"] == u["lang"]:
            cur["parts"].append(u["text"])
            continue
        if cur:
            flush(cur)
        cur = {"speaker": u["speaker"], "start": u["start"], "lang": u["lang"], "parts": [u["text"]]}
        turns += 1
    if cur:
        flush(cur)
    OUT.write_text("\n".join(lines), encoding="utf-8")
    return turns


def main() -> int:
    for path in (RU_JSON, EN_JSON, DIARIZATION_JSON):
        if not path.is_file():
            print(f"[!] No such file: {path}")
            return 1
    turns = json.loads(DIARIZATION_JSON.read_text(encoding="utf-8"))
    if not turns:
        print(f"[!] {DIARIZATION_JSON.name} has no speaker turns")
        return 1

    ngrams = prompt_ngrams()
    units = build_units(turns)
    ru_texts = assign_text(load_words(RU_JSON, ngrams), units)
    en_texts = assign_text(load_words(EN_JSON, ngrams), units)
    lid = detect_languages(units)
    for u, ru_text, en_text in zip(units, ru_texts, en_texts):
        u["texts"] = {"RU": ru_text, "EN": en_text}
        u["p_en"] = en_share(lid[unit_key(u)])

    shares = decide(units)
    pick_text(units)
    n_turns = write_merged(units)

    spoken = [u for u in units if u["text"]]
    langs = Counter(u["lang"] for u in spoken)
    rules = Counter(u["rule"] for u in spoken)
    sources = Counter(u["source"] for u in spoken)
    print(f"[✓] {OUT.name}: {len(spoken)} units (RU {langs['RU']}, EN {langs['EN']}), {n_turns} turns")
    print("    language rule: " + ", ".join(f"{r} {n}" for r, n in rules.most_common()))
    print("    text from: " + ", ".join(f"{s} {n}" for s, n in sources.most_common()))
    print("    EN share by speaker: " + ", ".join(f"{s} {v:.2f}" for s, v in sorted(shares.items())))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
