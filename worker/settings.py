from __future__ import annotations

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MODELS_DIR = Path(os.environ.get("MODELS_DIR") or ROOT / "models")

WHISPER_MODEL = "large-v3"
WHISPER_REPO_DIR = "models--Systran--faster-whisper-large-v3"
LANGUAGES = ("ru", "en")
ALIGN_MODELS_HF = {
    "ru": (
        "jonatasgrosman/wav2vec2-large-xlsr-53-russian",
        [
            "config.json",
            "preprocessor_config.json",
            "pytorch_model.bin",
            "special_tokens_map.json",
            "vocab.json",
        ],
    ),
}
PROMPT_TOKEN_LIMIT = 223
