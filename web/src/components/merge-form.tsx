"use client";

import { type FormEvent, useState } from "react";
import { apiRequest } from "@/lib/api-client";
import { describeError } from "@/lib/format";
import {
  type JobTarget,
  NO_PROMPT,
  type PromptChoice,
  type RecordingOutputs,
  buildMergeJob,
  initialThresholdState,
} from "@/lib/run-config";
import { THRESHOLD_DEFAULTS, THRESHOLD_NAMES } from "@/lib/limits";
import { PromptPicker } from "./prompt-picker";

type MergeFormProps = {
  target: JobTarget;
  outputs: RecordingOutputs;
  merged: boolean;
  promptNames: string[];
  onSubmitted: () => void;
};

function blockedReason(outputs: RecordingOutputs): string | null {
  if (outputs.languages.length < 2) return "Available once both the Russian and the English pass exist.";
  if (!outputs.hasDiarization) return "Needs speaker turns: re-run a pass with diarization on.";
  return null;
}

export function MergeForm({ target, outputs, merged, promptNames, onSubmitted }: MergeFormProps) {
  const [prompt, setPrompt] = useState<PromptChoice>(NO_PROMPT);
  const [thresholds, setThresholds] = useState(initialThresholdState);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const blocked = blockedReason(outputs);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const built = buildMergeJob(prompt, thresholds, target);
    if (!built.ok) {
      setError(built.error);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await apiRequest("/api/jobs", "POST", built.job);
      onSubmitted();
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  }

  if (blocked) return <p className="text-fg-muted">{blocked}</p>;

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <fieldset className="card space-y-3" disabled={busy}>
        <legend className="sr-only">Merge settings</legend>
        <PromptPicker
          id="merge-prompt"
          label="Merge prompt (bilingual)"
          value={prompt}
          promptNames={promptNames}
          onChange={setPrompt}
        />
        <details>
          <summary className="font-semibold">Thresholds</summary>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
            {THRESHOLD_NAMES.map((name) => (
              <div key={name}>
                <label htmlFor={`threshold-${name}`} className="label font-mono">
                  {name}
                </label>
                <input
                  id={`threshold-${name}`}
                  type="number"
                  inputMode="decimal"
                  step="any"
                  className="input"
                  value={thresholds[name]}
                  onChange={(event) => setThresholds((previous) => ({ ...previous, [name]: event.target.value }))}
                />
                <p className="hint mt-0.5">default {THRESHOLD_DEFAULTS[name]}</p>
              </div>
            ))}
          </div>
          <button type="button" className="btn mt-3" onClick={() => setThresholds(initialThresholdState())}>
            Reset to defaults
          </button>
        </details>
      </fieldset>
      {error && (
        <p role="alert" className="notice notice-danger whitespace-pre-wrap">
          {error}
        </p>
      )}
      <button type="submit" className="btn btn-primary" disabled={busy}>
        {busy ? "Submitting…" : merged ? "Re-merge" : "Merge"}
      </button>
    </form>
  );
}
