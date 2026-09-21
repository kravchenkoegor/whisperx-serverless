import { HttpError } from "./http";
import {
  LANGUAGES,
  type Language,
  diarizationKey,
  isAudioKeyFor,
  isJobId,
  passJsonKey,
  pendingKey,
} from "./ids";
import { objectExists, putObjectJson } from "./r2";
import { RunpodError, submitJob } from "./runpod";
import type { JobInput, PendingMarker } from "./schemas";

function languagesOf(job: JobInput): Language[] {
  return job.task === "transcribe" ? job.passes.map((pass) => pass.language) : [];
}

async function assertDiarizationAvailable(job: JobInput): Promise<void> {
  if (job.task === "transcribe" && job.diarize) return;
  const stored = await Promise.all(
    LANGUAGES.map((language) => objectExists(diarizationKey(job.recording_id, language))),
  );
  if (!stored.some(Boolean)) {
    throw new HttpError(409, "Merging needs speaker turns; run a pass with diarization enabled first");
  }
}

async function assertMergeInputsExist(job: JobInput): Promise<void> {
  if (!job.merge) return;
  const produced = new Set(languagesOf(job));
  const needed = LANGUAGES.filter((language) => !produced.has(language));
  const present = await Promise.all(
    needed.map((language) => objectExists(passJsonKey(job.recording_id, language))),
  );
  const missing = needed.filter((_, index) => !present[index]);
  if (missing.length > 0) {
    throw new HttpError(409, `Merging needs both passes; missing: ${missing.join(", ")}`);
  }
  await assertDiarizationAvailable(job);
}

export async function submitRecordingJob(job: JobInput): Promise<string> {
  if (!isAudioKeyFor(job.recording_id, job.audio_key)) {
    throw new HttpError(400, "audio_key does not belong to this recording");
  }
  if (!(await objectExists(job.audio_key))) {
    throw new HttpError(409, "The audio file has not been uploaded yet");
  }
  await assertMergeInputsExist(job);

  const jobId = await submitJob(job);
  if (!isJobId(jobId)) throw new RunpodError(502, "RunPod returned a job id in an unexpected format");

  const marker: PendingMarker = {
    job_id: jobId,
    task: job.task,
    submitted_at: new Date().toISOString(),
    languages: languagesOf(job),
    merge: job.merge !== null,
  };
  await putObjectJson(pendingKey(job.recording_id, jobId), marker);
  return jobId;
}
