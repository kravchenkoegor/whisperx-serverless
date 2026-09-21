import { revalidatePath } from "next/cache";
import { type NextRequest, NextResponse } from "next/server";
import { protectedRoute, readJson } from "@/lib/http";
import { createRecording } from "@/lib/recordings";
import { createRecordingSchema } from "@/lib/schemas";

export const POST = protectedRoute(async (request: NextRequest) => {
  const input = await readJson(request, createRecordingSchema);
  const created = await createRecording(input);
  revalidatePath("/");
  return NextResponse.json(created, { status: 201 });
});
