import { type NextRequest, NextResponse } from "next/server";
import { HttpError, protectedRoute } from "@/lib/http";
import { fileNameOfKey, isServableKey } from "@/lib/ids";
import { presignDownload } from "@/lib/r2";

export const GET = protectedRoute(async (request: NextRequest) => {
  const key = request.nextUrl.searchParams.get("key") ?? "";
  if (!isServableKey(key)) throw new HttpError(400, "This key cannot be served");
  const asAttachment = request.nextUrl.searchParams.get("download") === "1";
  const url = await presignDownload(key, asAttachment ? fileNameOfKey(key) : null);
  return NextResponse.redirect(url, { status: 302, headers: { "Cache-Control": "no-store" } });
});
