import type { Metadata } from "next";
import { ErrorState } from "@/components/error-state";
import { PromptLibrary } from "@/components/prompt-library";
import { requirePageSession } from "@/lib/auth";
import { load } from "@/lib/load";
import { listPrompts } from "@/lib/prompts";

export const metadata: Metadata = { title: "Prompts" };
export const dynamic = "force-dynamic";

export default async function PromptsPage() {
  await requirePageSession("/prompts");
  const prompts = await load(listPrompts);

  return (
    <div className="space-y-4">
      <div>
        <h1>Prompt library</h1>
        <p className="mt-1 text-fg-muted">
          Initial prompts prime Whisper with the names, jargon and spelling of a recording.
        </p>
      </div>
      {prompts.ok ? (
        <PromptLibrary initialPrompts={prompts.data} />
      ) : (
        <ErrorState title="Could not load the prompt library" message={prompts.error} />
      )}
    </div>
  );
}
