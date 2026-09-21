export const MAX_PROMPT_CHARS = 4000;
export const MAX_UPLOAD_BYTES = 2 * 1024 ** 3;
export const MIN_SPEAKERS = 1;
export const MAX_SPEAKERS = 20;
export const MIN_BATCH_SIZE = 1;
export const MAX_BATCH_SIZE = 32;

export const THRESHOLD_DEFAULTS = {
  merge_gap: 1.0,
  max_unit: 30.0,
  min_lid_sec: 1.5,
  lid_confident: 0.8,
  cyrillic_min: 0.25,
  latin_min: 0.75,
  en_max_cyrillic: 0.02,
  speaker_one_sided: 0.85,
  echo_ngram: 5,
  prompt_echo_thresh: 0.5,
} as const;

export type ThresholdName = keyof typeof THRESHOLD_DEFAULTS;
export const THRESHOLD_NAMES = Object.keys(THRESHOLD_DEFAULTS) as ThresholdName[];

const RUNPOD_TERMINAL_STATUSES = ["COMPLETED", "FAILED", "CANCELLED", "TIMED_OUT"];

export function isTerminalRunpodStatus(status: string): boolean {
  return RUNPOD_TERMINAL_STATUSES.includes(status);
}
