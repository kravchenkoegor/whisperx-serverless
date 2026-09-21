import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ErrorState } from "@/components/error-state";
import { RecordingView } from "@/components/recording-view";
import { requirePageSession } from "@/lib/auth";
import { isRecordingId } from "@/lib/ids";
import { load } from "@/lib/load";
import { listPrompts } from "@/lib/prompts";
import { getRecordingDetail } from "@/lib/recordings";

export const metadata: Metadata = { title: "Recording" };
export const dynamic = "force-dynamic";

type RecordingPageProps = { params: Promise<{ id: string }> };

export default async function RecordingPage({ params }: RecordingPageProps) {
  const { id } = await params;
  if (!isRecordingId(id)) notFound();
  await requirePageSession(`/r/${id}`);

  const [detail, prompts] = await Promise.all([load(() => getRecordingDetail(id)), load(listPrompts)]);
  if (!detail.ok) return <ErrorState title="Could not load the recording" message={detail.error} />;
  if (!detail.data) notFound();

  return (
    <RecordingView
      initial={detail.data}
      promptNames={prompts.ok ? prompts.data.map((prompt) => prompt.name) : []}
    />
  );
}
