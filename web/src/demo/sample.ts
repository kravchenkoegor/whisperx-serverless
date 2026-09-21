import { readFileSync } from "node:fs";
import path from "node:path";
import { formatClock } from "@/lib/format";
import type { JobDocument } from "@/lib/schemas";
import type { TranscriptTab } from "@/lib/transcripts";
import enPass from "./sample/meeting.en.json";
import speakerTurns from "./sample/meeting.ru.diarization.json";
import ruPass from "./sample/meeting.ru.json";

type Segment = { start: number; text: string };
type SpeakerTurn = { start: number; end: number; speaker: string };

function passText(segments: Segment[]): string {
  return segments
    .filter((segment) => segment.text.trim())
    .map((segment) => `[${formatClock(segment.start)}] ${segment.text.trim()}`)
    .join("\n");
}

function turnsText(turns: SpeakerTurn[]): string {
  return turns
    .map((turn) => `[${formatClock(turn.start)} – ${formatClock(turn.end)}] ${turn.speaker}`)
    .join("\n");
}

function mergedText(): string {
  return readFileSync(path.join(process.cwd(), "src/demo/sample/expected.merged.txt"), "utf8");
}

export function sampleTranscriptTabs(): TranscriptTab[] {
  return [
    { id: "merged", label: "Merged", source: { kind: "inline", text: mergedText() } },
    { id: "ru", label: "RU pass", source: { kind: "inline", text: passText(ruPass.segments) } },
    { id: "en", label: "EN pass", source: { kind: "inline", text: passText(enPass.segments) } },
    { id: "turns", label: "Speaker turns", source: { kind: "inline", text: turnsText(speakerTurns) } },
  ];
}

export const SAMPLE_JOB: JobDocument = {
  job_id: "sample-0001-u1",
  status: "completed",
  task: "transcribe",
  recording_id: "260921-153000-sprint-sync",
  started_at: "2026-09-21T15:30:12Z",
  finished_at: "2026-09-21T15:31:02Z",
  total_seconds: 49.6,
  gpu: { name: "NVIDIA RTX A5000", vram_gb: 24.0 },
  worker: { boot_seconds: 21.4, jobs_served_before: 0, models_kept_loaded: true, offline: true },
  passes: [
    {
      language: "ru",
      aligned: true,
      diarized: true,
      batch_size: 16,
      timings: { load: 9.1, transcribe: 6.4, align: 3.9, diarize: 7.2 },
    },
    {
      language: "en",
      aligned: true,
      diarized: true,
      batch_size: 16,
      timings: { load: 0.2, transcribe: 5.8, align: 3.1, diarize: 0.1 },
    },
  ],
  merge: {
    units: 8,
    turns: 6,
    langs: { RU: 3, EN: 5 },
    rules: { lid: 5, speaker: 1, script: 1, neighbor: 1 },
    sources: { en: 4, ru: 3, redecode: 1 },
    speaker_en_shares: { SPEAKER_00: 0, SPEAKER_01: 1, SPEAKER_02: 0.5 },
    lid_computed: 8,
    redecoded: 1,
  },
  timings: { download: 2.1, decode: 0.6, upload_ru: 1.2, upload_en: 1.1, merge: 8.4 },
  warnings: [],
  files: [],
};
