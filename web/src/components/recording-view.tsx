"use client";

import { useCallback, useEffect, useState } from "react";
import { apiRequest } from "@/lib/api-client";
import { describeError, formatBytes, formatUtc } from "@/lib/format";
import type { RecordingOutputs } from "@/lib/run-config";
import { transcriptTabs } from "@/lib/transcripts";
import type { RecordingDetail } from "@/lib/types";
import { AddPassForm } from "./add-pass-form";
import { DeleteRecording } from "./delete-recording";
import { FileList } from "./file-list";
import { JobCard } from "./job-card";
import { MergeForm } from "./merge-form";
import { PendingJobCard } from "./pending-job-card";
import { TranscriptViewer } from "./transcript-viewer";

type RecordingViewProps = { initial: RecordingDetail; promptNames: string[] };

const REFRESH_INTERVAL_MS = 5000;

function outputsOf(detail: RecordingDetail): RecordingOutputs {
  return {
    languages: detail.languages,
    hasDiarization: detail.files.some((file) => file.kind === "diarization"),
  };
}

export function RecordingView({ initial, promptNames }: RecordingViewProps) {
  const [detail, setDetail] = useState(initial);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const recordingId = initial.id;

  const refresh = useCallback(async () => {
    try {
      setDetail(await apiRequest<RecordingDetail>(`/api/recordings/${recordingId}`));
      setRefreshError(null);
    } catch (caught) {
      setRefreshError(describeError(caught));
    }
  }, [recordingId]);

  const hasPending = detail.pending.length > 0;
  useEffect(() => {
    if (!hasPending) return;
    const timer = setInterval(() => void refresh(), REFRESH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [hasPending, refresh]);

  const outputs = outputsOf(detail);
  const target = detail.audioKey ? { recordingId, audioKey: detail.audioKey } : null;
  const meta = detail.meta;

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="mr-2">{meta?.title ?? recordingId}</h1>
          {detail.languages.map((language) => (
            <span key={language} className="badge badge-accent uppercase">
              {language}
            </span>
          ))}
          {detail.merged && <span className="badge badge-ok">merged</span>}
        </div>
        <p className="hint break-all">
          <span className="font-mono">{recordingId}</span>
          {meta && ` · ${formatUtc(meta.created_at)} · ${meta.original_filename} · ${formatBytes(meta.size)} · ${meta.content_type}`}
        </p>
        {refreshError && (
          <p role="alert" className="notice notice-danger">
            Could not refresh: {refreshError}
          </p>
        )}
        {!target && (
          <p className="notice notice-warn">
            The audio file was never uploaded, so this recording cannot be transcribed. Delete it and start again.
          </p>
        )}
      </header>

      <section aria-labelledby="jobs-heading" className="space-y-3">
        <h2 id="jobs-heading">Jobs</h2>
        {detail.pending.length === 0 && detail.jobs.length === 0 && <p className="text-fg-muted">No jobs yet.</p>}
        {detail.pending.map((marker) => (
          <PendingJobCard key={marker.job_id} recordingId={recordingId} marker={marker} onChanged={refresh} />
        ))}
        {detail.jobs.map((job) => (
          <JobCard key={job.job_id} job={job} />
        ))}
      </section>

      <section aria-labelledby="transcripts-heading" className="space-y-3">
        <h2 id="transcripts-heading">Transcripts</h2>
        <TranscriptViewer tabs={transcriptTabs(detail.files)} />
        <details>
          <summary className="font-semibold">All files ({detail.files.length})</summary>
          <div className="mt-3">
            <FileList files={detail.files} />
          </div>
        </details>
      </section>

      <section aria-labelledby="actions-heading" className="space-y-3">
        <h2 id="actions-heading">Actions</h2>
        {target && (
          <>
            <details className="rounded-lg border border-line p-4">
              <summary className="font-semibold">Add pass</summary>
              <div className="mt-4">
                <AddPassForm target={target} outputs={outputs} promptNames={promptNames} onSubmitted={refresh} />
              </div>
            </details>
            <details className="rounded-lg border border-line p-4">
              <summary className="font-semibold">{detail.merged ? "Re-merge RU+EN" : "Merge RU+EN"}</summary>
              <div className="mt-4">
                <MergeForm
                  target={target}
                  outputs={outputs}
                  merged={detail.merged}
                  promptNames={promptNames}
                  onSubmitted={refresh}
                />
              </div>
            </details>
          </>
        )}
        <details className="rounded-lg border border-line p-4">
          <summary className="font-semibold text-danger">Delete recording</summary>
          <div className="mt-4">
            <DeleteRecording recordingId={recordingId} />
          </div>
        </details>
      </section>
    </div>
  );
}
