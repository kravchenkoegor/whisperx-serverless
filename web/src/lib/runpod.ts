import { z } from "zod";
import { env } from "./env";
import { type JobInput, type RunpodStatus, runpodStatusSchema } from "./schemas";

const API_BASE = "https://api.runpod.ai/v2";
const REQUEST_TIMEOUT_MS = 20_000;

const submitResponseSchema = z.object({ id: z.string(), status: z.string().optional() });

export class RunpodError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "RunpodError";
  }
}

async function call(path: string, method: "GET" | "POST", body?: unknown): Promise<unknown> {
  const response = await fetch(`${API_BASE}/${env.runpodEndpointId()}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${env.runpodApiKey()}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new RunpodError(response.status, `RunPod answered ${response.status}: ${text.slice(0, 300)}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new RunpodError(502, "RunPod returned a response that is not JSON");
  }
}

function webhookUrl(recordingId: string): string | null {
  const base = env.appUrl();
  const secret = env.webhookSecret();
  if (!base || !secret) return null;
  const url = new URL("/api/webhook/runpod", base);
  url.searchParams.set("token", secret);
  url.searchParams.set("recording", recordingId);
  return url.toString();
}

function workerInput(job: JobInput): Record<string, unknown> {
  const { task, recording_id, audio_key, diarize, min_speakers, max_speakers, reuse_diarization, batch_size } = job;
  const shared = { task, recording_id, audio_key, diarize, min_speakers, max_speakers, reuse_diarization, batch_size };
  if (job.task === "merge_ru_en") return { ...shared, merge: job.merge };
  return { ...shared, passes: job.passes, merge: job.merge };
}

export async function submitJob(job: JobInput): Promise<string> {
  const webhook = webhookUrl(job.recording_id);
  const payload = webhook ? { input: workerInput(job), webhook } : { input: workerInput(job) };
  const parsed = submitResponseSchema.safeParse(await call("/run", "POST", payload));
  if (!parsed.success) throw new RunpodError(502, "RunPod did not return a job id");
  return parsed.data.id;
}

function parseStatus(raw: unknown): RunpodStatus {
  const parsed = runpodStatusSchema.safeParse(raw);
  if (!parsed.success) throw new RunpodError(502, "RunPod returned an unexpected status payload");
  return parsed.data;
}

export async function getJobStatus(jobId: string): Promise<RunpodStatus> {
  return parseStatus(await call(`/status/${jobId}`, "GET"));
}

export async function cancelJob(jobId: string): Promise<RunpodStatus> {
  return parseStatus(await call(`/cancel/${jobId}`, "POST"));
}
