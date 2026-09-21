import { type NextRequest, NextResponse } from "next/server";
import { sleep } from "@/lib/async";
import { constantTimeEqual } from "@/lib/crypto";
import { env } from "@/lib/env";
import { jsonError, publicRoute, readJson } from "@/lib/http";
import { clearFailures, recordFailure, retryAfterSeconds } from "@/lib/rate-limit";
import { loginSchema } from "@/lib/schemas";
import { SESSION_COOKIE, createSessionToken, safeNextPath, sessionCookieOptions } from "@/lib/session";

const FAILURE_DELAY_MS = 500;

function clientAddress(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip") || "unknown";
}

export const POST = publicRoute(async (request: NextRequest) => {
  const client = clientAddress(request);
  const retryAfter = retryAfterSeconds(client);
  if (retryAfter > 0) {
    const response = jsonError(429, "Too many failed attempts. Try again later.");
    response.headers.set("Retry-After", String(retryAfter));
    return response;
  }
  // Counted before the first await so parallel guesses cannot all slip past the limit; cleared on success.
  recordFailure(client);

  const expectedPassword = env.appPassword();
  const { password, next } = await readJson(request, loginSchema);
  if (!constantTimeEqual(password, expectedPassword)) {
    await sleep(FAILURE_DELAY_MS);
    return jsonError(401, "Wrong password");
  }

  const token = await createSessionToken();
  clearFailures(client);
  const response = NextResponse.json({ ok: true, next: safeNextPath(next) });
  response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
  return response;
});
