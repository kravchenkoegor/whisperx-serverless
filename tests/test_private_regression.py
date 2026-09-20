import shutil
from pathlib import Path

import pytest

from whisper_core.merge_ru_en import merge_ru_en

ROOT = Path(__file__).resolve().parent.parent
PROMPT = next(iter(sorted((ROOT / "prompts" / "private").glob("*ru_en*.txt"))), None)
RECORDINGS = sorted(
    d for d in (ROOT / "archive").glob("*") if any(d.glob("*.merged.txt")) and any(d.glob("*.lid.json"))
)

pytestmark = pytest.mark.skipif(
    not RECORDINGS or PROMPT is None,
    reason="private recordings are not part of the repository",
)


def no_gpu():
    raise AssertionError("cache miss: the archived caches no longer cover every unit")


@pytest.mark.parametrize("recording", RECORDINGS, ids=lambda d: d.name[:13])
def test_archived_merge_is_reproduced_byte_for_byte(recording, tmp_path):
    shutil.copytree(recording, tmp_path, dirs_exist_ok=True)
    golden = next(tmp_path.glob("*.merged.txt"))
    stem = golden.name.removesuffix(".merged.txt")
    out = tmp_path / "new.merged.txt"
    merge_ru_en(
        ru_json=tmp_path / f"{stem}.ru.json",
        en_json=tmp_path / f"{stem}.en.json",
        diarization_json=tmp_path / f"{stem}.ru.diarization.json",
        out=out,
        lid_cache=tmp_path / f"{stem}.lid.json",
        redecode_cache=tmp_path / f"{stem}.redecode.json",
        prompt_text=PROMPT.read_text(encoding="utf-8"),
        whisper=no_gpu,
    )
    assert out.read_bytes() == golden.read_bytes()
