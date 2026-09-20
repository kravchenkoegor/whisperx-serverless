from __future__ import annotations

import gc
import os
import sys
from pathlib import Path

DIARIZE_MODEL = "pyannote/speaker-diarization-community-1"

ASR_OPTIONS = {
    "beam_size": 5,
    "temperatures": [0.0, 0.2, 0.4, 0.6, 0.8, 1.0],
    "compression_ratio_threshold": 2.4,
    "log_prob_threshold": -1.0,
    "no_speech_threshold": 0.3,  # meetings have pauses; VAD handles real silence
    "condition_on_previous_text": False,  # prevents Whisper's repetition cascade
}
VAD_OPTIONS = {"vad_onset": 0.6, "vad_offset": 0.4}


class Models:
    def __init__(
        self,
        models_dir: Path,
        *,
        model: str = "large-v3",
        compute_type: str = "float16",
        hf_token: str | None = None,
        diarize_model: str = DIARIZE_MODEL,
        keep_loaded: bool = False,
        offline: bool = False,
    ):
        self.models_dir = Path(models_dir)
        self.model_name = model
        self.hf_token = hf_token
        self.diarize_model = diarize_model
        self.keep_loaded = keep_loaded
        self.offline = offline
        self._requested_compute_type = compute_type
        self._device: str | None = None
        self._whisper = None
        self._pipeline = None
        self._pipeline_key: tuple[str, str | None] | None = None
        self._align: dict[str, tuple] = {}
        self._diarization = None
        os.environ.setdefault("HF_HOME", str(self.models_dir))
        os.environ.setdefault("TORCH_HOME", str(self.models_dir))

    @property
    def device(self) -> str:
        if self._device is None:
            import ctranslate2

            self._device = "cuda" if ctranslate2.get_cuda_device_count() > 0 else "cpu"
        return self._device

    @property
    def compute_type(self) -> str:
        return self._requested_compute_type if self.device == "cuda" else "int8"

    def free(self) -> None:
        gc.collect()
        torch = sys.modules.get("torch")
        if torch is not None and self.device == "cuda":
            torch.cuda.empty_cache()

    def whisper(self):
        if self._whisper is None:
            from whisperx.asr import WhisperModel

            self._whisper = WhisperModel(
                self.model_name,
                device=self.device,
                compute_type=self.compute_type,
                download_root=str(self.models_dir),
                local_files_only=self.offline,
                cpu_threads=4,
            )
        return self._whisper

    def pipeline(self, language: str, initial_prompt: str | None):
        key = (language, initial_prompt)
        if self._pipeline_key != key:
            import whisperx

            self._pipeline = None
            self._pipeline = whisperx.load_model(
                self.model_name,
                self.device,
                compute_type=self.compute_type,
                language=language,
                asr_options={**ASR_OPTIONS, "initial_prompt": initial_prompt},
                vad_options=VAD_OPTIONS,
                model=self.whisper(),
                download_root=str(self.models_dir),
                local_files_only=self.offline,
            )
            self._pipeline_key = key
        return self._pipeline

    def align_model(self, language: str) -> tuple:
        if language not in self._align:
            import whisperx

            self._align[language] = whisperx.load_align_model(
                language_code=language, device=self.device, model_cache_only=self.offline
            )
        return self._align[language]

    def release_align(self, language: str) -> None:
        if not self.keep_loaded:
            self._align.pop(language, None)
            self.free()

    def diarization_pipeline(self):
        if self._diarization is None:
            from whisperx.diarize import DiarizationPipeline

            self._diarization = DiarizationPipeline(
                model_name=self.diarize_model,
                token=self.hf_token,
                device=self.device,
                cache_dir=str(self.models_dir),
            )
        return self._diarization

    def release_diarization(self) -> None:
        if not self.keep_loaded:
            self._diarization = None
            self.free()

    def close(self) -> None:
        self._pipeline = None
        self._pipeline_key = None
        self._whisper = None
        self._align.clear()
        self._diarization = None
        self.free()
