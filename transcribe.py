#!/usr/bin/env python3
"""Transcribe meeting recordings with WhisperX (faster-whisper backend) + diarization.

Edit the CONFIG block below, then just run:  python transcribe.py

Per input it writes, next to the audio (or into OUT_DIR):
  <stem>.<lang>.txt           plain transcript
  <stem>.<lang>.srt           subtitles ([SPEAKER_xx] prefix if diarized)
  <stem>.<lang>.json          full WhisperX result (segments + word timings + speakers)
  <stem>.<lang>.speakers.txt  readable transcript grouped by speaker turns (if diarized)
  <stem>.<lang>.diarization.json  raw pyannote speaker turns (if diarized; merge_ru_en.py input)

All model weights (faster-whisper CT2, wav2vec2 alignment, pyannote diarization) are
downloaded into ./models (see MODELS_DIR), not the global ~/.cache.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
MODELS_DIR = HERE / "models"

# ----------------------------------------------------------------------------------
# CONFIG — edit these, then run `python transcribe.py`
# ----------------------------------------------------------------------------------
# Audio file(s) to transcribe (paths relative to this script's folder are fine).
INPUTS = [
    # "source/Voice 260703_090108.m4a",
    "source/Voice 260710_090115.m4a",
    # "source/Voice 260918_090012.m4a",
]

# Language code, ALWAYS set explicitly (autodetect is slow and misfires)
LANGUAGE = "ru"

# initial_prompt source — primes names/terms (huge accuracy boost). None = no prompt.
PROMPT_FILE = "prompts/example_mixed_ru_en.txt"

# Speaker diarization (who said what). True needs HF_TOKEN in .env.
DIARIZE = True
MIN_SPEAKERS = 2  # ignored while DIARIZE=False; single-speaker think-aloud
MAX_SPEAKERS = 4  # ignored while DIARIZE=False; single-speaker think-aloud
DIARIZE_MODEL = "pyannote/speaker-diarization-community-1"

# wav2vec2 word-level alignment (accurate timings). Leave True.
ALIGN = True

# Performance / quality knobs.
MODEL = "large-v3"
COMPUTE_TYPE = "float16"
BATCH_SIZE = 4

OUT_DIR = None
# ----------------------------------------------------------------------------------

# Must be set before torch/whisperx import so nothing downloads into ~/.cache.
os.environ.setdefault("HF_HOME", str(MODELS_DIR))
os.environ.setdefault("TORCH_HOME", str(MODELS_DIR))

from whisper_core.env import hf_token, load_dotenv  # noqa: E402


def main() -> int:
    load_dotenv(HERE / ".env")
    token = hf_token()

    if DIARIZE and not token:
        print(
            "[!] DIARIZE=True but no HF token found in .env / env.\n"
            "    Add HF_TOKEN to .env or set DIARIZE = False.",
            file=sys.stderr,
        )
        return 2

    from whisper_core.models import Models
    from whisper_core.transcribe import TranscribeParams, load_audio, run_transcription

    models = Models(
        MODELS_DIR,
        model=MODEL,
        compute_type=COMPUTE_TYPE,
        hf_token=token,
        diarize_model=DIARIZE_MODEL,
    )
    if models.device == "cpu":
        print("[!] CUDA not available -> running on CPU (slow).", file=sys.stderr)

    initial_prompt = None
    if PROMPT_FILE:
        initial_prompt = (HERE / PROMPT_FILE).read_text(encoding="utf-8").strip()

    params = TranscribeParams(
        language=LANGUAGE,
        initial_prompt=initial_prompt,
        align=ALIGN,
        diarize=DIARIZE,
        min_speakers=MIN_SPEAKERS,
        max_speakers=MAX_SPEAKERS,
        batch_size=BATCH_SIZE,
    )
    print(
        f"[*] device={models.device} compute={models.compute_type} model={MODEL} "
        f"language={LANGUAGE} diarize={DIARIZE} models_dir={MODELS_DIR}"
    )

    rc = 0
    for raw_in in INPUTS:
        in_path = Path(raw_in)
        if not in_path.is_absolute():
            in_path = HERE / in_path
        if not in_path.is_file():
            print(f"[!] No such file: {in_path}", file=sys.stderr)
            rc = 1
            continue
        out_dir = Path(OUT_DIR) if OUT_DIR else in_path.parent
        print(f"\n=== {in_path.name}  ->  {in_path.stem}.{LANGUAGE}.* ===")
        run_transcription(load_audio(in_path), out_dir, in_path.stem, params, models=models)

    models.close()
    return rc


if __name__ == "__main__":
    raise SystemExit(main())
