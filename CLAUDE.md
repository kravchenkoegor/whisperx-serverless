# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Transcription of meeting/voice-memo recordings with WhisperX (faster-whisper backend) + pyannote
speaker diarization. It runs two ways from one code base:

- **locally** on a CUDA GPU: standalone scripts, no CLI args, configured by editing the `CONFIG`
  block at the top of the script;
- **in the cloud**: a RunPod Serverless worker (`worker/`) that reads audio from Cloudflare R2 and
  writes transcripts back, driven by a Next.js app on Vercel (`web/`). No database, $0 while idle.

**The repository is public.** Never commit `archive/`, `source/`, `prompts/private/` or `.env`, and
keep real names, clients and ticket ids out of code, docs, tests and example prompts.

## Running

Python dependencies live in `.venv` (Python 3.12, whisperx 3.8, torch 2.8 CUDA, pyannote-audio 4,
ctranslate2); `worker/requirements.txt` pins the same versions for the image. Always use the venv
interpreter:

```bash
.venv/bin/python transcribe.py     # transcribe the file(s) listed in INPUTS
.venv/bin/python merge_ru_en.py    # merge a paired RU + EN transcription of a mixed-language meeting
.venv/bin/python merge.py          # legacy, local only: merge a paired EN + KO transcription
.venv/bin/python -m worker.handler --rp_serve_api   # local worker, POST to localhost:8000/runsync
HF_HUB_OFFLINE=1 .venv/bin/python -m worker.offline_check   # every model loads without network
```

`pytest` and `ruff` are not installed in `.venv` (CI installs them; the tests need neither torch
nor a GPU). `runpod` and `boto3` are needed for the local worker: `pip install runpod boto3`.

To change what gets transcribed locally, edit the `CONFIG` block in [transcribe.py](transcribe.py):
`INPUTS`, `LANGUAGE` (always set explicitly, autodetect misfires), `PROMPT_FILE`, `DIARIZE`,
`MIN_SPEAKERS`/`MAX_SPEAKERS`, `BATCH_SIZE`. There are no flags.

## Architecture

### `whisper_core/` — the pipeline as a library
No module globals, no `CONFIG`, heavy imports (torch, whisperx, faster_whisper) are lazy so the
merge logic and the tests import without them.

- `models.py` — `Models` holds one CT2 Whisper model per process, alignment models per language
  and the diarization pipeline. `pipeline(language, prompt)` rebuilds the cheap WhisperX wrapper
  around the cached CT2 model, because language and `initial_prompt` are fixed at `load_model`.
  `keep_loaded=False` (local 8 GB) frees align/diarization models after each use; the worker keeps
  them resident on cards with 14 GB or more. `ASR_OPTIONS` there is deliberate and load-bearing, do
  not "clean it up": `condition_on_previous_text=False` (prevents Whisper's repetition cascade) and
  `no_speech_threshold=0.3` (meetings have pauses; VAD handles real silence).
- `transcribe.py` — `run_transcription(audio, out_dir, stem, params, models=, diarization=)`:
  transcribe → align → diarize → write. Align and diarize failures degrade gracefully (no timings /
  no speaker labels) and are reported in `PassResult.warnings`. Diarization depends on the audio,
  not the language: pass the `PassResult.diarization` of one pass into the next, or rebuild it
  from a `.diarization.json` with `diarization_frame`.
- `merge_ru_en.py` — `merge_ru_en(...)`, thresholds in the frozen `RuEnConfig`, per-call state in
  `_Context`. Raises `FileNotFoundError`/`ValueError`, never `SystemExit` (it would kill a worker).
- `text.py` — `fmt_srt_ts` (`HH:MM:SS,mmm`), `fmt_ts` (`HH:MM:SS`), `segment_speaker` (majority
  vote over word-level speakers), `collapse_repeats` (kills repetition loops).

Per pass it writes `<stem>.<lang>.txt` (plain), `.srt` (`[SPEAKER_xx]` prefix when diarized),
`.json` (full WhisperX result, the source of truth the merges consume), and, only when diarized,
`.speakers.txt` (turns grouped by speaker) and `.diarization.json` (raw pyannote turns).

### RU/EN reconciliation (`whisper_core/merge_ru_en.py`)
For mixed RU/EN meetings: a `ru` pass plus an `en` pass. The forced language does not fix the
output language: WhisperX decodes ~30 s chunks and a chunk keeps the language it started in, so
English inside a Russian-started chunk comes out *translated* in both passes (and vice versa). The
merge works per speaker turn instead: units are the pyannote turns; language = confident Whisper
language ID on the unit's audio → otherwise the alphabet a pass wrote (Cyrillic in the EN pass =
Russian heard, Latin in the RU pass = English) → speaker's usual language → nearest confident
unit. Text comes from whichever pass wrote the unit in its language's alphabet; units translated
in both passes are re-transcribed alone with the right language. Language ID and re-transcriptions
are cached (`<stem>.lid.json`, `<stem>.redecode.json`), so re-running with new thresholds needs no
GPU. Deterministic (greedy decoding, argmax). The redecode cache key does not include the prompt:
delete the cache after editing the prompt.

