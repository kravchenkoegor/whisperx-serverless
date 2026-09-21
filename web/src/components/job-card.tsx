import { COST_PER_SECOND_USD, formatDuration, formatEstimatedCost, formatUtc } from "@/lib/format";
import type { JobDocument } from "@/lib/schemas";

type JobCardProps = { job: JobDocument };

const PASS_STAGES = ["load", "transcribe", "align", "diarize"];
const TASK_LABELS: Record<string, string> = { transcribe: "Transcribe", merge_ru_en: "Merge RU+EN" };

function seconds(value: number | null | undefined): string {
  return typeof value === "number" ? `${value.toFixed(1)} s` : "–";
}

function yesNo(value: boolean | null | undefined): string {
  if (value === null || value === undefined) return "–";
  return value ? "yes" : "no";
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="hint">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}

function Counts({ label, counts }: { label: string; counts: Record<string, number> | null | undefined }) {
  const entries = Object.entries(counts ?? {});
  if (entries.length === 0) return null;
  return <Fact label={label} value={entries.map(([name, count]) => `${name} ${count}`).join(" · ")} />;
}

function PassTimings({ passes }: { passes: NonNullable<JobDocument["passes"]> }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[32rem] text-left text-sm">
        <caption className="sr-only">Per-pass stage timings</caption>
        <thead className="text-fg-muted">
          <tr>
            <th scope="col" className="py-1 pr-3 font-medium">Pass</th>
            <th scope="col" className="py-1 pr-3 font-medium">Aligned</th>
            <th scope="col" className="py-1 pr-3 font-medium">Diarized</th>
            <th scope="col" className="py-1 pr-3 font-medium">Batch</th>
            {PASS_STAGES.map((stage) => (
              <th key={stage} scope="col" className="py-1 pr-3 font-medium capitalize">{stage}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {passes.map((pass) => (
            <tr key={pass.language} className="border-t border-line">
              <th scope="row" className="py-1 pr-3 font-semibold uppercase">{pass.language}</th>
              <td className="py-1 pr-3">{yesNo(pass.aligned)}</td>
              <td className="py-1 pr-3">{yesNo(pass.diarized)}</td>
              <td className="py-1 pr-3">{pass.batch_size ?? "–"}</td>
              {PASS_STAGES.map((stage) => (
                <td key={stage} className="py-1 pr-3 tabular-nums">{seconds(pass.timings?.[stage])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function JobCard({ job }: JobCardProps) {
  const failed = job.status === "failed";
  const total = job.total_seconds;
  const otherTimings = Object.entries(job.timings ?? {});
  const merge = job.merge;
  const warnings = job.warnings ?? [];

  return (
    <article className="card space-y-3">
      <header className="flex flex-wrap items-center gap-2">
        <span className={`badge ${failed ? "badge-danger" : "badge-ok"}`}>{job.status}</span>
        <h3>{TASK_LABELS[job.task ?? ""] ?? job.task ?? "Job"}</h3>
        <span className="hint break-all font-mono">{job.job_id}</span>
        <span className="hint ml-auto">{formatUtc(job.finished_at ?? job.started_at)}</span>
      </header>

      {job.error && (
        <p role="alert" className="notice notice-danger break-words">
          {job.error}
        </p>
      )}

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
        <Fact label="Total" value={typeof total === "number" ? formatDuration(total) : "–"} />
        <Fact
          label={`Estimated cost (24 GB tier, $${COST_PER_SECOND_USD}/s)`}
          value={typeof total === "number" ? `≈ ${formatEstimatedCost(total)}` : "–"}
        />
        <Fact
          label="GPU"
          value={job.gpu?.name ? `${job.gpu.name} · ${job.gpu.vram_gb ?? "?"} GB` : "–"}
        />
        <Fact
          label="Worker"
          value={
            job.worker
              ? `${job.worker.jobs_served_before ? "warm" : "cold"} · boot ${seconds(job.worker.boot_seconds)}`
              : "–"
          }
        />
      </dl>

      {job.passes && job.passes.length > 0 && <PassTimings passes={job.passes} />}

      {otherTimings.length > 0 && (
        <p className="hint">
          {otherTimings.map(([stage, value]) => `${stage} ${seconds(value)}`).join(" · ")}
        </p>
      )}

      {merge && (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 border-t border-line pt-3 sm:grid-cols-4">
          <Fact label="Merge units / turns" value={`${merge.units ?? "–"} / ${merge.turns ?? "–"}`} />
          <Counts label="Languages" counts={merge.langs} />
          <Counts label="Text source" counts={merge.sources} />
          <Counts label="Decision rules" counts={merge.rules} />
          <Counts label="English share by speaker" counts={merge.speaker_en_shares} />
          <Fact label="Language ID computed" value={String(merge.lid_computed ?? "–")} />
          <Fact label="Re-decoded units" value={String(merge.redecoded ?? "–")} />
        </dl>
      )}

      {warnings.length > 0 && (
        <ul className="notice notice-warn list-disc space-y-1 pl-6">
          {warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      )}
    </article>
  );
}
