"use client";

import { useEffect, useState } from "react";
import { apiText, fileTextUrl } from "@/lib/api-client";
import { describeError } from "@/lib/format";
import type { TranscriptTab } from "@/lib/transcripts";

type TranscriptViewerProps = { tabs: TranscriptTab[]; emptyMessage?: string };
type Loaded = { cacheKey: string; text: string | null; error: string | null };

function cacheKeyOf(tab: TranscriptTab): string {
  return tab.source.kind === "remote" ? `${tab.source.key}@${tab.source.version}` : tab.id;
}

export function TranscriptViewer({ tabs, emptyMessage = "No transcripts yet." }: TranscriptViewerProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<Loaded[]>([]);

  const active = tabs.find((tab) => tab.id === selectedId) ?? tabs[0] ?? null;
  const activeCacheKey = active ? cacheKeyOf(active) : null;
  const remoteKey = active?.source.kind === "remote" ? active.source.key : null;
  const cached = loaded.find((entry) => entry.cacheKey === activeCacheKey) ?? null;
  const needsFetch = remoteKey !== null && cached === null;

  useEffect(() => {
    if (!needsFetch || !remoteKey || !activeCacheKey) return;
    let current = true;
    const store = (entry: Loaded) => {
      if (current) setLoaded((previous) => [...previous.filter((other) => other.cacheKey !== entry.cacheKey), entry]);
    };
    apiText(fileTextUrl(remoteKey))
      .then((text) => store({ cacheKey: activeCacheKey, text, error: null }))
      .catch((caught) => store({ cacheKey: activeCacheKey, text: null, error: describeError(caught) }));
    return () => {
      current = false;
    };
  }, [needsFetch, remoteKey, activeCacheKey]);

  if (!active) return <p className="text-fg-muted">{emptyMessage}</p>;

  const text = active.source.kind === "inline" ? active.source.text : (cached?.text ?? null);
  const panelId = "transcript-panel";

  return (
    <div className="card p-0">
      <div role="tablist" aria-label="Transcripts" className="flex flex-wrap gap-2 border-b border-line p-2">
        {tabs.map((tab) => {
          const selected = tab.id === active.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              id={`tab-${tab.id}`}
              aria-selected={selected}
              aria-controls={panelId}
              onClick={() => setSelectedId(tab.id)}
              className={`nav-pill ${
                selected ? "bg-accent-soft text-accent" : "text-fg-muted hover:bg-surface-muted hover:text-fg"
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      <div id={panelId} role="tabpanel" aria-labelledby={`tab-${active.id}`} aria-live="polite">
        {cached?.error && (
          <p role="alert" className="p-4 text-danger">
            Could not load this file: {cached.error}
          </p>
        )}
        {text === null && !cached?.error && <p className="p-4 text-fg-muted">Loading…</p>}
        {text !== null && (
          <pre
            tabIndex={0}
            className="max-h-[70vh] overflow-auto whitespace-pre-wrap break-words p-4 font-mono leading-relaxed"
          >
            {text || "This file is empty."}
          </pre>
        )}
      </div>
    </div>
  );
}
