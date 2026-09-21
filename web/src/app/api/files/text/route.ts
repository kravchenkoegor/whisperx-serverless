import { type NextRequest } from "next/server";
import { HttpError, protectedRoute } from "@/lib/http";
import { isServableKey } from "@/lib/ids";
import { getObjectText } from "@/lib/r2";

const MAX_TEXT_BYTES = 5 * 1024 * 1024;
const TEXT_EXTENSIONS = /\.(txt|srt|json)$/;

export const GET = protectedRoute(async (request: NextRequest) => {
  const key = request.nextUrl.searchParams.get("key") ?? "";
  if (!isServableKey(key) || !TEXT_EXTENSIONS.test(key)) {
    throw new HttpError(400, "This key cannot be displayed as text");
  }
  const text = await getObjectText(key, MAX_TEXT_BYTES);
  if (text === null) throw new HttpError(404, "File not found");
  return new Response(text, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
