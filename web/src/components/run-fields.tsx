"use client";

import { LANGUAGES, type Language } from "@/lib/ids";
import {
  LANGUAGE_LABELS,
  type PassState,
  type RecordingOutputs,
  type RunState,
  canMergeAfterRun,
} from "@/lib/run-config";
import { MAX_BATCH_SIZE, MAX_SPEAKERS, MIN_BATCH_SIZE, MIN_SPEAKERS } from "@/lib/limits";
import { PromptPicker } from "./prompt-picker";

type RunFieldsProps = {
  idPrefix: string;
  state: RunState;
  onChange: (update: (previous: RunState) => RunState) => void;
  promptNames: string[];
  outputs: RecordingOutputs;
  disabled?: boolean;
};

function mergeHint(state: RunState, outputs: RecordingOutputs): string {
  if (canMergeAfterRun(state, outputs)) {
    return "Builds one timeline and picks, per speaker turn, the pass that heard the language actually spoken.";
  }
  if (!state.diarize && !outputs.hasDiarization) return "Needs speaker turns: turn diarization on.";
  return "Needs both the Russian and the English pass.";
}

export function RunFields({ idPrefix, state, onChange, promptNames, outputs, disabled }: RunFieldsProps) {
  const mergeAvailable = canMergeAfterRun(state, outputs);
  const merging = state.mergeAfter && mergeAvailable;

  function patch(fields: Partial<RunState>) {
    onChange((previous) => ({ ...previous, ...fields }));
  }

  function patchPass(language: Language, fields: Partial<PassState>) {
    onChange((previous) => ({
      ...previous,
      passes: { ...previous.passes, [language]: { ...previous.passes[language], ...fields } },
    }));
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        {LANGUAGES.map((language) => {
          const pass = state.passes[language];
          return (
            <fieldset key={language} className="card space-y-3" disabled={disabled}>
              <legend className="sr-only">{LANGUAGE_LABELS[language]} pass</legend>
              <div className="flex items-center justify-between gap-2">
                <label className="checkbox-row font-semibold">
                  <input
                    type="checkbox"
                    checked={pass.enabled}
                    onChange={(event) => patchPass(language, { enabled: event.target.checked })}
                  />
                  {LANGUAGE_LABELS[language]} pass
                </label>
                {outputs.languages.includes(language) && <span className="badge">exists · re-run</span>}
              </div>
              {pass.enabled && (
                <>
                  <PromptPicker
                    id={`${idPrefix}-${language}-prompt`}
                    label="Initial prompt"
                    value={pass.prompt}
                    promptNames={promptNames}
                    onChange={(prompt) => patchPass(language, { prompt })}
                  />
                  <label className="checkbox-row">
                    <input
                      type="checkbox"
                      checked={pass.align}
                      onChange={(event) => patchPass(language, { align: event.target.checked })}
                    />
                    Align word timings (wav2vec2)
                  </label>
                </>
              )}
            </fieldset>
          );
        })}
      </div>

      <fieldset className="card space-y-3" disabled={disabled}>
        <legend className="sr-only">Speaker diarization</legend>
        <label className="checkbox-row font-semibold">
          <input
            type="checkbox"
            checked={state.diarize}
            onChange={(event) => patch({ diarize: event.target.checked })}
          />
          Speaker diarization (pyannote)
        </label>
        {state.diarize && (
          <div className="flex flex-wrap items-end gap-4">
            <div className="w-28">
              <label htmlFor={`${idPrefix}-min-speakers`} className="label">
                Min speakers
              </label>
              <input
                id={`${idPrefix}-min-speakers`}
                type="number"
                inputMode="numeric"
                min={MIN_SPEAKERS}
                max={MAX_SPEAKERS}
                className="input"
                value={state.minSpeakers}
                onChange={(event) => patch({ minSpeakers: event.target.value })}
              />
            </div>
            <div className="w-28">
              <label htmlFor={`${idPrefix}-max-speakers`} className="label">
                Max speakers
              </label>
              <input
                id={`${idPrefix}-max-speakers`}
                type="number"
                inputMode="numeric"
                min={MIN_SPEAKERS}
                max={MAX_SPEAKERS}
                className="input"
                value={state.maxSpeakers}
                onChange={(event) => patch({ maxSpeakers: event.target.value })}
              />
            </div>
            <label className="checkbox-row pb-1.5">
              <input
                type="checkbox"
                checked={state.reuseDiarization}
                onChange={(event) => patch({ reuseDiarization: event.target.checked })}
              />
              Reuse stored speaker turns when they exist
            </label>
          </div>
        )}
      </fieldset>

      <fieldset className="card space-y-3" disabled={disabled}>
        <legend className="sr-only">Merge</legend>
        <label className="checkbox-row font-semibold">
          <input
            type="checkbox"
            checked={merging}
            disabled={!mergeAvailable}
            onChange={(event) => patch({ mergeAfter: event.target.checked })}
          />
          Merge RU+EN after transcription
        </label>
        <p className="hint">{mergeHint(state, outputs)}</p>
        {merging && (
          <PromptPicker
            id={`${idPrefix}-merge-prompt`}
            label="Merge prompt (bilingual)"
            value={state.mergePrompt}
            promptNames={promptNames}
            onChange={(mergePrompt) => patch({ mergePrompt })}
          />
        )}
      </fieldset>

      <details className="card">
        <summary className="font-semibold">Advanced</summary>
        <div className="mt-3 w-40">
          <label htmlFor={`${idPrefix}-batch-size`} className="label">
            Batch size
          </label>
          <input
            id={`${idPrefix}-batch-size`}
            type="number"
            inputMode="numeric"
            min={MIN_BATCH_SIZE}
            max={MAX_BATCH_SIZE}
            className="input"
            placeholder="auto"
            disabled={disabled}
            value={state.batchSize}
            onChange={(event) => patch({ batchSize: event.target.value })}
          />
          <p className="hint mt-1">Empty = chosen automatically from the GPU VRAM.</p>
        </div>
      </details>
    </div>
  );
}
