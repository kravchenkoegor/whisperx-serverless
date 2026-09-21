import type { Language } from "./ids";
import type { FileKind, RecordingFile } from "./types";

export type TranscriptSource = { kind: "remote"; key: string; version: string } | { kind: "inline"; text: string };
export type TranscriptTab = { id: string; label: string; source: TranscriptSource };

type TabSlot = { kind: FileKind; language: Language | null; label: string };

const TAB_ORDER: TabSlot[] = [
  { kind: "merged", language: null, label: "Merged" },
  { kind: "speakers", language: "ru", label: "RU speakers" },
  { kind: "text", language: "ru", label: "RU text" },
  { kind: "speakers", language: "en", label: "EN speakers" },
  { kind: "text", language: "en", label: "EN text" },
  { kind: "srt", language: "ru", label: "RU srt" },
  { kind: "srt", language: "en", label: "EN srt" },
];

export function transcriptTabs(files: RecordingFile[]): TranscriptTab[] {
  return TAB_ORDER.flatMap((slot) => {
    const file = files.find((entry) => entry.kind === slot.kind && entry.language === slot.language);
    if (!file) return [];
    const version = `${file.size}:${file.updatedAt ?? ""}`;
    return [{ id: file.key, label: slot.label, source: { kind: "remote", key: file.key, version } }];
  });
}
