from __future__ import annotations

import os
from pathlib import Path

HF_TOKEN_VARS = ("HF_TOKEN", "HUGGINGFACE_TOKEN", "HF_HUB_TOKEN")


def load_dotenv(env_path: Path) -> None:
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


def hf_token() -> str | None:
    return next((os.environ[v] for v in HF_TOKEN_VARS if os.environ.get(v)), None)
