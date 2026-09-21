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
2. **Serverless → New Endpoint → Import Git Repository**, branch `deploy`, Dockerfile path
   `Dockerfile`. RunPod builds the image on its side, so the ~14 GB image is never pushed from
   your machine.

   RunPod rebuilds the image and replaces the workers on **every push to the tracked branch**,
   including commits that only touch `web/` or the docs. Replaced workers pull the image again
   on their hosts, and the next job waits for that. Tracking a dedicated `deploy` branch keeps
   day-to-day pushes to `main` away from the workers. Release a new worker version with:

   ```bash
   git push origin main:deploy
   ```
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

1. Import the repository, set **Root Directory** to `web`. The framework preset is Next.js and
   Node 24 comes from `engines` in `web/package.json`.
2. Environment variables, **Production** scope only, so preview builds of other branches never
   see a secret: the four `R2_*` values, `RUNPOD_API_KEY`, `RUNPOD_ENDPOINT_ID`, `APP_PASSWORD`,
   `SESSION_SECRET` (32+ characters), `WEBHOOK_SECRET`, optionally `NEXT_PUBLIC_REPO_URL`.
   Do **not** set `ENABLE_EXPERIMENTAL_COREPACK`, and leave the Install Command override off.
   With a Root Directory, Vercel fails to enable Corepack ("package.json is missing
   packageManager", although `web/package.json` has it) and then installs with its oldest
   pnpm, which breaks on Node 24 with `ERR_INVALID_THIS`. Without the flag Vercel picks pnpm by
   the lockfile version, and that pnpm switches to the version pinned in `packageManager`.
3. `APP_URL` can stay empty: the webhook URL falls back to `VERCEL_PROJECT_PRODUCTION_URL`.
   Set it when you attach a custom domain.
4. **Settings → Git → Ignored Build Step**, custom command. It skips every branch except `main`
   and skips `main` when nothing under `web/` changed since the last deployment:

   ```bash
   if [ "$VERCEL_GIT_COMMIT_REF" != "main" ]; then exit 0; fi; git diff --quiet "${VERCEL_GIT_PREVIOUS_SHA:-HEAD^}" HEAD -- .
   ```

5. Add the production origin, for example `https://your-app.vercel.app`, to `AllowedOrigins` of
   the R2 CORS policy. Browser uploads fail without it.

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
