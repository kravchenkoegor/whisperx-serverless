from __future__ import annotations

import os
import sys

from .settings import ALIGN_MODELS_HF, LANGUAGES, MODELS_DIR, WHISPER_MODEL

os.environ.setdefault("HF_HOME", str(MODELS_DIR))
os.environ.setdefault("TORCH_HOME", str(MODELS_DIR))
os.environ.setdefault("NLTK_DATA", str(MODELS_DIR / "nltk_data"))


def download() -> None:
    import nltk
    import torchaudio
    from faster_whisper import download_model
    from huggingface_hub import snapshot_download

    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    download_model(WHISPER_MODEL, cache_dir=str(MODELS_DIR))
    for repo, files in ALIGN_MODELS_HF.values():
        snapshot_download(repo, allow_patterns=files)
    torchaudio.pipelines.WAV2VEC2_ASR_BASE_960H.get_model()
    nltk.download("punkt_tab", download_dir=os.environ["NLTK_DATA"], quiet=True)


def verify() -> None:
    import whisperx
    from faster_whisper import download_model
    from nltk.data import load as nltk_load

    download_model(WHISPER_MODEL, cache_dir=str(MODELS_DIR), local_files_only=True)
    for language in LANGUAGES:
        whisperx.load_align_model(language_code=language, device="cpu", model_cache_only=True)
    nltk_load("tokenizers/punkt_tab/english.pickle")
    nltk_load("tokenizers/punkt_tab/russian.pickle")
    print(f"[✓] baked models load offline from {MODELS_DIR}")


if __name__ == "__main__":
    if "--verify" in sys.argv:
        verify()
    else:
        download()
