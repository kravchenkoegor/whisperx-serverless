"use client";

import { useEffect, useState } from "react";
import {
  WHISPER_PROMPT_TOKEN_LIMIT,
  WHISPER_PROMPT_TOKEN_WARNING,
  loadPromptTokenCounter,
} from "@/lib/whisper-tokens";

type TokenCounterProps = { text: string };
type Count = { text: string; tokens: number };

const DEBOUNCE_MS = 250;

function toneOf(tokens: number): string {
  if (tokens > WHISPER_PROMPT_TOKEN_LIMIT) return "badge-danger";
  if (tokens > WHISPER_PROMPT_TOKEN_WARNING) return "badge-warn";
  return "badge-ok";
}

function adviceOf(tokens: number): string {
  if (tokens > WHISPER_PROMPT_TOKEN_LIMIT) {
    return `The first ${tokens - WHISPER_PROMPT_TOKEN_LIMIT} tokens will be dropped.`;
  }
  if (tokens > WHISPER_PROMPT_TOKEN_WARNING) return "Close to the limit.";
  return "Fits.";
}

export function TokenCounter({ text }: TokenCounterProps) {
  const [count, setCount] = useState<Count | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let current = true;
    const timer = setTimeout(() => {
      loadPromptTokenCounter()
        .then((countTokens) => {
          if (current) setCount({ text, tokens: countTokens(text) });
        })
        .catch(() => {
          if (current) setUnavailable(true);
        });
    }, DEBOUNCE_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [text]);

  if (unavailable) {
    return (
      <p className="hint" aria-live="polite">
        Token counter unavailable (the tokenizer could not be downloaded). Stay well under{" "}
        {WHISPER_PROMPT_TOKEN_LIMIT} Whisper tokens: roughly 150 English or 80 Russian words.
      </p>
    );
  }

  if (!count) {
    return (
      <p className="hint" aria-live="polite">
        Loading the Whisper tokenizer…
      </p>
    );
  }

  const stale = count.text !== text;
  return (
    <p className="flex flex-wrap items-center gap-2 text-xs" aria-live="polite">
      <span className={`badge tabular-nums ${toneOf(count.tokens)} ${stale ? "opacity-60" : ""}`}>
        {count.tokens} / {WHISPER_PROMPT_TOKEN_LIMIT} Whisper tokens
      </span>
      <span className="text-fg-muted">{adviceOf(count.tokens)}</span>
    </p>
  );
}
