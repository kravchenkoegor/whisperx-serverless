import { fileUrl } from "@/lib/api-client";
import { formatBytes } from "@/lib/format";
import type { FileKind, RecordingFile } from "@/lib/types";

type FileListProps = { files: RecordingFile[] };

const KIND_LABELS: Record<FileKind, string> = {
  audio: "audio",
  merged: "merged transcript",
  speakers: "speaker turns",
  text: "plain text",
  srt: "subtitles",
  json: "WhisperX result",
  diarization: "pyannote turns",
  cache: "merge cache",
  prompt: "prompt snapshot",
  meta: "metadata",
  other: "file",
};

export function FileList({ files }: FileListProps) {
  if (files.length === 0) return <p className="text-fg-muted">No files.</p>;
  return (
    <ul className="card divide-y divide-line p-0">
      {files.map((file) => (
        <li key={file.key} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2">
          <a href={fileUrl(file.key, true)} className="link break-all font-mono text-xs">
            {file.name}
          </a>
          <span className="hint">{KIND_LABELS[file.kind]}</span>
          <span className="hint ml-auto tabular-nums">{formatBytes(file.size)}</span>
        </li>
      ))}
    </ul>
  );
}
