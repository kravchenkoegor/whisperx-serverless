from __future__ import annotations

import sys

from whisper_core.env import hf_token, load_dotenv
from whisper_core.models import DIARIZE_MODEL

from .settings import MODELS_DIR, ROOT


def main() -> int:
    load_dotenv(ROOT / ".env")
    token = hf_token()
    if not token:
        print(
            "[!] HF_TOKEN is not set. Accept the license of "
            f"{DIARIZE_MODEL} on Hugging Face and add HF_TOKEN to the endpoint environment.",
            file=sys.stderr,
        )
        return 1

    from huggingface_hub import snapshot_download

    snapshot_download(DIARIZE_MODEL, cache_dir=str(MODELS_DIR), token=token)
    print(f"[✓] {DIARIZE_MODEL} is cached in {MODELS_DIR}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
