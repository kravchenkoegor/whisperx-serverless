#!/usr/bin/env python3
"""Merge the Russian and English WhisperX passes of one mixed RU/EN recording into one timeline.

Inputs, produced by transcribe.py next to the audio:
  <STEM>.ru.json              Russian pass, DIARIZE=True
  <STEM>.ru.diarization.json  raw pyannote turns of that pass: the speaker/timing backbone
  <STEM>.en.json              English pass, DIARIZE=False is enough
Writes <STEM>.merged.txt plus two caches (delete to recompute): <STEM>.lid.json (language ID)
and <STEM>.redecode.json (re-transcribed units).
Run:  python merge_ru_en.py

The algorithm is documented in whisper_core/merge_ru_en.py.
"""
from __future__ import annotations

import os
from pathlib import Path

HERE = Path(__file__).resolve().parent
MODELS_DIR = HERE / "models"
os.environ.setdefault("HF_HOME", str(MODELS_DIR))

# ---- CONFIG ----------------------------------------------------------------------
STEM = "Voice 260710_090115"
SRC_DIR = HERE / "source"
AUDIO = SRC_DIR / f"{STEM}.m4a"
RU_JSON = SRC_DIR / f"{STEM}.ru.json"
EN_JSON = SRC_DIR / f"{STEM}.en.json"
DIARIZATION_JSON = SRC_DIR / f"{STEM}.ru.diarization.json"
PROMPT_FILE = HERE / "prompts/example_mixed_ru_en.txt"
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

from whisper_core.merge_ru_en import RuEnConfig, merge_ru_en  # noqa: E402
from whisper_core.models import Models  # noqa: E402


def main() -> int:
    cfg = RuEnConfig(
        merge_gap=MERGE_GAP,
        max_unit=MAX_UNIT,
        min_lid_sec=MIN_LID_SEC,
        lid_confident=LID_CONFIDENT,
        cyrillic_min=CYRILLIC_MIN,
        latin_min=LATIN_MIN,
        en_max_cyrillic=EN_MAX_CYRILLIC,
        speaker_one_sided=SPEAKER_ONE_SIDED,
        echo_ngram=ECHO_NGRAM,
        prompt_echo_thresh=PROMPT_ECHO_THRESH,
    )
    prompt = PROMPT_FILE.read_text(encoding="utf-8") if PROMPT_FILE.is_file() else ""
    models = Models(MODELS_DIR, model=WHISPER_MODEL)
    try:
        stats = merge_ru_en(
            ru_json=RU_JSON,
            en_json=EN_JSON,
            diarization_json=DIARIZATION_JSON,
            out=OUT,
            lid_cache=LID_CACHE,
            redecode_cache=REDECODE_CACHE,
            prompt_text=prompt,
            audio=AUDIO,
            whisper=models.whisper,
            cfg=cfg,
        )
    except (FileNotFoundError, ValueError) as e:
        print(f"[!] {e}")
        return 1

    langs = stats.langs
    print(f"[✓] {OUT.name}: {stats.units} units (RU {langs['RU']}, EN {langs['EN']}), {stats.turns} turns")
    print("    language rule: " + ", ".join(f"{r} {n}" for r, n in stats.rules.most_common()))
    print("    text from: " + ", ".join(f"{s} {n}" for s, n in stats.sources.most_common()))
    print(
        "    EN share by speaker: "
        + ", ".join(f"{s} {v:.2f}" for s, v in sorted(stats.speaker_en_shares.items()))
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
