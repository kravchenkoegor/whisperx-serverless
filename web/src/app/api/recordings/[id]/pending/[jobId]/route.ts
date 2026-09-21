import { revalidatePath } from "next/cache";
import { type NextRequest, NextResponse } from "next/server";
import { HttpError, type RouteParams, protectedRoute } from "@/lib/http";
import { isJobId, isRecordingId, pendingKey } from "@/lib/ids";
import { deleteObject } from "@/lib/r2";

type Params = RouteParams<{ id: string; jobId: string }>;

export const DELETE = protectedRoute(async (_request: NextRequest, context: Params) => {
  const { id, jobId } = await context.params;
  if (!isRecordingId(id)) throw new HttpError(400, "Invalid recording id");
  if (!isJobId(jobId)) throw new HttpError(400, "Invalid job id");
  await deleteObject(pendingKey(id, jobId));
  revalidatePath("/");
  revalidatePath(`/r/${id}`);
  return NextResponse.json({ ok: true });
});
