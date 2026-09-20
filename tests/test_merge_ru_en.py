import shutil
from pathlib import Path

import pytest

from whisper_core.merge_ru_en import (
    RuEnConfig,
    build_units,
    fits,
    heard_from_script,
    is_prompt_echo,
    merge_ru_en,
    prompt_ngrams,
    script,
)

FIXTURE = Path(__file__).parent / "fixtures" / "ru_en_meeting"
CFG = RuEnConfig()


def no_gpu():
    raise AssertionError("the merge asked for a Whisper model although every unit is cached")


def run_fixture(workdir: Path, drop: tuple[str, ...] = (), **overrides):
    shutil.copytree(FIXTURE, workdir, dirs_exist_ok=True)
    for name in drop:
        (workdir / name).unlink()
    out = workdir / "meeting.merged.txt"
    arguments = {
        "ru_json": workdir / "meeting.ru.json",
        "en_json": workdir / "meeting.en.json",
        "diarization_json": workdir / "meeting.ru.diarization.json",
        "out": out,
        "lid_cache": workdir / "meeting.lid.json",
        "redecode_cache": workdir / "meeting.redecode.json",
        "prompt_text": (workdir / "prompt.txt").read_text(encoding="utf-8"),
        "whisper": no_gpu,
    }
    arguments.update(overrides)
    return merge_ru_en(**arguments), out


def test_fixture_matches_the_golden_transcript(tmp_path):
    stats, out = run_fixture(tmp_path)
    expected = (FIXTURE / "expected.merged.txt").read_text(encoding="utf-8")
    assert out.read_text(encoding="utf-8") == expected
    assert stats.lid_computed == 0 and stats.redecoded == 0


def test_fixture_exercises_every_language_rule(tmp_path):
    stats, _ = run_fixture(tmp_path)
    assert dict(stats.rules) == {"lid": 5, "speaker": 1, "script": 1, "neighbor": 1}
    assert dict(stats.sources) == {"en": 4, "ru": 3, "redecode": 1}
    assert stats.speaker_en_shares == {"SPEAKER_00": 0.0, "SPEAKER_01": 1.0, "SPEAKER_02": 0.5}


def test_prompt_echo_is_dropped_and_repeats_collapse(tmp_path):
    _, out = run_fixture(tmp_path)
    merged = out.read_text(encoding="utf-8")
    assert "Sprint sync" not in merged
    assert merged.count("sounds good") == 1


def test_same_inputs_give_the_same_output(tmp_path):
    _, first = run_fixture(tmp_path / "a")
    _, second = run_fixture(tmp_path / "b")
    assert first.read_bytes() == second.read_bytes()


def test_cache_miss_without_audio_is_an_ordinary_exception(tmp_path):
    with pytest.raises(FileNotFoundError):
        run_fixture(tmp_path, drop=("meeting.lid.json",), audio=tmp_path / "missing.m4a")


def test_missing_input_is_reported(tmp_path):
    with pytest.raises(FileNotFoundError):
        run_fixture(tmp_path, ru_json=tmp_path / "absent.ru.json")


def test_script_detects_alphabet():
    assert script("Привет, как дела", CFG) == "RU"
    assert script("We need the catalog", CFG) == "EN"
    assert script("42", CFG) is None


def test_english_must_be_free_of_cyrillic_but_russian_may_carry_latin():
    assert fits("Бета в TestFlight, APK готов", "RU", CFG)
    assert not fits("The beta is в TestFlight", "EN", CFG)
    assert fits("The beta is in TestFlight", "EN", CFG)


def test_cross_pass_script_evidence():
    assert heard_from_script("We need the catalog", "We need the catalog", CFG) == "EN"
    assert heard_from_script("Нам нужен каталог", "Нам нужен каталог", CFG) == "RU"
    assert heard_from_script("Нам нужен каталог", "We need the catalog", CFG) is None
    assert heard_from_script("We need it", "Нам это нужно", CFG) is None


def test_prompt_echo_needs_enough_covered_words():
    prompt = "Sprint sync команды, говорим на русском и английском. Anna, Boris and Michael."
    ngrams = prompt_ngrams(prompt, CFG)
    assert is_prompt_echo("Sprint sync команды, говорим на русском и английском.", ngrams, CFG)
    assert not is_prompt_echo("Анна, ты тикеты в Jira завела вчера вечером?", ngrams, CFG)
    assert not is_prompt_echo("Sprint sync", ngrams, CFG)


def test_build_units_joins_close_turns_of_one_speaker():
    turns = [
        {"start": 0.0, "end": 4.0, "speaker": "A"},
        {"start": 4.5, "end": 8.0, "speaker": "A"},
        {"start": 9.5, "end": 12.0, "speaker": "A"},
        {"start": 12.2, "end": 14.0, "speaker": "B"},
    ]
    units = build_units(turns, CFG)
    assert [(u["start"], u["end"], u["speaker"]) for u in units] == [
        (0.0, 8.0, "A"),
        (9.5, 12.0, "A"),
        (12.2, 14.0, "B"),
    ]


def test_build_units_splits_long_turns_into_equal_windows():
    units = build_units([{"start": 0.0, "end": 70.0, "speaker": "A"}], CFG)
    assert len(units) == 3
    assert all(u["end"] - u["start"] <= CFG.max_unit for u in units)
    assert units[0]["start"] == 0.0 and units[-1]["end"] == pytest.approx(70.0)
