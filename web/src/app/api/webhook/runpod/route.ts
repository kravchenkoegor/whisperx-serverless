import { revalidatePath } from "next/cache";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { constantTimeEqual } from "@/lib/crypto";
import { env } from "@/lib/env";
import { jsonError } from "@/lib/http";
import { isJobId, isRecordingId, jobDocumentKey, pendingKey } from "@/lib/ids";
import { deleteObject, objectExists } from "@/lib/r2";

const recordingRef = z.object({ recording_id: z.string() }).partial();
const payloadSchema = z.object({
  id: z.string(),
  input: recordingRef.nullish(),
  output: recordingRef.extend({ status: recordingRef.nullish() }).nullish(),
});

function isAuthorized(request: NextRequest): boolean {
  const secret = env.webhookSecret();
  const token = request.nextUrl.searchParams.get("token");
  return Boolean(secret && token && constantTimeEqual(token, secret));
}

function recordingIdOf(request: NextRequest, payload: z.infer<typeof payloadSchema>): string | null {
  const candidates = [
    request.nextUrl.searchParams.get("recording"),
    payload.input?.recording_id,
    payload.output?.recording_id,
    payload.output?.status?.recording_id,
  ];
  return candidates.find(isRecordingId) ?? null;
}

async function settleJob(recordingId: string, jobId: string): Promise<void> {
  if (!(await objectExists(jobDocumentKey(recordingId, jobId)))) return;
  await deleteObject(pendingKey(recordingId, jobId));
  revalidatePath("/");
  revalidatePath(`/r/${recordingId}`);
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) return jsonError(401, "Invalid webhook token");
  try {
    const payload = payloadSchema.safeParse(await request.json());
    const recordingId = payload.success ? recordingIdOf(request, payload.data) : null;
    if (payload.success && recordingId && isJobId(payload.data.id)) {
      await settleJob(recordingId, payload.data.id);
    }
  } catch (error) {
    console.error("runpod webhook", error);
  }
  return NextResponse.json({ ok: true });
}
