"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { apiRequest } from "@/lib/api-client";
import { describeError, formatBytes } from "@/lib/format";
import { mediaContentType, titleFromFilename } from "@/lib/media";
import {
  type RecordingOutputs,
  buildTranscribeJob,
  initialRunState,
  runStateProblem,
} from "@/lib/run-config";
import { MAX_UPLOAD_BYTES } from "@/lib/limits";
import { uploadWithProgress } from "@/lib/upload";
import { RunFields } from "./run-fields";

type NewRecordingFormProps = { promptNames: string[] };
type Phase = "idle" | "creating" | "uploading" | "submitting";
type CreatedRecording = { id: string; audioKey: string; uploadUrl: string };
type Failure = { message: string; recordingId: string | null };

const NO_OUTPUTS: RecordingOutputs = { languages: [], hasDiarization: false };

const PHASE_LABELS: Record<Phase, string> = {
  idle: "Upload and transcribe",
  creating: "Creating the recording…",
  uploading: "Uploading…",
  submitting: "Submitting the job…",
};

function fileProblem(file: File | null): string | null {
  if (!file) return "Choose an audio or video file";
  if (file.size > MAX_UPLOAD_BYTES) return "The file is larger than 2 GB";
  if (!mediaContentType(file)) return "Only audio and video files are accepted";
  return null;
}

export function NewRecordingForm({ promptNames }: NewRecordingFormProps) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [run, setRun] = useState(() => initialRunState(["ru"]));
  const [phase, setPhase] = useState<Phase>("idle");
  const [uploaded, setUploaded] = useState(0);
  const [failure, setFailure] = useState<Failure | null>(null);

  const busy = phase !== "idle";

  function chooseFile(chosen: File | null) {
    setFile(chosen);
    if (chosen && !title.trim()) setTitle(titleFromFilename(chosen.name));
  }

  async function discard(recordingId: string) {
    await apiRequest(`/api/recordings/${recordingId}`, "DELETE").catch(() => null);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const problem = fileProblem(file) ?? (title.trim() ? null : "Give the recording a title") ?? runStateProblem(run, NO_OUTPUTS);
    const contentType = file ? mediaContentType(file) : null;
    if (problem || !file || !contentType) {
      setFailure({ message: problem ?? "Choose an audio or video file", recordingId: null });
      return;
    }

    setFailure(null);
    setUploaded(0);
    let created: CreatedRecording | null = null;
    let audioStored = false;
    try {
      setPhase("creating");
      created = await apiRequest<CreatedRecording>("/api/recordings", "POST", {
        title: title.trim(),
        filename: file.name,
        contentType,
        size: file.size,
      });

      setPhase("uploading");
      await uploadWithProgress(created.uploadUrl, file, contentType, setUploaded);
      audioStored = true;

      setPhase("submitting");
      const built = buildTranscribeJob(run, { recordingId: created.id, audioKey: created.audioKey }, NO_OUTPUTS);
      if (!built.ok) throw new Error(built.error);
      await apiRequest("/api/jobs", "POST", built.job);
      router.push(`/r/${created.id}`);
    } catch (caught) {
      if (created && !audioStored) await discard(created.id);
      setFailure({ message: describeError(caught), recordingId: created && audioStored ? created.id : null });
      setPhase("idle");
    }
  }

  const percent = Math.round(uploaded * 100);

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <div className="card grid gap-4 md:grid-cols-2">
        <div>
          <label htmlFor="recording-file" className="label">
            Audio or video file (up to 2 GB)
          </label>
          <input
            id="recording-file"
            type="file"
            accept="audio/*,video/*,.m4a,.mp3,.wav,.ogg,.opus,.flac,.aac,.webm,.mp4,.mov,.mkv"
            className="input"
            disabled={busy}
            onChange={(event) => chooseFile(event.target.files?.[0] ?? null)}
          />
          {file && <p className="hint mt-1">{formatBytes(file.size)}</p>}
        </div>
        <div>
          <label htmlFor="recording-title" className="label">
            Title
          </label>
          <input
            id="recording-title"
            type="text"
            maxLength={200}
            className="input"
            disabled={busy}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
          <p className="hint mt-1">Becomes part of the recording id.</p>
        </div>
      </div>

      <RunFields
        idPrefix="new"
        state={run}
        onChange={setRun}
        promptNames={promptNames}
        outputs={NO_OUTPUTS}
        disabled={busy}
      />

      <div aria-live="polite" className="space-y-2">
        {phase === "uploading" && (
          <div>
            <progress className="h-2 w-full" value={uploaded} max={1} aria-label="Upload progress" />
            <p className="hint">Uploaded {percent}%</p>
          </div>
        )}
        {failure && (
          <div role="alert" className="notice notice-danger">
            <p>{failure.message}</p>
            {failure.recordingId && (
              <p className="mt-1">
                The audio is stored. Start the job again from{" "}
                <Link href={`/r/${failure.recordingId}`} className="underline">
                  the recording page
                </Link>
                .
              </p>
            )}
          </div>
        )}
      </div>

      <button type="submit" className="btn btn-primary" disabled={busy}>
        {PHASE_LABELS[phase]}
      </button>
    </form>
  );
}
