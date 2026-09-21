import Link from "next/link";
import { ErrorState } from "@/components/error-state";
import { requirePageSession } from "@/lib/auth";
import { formatUtc } from "@/lib/format";
import { load } from "@/lib/load";
import { listRecordings } from "@/lib/recordings";
import type { RecordingSummary } from "@/lib/types";

export const dynamic = "force-dynamic";

function RecordingRow({ recording }: { recording: RecordingSummary }) {
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
      <div className="min-w-0 flex-1 basis-64">
        <Link href={`/r/${recording.id}`} className="link font-medium">
          {recording.title}
        </Link>
        <p className="hint break-all">
          {formatUtc(recording.createdAt)} · <span className="font-mono">{recording.id}</span>
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {recording.pendingJobs > 0 && (
          <span className="badge badge-accent">
            <span aria-hidden="true" className="mr-1.5 inline-block size-1.5 animate-pulse rounded-full bg-accent motion-reduce:animate-none" />
            running
          </span>
        )}
        {recording.languages.map((language) => (
          <span key={language} className="badge uppercase">
            {language}
          </span>
        ))}
        {recording.merged && <span className="badge badge-ok">merged</span>}
        {!recording.hasAudio && <span className="badge badge-warn">no audio</span>}
      </div>
    </li>
  );
}

export default async function RecordingsPage() {
  await requirePageSession("/");
  const recordings = await load(listRecordings);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h1>Recordings</h1>
        <Link href="/new" className="btn btn-primary">
          New recording
        </Link>
      </div>
      {!recordings.ok && <ErrorState title="Could not load recordings" message={recordings.error} />}
      {recordings.ok && recordings.data.length === 0 && (
        <p className="card text-fg-muted">No recordings yet. Upload the first one.</p>
      )}
      {recordings.ok && recordings.data.length > 0 && (
        <ul className="card divide-y divide-line p-0">
          {recordings.data.map((recording) => (
            <RecordingRow key={recording.id} recording={recording} />
          ))}
        </ul>
      )}
    </div>
  );
}
