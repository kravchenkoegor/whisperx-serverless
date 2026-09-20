from __future__ import annotations

import functools
import json
import os
import shutil
import sys
import tempfile
import time
import traceback
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

from .settings import MODELS_DIR, PROMPT_TOKEN_LIMIT, ROOT, WHISPER_REPO_DIR

PROCESS_STARTED = time.perf_counter()

os.environ.setdefault("HF_HOME", str(MODELS_DIR))
os.environ.setdefault("TORCH_HOME", str(MODELS_DIR))

from whisper_core.env import hf_token, load_dotenv  # noqa: E402
from whisper_core.merge_ru_en import merge_ru_en  # noqa: E402
from whisper_core.models import Models  # noqa: E402
from whisper_core.transcribe import (  # noqa: E402
    TranscribeParams,
    diarization_frame,
    load_audio,
    run_transcription,
)

from .jobs import JobError, JobSpec, parse_job, recording_key  # noqa: E402
from .storage import Storage  # noqa: E402

KEEP_LOADED_MIN_VRAM_GB = 14


@dataclass
class Runtime:
    gpu: dict
    models: Models
    boot_seconds: float
    jobs_served: int = 0

    @property
    def default_batch_size(self) -> int:
        if self.gpu["vram_gb"] >= 20:
            return 16
        if self.gpu["vram_gb"] >= KEEP_LOADED_MIN_VRAM_GB:
            return 8
        return 4


def gpu_info() -> dict:
    import torch

    if not torch.cuda.is_available():
        return {"name": "cpu", "vram_gb": 0.0}
    props = torch.cuda.get_device_properties(0)
    return {"name": props.name, "vram_gb": round(props.total_memory / 2**30, 1)}


@functools.cache
def runtime() -> Runtime:
    load_dotenv(ROOT / ".env")
    gpu = gpu_info()
    models = Models(
        MODELS_DIR,
        hf_token=hf_token(),
        keep_loaded=gpu["vram_gb"] >= KEEP_LOADED_MIN_VRAM_GB,
        offline=os.environ.get("HF_HUB_OFFLINE") == "1",
    )
    return Runtime(gpu=gpu, models=models, boot_seconds=time.perf_counter() - PROCESS_STARTED)


def send_progress(job: dict, fields: dict) -> None:
    import runpod

    runpod.serverless.progress_update(job, fields)


def now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")


def prompt_token_warning(prompt: str | None, where: str) -> str | None:
    if not prompt:
        return None
    snapshots = MODELS_DIR / WHISPER_REPO_DIR / "snapshots"
    tokenizer_file = next(snapshots.glob("*/tokenizer.json"), None)
    if tokenizer_file is None:
        return None
    from tokenizers import Tokenizer

    tokenizer = Tokenizer.from_file(str(tokenizer_file))
    count = len(tokenizer.encode(" " + prompt, add_special_tokens=False).ids)
    if count <= PROMPT_TOKEN_LIMIT:
        return None
    return (
        f"{where}: prompt is {count} Whisper tokens; only the last {PROMPT_TOKEN_LIMIT} are used, "
        "the beginning is dropped"
    )


class _Timer:
    def __init__(self, timings: dict[str, float], name: str):
        self.timings = timings
        self.name = name

    def __enter__(self):
        self.started = time.perf_counter()
        return self

    def __exit__(self, *exc):
        self.timings[self.name] = round(time.perf_counter() - self.started, 2)
        return False