### `merge.py` — legacy EN/KO reconciliation, local only
Pure deterministic rules, no model. Not part of the cloud pipeline (only `ru` and `en` alignment
models are baked). Its default `PROMPT_FILE` points at `prompts/korean_meeting.txt`, which does not
exist: point it at a real prompt before running.

### `worker/` — RunPod Serverless
- `handler.py` — one job = every language pass of a recording plus the optional merge on one warm
  worker. Validates input (`jobs.py`), downloads audio from R2, uploads outputs after each pass,
  then writes the immutable status document `recordings/<id>/jobs/<job_id>.json` **last** (commit
  marker; holds per-stage timings, GPU, warnings). Batch size defaults by VRAM.
- `jobs.py` — pure validation, tested without GPU. Languages are limited to `ru` and `en`: other
  languages have no baked alignment model, and the torchaudio-based ones would download silently.
- `download_models.py` — image build: bakes Whisper CT2, the RU aligner (HF hub cache), the EN
  aligner (torchaudio bundle via torch hub, ignores `HF_HUB_OFFLINE`) and NLTK `punkt_tab`, then
  `--verify` reloads everything offline so an incomplete bake fails the build.
- `fetch_pyannote.py` — the gated pyannote model is fetched at container start with the runtime
  `HF_TOKEN`. `HF_HUB_OFFLINE` is read once at `huggingface_hub` import, hence the two-process
  `CMD` in the `Dockerfile`.
- Adding a language = one entry in `worker/settings.py` + rebuild the image.

### `web/` — Next.js on Vercel
Upload via presigned PUT straight to R2 (RunPod `/run` payloads are capped at 10 MB), run form,
transcript viewer, prompt library with a Whisper token counter, public read-only `/demo`. Password
session cookie; state lives only in R2 (`meta.json`, `pending/<job_id>.json`, `jobs/<job_id>.json`).
Its zod schema mirrors `worker/jobs.py`: change both together.

### Models, tokens, prompts
- **`./models`** holds all weights locally (`/models` in the image). `HF_HOME`/`TORCH_HOME` are set
  to it *before* importing torch/whisperx so nothing downloads into `~/.cache`. Gitignored.
- **`.env`** holds `HF_TOKEN` and the `R2_*` values (tiny built-in `load_dotenv`, no dependency).
- **`prompts/*.txt`** are `initial_prompt` files: a paragraph priming names/jargon/spelling for a
  specific recording. This is the biggest accuracy lever. Committed prompts are anonymized
  examples; real ones live in gitignored `prompts/private/`.
  - **Keep a prompt within 223 Whisper tokens.** faster-whisper keeps only the *last* 223 tokens
    (`faster_whisper/transcribe.py`, `previous_tokens[-(max_length // 2 - 1):]`) and silently drops
    the beginning. Russian costs ~2.8 tokens per word, so a Russian paragraph of ~1.2 KB is already
    over. Count with the model's own `tokenizer.json`
    (`models/models--Systran--faster-whisper-large-v3/snapshots/*/`).
  - **Write the prompt as speech, not as a keyword list.** Whisper echoes a list-shaped prompt
    verbatim at the start of the transcript ("Участники, бэкенд, мобильное приложение, дашборд…").
    A few natural sentences with names in the forms people actually use when they speak, and
    English terms spelled in Latin, prime spelling without the echo.

### Data layout
- `source/<topic>/` — local input audio + its generated transcripts. Gitignored.
- `archive/` — older recordings and their outputs. Gitignored; `tests/test_private_regression.py`
  replays the archived merges byte for byte when the folder is present.
- R2: `recordings/<id>/…` and `prompts/<name>.txt`, see `README.md`.

## Conventions
- GPU-first: code assumes CUDA; on an 8 GB card `BATCH_SIZE` must stay low (4, drop to 2 on OOM).
  CPU fallback works but is very slow and forces `int8`.
- Output filenames always carry the language: `<stem>.<lang>.<ext>`.
- After touching `whisper_core/merge_ru_en.py`, run the tests: the synthetic fixture and the
  private regression must stay byte-identical.
