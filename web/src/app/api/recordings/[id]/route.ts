import { revalidatePath } from "next/cache";
import { type NextRequest, NextResponse } from "next/server";
import { HttpError, type RouteParams, protectedRoute } from "@/lib/http";
import { isRecordingId } from "@/lib/ids";
import { deleteRecording, getRecordingDetail } from "@/lib/recordings";

type Params = RouteParams<{ id: string }>;

async function recordingIdFrom(context: Params): Promise<string> {
  const { id } = await context.params;
  if (!isRecordingId(id)) throw new HttpError(400, "Invalid recording id");
  return id;
}

export const GET = protectedRoute(async (_request: NextRequest, context: Params) => {
  const detail = await getRecordingDetail(await recordingIdFrom(context));
  if (!detail) throw new HttpError(404, "Recording not found");
  return NextResponse.json(detail, { headers: { "Cache-Control": "no-store" } });
});

export const DELETE = protectedRoute(async (_request: NextRequest, context: Params) => {
  const id = await recordingIdFrom(context);
  const deleted = await deleteRecording(id);
  revalidatePath("/");
  revalidatePath(`/r/${id}`);
  return NextResponse.json({ deleted });
});
