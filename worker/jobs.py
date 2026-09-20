from __future__ import annotations

import dataclasses
import re
from dataclasses import dataclass

from whisper_core.merge_ru_en import RuEnConfig

from .settings import LANGUAGES

TASKS = ("transcribe", "merge_ru_en")
RECORDING_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")
MAX_PROMPT_CHARS = 4000
THRESHOLD_FIELDS = {f.name: f.type for f in dataclasses.fields(RuEnConfig)}


class JobError(ValueError):
    pass


@dataclass(frozen=True)
class PassSpec:
    language: str
    prompt: str | None
    align: bool


@dataclass(frozen=True)
class MergeSpec:
    prompt: str
    config: RuEnConfig


@dataclass(frozen=True)
class JobSpec:
    task: str
    recording_id: str
    audio_key: str
    diarize: bool
    min_speakers: int | None
    max_speakers: int | None
    reuse_diarization: bool
    passes: tuple[PassSpec, ...]
    merge: MergeSpec | None
    batch_size: int | None


def recording_key(recording_id: str, name: str) -> str:
    return f"recordings/{recording_id}/{name}"


def _prompt(value, where: str) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str):
        raise JobError(f"{where}: prompt must be a string")
    if len(value) > MAX_PROMPT_CHARS:
        raise JobError(f"{where}: prompt is longer than {MAX_PROMPT_CHARS} characters")
    return value.strip() or None


def _optional_int(value, name: str, low: int, high: int) -> int | None:
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, int) or not low <= value <= high:
        raise JobError(f"{name} must be an integer between {low} and {high}")
    return value


def _passes(raw) -> tuple[PassSpec, ...]:
    if not isinstance(raw, list) or not raw:
        raise JobError("passes must be a non-empty list")
    passes = []
    for i, item in enumerate(raw):
        if not isinstance(item, dict):
            raise JobError(f"passes[{i}] must be an object")
        language = item.get("language")
        if language not in LANGUAGES:
            raise JobError(f"passes[{i}].language must be one of {', '.join(LANGUAGES)}")
        passes.append(
            PassSpec(
                language=language,
                prompt=_prompt(item.get("prompt"), f"passes[{i}]"),
                align=bool(item.get("align", True)),
            )
        )
    languages = [p.language for p in passes]
    if len(set(languages)) != len(languages):
        raise JobError("each language may appear in passes only once")
    return tuple(passes)


def _merge(raw) -> MergeSpec:
    if not isinstance(raw, dict):
        raise JobError("merge must be an object")
    thresholds = raw.get("thresholds") or {}
    if not isinstance(thresholds, dict):
        raise JobError("merge.thresholds must be an object")
    values = {}
    for name, value in thresholds.items():
        if name not in THRESHOLD_FIELDS:
            raise JobError(f"merge.thresholds.{name} is not a known threshold")
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise JobError(f"merge.thresholds.{name} must be a number")
        values[name] = int(value) if name == "echo_ngram" else float(value)
    return MergeSpec(prompt=_prompt(raw.get("prompt"), "merge") or "", config=RuEnConfig(**values))


def parse_job(data) -> JobSpec:
    if not isinstance(data, dict):
        raise JobError("input must be an object")
    task = data.get("task")
    if task not in TASKS:
        raise JobError(f"task must be one of {', '.join(TASKS)}")
    recording_id = data.get("recording_id")
    if not isinstance(recording_id, str) or not RECORDING_ID.match(recording_id):
        raise JobError("recording_id must match [A-Za-z0-9][A-Za-z0-9_-]{0,63}")
    audio_key = data.get("audio_key")
    if not isinstance(audio_key, str) or not audio_key.startswith(recording_key(recording_id, "")):
        raise JobError(f"audio_key must start with {recording_key(recording_id, '')}")

    min_speakers = _optional_int(data.get("min_speakers"), "min_speakers", 1, 20)
    max_speakers = _optional_int(data.get("max_speakers"), "max_speakers", 1, 20)
    if min_speakers and max_speakers and min_speakers > max_speakers:
        raise JobError("min_speakers must not exceed max_speakers")

    merge = _merge(data["merge"]) if data.get("merge") is not None else None
    if task == "merge_ru_en":
        if merge is None:
            raise JobError("merge_ru_en needs a merge object")
        passes: tuple[PassSpec, ...] = ()
    else:
        passes = _passes(data.get("passes"))

    return JobSpec(
        task=task,
        recording_id=recording_id,
        audio_key=audio_key,
        diarize=bool(data.get("diarize", True)),
        min_speakers=min_speakers,
        max_speakers=max_speakers,
        reuse_diarization=bool(data.get("reuse_diarization", True)),
        passes=passes,
        merge=merge,
        batch_size=_optional_int(data.get("batch_size"), "batch_size", 1, 32),
    )
