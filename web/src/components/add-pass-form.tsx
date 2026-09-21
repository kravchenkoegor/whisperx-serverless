"use client";

import { type FormEvent, useState } from "react";
import { apiRequest } from "@/lib/api-client";
import { describeError } from "@/lib/format";
import { LANGUAGES } from "@/lib/ids";
import {
  type JobTarget,
  type RecordingOutputs,
  buildTranscribeJob,
  initialRunState,
} from "@/lib/run-config";
import { RunFields } from "./run-fields";

type AddPassFormProps = {
  target: JobTarget;
  outputs: RecordingOutputs;
  promptNames: string[];
  onSubmitted: () => void;
};

export function AddPassForm({ target, outputs, promptNames, onSubmitted }: AddPassFormProps) {
  const [run, setRun] = useState(() =>
    initialRunState(LANGUAGES.filter((language) => !outputs.languages.includes(language))),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const built = buildTranscribeJob(run, target, outputs);
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

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <RunFields
        idPrefix="add-pass"
        state={run}
        onChange={setRun}
        promptNames={promptNames}
        outputs={outputs}
        disabled={busy}
      />
      {error && (
        <p role="alert" className="notice notice-danger whitespace-pre-wrap">
          {error}
        </p>
      )}
      <button type="submit" className="btn btn-primary" disabled={busy}>
        {busy ? "Submitting…" : "Run passes"}
      </button>
    </form>
  );
}
