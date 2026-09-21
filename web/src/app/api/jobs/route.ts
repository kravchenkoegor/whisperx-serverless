import { revalidatePath } from "next/cache";
import { type NextRequest, NextResponse } from "next/server";
import { protectedRoute, readJson } from "@/lib/http";
import { submitRecordingJob } from "@/lib/jobs";
import { jobInputSchema } from "@/lib/schemas";

export const POST = protectedRoute(async (request: NextRequest) => {
  const job = await readJson(request, jobInputSchema);
  const jobId = await submitRecordingJob(job);
  revalidatePath("/");
  revalidatePath(`/r/${job.recording_id}`);
  return NextResponse.json({ jobId }, { status: 201 });
});
