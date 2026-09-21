# Deploy your own

Three free-tier accounts and one pay-per-second GPU endpoint. Idle cost is $0: no active
workers, no network volume, no database.

## 1. Hugging Face token

1. Accept the license of [`pyannote/speaker-diarization-community-1`](https://huggingface.co/pyannote/speaker-diarization-community-1).
2. Create a read token. It is the `HF_TOKEN` of the worker.

The gated pyannote weights are never baked into the image. Each worker downloads them at start
with its own token, which keeps the image free to build from a public repository.

## 2. Cloudflare R2

1. Create a bucket.
2. Create an API token with **Object Read & Write** limited to that bucket. Note the account
   id, access key id and secret access key.
3. Apply the CORS policy from [`r2-cors.json`](r2-cors.json) with your web origin. Wildcard
   `AllowedHeaders` does not work on R2, so `content-type` is listed explicitly.

```bash
aws s3api put-bucket-cors \
  --bucket "$R2_BUCKET" \
  --cors-configuration file://docs/r2-cors.json \
  --endpoint-url "https://$R2_ACCOUNT_ID.r2.cloudflarestorage.com"
```

## 3. RunPod Serverless endpoint

1. Connect GitHub under **Settings → Connections**.
2. **Serverless → New Endpoint → Import Git Repository**, branch `main`, Dockerfile path
   `Dockerfile`. RunPod builds the image on its side, so the ~14 GB image is never pushed from
   your machine. A new GitHub release triggers a rebuild.
3. Endpoint settings:

| Setting | Value | Why |
|---|---|---|
| Endpoint type | Queue | jobs run for minutes, results land in R2 |
| GPU | 24 GB first, 16 GB as fallback | the 24 GB tier is about twice as fast for 19 % more per second |
| Active workers | 0 | nothing is billed while idle |
| Max workers | 1 | hard ceiling on spend |
| Idle timeout | 15 s | billed; long enough to chain a follow-up job |
| Execution timeout | 7200 s | a two-hour meeting with two passes fits |
| FlashBoot | on | free |
| Network volume | none | it would pin the endpoint to one data center and cost money while idle |

4. Environment variables: `HF_TOKEN`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`,
   `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`.
5. Set a spend limit on the RunPod account.

Smoke test, after uploading an audio file to `recordings/test-1/audio.m4a`:

```bash
curl -s "https://api.runpod.ai/v2/$RUNPOD_ENDPOINT_ID/run" \
  -H "Authorization: Bearer $RUNPOD_API_KEY" -H "Content-Type: application/json" \
  -d '{"input": {"task": "transcribe", "recording_id": "test-1",
       "audio_key": "recordings/test-1/audio.m4a",
       "passes": [{"language": "en"}], "min_speakers": 1, "max_speakers": 2}}'
```

The job is done when `recordings/test-1/jobs/<job id>.json` appears in the bucket.

## 4. Vercel

1. Import the repository, set **Root Directory** to `web`.
2. **Ignored Build Step**: `git diff --quiet HEAD^ HEAD -- .` so worker changes do not redeploy
   the site.
3. Environment variables: the four `R2_*` values, `RUNPOD_API_KEY`, `RUNPOD_ENDPOINT_ID`,
   `APP_PASSWORD`, `SESSION_SECRET` (32+ random bytes), `WEBHOOK_SECRET`, `APP_URL`
   (the production URL), optionally `NEXT_PUBLIC_REPO_URL`.

## 5. Run the web app locally

```bash
cd web
pnpm install
cp .env.example .env.local      # SESSION_SECRET needs 32+ characters
pnpm dev
```

Add `http://localhost:3000` to `AllowedOrigins` in the R2 CORS policy, otherwise the browser
upload fails. `/demo` works without any variables.

## 6. Run the worker locally

Any CUDA GPU with 8 GB works. Models download into `./models` on first use.

```bash
pip install -r worker/requirements.txt
cp .env.example .env            # fill in HF_TOKEN and the R2_* values
python -m worker.handler --rp_serve_api
curl -s localhost:8000/runsync -H "Content-Type: application/json" -d @docs/job.example.json
```

The local `/run` route is a stub that executes nothing, use `/runsync`.

## 7. Prove the image is self-contained

```bash
docker build -t whisper-worker .
docker run --name ww --env-file .env whisper-worker python -m worker.fetch_pyannote
docker commit ww whisper-worker:checked && docker rm ww
docker run --rm --gpus all --network none -e HF_HUB_OFFLINE=1 \
  whisper-worker:checked python -m worker.offline_check
```

The build itself already fails if Whisper, an alignment model or the NLTK sentence splitter
cannot be loaded offline. The last command adds pyannote and the GPU to that check, with the
network cut.
