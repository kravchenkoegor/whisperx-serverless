"use client";

import { useEffect, useState } from "react";
import { ApiError, apiRequest } from "@/lib/api-client";
import { describeError, formatUtc } from "@/lib/format";
import { isTerminalRunpodStatus } from "@/lib/limits";
import type { PendingMarker, RunpodStatus } from "@/lib/schemas";

type PendingJobCardProps = { recordingId: string; marker: PendingMarker; onChanged: () => void };
type Step = { position: number; total: number };
type JobProgress = { stage: string; language: string | null; index: number | null; of: number | null };

const POLL_INTERVAL_MS = 5000;
const PASS_STAGES = ["load", "transcribe", "align", "diarize"];

const STATUS_LABELS: Record<string, string> = {
  IN_QUEUE: "In queue — waiting for a GPU worker",
  IN_PROGRESS: "Running",
  COMPLETED: "Completed — waiting for the status document",
  FAILED: "Failed on RunPod",
  CANCELLED: "Cancelled",
  TIMED_OUT: "Timed out",
};

function optionalNumber(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

function progressOf(status: RunpodStatus | null): JobProgress | null {
  if (status?.status !== "IN_PROGRESS") return null;
  const output: unknown = status.output;
  if (typeof output !== "object" || output === null) return null;
  if (!("stage" in output) || typeof output.stage !== "string") return null;
  return {
    stage: output.stage,
    language: "language" in output && typeof output.language === "string" ? output.language : null,
    index: "index" in output ? optionalNumber(output.index) : null,
    of: "of" in output ? optionalNumber(output.of) : null,
  };
}

function stepOf(progress: JobProgress, marker: PendingMarker): Step | null {
  const passes = progress.of ?? marker.languages.length;
  const total = 1 + passes * PASS_STAGES.length + (marker.merge ? 1 : 0);
  if (progress.stage === "download") return { position: 1, total };
  if (progress.stage === "merge") return { position: total, total };
  const stage = PASS_STAGES.indexOf(progress.stage);
  if (stage < 0) return null;
  const pass = Math.max(0, (progress.index ?? 1) - 1);
  return { position: 2 + pass * PASS_STAGES.length + stage, total };
}

function describeProgress(progress: JobProgress): string {
  const language = progress.language ? ` · ${progress.language.toUpperCase()}` : "";
  const pass = progress.index && progress.of ? ` · pass ${progress.index} of ${progress.of}` : "";
  return `Stage: ${progress.stage}${language}${pass}`;
}

function describeTask(marker: PendingMarker): string {
  if (marker.task === "merge_ru_en") return "Merge RU+EN";
  const languages = marker.languages.map((language) => language.toUpperCase()).join(" + ");
  return `Transcribe ${languages}${marker.merge ? " + merge" : ""}`;
}

export function PendingJobCard({ recordingId, marker, onChanged }: PendingJobCardProps) {
  const [status, setStatus] = useState<RunpodStatus | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);
  const [unknownToRunpod, setUnknownToRunpod] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const terminal = status !== null && isTerminalRunpodStatus(status.status);
  const stopped = terminal || unknownToRunpod;

  useEffect(() => {
    if (stopped) return;
    let active = true;
    async function poll() {
      try {
        const next = await apiRequest<RunpodStatus>(`/api/jobs/${marker.job_id}`);
        if (!active) return;
        setStatus(next);
        setPollError(null);
        if (isTerminalRunpodStatus(next.status)) onChanged();
      } catch (caught) {
        if (!active) return;
        setPollError(describeError(caught));
        if (caught instanceof ApiError && caught.status === 404) setUnknownToRunpod(true);
      }
    }
    void poll();
    const timer = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [marker.job_id, onChanged, stopped]);

  async function dismiss() {
    await apiRequest(`/api/recordings/${recordingId}/pending/${marker.job_id}`, "DELETE");
    onChanged();
  }

  async function act(action: () => Promise<void>) {
    setBusy(true);
    setActionError(null);
    try {
      await action();
    } catch (caught) {
      setActionError(describeError(caught));
      setBusy(false);
    }
  }

  async function cancel() {
    await apiRequest(`/api/jobs/${marker.job_id}/cancel`, "POST");
    await dismiss();
  }

  const progress = progressOf(status);
  const step = progress ? stepOf(progress, marker) : null;
  const statusLabel = status ? (STATUS_LABELS[status.status] ?? status.status) : "Checking status…";

  return (
    <article className="card space-y-3">
      <header className="flex flex-wrap items-center gap-2">
        <span className={`badge ${stopped ? "badge-warn" : "badge-accent"}`}>
          {!stopped && <span aria-hidden="true" className="mr-1.5 inline-block size-1.5 animate-pulse rounded-full bg-accent motion-reduce:animate-none" />}
          {stopped ? "stale" : "running"}
        </span>
        <h3>{describeTask(marker)}</h3>
        <span className="hint break-all font-mono">{marker.job_id}</span>
        <span className="hint ml-auto">submitted {formatUtc(marker.submitted_at)}</span>
      </header>

      <div aria-live="polite" className="space-y-2">
        <p>{unknownToRunpod ? "RunPod no longer knows this job." : statusLabel}</p>
        {progress && <p className="text-fg-muted">{describeProgress(progress)}</p>}
        {step && (
          <div>
            <progress
              className="h-2 w-full"
              value={step.position}
              max={step.total}
              aria-label="Job progress"
            />
            <p className="hint">
              Step {step.position} of {step.total}
            </p>
          </div>
        )}
        {pollError && !unknownToRunpod && <p className="text-sm text-danger">Status check failed: {pollError}</p>}
      </div>

      {stopped && (
        <p className="hint">
          The worker has not written a status document for this job. If it does not appear, dismiss this entry.
        </p>
      )}
      {actionError && (
        <p role="alert" className="text-sm text-danger">
          {actionError}
        </p>
      )}

      <div className="flex gap-2">
        {stopped ? (
          <button type="button" className="btn" disabled={busy} onClick={() => act(dismiss)}>
            Dismiss
          </button>
        ) : (
          <button type="button" className="btn" disabled={busy} onClick={() => act(cancel)}>
            Cancel job
          </button>
        )}
      </div>
    </article>
  );
}
