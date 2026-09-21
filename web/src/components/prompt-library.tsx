"use client";

import { type FormEvent, useRef, useState } from "react";
import { apiRequest } from "@/lib/api-client";
import { describeError, formatBytes, formatUtc } from "@/lib/format";
import { isPromptName } from "@/lib/ids";
import { MAX_PROMPT_CHARS } from "@/lib/limits";
import type { PromptSummary } from "@/lib/types";
import { WHISPER_PROMPT_TOKEN_LIMIT } from "@/lib/whisper-tokens";
import { TokenCounter } from "./token-counter";

type PromptLibraryProps = { initialPrompts: PromptSummary[] };
type Editor = { name: string; isNew: boolean; text: string; savedText: string; loading: boolean };

const NEW_PROMPT: Editor = { name: "", isNew: true, text: "", savedText: "", loading: false };

function saveProblem(editor: Editor, prompts: PromptSummary[]): string | null {
  if (!isPromptName(editor.name)) {
    return "Name: lowercase letters, digits, dashes and underscores, starting with a letter or digit";
  }
  if (editor.isNew && prompts.some((prompt) => prompt.name === editor.name)) {
    return "A prompt with this name already exists";
  }
  if (!editor.text.trim()) return "The prompt is empty";
  if (editor.text.trim().length > MAX_PROMPT_CHARS) return `The prompt is longer than ${MAX_PROMPT_CHARS} characters`;
  return null;
}

export function PromptLibrary({ initialPrompts }: PromptLibraryProps) {
  const [prompts, setPrompts] = useState(initialPrompts);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latestOpen = useRef(0);

  async function reloadList() {
    const result = await apiRequest<{ prompts: PromptSummary[] }>("/api/prompts");
    setPrompts(result.prompts);
  }

  async function open(name: string) {
    const request = ++latestOpen.current;
    setError(null);
    setEditor({ name, isNew: false, text: "", savedText: "", loading: true });
    try {
      const prompt = await apiRequest<{ text: string }>(`/api/prompts/${name}`);
      if (latestOpen.current !== request) return;
      setEditor({ name, isNew: false, text: prompt.text, savedText: prompt.text, loading: false });
    } catch (caught) {
      if (latestOpen.current !== request) return;
      setError(describeError(caught));
      setEditor(null);
    }
  }

  function startNew() {
    latestOpen.current += 1;
    setError(null);
    setEditor(NEW_PROMPT);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editor) return;
    const problem = saveProblem(editor, prompts);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const saved = await apiRequest<{ text: string }>(`/api/prompts/${editor.name}`, "PUT", { text: editor.text });
      setEditor({ ...editor, isNew: false, text: saved.text, savedText: saved.text });
      await reloadList();
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!editor || editor.isNew) return;
    if (!window.confirm(`Delete the prompt "${editor.name}"?`)) return;
    setBusy(true);
    setError(null);
    try {
      await apiRequest(`/api/prompts/${editor.name}`, "DELETE");
      setEditor(null);
      await reloadList();
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  }

  const dirty = editor !== null && editor.text !== editor.savedText;

  return (
    <div className="grid gap-4 md:grid-cols-[16rem_1fr]">
      <aside className="space-y-2">
        <button type="button" className="btn w-full" onClick={startNew}>
          New prompt
        </button>
        {prompts.length === 0 && <p className="hint">The library is empty.</p>}
        <ul className="space-y-2">
          {prompts.map((prompt) => {
            const selected = editor !== null && !editor.isNew && editor.name === prompt.name;
            return (
              <li key={prompt.name}>
                <button
                  type="button"
                  aria-current={selected ? "true" : undefined}
                  onClick={() => open(prompt.name)}
                  className={`w-full rounded-md border px-3 py-2 text-left transition-colors ${
                    selected ? "border-accent bg-accent-soft" : "border-line bg-surface hover:bg-surface-muted"
                  }`}
                >
                  <span className="block break-all font-mono text-sm font-semibold">{prompt.name}</span>
                  <span className="hint">
                    {formatBytes(prompt.size)} · {formatUtc(prompt.updatedAt)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </aside>

      <section aria-label="Prompt editor" className="space-y-3">
        {error && (
          <p role="alert" className="notice notice-danger">
            {error}
          </p>
        )}
        {!editor && <p className="card text-fg-muted">Select a prompt or create a new one.</p>}
        {editor && (
          <form onSubmit={save} className="card space-y-3" noValidate>
            <div>
              <label htmlFor="prompt-name" className="label">
                Name
              </label>
              <input
                id="prompt-name"
                type="text"
                className="input max-w-sm font-mono"
                placeholder="sprint_ru"
                autoComplete="off"
                maxLength={64}
                readOnly={!editor.isNew}
                value={editor.name}
                onChange={(event) => setEditor({ ...editor, name: event.target.value.toLowerCase() })}
              />
            </div>
            <div>
              <label htmlFor="prompt-text" className="label">
                Prompt text {dirty && <span className="badge badge-warn ml-1">unsaved</span>}
              </label>
              <textarea
                id="prompt-text"
                className="input min-h-56 font-mono leading-relaxed"
                disabled={editor.loading}
                placeholder={editor.loading ? "Loading…" : "Write a few sentences the way the speakers talk."}
                value={editor.text}
                onChange={(event) => setEditor({ ...editor, text: event.target.value })}
              />
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                <TokenCounter text={editor.text} />
                <span className="hint tabular-nums">
                  {editor.text.trim().length} / {MAX_PROMPT_CHARS} characters
                </span>
              </div>
            </div>
            <ul className="notice list-disc space-y-1 pl-6 text-sm">
              <li>
                faster-whisper keeps only the <strong>last {WHISPER_PROMPT_TOKEN_LIMIT} tokens</strong> of the prompt
                and silently drops the beginning. Russian costs about 1.5–1.7× more tokens than English.
              </li>
              <li>
                Write the prompt as natural speech with the names people actually say, not as a keyword list:
                Whisper echoes list-shaped prompts into the transcript.
              </li>
            </ul>
            <div className="flex flex-wrap gap-2">
              <button type="submit" className="btn btn-primary" disabled={busy || editor.loading}>
                {busy ? "Saving…" : "Save"}
              </button>
              {!editor.isNew && (
                <button type="button" className="btn" disabled={busy} onClick={remove}>
                  Delete
                </button>
              )}
            </div>
          </form>
        )}
      </section>
    </div>
  );
}
