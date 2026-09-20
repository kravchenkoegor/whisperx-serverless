from __future__ import annotations

import os
import sys
import time

from .settings import LANGUAGES, MODELS_DIR

os.environ.setdefault("HF_HOME", str(MODELS_DIR))
os.environ.setdefault("TORCH_HOME", str(MODELS_DIR))

from whisper_core.env import hf_token, load_dotenv
from whisper_core.models import Models

from .settings import ROOT


def main() -> int:
    if os.environ.get("HF_HUB_OFFLINE") != "1":
        print("[!] run with HF_HUB_OFFLINE=1, otherwise the check proves nothing", file=sys.stderr)
        return 2
    load_dotenv(ROOT / ".env")
    models = Models(MODELS_DIR, hf_token=hf_token(), offline=True)
    steps = [("whisper", models.whisper)]
    steps += [(f"align {language}", lambda language=language: models.align_model(language)) for language in LANGUAGES]
    steps += [("diarization", models.diarization_pipeline)]
    for name, load in steps:
        started = time.perf_counter()
        load()
        print(f"[✓] {name} loaded offline on {models.device} in {time.perf_counter() - started:.1f}s")
        if name.startswith("align"):
            models.release_align(name.split()[1])
    models.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
