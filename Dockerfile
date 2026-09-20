FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    MODELS_DIR=/models \
    HF_HOME=/models \
    TORCH_HOME=/models \
    NLTK_DATA=/models/nltk_data \
    PYANNOTE_METRICS_ENABLED=false \
    NVIDIA_VISIBLE_DEVICES=all \
    NVIDIA_DRIVER_CAPABILITIES=compute,utility \
    LD_LIBRARY_PATH=/usr/local/lib/python3.12/site-packages/nvidia/cudnn/lib:/usr/local/lib/python3.12/site-packages/nvidia/cublas/lib

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY worker/requirements.txt worker/requirements.txt
RUN pip install -r worker/requirements.txt

# Model layer stays above the code layers so a code change never re-downloads the weights.
COPY worker/__init__.py worker/settings.py worker/download_models.py worker/
RUN python -m worker.download_models \
    && HF_HUB_OFFLINE=1 python -m worker.download_models --verify

COPY whisper_core whisper_core
COPY worker worker

# HF_HUB_OFFLINE is read once at import, so the gated pyannote fetch runs in its own process first.
CMD ["sh", "-c", "python -m worker.fetch_pyannote && HF_HUB_OFFLINE=1 exec python -m worker.handler"]
