import { type NextRequest, NextResponse } from "next/server";
import { HttpError, type RouteParams, protectedRoute } from "@/lib/http";
import { isJobId } from "@/lib/ids";
import { getJobStatus } from "@/lib/runpod";

type Params = RouteParams<{ jobId: string }>;

export const GET = protectedRoute(async (_request: NextRequest, context: Params) => {
  const { jobId } = await context.params;
  if (!isJobId(jobId)) throw new HttpError(400, "Invalid job id");
  return NextResponse.json(await getJobStatus(jobId), { headers: { "Cache-Control": "no-store" } });
});
