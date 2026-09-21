"use client";

import { type FormEvent, useState } from "react";
import { apiRequest } from "@/lib/api-client";
import { describeError } from "@/lib/format";

type LoginFormProps = { next: string };

export function LoginForm({ next }: LoginFormProps) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await apiRequest<{ next: string }>("/api/login", "POST", { password, next });
      window.location.assign(result.next);
    } catch (caught) {
      setError(describeError(caught));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="card mx-auto mt-12 max-w-sm space-y-4">
      <h1>Log in</h1>
      <div>
        <label htmlFor="password" className="label">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          autoFocus
          className="input"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </div>
      {error && (
        <p role="alert" className="notice notice-danger">
          {error}
        </p>
      )}
      <button type="submit" className="btn btn-primary w-full" disabled={busy || password.length === 0}>
        {busy ? "Checking…" : "Log in"}
      </button>
    </form>
  );
}
