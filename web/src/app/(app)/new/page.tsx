import type { Metadata } from "next";
import { ErrorState } from "@/components/error-state";
import { NewRecordingForm } from "@/components/new-recording-form";
import { requirePageSession } from "@/lib/auth";
import { load } from "@/lib/load";
import { listPrompts } from "@/lib/prompts";

export const metadata: Metadata = { title: "New recording" };
export const dynamic = "force-dynamic";

export default async function NewRecordingPage() {
  await requirePageSession("/new");
  const prompts = await load(listPrompts);

  return (
    <div className="space-y-4">
      <h1>New recording</h1>
      {!prompts.ok && <ErrorState title="Could not load the prompt library" message={prompts.error} />}
      <NewRecordingForm promptNames={prompts.ok ? prompts.data.map((prompt) => prompt.name) : []} />
    </div>
  );
}