class Run:
    def __init__(self, job: dict, spec: JobSpec, storage: Storage, workdir: Path, rt: Runtime):
        self.job = job
        self.spec = spec
        self.storage = storage
        self.workdir = workdir
        self.rt = rt
        self.files: list[str] = []
        self.warnings: list[str] = []
        self.timings: dict[str, float] = {}
        self.passes: list[dict] = []
        self.merge: dict | None = None

    def key(self, name: str) -> str:
        return recording_key(self.spec.recording_id, name)

    def local(self, name: str) -> Path:
        return self.workdir / name

    def progress(self, **fields) -> None:
        send_progress(self.job, fields)

    def timed(self, name: str) -> _Timer:
        return _Timer(self.timings, name)

    def upload(self, path: Path) -> None:
        self.files.append(self.storage.upload(path, self.key(path.name)))

    def note_prompt(self, prompt: str | None, name: str, where: str) -> None:
        warning = prompt_token_warning(prompt, where)
        if warning:
            self.warnings.append(warning)
        if prompt:
            self.files.append(self.storage.put_text(self.key(f"prompts/{name}.txt"), prompt))

    def fetch_audio(self) -> Path:
        self.progress(stage="download")
        with self.timed("download"):
            suffix = Path(self.spec.audio_key).suffix or ".audio"
            return self.storage.download(self.spec.audio_key, self.local(f"audio{suffix}"))

    def stored_diarization(self):
        if not (self.spec.diarize and self.spec.reuse_diarization):
            return None
        rid = self.spec.recording_id
        for language in ("ru", "en"):
            path = self.local(f"{rid}.{language}.diarization.json")
            if self.storage.download_optional(self.key(path.name), path):
                turns = json.loads(path.read_text(encoding="utf-8"))
                if turns:
                    return diarization_frame(turns)
        return None

    def transcribe(self, audio_path: Path) -> None:
        spec = self.spec
        with self.timed("decode"):
            audio = load_audio(audio_path)
        diarization = self.stored_diarization()
        batch_size = spec.batch_size or self.rt.default_batch_size

        for index, item in enumerate(spec.passes, start=1):
            self.note_prompt(item.prompt, item.language, f"pass {item.language}")
            params = TranscribeParams(
                language=item.language,
                initial_prompt=item.prompt,
                align=item.align,
                diarize=spec.diarize,
                min_speakers=spec.min_speakers,
                max_speakers=spec.max_speakers,
                batch_size=batch_size,
            )
            result = run_transcription(
                audio,
                self.workdir,
                spec.recording_id,
                params,
                models=self.rt.models,
                diarization=diarization,
                progress=lambda stage, language=item.language, i=index: self.progress(
                    stage=stage, language=language, index=i, of=len(spec.passes)
                ),
            )
            if result.diarization is not None:
                diarization = result.diarization
            with self.timed(f"upload_{item.language}"):
                for path in result.files:
                    self.upload(path)
            self.warnings += [f"pass {item.language}: {w}" for w in result.warnings]
            self.passes.append(
                {
                    "language": item.language,
                    "aligned": result.aligned,
                    "diarized": result.diarized,
                    "batch_size": batch_size,
                    "timings": {k: round(v, 2) for k, v in result.timings.items()},
                }
            )

    def available(self, names: list[str], hint: str) -> Path:
        for name in names:
            path = self.local(name)
            if path.is_file() or self.storage.download_optional(self.key(name), path):
                return path
        raise JobError(f"merge needs {' or '.join(names)}: {hint}")

    def merge_passes(self, audio_path: Path) -> None:
        spec = self.spec
        rid = spec.recording_id
        self.progress(stage="merge")

        ru_json = self.available([f"{rid}.ru.json"], "run the ru pass first")
        en_json = self.available([f"{rid}.en.json"], "run the en pass first")
        diarization_json = self.available(
            [f"{rid}.ru.diarization.json", f"{rid}.en.diarization.json"],
            "run a pass with diarize=true first",
        )
        lid_cache = self.local(f"{rid}.lid.json")
        redecode_cache = self.local(f"{rid}.redecode.json")
        for cache in (lid_cache, redecode_cache):
            if not cache.is_file():
                self.storage.download_optional(self.key(cache.name), cache)

        self.note_prompt(spec.merge.prompt, "merge", "merge")
        out = self.local(f"{rid}.merged.txt")
        with self.timed("merge"):
            stats = merge_ru_en(
                ru_json=ru_json,
                en_json=en_json,
                diarization_json=diarization_json,
                out=out,
                lid_cache=lid_cache,
                redecode_cache=redecode_cache,
                prompt_text=spec.merge.prompt,
                audio=audio_path,
                whisper=self.rt.models.whisper,
                cfg=spec.merge.config,
            )
        for path in (out, lid_cache, redecode_cache):
            if path.is_file():
                self.upload(path)
        self.merge = {
            "units": stats.units,
            "turns": stats.turns,
            "langs": dict(stats.langs),
            "rules": dict(stats.rules),
            "sources": dict(stats.sources),
            "speaker_en_shares": {k: round(v, 3) for k, v in stats.speaker_en_shares.items()},
            "lid_computed": stats.lid_computed,
            "redecoded": stats.redecoded,
        }

    def execute(self) -> None:
        audio_path = self.fetch_audio()
        if self.spec.task == "transcribe":
            self.transcribe(audio_path)
        if self.spec.merge is not None:
            self.merge_passes(audio_path)


def status_document(
    job: dict,
    spec: JobSpec | None,
    run: Run | None,
    rt: Runtime,
    started_at: str,
    started: float,
    error: str | None,
) -> dict:
    document = {
        "job_id": job.get("id"),
        "status": "failed" if error else "completed",
        "task": spec.task if spec else None,
        "recording_id": spec.recording_id if spec else None,
        "started_at": started_at,
        "finished_at": now(),
        "total_seconds": round(time.perf_counter() - started, 2),
        "gpu": rt.gpu,
        "worker": {
            "boot_seconds": round(rt.boot_seconds, 2),
            "jobs_served_before": rt.jobs_served,
            "models_kept_loaded": rt.models.keep_loaded,
            "offline": rt.models.offline,
        },
        "passes": run.passes if run else [],
        "merge": run.merge if run else None,
        "timings": run.timings if run else {},
        "warnings": run.warnings if run else [],
        "files": sorted(set(run.files)) if run else [],
    }
    if error:
        document["error"] = error
    return document


def handler(job: dict) -> dict:
    started_at, started = now(), time.perf_counter()
    rt = runtime()
    spec: JobSpec | None = None
    run: Run | None = None
    storage: Storage | None = None
    error: str | None = None
    workdir = Path(tempfile.mkdtemp(prefix="job-"))
    try:
        spec = parse_job(job.get("input"))
        storage = Storage()
        run = Run(job, spec, storage, workdir, rt)
        run.execute()
    except JobError as e:
        error = str(e)
    except Exception as e:
        traceback.print_exc(file=sys.stderr)
        error = f"{type(e).__name__}: {e}"
    finally:
        shutil.rmtree(workdir, ignore_errors=True)
        rt.models.free()

    document = status_document(job, spec, run, rt, started_at, started, error)
    rt.jobs_served += 1
    if spec and storage:
        try:
            storage.put_json(recording_key(spec.recording_id, f"jobs/{job.get('id')}.json"), document)
        except Exception as e:
            print(f"[!] could not write the job status document: {e}", file=sys.stderr)
    if error:
        return {"error": error, "status": document}
    return document


if __name__ == "__main__":
    import runpod

    runtime()
    runpod.serverless.start({"handler": handler})
