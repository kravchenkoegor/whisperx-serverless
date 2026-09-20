import json
import shutil
from pathlib import Path

import pytest

from whisper_core.transcribe import PassResult
from worker import handler as worker_handler
from worker.handler import Runtime, handler

FIXTURE = Path(__file__).parent / "fixtures" / "ru_en_meeting"
RID = "demo-1"


class FakeModels:
    keep_loaded = True
    offline = True

    def whisper(self):
        raise AssertionError("every unit of the fixture is cached, no model may be loaded")

    def free(self):
        pass


class FakeStorage:
    def __init__(self, root: Path):
        self.root = root

    def _path(self, key: str) -> Path:
        return self.root / key

    def download(self, key: str, path: Path) -> Path:
        path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy(self._path(key), path)
        return path

    def download_optional(self, key: str, path: Path) -> bool:
        if not self._path(key).is_file():
            return False
        self.download(key, path)
        return True

    def upload(self, path: Path, key: str) -> str:
        self._path(key).parent.mkdir(parents=True, exist_ok=True)
        shutil.copy(path, self._path(key))
        return key

    def put_text(self, key: str, text: str) -> str:
        self._path(key).parent.mkdir(parents=True, exist_ok=True)
        self._path(key).write_text(text, encoding="utf-8")
        return key

    def put_json(self, key: str, data: dict) -> str:
        return self.put_text(key, json.dumps(data, ensure_ascii=False))


@pytest.fixture
def bucket(tmp_path, monkeypatch):
    root = tmp_path / "bucket"
    (root / f"recordings/{RID}").mkdir(parents=True)
    (root / f"recordings/{RID}/audio.m4a").write_bytes(b"not real audio")
    progress: list[dict] = []
    calls: list[dict] = []

    def fake_transcription(audio, out_dir, stem, params, *, models, diarization=None, progress=None):
        calls.append({"language": params.language, "diarization_given": diarization is not None})
        progress("transcribe")
        produced = []
        for suffix in ("json", "diarization.json"):
            target = out_dir / f"{stem}.{params.language}.{suffix}"
            source = FIXTURE / f"meeting.{params.language}.{suffix}"
            shutil.copy(source if source.is_file() else FIXTURE / "meeting.ru.diarization.json", target)
            produced.append(target)
        return PassResult(
            files=produced,
            aligned=True,
            diarized=True,
            diarization="shared-diarization",
            warnings=["alignment was slow"] if params.language == "en" else [],
            timings={"load": 1.234, "transcribe": 5.678},
        )

    monkeypatch.setattr(worker_handler, "Storage", lambda: FakeStorage(root))
    monkeypatch.setattr(worker_handler, "load_audio", lambda path: "decoded-audio")
    monkeypatch.setattr(worker_handler, "run_transcription", fake_transcription)
    monkeypatch.setattr(worker_handler, "send_progress", lambda job, fields: progress.append(fields))
    monkeypatch.setattr(worker_handler, "prompt_token_warning", lambda prompt, where: None)
    monkeypatch.setattr(
        worker_handler,
        "runtime",
        lambda: Runtime(gpu={"name": "test", "vram_gb": 24.0}, models=FakeModels(), boot_seconds=1.0),
    )
    for name in ("lid.json", "redecode.json"):
        shutil.copy(FIXTURE / f"meeting.{name}", root / f"recordings/{RID}/{RID}.{name}")
    return root, progress, calls


def job(**overrides):
    data = {
        "task": "transcribe",
        "recording_id": RID,
        "audio_key": f"recordings/{RID}/audio.m4a",
        "passes": [{"language": "ru", "prompt": "Созвон команды."}, {"language": "en"}],
        "merge": {"prompt": (FIXTURE / "prompt.txt").read_text(encoding="utf-8")},
    }
    data.update(overrides)
    return {"id": "job-42", "input": data}


def test_full_job_runs_passes_then_merge_and_commits_the_status_document_last(bucket):
    root, progress, calls = bucket
    document = handler(job())

    assert document["status"] == "completed"
    assert calls == [
        {"language": "ru", "diarization_given": False},
        {"language": "en", "diarization_given": True},
    ]
    assert [p["language"] for p in document["passes"]] == ["ru", "en"]
    assert document["passes"][0]["batch_size"] == 16
    assert document["warnings"] == ["pass en: alignment was slow"]
    assert document["merge"]["rules"] == {"lid": 5, "speaker": 1, "script": 1, "neighbor": 1}

    merged = root / f"recordings/{RID}/{RID}.merged.txt"
    assert merged.read_text(encoding="utf-8") == (FIXTURE / "expected.merged.txt").read_text(encoding="utf-8")
    assert (root / f"recordings/{RID}/prompts/ru.txt").read_text(encoding="utf-8") == "Созвон команды."
    assert f"recordings/{RID}/{RID}.merged.txt" in document["files"]

    stored = json.loads((root / f"recordings/{RID}/jobs/job-42.json").read_text(encoding="utf-8"))
    assert stored == document
    assert [p["stage"] for p in progress] == ["download", "transcribe", "transcribe", "merge"]


def test_merge_only_job_pulls_its_inputs_from_storage(bucket):
    root, _, calls = bucket
    for name in ("ru.json", "en.json", "ru.diarization.json"):
        shutil.copy(FIXTURE / f"meeting.{name}", root / f"recordings/{RID}/{RID}.{name}")
    document = handler(job(task="merge_ru_en", passes=None))
    assert document["status"] == "completed" and calls == []
    assert document["merge"]["lid_computed"] == 0


def test_merge_without_passes_in_storage_fails_with_a_readable_error(bucket):
    root, _, _ = bucket
    result = handler(job(task="merge_ru_en", passes=None))
    assert "run the ru pass first" in result["error"]
    stored = json.loads((root / f"recordings/{RID}/jobs/job-42.json").read_text(encoding="utf-8"))
    assert stored["status"] == "failed"


def test_invalid_input_is_rejected_before_touching_storage(bucket):
    root, _, calls = bucket
    result = handler({"id": "job-43", "input": {"task": "transcribe", "recording_id": "../x"}})
    assert "recording_id" in result["error"] and calls == []
    assert not (root / "recordings/../x").exists()


def test_a_crash_in_a_pass_is_reported_not_raised(bucket, monkeypatch):
    def explode(*args, **kwargs):
        raise RuntimeError("CUDA out of memory")

    monkeypatch.setattr(worker_handler, "run_transcription", explode)
    result = handler(job())
    assert result["error"] == "RuntimeError: CUDA out of memory"
    assert result["status"]["status"] == "failed"
