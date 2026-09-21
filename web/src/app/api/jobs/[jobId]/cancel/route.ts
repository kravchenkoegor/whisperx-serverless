import { type NextRequest, NextResponse } from "next/server";
import { HttpError, type RouteParams, protectedRoute } from "@/lib/http";
import { isJobId } from "@/lib/ids";
import { cancelJob } from "@/lib/runpod";

type Params = RouteParams<{ jobId: string }>;

export const POST = protectedRoute(async (_request: NextRequest, context: Params) => {
  const { jobId } = await context.params;
  if (!isJobId(jobId)) throw new HttpError(400, "Invalid job id");
  return NextResponse.json(await cancelJob(jobId));
});
