"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { apiRequest } from "@/lib/api-client";
import { describeError } from "@/lib/format";

type DeleteRecordingProps = { recordingId: string };

export function DeleteRecording({ recordingId }: DeleteRecordingProps) {
  const router = useRouter();
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiRequest(`/api/recordings/${recordingId}`, "DELETE");
      router.push("/");
      router.refresh();
    } catch (caught) {
      setError(describeError(caught));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="card space-y-3">
      <p>
        Deletes the audio, every transcript and every job record. Running jobs are cancelled. This cannot be
        undone.
      </p>
      <div>
        <label htmlFor="delete-confirmation" className="label">
          Type <span className="font-mono text-fg">{recordingId}</span> to confirm
        </label>
        <input
          id="delete-confirmation"
          type="text"
          autoComplete="off"
          className="input max-w-md font-mono"
          value={confirmation}
          onChange={(event) => setConfirmation(event.target.value)}
        />
      </div>
      {error && (
        <p role="alert" className="notice notice-danger">
          {error}
        </p>
      )}
      <button type="submit" className="btn btn-danger" disabled={busy || confirmation !== recordingId}>
        {busy ? "Deleting…" : "Delete recording"}
      </button>
    </form>
  );
}
