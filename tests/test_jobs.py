import pytest

from worker.jobs import JobError, parse_job


def job(**overrides):
    data = {
        "task": "transcribe",
        "recording_id": "260710-090115",
        "audio_key": "recordings/260710-090115/audio.m4a",
        "passes": [{"language": "ru", "prompt": "  Созвон команды.  "}, {"language": "en"}],
    }
    data.update(overrides)
    return data


def test_defaults():
    spec = parse_job(job())
    assert [p.language for p in spec.passes] == ["ru", "en"]
    assert spec.passes[0].prompt == "Созвон команды."
    assert spec.passes[1].prompt is None and spec.passes[1].align
    assert spec.diarize and spec.reuse_diarization
    assert spec.merge is None and spec.batch_size is None


def test_merge_thresholds_override_the_defaults():
    spec = parse_job(job(merge={"prompt": "Anna and Michael.", "thresholds": {"lid_confident": 0.9, "echo_ngram": 4}}))
    assert spec.merge.config.lid_confident == 0.9
    assert spec.merge.config.echo_ngram == 4
    assert spec.merge.config.max_unit == 30.0


def test_merge_only_task_needs_no_passes():
    spec = parse_job(job(task="merge_ru_en", passes=None, merge={"prompt": ""}))
    assert spec.passes == () and spec.merge.prompt == ""


@pytest.mark.parametrize(
    "overrides, message",
    [
        ({"task": "merge_en_ko"}, "task must be"),
        ({"passes": [{"language": "ko"}]}, "language must be one of ru, en"),
        ({"passes": [{"language": "ru"}, {"language": "ru"}]}, "only once"),
        ({"passes": []}, "non-empty"),
        ({"recording_id": "../etc"}, "recording_id"),
        ({"recording_id": "Voice 260710"}, "recording_id"),
        ({"audio_key": "recordings/other/audio.m4a"}, "audio_key must start with"),
        ({"batch_size": 64}, "batch_size"),
        ({"batch_size": True}, "batch_size"),
        ({"min_speakers": 5, "max_speakers": 2}, "must not exceed"),
        ({"merge": {"thresholds": {"lid_confidence": 0.9}}}, "not a known threshold"),
        ({"merge": {"thresholds": {"lid_confident": "high"}}}, "must be a number"),
        ({"task": "merge_ru_en", "passes": None}, "needs a merge object"),
        ({"passes": [{"language": "ru", "prompt": "x" * 4001}]}, "longer than"),
    ],
)
def test_rejects_invalid_input(overrides, message):
    with pytest.raises(JobError, match=message):
        parse_job(job(**overrides))


def test_rejects_non_object_input():
    with pytest.raises(JobError):
        parse_job(None)
