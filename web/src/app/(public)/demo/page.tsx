import type { Metadata } from "next";
import { JobCard } from "@/components/job-card";
import { TranscriptViewer } from "@/components/transcript-viewer";
import { SAMPLE_JOB, sampleTranscriptTabs } from "@/demo/sample";

export const metadata: Metadata = {
  title: "Demo",
  description: "Read-only sample of a mixed Russian and English meeting transcribed with WhisperX and pyannote.",
  robots: { index: true, follow: true },
};
export const dynamic = "force-static";

export default function DemoPage() {
  const repositoryUrl = process.env.NEXT_PUBLIC_REPO_URL;

  return (
    <div className="space-y-8">
      <header className="space-y-3">
        <h1>Mixed Russian and English meeting, one timeline</h1>
        <p className="max-w-3xl text-fg-muted">
          This is a read-only sample of what the control panel shows for a finished recording. Nothing here talks to
          storage or to a GPU: the transcripts below come from a short synthetic meeting that also serves as the
          regression fixture of the merge step.
        </p>
        {repositoryUrl && (
          <a href={repositoryUrl} className="btn" rel="noreferrer">
            View the source on GitHub
          </a>
        )}
      </header>

      <section aria-labelledby="how-heading" className="space-y-3">
        <h2 id="how-heading">What you are looking at</h2>
        <ol className="grid gap-3 md:grid-cols-3">
          <li className="card">
            <h3>1. Two forced-language passes</h3>
            <p className="mt-1 text-fg-muted">
              WhisperX transcribes the same audio twice, once forced to Russian and once to English. Whisper decodes
              30-second chunks and a chunk keeps the language it started in, so each pass silently{" "}
              <em>translates</em> the other language. Compare the RU pass and EN pass tabs.
            </p>
          </li>
          <li className="card">
            <h3>2. A language decision per speaker turn</h3>
            <p className="mt-1 text-fg-muted">
              pyannote splits the audio into speaker turns. For each turn the merge decides which language was
              really spoken: confident Whisper language ID first, then the alphabet each pass wrote, then the
              speaker&apos;s usual language, then the nearest confident neighbour.
            </p>
          </li>
          <li className="card">
            <h3>3. One merged timeline</h3>
            <p className="mt-1 text-fg-muted">
              Each turn takes its text from the pass that heard it in its own language. Turns translated by both
              passes are re-decoded alone. Prompt echoes and repetition loops are dropped. The rules are
              deterministic: the same inputs always give the same transcript.
            </p>
          </li>
        </ol>
      </section>

      <section aria-labelledby="sample-transcripts-heading" className="space-y-3">
        <h2 id="sample-transcripts-heading">Transcripts</h2>
        <TranscriptViewer tabs={sampleTranscriptTabs()} />
      </section>

      <section aria-labelledby="sample-job-heading" className="space-y-3">
        <h2 id="sample-job-heading">Sample job card</h2>
        <p className="max-w-3xl text-fg-muted">
          Every job on RunPod Serverless ends by writing a status document next to the transcripts. The merge
          statistics below are the real ones for this sample; the timings and the GPU are illustrative.
        </p>
        <JobCard job={SAMPLE_JOB} />
      </section>
    </div>
  );
}
