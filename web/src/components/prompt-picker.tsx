"use client";

import { useRef, useState } from "react";
import { apiRequest } from "@/lib/api-client";
import { describeError } from "@/lib/format";
import { NO_PROMPT, type PromptChoice } from "@/lib/run-config";
import { MAX_PROMPT_CHARS } from "@/lib/limits";

type PromptPickerProps = {
  id: string;
  label: string;
  value: PromptChoice;
  onChange: (choice: PromptChoice) => void;
  promptNames: string[];
  disabled?: boolean;
};

const LIBRARY_PREFIX = "library:";

function selectionOf(value: PromptChoice): string {
  return value.mode === "library" ? `${LIBRARY_PREFIX}${value.name}` : value.mode;
}

export function PromptPicker({ id, label, value, onChange, promptNames, disabled }: PromptPickerProps) {
  const [loadError, setLoadError] = useState<string | null>(null);
  const latestRequest = useRef(0);

  async function loadLibraryPrompt(name: string) {
    const request = ++latestRequest.current;
    onChange({ mode: "library", name, text: "" });
    try {
      const prompt = await apiRequest<{ text: string }>(`/api/prompts/${name}`);
      if (latestRequest.current === request) onChange({ mode: "library", name, text: prompt.text });
    } catch (caught) {
      if (latestRequest.current === request) setLoadError(describeError(caught));
    }
  }

  function select(selection: string) {
    latestRequest.current += 1;
    setLoadError(null);
    if (selection === "none") onChange(NO_PROMPT);
    else if (selection === "custom") onChange({ mode: "custom", name: "", text: value.text });
    else void loadLibraryPrompt(selection.slice(LIBRARY_PREFIX.length));
  }

  const loading = value.mode === "library" && !value.text && !loadError;
  const length = value.text.trim().length;

  return (
    <div>
      <label htmlFor={id} className="label">
        {label}
      </label>
      <select
        id={id}
        className="input"
        value={selectionOf(value)}
        disabled={disabled}
        onChange={(event) => select(event.target.value)}
      >
        <option value="none">None</option>
        <option value="custom">Custom text</option>
        {promptNames.length > 0 && (
          <optgroup label="Library">
            {promptNames.map((name) => (
              <option key={name} value={`${LIBRARY_PREFIX}${name}`}>
                {name}
              </option>
            ))}
          </optgroup>
        )}
      </select>

      {value.mode !== "none" && (
        <div className="mt-2">
          <textarea
            aria-label={`${label} text`}
            className="input min-h-24 font-mono"
            value={value.text}
            readOnly={value.mode === "library"}
            disabled={disabled}
            placeholder={loading ? "Loading prompt…" : "A few natural sentences with the names and terms people say"}
            onChange={(event) => onChange({ mode: "custom", name: "", text: event.target.value })}
          />
          <p className={`hint mt-1 ${length > MAX_PROMPT_CHARS ? "text-danger" : ""}`}>
            {length} / {MAX_PROMPT_CHARS} characters
            {value.mode === "library" && " · read-only library prompt; switch to Custom text to edit a copy"}
          </p>
        </div>
      )}
      {loadError && (
        <p role="alert" className="mt-1 text-sm text-danger">
          Could not load the prompt: {loadError}
        </p>
      )}
    </div>
  );
}
