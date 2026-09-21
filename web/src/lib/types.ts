import type { Language } from "./ids";
import type { JobDocument, PendingMarker, RecordingMeta } from "./schemas";

export type FileKind =
  | "audio"
  | "merged"
  | "speakers"
  | "text"
  | "srt"
  | "json"
  | "diarization"
  | "cache"
  | "prompt"
  | "meta"
  | "other";

export type RecordingFile = {
  key: string;
  name: string;
  size: number;
  kind: FileKind;
  language: Language | null;
  updatedAt: string | null;
};

export type RecordingSummary = {
  id: string;
  title: string;
  createdAt: string | null;
  languages: Language[];
  merged: boolean;
  hasAudio: boolean;
  pendingJobs: number;
};

export type RecordingDetail = {
  id: string;
  meta: RecordingMeta | null;
  audioKey: string | null;
  languages: Language[];
  merged: boolean;
  files: RecordingFile[];
  jobs: JobDocument[];
  pending: PendingMarker[];
};

export type PromptSummary = {
  name: string;
  size: number;
  updatedAt: string | null;
};
