import { LANGUAGES, type Language } from "./ids";
import {
  MAX_BATCH_SIZE,
  MAX_PROMPT_CHARS,
  MAX_SPEAKERS,
  MIN_BATCH_SIZE,
  MIN_SPEAKERS,
  THRESHOLD_DEFAULTS,
  THRESHOLD_NAMES,
  type ThresholdName,
} from "./limits";
import type { JobInputDraft } from "./schemas";

export type PromptChoice = { mode: "none" | "library" | "custom"; name: string; text: string };
export type PassState = { enabled: boolean; prompt: PromptChoice; align: boolean };

export type RunState = {
  passes: Record<Language, PassState>;
  diarize: boolean;
  minSpeakers: string;
  maxSpeakers: string;
  reuseDiarization: boolean;
  mergeAfter: boolean;
  mergePrompt: PromptChoice;
  batchSize: string;
};

export type ThresholdState = Record<ThresholdName, string>;
export type JobTarget = { recordingId: string; audioKey: string };
export type RecordingOutputs = { languages: Language[]; hasDiarization: boolean };
export type BuiltJob = { ok: true; job: JobInputDraft } | { ok: false; error: string };

export const NO_PROMPT: PromptChoice = { mode: "none", name: "", text: "" };
export const LANGUAGE_LABELS: Record<Language, string> = { ru: "Russian", en: "English" };

export function initialRunState(enabledLanguages: Language[]): RunState {
  const pass = (language: Language): PassState => ({
    enabled: enabledLanguages.includes(language),
    prompt: NO_PROMPT,
    align: true,
  });
  return {
    passes: { ru: pass("ru"), en: pass("en") },
    diarize: true,
    minSpeakers: "2",
    maxSpeakers: "4",
    reuseDiarization: true,
    mergeAfter: false,
    mergePrompt: NO_PROMPT,
    batchSize: "",
  };
}

export function initialThresholdState(): ThresholdState {
  const entries = THRESHOLD_NAMES.map((name) => [name, String(THRESHOLD_DEFAULTS[name])]);
  return Object.fromEntries(entries) as ThresholdState;
}

export function enabledLanguages(state: RunState): Language[] {
  return LANGUAGES.filter((language) => state.passes[language].enabled);
}

export function canMergeAfterRun(state: RunState, outputs: RecordingOutputs): boolean {
  const available = new Set([...outputs.languages, ...enabledLanguages(state)]);
  const bothLanguages = LANGUAGES.every((language) => available.has(language));
  return bothLanguages && (state.diarize || outputs.hasDiarization);
}

function resolvePrompt(choice: PromptChoice): string | null {
  return choice.mode === "none" ? null : choice.text.trim() || null;
}

function promptProblem(label: string, choice: PromptChoice): string | null {
  if (choice.mode === "library" && !choice.text) return `${label}: the library prompt has not loaded yet`;
  if (choice.text.trim().length > MAX_PROMPT_CHARS) {
    return `${label}: the prompt is longer than ${MAX_PROMPT_CHARS} characters`;
  }
  return null;
}

type ParsedInt = { value: number | null; error: string | null };

const NOT_SET: ParsedInt = { value: null, error: null };

function parseOptionalInt(raw: string, label: string, min: number, max: number): ParsedInt {
  if (raw.trim() === "") return NOT_SET;
  const value = Number(raw.trim());
  if (!Number.isInteger(value) || value < min || value > max) {
    return { value: null, error: `${label} must be a whole number from ${min} to ${max}` };
  }
  return { value, error: null };
}

export function buildTranscribeJob(state: RunState, target: JobTarget, outputs: RecordingOutputs): BuiltJob {
  const languages = enabledLanguages(state);
  if (languages.length === 0) return { ok: false, error: "Enable at least one pass" };

  const merging = state.mergeAfter && canMergeAfterRun(state, outputs);
  const problems = [
    ...languages.map((language) => promptProblem(`${LANGUAGE_LABELS[language]} pass`, state.passes[language].prompt)),
    merging ? promptProblem("Merge", state.mergePrompt) : null,
  ];
  const problem = problems.find((entry) => entry !== null);
  if (problem) return { ok: false, error: problem };

  const minSpeakers = state.diarize
    ? parseOptionalInt(state.minSpeakers, "Min speakers", MIN_SPEAKERS, MAX_SPEAKERS)
    : NOT_SET;
  const maxSpeakers = state.diarize
    ? parseOptionalInt(state.maxSpeakers, "Max speakers", MIN_SPEAKERS, MAX_SPEAKERS)
    : NOT_SET;
  const batchSize = parseOptionalInt(state.batchSize, "Batch size", MIN_BATCH_SIZE, MAX_BATCH_SIZE);
  const numberProblem = [minSpeakers, maxSpeakers, batchSize].find((parsed) => parsed.error)?.error;
  if (numberProblem) return { ok: false, error: numberProblem };
  if (minSpeakers.value !== null && maxSpeakers.value !== null && minSpeakers.value > maxSpeakers.value) {
    return { ok: false, error: "Min speakers must not exceed max speakers" };
  }

  const job: JobInputDraft = {
    task: "transcribe",
    recording_id: target.recordingId,
    audio_key: target.audioKey,
    diarize: state.diarize,
    min_speakers: minSpeakers.value,
    max_speakers: maxSpeakers.value,
    reuse_diarization: state.reuseDiarization,
    passes: languages.map((language) => ({
      language,
      prompt: resolvePrompt(state.passes[language].prompt),
      align: state.passes[language].align,
    })),
    merge: merging ? { prompt: resolvePrompt(state.mergePrompt), thresholds: {} } : null,
    batch_size: batchSize.value,
  };
  return { ok: true, job };
}

export function buildMergeJob(prompt: PromptChoice, thresholds: ThresholdState, target: JobTarget): BuiltJob {
  const problem = promptProblem("Merge", prompt);
  if (problem) return { ok: false, error: problem };

  const values: Partial<Record<ThresholdName, number>> = {};
  for (const name of THRESHOLD_NAMES) {
    const value = Number(thresholds[name].trim());
    if (thresholds[name].trim() === "" || !Number.isFinite(value)) {
      return { ok: false, error: `Threshold ${name} must be a number` };
    }
    if (name === "echo_ngram" && !Number.isInteger(value)) {
      return { ok: false, error: "Threshold echo_ngram must be a whole number" };
    }
    values[name] = value;
  }

  const job: JobInputDraft = {
    task: "merge_ru_en",
    recording_id: target.recordingId,
    audio_key: target.audioKey,
    merge: { prompt: resolvePrompt(prompt), thresholds: values },
  };
  return { ok: true, job };
}

const DRAFT_TARGET: JobTarget = { recordingId: "draft", audioKey: "recordings/draft/audio.draft" };

export function runStateProblem(state: RunState, outputs: RecordingOutputs): string | null {
  const built = buildTranscribeJob(state, DRAFT_TARGET, outputs);
  return built.ok ? null : built.error;
}
