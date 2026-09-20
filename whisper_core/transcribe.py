from __future__ import annotations

import json
import sys
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path

from .models import Models
from .text import fmt_srt_ts, segment_speaker


@dataclass(frozen=True)
class TranscribeParams:
    language: str
    initial_prompt: str | None = None
    align: bool = True
    diarize: bool = True
    min_speakers: int | None = 2
    max_speakers: int | None = 4
    batch_size: int = 4


@dataclass
class PassResult:
    files: list[Path]
    aligned: bool
    diarized: bool
    diarization: object | None
    warnings: list[str] = field(default_factory=list)
    timings: dict[str, float] = field(default_factory=dict)


def load_audio(path: Path):
    import whisperx

    return whisperx.load_audio(str(path))


def diarization_turns(frame) -> list[dict]:
    return [
        {"start": float(r.start), "end": float(r.end), "speaker": r.speaker}
        for r in frame.itertuples()
    ]


def diarization_frame(turns: list[dict]):
    import pandas as pd

    return pd.DataFrame(turns, columns=["start", "end", "speaker"])


def run_diarization(audio, *, models: Models, min_speakers: int | None, max_speakers: int | None):
    kwargs = {}
    if min_speakers:
        kwargs["min_speakers"] = min_speakers
    if max_speakers:
        kwargs["max_speakers"] = max_speakers
    try:
        return models.diarization_pipeline()(audio, **kwargs)
    finally:
        models.release_diarization()


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
            f"{fmt_srt_ts(seg.get('start'))} --> {fmt_srt_ts(seg.get('end'))}",
            prefix + txt,
            "",
        ]
        idx += 1
    path.write_text("\n".join(lines), encoding="utf-8")


def write_speakers(path: Path, segments: list[dict]) -> None:
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
        out += [f"[{t['speaker']} {fmt_srt_ts(t['start'])}]", " ".join(t["parts"]), ""]
    path.write_text("\n".join(out), encoding="utf-8")


def run_transcription(
    audio,
    out_dir: Path,
    stem: str,
    params: TranscribeParams,
    *,
    models: Models,
    diarization=None,
    progress: Callable[[str], None] | None = None,
) -> PassResult:
    import whisperx

    notify = progress or (lambda stage: None)
    lang = params.language
    name = f"{stem}.{lang}"
    warnings: list[str] = []
    timings: dict[str, float] = {}

    def warn(message: str) -> None:
        warnings.append(message)
        print(f"[!] {message}", file=sys.stderr)

    notify("load")
    started = time.perf_counter()
    pipeline = models.pipeline(lang, params.initial_prompt)
    timings["load"] = time.perf_counter() - started

    notify("transcribe")
    print("[1/3] transcribe…")
    started = time.perf_counter()
    result = pipeline.transcribe(audio, batch_size=params.batch_size, language=lang)
    timings["transcribe"] = time.perf_counter() - started

    aligned = False
    if params.align:
        notify("align")
        print("[2/3] align…")
        started = time.perf_counter()
        try:
            align_model, metadata = models.align_model(lang)
            result = whisperx.align(
                result["segments"],
                align_model,
                metadata,
                audio,
                models.device,
                return_char_alignments=False,
            )
            aligned = True
            del align_model, metadata
        except Exception as e:
            warn(f"alignment failed ({e}); writing without precise word timings.")
        finally:
            models.release_align(lang)
        timings["align"] = time.perf_counter() - started

    diarized = False
    if params.diarize:
        notify("diarize")
        print("[3/3] diarize…")
        started = time.perf_counter()
        try:
            if diarization is None:
                diarization = run_diarization(
                    audio,
                    models=models,
                    min_speakers=params.min_speakers,
                    max_speakers=params.max_speakers,
                )
            result = whisperx.assign_word_speakers(diarization, result)
            diarized = True
        except Exception as e:
            diarization = None
            warn(f"diarization failed ({e}); writing without speaker labels.")
        timings["diarize"] = time.perf_counter() - started

    out_dir.mkdir(parents=True, exist_ok=True)
    segments = result.get("segments", [])
    files = [out_dir / f"{name}.txt", out_dir / f"{name}.srt", out_dir / f"{name}.json"]
    write_txt(files[0], segments)
    write_srt(files[1], segments, with_speaker=diarized)
    files[2].write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    if diarized:
        speakers_path = out_dir / f"{name}.speakers.txt"
        turns_path = out_dir / f"{name}.diarization.json"
        write_speakers(speakers_path, segments)
        turns_path.write_text(
            json.dumps(diarization_turns(diarization), ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        files += [speakers_path, turns_path]
    print(f"[✓] wrote: {', '.join(p.name for p in files)}")

    return PassResult(
        files=files,
        aligned=aligned,
        diarized=diarized,
        diarization=diarization if diarized else None,
        warnings=warnings,
        timings=timings,
    )
