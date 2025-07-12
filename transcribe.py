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

import gc
import json
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
    "source/meeting.m4a",
]

# Language code, ALWAYS set explicitly (autodetect is slow and misfires)
LANGUAGE = "ru"

# initial_prompt source — primes names/terms (huge accuracy boost). None = no prompt.
PROMPT_FILE = "prompts/meeting.txt"

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

# Send every download (HF hub: CT2 whisper + pyannote; torch hub: english align model)
# into ./models instead of ~/.cache. Must be set before torch/whisperx import.
os.environ.setdefault("HF_HOME", str(MODELS_DIR))
os.environ.setdefault("TORCH_HOME", str(MODELS_DIR))


def load_dotenv(env_path: Path) -> None:
    """Minimal .env loader: KEY=VALUE lines -> os.environ (does not overwrite existing)."""
    if not env_path.is_file():
        return
    for raw in env_path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        key = key.strip()
        val = val.strip().strip('"').strip("'")
        if key:
            os.environ.setdefault(key, val)


def fmt_ts(seconds) -> str:
    """Seconds -> SRT timestamp HH:MM:SS,mmm."""
    if seconds is None:
        seconds = 0.0
    total_ms = int(round(seconds * 1000))
    ms = total_ms % 1000
    s = (total_ms // 1000) % 60
    m = (total_ms // 60000) % 60
    h = total_ms // 3600000
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def segment_speaker(seg: dict):
    """Speaker for a segment: explicit field, else majority vote over word-level speakers."""
    if seg.get("speaker"):
        return seg["speaker"]
    spks = [w.get("speaker") for w in (seg.get("words") or []) if w.get("speaker")]
    if spks:
        return max(set(spks), key=spks.count)
    return None


def write_txt(path: Path, segments: list[dict]) -> None:
    text = "\n".join(s["text"].strip() for s in segments if s.get("text", "").strip())
    path.write_text(text + "\n", encoding="utf-8")


def write_srt(path: Path, segments: list[dict], with_speaker: bool) -> None:
    lines: list[str] = []
    idx = 1
    for seg in segments:
        txt = seg.get("text", "").strip()
        if not txt:
            continue
        spk = segment_speaker(seg) if with_speaker else None
        prefix = f"[{spk}] " if spk else ""
        lines += [
            str(idx),
            f"{fmt_ts(seg.get('start'))} --> {fmt_ts(seg.get('end'))}",
            prefix + txt,
            "",
        ]
        idx += 1
    path.write_text("\n".join(lines), encoding="utf-8")


def write_speakers(path: Path, segments: list[dict]) -> None:
    """Group consecutive same-speaker segments into readable turns."""
    turns: list[dict] = []
    last = "\x00sentinel"
    for seg in segments:
        txt = seg.get("text", "").strip()
        if not txt:
            continue
        spk = segment_speaker(seg) or "UNKNOWN"
        if spk != last:
            turns.append({"speaker": spk, "start": seg.get("start"), "parts": [txt]})
            last = spk
        else:
            turns[-1]["parts"].append(txt)
    out: list[str] = []
    for t in turns:
        out += [f"[{t['speaker']} {fmt_ts(t['start'])}]", " ".join(t["parts"]), ""]
    path.write_text("\n".join(out), encoding="utf-8")


def main() -> int:
    load_dotenv(HERE / ".env")
    hf_token = (
        os.environ.get("HF_TOKEN")
        or os.environ.get("HUGGINGFACE_TOKEN")
        or os.environ.get("HF_HUB_TOKEN")
    )

    if DIARIZE and not hf_token:
        print(
            "[!] DIARIZE=True but no HF token found in .env / env.\n"
            "    Add HF_TOKEN to .env or set DIARIZE = False.",
            file=sys.stderr,
        )
        return 2

    import torch
    import whisperx

    device = "cuda" if torch.cuda.is_available() else "cpu"
    compute_type = COMPUTE_TYPE if device == "cuda" else "int8"
    if device == "cpu":
        print("[!] CUDA not available -> running on CPU (slow).", file=sys.stderr)

    def free():
        gc.collect()
        if device == "cuda":
            torch.cuda.empty_cache()

    initial_prompt = None
    if PROMPT_FILE:
        initial_prompt = (HERE / PROMPT_FILE).read_text(encoding="utf-8").strip()

    asr_options = {
        "beam_size": 5,
        "temperatures": [0.0, 0.2, 0.4, 0.6, 0.8, 1.0],
        "compression_ratio_threshold": 2.4,
        "log_prob_threshold": -1.0,
        "no_speech_threshold": 0.3,  # meeting has pauses; VAD handles real silence
        "condition_on_previous_text": False,  # <- prevents the repetition cascade
        "initial_prompt": initial_prompt,
    }

    print(
        f"[*] device={device} compute={compute_type} model={MODEL} "
        f"language={LANGUAGE} diarize={DIARIZE} models_dir={MODELS_DIR}"
    )
    asr_model = whisperx.load_model(
        MODEL,
        device,
        compute_type=compute_type,
        language=LANGUAGE,
        asr_options=asr_options,
        download_root=str(MODELS_DIR),
        vad_options={
            "vad_onset": 0.6,
            "vad_offset": 0.4,
        },  # stricter VAD; ignore keystroke clicks
    )

    DiarizationPipeline = None
    if DIARIZE:
        try:
            from whisperx.diarize import DiarizationPipeline
        except Exception:
            DiarizationPipeline = getattr(whisperx, "DiarizationPipeline", None)
        if DiarizationPipeline is None:
            print(
                "[!] DiarizationPipeline not found -> continuing without speaker labels.",
                file=sys.stderr,
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
        out_dir.mkdir(parents=True, exist_ok=True)
        stem = f"{in_path.stem}.{LANGUAGE}"
        print(f"\n=== {in_path.name}  ->  {stem}.* ===")

        audio = whisperx.load_audio(str(in_path))  # 16 kHz mono float32, decoded once

        print("[1/3] transcribe…")
        result = asr_model.transcribe(audio, batch_size=BATCH_SIZE, language=LANGUAGE)

        if ALIGN:
            print("[2/3] align…")
            try:
                model_a, metadata = whisperx.load_align_model(
                    language_code=LANGUAGE, device=device
                )
                result = whisperx.align(
                    result["segments"],
                    model_a,
                    metadata,
                    audio,
                    device,
                    return_char_alignments=False,
                )
                del model_a, metadata
                free()
            except Exception as e:
                print(
                    f"[!] alignment failed ({e}); writing without precise word timings.",
                    file=sys.stderr,
                )

        diarized = False
        diar_turns: list[dict] = []
        if DIARIZE and DiarizationPipeline is not None:
            print("[3/3] diarize…")
            try:
                diar = DiarizationPipeline(
                    model_name=DIARIZE_MODEL,
                    token=hf_token,
                    device=device,
                    cache_dir=str(MODELS_DIR),
                )
                dkw = {}
                if MIN_SPEAKERS:
                    dkw["min_speakers"] = MIN_SPEAKERS
                if MAX_SPEAKERS:
                    dkw["max_speakers"] = MAX_SPEAKERS
                diar_segments = diar(audio, **dkw)
                diar_turns = [
                    {"start": float(r.start), "end": float(r.end), "speaker": r.speaker}
                    for r in diar_segments.itertuples()
                ]
                result = whisperx.assign_word_speakers(diar_segments, result)
                diarized = True
                del diar, diar_segments
                free()
            except Exception as e:
                print(
                    f"[!] diarization failed ({e}); writing without speaker labels.",
                    file=sys.stderr,
                )

        segments = result.get("segments", [])
        write_txt(out_dir / f"{stem}.txt", segments)
        write_srt(out_dir / f"{stem}.srt", segments, with_speaker=diarized)
        (out_dir / f"{stem}.json").write_text(
            json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        produced = [f"{stem}.txt", f"{stem}.srt", f"{stem}.json"]
        if diarized:
            write_speakers(out_dir / f"{stem}.speakers.txt", segments)
            (out_dir / f"{stem}.diarization.json").write_text(
                json.dumps(diar_turns, ensure_ascii=False, indent=2), encoding="utf-8"
            )
            produced += [f"{stem}.speakers.txt", f"{stem}.diarization.json"]
        print(f"[✓] wrote: {', '.join(produced)}")

    del asr_model
    free()
    return rc


if __name__ == "__main__":
    raise SystemExit(main())
