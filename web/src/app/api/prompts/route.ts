import { NextResponse } from "next/server";
import { protectedRoute } from "@/lib/http";
import { listPrompts } from "@/lib/prompts";

export const GET = protectedRoute(async () => {
  return NextResponse.json({ prompts: await listPrompts() }, { headers: { "Cache-Control": "no-store" } });
});
